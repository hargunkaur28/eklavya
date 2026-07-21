import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import Roadmap from '../models/Roadmap.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { computeWeakTopics } from '../utils/weakTopics.js';
import { createFailureRateLimiter } from '../utils/rateLimiter.js';
import { getAdminCreds, setAdminCreds } from '../utils/adminCreds.js';
import { validatePassword, passwordErrorMessage } from '../utils/validatePassword.js';

// Phase 6: admin panel. The admin is NOT a User document — it is configured
// entirely from the environment (ADMIN_EMAIL / ADMIN_PASSWORD_HASH / ADMIN_
// SECURITY_CODE). The admin JWT carries { role:'admin' } and NO userId, so it
// cannot address any student's per-userId data through the normal endpoints. This
// router is read-only: it exposes parent-linkage status and, per student, exactly
// what a parent can see (roadmaps, weak topics, activity) — nothing more.
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_TOKEN_TTL = process.env.ADMIN_TOKEN_TTL || '2h';

// Stricter than the student login (5 vs 10) — the single known admin account is
// the highest-value brute-force target in the app.
const adminLoginLimiter = createFailureRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

const adminEnabled = () => !!process.env.ADMIN_EMAIL;

// Feature gate: when admin isn't configured, the whole surface 404s (looks absent).
function requireAdminEnabled(req, res, next) {
  if (!adminEnabled()) return res.status(404).json({ error: 'Not found.' });
  next();
}

