const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function createAPI(options = {}) {
  const storage = new Map();
  const document = { documentElement: { classList: { toggle() {} }, dataset: {} }, body: null };
  const window = { location: { origin: 'https://school.example', pathname: '/calendar.html', href: '' }, dispatchEvent() {} };
  const context = vm.createContext({ window, document, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    CustomEvent: class {}, alert() {}, fetch: options.fetch,
    localStorage: options.storage || { getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/api.js'), 'utf8'), context);
  return { api: window.API, window };
}
test('HTML and markdown cannot execute script URLs or injected attributes', () => {
  const { api } = createAPI();
  assert.equal(api.escapeHTML('<script>"&'), '&lt;script&gt;&quot;&amp;');
  assert.equal(api.renderTextWithLinks('[열기](javascript:alert(1))').includes('<a '), false);
  assert.equal(api.renderTextWithLinks('![x](data:image/svg+xml,test)').includes('<img '), false);
  assert.ok(api.renderTextWithLinks('[링크](https://example.com/?q="x")').includes('q=%22x%22'));
});
test('notification navigation accepts only app pages', () => {
  const { api } = createAPI();
  for (const unsafe of ['javascript:alert(1)', '//evil.example', '/api/auth/logout', 'https://evil.example/calendar.html']) assert.equal(api.safeInternalLink(unsafe), '');
  assert.equal(api.safeInternalLink('calendar.html?assignment=3'), '/calendar.html?assignment=3');
});
test('string zero does not grant administrator UI', () => {
  const { api } = createAPI();
  assert.equal(api.normalizeUser({ id: 2, is_admin: '0', is_alarm_enabled: '0' }).is_admin, false);
  assert.equal(api.normalizeUser({ id: 2, is_admin: 1 }).is_admin, true);
});
test('blocked localStorage still permits memory user state', () => {
  const fail = () => { throw new Error('Storage denied'); };
  const { api } = createAPI({ storage: { getItem:fail, setItem:fail, removeItem:fail } });
  api.setUser({ id: 2, name:'학생', grade:1, class_number:1 });
  assert.equal(api.getUser().name, '학생');
  api.clearUser();
  assert.equal(api.getUser(), null);
});
test('network failures return a user-visible error without rejected promises', async () => {
  const { api } = createAPI({ fetch: async () => { throw new TypeError('network'); } });
  const result = await api.getAssignments();
  assert.equal(result.success, false);
  assert.match(result.error, /연결/);
});
test('proxy HTML error is handled instead of crashing JSON parsing', async () => {
  const { api } = createAPI({ fetch: async () => ({ status:502, ok:false, json:async()=>{ throw new SyntaxError('HTML'); } }) });
  const result = await api.getAssignments();
  assert.equal(result.status, 502);
  assert.equal(result.success, false);
});
test('expired authentication clears cached user and redirects', async () => {
  const { api, window } = createAPI({ fetch: async () => ({ status:401, ok:false, json:async()=>({error:'expired'}) }) });
  api.setUser({id:2});
  assert.equal((await api.me()).status, 401);
  assert.equal(api.getUser(), null);
  assert.equal(window.location.href, 'login.html');
});
test('failed logout keeps user state available for retry', async () => {
  const { api, window } = createAPI({ fetch: async () => { throw new TypeError('offline'); } });
  api.setUser({id:2});
  await api.logout();
  assert.equal(api.getUser().id, 2);
  assert.equal(window.location.href, '');
});

test('temporary server outage keeps cached identity for retry', async () => {
  const { api } = createAPI({ fetch: async () => ({ status:503, ok:false, json:async()=>({error:'일시 장애'}) }) });
  api.setUser({id:2,grade:1,class_number:2});
  await assert.rejects(api.ensureUser({force:true}), /일시 장애/);
  assert.equal(api.getUser().id, 2);
});
