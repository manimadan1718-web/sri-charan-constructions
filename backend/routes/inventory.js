const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity, simpleDiff, simpleSnapshot } = require('../utils/activity');
const { serverError } = require('../utils/http');

router.use(requireAuth);

const clean = v => (typeof v === 'string' ? v.trim() : v);

/**
 * Registers GET (any logged-in user — feeds the Data Entry dropdowns) plus
 * POST / PUT / DELETE (Admin only) for one inventory table.
 *
 *   table       – Supabase table name
 *   path        – URL segment under /api/inventory
 *   label       – human name used in error messages
 *   orderBy     – column used to sort the list
 *   required    – the column that must be present when creating
 *   fields      – all editable columns (besides `active`)
 *   uniqueMsg   – 409 message when the table has a UNIQUE column (optional)
 *   entity      – short name used in the activity log (vehicle / operator / site)
 *   fieldLabels – human labels for `fields`, same order
 */
function crud({ table, path, label, orderBy, required, fields, uniqueMsg, entity, fieldLabels }) {
  const spec = [...fields.map((f, i) => [f, fieldLabels[i]]), ['active', 'Status', 'bool']];
  // GET — any logged-in user
  router.get(`/${path}`, async (req, res) => {
    try {
      const { data, error } = await supabase.from(table).select('*').order(orderBy, { ascending: true });
      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      return serverError(res, err, `GET /inventory/${path}`);
    }
  });

  // POST — Admin only
  router.post(`/${path}`, requireRole('admin'), async (req, res) => {
    try {
      const row = {};
      fields.forEach(f => { if (req.body[f] !== undefined) row[f] = clean(req.body[f]) || null; });
      if (!row[required]) return res.status(400).json({ error: `${label} ${required === 'vehicle_no' ? 'No.' : 'name'} is required.` });

      const { data, error } = await supabase.from(table).insert(row).select().single();
      if (error) {
        if (error.code === '23505' && uniqueMsg) return res.status(409).json({ error: uniqueMsg });
        throw error;
      }
      await logActivity(req, {
        category: 'inventory', action: `${entity}_added`, entityType: entity, entityId: data.id,
        entityLabel: data[required], changes: simpleSnapshot(data, spec, 'to'),
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      return serverError(res, err, `POST /inventory/${path}`);
    }
  });

  // PUT — Admin only (edit fields / toggle active)
  router.put(`/${path}/:id`, requireRole('admin'), async (req, res) => {
    try {
      const updates = {};
      fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = clean(req.body[f]) || null; });
      if (req.body.active !== undefined) updates.active = !!req.body.active;
      if (updates[required] === null) return res.status(400).json({ error: `${label} cannot be empty.` });
      if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });

      const { data: before, error: getErr } = await supabase.from(table).select('*').eq('id', req.params.id).maybeSingle();
      if (getErr) throw getErr;
      if (!before) return res.status(404).json({ error: `${label} not found.` });

      const { data, error } = await supabase.from(table).update(updates).eq('id', req.params.id).select().maybeSingle();
      if (error) {
        if (error.code === '23505' && uniqueMsg) return res.status(409).json({ error: uniqueMsg });
        throw error;
      }
      if (!data) return res.status(404).json({ error: `${label} not found.` });

      const changes = simpleDiff(before, updates, spec);
      if (changes.length) {
        await logActivity(req, {
          category: 'inventory', action: `${entity}_updated`, entityType: entity, entityId: data.id,
          entityLabel: data[required], changes,
        });
      }
      res.json({ success: true, data });
    } catch (err) {
      return serverError(res, err, `PUT /inventory/${path}/:id`);
    }
  });

  // DELETE — Admin only
  router.delete(`/${path}/:id`, requireRole('admin'), async (req, res) => {
    try {
      const { data: before } = await supabase.from(table).select('*').eq('id', req.params.id).maybeSingle();
      const { error } = await supabase.from(table).delete().eq('id', req.params.id);
      if (error) throw error;
      if (before) {
        await logActivity(req, {
          category: 'inventory', action: `${entity}_deleted`, entityType: entity, entityId: before.id,
          entityLabel: before[required], changes: simpleSnapshot(before, spec, 'from'),
        });
      }
      res.json({ success: true });
    } catch (err) {
      return serverError(res, err, `DELETE /inventory/${path}/:id`);
    }
  });
}

crud({ table: 'vehicles',  path: 'vehicles',  label: 'Vehicle',  orderBy: 'vehicle_no', required: 'vehicle_no', fields: ['vehicle_no', 'type'],  fieldLabels: ['Vehicle No.', 'Type'],  entity: 'vehicle',  uniqueMsg: 'That vehicle already exists.' });
crud({ table: 'operators', path: 'operators', label: 'Operator', orderBy: 'name',       required: 'name',       fields: ['name', 'phone'],       fieldLabels: ['Name', 'Phone'],        entity: 'operator' });
crud({ table: 'sites',     path: 'sites',     label: 'Site',     orderBy: 'name',       required: 'name',       fields: ['name', 'location'],    fieldLabels: ['Site Name', 'Location'], entity: 'site',     uniqueMsg: 'That site already exists.' });

module.exports = router;
