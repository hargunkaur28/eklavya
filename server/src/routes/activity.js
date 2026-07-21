import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// GET /api/activity (Phase 8) — the account-wide study-activity dates. Streaks
// are computed client-side from these local dates (browser-local day boundaries).
router.get('/', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('studyDates');
    res.json({ studyDates: (user?.studyDates || []).slice().sort() });
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ error: 'Server error fetching activity.' });
  }
});

export default router;
