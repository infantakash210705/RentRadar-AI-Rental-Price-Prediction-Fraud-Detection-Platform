const { ZodError } = require('zod');
const multer = require('multer');
const { AppError } = require('../utils/errors');
const logger = require('../logger');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `Route ${req.method} ${req.path} not found` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Invalid input',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image too large' : err.message;
    return res.status(400).json({ error: { code: 'upload_error', message: msg } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'Request body too large' } });
  }
  // Postgres: malformed uuid in a URL parameter (only treat as client error for uuid, log anything else)
  if (err.code === '22P02' && /uuid/i.test(err.message)) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid identifier format' } });
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
}

module.exports = { notFoundHandler, errorHandler };
