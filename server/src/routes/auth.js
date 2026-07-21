import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { generateTempPassword } from '../utils/generateTempPassword.js';
import { validatePassword, passwordErrorMessage } from '../utils/validatePassword.js';
import { createFailureRateLimiter } from '../utils/rateLimiter.js';
import multer from 'multer';
import { cloudinaryConfigured, uploadProfilePhoto, deleteProfilePhoto } from '../utils/cloudinary.js';
import { sniffImageMime } from '../utils/imageSniff.js';
import { getAdminCreds } from '../utils/adminCreds.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Phase 7.5: profile photo uploads are buffered in memory (never written to disk)
// with a HARD 2MB server-side cap — the client size hint is not trusted. Only one
// file, field name "photo".
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

// Runs multer and translates its errors (e.g. oversize) into clean 400s.
function handlePhotoUpload(req, res, next) {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image is too large (max 2MB).' });
      }
      return res.status(400).json({ error: 'Invalid file upload.' });
    }
    next();
  });
}

// Phase 4: brute-force protection for login (shared limiter, utils/rateLimiter.js).
// Keyed by IP and counts only FAILED attempts, so a shared IP (e.g. a school lab)
// isn't penalised for successful logins and honest typos stay well under the limit
// while a password-guessing loop is stopped.
const loginLimiter = createFailureRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, rememberMe } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }

    // Phase 4: enforce the password policy server-side (source of truth).
    const check = validatePassword(password);
    if (!check.valid) {
      return res.status(400).json({ error: passwordErrorMessage(check.errors) });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash
    });

    const tokenDuration = rememberMe === false ? '30d' : '90d';
    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: tokenDuration });
    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, photoUrl: user.photoUrl || null }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during user registration.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Phase 4: block brute-force before doing any work (counts prior failures).
    if (loginLimiter.isLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      loginLimiter.record(req.ip);
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Phase 3 (Option B): the same email can log in as the student OR their parent,
    // distinguished purely by which password hash matches. Student is tried first;
    // the parent hash only if a parent account has been created and student fails.
    let sessionRole = null;
    if (await bcrypt.compare(password, user.passwordHash)) {
      sessionRole = user.role; // 'student' (the document's inherent role)
    } else if (user.parentPasswordHash && await bcrypt.compare(password, user.parentPasswordHash)) {
      sessionRole = 'parent';  // parent session on the SAME document
    }
    if (!sessionRole) {
      loginLimiter.record(req.ip);
      return res.status(400).json({ error: 'Invalid email or password.' }); // generic — no enumeration
    }

    const tokenDuration = rememberMe === false ? '30d' : '90d';
    const token = jwt.sign({ userId: user._id, role: sessionRole }, JWT_SECRET, { expiresIn: tokenDuration });
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: sessionRole, photoUrl: user.photoUrl || null },
      // Parent must set their own password before using the dashboard (enforced with
      // the Phase 4 change-password flow). Only meaningful for a parent session.
      mustChangePassword: sessionRole === 'parent' && !!user.parentMustChangePassword
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during user login.' });
  }
});

// Get Current User (Me)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    // Phase 6: admin is env-only (no DB row + no userId in the token). Return an
    // admin identity directly so the session survives a reload without a DB lookup.
    if (req.role === 'admin') {
      const adminCreds = await getAdminCreds();
      return res.json({
        user: { id: null, name: 'Admin', email: adminCreds.email || '', role: 'admin' },
        mustChangePassword: false
      });
    }

    const user = await User.findById(req.userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({
      user: {
        id: user._id, name: user.name, email: user.email, role: req.role,
        // Whether this student has created parent access (Option B: hash presence).
        parentLinked: !!user.parentPasswordHash,
        photoUrl: user.photoUrl || null // Phase 7.5 (parent reads this via Option B)
      },
      // Phase 4: so the client re-derives the forced-change state on refresh, not
      // just from the login response. Only a parent session with the flag set.
      mustChangePassword: req.role === 'parent' && !!user.parentMustChangePassword
    });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Server error fetching user profile.' });
  }
});

// POST /api/auth/parent/generate (Phase 3) — a STUDENT creates/regenerates parent
// access for their own account. Generates a word-based temp password, stores only
// its bcrypt hash, forces a change on the parent's first login, and returns the
// plaintext ONCE (shown in the dashboard to share). The plaintext is NEVER logged
// or persisted. Parent logs in with the SAME email + this temp password.
router.post('/parent/generate', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const tempPassword = generateTempPassword();
    user.parentPasswordHash = await bcrypt.hash(tempPassword, 10);
    user.parentMustChangePassword = true;
    await user.save();

    // Return the plaintext exactly once. Do NOT log it anywhere.
    res.json({
      email: user.email,        // parent logs in with the student's email
      tempPassword,             // shown once; only the hash is persisted
      parentLinked: true
    });
  } catch (error) {
    console.error('Parent access generation error:', error.message); // never include tempPassword
    res.status(500).json({ error: 'Server error creating parent access.' });
  }
});

