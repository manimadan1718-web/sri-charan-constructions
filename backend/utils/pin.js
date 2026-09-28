const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const PIN_RE = /^\S{4,10}$/; // 4–10 characters, no spaces (login box allows max 10)

function validatePin(pin) {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

// bcrypt hashes look like  $2a$10$<53 chars>  (60 chars total)
function isHashed(stored) {
  return typeof stored === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(stored);
}

function hashPin(pin) {
  return bcrypt.hash(pin, 10);
}

/**
 * Compares a typed PIN with what is stored. Accepts both bcrypt hashes (current)
 * and legacy plain-text PINs (rows created before hashing was working), so
 * existing accounts — including the seeded Admin — can still log in and get
 * upgraded to a hash automatically.
 */
async function matchesPin(pin, stored) {
  if (typeof pin !== 'string' || typeof stored !== 'string') return false;
  if (isHashed(stored)) return bcrypt.compare(pin, stored);
  const a = Buffer.from(pin);
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { validatePin, isHashed, hashPin, matchesPin };
