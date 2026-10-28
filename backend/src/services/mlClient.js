const config = require('../config');
const logger = require('../logger');

async function post(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.mlTimeoutMs);
  try {
    const res = await fetch(`${config.mlServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ML service responded ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.warn({ err: err.message, path }, 'ML service call failed');
    return null; // fail-safe: callers must handle null
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<{predicted_rent:number, low:number, high:number, model_version:string}|null>} */
const predictRent = (features) => post('/predict', features);

/** @returns {Promise<{risk_score:number, flags:Array, model_version:string}|null>} */
const checkFraud = (payload) => post('/fraud/check', payload);

/** Fingerprint an image (perceptual hash + embedding). @returns {Promise<{phash:string, embedding:number[]}|null>} */
async function analyzeImage(buffer, filename, mime) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.mlTimeoutMs * 2);
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), filename);
    const res = await fetch(`${config.mlServiceUrl}/images/analyze`, { method: 'POST', body: form, signal: ctrl.signal });
    if (!res.ok) throw new Error(`ML service responded ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.warn({ err: err.message }, 'Image analysis failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Model accuracy metrics for the admin dashboard. @returns {Promise<object|null>} */
async function getMetrics() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.mlTimeoutMs);
  try {
    const res = await fetch(`${config.mlServiceUrl}/metrics`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`ML service responded ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.warn({ err: err.message }, 'ML metrics unavailable');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { predictRent, checkFraud, analyzeImage, getMetrics };
