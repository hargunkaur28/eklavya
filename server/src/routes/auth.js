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
import crypto from 'crypto';
import PasswordResetOtp from '../models/PasswordResetOtp.js';
import { sendEmail } from '../utils/sendEmail.js';
import { buildOtpEmail } from '../utils/emailTemplates.js';
// Workstream B: Aadhaar is encrypted at the request boundary; there is no decrypt.
import { encryptAadhaar, lastFourOf, aadhaarCollectionEnabled } from '../utils/aadhaarCrypto.js';
import { validateCompulsory, validatePhone, validateLocation, validateAadhaar, STUDY_MEDIUMS } from '../utils/validateProfile.js';
import { maskAadhaar } from '../utils/verhoeff.js';
import { reverseGeocode, validCoords } from '../utils/reverseGeocode.js';
import { isKnownBoard, canonicalBoard } from '../config/taxonomy.js';
// Admin identity for GET /me. The admin has no User document, so its email comes
// from the same source /api/admin/login reads (DB override, else env bootstrap)
// rather than from process.env directly — an admin who changed their email must not
// see the stale one after a refresh.
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

/**
 * The ONLY shape in which a profile leaves the server — for the student, a parent,
 * an admin, or `GET /me`. Aadhaar appears as `XXXX XXXX 1234` and nothing else:
 * there is no branch, no role check, and no query parameter that yields the number,
 * because the number is not readable at all (no decrypt exists).
 *
 * Built by ENUMERATING allowed fields rather than deleting disallowed ones, so a
 * field added to the schema later is invisible here until it is added on purpose.
 */
/**
 * The ONE user shape returned by /signup, /login and /me.
 *
 * These three drifted, and that is precisely how a real bug shipped: the signup payload
 * omitted `onboardingCompleted` while the other two returned it. The client gate is
 * `onboardingCompleted === false` — strict on purpose, so a legacy session whose field
 * is absent is never trapped in a flow it already finished — which makes ABSENCE and
 * FALSE behave OPPOSITELY. A brand-new student therefore arrived with `undefined`,
 * `undefined === false` is false, and signup walked straight past the profile flow into
 * subject selection. Every existing check passed, because they all read /me.
 *
 * Keep all three going through here. `test:authshape` fails the build if their key
 * sets diverge, so a field added to one and not the others cannot ship the same way.
 */
function sessionUser(user, sessionRole = 'student') {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: sessionRole,
    parentLinked: !!user.parentPasswordHash,
    photoUrl: user.photoUrl || null,
    narrationLanguagePref: user.narrationLanguagePref || 'hindi',
    autoNarrateQuizzes: !!user.autoNarrateQuizzes,
    hasSeenNarrationPrompt: !!user.hasSeenNarrationPrompt,
    siteLanguage: user.siteLanguage || 'en',
    onboardingCompleted: !!user.onboardingCompleted,
    // Aadhaar is MASKED here, as everywhere. No role sees the real number.
    profile: publicProfile(user, sessionRole)
  };
}

