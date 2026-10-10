const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const PIN_RE = /^\S{4,10}$/; // 4–10 characters, no spaces (login box allows max 10)

function validatePin(pin) {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

// PINs are the only thing between a stranger and the site log, so the obvious ones are refused
// when a PIN is created or reset (existing PINs keep working until they are changed).
const COMMON_PINS = new Set([
  '1234', '12345', '123456', '1234567', '12345678', '123456789', '1234567890', '0123', '01234', '012345',
  '4321', '54321', '654321', '9876', '98765', '987654', '1212', '121212', '1122', '112233', '2580', '1004',
  '2000', '2001', '1357', '2468', '1313', '6969', '696969', '4444', '0852', '5683', '1234abcd',
  'abcd', 'abcde', 'abcdef', 'qwer', 'qwerty', 'asdf', 'admin', 'admin123', 'password', 'pass', 'pass123',
  'pin123', 'scc123', 'scc1234', 'test', 'test123', 'welcome', 'letmein',
]);

function isWeakPin(pin) {
  if (typeof pin !== 'string') return true;
  const p = pin.toLowerCase();
  if (COMMON_PINS.has(p)) return true;
  if (/^(.)\1+$/.test(p)) return true;                         // 0000, 777777, aaaa …
  if (/^\d+$/.test(p) && p.length >= 4) {                      // 3456, 8765, 2121 …
    const d = [...p].map(Number);
    const step = d[1] - d[0];
    if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return true;
    if (p.length % 2 === 0 && p.slice(0, p.length / 2) === p.slice(p.length / 2) && p.length <= 8 && /^(\d\d)\1+$/.test(p)) return true;
  }
  return false;
}

const WEAK_PIN_MESSAGE = 'That PIN is too easy to guess (for example 1234 or 0000). Please choose a less obvious one.';

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

module.exports = { validatePin, isWeakPin, WEAK_PIN_MESSAGE, isHashed, hashPin, matchesPin };
