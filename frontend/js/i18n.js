/**
 * i18n.js — the language choice: English, Hindi, Telugu, Kannada, Tamil.
 *
 * Every person picks their own language; there is no limit on how many people use each one.
 *   • The choice is remembered on the phone (localStorage) and saved on the person's account, so it follows them.
 *   • Screens are written in English. This file swaps the English text for the translation (data: i18n-data.js),
 *     including text the app builds later (tables, messages, pop-ups), and swaps back when the language changes —
 *     no reload needed. Anything without a translation simply stays English.
 *   • In English it does nothing at all.
 *
 * Opt out: put data-no-i18n on an element (names typed by people are never matched anyway).
 */
(function () {
  'use strict';

  var LANGS = [
    { code: 'en', name: 'English' },
    { code: 'hi', name: 'हिन्दी' },
    { code: 'te', name: 'తెలుగు' },
    { code: 'kn', name: 'ಕನ್ನಡ' },
    { code: 'ta', name: 'தமிழ்' },
  ];
  var LOCALES = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ta: 'ta-IN' };
  var STORE = 'scc_lang';
  var DATA = window.I18N_DATA || {};
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'data-label'];   // data-label = the captions on the phone's card-style tables

  var lang = 'en';
  var listeners = [];
  var origText = new WeakMap();     // text node -> the English it had
  var wroteText = new WeakMap();    // text node -> what we last wrote into it
  var origAttr = new WeakMap();     // element  -> { attr: { orig, wrote } }

  /** One shared way of comparing texts (also used when the data file is built). */
  function norm(s) {
    return String(s).replace(/\u2026/g, '...').replace(/\u00d7/g, 'x').replace(/\u20b9/g, 'Rs')
      .replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function known(code) { return LANGS.some(function (l) { return l.code === code; }); }

  function lookup(text, ctx) {
    if (lang === 'en') return null;
    var d = DATA[lang]; if (!d) return null;
    var k = norm(text); if (!k) return null;
    if (ctx && d[ctx + ':' + k] != null) return d[ctx + ':' + k];
    if (d[k] != null) return d[k];
    var nums = k.match(/\d[\d,]*(?:\.\d+)?/g);                           // "6 records" -> the phrase "{n} records", with the number put back
    if (nums && nums.length === 1) {
      var pk = k.replace(nums[0], '{n}');
      if (d[pk] != null) return d[pk].replace('{n}', nums[0]);
    }
    return null;
  }
  /** For text the app composes itself, e.g. t('Good Morning'). Returns the English unchanged if there is no translation. */
  function t(text) { var r = lookup(text, ''); return r == null ? text : r; }

  function optedOut(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hasAttribute('data-no-i18n') || e.getAttribute('translate') === 'no') return true;
    }
    return false;
  }
  function textSkipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) { if (SKIP[e.tagName] || e.isContentEditable) return true; }
    return optedOut(el);
  }

  function doText(node) {
    var el = node.parentElement; if (!el || textSkipped(el)) return;
    var cur = node.nodeValue;
    var had = origText.has(node);
    var orig = had ? origText.get(node) : cur;
    if (had && wroteText.get(node) !== cur) orig = cur;                // the app wrote new English text into this node
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(orig); if (!m || !m[2]) return;
    var tr = lookup(m[2], el.tagName === 'TH' ? 'th' : '');
    if (tr == null && !had) return;                                    // nothing to do, nothing to remember
    var next = tr == null ? orig : m[1] + tr + m[3];
    origText.set(node, orig);
    if (next !== cur) node.nodeValue = next;
    wroteText.set(node, next);
  }

  function doAttrs(el) {
    if (!el.getAttribute || optedOut(el)) return;
    var store = origAttr.get(el);
    ATTRS.forEach(function (attr) {
      var v = el.getAttribute(attr); if (v == null) return;
      var rec = store && store[attr];
      var orig = rec ? rec.orig : v;
      if (rec && v !== rec.wrote) orig = v;
      var tr = lookup(orig, attr === 'data-label' ? 'th' : '');
      if (tr == null && !rec) return;
      var next = tr == null ? orig : tr;
      if (next !== v) el.setAttribute(attr, next);
      if (!store) { store = {}; origAttr.set(el, store); }
      store[attr] = { orig: orig, wrote: next };
    });
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    root.querySelectorAll('[placeholder],[title],[aria-label],[data-label]').forEach(doAttrs);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n, list = [];
    while ((n = tw.nextNode())) list.push(n);
    list.forEach(doText);
  }

  var obs = null;
  function observe() {
    if (!obs) return;
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function onMutations(records) {
    if (lang === 'en') return;
    obs.disconnect();                                                  // our own writes must not trigger us again
    try {
      records.forEach(function (r) {
        if (r.type === 'childList') r.addedNodes.forEach(walk);
        else if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttrs(r.target);
      });
    } finally { observe(); }
  }

  function applyAll() {
    if (obs) obs.disconnect();
    try { walk(document.body); } finally { observe(); }
  }

  /* ── The five-language switch (login page, phone menu, sidebar, header) ─────────────────────────────────── */
  function renderSwitches() {
    document.querySelectorAll('[data-lang-switch]').forEach(function (box) {
      var kind = box.getAttribute('data-lang-switch');
      if (!box.getAttribute('data-built')) {
        box.setAttribute('data-built', '1');
        box.setAttribute('translate', 'no');
        if (!box.hasAttribute('role')) { box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Language'); }
        box.innerHTML = '';
        if (kind === 'select') {
          var sel = document.createElement('select');
          sel.setAttribute('data-lang-select', '1');
          sel.setAttribute('aria-label', 'Language');
          LANGS.forEach(function (l) { var o = document.createElement('option'); o.value = l.code; o.textContent = l.name; o.lang = l.code; sel.appendChild(o); });
          box.appendChild(sel);
        } else {
          LANGS.forEach(function (l) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'lang-btn'; b.setAttribute('data-lang-code', l.code); b.lang = l.code; b.textContent = l.name;
            box.appendChild(b);
          });
        }
      }
      box.querySelectorAll('[data-lang-code]').forEach(function (b) {
        var on = b.getAttribute('data-lang-code') === lang;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('active', on);
      });
      var s = box.querySelector('select'); if (s) s.value = lang;
    });
  }

  /* ── Remembering the choice on the person's account (best effort; silent if it fails) ─────────────────── */
  function saveToAccount(code) {
    var token = null; try { token = sessionStorage.getItem('scc_token'); } catch (e) { /* no storage */ }
    if (!token || !known(code)) return;
    try {
      fetch('/api/auth/language', {
        method: 'PUT', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ language: code }),
      }).catch(function () { /* the phone still remembers it */ });
    } catch (e) { /* ignore */ }
  }

  function set(code, opts) {
    opts = opts || {};
    if (!known(code)) code = 'en';
    var changed = code !== lang;
    lang = code;
    try { localStorage.setItem(STORE, code); } catch (e) { /* private mode */ }
    document.documentElement.lang = code;
    document.documentElement.setAttribute('data-lang', code);
    applyAll();
    renderSwitches();
    if (!opts.silent) {
      listeners.forEach(function (fn) { try { fn(code, changed); } catch (e) { /* a listener must not break the others */ } });
      try { document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: code, user: !!opts.user } })); } catch (e) { /* old browser */ }
    }
    if (opts.user) saveToAccount(code);
  }

  function boot() {
    var saved = 'en'; try { saved = localStorage.getItem(STORE) || 'en'; } catch (e) { /* private mode */ }
    if (!known(saved) || (saved !== 'en' && !DATA[saved])) saved = 'en';
    if (typeof MutationObserver === 'function') obs = new MutationObserver(onMutations);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-lang-code]') : null;
      if (b) set(b.getAttribute('data-lang-code'), { user: true });
    });
    document.addEventListener('change', function (e) {
      if (e.target && e.target.matches && e.target.matches('select[data-lang-select]')) set(e.target.value, { user: true });
    });
    set(saved, { silent: true });
  }

  window.I18N = {
    LANGS: LANGS,
    lang: function () { return lang; },
    set: set,
    t: t,
    known: known,
    norm: norm,
    locale: function () { return LOCALES[lang] || 'en-IN'; },
    onChange: function (fn) { listeners.push(fn); },
    saveToAccount: saveToAccount,
    refresh: function () { applyAll(); renderSwitches(); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