function publicProfile(user, sessionRole = 'student') {
  const p = user?.profile || {};

  // Under Option B a parent shares the student's User document, so every field here
  // is reachable from a parent session — and admin renders shared chrome too. The
  // student consented to Aadhaar for VERIFICATION, not for family visibility, so a
  // parent seeing "XXXX XXXX 0124" is a disclosure they never agreed to. Admin is
  // specified as parent-linkage status only. The Aadhaar keys are therefore OMITTED
  // ENTIRELY for non-student sessions rather than blanked — an absent key cannot be
  // rendered by a client that forgets to check the role.
  const isStudent = sessionRole === 'student';

  return {
    age: p.age ?? null,
    studyMedium: p.studyMedium || '',
    // Workstream H. ALWAYS a real boolean, never conditionally omitted — the
    // onboardingCompleted bug (see test-auth-payload-shape.mjs) was exactly this
    // shape of field going absent on one route, and `undefined` reads as falsy while
    // meaning "unknown". `legacyStudyMedium` is deliberately NOT returned: it is an
    // audit record, and shipping it to the client invites a well-meaning fallback
    // that renders the unserved board back into the UI.
    boardNeedsReselect: !!p.boardNeedsReselect,
    fatherName: p.fatherName || '',
    schoolName: p.schoolName || '',
    schoolCity: p.schoolCity || '',
    phoneNumber: p.phoneNumber || '',
    location: {
      village: p.location?.village || '',
      city: p.location?.city || '',
      state: p.location?.state || ''
    },
    // Masked only, and STUDENT-ONLY. `aadhaarLast4` is the sole plaintext digit data
    // stored; even the masked form is withheld from parent and admin sessions.
    ...(isStudent ? {
      aadhaarMasked: maskAadhaar(p.aadhaarLast4),
      aadhaarOnFile: !!p.aadhaarLast4,
      aadhaarConsentAt: p.aadhaarConsentAt || null
    } : {})
  };
}

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
      user: sessionUser(user, user.role)
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
      // Same shape as /signup and /me — the onboarding gate resolves on this response
      // rather than flashing the dashboard until /me lands.
      user: sessionUser(user, sessionRole),
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
    //
    // THIS BRANCH USED TO THROW ON EVERY CALL. It read `sessionUser(user, req.role)`,
    // but `user` is declared with `const` BELOW — so the reference sat in the
    // temporal dead zone and raised "Cannot access 'user' before initialization",
    // which the catch turned into a 500.
    //
    // The user-visible effect was that an admin was logged out by every page
    // refresh: the client's session-restore calls /auth/me, and its `else` branch
    // treats ANY non-ok response as an invalid token and clears it. A 500 and a
    // genuinely expired token were indistinguishable to it, so a server bug
    // presented as an auth problem. Nothing in the admin panel could work across a
    // reload.
    //
    // The shape below deliberately MATCHES what POST /api/admin/login returns, so
    // login and refresh agree on the session object — the same rule
    // test-auth-payload-shape.mjs exists to enforce for students.
    if (req.role === 'admin') {
      const adminCreds = await getAdminCreds();
      return res.json({
        user: { id: null, name: 'Admin', email: adminCreds.email, role: 'admin' },
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
        photoUrl: user.photoUrl || null, // Phase 7.5 (parent reads this via Option B)
        // Narration/voice prefs — client hydrates these on login/refresh.
        narrationLanguagePref: user.narrationLanguagePref || 'hindi',
        autoNarrateQuizzes: !!user.autoNarrateQuizzes,
        hasSeenNarrationPrompt: !!user.hasSeenNarrationPrompt,
        siteLanguage: user.siteLanguage || 'en',
        // Workstream B: drives the ProtectedRoute onboarding gate. Only meaningful
        // for a student session — parents/admins are excluded client-side too,
        // because Option B means they share this document.
        onboardingCompleted: !!user.onboardingCompleted,
        // Aadhaar is MASKED here, as everywhere. No role sees the real number.
        profile: publicProfile(user, req.role)
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

// Nominatim's usage policy caps request volume, and this endpoint is the only thing
// that can reach it, so the limit is enforced per user here rather than globally.
// Reuses the shared limiter (utils/rateLimiter.js) — 10 lookups / 5 minutes is
// generous for a one-off onboarding step and cheap for a student who taps twice.
const geocodeLimiter = createFailureRateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });

// POST /api/auth/reverse-geocode (Workstream B3)
//
// Takes coordinates, returns ONLY { village, city, state }. The coordinates are
// discarded when this handler returns: they are not stored (the schema has no field
// for them), not echoed back, and not logged on any path. Student-only.
router.post('/reverse-geocode', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    if (geocodeLimiter.isLimited(req.userId)) {
      return res.status(429).json({ error: 'GEOCODE_RATE_LIMITED' });
    }

    const lat = Number(req.body?.latitude);
    const lon = Number(req.body?.longitude);
    if (!validCoords(lat, lon)) {
      // Note the absence of the received values in this message.
      return res.status(400).json({ error: 'GEOCODE_COORDS_INVALID' });
    }
    geocodeLimiter.record(req.userId);

    const place = await reverseGeocode(lat, lon);
    if (!place) {
      // Permission/lookup failure is not an error state for the student — the UI
      // falls back to manual entry, so this stays a 200 with a flag.
      return res.json({ resolved: false });
    }

    res.json({ resolved: true, location: place });
  } catch (error) {
    // Message only, and never req.body — it contains the coordinates.
    console.error('Reverse geocode error:', error.message);
    res.status(500).json({ error: 'GEOCODE_FAILED' });
  }
});

