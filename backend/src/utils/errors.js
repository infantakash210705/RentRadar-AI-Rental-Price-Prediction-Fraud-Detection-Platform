class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'error';
    this.details = details;
  }
}
const badRequest = (m, d) => new AppError(400, m, 'bad_request', d);
const unauthorized = (m = 'Authentication required') => new AppError(401, m, 'unauthorized');
const forbidden = (m = 'Forbidden') => new AppError(403, m, 'forbidden');
const notFound = (m = 'Not found') => new AppError(404, m, 'not_found');
const conflict = (m) => new AppError(409, m, 'conflict');
module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
