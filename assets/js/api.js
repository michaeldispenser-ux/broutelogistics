/*
 * API client for Supabase (PostgREST + Auth) using plain fetch: no third-party library needed.
 * Public visitors can only call track_shipment and submit_inquiry. Everything else needs an admin session.
 */
(function (global) {
  'use strict';

  var CFG = global.BROUTE_CONFIG || {};
  var BASE = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  var KEY = String(CFG.supabaseAnonKey || '');
  var CONFIGURED = /^https:\/\/[^/]+/.test(BASE) && KEY.length > 20;
  var SESSION_KEY = 'broute:session';
  var TIMEOUT_MS = 15000;

  var STATUSES = ['Created', 'In Transit', 'Out for Delivery', 'Delivered', 'On Hold', 'Cancelled'];
  var FLOW = ['Created', 'In Transit', 'Out for Delivery', 'Delivered'];
  var SERVICES = ['Express', 'Air Freight', 'Ocean Freight'];

  function ApiError(message, status, code) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status || 0;
    this.code = code || '';
  }
  ApiError.prototype = Object.create(Error.prototype);

  /* ---------- session (sessionStorage: cleared when the tab closes) ---------- */
  function sessionStore() { try { return global.sessionStorage; } catch (e) { return null; } }
  function getSession() {
    var st = sessionStore();
    try { return st ? JSON.parse(st.getItem(SESSION_KEY) || 'null') : null; } catch (e) { return null; }
  }
  function saveSession(d) {
    var s = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: d.user ? { id: d.user.id, email: d.user.email } : (getSession() || {}).user || null
    };
    var st = sessionStore();
    if (st) { try { st.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
    return s;
  }
  function clearSession() {
    var st = sessionStore();
    if (st) { try { st.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }
  }

  /* ---------- low-level request ---------- */
  function headers(token, extra) {
    var h = { 'apikey': KEY, 'Content-Type': 'application/json' };
    var bearer = token || (KEY.indexOf('eyJ') === 0 ? KEY : '');
    if (bearer) h['Authorization'] = 'Bearer ' + bearer;
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function request(url, opts) {
    opts = opts || {};
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers(opts.token, opts.headers),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        if (!res.ok) {
          var msg = (data && (data.message || data.msg || data.error_description || data.error)) || 'Request failed (' + res.status + ').';
          throw new ApiError(String(msg), res.status, data && data.code);
        }
        return { status: res.status, headers: res.headers, data: data };
      });
    }, function () {
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'network');
    }).then(function (r) { if (timer) clearTimeout(timer); return r; },
            function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  function need() {
    if (!CONFIGURED) return Promise.reject(new ApiError('This service is not available right now.', 0, 'not_configured'));
    return null;
  }

  function rest(path, opts) { return request(BASE + '/rest/v1' + path, opts); }

  /* ---------- auth ---------- */
  function login(email, password) {
    return need() || request(BASE + '/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email, password: password } })
      .then(function (r) { saveSession(r.data); return isAdmin(); })
      .then(function (ok) {
        if (!ok) { return logout().then(function () { throw new ApiError('This account does not have admin access.', 403, 'not_admin'); }); }
        return getSession().user;
      }, function (e) {
        if (e.status === 400 || e.status === 401) throw new ApiError('Incorrect email or password.', 401, 'bad_credentials');
        throw e;
      });
  }

  function refresh() {
    var s = getSession();
    if (!s || !s.refresh_token) return Promise.reject(new ApiError('Please sign in.', 401));
    return request(BASE + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })
      .then(function (r) { return saveSession(r.data).access_token; },
            function (e) { clearSession(); throw new ApiError('Your session has expired. Please sign in again.', 401, 'expired'); });
  }

  function freshToken() {
    var s = getSession();
    if (!s) return Promise.reject(new ApiError('Please sign in.', 401));
    if (s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(s.access_token);
    return refresh();
  }

  function userRest(path, opts) {
    opts = opts || {};
    return freshToken().then(function (t) {
      return rest(path, Object.assign({}, opts, { token: t })).catch(function (e) {
        if (e.status === 401 && !opts._retried) {
          return refresh().then(function (t2) { return rest(path, Object.assign({}, opts, { token: t2 })); });
        }
        throw e;
      });
    });
  }

  function logout() {
    var s = getSession();
    clearSession();
    if (!CONFIGURED || !s) return Promise.resolve();
    return request(BASE + '/auth/v1/logout', { method: 'POST', token: s.access_token }).then(function () {}, function () {});
  }

  function isAdmin() {
    return userRest('/rpc/is_admin', { method: 'POST', body: {} }).then(function (r) { return r.data === true; });
  }

  /* ---------- public ---------- */
  function normalizeTracking(raw) {
    var m = String(raw === null || raw === undefined ? '' : raw).trim().toUpperCase().match(/^BRT[-\s]?([A-Z0-9]{6,14})$/);
    return m ? 'BRT-' + m[1] : null;
  }

  function track(raw) {
    var id = normalizeTracking(raw);
    if (!id) return Promise.reject(new ApiError('Please enter a valid tracking number, for example BRT-7K3M9QXD2P.', 400, 'invalid'));
    return need() || rest('/rpc/track_shipment', { method: 'POST', body: { p_tracking: id } }).then(function (r) { return r.data || null; });
  }

  function submitInquiry(f) {
    return need() || rest('/rpc/submit_inquiry', {
      method: 'POST',
      body: { p_name: f.name, p_email: f.email, p_message: f.message, p_phone: f.phone || null, p_service: f.service || null, p_website: f.website || '' }
    }).then(function () { return true; });
  }

  function chat(message) {
    if (!CFG.chatEndpoint) return Promise.reject(new ApiError('Chat endpoint not configured.', 0, 'not_configured'));
    return request(CFG.chatEndpoint, { method: 'POST', body: { message: String(message).slice(0, 500) } })
      .then(function (r) {
        if (!r.data || typeof r.data.reply !== 'string') throw new ApiError('Bad reply', 502);
        return r.data.reply;
      });
  }

  /* ---------- admin ---------- */
  function cleanQuery(q) { return String(q || '').replace(/[^\w\s.@-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }

  function listShipments(o) {
    o = o || {};
    var limit = o.limit || 25, offset = o.offset || 0;
    var qs = 'select=*&order=created_at.desc&limit=' + limit + '&offset=' + offset;
    if (o.status) qs += '&status=eq.' + encodeURIComponent(o.status);
    var q = cleanQuery(o.q);
    if (q) {
      var p = '*' + q + '*';
      qs += '&or=' + encodeURIComponent('(tracking_no.ilike.' + p + ',description.ilike.' + p + ',recipient_name.ilike.' + p + ',destination.ilike.' + p + ')');
    }
    return userRest('/shipments?' + qs, { headers: { 'Prefer': 'count=exact' } }).then(function (r) {
      var range = r.headers && r.headers.get ? r.headers.get('content-range') : null;
      var m = range ? range.match(/\/(\d+)$/) : null;
      var total = m ? Number(m[1]) : (r.data || []).length;
      return { items: r.data || [], total: total };
    });
  }

  function createShipment(f) {
    return userRest('/rpc/create_shipment', { method: 'POST', body: {
      p_description: f.description, p_origin: f.origin, p_destination: f.destination, p_service: f.service || 'Express',
      p_sender_name: f.sender || null, p_recipient_name: f.recipient || null,
      p_recipient_contact: f.contact || null, p_weight_kg: f.weight ? Number(f.weight) : null
    } }).then(function (r) { return r.data; });
  }

  function addEvent(shipmentId, status, location, note) {
    return userRest('/rpc/add_shipment_event', { method: 'POST', body: {
      p_shipment_id: shipmentId, p_status: status, p_location: location || null, p_note: note || null
    } }).then(function (r) { return r.data; });
  }

  function listEvents(shipmentId) {
    return userRest('/shipment_events?select=*&shipment_id=eq.' + encodeURIComponent(shipmentId) + '&order=created_at.desc,id.desc')
      .then(function (r) { return r.data || []; });
  }

  function listInquiries() {
    return userRest('/inquiries?select=*&order=created_at.desc&limit=100').then(function (r) { return r.data || []; });
  }

  function setInquiryHandled(id, handled) {
    return userRest('/inquiries?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: { handled: !!handled }, headers: { 'Prefer': 'return=minimal' } })
      .then(function () { return true; });
  }

  global.BrouteAPI = {
    configured: CONFIGURED, ApiError: ApiError, STATUSES: STATUSES, FLOW: FLOW, SERVICES: SERVICES,
    normalizeTracking: normalizeTracking, track: track, submitInquiry: submitInquiry, chat: chat,
    login: login, logout: logout, getSession: getSession, isAdmin: isAdmin,
    listShipments: listShipments, createShipment: createShipment, addEvent: addEvent, listEvents: listEvents,
    listInquiries: listInquiries, setInquiryHandled: setInquiryHandled
  };
})(window);
