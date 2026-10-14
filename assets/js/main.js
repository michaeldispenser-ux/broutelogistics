/* Public site: shipment tracking, enquiry form, chat assistant. */
(function () {
  'use strict';

  var U = window.BrouteUtils, API = window.BrouteAPI;
  var h = U.h, icon = U.icon;
  U.initNav();

  var STEP_ICONS = { 'Created': 'package', 'In Transit': 'plane', 'Out for Delivery': 'truck', 'Delivered': 'check' };

  function slug(s) { return 's-' + s.toLowerCase().replace(/\s+/g, '-'); }
  function notice(box, kind, content) { box.replaceChildren(h('div', { class: 'notice ' + kind, role: 'status' }, content)); }
  function busy(btn, on, label) {
    btn.disabled = on;
    var span = btn.querySelector('span');
    if (span && label) span.textContent = on ? 'Please wait…' : label;
  }

  /* ---------------- Tracking ---------------- */
  var form = document.getElementById('trackForm');
  var input = document.getElementById('trackInput');
  var btn = document.getElementById('trackBtn');
  var out = document.getElementById('trackResult');

  function meta(label, value) { return [h('dt', { text: label }), h('dd', { text: value || '–' })]; }

  function renderShipment(s) {
    var events = (s.events || []).slice();
    var reached = 0;
    events.forEach(function (e) { var i = API.FLOW.indexOf(e.status); if (i > reached) reached = i; });
    var idx = Math.max(reached, API.FLOW.indexOf(s.status));
    var pct = Math.round((idx / (API.FLOW.length - 1)) * 10000) / 100;

    var nodes = [
      h('div', { class: 'result-head' },
        h('h3', { text: s.tracking_no }),
        h('span', { class: 'badge ' + slug(s.status), text: s.status }))
    ];

    if (s.status === 'Cancelled') {
      nodes.push(h('div', { class: 'notice error' }, 'This shipment has been cancelled. Please contact us if you have questions.'));
    } else {
      var stepper = h('ol', { class: 'stepper', 'aria-label': 'Delivery progress' },
        API.FLOW.map(function (st, i) {
          return h('li', { class: 'step' + (i <= idx ? ' done' : ''), 'aria-current': st === s.status ? 'step' : null },
            h('span', { class: 'dot' }, icon(STEP_ICONS[st])), st);
        }));
      stepper.style.setProperty('--progress', pct + '%');
      nodes.push(stepper);
      if (s.status === 'On Hold') nodes.push(h('div', { class: 'notice info' }, 'This shipment is currently on hold. See the latest update below.'));
    }

    nodes.push(
      h('dl', { class: 'meta-grid' },
        meta('Goods', s.description), meta('Service', s.service), meta('Origin', s.origin), meta('Destination', s.destination),
        meta('Current location', s.current_location), meta('Last update', U.formatDate(s.updated_at))),
      h('h4', { class: 'h3', text: 'Shipment history' }),
      h('ol', { class: 'timeline', 'aria-label': 'Shipment history' },
        events.map(function (e) {
          return h('li', null,
            h('time', { datetime: new Date(e.created_at).toISOString(), text: U.formatDate(e.created_at) }),
            h('strong', { text: e.note || e.status }),
            e.location ? ' – ' + e.location : '');
        })));
    out.replaceChildren.apply(out, nodes);
  }

  function lookup(raw) {
    var id = API.normalizeTracking(raw);
    if (!id) return notice(out, 'error', 'Please enter a valid tracking number, for example BRT-7K3M9QXD2P.');
    busy(btn, true, 'Track shipment');
    API.track(id).then(function (s) {
      if (!s) { notice(out, 'error', 'We could not find a shipment with the number ' + id + '. Please check it and try again.'); return; }
      renderShipment(s);
      try { history.replaceState(null, '', '?track=' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
    }).catch(function (e) { notice(out, 'error', e.message); })
      .then(function () { busy(btn, false, 'Track shipment'); });
  }

  if (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); lookup(input.value); });
    var q = new URLSearchParams(location.search).get('track');
    if (q) { input.value = q.slice(0, 24); lookup(q); }
  }

  /* ---------------- Enquiry form ---------------- */
  var inq = document.getElementById('inquiryForm');
  var inqMsg = document.getElementById('inquiryMsg');
  var qBtn = document.getElementById('qBtn');
  if (inq) {
    inq.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(inq);
      var data = { name: String(fd.get('name') || '').trim(), email: String(fd.get('email') || '').trim(), phone: String(fd.get('phone') || '').trim(),
        service: String(fd.get('service') || ''), message: String(fd.get('message') || '').trim(), website: String(fd.get('website') || '') };
      if (!data.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email) || data.message.length < 5) {
        return notice(inqMsg, 'error', 'Please enter your name, a valid email address and a short message.');
      }
      qBtn.disabled = true;
      API.submitInquiry(data).then(function () {
        inq.reset();
        notice(inqMsg, 'success', 'Thank you. Your request has been sent and we will reply by email.');
      }).catch(function (err) { notice(inqMsg, 'error', err.message); })
        .then(function () { qBtn.disabled = false; });
    });
  }

  /* ---------------- Chat assistant ---------------- */
  var toggle = document.getElementById('chatToggle');
  var panel = document.getElementById('chatPanel');
  var log = document.getElementById('chatLog');
  var chatForm = document.getElementById('chatForm');
  var chatInput = document.getElementById('chatInput');
  var greeted = false;
  var TRACK_RE = /\bBRT[-\s]?[A-Z0-9]{6,14}\b/i;

  function say(who, text) {
    log.appendChild(h('div', { class: 'msg ' + who, text: text }));
    log.scrollTop = log.scrollHeight;
  }

  function faq(text) {
    var t = text.toLowerCase();
    if (/air|fast|urgent|priority/.test(t)) return 'Our air freight service handles high-priority international shipments.';
    if (/ocean|sea|container|bulk/.test(t)) return 'Ocean freight is our cost-effective option for large, bulk container shipments.';
    if (/express|door|parcel|courier/.test(t)) return 'Express logistics gives you door-to-door parcel delivery with end-to-end tracking.';
    if (/quote|price|cost|rate/.test(t)) return 'For a quote, please use the "Get a quote" form on this page and we will reply by email.';
    if (/track|where|status/.test(t)) return 'Send me your tracking number (like BRT-7K3M9QXD2P) and I will look it up.';
    if (/^(hi|hello|hey)\b/.test(t)) return 'Hello! Paste a tracking number or ask about our services.';
    return 'I can look up a tracking number or tell you about air, ocean and express freight. For anything else, please use the contact form on this page.';
  }

  function reply(text) {
    var m = text.match(TRACK_RE);
    if (m) {
      return API.track(m[0]).then(function (s) {
        return s ? s.tracking_no + ' is "' + s.status + '". Last known location: ' + (s.current_location || 'not available') + '. Route: ' + s.origin + ' to ' + s.destination + '.'
                 : 'I could not find that tracking number. Please check it and try again.';
      }, function () { return 'Sorry, I could not look that up right now. Please try again shortly.'; });
    }
    return API.chat(text).catch(function () { return faq(text); });
  }

  function setChat(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!greeted) { say('bot', 'Hi! I am the Broute assistant. Paste a tracking number or ask about our services.'); greeted = true; }
      chatInput.focus();
    } else { toggle.focus(); }
  }

  if (toggle && panel) {
    toggle.addEventListener('click', function () { setChat(panel.hidden); });
    document.getElementById('chatClose').addEventListener('click', function () { setChat(false); });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') setChat(false); });
    chatForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      say('user', text);
      reply(text).then(function (r) { say('bot', r); });
    });
  }
})();
