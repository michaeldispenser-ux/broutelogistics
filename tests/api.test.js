// Run: node tests/api.test.js   (no dependencies; uses a mock of the Supabase REST/Auth endpoints)
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const mem = {};
globalThis.sessionStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
globalThis.BROUTE_CONFIG = { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'sb_publishable_' + 'x'.repeat(30), company: {} };

const calls = [];
let adminUser = true, expiresIn = 3600, failNetwork = false;
function res(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] || null }, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}
globalThis.fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (failNetwork) throw new TypeError('fetch failed');
  const u = new URL(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
    if (body.password !== 'good') return res(400, { error_description: 'Invalid login credentials' });
    return res(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: expiresIn, user: { id: 'u1', email: body.email } });
  }
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') return res(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, user: { id: 'u1', email: 'a@b.co' } });
  if (u.pathname === '/auth/v1/logout') return res(204);
  if (u.pathname === '/rest/v1/rpc/is_admin') return res(200, adminUser);
  if (u.pathname === '/rest/v1/rpc/track_shipment') return res(200, body.p_tracking === 'BRT-ABCDEF2345' ? { tracking_no: body.p_tracking, status: 'In Transit', events: [] } : null);
  if (u.pathname === '/rest/v1/rpc/submit_inquiry') return res(200, true);
  if (u.pathname === '/rest/v1/shipments') return res(200, [{ id: '1' }, { id: '2' }], { 'content-range': '0-1/57' });
  if (u.pathname === '/rest/v1/rpc/add_shipment_event') return res(400, { message: 'This shipment is closed and can no longer be changed', code: 'P0001' });
  return res(404, { message: 'nope' });
};

require(path.join(__dirname, '../assets/js/api.js'));
const API = window.BrouteAPI;

(async () => {
  assert.equal(API.configured, true);
  assert.equal(API.normalizeTracking(' brt-abcdef2345 '), 'BRT-ABCDEF2345');
  assert.equal(API.normalizeTracking('BRT ABCDEF2345'), 'BRT-ABCDEF2345');
  assert.equal(API.normalizeTracking('hello'), null);
  assert.equal(API.normalizeTracking('BRT-12'), null);

  // public tracking
  assert.equal((await API.track('brt-abcdef2345')).status, 'In Transit');
  assert.equal(await API.track('BRT-ZZZZZZZZZZ'), null);
  await assert.rejects(() => API.track('bad'), e => e.code === 'invalid');
  const t = calls.find(c => c.url.endsWith('track_shipment'));
  assert.equal(t.opts.headers['Authorization'], undefined, 'publishable (non-JWT) key must not be sent as Bearer');
  assert.equal(t.opts.headers['apikey'].startsWith('sb_publishable_'), true);

  // inquiry
  assert.equal(await API.submitInquiry({ name: 'A', email: 'a@b.co', message: 'hello there' }), true);

  // login failures / non-admin
  await assert.rejects(() => API.login('a@b.co', 'bad'), e => e.code === 'bad_credentials');
  adminUser = false;
  await assert.rejects(() => API.login('a@b.co', 'good'), e => e.code === 'not_admin');
  assert.equal(API.getSession(), null, 'non-admin session must be cleared');

  // admin login + list
  adminUser = true;
  const user = await API.login('a@b.co', 'good');
  assert.equal(user.email, 'a@b.co');
  const list = await API.listShipments({ q: 'lagos, (x)*', status: 'In Transit', limit: 10, offset: 20 });
  assert.equal(list.total, 57);
  const lc = calls[calls.length - 1];
  assert.match(lc.url, /limit=10&offset=20/);
  assert.match(lc.url, /status=eq\.In%20Transit/);
  const orParam = new URL(lc.url).searchParams.get('or');
  assert.ok(orParam.startsWith('(') && !/[,]\s*\w+\.\w+\.\*[^)]*,[^a-z]/.test('') && !orParam.includes('(x)'), 'query sanitised');
  assert.equal(lc.opts.headers['Authorization'], 'Bearer AT1');

  // server error message surfaced
  await assert.rejects(() => API.addEvent('id', 'Delivered'), e => /closed/.test(e.message));

  // refresh when token is about to expire
  mem['broute:session'] = JSON.stringify({ access_token: 'OLD', refresh_token: 'RT1', expires_at: Math.floor(Date.now() / 1000) + 10, user: { id: 'u1', email: 'a@b.co' } });
  await API.listShipments();
  assert.equal(calls[calls.length - 1].opts.headers['Authorization'], 'Bearer AT2');

  // network failure
  failNetwork = true;
  await assert.rejects(() => API.track('BRT-ABCDEF2345'), e => e.code === 'network');
  failNetwork = false;

  // logout
  await API.logout();
  assert.equal(API.getSession(), null);
  await assert.rejects(() => API.listShipments(), e => e.status === 401);

  console.log('api tests passed');
})().catch(e => { console.error(e); process.exit(1); });
