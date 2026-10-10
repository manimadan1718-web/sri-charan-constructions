require('dotenv').config();
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { logActivity } = require('../utils/activity');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Requires a valid Bearer token. On success, attaches req.user = { id, name, role }.
 *
 * The user is re-checked in the database on every request so that
 * deactivating/deleting a user or changing their role takes effect immediately
 * instead of waiting for their 12-hour token to expire.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  let payload;
  try {
    // Only HS256 is accepted — a token claiming another algorithm (or "none") is refused outright.
    payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, role, active')
      .eq('id', payload.id)
      .maybeSingle();

    if (error) throw error;
    if (!user || user.active === false) {
      return res.status(401).json({ error: 'This account is no longer active. Please log in again.' });
    }

    req.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (err) {
    console.error('requireAuth:', err.message);
    res.status(500).json({ error: 'Could not verify your session. Please try again.' });
  }
}

/**
 * Use AFTER requireAuth. Restricts a route to one or more roles.
 * e.g. requireRole('admin')  or  requireRole('owner', 'admin')
 */
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      // The screens never offer an action a person may not do, so a refused request means someone
      // is poking at the API directly. Record it.
      await logActivity(req, {
        category: 'auth', action: 'access_denied',
        entityLabel: `${req.method} ${String(req.originalUrl || '').split('?')[0]}`.slice(0, 150),
      });
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
