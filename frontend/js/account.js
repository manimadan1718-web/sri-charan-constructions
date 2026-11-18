/* ═══════════════════════════════════════════════════════════════════════════════
   The menu under the user's name (top right): Learn Guide · Feedback · Change PIN  (Admin also: Feedback inbox)
   Loaded after app.js and api.js (uses apiFetch, Auth, can, showToast, esc, askConfirm).
   ═══════════════════════════════════════════════════════════════════════════════ */
const Account = {
  changePin(new_pin) { return apiFetch('/account/change-pin', { method: 'POST', body: JSON.stringify({ new_pin }) }); },
};
const Feedback = {
  send(kind, message, page, rating) { return apiFetch('/feedback', { method: 'POST', body: JSON.stringify({ kind, message, page, rating }) }); },
  list() { return apiFetch('/feedback'); },
  mark(id, status) { return apiFetch(`/feedback/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) }); },
  remove(id) { return apiFetch(`/feedback/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
};
const umEl = id => document.getElementById(id);
const umIsAdmin = () => { const u = Auth.currentUser(); return !!u && u.role === 'admin'; };

/* ── the dropdown ── */
function umClose() { const m = umEl('um-menu'), t = umEl('header-user'); if (m) m.hidden = true; if (t) t.setAttribute('aria-expanded', 'false'); }
function umToggle() {
  const m = umEl('um-menu'), t = umEl('header-user'); if (!m) return;
  const open = m.hidden; m.hidden = !open; t.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { umEl('um-inbox').hidden = !umIsAdmin(); const f = m.querySelector('button'); if (f) f.focus(); if (umIsAdmin()) umCountNew(); }
}
async function umCountNew() {
  try { const r = await Feedback.list(); const n = r.unread || 0, b = umEl('um-inbox-n'); b.textContent = n; b.hidden = !n; } catch (e) { /* only a courtesy */ }
}
document.addEventListener('DOMContentLoaded', () => {
  const t = umEl('header-user'), m = umEl('um-menu'); if (!t || !m) return;
  t.setAttribute('role', 'button'); t.setAttribute('tabindex', '0'); t.setAttribute('aria-haspopup', 'menu'); t.setAttribute('aria-expanded', 'false'); t.setAttribute('aria-controls', 'um-menu');
  t.addEventListener('click', ev => { ev.stopPropagation(); umToggle(); });
  t.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); umToggle(); } else if (ev.key === 'Escape') umClose(); });
  m.addEventListener('keydown', ev => { if (ev.key === 'Escape') { umClose(); t.focus(); } });
  document.addEventListener('click', ev => { if (!m.hidden && !m.contains(ev.target) && ev.target !== t) umClose(); });
  m.addEventListener('click', ev => {
    const b = ev.target.closest('[data-um]'); if (!b) return;
    umClose();
    const a = b.dataset.um;
    if (a === 'guide') openGuide(guideSectionForCurrentTab());
    else if (a === 'feedback') openFeedback();
    else if (a === 'pin') openChangePin();
    else if (a === 'inbox') openInbox();
  });
});

/* the same choices inside the phone's main menu (the top bar is hidden there) */
document.addEventListener('DOMContentLoaded', () => {
  const mm = umEl('mm-account'); if (!mm) return;
  const inbox = umEl('mm-inbox'); if (inbox) inbox.hidden = !umIsAdmin();
  mm.addEventListener('click', ev => {
    const b = ev.target.closest('[data-um]'); if (!b) return;
    if (typeof closeMobileMenu === 'function') closeMobileMenu(false);
    const a = b.dataset.um;
    if (a === 'guide') openGuide(guideSectionForCurrentTab()); else if (a === 'feedback') openFeedback(); else if (a === 'pin') openChangePin(); else if (a === 'inbox') openInbox();
  });
});

/* ── Change PIN ── */
function openChangePin() {
  ['pin-new', 'pin-new2'].forEach(id => { umEl(id).value = ''; umEl(id).type = 'password'; });
  umEl('pin-show').checked = false; umEl('pin-err').textContent = '';
  umEl('pin-overlay').classList.add('open'); setTimeout(() => umEl('pin-new').focus(), 50);
}
function closeChangePin() { umEl('pin-overlay').classList.remove('open'); }
async function saveChangePin() {
  const n1 = umEl('pin-new').value, n2 = umEl('pin-new2').value, err = umEl('pin-err'), btn = umEl('pin-save');
  err.textContent = '';
  if (!/^\S{4,10}$/.test(n1)) { err.textContent = 'The new PIN must be 4 to 10 characters with no spaces.'; umEl('pin-new').focus(); return; }
  if (n1 !== n2) { err.textContent = 'The two new PINs are not the same.'; umEl('pin-new2').focus(); return; }
  btn.disabled = true;
  try { await Account.changePin(n1); closeChangePin(); showToast('Your PIN has been changed. Use the new PIN next time you sign in.'); }
  catch (e) { err.textContent = e.message || 'Your PIN could not be changed.'; }
  finally { btn.disabled = false; }
}

