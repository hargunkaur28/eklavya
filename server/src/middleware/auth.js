import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No authentication token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    // Phase 2 backward-compat: tokens issued BEFORE roles existed (they live
    // 30-90 days) have no `role`. Default them to 'student' — the correct, safe
    // default — so existing sessions keep working instead of breaking on the
    // first role-gated request. requireRole() below always reads this value.
    req.role = decoded.role || 'student';
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

// Phase 2: reusable role gate. MUST run AFTER authMiddleware (which sets req.role).
// Usage: router.get('/x', authMiddleware, requireRole('admin'), handler)
//        router.get('/y', authMiddleware, requireRole(['parent', 'admin']), handler)
export function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.role || !allowed.includes(req.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions.' });
    }
    next();
  };
}

// Phase 4: gate that blocks a PARENT session from reaching data endpoints until
// they've replaced their temporary password. Mounted app-wide over the data
// routers (NOT /api/auth, so login / me / change-password stay reachable). It
// decodes the token leniently — a missing/invalid token falls through to each
// route's own authMiddleware (which returns 401). Only a valid PARENT token whose
// account still has parentMustChangePassword set is blocked, with a machine-
// readable code so the client can route to the change-password screen. This is
// SERVER-SIDE enforcement, not just a frontend redirect.
export async function parentPasswordChangeGate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    return next(); // invalid/expired — let the route's authMiddleware 401 it
  }

  if ((decoded.role || 'student') !== 'parent') return next();

  try {
    const user = await User.findById(decoded.userId).select('parentMustChangePassword');
    if (user && user.parentMustChangePassword) {
      return res.status(403).json({
        error: 'Set your own password before continuing.',
        code: 'PASSWORD_CHANGE_REQUIRED'
      });
    }
  } catch {
    // Lookup failure: fall through to the route (its own auth still applies).
  }
  next();
}
