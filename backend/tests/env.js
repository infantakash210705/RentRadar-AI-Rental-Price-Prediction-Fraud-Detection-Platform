process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://rentradar:rentradar_dev@localhost:5432/rentradar_test';
process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'rentradar-test-uploads');
process.env.MAX_LISTINGS_PER_DAY = '5';
process.env.MAX_IMAGES_PER_LISTING = '3';