/* ── Feedback (everyone) ── */
const FB_STAR_WORDS = ['Tap a star', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
let fbRating = 0;
function fbSetRating(n) {
  fbRating = n;
  document.querySelectorAll('#fb-stars [data-star]').forEach(b => { const on = +b.dataset.star <= n; b.classList.toggle('on', on); b.setAttribute('aria-checked', +b.dataset.star === n ? 'true' : 'false'); });
  umEl('fb-star-text').textContent = FB_STAR_WORDS[n];
}
function openFeedback() {
  fbSetRating(0);
  umEl('fb-kind').value = 'suggestion'; umEl('fb-msg').value = ''; umEl('fb-err').textContent = ''; fbCount();
  umEl('fb-overlay').classList.add('open'); setTimeout(() => umEl('fb-msg').focus(), 50);
}
function closeFeedback() { umEl('fb-overlay').classList.remove('open'); }
function fbCount() { const n = umEl('fb-msg').value.length; umEl('fb-count').textContent = `${n} / 1500`; }
async function sendFeedback() {
  const kind = umEl('fb-kind').value, msg = umEl('fb-msg').value.trim(), err = umEl('fb-err'), btn = umEl('fb-send');
  err.textContent = '';
  if (msg.length < 5) { err.textContent = 'Please write a little more (at least 5 characters).'; umEl('fb-msg').focus(); return; }
  const tab = document.querySelector('.tab.active'), page = tab ? (tab.textContent || '').trim().slice(0, 60) : '';
  btn.disabled = true;
  try { await Feedback.send(kind, msg, page, fbRating || null); closeFeedback(); showToast('Thank you. Your feedback has been sent to the Admin.'); }
  catch (e) { err.textContent = e.message || 'Your feedback could not be sent.'; }
  finally { btn.disabled = false; }
}

/* ── Feedback inbox (Admin) ── */
const FB_KIND = { suggestion: 'Suggestion', problem: 'Problem', question: 'Question' };
async function openInbox() { umEl('inbox-overlay').classList.add('open'); await loadInbox(); }
function closeInbox() { umEl('inbox-overlay').classList.remove('open'); umCountNew(); }
async function loadInbox() {
  const list = umEl('inbox-list'), sub = umEl('inbox-sub');
  list.innerHTML = '<p class="fb-empty">Loading…</p>';
  try {
    const r = await Feedback.list();
    if (r.setup_required) { list.innerHTML = '<p class="fb-empty">Feedback needs a one-time database update. Run run-in-supabase-16-feedback.sql in Supabase, then reload this page.</p>'; sub.textContent = ''; return; }
    sub.textContent = r.data.length ? `${r.data.length} message${r.data.length === 1 ? '' : 's'} · ${r.unread} new` : '';
    list.innerHTML = r.data.length ? r.data.map(f => `<article class="fb-item${f.status === 'new' ? ' fb-new' : ''}" data-id="${esc(f.id)}">
        <div class="fb-meta"><span class="fb-kind fb-${esc(f.kind)}">${esc(FB_KIND[f.kind] || f.kind)}</span>${f.rating ? `<span class="fb-rated" title="${esc(f.rating)} out of 5">${'&#9733;'.repeat(f.rating)}${'&#9734;'.repeat(5 - f.rating)}</span>` : ''}<strong>${esc(f.user_name || 'Someone')}</strong><span>${esc(f.user_role || '')}</span><span>${esc(new Date(f.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>${f.page ? `<span>on ${esc(f.page)}</span>` : ''}</div>
        <p class="fb-text">${esc(f.message)}</p>
        <div class="fb-actions"><button type="button" class="btn btn-outline btn-sm" data-fb="${f.status === 'new' ? 'read' : 'new'}">${f.status === 'new' ? 'Mark as read' : 'Mark as new'}</button><button type="button" class="btn btn-outline btn-sm" data-fb="del">Delete</button></div>
      </article>`).join('') : '<p class="fb-empty">No feedback yet.</p>';
  } catch (e) { list.innerHTML = `<p class="fb-empty">${esc(e.message || 'The feedback could not be loaded.')}</p>`; }
}
document.addEventListener('DOMContentLoaded', () => {
  const list = umEl('inbox-list'); if (!list) return;
  list.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-fb]'); if (!b) return;
    const id = b.closest('[data-id]').dataset.id, act = b.dataset.fb;
    try {
      if (act === 'del') { if (!(await askConfirm({ title: 'Delete this feedback?', message: 'It will be removed for good.', yesLabel: 'Delete', noLabel: 'Keep' }))) return; await Feedback.remove(id); }
      else await Feedback.mark(id, act);
      loadInbox();
    } catch (e) { showToast(e.message || 'Could not do that.', true); }
  });
  umEl('fb-msg').addEventListener('input', fbCount);
  umEl('fb-stars').addEventListener('click', ev => { const b = ev.target.closest('[data-star]'); if (b) fbSetRating(+b.dataset.star === fbRating ? 0 : +b.dataset.star); });
  ['pin-overlay', 'fb-overlay', 'inbox-overlay'].forEach(id => umEl(id).addEventListener('mousedown', ev => { if (ev.target === umEl(id)) { if (id === 'pin-overlay') closeChangePin(); else if (id === 'fb-overlay') { if (!umEl('fb-msg').value.trim()) closeFeedback(); } else closeInbox(); } }));
  umEl('pin-show').addEventListener('change', ev => { ['pin-new', 'pin-new2'].forEach(i => { umEl(i).type = ev.target.checked ? 'text' : 'password'; }); });
  ['pin-new', 'pin-new2'].forEach(i => umEl(i).addEventListener('keydown', ev => { if (ev.key === 'Enter') saveChangePin(); }));
  document.addEventListener('keydown', ev => { if (ev.key !== 'Escape') return; ['pin-overlay', 'fb-overlay', 'inbox-overlay'].forEach(id => { if (umEl(id).classList.contains('open')) { if (id === 'pin-overlay') closeChangePin(); else if (id === 'fb-overlay') closeFeedback(); else closeInbox(); } }); });
});
