const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (config.smtpUser && config.smtpPass) {
    transporter = nodemailer.createTransport({
      service: config.smtpService || 'gmail',
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });
  }
  return transporter;
}

/**
 * Send 6-digit verification code email
 * @param {string} toEmail 
 * @param {string} userName 
 * @param {string} otp 
 */
async function sendVerificationEmail(toEmail, userName, otp) {
  const mailer = getTransporter();

  const subject = `${otp} is your RentRadar email verification code`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f6f8fa; margin: 0; padding: 20px; }
        .card { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e1e4e8; padding: 32px; }
        .logo { font-size: 20px; font-weight: 700; color: #0969da; margin-bottom: 24px; display: inline-block; }
        h1 { font-size: 20px; color: #24292f; margin-top: 0; }
        p { color: #57606a; font-size: 14px; line-height: 1.5; }
        .otp-box { background: #f6f8fa; border: 2px dashed #0969da; border-radius: 8px; text-align: center; padding: 18px; margin: 24px 0; }
        .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0969da; }
        .footer { font-size: 12px; color: #8c959f; margin-top: 24px; border-top: 1px solid #eaecef; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">🏠 RentRadar</div>
        <h1>Verify your email address</h1>
        <p>Hi ${userName || 'there'},</p>
        <p>Thank you for signing up for RentRadar. To complete your registration and verify that this email belongs to you, enter the 6-digit verification code below:</p>
        
        <div class="otp-box">
          <div class="otp-code">${otp}</div>
        </div>

        <p>This code will expire in <strong>15 minutes</strong>. If you did not create an account on RentRadar, please disregard this email.</p>
        
        <div class="footer">
          RentRadar &bull; AI Rental Price Prediction & Fraud Detection Platform
        </div>
      </div>
    </body>
    </html>
  `;

  if (!mailer) {
    logger.warn(`[EMAIL MOCK] Verification code for ${toEmail}: ${otp}`);
    return { mock: true, otp };
  }

  try {
    const info = await mailer.sendMail({
      from: `"RentRadar" <${config.smtpUser}>`,
      to: toEmail,
      subject,
      html,
      text: `Your RentRadar verification code is: ${otp}. It expires in 15 minutes.`,
    });
    logger.info({ messageId: info.messageId, to: toEmail }, 'Verification email sent');
    return { mock: false, messageId: info.messageId };
  } catch (err) {
    logger.error({ err: err.message, to: toEmail }, 'Failed to send verification email');
    throw err;
  }
}

module.exports = {
  sendVerificationEmail,
};
