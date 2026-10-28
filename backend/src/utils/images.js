const crypto = require('crypto');

// Detect real image type from magic bytes (never trust client-supplied mimetype/extension)
function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { ext: 'png', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  return null;
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
module.exports = { detectImageType, sha256 };
