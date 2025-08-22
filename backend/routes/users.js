const express = require('express');
const User = require('../models/User');
const router = express.Router();

// GET /api/users/search?username=abc
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.username || '').toLowerCase();
    if (!q) return res.json([]);
    // search begins with or contains
    const users = await User.find({ username: { $regex: q, $options: 'i' } })
      .select('_id username email')
      .limit(20);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// GET /api/users/me
router.get('/me', async (req, res) => {
  const user = await User.findById(req.user.id).select('_id username email');
  res.json(user);
});

module.exports = router;
