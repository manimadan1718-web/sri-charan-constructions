/*
 * The print view of a stored document.
 *   /print.html?t=<2-minute link token>&n=<document name>&e=<file type>
 * PDFs are shown in a frame and printed by the browser's own PDF viewer; pictures and text are printed from this page.
 * Either way the browser's print window opens, where the person chooses paper size, orientation, scale and printer.
 */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var token = q.get('t') || '';
  var name = (q.get('n') || 'Document').slice(0, 200);
  var ext = String(q.get('e') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  var url = '/api/files/view?t=' + encodeURIComponent(token);
  var stage = document.getElementById('pv-stage');
  var msg = document.getElementById('pv-msg');
  var frame = null;
  window.__sccPrintAttempts = 0;           // how many times printing was requested (used by the tests)

  document.title = 'Print – ' + name;
  document.getElementById('pv-name').textContent = name;

  function fail(text) { msg.textContent = text; msg.hidden = false; document.getElementById('pv-print').disabled = true; }

  function doPrint() {
    window.__sccPrintAttempts++;
    try {
      if (frame && frame.contentWindow) { frame.contentWindow.focus(); frame.contentWindow.print(); }   // a PDF: its own viewer prints it
      else window.print();
    } catch (e) {
      msg.textContent = 'The print window could not be opened automatically. Press Ctrl+P (or ⌘P on a Mac) to print.';
      msg.hidden = false;
    }
  }

  document.getElementById('pv-print').addEventListener('click', doPrint);
  document.getElementById('pv-close').addEventListener('click', function () { window.close(); history.length > 1 ? history.back() : (location.href = '/'); });

  var IMAGES = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1 };

  if (!token) {
    fail('This print link is not valid. Go back to the app and press Print again.');
  } else if (ext === 'pdf') {
    // Is the link still good? (a quick header-only check — otherwise a dead link would show, and print, an error page)
    fetch(url, { method: 'HEAD' }).then(function (r) {
      if (!r.ok) throw new Error('expired');
      frame = document.createElement('iframe');
      frame.title = name;
      frame.src = url;
      frame.addEventListener('load', function () { setTimeout(doPrint, 700); });      // give the PDF viewer a moment to start
      stage.appendChild(frame);
    }).catch(function () { fail('The document could not be loaded. The link may have expired — go back to the app and press Print again.'); });
  } else if (IMAGES[ext]) {
    var img = new Image();
    img.alt = name;
    img.addEventListener('load', function () { setTimeout(doPrint, 300); });
    img.addEventListener('error', function () { fail('The picture could not be loaded. The link may have expired — go back to the app and press Print again.'); });
    img.src = url;
    stage.appendChild(img);
  } else if (ext === 'txt' || ext === 'csv') {
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('expired');
      return r.text();
    }).then(function (text) {
      var pre = document.createElement('pre');
      pre.textContent = text;                          // text, never HTML
      stage.appendChild(pre);
      setTimeout(doPrint, 300);
    }).catch(function () { fail('The document could not be loaded. The link may have expired — go back to the app and press Print again.'); });
  } else {
    fail('This kind of file cannot be printed from the browser. Download it and print it from the program that opens it (for example Word or Excel).');
  }
})();