// GET /api/auth/profile-config — what the onboarding UI needs before rendering.
// Exists so the client can HIDE the Aadhaar step when the deployment has not
// enabled collection, rather than showing a field that is guaranteed to fail on
// submit. Public shape only: never reveals whether a key is configured.
router.get('/profile-config', authMiddleware, requireRole('student'), (req, res) => {
  res.json({
    aadhaarEnabled: aadhaarCollectionEnabled(),
    studyMediums: STUDY_MEDIUMS
  });
});

// PATCH /api/auth/profile-details (Workstream B4) — save the onboarding profile.
//
// THE REQUEST BODY IS THE LEAK PATH HERE, not the response. This body carries a
// plaintext Aadhaar number, which means:
//   - any request logger that records bodies captures it;
//   - Express's default error handler (and most custom ones) dump req.body on a 500,
//     so a validation CRASH would write Aadhaar into the logs;
//   - an error tracker added later attaches bodies by default.
// So: the whole handler is wrapped, nothing in it logs req.body or any field of it,
// validation errors name the rule and never the value, and the plaintext is
// converted to ciphertext AT THE BOUNDARY — before any Mongoose document exists —
// so there is no ordering mistake that could persist it.
router.patch('/profile-details', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const compulsory = validateCompulsory(body);
    const phone = validatePhone(body.phoneNumber);
    const location = validateLocation(body.location);
    const aadhaar = validateAadhaar(body.aadhaarNumber, body.aadhaarConsent === true, aadhaarCollectionEnabled());

    const errors = { ...compulsory.errors };
    if (!phone.ok) errors.phoneNumber = phone.error;
    if (!aadhaar.ok) errors.aadhaarNumber = aadhaar.error;

    if (Object.keys(errors).length) {
      // Field names + rules only. No submitted values are echoed back.
      // CODES, not prose — the client localises them via translations.js.
      return res.status(400).json({ error: 'PROFILE_VALIDATION_FAILED', fields: errors });
    }

    // ── The boundary. Encrypt here, then drop the plaintext. ────────────────
    // Everything below this point deals in ciphertext + last4 only, so no code
    // path — present or future — can assign the plaintext to a document.
    let aadhaarEncrypted = null;
    let aadhaarLast4 = '';
    let aadhaarConsentAt = null;
    if (aadhaar.provided) {
      try {
        aadhaarEncrypted = encryptAadhaar(aadhaar.digits);
        aadhaarLast4 = lastFourOf(aadhaar.digits);
        aadhaarConsentAt = new Date();
      } catch {
        // Never include the error's message: an encryption failure could mention
        // key material. Fixed string only.
        return res.status(503).json({ error: 'AADHAAR_ENCRYPTION_UNAVAILABLE' });
      }
    }
    // Explicitly release the only remaining handle on the plaintext.
    aadhaar.digits = '';

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.profile = user.profile || {};
    user.profile.age = Number(body.age);
    user.profile.studyMedium = String(body.studyMedium).trim();
    user.profile.fatherName = String(body.fatherName).trim();
    user.profile.schoolName = String(body.schoolName).trim();
    user.profile.schoolCity = String(body.schoolCity).trim();
    user.profile.phoneNumber = phone.value;
    user.profile.location = location.value;

    // Only overwrite Aadhaar when a new number was supplied — an edit that leaves
    // the field blank must not silently erase a previously stored number.
    if (aadhaarEncrypted) {
      user.profile.aadhaarEncrypted = aadhaarEncrypted;
      user.profile.aadhaarLast4 = aadhaarLast4;
      user.profile.aadhaarConsentAt = aadhaarConsentAt;
    }

    if (!user.onboardingCompleted) {
      user.onboardingCompleted = true;
      user.onboardingCompletedAt = new Date();
    }

    await user.save();

    res.json({
      onboardingCompleted: true,
      profile: publicProfile(user, 'student')
    });
  } catch (error) {
    // Log the message ONLY. Never the error object (some carry the request), never
    // req.body, never any field of it.
    console.error('Profile details save error:', error.message);
    res.status(500).json({ error: 'PROFILE_SAVE_FAILED' });
  }
});

