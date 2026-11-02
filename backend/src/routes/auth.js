const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const schemas = require('../utils/schemas');
const { signToken } = require('../middleware/auth');
const rl = require('../middleware/rateLimit');
const { conflict, unauthorized, badRequest } = require('../utils/errors');
const { sendVerificationEmail } = require('../services/emailService');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

router.post('/signup', rl.auth, async (req, res) => {
  const data = schemas.signup.parse(req.body);
  const hash = await bcrypt.hash(data.password, 10);
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry

  try {
    // Check if user already exists
    const { rows: existingRows } = await db.query('SELECT id, is_verified FROM users WHERE email = $1', [data.email]);
    let user;

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (existing.is_verified) {
        throw conflict('An account with this email already exists');
      }
      // If user exists but is unverified, update their details & new OTP
      const { rows } = await db.query(
        `UPDATE users
            SET name = $1, password_hash = $2, phone = $3, verification_otp = $4, otp_expires_at = $5, updated_at = now()
          WHERE id = $6
        RETURNING id, name, email, phone, role`,
        [data.name, hash, data.phone || null, otp, expiresAt, existing.id]
      );
      user = rows[0];
    } else {
      // Insert new unverified user
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash, phone, is_verified, verification_otp, otp_expires_at)
         VALUES ($1, $2, $3, $4, FALSE, $5, $6)
         RETURNING id, name, email, phone, role`,
        [data.name, data.email, hash, data.phone || null, otp, expiresAt]
      );
      user = rows[0];
    }

    // Send verification email
    try {
      await sendVerificationEmail(data.email, data.name, otp);
    } catch (mailErr) {
      // Don't fail the registration if email sending temporarily fails, but report
      console.error('Failed to send verification email:', mailErr.message);
    }

    res.status(201).json({
      message: 'Verification code sent to your email. Please verify before logging in.',
      email: data.email,
      requires_verification: true,
    });
  } catch (err) {
    if (err.code === '23505') throw conflict('An account with this email already exists');
    throw err;
  }
});

// Verify OTP endpoint
router.post('/verify-otp', rl.auth, async (req, res) => {
  const data = schemas.verifyOtp.parse(req.body);
  const { rows } = await db.query(
    'SELECT id, name, email, phone, role, is_verified, verification_otp, otp_expires_at FROM users WHERE email = $1',
    [data.email]
  );
  const user = rows[0];

  if (!user) throw badRequest('No account found for this email');
  if (user.is_verified) {
    return res.json({ message: 'Email already verified. You can now log in.' });
  }

  if (!user.verification_otp || user.verification_otp !== data.otp) {
    throw badRequest('Invalid verification code. Please check and try again.');
  }

  if (new Date() > new Date(user.otp_expires_at)) {
    throw badRequest('Verification code has expired. Please request a new code.');
  }

  // Mark verified and clear OTP
  await db.query(
    `UPDATE users
        SET is_verified = TRUE, verification_otp = NULL, otp_expires_at = NULL, updated_at = now()
      WHERE id = $1`,
    [user.id]
  );

  res.json({
    message: 'Email successfully verified! You can now log in.',
    verified: true,
  });
});

// Resend OTP endpoint
router.post('/resend-otp', rl.auth, async (req, res) => {
  const data = schemas.resendOtp.parse(req.body);
  const { rows } = await db.query(
    'SELECT id, name, email, is_verified FROM users WHERE email = $1',
    [data.email]
  );
  const user = rows[0];

  if (!user) throw badRequest('No account found for this email');
  if (user.is_verified) {
    return res.json({ message: 'Email is already verified.' });
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.query(
    'UPDATE users SET verification_otp = $1, otp_expires_at = $2, updated_at = now() WHERE id = $3',
    [otp, expiresAt, user.id]
  );

  await sendVerificationEmail(user.email, user.name, otp);

  res.json({ message: 'New verification code has been sent to your email.' });
});

// Constant-ish time: always run bcrypt compare even for unknown emails
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.JpWdGZ2ZpJz8kqk5rJ6y4Xq2pQ7K';
router.post('/login', rl.auth, async (req, res) => {
  const data = schemas.login.parse(req.body);
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [data.email]);
  const user = rows[0];
  const ok = await bcrypt.compare(data.password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  if (user.is_banned) throw unauthorized('Account is banned');

  // Check if email has been verified
  if (user.is_verified === false) {
    return res.status(403).json({
      error: {
        code: 'unverified_email',
        message: 'Your email address has not been verified yet. Please enter the verification code sent to your email.',
        email: user.email,
        requires_verification: true,
      },
    });
  }

  res.json({ user: publicUser(user), token: signToken(user) });
});

module.exports = router;
