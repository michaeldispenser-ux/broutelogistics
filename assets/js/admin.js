/* Staff console. All authorisation is enforced by the database (RLS + is_admin()); this UI just reflects it. */
(function () {
  'use strict';

  var U = window.BrouteUtils, API = window.BrouteAPI;
  var h = U.h;
  U.initNav();

  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 25;
  var state = { offset: 0, total: 0, q: '', status: '', current: null };

  /* ---------- helpers ---------- */
  function notice(box, kind, content) { box.replaceChildren(h('div', { class: 'notice ' + kind, role: 'status' }, content)); }
  function clear(box) { box.replaceChildren(); }
  function slug(s) { return 's-' + s.toLowerCase().replace(/\s+/g, '-'); }
  function badge(status) { return h('span', { class: 'badge ' + slug(status), text: status }); }
  function fail(box, err) {
    if (err && (err.status === 401 || err.code === 'expired')) return signedOut('Your session has expired. Please sign in again.');
    notice(box, 'error', (err && err.message) || 'Something went wrong.');
  }
  function fillSelect(sel, items, first) {
    sel.replaceChildren.apply(sel, (first ? [h('option', { value: '', text: first })] : []).concat(items.map(function (v) { return h('option', { value: v, text: v }); })));
  }

  /* ---------- views ---------- */
  function showLogin(msg) {
    $('appView').hidden = true; $('loginView').hidden = false;
    $('logoutBtn').hidden = true; $('whoami').hidden = true;
    if (msg) notice($('loginMsg'), 'info', msg); else clear($('loginMsg'));
    if (!API.configured) notice($('loginMsg'), 'error', 'The staff console is not configured yet. See the README (Supabase setup).');
  }
  function signedOut(msg) { API.logout().then(function () { showLogin(msg); }); }

  function enter(user) {
    $('loginView').hidden = true; $('appView').hidden = false;
    $('logoutBtn').hidden = false;
    var who = $('whoami'); who.hidden = false; who.textContent = user && user.email ? user.email : '';
    loadShipments(); loadInquiries();
  }

  /* ---------- sign in / out ---------- */
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('lBtn'); btn.disabled = true;
    API.login($('lEmail').value.trim(), $('lPass').value)
      .then(function (user) { $('lPass').value = ''; enter(user); })
      .catch(function (err) { notice($('loginMsg'), 'error', err.message); })
      .then(function () { btn.disabled = false; });
  });
  $('logoutBtn').addEventListener('click', function () { signedOut('You have been signed out.'); });

  /* ---------- tabs ---------- */
  function selectTab(which) {
    var ship = which === 'ship';
    $('tabShip').setAttribute('aria-selected', String(ship));
    $('tabInq').setAttribute('aria-selected', String(!ship));
    $('panelShip').hidden = !ship; $('panelInq').hidden = ship;
  }
  $('tabShip').addEventListener('click', function () { selectTab('ship'); });
  $('tabInq').addEventListener('click', function () { selectTab('inq'); });

  /* ---------- create shipment ---------- */
  fillSelect($('statusFilter'), API.STATUSES, 'All statuses');
  var createForm = $('createForm');
  createForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(createForm), v = function (k) { return String(fd.get(k) || '').trim(); };
    if (!v('description') || !v('origin') || !v('destination')) return notice($('createMsg'), 'error', 'Goods description, origin and destination are required.');
    var btn = $('createBtn'); btn.disabled = true;
    API.createShipment({ description: v('description'), service: v('service'), origin: v('origin'), destination: v('destination'),
      sender: v('sender'), recipient: v('recipient'), contact: v('contact'), weight: v('weight') })
      .then(function (s) {
        var copy = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Copy number' });
        copy.addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(s.tracking_no).then(function () { copy.textContent = 'Copied'; }); });
        notice($('createMsg'), 'success', [h('strong', { text: 'Shipment created. ' }), 'Tracking number: ', h('b', { class: 'mono', text: s.tracking_no }), ' ', copy]);
        createForm.reset(); state.offset = 0; loadShipments();
      })
      .catch(function (err) { fail($('createMsg'), err); })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- shipment list ---------- */
  function loadShipments() {
    API.listShipments({ q: state.q, status: state.status, limit: PAGE, offset: state.offset }).then(function (r) {
      state.total = r.total; clear($('listMsg'));
      $('emptyState').hidden = r.items.length > 0;
      var rows = r.items.map(function (s) {
        var manage = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Manage', 'aria-label': 'Manage ' + s.tracking_no });
        manage.addEventListener('click', function () { openShipment(s); });
        return h('tr', null,
          h('td', { 'data-label': 'Tracking no.' }, h('a', { class: 'mono', href: 'index.html?track=' + encodeURIComponent(s.tracking_no), target: '_blank', rel: 'noopener', text: s.tracking_no })),
          h('td', { 'data-label': 'Goods', text: s.description }),
          h('td', { 'data-label': 'Route', text: s.origin + ' → ' + s.destination }),
          h('td', { 'data-label': 'Status' }, badge(s.status)),
          h('td', { 'data-label': 'Updated', text: U.formatDate(s.updated_at) }),
          h('td', { 'data-label': '' }, manage));
      });
      $('shipmentRows').replaceChildren.apply($('shipmentRows'), rows);
      var pages = Math.max(1, Math.ceil(r.total / PAGE));
      $('pageInfo').textContent = 'Page ' + (Math.floor(state.offset / PAGE) + 1) + ' of ' + pages + ' (' + r.total + ' shipments)';
      $('prevBtn').disabled = state.offset <= 0;
      $('nextBtn').disabled = state.offset + PAGE >= r.total;
    }).catch(function (err) { fail($('listMsg'), err); });
  }
  $('prevBtn').addEventListener('click', function () { state.offset = Math.max(0, state.offset - PAGE); loadShipments(); });
  $('nextBtn').addEventListener('click', function () { state.offset += PAGE; loadShipments(); });
  var timer;
  $('searchBox').addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { state.q = $('searchBox').value; state.offset = 0; loadShipments(); }, 300);
  });
  $('statusFilter').addEventListener('change', function () { state.status = $('statusFilter').value; state.offset = 0; loadShipments(); });

  /* ---------- shipment dialog ---------- */
  var dlg = $('shipDialog');
  function dm(label, value) { return [h('dt', { text: label }), h('dd', { text: value || '–' })]; }

  function paintDialog(s) {
    $('dlgTitle').textContent = s.tracking_no;
    $('dlgMeta').replaceChildren.apply($('dlgMeta'), [].concat(
      dm('Status', s.status), dm('Goods', s.description), dm('Service', s.service), dm('Route', s.origin + ' → ' + s.destination),
      dm('Sender', s.sender_name), dm('Recipient', s.recipient_name), dm('Recipient contact', s.recipient_contact),
      dm('Weight', s.weight_kg ? s.weight_kg + ' kg' : ''), dm('Current location', s.current_location)));
    var closed = s.status === 'Delivered' || s.status === 'Cancelled';
    ['evStatus', 'evLocation', 'evNote', 'evBtn'].forEach(function (id) { $(id).disabled = closed; });
    if (closed) notice($('dlgMsg'), 'info', 'This shipment is closed and can no longer be changed.'); else clear($('dlgMsg'));
    $('evStatus').value = s.status;
  }

  function paintHistory(events) {
    $('dlgHistory').replaceChildren.apply($('dlgHistory'), events.map(function (e) {
      return h('li', null, h('time', { datetime: new Date(e.created_at).toISOString(), text: U.formatDate(e.created_at) }),
        h('strong', { text: e.status }), (e.location ? ' – ' + e.location : '') + (e.note ? ' · ' + e.note : ''));
    }));
  }

  function openShipment(s) {
    state.current = s;
    fillSelect($('evStatus'), API.STATUSES);
    $('evLocation').value = ''; $('evNote').value = '';
    paintDialog(s); $('dlgHistory').replaceChildren();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    API.listEvents(s.id).then(paintHistory).catch(function (err) { fail($('dlgMsg'), err); });
  }
  $('dlgClose').addEventListener('click', function () { dlg.close ? dlg.close() : dlg.removeAttribute('open'); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg && dlg.close) dlg.close(); });

  $('eventForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var s = state.current; if (!s) return;
    var btn = $('evBtn'); btn.disabled = true;
    API.addEvent(s.id, $('evStatus').value, $('evLocation').value.trim(), $('evNote').value.trim())
      .then(function (updated) {
        state.current = updated; paintDialog(updated);
        if (updated.status !== 'Delivered' && updated.status !== 'Cancelled') btn.disabled = false;
        $('evLocation').value = ''; $('evNote').value = '';
        notice($('dlgMsg'), 'success', 'Update saved. Customers can see it now.');
        loadShipments();
        return API.listEvents(s.id).then(paintHistory);
      })
      .catch(function (err) { btn.disabled = false; fail($('dlgMsg'), err); });
  });

  /* ---------- enquiries ---------- */
  function loadInquiries() {
    API.listInquiries().then(function (items) {
      var open = items.filter(function (i) { return !i.handled; }).length;
      var c = $('inqCount'); c.hidden = open === 0; c.textContent = open;
      $('inqEmpty').hidden = items.length > 0; clear($('inqMsg'));
      $('inqList').replaceChildren.apply($('inqList'), items.map(function (i) {
        var chk = h('input', { type: 'checkbox', id: 'inq-' + i.id, checked: i.handled ? true : null });
        chk.addEventListener('change', function () {
          API.setInquiryHandled(i.id, chk.checked).then(loadInquiries).catch(function (err) { chk.checked = !chk.checked; fail($('inqMsg'), err); });
        });
        return h('li', { class: 'inq' + (i.handled ? ' done' : '') },
          h('div', { class: 'inq-top' },
            h('strong', { text: i.name }),
            h('a', { href: 'mailto:' + i.email, text: i.email }),
            i.phone ? h('span', { text: i.phone }) : null,
            i.service ? h('span', { class: 'badge', text: i.service }) : null,
            h('time', { datetime: new Date(i.created_at).toISOString(), text: U.formatDate(i.created_at) })),
          h('p', { class: 'inq-msg', text: i.message }),
          h('label', { class: 'check', for: 'inq-' + i.id }, chk, ' Handled'));
      }));
    }).catch(function (err) { fail($('inqMsg'), err); });
  }

  /* ---------- start ---------- */
  if (!API.configured) { showLogin(); }
  else if (API.getSession()) {
    API.isAdmin().then(function (ok) { if (ok) enter(API.getSession().user); else signedOut('This account does not have admin access.'); })
      .catch(function () { showLogin(); });
  } else { showLogin(); }
})();
