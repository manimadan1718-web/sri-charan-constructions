/**
 * Diesel Expenses: every diesel fill that the entries recorded, kept apart from the day-to-day records so it can be
 * reviewed and downloaded on its own.
 *
 *   • A fill is an entry with litres above 0. Its PROOF is the diesel photo saved with the entry (the fuel slip / meter).
 *   • Nothing is typed twice: the register is read from the entries themselves, so it can never disagree with them
 *     (edit or delete an entry, and the register follows; restore it from Archived, and it is back).
 *   • By default only fills WITH proof are listed ("with"); "without" lists the ones that still need a photo; "all" lists both.
 *   • Choose a period (from / to), one or several sites, and the proof choice. Totals are per site and overall.
 */
const supabase = require('../config/supabase');
const { fetchAll } = require('./db');
const photos = require('./photos');
const { NO_SITE, NO_SITE_PARAM } = require('./summary');

const PROOF_MODES = ['with', 'without', 'all'];
const PROOF_LABEL = { with: 'With proof', without: 'Without proof', all: 'With and without proof' };
const siteOf = e => String(e.site == null ? '' : e.site).trim();
const round2 = n => Math.round(n * 100) / 100;
const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || ''); };

/** One or several values from a query string / body (?site=A&site=B): trimmed, no blanks, no repeats. */
const many = v => [...new Set((Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string').map(x => x.replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean))].slice(0, 300);

async function dieselRegister({ from, to, sites = [], proof = 'with' } = {}) {
  const mode = PROOF_MODES.includes(proof) ? proof : 'with';
  let photoColumns = true;
  const read = cols => fetchAll(() => {
    let q = supabase.from('entries').select(cols).gt('diesel', 0)
      .order('date', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true });
    if (from) q = q.gte('date', from);
    if (to)   q = q.lte('date', to);
    return q;
  });
  let r = await read('id, date, site, category, vehicle_no, operator, diesel, diesel_photo, remarks');
  if (r.error && photos.isMissingPhotoColumn(r.error)) { photoColumns = false; r = await read('id, date, site, category, vehicle_no, operator, diesel, remarks'); }   // (before the photo SQL: nothing has proof)
  if (r.error) throw r.error;

  const want = new Set(many(sites).map(s => (s === NO_SITE_PARAM ? '' : s.toLowerCase())));
  const all = (r.data || [])
    .filter(e => !want.size || want.has(siteOf(e).toLowerCase()))
    .map(e => {
      const photo = photoColumns && photos.isReadingPath(e.diesel_photo) ? e.diesel_photo : null;
      return { id: e.id, date: e.date, site: siteOf(e), category: e.category || 'own', vehicle_no: e.vehicle_no || '', operator: e.operator || '', litres: round2(Number(e.diesel) || 0), remarks: e.remarks || '', has_proof: !!photo, photo };
    });
  const rows = all.filter(x => mode === 'all' || (mode === 'with' ? x.has_proof : !x.has_proof)).map((x, i) => ({ n: i + 1, ...x }));

  const bySite = new Map();
  for (const x of rows) {
    const b = bySite.get(x.site) || { fills: 0, litres: 0 };
    b.fills += 1; b.litres += x.litres; bySite.set(x.site, b);
  }
  const sum = list => round2(list.reduce((a, x) => a + x.litres, 0));
  return {
    range: { from: from || null, to: to || null }, proof: mode, sites_filter: [...many(sites)],
    fills: rows.length, total_litres: sum(rows),
    // the whole picture for this period and these sites, whichever proof choice is listed: how much has proof, and how much still needs a photo
    with_proof: { fills: all.filter(x => x.has_proof).length, litres: sum(all.filter(x => x.has_proof)) },
    without_proof: { fills: all.filter(x => !x.has_proof).length, litres: sum(all.filter(x => !x.has_proof)) },
    sites: [...bySite.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
      .map(([key, t]) => ({ site: key || NO_SITE, value: key || NO_SITE_PARAM, fills: t.fills, litres: round2(t.litres) })),
    rows,
    proof_setup_required: photoColumns ? undefined : true,
  };
}

/** What is chosen, in words, for the heading of a report. */
function filtersText(d) {
  const p = d.range || {};
  const period = p.from || p.to ? `${p.from ? `From ${dmy(p.from)}` : ''}${p.from && p.to ? ' to ' : ''}${p.to ? `${p.from ? '' : 'Up to '}${dmy(p.to)}` : ''}` : 'All time';
  const sites = d.sites_filter && d.sites_filter.length ? d.sites_filter.map(s => (s === NO_SITE_PARAM ? NO_SITE : s)).join(', ') : 'All sites';
  return `Period: ${period}  \u00b7  Site: ${sites}  \u00b7  Proof: ${PROOF_LABEL[d.proof] || PROOF_LABEL.with}`;
}

module.exports = { dieselRegister, filtersText, many, PROOF_MODES, PROOF_LABEL, dmy };
