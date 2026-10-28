const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load .env.local from project root (preferred), then backend/.env.local, then .env
for (const p of [
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../.env'),
]) {
  if (fs.existsSync(p)) dotenv.config({ path: p });
}

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.BACKEND_PORT, 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://rentradar:rentradar_dev@localhost:5432/rentradar',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',').map((s) => s.trim()).filter(Boolean),
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  mlTimeoutMs: int(process.env.ML_TIMEOUT_MS, 4000),
  autoApproveBelowRisk: int(process.env.AUTO_APPROVE_BELOW_RISK, 40),
  autoApproveWhenMlDown: bool(process.env.AUTO_APPROVE_WHEN_ML_DOWN, true),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads')),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${int(process.env.BACKEND_PORT, 4000)}`,
  maxImageBytes: int(process.env.MAX_IMAGE_MB, 5) * 1024 * 1024,
  maxImagesPerListing: int(process.env.MAX_IMAGES_PER_LISTING, 8),
  maxListingsPerDay: int(process.env.MAX_LISTINGS_PER_DAY, 10),
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  if (config.env === 'production') {
    throw new Error('JWT_SECRET must be set (min 16 chars) in production');
  }
  config.jwtSecret = 'dev-only-insecure-secret-change-me';
}

module.exports = config;
