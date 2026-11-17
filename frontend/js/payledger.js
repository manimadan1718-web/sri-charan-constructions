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

/* ── the "Add entry" pop-up: a Bill (Cr), a Payment (Dr) or an Opening Balance ─────────── */
function buildPllEntryModal() {
  document.getElementById('pll-entry-body').innerHTML = `
    <div class="form-group"><label>What are you recording?</label>
      <div class="pll-type" role="group" aria-label="Entry type">
        <button type="button" class="pll-type-btn active" data-pll-type="cr">Bill / Payable (Cr)</button>
        <button type="button" class="pll-type-btn" data-pll-type="dr">Payment made (Dr)</button>
        <button type="button" class="pll-type-btn" data-pll-type="open">Opening Balance</button>
      </div>
      <small class="pll-help" id="pll-type-help"></small>
    </div>
    <div class="form-grid">
      <div class="form-group"><label for="pll-e-kind">Who we are paying *</label><select id="pll-e-kind"><option value="company">Company Payments</option><option value="outside">Outside Rental Payments</option></select></div>
      <div class="form-group"><label for="pll-e-date" id="pll-e-date-l">Date *</label><input type="date" id="pll-e-date"></div>
      <div class="form-group" id="pll-e-site-g"><label for="pll-e-site">Site</label><select id="pll-e-site"></select></div>
      <div class="form-group"><label for="pll-e-party">Party *</label><input type="text" id="pll-e-party" maxlength="120" list="pll-e-parties" autocomplete="off"><datalist id="pll-e-parties"></datalist><small class="pll-help" id="pll-e-cur"></small></div>
      <div class="form-group" id="pll-e-item-g"><label for="pll-e-item">Item</label><input type="text" id="pll-e-item" maxlength="120" autocomplete="off"></div>
      <div class="form-group"><label for="pll-e-amount">Amount (&#8377;) *</label><input type="number" id="pll-e-amount" min="0" step="0.01" inputmode="decimal"></div>
      <div class="form-group" id="pll-e-side-g"><label for="pll-e-side">Opening balance is *</label><select id="pll-e-side"><option value="cr">Cr — we owe the party</option><option value="dr">Dr — we paid in advance</option></select></div>
      <div class="form-group" id="pll-e-paidby-g"><label for="pll-e-paidby">Paid by</label><input type="text" id="pll-e-paidby" maxlength="120" list="pll-e-paidbys" autocomplete="off" placeholder="Who made the payment"><datalist id="pll-e-paidbys"></datalist></div>
    </div>
    <div class="form-group"><label for="pll-e-desc" id="pll-e-desc-l">Description</label><textarea id="pll-e-desc" maxlength="300" rows="2"></textarea></div>
    <div class="pll-after" id="pll-e-after" hidden></div>
    <div class="form-error" id="pll-e-error" role="alert"></div>
    <div class="btn-group"><button type="button" class="btn btn-primary" id="pll-e-save">Save entry</button><button type="button" class="btn btn-outline" id="pll-e-cancel">Cancel</button></div>`;
  const root = document.getElementById('pll-entry-overlay');
  root.addEventListener('click', ev => {
    if (ev.target === root || ev.target.closest('#pll-e-cancel') || ev.target.closest('#pll-e-close')) { closePllEntry(); return; }
    const tb = ev.target.closest('[data-pll-type]'); if (tb) { setPllType(tb.dataset.pllType); return; }
    if (ev.target.closest('#pll-e-save')) savePllEntry();
  });
  root.addEventListener('input', ev => { if (ev.target.id === 'pll-e-party') pllLookupBalance(); pllAfter(); });
  root.addEventListener('change', ev => { if (ev.target.id === 'pll-e-party' || ev.target.id === 'pll-e-kind') pllLookupBalance(); pllAfter(); });
}
const PLL_HELP = {
  cr: 'Cr adds to what we owe the party (a bill, or an amount that has become payable).',
  dr: 'Dr is a payment made to the party; it reduces what we owe.',
  open: 'The amount already owed (Cr) or paid in advance (Dr) before you started using the app. It is carried forward into the ledger.',
};
function setPllType(t) {
  PLL.type = t;
  document.querySelectorAll('[data-pll-type]').forEach(b => b.classList.toggle('active', b.dataset.pllType === t));
  document.getElementById('pll-type-help').textContent = PLL_HELP[t];
  const open = t === 'open';
  document.getElementById('pll-e-date-l').textContent = open ? 'As on date *' : 'Date *';
  document.getElementById('pll-e-site-g').hidden = open; document.getElementById('pll-e-item-g').hidden = open;
  document.getElementById('pll-e-side-g').hidden = !open; document.getElementById('pll-e-paidby-g').hidden = t !== 'dr';
  document.getElementById('pll-e-desc-l').textContent = open ? 'Note' : 'Description';
  document.getElementById('pll-e-item').placeholder = t === 'dr' ? 'Payment' : 'Bill';
  pllAfter();
}
function openPllEntry() {
  const names = (PLL.options.parties || []).map(p => p.name);
  document.getElementById('pll-e-parties').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
  document.getElementById('pll-e-site').innerHTML = plSiteOptions('');
  document.getElementById('pll-e-kind').value = PLL.kind === 'outside' ? 'outside' : 'company';
  document.getElementById('pll-e-date').value = today();
  ['pll-e-party', 'pll-e-item', 'pll-e-amount', 'pll-e-paidby', 'pll-e-desc'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pll-e-party').value = PLL.view === 'party' ? PLL.party : '';
  document.getElementById('pll-e-side').value = 'cr'; document.getElementById('pll-e-error').textContent = '';
  PLL.entryHint = null; setPllType('cr'); pllLookupBalance();
  Payments.names().then(r => { document.getElementById('pll-e-paidbys').innerHTML = (r.paid_by || []).map(n => `<option value="${esc(n)}"></option>`).join(''); }).catch(() => {});
  document.getElementById('pll-entry-overlay').classList.add('open');
  setTimeout(() => document.getElementById('pll-e-party').focus(), 60);
}
function closePllEntry() { document.getElementById('pll-entry-overlay').classList.remove('open'); }

/** Shows the party's balance as it stands today (every entry, no date limits) so you see what the new entry changes. */
function pllLookupBalance() {
  const name = document.getElementById('pll-e-party').value.trim(), cur = document.getElementById('pll-e-cur'), my = ++PLL.entryLook || (PLL.entryLook = 1);
  PLL.entryLook = my;
  if (!name || !(PLL.options.parties || []).some(p => p.name.toLowerCase() === name.toLowerCase())) { PLL.entryHint = null; cur.textContent = name ? 'A new party — it will be created when you save.' : ''; pllAfter(); return; }
  Payments.ledger({ party: name }).then(r => { if (PLL.entryLook !== my) return; PLL.entryHint = r.data.closing; cur.textContent = `Current balance: ₹${pllSided(r.data.closing)}`; pllAfter(); }).catch(() => { cur.textContent = ''; });
}
function pllAfter() {
  const box = document.getElementById('pll-e-after'), amt = Number(document.getElementById('pll-e-amount').value) || 0, name = document.getElementById('pll-e-party').value.trim();
  if (!box) return;
  if (!name || !amt) { box.hidden = true; return; }
  const cur = PLL.entryHint ? (PLL.entryHint.side === 'cr' ? 1 : -1) * PLL.entryHint.amount : 0;
  const side = PLL.type === 'open' ? document.getElementById('pll-e-side').value : PLL.type;
  const next = r2(cur + (side === 'cr' ? amt : -amt));
  box.hidden = false; box.innerHTML = `<strong>After saving</strong><br>Closing balance for ${esc(name)} becomes <b>₹${pllSided({ amount: Math.abs(next), side: next < -0.004 ? 'dr' : 'cr' })}</b>${PLL.type === 'open' ? ' <small>(if this opening balance is dated before your other entries)</small>' : ''}`;
}

async function savePllEntry() {
  const g = id => document.getElementById(id).value.trim(), err = document.getElementById('pll-e-error'), btn = document.getElementById('pll-e-save');
  err.textContent = '';
  const party = g('pll-e-party'), amount = g('pll-e-amount'), date = g('pll-e-date'), kind = g('pll-e-kind');
  if (!party) { err.textContent = 'Enter the party name.'; return; }
  if (!(Number(amount) > 0)) { err.textContent = 'Enter an amount above 0.'; return; }
  if (!date) { err.textContent = 'Choose the date.'; return; }
  btn.disabled = true;
  try {
    if (PLL.type === 'open') await Payments.addOpening({ kind, party_name: party, as_on: date, side: g('pll-e-side'), amount, note: g('pll-e-desc') });
    else {
      const line = { pay_date: date, party_name: party, item: g('pll-e-item') || (PLL.type === 'cr' ? 'Bill' : 'Payment'), description: g('pll-e-desc'), site: g('pll-e-site'), paid_by: PLL.type === 'dr' ? g('pll-e-paidby') : '' };
      line[PLL.type === 'cr' ? 'payable' : 'paid'] = amount;
      await Payments.create({ kind, items: [line] });
    }
    closePllEntry(); showToast('Entry saved.');
    PLL.party = PLL.view === 'party' ? (PLL.party || party) : PLL.party;
    if (PL.rows) { PL.rows.company = null; PL.rows.outside = null; }
    loadPlLedgerView();
  } catch (e) { err.textContent = e.message || 'The entry could not be saved.'; }
  finally { btn.disabled = false; }
}

/** Called by app.js when Excel / PDF is chosen in the ledger's Export menu. */
function pllReportBody(format) {
  const p = pllParams();
  return { format, kind: p.kind || 'all', from: p.from || undefined, to: p.to || undefined, site: p.site || undefined, party: PLL.view === 'party' ? PLL.party : undefined };
}
