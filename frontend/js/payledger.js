/* ═══════════════════════════════════════════════════════════════════════════════
   Payments → Party Ledger (Dr / Cr)  —  the Tally way: Opening Balance, entries, Closing Balance.
   Cr = a bill / amount payable (we owe the party)      Dr = a payment made to the party
   Balance shows "Cr" while we still owe, "Dr" when we paid in advance. Worked out by the server; nothing is typed.
   Loaded after app.js (it uses its helpers: esc, can, showToast, askReason, today, fmtDate, inrS, num2, Payments, Reports, PL, PL_ICON …).
   ═══════════════════════════════════════════════════════════════════════════════ */
const PLL = { built: false, view: 'party', party: '', kind: 'all', from: '', to: '', site: '', options: { parties: [], sites: [], has_blank_site: false }, data: null, timer: null, seq: 0, type: 'cr', entryHint: null };
const PLL_KIND = { all: 'Company + Outside Rental', company: 'Company Payments', outside: 'Outside Rental Payments' };
const PLL_SIDE = { cr: 'Cr', dr: 'Dr' };

/** The Indian financial year starts on 1 April: that is where the ledger begins unless the dates are changed. */
function pllFyStart() { const t = today(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04-01`; }
const pllAmt = n => num2(Math.abs(Number(n) || 0));
/** "41,500.00 Cr" — nothing owed shows plain 0.00 */
const pllSided = b => (!b || !b.amount ? '0.00' : `${pllAmt(b.amount)} ${PLL_SIDE[b.side]}`);
const pllCls = b => (!b || !b.amount ? '' : b.side === 'cr' ? 'pll-cr' : 'pll-dr');
const pllParams = () => ({ kind: PLL.kind === 'all' ? '' : PLL.kind, from: PLL.from, to: PLL.to, site: PLL.site });
const pllExportMenu = () => `
  <div class="export-menu rm">
    <button type="button" class="btn btn-outline btn-sm rm-btn" aria-haspopup="menu" aria-expanded="false"><span class="rm-label">Export</span><span class="caret" aria-hidden="true">▾</span></button>
    <div class="export-pop" role="menu" aria-label="Choose a report format" hidden>
      <button type="button" role="menuitem" data-rm-kind="payledger:x" data-rm-format="xlsx"><span class="fmt fmt-xlsx">XLS</span><span class="fmt-text"><strong>Excel</strong><small>.xlsx · what is on screen, with bold totals</small></span></button>
      <button type="button" role="menuitem" data-rm-kind="payledger:x" data-rm-format="pdf"><span class="fmt fmt-pdf">PDF</span><span class="fmt-text"><strong>PDF</strong><small>.pdf · print-ready, with bold totals</small></span></button>
    </div>
  </div>`;

function buildPlLedger() {
  if (PLL.built) return;
  PLL.built = true;
  PLL.from = pllFyStart(); PLL.to = today();
  const root = document.getElementById('pl-panel-ledger');
  root.innerHTML = `
    <div class="card pl-card">
      <div class="pl-card-head">
        <div class="pl-card-title"><span class="pl-ic">${PL_ICON.list}</span><div><h3>Party Ledger</h3><p>Opening balance, Cr (payable) and Dr (paid) entries, closing balance &mdash; for one party or for everyone.</p></div></div>
        <div class="pll-head-actions">
          <button type="button" class="btn btn-primary btn-sm perm-payments-add" id="pll-add">+ Add entry</button>
          ${pllExportMenu()}
        </div>
      </div>
      <div class="pll-view" role="group" aria-label="What to show">
        <button type="button" class="pll-view-btn active" data-pll-view="party">One party</button>
        <button type="button" class="pll-view-btn" data-pll-view="all">All parties</button>
      </div>
      <div class="pl-filters pll-filters" role="search" aria-label="Ledger filters">
        <label class="pl-flt pll-flt-party" id="pll-party-wrap"><span>Party</span><select id="pll-party"><option value="">Choose a party…</option></select></label>
        <label class="pl-flt"><span>Paying</span><select id="pll-kind"><option value="all">Company + Outside Rental</option><option value="company">Company Payments</option><option value="outside">Outside Rental Payments</option></select></label>
        <label class="pl-flt"><span>From date</span><input type="date" id="pll-from"></label>
        <label class="pl-flt"><span>To date</span><input type="date" id="pll-to"></label>
        <label class="pl-flt"><span>Site</span><select id="pll-site"><option value="">All sites</option></select></label>
      </div>
      <div class="form-error" id="pll-notice" role="status"></div>
    </div>
    <div class="pll-cards" id="pll-cards"></div>
    <div class="card pl-card">
      <div class="table-wrap pl-wrap"><table class="pl-table pll-table" id="pll-table"></table></div>
      <p class="pll-foot">Cr = payable to the party (we owe). Dr = paid to the party. The balance shows Cr while we still owe and Dr if we paid in advance. Opening Balance is everything before the From date, carried forward. Both columns add up to the same figure, as in Tally.</p>
    </div>`;
  document.getElementById('pll-from').value = PLL.from; document.getElementById('pll-to').value = PLL.to;

  const reload = () => { clearTimeout(PLL.timer); PLL.timer = setTimeout(loadPlLedgerView, 250); };
  root.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'pll-party') PLL.party = t.value;
    else if (t.id === 'pll-kind') PLL.kind = t.value;
    else if (t.id === 'pll-from') PLL.from = t.value;
    else if (t.id === 'pll-to') PLL.to = t.value;
    else if (t.id === 'pll-site') PLL.site = t.value;
    else return;
    reload();
  });
  root.addEventListener('click', ev => {
    const v = ev.target.closest('[data-pll-view]'); if (v) { PLL.view = v.dataset.pllView; reload(); loadPlLedgerView(); return; }
    if (ev.target.closest('#pll-add')) { openPllEntry(); return; }
    const op = ev.target.closest('[data-pll-open]'); if (op) { PLL.party = op.dataset.pllOpen; PLL.view = 'party'; loadPlLedgerView(); return; }
    const del = ev.target.closest('[data-pll-del]'); if (del) deletePllOpening(del.dataset.pllDel);
  });
  buildPllEntryModal();
}

function pllFillControls() {
  const o = PLL.options || {}, pSel = document.getElementById('pll-party'), sSel = document.getElementById('pll-site');
  if (!pSel) return;
  const names = (o.parties || []).filter(p => PLL.kind === 'all' || (p.kinds || []).includes(PLL.kind)).map(p => p.name);
  if (PLL.party && !names.some(n => n.toLowerCase() === PLL.party.toLowerCase())) names.unshift(PLL.party);
  pSel.innerHTML = '<option value="">Choose a party…</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  pSel.value = PLL.party || '';
  const sites = [...(o.sites || [])];
  sSel.innerHTML = '<option value="">All sites</option>' + sites.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('') + (o.has_blank_site ? '<option value="__none__">(not entered)</option>' : '');
  if (PLL.site && ![...sSel.options].some(x => x.value === PLL.site)) sSel.insertAdjacentHTML('beforeend', `<option value="${esc(PLL.site)}">${esc(PLL.site)}</option>`);
  sSel.value = PLL.site || '';
  document.getElementById('pll-party-wrap').hidden = PLL.view !== 'party';
  document.querySelectorAll('[data-pll-view]').forEach(b => b.classList.toggle('active', b.dataset.pllView === PLL.view));
  document.getElementById('pll-kind').value = PLL.kind;
}

async function loadPlLedgerView() {
  if (!PLL.built) return;
  const my = ++PLL.seq, table = document.getElementById('pll-table'), notice = document.getElementById('pll-notice');
  if (PLL.from && PLL.to && PLL.from > PLL.to) { notice.textContent = 'The "from" date cannot be after the "to" date.'; return; }
  notice.textContent = '';
  try {
    if (PLL.view === 'party') {
      if (!PLL.party) { // no party chosen yet: still fetch the list of names for the drop-down
        const r = await Payments.ledgerParties(pllParams()); if (my !== PLL.seq) return;
        PLL.options = r.data.options; pllFillControls();
        document.getElementById('pll-cards').innerHTML = '';
        table.innerHTML = '<tbody><tr class="empty-row"><td>Choose a party above to see its ledger, or switch to &ldquo;All parties&rdquo;.</td></tr></tbody>';
        pllNotice(r); return;
      }
      const r = await Payments.ledger({ ...pllParams(), party: PLL.party }); if (my !== PLL.seq) return;
      PLL.data = r.data; PLL.options = r.data.options; pllFillControls(); renderPllParty(r.data); pllNotice(r);
    } else {
      const r = await Payments.ledgerParties(pllParams()); if (my !== PLL.seq) return;
      PLL.data = r.data; PLL.options = r.data.options; pllFillControls(); renderPllAll(r.data); pllNotice(r);
    }
  } catch (e) {
    if (my !== PLL.seq) return;
    table.innerHTML = ''; notice.textContent = e.message || 'The ledger could not be loaded.';
  }
}
function pllNotice(r) {
  const n = document.getElementById('pll-notice');
  n.textContent = r.setup_required ? 'Payments need a one-time database update before the ledger can be used.' : r.openings_setup_required ? 'To add opening balances, run run-in-supabase-15-payment-openings.sql in Supabase once. Everything else works already.' : (PLL.site ? 'With a site chosen, manual opening balances are left out (they do not belong to a site).' : '');
}

const pllStat = (label, val, cls = '', sub = '', dark = false) => `<div class="pll-stat${dark ? ' pll-dark' : ''}"><div class="pll-stat-l">${esc(label)}</div><div class="pll-stat-v ${cls}">${val}</div>${sub ? `<div class="pll-stat-s">${esc(sub)}</div>` : ''}</div>`;
const pllSpan = () => `${PLL.from ? fmtDate(PLL.from) : 'the beginning'} to ${PLL.to ? fmtDate(PLL.to) : 'today'}`;

function renderPllParty(d) {
  const cr = d.rows.filter(r => r.cr).length, dr = d.rows.filter(r => r.dr).length;
  document.getElementById('pll-cards').innerHTML =
    pllStat(`Opening Balance${PLL.from ? ` (${fmtDate(PLL.from)})` : ''}`, `₹${pllSided(d.opening)}`, pllCls(d.opening), d.opening.amount ? (d.opening.side === 'cr' ? 'We owed the party' : 'Paid in advance') : '') +
    pllStat('Total Dr (Paid)', `₹${num2(d.period.dr)}`, 'pll-dr', `${dr} payment${dr === 1 ? '' : 's'}`) +
    pllStat('Total Cr (Bills / Payable)', `₹${num2(d.period.cr)}`, 'pll-cr', `${cr} bill${cr === 1 ? '' : 's'}`) +
    pllStat(`Closing Balance${PLL.to ? ` (${fmtDate(PLL.to)})` : ''}`, `₹${pllSided(d.closing)}`, '', d.closing.amount ? (d.closing.side === 'cr' ? 'Still to pay' : 'Paid in advance') : 'Settled', true);
  const money = v => (v ? num2(v) : '');
  const canDel = can('payments.edit');
  let h = `<thead><tr><th>Date</th><th>Particulars</th><th>Site / Paid by</th><th class="r">Dr (Paid)</th><th class="r">Cr (Payable)</th><th class="r">Balance</th>${canDel ? '<th></th>' : ''}</tr></thead><tbody>`;
  const cols = canDel ? 7 : 6;
  h += `<tr class="pll-open"><td data-label="Date">${PLL.from ? esc(fmtDate(PLL.from)) : ''}</td><td data-label="Particulars"><strong>Opening Balance (brought forward)</strong></td><td></td><td class="r" data-label="Dr">${d.opening.side === 'dr' && d.opening.amount ? `<span class="pll-dr">${pllAmt(d.opening.amount)}</span>` : ''}</td><td class="r" data-label="Cr">${d.opening.side === 'cr' && d.opening.amount ? `<span class="pll-cr">${pllAmt(d.opening.amount)}</span>` : ''}</td><td class="r" data-label="Balance"><strong class="${pllCls(d.opening)}">${pllSided(d.opening)}</strong></td>${canDel ? '<td></td>' : ''}</tr>`;
  if (!d.rows.length) h += `<tr class="empty-row"><td colspan="${cols}">No entries for ${esc(d.party)} in this period.</td></tr>`;
  for (const r of d.rows) {
    const where = [r.site, r.paid_by && `by ${r.paid_by}`].filter(Boolean).map(esc).join(' · ') || '<span class="pl-none">–</span>';
    h += `<tr${r.type === 'opening' ? ' class="pll-open"' : ''}><td data-label="Date" class="pl-date-cell">${esc(fmtDate(r.date))}</td><td data-label="Particulars">${esc(r.particulars)}</td><td data-label="Site / Paid by">${where}</td><td class="r" data-label="Dr (Paid)">${r.dr ? `<span class="pll-dr">${money(r.dr)}</span>` : ''}</td><td class="r" data-label="Cr (Payable)">${r.cr ? `<span class="pll-cr">${money(r.cr)}</span>` : ''}</td><td class="r" data-label="Balance"><span class="${pllCls({ amount: r.balance, side: r.balance_side })}">${pllSided({ amount: r.balance, side: r.balance_side })}</span></td>${canDel ? `<td class="pl-act">${r.type === 'opening' ? `<button type="button" class="btn btn-outline btn-sm pl-del" data-pll-del="${esc(r.opening_id)}">Delete</button>` : ''}</td>` : ''}</tr>`;
  }
  h += `<tr class="pll-open"><td data-label="Date">${PLL.to ? esc(fmtDate(PLL.to)) : ''}</td><td data-label="Particulars"><strong>Closing Balance (carried forward)</strong></td><td></td><td class="r" data-label="Dr">${d.closing.side === 'cr' && d.closing.amount ? `<span class="pll-dr">${pllAmt(d.closing.amount)}</span>` : ''}</td><td class="r" data-label="Cr">${d.closing.side === 'dr' && d.closing.amount ? `<span class="pll-cr">${pllAmt(d.closing.amount)}</span>` : ''}</td><td class="r" data-label="Balance"><strong class="${pllCls(d.closing)}">${pllSided(d.closing)}</strong></td>${canDel ? '<td></td>' : ''}</tr>`;
  h += `</tbody><tfoot><tr><td></td><td><strong>TOTAL</strong></td><td></td><td class="r" data-label="Dr">${num2(d.totals.dr)}</td><td class="r" data-label="Cr">${num2(d.totals.cr)}</td><td></td>${canDel ? '<td></td>' : ''}</tr></tfoot>`;
  document.getElementById('pll-table').innerHTML = h;
}

function renderPllAll(d) {
  const t = d.totals;
  document.getElementById('pll-cards').innerHTML =
    pllStat('Opening (all parties)', `₹${pllSided(t.opening)}`, pllCls(t.opening), `${t.parties} part${t.parties === 1 ? 'y' : 'ies'}`) +
    pllStat('Total Dr (Paid)', `₹${num2(t.dr)}`, 'pll-dr') + pllStat('Total Cr (Payable)', `₹${num2(t.cr)}`, 'pll-cr') +
    pllStat('Closing (all parties)', `₹${pllSided(t.closing)}`, '', pllSpan(), true);
  let h = '<thead><tr><th>Party</th><th class="r">Opening Balance</th><th class="r">Dr (Paid)</th><th class="r">Cr (Payable)</th><th class="r">Closing Balance</th><th></th></tr></thead><tbody>';
  if (!d.parties.length) h += '<tr class="empty-row"><td colspan="6">No parties have entries in this period.</td></tr>';
  for (const p of d.parties) {
    h += `<tr><td data-label="Party"><strong>${esc(p.party_name)}</strong> <span class="pll-pill">${p.kinds.map(k => k === 'company' ? 'Company' : 'Outside Rental').join(' + ')}</span></td><td class="r" data-label="Opening"><span class="${pllCls(p.opening)}">${pllSided(p.opening)}</span></td><td class="r" data-label="Dr (Paid)"><span class="pll-dr">${num2(p.dr)}</span></td><td class="r" data-label="Cr (Payable)"><span class="pll-cr">${num2(p.cr)}</span></td><td class="r" data-label="Closing"><strong class="${pllCls(p.closing)}">${pllSided(p.closing)}</strong></td><td class="r"><button type="button" class="btn btn-outline btn-sm" data-pll-open="${esc(p.party_name)}">Open &rsaquo;</button></td></tr>`;
  }
  h += `</tbody><tfoot><tr><td><strong>TOTAL (${t.parties} part${t.parties === 1 ? 'y' : 'ies'})</strong></td><td class="r" data-label="Opening">${pllSided(t.opening)}</td><td class="r" data-label="Dr">${num2(t.dr)}</td><td class="r" data-label="Cr">${num2(t.cr)}</td><td class="r" data-label="Closing">${pllSided(t.closing)}</td><td></td></tr></tfoot>`;
  document.getElementById('pll-table').innerHTML = h;
}

/* ── removing a manual opening balance (a written reason is always needed) ─────────────── */
async function deletePllOpening(id) {
  const row = ((PLL.data && PLL.data.rows) || []).find(r => String(r.opening_id) === String(id)); if (!row) return;
  const reason = await askReason({ title: 'Delete this opening balance?', intro: `<strong>${esc(row.party_name)}</strong> &mdash; opening balance <strong>${pllAmt(row.amount)} ${PLL_SIDE[row.side]}</strong> as on ${esc(fmtDate(row.date))}. It moves to the Archive; the Admin can restore it.`, confirmLabel: 'Delete', danger: true });
  if (!reason) return;
  try { await Payments.removeOpening(id, reason); showToast('Opening balance deleted.'); loadPlLedgerView(); } catch (e) { showToast(e.message || 'Could not delete it.', true); }
}

/* ── the "Add entry" pop-up: any number of lines — a Bill (Cr), a Payment (Dr) or an Opening Balance — saved together ──────── */
const PLL_TYPES = [['cr', 'Bill / Payable (Cr)'], ['dr', 'Payment made (Dr)'], ['ocr', 'Opening Balance — Cr (we owe)'], ['odr', 'Opening Balance — Dr (paid in advance)']];
const pllIsOpen = ty => ty === 'ocr' || ty === 'odr';
const PLL_MAX_LINES = 60;
PLL.lines = []; PLL.paidBy = [];

function buildPllEntryModal() {
  document.getElementById('pll-entry-body').innerHTML = `
    <div class="form-grid pll-top">
      <div class="form-group"><label for="pll-e-kind">Who we are paying *</label><select id="pll-e-kind"><option value="company">Company Payments</option><option value="outside">Outside Rental Payments</option></select></div>
    </div>
    <p class="pll-help">Add as many lines as you need, then save them all together. Cr adds to what we owe the party (a bill). Dr is a payment made. An Opening Balance is an amount already owed or paid in advance before you started using the app.</p>
    <div id="pll-lines"></div>
    <button type="button" class="btn btn-outline" id="pll-add-line">+ Add Entry</button>
    <div class="pll-after" id="pll-e-after" hidden></div>
    <div class="form-error" id="pll-e-error" role="alert"></div>
    <div class="btn-group"><button type="button" class="btn btn-primary" id="pll-e-save">Save entries</button><button type="button" class="btn btn-outline" id="pll-e-cancel">Cancel</button></div>
    <datalist id="pll-e-parties"></datalist><datalist id="pll-e-paidbys"></datalist>`;
  const root = document.getElementById('pll-entry-overlay');
  root.addEventListener('mousedown', ev => { PLL.downOnBackdrop = ev.target === root; });
  root.addEventListener('click', ev => {
    if ((ev.target === root && PLL.downOnBackdrop && !PLL.lines.some(pllLineFilled)) || ev.target.closest('#pll-e-cancel') || ev.target.closest('#pll-e-close')) { closePllEntry(); return; }
    if (ev.target.closest('#pll-add-line')) { pllAddLine(); return; }
    const rm = ev.target.closest('[data-pll-rm]'); if (rm) { pllRemoveLine(Number(rm.dataset.pllRm)); return; }
    if (ev.target.closest('#pll-e-save')) savePllEntry();
  });
  root.addEventListener('input', ev => { const f = ev.target.dataset && ev.target.dataset.pllF; if (!f) return; const i = Number(ev.target.closest('[data-pll-line]').dataset.pllLine); PLL.lines[i][f] = ev.target.value; pllAfter(); });
  root.addEventListener('change', ev => {
    const f = ev.target.dataset && ev.target.dataset.pllF; if (!f) return;
    const i = Number(ev.target.closest('[data-pll-line]').dataset.pllLine); PLL.lines[i][f] = ev.target.value;
    if (f === 'type') pllRenderLines(); pllAfter();
  });
}
const pllLineFilled = l => !!(String(l.party || '').trim() || String(l.amount || '').trim() || String(l.item || '').trim());
const pllNewLine = prev => ({ type: prev ? prev.type : 'cr', date: prev ? prev.date : today(), site: prev ? prev.site : '', party: prev ? prev.party : '', item: '', amount: '', paidby: '', desc: '' });

function pllRenderLines() {
  const el = document.getElementById('pll-lines'); if (!el) return;
  el.innerHTML = PLL.lines.map((l, i) => {
    const open = pllIsOpen(l.type), dr = l.type === 'dr';
    const siteOpts = plSiteOptions(l.site || '');
    return `<div class="pll-line" data-pll-line="${i}">
      <div class="pll-line-head"><strong>Line ${i + 1}</strong>${PLL.lines.length > 1 ? `<button type="button" class="btn btn-outline btn-sm" data-pll-rm="${i}" aria-label="Remove line ${i + 1}">Remove</button>` : ''}</div>
      <div class="form-grid">
        <div class="form-group span-2"><label>What are you recording? *</label><select data-pll-f="type" aria-label="Line ${i + 1} type">${PLL_TYPES.map(([v, n]) => `<option value="${v}"${v === l.type ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="form-group"><label>${open ? 'As on date' : 'Date'} *</label><input type="date" data-pll-f="date" value="${esc(l.date)}"></div>
        <div class="form-group"><label>Party *</label><input type="text" data-pll-f="party" maxlength="120" list="pll-e-parties" autocomplete="off" value="${esc(l.party)}"></div>
        ${open ? '' : `<div class="form-group"><label>Site</label><select data-pll-f="site">${siteOpts}</select></div>
        <div class="form-group"><label>Item</label><input type="text" data-pll-f="item" maxlength="120" autocomplete="off" placeholder="${dr ? 'Payment' : 'Bill'}" value="${esc(l.item)}"></div>`}
        <div class="form-group"><label>Amount (&#8377;) *</label><input type="number" data-pll-f="amount" min="0" step="0.01" inputmode="decimal" value="${esc(l.amount)}"></div>
        ${dr ? `<div class="form-group"><label>Paid by</label><input type="text" data-pll-f="paidby" maxlength="120" list="pll-e-paidbys" autocomplete="off" placeholder="Who made the payment" value="${esc(l.paidby)}"></div>` : ''}
        <div class="form-group${open ? ' span-2' : ' full'}"><label>${open ? 'Note' : 'Description'}</label><input type="text" data-pll-f="desc" maxlength="300" autocomplete="off" value="${esc(l.desc)}"></div>
      </div></div>`;
  }).join('');
  const add = document.getElementById('pll-add-line'); if (add) add.disabled = PLL.lines.length >= PLL_MAX_LINES;
}
function pllAddLine() {
  if (PLL.lines.length >= PLL_MAX_LINES) { document.getElementById('pll-e-error').textContent = `You can save up to ${PLL_MAX_LINES} lines at a time.`; return; }
  PLL.lines.push(pllNewLine(PLL.lines[PLL.lines.length - 1]));       // a new line starts like the one above (same type, date, site and party), so a run of bills is quick
  pllRenderLines(); pllAfter();
  const last = document.querySelector('#pll-lines .pll-line:last-child [data-pll-f="item"], #pll-lines .pll-line:last-child [data-pll-f="amount"]'); if (last) { last.focus(); last.scrollIntoView({ block: 'nearest' }); }
}
function pllRemoveLine(i) { if (PLL.lines.length <= 1) return; PLL.lines.splice(i, 1); pllRenderLines(); pllAfter(); }
function pllAfter() {
  const box = document.getElementById('pll-e-after'); if (!box) return;
  let cr = 0, dr = 0, n = 0;
  for (const l of PLL.lines) { const a = Number(l.amount) || 0; if (a <= 0) continue; n++; if (l.type === 'cr' || l.type === 'ocr') cr += a; else dr += a; }
  if (!n) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<strong>${n} line${n === 1 ? '' : 's'} ready</strong><br>Cr (payable) <b class="pll-cr">&#8377;${num2(cr)}</b> &nbsp;·&nbsp; Dr (paid) <b class="pll-dr">&#8377;${num2(dr)}</b>`;
}

function openPllEntry() {
  const names = (PLL.options.parties || []).map(p => p.name);
  document.getElementById('pll-e-parties').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
  document.getElementById('pll-e-kind').value = PLL.kind === 'outside' ? 'outside' : 'company';
  document.getElementById('pll-e-error').textContent = '';
  const first = pllNewLine(null); if (PLL.view === 'party') first.party = PLL.party;
  PLL.lines = [first]; pllRenderLines(); pllAfter();
  Payments.names().then(r => { document.getElementById('pll-e-paidbys').innerHTML = (r.paid_by || []).map(n => `<option value="${esc(n)}"></option>`).join(''); }).catch(() => {});
  document.getElementById('pll-entry-overlay').classList.add('open');
  setTimeout(() => { const f = document.querySelector('#pll-lines [data-pll-f="party"]'); if (f) f.focus(); }, 60);
}
function closePllEntry() { document.getElementById('pll-entry-overlay').classList.remove('open'); }

/** Checks every line; returns a message naming the line that needs fixing, or null. */
function pllCheckLines() {
  for (let i = 0; i < PLL.lines.length; i++) {
    const l = PLL.lines[i], n = `Line ${i + 1}: `;
    if (!String(l.party || '').trim()) return n + 'enter the party name.';
    if (!(Number(l.amount) > 0)) return n + 'enter an amount above 0.';
    if (!l.date) return n + 'choose the date.';
  }
  return null;
}

async function savePllEntry() {
  const err = document.getElementById('pll-e-error'), btn = document.getElementById('pll-e-save');
  err.textContent = '';
  const used = PLL.lines.filter(pllLineFilled);
  if (!used.length) { err.textContent = 'Enter at least one line.'; return; }
  PLL.lines = used;                                   // an untouched blank line is simply ignored
  const bad = pllCheckLines(); if (bad) { pllRenderLines(); err.textContent = bad; return; }
  const kind = document.getElementById('pll-e-kind').value;
  const t = s => String(s || '').trim();
  const lineItems = [], openings = [];
  PLL.lines.forEach(l => {
    if (pllIsOpen(l.type)) openings.push({ l, body: { kind, party_name: t(l.party), as_on: l.date, side: l.type === 'ocr' ? 'cr' : 'dr', amount: l.amount, note: t(l.desc) } });
    else {
      const x = { pay_date: l.date, party_name: t(l.party), item: t(l.item) || (l.type === 'cr' ? 'Bill' : 'Payment'), description: t(l.desc), site: l.site || '', paid_by: l.type === 'dr' ? t(l.paidby) : '' };
      x[l.type === 'cr' ? 'payable' : 'paid'] = l.amount;
      lineItems.push({ l, body: x });
    }
  });
  btn.disabled = true;
  let saved = 0;
  try {
    if (lineItems.length) {
      await Payments.create({ kind, items: lineItems.map(x => x.body) });       // all the bills / payments together, or none
      saved += lineItems.length; PLL.lines = PLL.lines.filter(l => !lineItems.some(x => x.l === l));
    }
    for (const o of openings) { await Payments.addOpening(o.body); saved++; PLL.lines = PLL.lines.filter(l => l !== o.l); }
    closePllEntry(); showToast(saved === 1 ? 'Entry saved.' : `${saved} entries saved.`);
    if (PLL.view === 'party' && !PLL.party) PLL.party = t(used[0].party);
    if (PL.rows) { PL.rows.company = null; PL.rows.outside = null; }
    loadPlLedgerView();
  } catch (e) {
    // whatever was saved before the problem is already out of the list; what is left still needs saving
    if (saved) { pllRenderLines(); pllAfter(); loadPlLedgerView(); err.textContent = `${saved} line${saved === 1 ? ' was' : 's were'} saved. The rest were not: ${e.message || 'please try again.'}`; }
    else err.textContent = e.message || 'The entries could not be saved.';
  } finally { btn.disabled = false; }
}

/** Called by app.js when Excel / PDF is chosen in the ledger's Export menu. */
function pllReportBody(format) {
  const p = pllParams();
  return { format, kind: p.kind || 'all', from: p.from || undefined, to: p.to || undefined, site: p.site || undefined, party: PLL.view === 'party' ? PLL.party : undefined };
}
