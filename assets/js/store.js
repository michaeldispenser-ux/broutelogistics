/*
 * Shipment data layer (browser localStorage, with in-memory fallback).
 * Swap this file's internals for a real API later; the rest of the site only uses window.BrouteStore.
 */
(function (global) {
  'use strict';

  var KEY = 'broute:db:v2';
  var LEGACY_KEY = 'broute_shipments'; // original prototype format
  var MAX_SHIPMENTS = 500;
  var STATUSES = ['Created', 'In Transit', 'Out for Delivery', 'Delivered'];

  var storage = (function () {
    try {
      var t = '__broute_test__';
      global.localStorage.setItem(t, '1');
      global.localStorage.removeItem(t);
      return global.localStorage;
    } catch (e) { return null; }
  })();

  var memory = null;

  function clean(value, max) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeId(input) {
    var m = String(input === null || input === undefined ? '' : input).trim().toUpperCase().match(/^(?:BRT[-\s]?)?(\d{4,8})$/);
    return m ? 'BRT-' + m[1] : null;
  }

  function defaultLocation(status, s) {
    switch (status) {
      case 'In Transit': return 'In transit to destination hub';
      case 'Out for Delivery': return 'Out for delivery – ' + s.destination;
      case 'Delivered': return 'Delivered – ' + s.destination;
      default: return 'Awaiting pickup – ' + s.origin;
    }
  }

  function makeShipment(d) {
    var status = STATUSES.indexOf(d.status) >= 0 ? d.status : 'Created';
    var now = d.createdAt || Date.now();
    var s = {
      id: d.id,
      item: clean(d.item, 80),
      origin: clean(d.origin, 80),
      destination: clean(d.destination, 80),
      status: status,
      location: '',
      createdAt: now,
      updatedAt: now,
      events: []
    };
    s.location = clean(d.location, 120) || defaultLocation(status, s);
    s.events = [{ ts: now, status: status, location: s.location, note: 'Shipment registered' }];
    return s;
  }

  function sanitizeShipment(raw, id) {
    if (!raw || typeof raw !== 'object') return null;
    var s = makeShipment({
      id: id, item: raw.item, origin: raw.origin, destination: raw.destination,
      status: raw.status, location: raw.location,
      createdAt: Number(raw.createdAt) || Date.now()
    });
    if (!s.item || !s.origin || !s.destination) return null;
    s.updatedAt = Number(raw.updatedAt) || s.createdAt;
    if (Array.isArray(raw.events) && raw.events.length) {
      s.events = raw.events.slice(0, 100).map(function (e) {
        return {
          ts: Number(e && e.ts) || s.createdAt,
          status: STATUSES.indexOf(e && e.status) >= 0 ? e.status : s.status,
          location: clean(e && e.location, 120),
          note: clean(e && e.note, 160)
        };
      });
    }
    return s;
  }

  function seed(db) {
    var s = makeShipment({
      id: 'BRT-10001', item: 'Laptop & Accessories', origin: 'New York, USA', destination: 'London, UK',
      status: 'In Transit', location: 'Heathrow Hub, London', createdAt: Date.now() - 3 * 86400000
    });
    s.events = [
      { ts: s.createdAt, status: 'Created', location: 'New York, USA', note: 'Shipment registered' },
      { ts: s.createdAt + 86400000, status: 'In Transit', location: 'JFK Airport, New York', note: 'Departed origin facility' },
      { ts: Date.now() - 3600000 * 5, status: 'In Transit', location: 'Heathrow Hub, London', note: 'Arrived at destination hub' }
    ];
    s.updatedAt = s.events[2].ts;
    db.shipments[s.id] = s;
  }

  function migrateLegacy(db) {
    try {
      var raw = storage && storage.getItem(LEGACY_KEY);
      if (!raw) return false;
      var old = JSON.parse(raw);
      Object.keys(old || {}).forEach(function (k) {
        var id = normalizeId(k);
        if (!id || !old[k]) return;
        var s = sanitizeShipment({
          item: old[k].item, origin: old[k].origin, destination: old[k].destination,
          status: STATUSES.indexOf(old[k].status) >= 0 ? old[k].status : 'Created',
          location: old[k].location
        }, id);
        if (s) db.shipments[id] = s;
      });
      return Object.keys(db.shipments).length > 0;
    } catch (e) { return false; }
  }

  function load() {
    var raw = null;
    try { raw = storage ? storage.getItem(KEY) : null; } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.shipments && typeof parsed.shipments === 'object') return parsed;
      } catch (e) { /* corrupted: fall through and rebuild */ }
    }
    if (!storage && memory) return memory;
    var db = { version: 2, seeded: true, shipments: {} };
    if (!migrateLegacy(db)) seed(db);
    persist(db);
    return db;
  }

  function persist(db) {
    memory = db;
    if (!storage) return false;
    try { storage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { return false; }
  }

  function randomId() {
    var n;
    if (global.crypto && global.crypto.getRandomValues) {
      var a = new Uint32Array(1);
      global.crypto.getRandomValues(a);
      n = a[0];
    } else { n = Math.floor(Math.random() * 4294967296); }
    return 'BRT-' + (100000 + (n % 900000));
  }

  var api = {
    STATUSES: STATUSES,
    isPersistent: !!storage,
    normalizeId: normalizeId,

    list: function () {
      var db = load();
      return Object.keys(db.shipments).map(function (k) { return db.shipments[k]; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; });
    },

    get: function (id) {
      var nid = normalizeId(id);
      return nid ? load().shipments[nid] || null : null;
    },

    create: function (input) {
      var db = load();
      if (Object.keys(db.shipments).length >= MAX_SHIPMENTS) throw new Error('Shipment limit reached (' + MAX_SHIPMENTS + ').');
      var item = clean(input.item, 80), origin = clean(input.origin, 80), destination = clean(input.destination, 80);
      if (!item || !origin || !destination) throw new Error('Description, origin and destination are required.');
      var id, tries = 0;
      do { id = randomId(); tries++; } while (db.shipments[id] && tries < 50);
      if (db.shipments[id]) throw new Error('Could not allocate a unique tracking number. Try again.');
      var s = makeShipment({ id: id, item: item, origin: origin, destination: destination, status: input.status });
      db.shipments[id] = s;
      persist(db);
      return s;
    },

    updateStatus: function (id, status, location, note) {
      var db = load();
      var s = db.shipments[normalizeId(id)];
      if (!s) throw new Error('Shipment not found.');
      if (STATUSES.indexOf(status) < 0) throw new Error('Invalid status.');
      s.status = status;
      s.location = clean(location, 120) || defaultLocation(status, s);
      s.updatedAt = Date.now();
      s.events.push({ ts: s.updatedAt, status: status, location: s.location, note: clean(note, 160) || 'Status updated' });
      persist(db);
      return s;
    },

    remove: function (id) {
      var db = load();
      var nid = normalizeId(id);
      if (!nid || !db.shipments[nid]) return false;
      delete db.shipments[nid];
      persist(db);
      return true;
    },

    resetDemo: function () {
      var db = { version: 2, seeded: true, shipments: {} };
      seed(db);
      persist(db);
    },

    exportJSON: function () { return JSON.stringify(load(), null, 2); },

    importJSON: function (text) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { throw new Error('File is not valid JSON.'); }
      var src = parsed && parsed.shipments;
      if (!src || typeof src !== 'object') throw new Error('Unrecognised file format.');
      var db = { version: 2, seeded: true, shipments: {} };
      Object.keys(src).slice(0, MAX_SHIPMENTS).forEach(function (k) {
        var id = normalizeId(k);
        var s = id && sanitizeShipment(src[k], id);
        if (s) db.shipments[id] = s;
      });
      persist(db);
      return Object.keys(db.shipments).length;
    }
  };

  global.BrouteStore = api;
})(window);