// DELETE /api/auth/profile/aadhaar (Workstream B2) — CONSENT WITHDRAWAL.
//
// Required, not optional. Aadhaar was collected against an explicit consent
// checkbox, and withdrawal of consent is a right under the DPDP Act, 2023 — a
// deployment that can collect a number but not remove it is the finding that stops
// a government review.
//
// All THREE fields are unset together, deliberately:
//   • aadhaarEncrypted  — the data itself;
//   • aadhaarLast4      — a stranded last4 is still identifying;
//   • aadhaarConsentAt  — a stranded timestamp records consent for data no longer
//                         held, which is worse than no record at all.
// `$unset` rather than setting empty strings, so the document returns to exactly the
// shape of a student who never supplied one.
router.delete('/profile/aadhaar', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const result = await User.updateOne(
      { _id: req.userId },
      {
        $unset: {
          'profile.aadhaarEncrypted': '',
          'profile.aadhaarLast4': '',
          'profile.aadhaarConsentAt': ''
        }
      }
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'User not found.' });

    // No identifier of the removed data in the log — only that a removal happened.
    console.log('Aadhaar consent withdrawn and data removed for one student.');

    const user = await User.findById(req.userId);
    res.json({ removed: true, profile: publicProfile(user, 'student') });
  } catch (error) {
    console.error('Aadhaar removal error:', error.message);
    res.status(500).json({ error: 'PROFILE_SAVE_FAILED' });
  }
});

