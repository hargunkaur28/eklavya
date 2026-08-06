import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import Roadmap from '../models/Roadmap.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { computeWeakTopics } from '../utils/weakTopics.js';
import { createFailureRateLimiter } from '../utils/rateLimiter.js';
import { getAdminCreds, setAdminCreds } from '../utils/adminCreds.js';
import AdminConfig from '../models/AdminConfig.js';
import { sendEmail } from '../utils/sendEmail.js';
import { buildFailedLoginAlertEmail } from '../utils/emailTemplates.js';
import { validatePassword, passwordErrorMessage } from '../utils/validatePassword.js';
import { getMentorMaxGrade, gradeIndex } from '../utils/mentorConfig.js';
import { GRADES } from '../config/taxonomy.js';

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
// generic error regardless of which failed (no factor-leak). Enforces persistent 5-attempt / 2-min DB lockout & sends Brevo alert email.
router.post('/login', requireAdminEnabled, async (req, res) => {
  try {
    const creds = await getAdminCreds(); // DB override, else env bootstrap
    const now = new Date();

    // Check DB Lockout state
    if (creds.lockedUntil && new Date(creds.lockedUntil) > now) {
      const remainingMs = new Date(creds.lockedUntil) - now;
      const remainingMins = Math.ceil(remainingMs / (60 * 1000));
      return res.status(429).json({
        error: `Account temporarily locked. Please try again in ${remainingMins} minute${remainingMins > 1 ? 's' : ''}.`
      });
    }

    const { email, password, securityCode } = req.body || {};

    const emailOk = safeEqual((email || '').toLowerCase(), (creds.email || '').toLowerCase());
    const passwordOk = safeEqual(String(password || ''), String(creds.password || ''));
    const codeOk = safeEqual(String(securityCode || ''), String(creds.securityCode || ''));

    if (!(emailOk && passwordOk && codeOk)) {
      adminLoginLimiter.record(req.ip);

      const newAttempts = (creds.failedLoginAttempts || 0) + 1;
      let lockedUntil = null;
      if (newAttempts >= 5) {
        lockedUntil = new Date(Date.now() + 2 * 60 * 1000); // 2-minute lockout
      }

      await AdminConfig.findOneAndUpdate(
        { singleton: 'admin' },
        { $set: { failedLoginAttempts: newAttempts, lockedUntil } },
        { upsert: true }
      );

      const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1';
      const browser = req.headers['user-agent'] || 'Unknown Browser';
      const istTimestamp = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'full',
        timeStyle: 'medium'
      }) + ' (IST)';

      const alertHtml = buildFailedLoginAlertEmail({
        account: creds.email,
        role: creds.role || 'Super Admin',
        attemptCount: newAttempts,
        ipAddress,
        timestamp: istTimestamp,
        browser
      });

      // Send Brevo Security Alert Email on every failed attempt
      try {
        await sendEmail({
          to: creds.email,
          subject: `Security Alert: Failed Login Attempt (${newAttempts}/5)`,
          htmlContent: alertHtml
        });
      } catch (err) {
        console.error('[Brevo Alert Error]:', err.message);
      }

      if (newAttempts >= 5) {
        return res.status(429).json({
          error: 'Account temporarily locked. Please try again in 2 minutes.'
        });
      }

      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    // On successful login: reset counter and clear lockout
    await AdminConfig.findOneAndUpdate(
      { singleton: 'admin' },
      { $set: { failedLoginAttempts: 0, lockedUntil: null } }
    );

    // No userId in the token — admin is not a user and cannot own user data.
    const token = jwt.sign({ role: 'admin', adm: true }, JWT_SECRET, { expiresIn: ADMIN_TOKEN_TTL });
    res.json({ token, user: { id: null, name: 'Admin', email: creds.email, role: 'admin' } });
  } catch (error) {
    console.error('Admin login error:', error);
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

// ── Feature 27: the Voice Mentor's grade ceiling ───────────────────────────
//
// "Which children cannot yet read the interface" is a question about a deployment's
// actual students, so it is a SETTING rather than a constant compiled into the client.
// Persisted in AdminConfig with the same DB-override-beats-env precedence the admin
// credentials use, because env vars are not app-editable on Render and an operator
// without deploy access could otherwise never change it.
//
// GET returns the ordered grade list alongside the current value: the admin UI renders
// a picker from the taxonomy rather than a free-text box, so an unservable value cannot
// be typed in the first place. (`getMentorMaxGrade` still refuses to honour one, since
// a stale or hand-edited document can hold anything.)
router.get('/mentor-config', adminOnly, async (req, res) => {
  try {
    res.json({ mentorMaxGrade: await getMentorMaxGrade(), grades: GRADES });
  } catch (error) {
    console.error('Admin mentor-config read error:', error.message);
    res.status(500).json({ error: 'Server error reading mentor configuration.' });
  }
});

router.patch('/mentor-config', ...adminOnly, async (req, res) => {
  try {
    const { mentorMaxGrade } = req.body || {};
    // Validated against the taxonomy, not merely against being a string. An unknown
    // grade resolves to index -1, which compares below every real grade — so a typo
    // would silently disable the mentor for EVERY student, with no error anywhere and
    // nothing in the UI to indicate why the feature had vanished.
    if (typeof mentorMaxGrade !== 'string' || gradeIndex(mentorMaxGrade) < 0) {
      return res.status(400).json({ error: 'MENTOR_GRADE_NOT_IN_TAXONOMY', grades: GRADES });
    }

    await AdminConfig.findOneAndUpdate(
      { singleton: 'admin' },
      { $set: { mentorMaxGrade, updatedAt: new Date() } },
      { upsert: true, new: true }
    );

    // Takes effect for NEW sessions. Deliberately not pushed into running ones: a
    // mentor that stops mid-sentence because an admin saved a form is, to a child,
    // indistinguishable from a mentor that broke.
    res.json({ success: true, mentorMaxGrade });
  } catch (error) {
    console.error('Admin mentor-config update error:', error.message);
    res.status(500).json({ error: 'Server error saving mentor configuration.' });
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
