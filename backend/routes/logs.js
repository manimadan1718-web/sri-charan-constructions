const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isMissingTable } = require('../utils/activity');

// Read-only for Owner + Admin. There is deliberately NO update / delete route:
// the audit trail can only grow.
router.use(requireAuth, requireRole('owner', 'admin'));

const CATEGORIES = ['auth', 'entry', 'summary', 'inventory', 'user'];

function fail(res, err, where) {
  console.error(`${where}:`, err.message);
  if (isMissingTable(err)) {
    return res.status(503).json({
      error: 'The activity log table has not been created yet. Run run-in-supabase-logs.sql in Supabase → SQL Editor.',
      setup_required: true,
    });
  }
  res.status(500).json({ error: err.message });
}

const isoOrNull = v => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ── GET /api/logs ─ filters: category, q, from, to, limit, offset ───────────
router.get('/', async (req, res) => {
  try {
    const { category, q, from, to } = req.query;
    const limit  = Math.min(Math.max(parseInt(req.query.limit, 10)  || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let query = supabase
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category.' });
      query = query.eq('category', category);
    }
    const f = isoOrNull(from), t = isoOrNull(to);
    if (f) query = query.gte('created_at', f);
    if (t) query = query.lte('created_at', t);

    // free-text search over who / what / why (special filter characters removed)
    const term = typeof q === 'string' ? q.replace(/[,()%*\\"]/g, ' ').trim().slice(0, 60) : '';
    if (term) {
      query = query.or(`user_name.ilike.%${term}%,entity_label.ilike.%${term}%,reason.ilike.%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data, total: count ?? data.length, limit, offset });
  } catch (err) {
    fail(res, err, 'GET /logs');
  }
});

// ── GET /api/logs/entry/:id ─ full history of one entry (newest first) ──────
router.get('/entry/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('entity_type', 'entry')
      .eq('entity_id', req.params.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, 'GET /logs/entry/:id');
  }
});

// ── POST /api/logs/entry-counts ─ { ids: [...] } → how many times each was edited ──
router.post('/entry-counts', async (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids)
      ? [...new Set(req.body.ids.filter(x => typeof x === 'string' && x.length <= 64))].slice(0, 5000)
      : [];
    const counts = {};
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase
        .from('activity_logs')
        .select('entity_id')
        .eq('action', 'entry_updated')
        .in('entity_id', chunk);
      if (error) throw error;
      (data || []).forEach(r => { counts[r.entity_id] = (counts[r.entity_id] || 0) + 1; });
    }
    res.json({ success: true, counts });
  } catch (err) {
    fail(res, err, 'POST /logs/entry-counts');
  }
});

module.exports = router;