// PATCH /api/auth/profile/board (Workstream H) — answer the one-time re-select
// prompt shown to accounts migrated off a board the platform no longer serves.
//
// This is NOT a second way to edit the board. It exists because the alternative was
// making a migrated student re-run the whole five-step profile flow to change one
// field, and because PATCH /profile-details requires every compulsory field to be
// present — a prompt that only asks for a board cannot satisfy it.
//
// `dismiss` clears the flag WITHOUT setting a board. That is deliberate: a prompt
// with no way out is a modal that traps an account, and the board is still editable
// from Profile afterwards. A dismissed student keeps an empty board, which the PYQ
// UI already handles honestly (it asks them to set one) rather than pretending.
router.patch('/profile/board', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const dismiss = req.body?.dismiss === true;
    const studyMedium = typeof req.body?.studyMedium === 'string' ? req.body.studyMedium.trim() : '';

    if (!dismiss) {
      // Same closed-set check as the full profile save, by the same helper — a second
      // board validator here is how the two would eventually disagree.
      if (!studyMedium) return res.status(400).json({ error: 'BOARD_REQUIRED' });
      if (!isKnownBoard(studyMedium)) return res.status(400).json({ error: 'BOARD_NOT_SUPPORTED' });
    }

    const result = await User.updateOne({ _id: req.userId }, {
      $set: {
        ...(dismiss ? {} : { 'profile.studyMedium': canonicalBoard(studyMedium) }),
        'profile.boardNeedsReselect': false
      }
    });
    if (!result.matchedCount) return res.status(404).json({ error: 'User not found.' });

    const user = await User.findById(req.userId);
    res.json({ profile: publicProfile(user, 'student') });
  } catch (error) {
    console.error('Board re-select error:', error.message);
    res.status(500).json({ error: 'PROFILE_SAVE_FAILED' });
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

// PATCH /api/auth/preferences — a STUDENT updates their account-level narration/voice
// preferences (kept SEPARATE from /profile: low-stakes, no password gate, unrelated to
// the sensitive email-change flow). Only the three known fields are accepted; each is
// validated against its enum. Parent/admin never call this (no quiz-taking flows).
router.patch('/preferences', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { narrationLanguagePref, autoNarrateQuizzes, siteLanguage } = req.body || {};
    let changed = false;

    if (narrationLanguagePref !== undefined) {
      if (!['hindi', 'english', 'match-toggle'].includes(narrationLanguagePref)) {
        return res.status(400).json({ error: 'Invalid narrationLanguagePref.' });
      }
      user.narrationLanguagePref = narrationLanguagePref; changed = true;
    }
    if (autoNarrateQuizzes !== undefined) {
      if (typeof autoNarrateQuizzes !== 'boolean') {
        return res.status(400).json({ error: 'autoNarrateQuizzes must be a boolean.' });
      }
      user.autoNarrateQuizzes = autoNarrateQuizzes; changed = true;
    }
    if (req.body.hasSeenNarrationPrompt !== undefined) {
      if (typeof req.body.hasSeenNarrationPrompt !== 'boolean') {
        return res.status(400).json({ error: 'hasSeenNarrationPrompt must be a boolean.' });
      }
      user.hasSeenNarrationPrompt = req.body.hasSeenNarrationPrompt; changed = true;
    }
    if (siteLanguage !== undefined) {
      if (!['en', 'hi'].includes(siteLanguage)) {
        return res.status(400).json({ error: 'Invalid siteLanguage.' });
      }
      user.siteLanguage = siteLanguage; changed = true;
    }

    if (!changed) return res.status(400).json({ error: 'No preference changes to save.' });
    await user.save();

    res.json({
      preferences: {
        narrationLanguagePref: user.narrationLanguagePref,
        autoNarrateQuizzes: user.autoNarrateQuizzes,
        hasSeenNarrationPrompt: user.hasSeenNarrationPrompt,
        siteLanguage: user.siteLanguage
      }
    });
  } catch (error) {
    console.error('Preferences update error:', error.message);
    res.status(500).json({ error: 'Server error updating preferences.' });
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

// POST /api/auth/forgot-password — Request a 6-digit numeric OTP sent via Brevo to the student's email address
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, accountType = 'student' } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      // Generic message to prevent account enumeration
      return res.json({ message: 'If an account exists with this email, a verification code (OTP) has been sent.' });
    }

    // Rate-limit: Max 3 OTP requests per 15 minutes per account
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentCount = await PasswordResetOtp.countDocuments({ email: cleanEmail, createdAt: { $gte: fifteenMinsAgo } });
    if (recentCount >= 3) {
      return res.status(429).json({ error: 'Too many password reset requests. Please try again in 15 minutes.' });
    }

    // Generate 6-digit numeric OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    // Remove existing OTP for this email & role
    await PasswordResetOtp.deleteMany({ email: cleanEmail, accountType });

    // Store new hashed OTP valid for 10 minutes
    await PasswordResetOtp.create({
      email: cleanEmail,
      otpHash,
      accountType,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    // Build & send email via Brevo
    const htmlContent = buildOtpEmail({ studentName: user.name, otp, expiryMinutes: 10 });
    const sendResult = await sendEmail({
      to: cleanEmail,
      subject: 'Project Eklavya — Password Reset Verification Code',
      htmlContent
    });

    if (!sendResult.success && !sendResult.simulated) {
      return res.status(502).json({ error: 'Failed to send OTP email. Please try again later.' });
    }

    res.json({ message: 'If an account exists with this email, a verification code (OTP) has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error.message);
    res.status(500).json({ error: 'Server error processing forgot password request.' });
  }
});

// POST /api/auth/verify-otp — Verify 6-digit OTP and issue 10-minute password reset token
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, accountType = 'student' } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP verification code are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const otpDoc = await PasswordResetOtp.findOne({ email: cleanEmail, accountType });

    if (!otpDoc || new Date(otpDoc.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired or is invalid. Please request a new code.' });
    }

    // Max 5 attempts per OTP
    if (otpDoc.attempts >= 5) {
      return res.status(429).json({ error: 'Too many incorrect OTP attempts. Please request a new verification code.' });
    }

    const incomingHash = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
    if (incomingHash !== otpDoc.otpHash) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      return res.status(400).json({ error: 'Incorrect verification code. Please check and try again.' });
    }

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    // Delete OTP document after successful verification
    await PasswordResetOtp.deleteOne({ _id: otpDoc._id });

    // Issue short-lived password reset JWT token (10 minutes)
    const resetToken = jwt.sign(
      { userId: user._id, email: user.email, accountType, purpose: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '10m' }
    );

    res.json({ resetToken, message: 'OTP verified successfully.' });
  } catch (error) {
    console.error('Verify OTP error:', error.message);
    res.status(500).json({ error: 'Server error verifying OTP.' });
  }
});

// POST /api/auth/reset-password — Accept reset token + new password and update account password
router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body || {};
    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch {
      return res.status(400).json({ error: 'Reset token has expired or is invalid. Please request a new OTP.' });
    }

    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({ error: 'Invalid reset token purpose.' });
    }

    // Validate password policy
    const check = validatePassword(newPassword);
    if (!check.valid) {
      return res.status(400).json({ error: passwordErrorMessage(check.errors) });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    if (decoded.accountType === 'parent') {
      user.parentPasswordHash = newHash;
      user.parentMustChangePassword = false;
    } else {
      user.passwordHash = newHash;
    }

    await user.save();
    res.json({ message: 'Password updated successfully! You can now log in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error.message);
    res.status(500).json({ error: 'Server error resetting password.' });
  }
});

export default router;