// Length-safe constant-time string compare (timingSafeEqual throws on length
// mismatch, which itself would leak length — so gate on length first, in a way
// that doesn't short-circuit the rest of the credential check).
function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// POST /api/admin/login — email + password + security code checked TOGETHER, one
// generic error regardless of which failed (no factor-leak).
router.post('/login', requireAdminEnabled, async (req, res) => {
  try {
    if (adminLoginLimiter.isLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    const { email, password, securityCode } = req.body || {};
    const creds = await getAdminCreds(); // DB override, else env bootstrap

    // Evaluate all three factors, then AND — never early-return per factor, so a
    // wrong email/password/code can't be told apart. Compared with a constant-time
    // equality check.
    const emailOk = safeEqual((email || '').toLowerCase(), (creds.email || '').toLowerCase());
    const passwordOk = safeEqual(String(password || ''), String(creds.password || ''));
    const codeOk = safeEqual(String(securityCode || ''), String(creds.securityCode || ''));

    if (!(emailOk && passwordOk && codeOk)) {
      adminLoginLimiter.record(req.ip);
      return res.status(401).json({ error: 'Invalid admin credentials.' }); // generic
    }

    // No userId in the token — admin is not a user and cannot own user data.
    const token = jwt.sign({ role: 'admin', adm: true }, JWT_SECRET, { expiresIn: ADMIN_TOKEN_TTL });
    res.json({ token, user: { id: null, name: 'Admin', email: creds.email, role: 'admin' } });
  } catch (error) {
    console.error('Admin login error:', error.message); // never log credentials
    res.status(500).json({ error: 'Server error during admin login.' });
  }
});

// POST /api/admin/precheck — lets the regular /login page decide whether to reveal
// the admin security-code field. Returns { needsCode:true } ONLY when both the
// admin email AND password match. This is intentionally a password oracle (the UX
// reveals the code field once the password is right), so admin-email attempts are
// rate-limited (shared with the login limiter). Non-admin emails return quietly
// without touching the limiter, so ordinary failed student logins don't pollute it.
router.post('/precheck', requireAdminEnabled, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const creds = await getAdminCreds();
    const emailOk = safeEqual((email || '').toLowerCase(), (creds.email || '').toLowerCase());
    if (!emailOk) return res.json({ needsCode: false });

    if (adminLoginLimiter.isLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    const passwordOk = safeEqual(String(password || ''), String(creds.password || ''));
    if (!passwordOk) {
      adminLoginLimiter.record(req.ip);
      return res.json({ needsCode: false });
    }
    return res.json({ needsCode: true });
  } catch (error) {
    console.error('Admin precheck error:', error.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Every read below requires a valid admin token. Order: feature-gate → auth → role.
const adminOnly = [requireAdminEnabled, authMiddleware, requireRole('admin')];

// PATCH /api/admin/credentials — admin changes its own email / password / security
// code. The CURRENT security code must be supplied and verified before any change
// (it's the second factor that authorizes credential edits). New values are
// persisted as a DB override (AdminConfig) so they survive restarts.
router.patch('/credentials', ...adminOnly, async (req, res) => {
  try {
    const { currentSecurityCode, newEmail, newPassword, newSecurityCode } = req.body || {};
    const creds = await getAdminCreds();

    if (!currentSecurityCode || !safeEqual(String(currentSecurityCode), String(creds.securityCode || ''))) {
      return res.status(403).json({ error: 'Security code is incorrect.' });
    }

    const update = {};
    if (newEmail !== undefined && newEmail !== '') {
      const normalized = String(newEmail).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      update.email = normalized;
    }
    if (newPassword !== undefined && newPassword !== '') {
      const check = validatePassword(newPassword);
      if (!check.valid) return res.status(400).json({ error: passwordErrorMessage(check.errors) });
      update.password = String(newPassword);
    }
    if (newSecurityCode !== undefined && newSecurityCode !== '') {
      if (String(newSecurityCode).length < 6) {
        return res.status(400).json({ error: 'Security code must be at least 6 characters.' });
      }
      update.securityCode = String(newSecurityCode);
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No changes to save.' });
    }

    await setAdminCreds(update);
    // Never echo the password/code back.
    res.json({ success: true, email: update.email || creds.email });
  } catch (error) {
    console.error('Admin credentials update error:', error.message);
    res.status(500).json({ error: 'Server error updating admin credentials.' });
  }
});

// Matches "is a student" robustly: role 'student' OR a legacy doc created before
// the role field existed (no stored role). Defensive — the data was backfilled,
// but this keeps the admin views correct even if a roleless doc ever appears.
const STUDENT_FILTER = { $or: [{ role: 'student' }, { role: { $exists: false } }] };

// GET /api/admin/parent-links — the one genuinely new query: parent-linkage
// status across all students (has a parent login been created; is it still on the
// temporary password). No passwords/hashes ever leave the server.
router.get('/parent-links', adminOnly, async (req, res) => {
  try {
    const students = await User.find(STUDENT_FILTER)
      .select('name email parentPasswordHash parentMustChangePassword createdAt')
      .sort({ createdAt: -1 });
    res.json({
      students: students.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        parentLinked: !!u.parentPasswordHash,
        parentPending: !!u.parentMustChangePassword, // temp password not yet changed
        createdAt: u.createdAt
      }))
    });
  } catch (error) {
    console.error('Admin parent-links error:', error.message);
    res.status(500).json({ error: 'Server error fetching parent links.' });
  }
});

// GET /api/admin/student/:studentId — that student's active roadmaps (reuses the
// /roadmap/list query, scoped by the path param instead of req.userId).
router.get('/student/:studentId', adminOnly, async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.studentId, ...STUDENT_FILTER }).select('name email photoUrl');
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    const roadmaps = await Roadmap.find({ userId: req.params.studentId, archived: { $ne: true } })
      .sort({ createdAt: -1 });
    res.json({ student: { id: student._id, name: student.name, email: student.email, photoUrl: student.photoUrl || null }, roadmaps });
  } catch (error) {
    console.error('Admin student view error:', error.message);
    res.status(500).json({ error: 'Server error fetching student.' });
  }
});

// GET /api/admin/student/:studentId/roadmap/:roadmapId/weak-topics — reuses the
// shared aggregation, read-only (allowSave:false → never mutates the doc).
router.get('/student/:studentId/roadmap/:roadmapId/weak-topics', adminOnly, async (req, res) => {
  try {
    const roadmap = await Roadmap.findOne({ _id: req.params.roadmapId, userId: req.params.studentId });
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found.' });
    const result = await computeWeakTopics(roadmap, { isHindi: req.query.lang === 'hi', allowSave: false });
    res.json(result);
  } catch (error) {
    console.error('Admin weak-topics error:', error.message);
    res.status(500).json({ error: 'Server error computing weak topics.' });
  }
});

// GET /api/admin/student/:studentId/activity — that student's study dates (reuses
// the /activity query, scoped by the path param).
router.get('/student/:studentId/activity', adminOnly, async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId).select('studyDates');
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    res.json({ studyDates: (student.studyDates || []).slice().sort() });
  } catch (error) {
    console.error('Admin activity error:', error.message);
    res.status(500).json({ error: 'Server error fetching activity.' });
  }
});

export default router;
