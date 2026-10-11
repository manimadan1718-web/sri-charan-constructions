/*
 * Shared by every page (app, login, privacy, 404, offline).
 *  • puts the CURRENT year in the footer (so it never goes out of date)
 *  • fills in the support e-mail / phone links, if the owner has set them on the server
 * No dependencies; if anything fails the page simply keeps working without the contact links.
 */
(function () {
  var year = String(new Date().getFullYear());
  [].forEach.call(document.querySelectorAll('[data-year]'), function (el) { el.textContent = year; });

  var slots = document.querySelectorAll('[data-contact]');
  if (!slots.length || !window.fetch) return;

  var EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
  var PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

  // A contact slot becomes a real link only when there is a real contact (so no empty links are ever on a page).
  function link(slot, href, text) {
    var a = document.createElement('a');
    a.href = href; a.textContent = text;
    a.setAttribute('data-contact', slot.getAttribute('data-contact'));
    if (slot.getAttribute('data-label')) a.setAttribute('data-label', slot.getAttribute('data-label'));
    slot.parentNode.replaceChild(a, slot);
  }

  fetch('/api/public-config', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg) return;
      var hasEmail = !!cfg.support_email && EMAIL_RE.test(cfg.support_email);
      var hasPhone = !!cfg.support_phone && PHONE_RE.test(cfg.support_phone);
      [].forEach.call(slots, function (slot) {
        var full = slot.getAttribute('data-label') === 'full';
        if (slot.getAttribute('data-contact') === 'email' && hasEmail) link(slot, 'mailto:' + cfg.support_email, full ? cfg.support_email : 'Email support');
        if (slot.getAttribute('data-contact') === 'phone' && hasPhone) link(slot, 'tel:' + cfg.support_phone.replace(/[^0-9+]/g, ''), full ? cfg.support_phone : 'Call support');
      });
      if (hasEmail || hasPhone) [].forEach.call(document.querySelectorAll('[data-contact-fallback]'), function (el) { el.hidden = true; });
    })
    .catch(function () { /* offline or server busy: no contact links, nothing else changes */ });
})();