// POST /api/auth/change-password (Phase 4) — any logged-in session changes its OWN
// password. Re-verifies the current password before allowing the change, enforces
// the password policy on the new one, and hashes with bcrypt. Which hash is read
// and written depends on the SESSION role (Option B: one document, two hashes):
//   - student session → passwordHash
//   - parent session  → parentPasswordHash (and clears parentMustChangePassword,
//                        which is how the forced-change gate is satisfied)
// Admin sessions (Phase 6) manage credentials via env config, not here.
// This endpoint lives under /api/auth, so the parent-password gate never blocks it.
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required.' });
    }

    if (req.role === 'admin') {
      return res.status(403).json({ error: 'Admin credentials are managed via server configuration.' });
    }

    const isParent = req.role === 'parent';
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const currentHash = isParent ? user.parentPasswordHash : user.passwordHash;
    if (!currentHash || !(await bcrypt.compare(currentPassword, currentHash))) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const check = validatePassword(newPassword);
    if (!check.valid) {
      return res.status(400).json({ error: passwordErrorMessage(check.errors) });
    }

    // Disallow a no-op change (also stops a parent "satisfying" the forced change
    // by re-entering the temp password).
    if (await bcrypt.compare(newPassword, currentHash)) {
      return res.status(400).json({ error: 'New password must be different from the current password.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    if (isParent) {
      user.parentPasswordHash = newHash;
      user.parentMustChangePassword = false; // forced-change satisfied
    } else {
      user.passwordHash = newHash;
    }
    await user.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error.message); // never log passwords
    res.status(500).json({ error: 'Server error changing password.' });
  }
});

// PATCH /api/auth/profile (Phase 7) — a STUDENT edits their own name and/or email.
// Password changes go through /change-password (unchanged). Only students edit the
// profile (the account is theirs); parents/admin are read-only.
//
// Email is the login identity for BOTH the student and — via Option B — their
// linked parent (same email on the same document). So changing it:
//   - REQUIRES current-password re-verification (matches change-password),
//   - is checked for uniqueness server-side (clean 400, not a Mongo 500),
//   - atomically becomes the parent's login email too (the client warns the
//     student of this when a parent is linked).
// NOTE / accepted limitation: there is no email-VERIFICATION system, so a student
// can set a typo'd or someone-else's address with no proof of ownership. The
// client's double-entry field is only a typo guard, not verification.
router.patch('/profile', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { name, email, currentPassword } = req.body || {};
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let changed = false;

    // Name (low-stakes: no password required).
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty.' });
      if (trimmed.length > 80) return res.status(400).json({ error: 'Name is too long (max 80 characters).' });
      if (trimmed !== user.name) { user.name = trimmed; changed = true; }
    }

    // Email (sensitive: login identity for student AND parent).
    if (email !== undefined) {
      const normalized = String(email).trim().toLowerCase();
      if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (normalized !== user.email) {
        // Changing the login identity requires re-verifying the current password.
        if (!currentPassword || !(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
          return res.status(400).json({ error: 'Current password is incorrect.' });
        }
        // Server-side uniqueness (clean 400 rather than a duplicate-key 500).
        const taken = await User.findOne({ email: normalized, _id: { $ne: user._id } }).select('_id');
        if (taken) {
          return res.status(400).json({ error: 'That email is already in use.' });
        }
        user.email = normalized;
        changed = true;
      }
    }

    if (!changed) {
      return res.status(400).json({ error: 'No changes to save.' });
    }

    try {
      await user.save();
    } catch (err) {
      // Belt-and-suspenders: a race between the uniqueness check and save could
      // still trip the unique index — surface it as a clean 400, not a 500.
      if (err && err.code === 11000) {
        return res.status(400).json({ error: 'That email is already in use.' });
      }
      throw err;
    }

    res.json({
      user: {
        id: user._id, name: user.name, email: user.email, role: user.role,
        parentLinked: !!user.parentPasswordHash, photoUrl: user.photoUrl || null
      }
    });
  } catch (error) {
    console.error('Profile update error:', error.message);
    res.status(500).json({ error: 'Server error updating profile.' });
  }
});

// POST /api/auth/profile/photo (Phase 7.5) — a STUDENT uploads/replaces their own
// avatar. The image goes to OUR server first (never client→Cloudinary directly),
// is validated by its real magic bytes (not the spoofable extension/Content-Type),
// capped at 2MB, then uploaded to Cloudinary (which resizes + strips EXIF). Only
// the resulting URL is stored on the User document.
router.post('/profile/photo', authMiddleware, requireRole('student'), handlePhotoUpload, async (req, res) => {
  try {
    if (!cloudinaryConfigured) {
      return res.status(503).json({ error: 'Photo upload is not configured on the server.' });
    }
    if (!req.file || !req.file.buffer || req.file.size === 0) {
      return res.status(400).json({ error: 'No image file provided.' });
    }
    // Real content-type from the bytes — rejects a renamed non-image.
    const mime = sniffImageMime(req.file.buffer);
    if (!mime) {
      return res.status(400).json({ error: 'Unsupported image. Use a JPEG, PNG, or WebP file.' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Deterministic public_id → overwrites in place, so no orphaned assets.
    const url = await uploadProfilePhoto(user._id.toString(), req.file.buffer);
    user.photoUrl = url;
    await user.save();

    res.json({ photoUrl: url });
  } catch (error) {
    console.error('Profile photo upload error:', error.message);
    res.status(500).json({ error: 'Server error uploading photo.' });
  }
});

// DELETE /api/auth/profile/photo (Phase 7.5) — remove the student's own avatar
// (Cloudinary asset + the stored URL); the UI falls back to the generic icon.
router.delete('/profile/photo', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (cloudinaryConfigured && user.photoUrl) {
      try {
        await deleteProfilePhoto(user._id.toString());
      } catch (e) {
        console.warn('Cloudinary destroy failed (continuing):', e.message);
      }
    }
    user.photoUrl = null;
    await user.save();
    res.json({ photoUrl: null });
  } catch (error) {
    console.error('Profile photo delete error:', error.message);
    res.status(500).json({ error: 'Server error removing photo.' });
  }
});

export default router;
