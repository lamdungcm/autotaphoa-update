'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
async function flush() { await new Promise(resolve => setImmediate(resolve)); }
function harness(options = {}) {
    let now = 1000000, nextTimer = 1;
    const intervals = new Map(), calls = [], account = {userId: options.uid === undefined ? '100' : options.uid, nickName: 'Nhân vật'};
    const activities = {}, native = {};
    class Clock extends Date { static now() { return now; } }
    const modules = {PlayerMgr: {PlayerMgr: {inst: {model: account}}},
        ActivityMgr: {ActivityMgr: {inst: {model: {activityDict: activities}}}},
        Native: {Native: native}};
    const window = {
        setInterval(callback, delay) { const id = nextTimer++; intervals.set(id, {callback, delay}); return id; },
        clearInterval(id) { intervals.delete(id); },
        __require(name) { if (!modules[name]) throw new Error('Module missing'); return modules[name]; }
    };
    if (options.noLoader) delete window.__require;
    const sandbox = {window, Date: Clock};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/runtime.js'), 'utf8'), sandbox);
    const api = window.AutoAPK;
    function method(name, handler) {
        native[name] = function (...args) { calls.push({name, args}); return handler(...args); };
    }
    return {api, modules, native, account, activities, calls, window, intervals,
        method,
        task(id, run) { api.registerTask({id, name: 'Tác vụ ' + id, run}); },
        async tick(ms = 100) {
            now += ms;
            Array.from(intervals.values()).forEach(value => value.callback());
            await flush();
        },
        loadTasks() { vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/tasks.js'), 'utf8'), sandbox); },
        loadDaily() { vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/daily.js'), 'utf8'), sandbox); }
    };
}
const success = {status: 'success', message: 'Đã xác nhận kết quả'};

test('both task modules register eight unique actions and block new claims before login', async () => {
    const h = harness({uid: '0'}); h.loadTasks(); h.loadDaily(); h.loadDaily();
    assert.equal(h.api.tasks.length, 8); assert.equal(new Set(h.api.tasks.map(t => t.id)).size, 8);
    assert.equal((await h.api.runSelected(h.api.tasks.map(t => t.id))).status, 'blocked');
    assert.equal(h.calls.length, 0);
});

test('state wait requires a matching push and cleans its polling timer', async () => {
    const h = harness(); let received = false;
    h.task('push', async ctx => { await ctx.waitFor(() => received); return success; });
    const run = h.api.runSelected(['push']); await flush();
    assert.equal(h.api.state.running, true); assert.equal(h.intervals.size, 1);
    received = true; await h.tick(); assert.equal((await run).status, 'success'); assert.equal(h.intervals.size, 0);
});
test('state wait timeout does not invent a received reward', async () => {
    const h = harness();
    h.task('push', async ctx => { await ctx.waitFor(() => false, {timeoutMs: 3000, message: 'Chưa nhận được mốc'}); return success; });
    const run = h.api.runSelected(['push']); await flush(); await h.tick(3001);
    assert.equal((await run).status, 'failed'); assert.equal(h.intervals.size, 0);
    assert.match(h.api.state.lastResult.tasks[0].message, /Chưa nhận/);
});
test('Stop or changed character aborts state wait and prevents later mutations', async () => {
    for (const change of ['stop', 'identity']) {
        const h = harness(); h.method('mutation', () => ({ret: 0}));
        h.task('push', async ctx => { await ctx.waitFor(() => false); await ctx.call('Native', 'Native', 'mutation'); return success; });
        const run = h.api.runSelected(['push']); await flush();
        if (change === 'stop') h.api.stop(); else h.account.userId = '200';
        await h.tick(); assert.equal((await run).status, change === 'stop' ? 'stopped' : 'failed');
        assert.equal(h.calls.length, 0); assert.equal(h.intervals.size, 0);
    }
});

test('runtime does not run before the game loader or player is available', async () => {
    const h = harness({noLoader: true}); let ran = false;
    h.task('a', async () => { ran = true; return success; });
    assert.equal(h.api.inspect().ready, false);
    assert.equal((await h.api.runSelected(['a'])).status, 'blocked');
    assert.equal(ran, false); assert.match(h.api.state.logs.at(-1).text, /đăng nhập/);
});
test('logged-out empty and zero player identifiers are blocked', async () => {
    for (const uid of ['', 0, '0']) {
        const h = harness({uid}); let ran = false;
        h.task('a', async () => { ran = true; return success; });
        assert.equal((await h.api.runSelected(['a'])).status, 'blocked');
        assert.equal(ran, false);
    }
});
test('missing selected tasks skip without fabricating completed work', async () => {
    const h = harness(); h.task('a', async () => success);
    assert.equal((await h.api.runSelected(['unknown'])).status, 'skipped');
    assert.equal(h.api.state.lastResult, null);
});
test('native calls are serialized even when a task tries concurrent requests', async () => {
    const h = harness(), flight = deferred(); let rejected = '';
    h.method('first', () => flight.promise); h.method('second', () => ({ret: 0}));
    h.task('a', async ctx => {
        const first = ctx.call('Native', 'Native', 'first', []);
        await ctx.call('Native', 'Native', 'second', []).catch(error => { rejected = error.autoapkCode; });
        await first; return success;
    });
    const run = h.api.runSelected(['a']); await flush();
    assert.equal(rejected, 'pending'); assert.deepEqual(h.calls.map(c => c.name), ['first']);
    flight.resolve({ret: 0}); assert.equal((await run).status, 'success');
});
test('selected tasks await the prior native response before the next task', async () => {
    const h = harness(), flight = deferred();
    h.method('first', () => flight.promise); h.method('second', () => ({ret: 0}));
    h.task('a', async ctx => { await ctx.call('Native', 'Native', 'first', []); return success; });
    h.task('b', async ctx => { await ctx.call('Native', 'Native', 'second', []); return success; });
    const run = h.api.runSelected(['a', 'b']); await flush();
    assert.deepEqual(h.calls.map(c => c.name), ['first']);
    flight.resolve({ret: 0}); assert.equal((await run).status, 'success');
    assert.deepEqual(h.calls.map(c => c.name), ['first', 'second']);
    assert.deepEqual(plain(h.api.state.progress), {done: 2, total: 2});
});
test('Stop during a pending native response prevents the next native call', async () => {
    const h = harness(), flight = deferred();
    h.method('first', () => flight.promise); h.method('second', () => ({ret: 0}));
    h.task('a', async ctx => {
        await ctx.call('Native', 'Native', 'first', []);
        await ctx.call('Native', 'Native', 'second', []); return success;
    });
    const run = h.api.runSelected(['a']); await flush(); h.api.stop(); await h.tick();
    const result = await run;
    assert.equal(result.status, 'stopped'); assert.deepEqual(h.calls.map(c => c.name), ['first']);
    assert.equal(h.api.state.running, false); assert.equal(h.api.inspect().pending, true);
    flight.resolve({ret: 0}); await flush();
    assert.equal(h.api.inspect().pending, false); assert.deepEqual(h.calls.map(c => c.name), ['first']);
});
test('uncertain stopped mutation blocks a new run until native promise settles', async () => {
    const h = harness(), flight = deferred(); let safeRuns = 0;
    h.method('mutation', () => flight.promise);
    h.task('a', async ctx => { await ctx.call('Native', 'Native', 'mutation', []); return success; });
    h.task('safe', async () => { safeRuns++; return success; });
    const run = h.api.runSelected(['a']); await flush(); h.api.stop(); await h.tick(); await run;
    assert.equal((await h.api.runSelected(['safe'])).status, 'blocked'); assert.equal(safeRuns, 0);
    flight.resolve({ret: 0}); await flush();
    assert.equal((await h.api.runSelected(['safe'])).status, 'success'); assert.equal(safeRuns, 1);
});
test('timeout retains the in-flight gate and cannot retry an uncertain mutation', async () => {
    const h = harness(), flight = deferred();
    h.method('mutation', () => flight.promise);
    h.task('a', async ctx => { await ctx.call('Native', 'Native', 'mutation', [], {timeoutMs: 500}); return success; });
    const run = h.api.runSelected(['a']); await flush(); await h.tick(501);
    const result = await run;
    assert.equal(result.status, 'failed'); assert.equal(h.api.inspect().pending, true);
    assert.equal((await h.api.runSelected(['a'])).status, 'blocked'); assert.equal(h.calls.length, 1);
    assert.match(result.tasks[0].message, /Máy chủ chưa trả kết quả/);
    flight.resolve({ret: 0}); await flush(); assert.equal(h.api.inspect().pending, false);
    assert.equal(h.api.state.lastResult.status, 'failed');
});
test('late native failure clears the pending gate without reviving the failed task', async () => {
    const h = harness(), flight = deferred(); let continued = false;
    h.method('mutation', () => flight.promise);
    h.task('a', async ctx => { await ctx.call('Native', 'Native', 'mutation', [], {timeoutMs: 500}); continued = true; return success; });
    const run = h.api.runSelected(['a']); await flush(); await h.tick(501); await run;
    flight.reject(new Error('late network error')); await flush();
    assert.equal(h.api.inspect().pending, false); assert.equal(continued, false); assert.equal(h.api.state.lastResult.status, 'failed');
});
test('identity change during native operation blocks all following steps', async () => {
    const h = harness(), flight = deferred(); let secondTask = false;
    h.method('first', () => flight.promise); h.method('second', () => ({ret: 0}));
    h.task('a', async ctx => { await ctx.call('Native', 'Native', 'first', []); await ctx.call('Native', 'Native', 'second', []); return success; });
    h.task('b', async () => { secondTask = true; return success; });
    const run = h.api.runSelected(['a', 'b']); await flush(); h.account.userId = '200'; flight.resolve({ret: 0});
    const result = await run;
    assert.equal(result.status, 'failed'); assert.match(result.tasks[0].message, /Nhân vật đã thay đổi/);
    assert.equal(secondTask, false); assert.deepEqual(h.calls.map(c => c.name), ['first']);
});
test('global task deadline prevents a subsequent call', async () => {
    const h = harness(); let context;
    h.method('first', () => ({ret: 0}));
    h.task('a', async ctx => { context = ctx; await h.tick(90001); ctx.check(); return success; });
    assert.equal((await h.api.runSelected(['a'])).status, 'failed');
    assert.throws(() => context.call('Native', 'Native', 'first', []), /dừng theo yêu cầu/);
    assert.equal(h.calls.length, 0);
});
test('plain true, undefined, generic ret-zero ACK and unknown task status are unverified', async () => {
    for (const value of [true, undefined, {ret: 0}, {status: 'finished'}]) {
        const h = harness(); h.task('a', async () => value);
        const result = await h.api.runSelected(['a']);
        assert.equal(result.status, 'failed'); assert.equal(result.tasks[0].status, 'failed');
        assert.match(result.tasks[0].message, /chưa xác nhận/);
    }
});
test('ordinary failure is retained while remaining independent tasks continue', async () => {
    const h = harness();
    h.task('a', async () => { throw new Error('Không đủ lượt thực hiện'); });
    h.task('b', async () => ({status: 'already_done', message: 'Đã nhận đủ'}));
    const result = await h.api.runSelected(['a', 'b']);
    assert.equal(result.status, 'failed'); assert.deepEqual(plain(result.tasks).map(t => t.status), ['failed', 'already_done']);
    assert.deepEqual(plain(h.api.state.progress), {done: 2, total: 2});
    assert.equal(h.api.state.lastResult.tasks[0].message, 'Không đủ lượt thực hiện');
    assert.equal(h.api.state.current, 'b'); assert.match(h.api.state.status, /chưa hoàn thành/);
});
test('dynamic activity lookup reads the current activity dictionary for every run', async () => {
    const h = harness(); const found = [];
    h.activities.old = {activityId: 11, type: 1020, state: 2};
    h.activities.other = {activityId: 999, type: 1234, state: 2};
    h.activities.closed = {activityId: 100, activityType: 1020, state: 5};
    h.task('a', async ctx => { found.push(ctx.activity(1020)); return success; });
    await h.api.runSelected(['a']); assert.equal(found[0].activityId, 11);
    delete h.activities.old;
    h.activities.new = {activityId: 21, info: {activityType: 1020, state: 2}};
    await h.api.runSelected(['a']); assert.equal(found[1].activityId, 21);
});
test('newer NONE or missing-state activities do not mask the actual START activity', async () => {
    // Verified game EnumActivityState: NONE=0 PREVIEW=1 START=2 SETTLE=3 REWARD=4 CLOSED=5.
    const h = harness(); let activity;
    h.activities.active = {activityId: 11, type: 1020, state: 2};
    h.activities.none = {activityId: 90, type: 1020, state: 0};
    h.activities.unknown = {activityId: 99, type: 1020};
    h.task('a', async ctx => { activity = ctx.activity(1020); return success; });
    await h.api.runSelected(['a']); assert.equal(activity.activityId, 11);
    delete h.activities.active;
    await h.api.runSelected(['a']); assert.equal(activity, null);
});
test('unsupported native method is explicit and never counted as success', async () => {
    const h = harness();
    h.task('a', async ctx => { await ctx.call('Native', 'Native', 'missing', []); return success; });
    const result = await h.api.runSelected(['a']);
    assert.equal(result.status, 'failed'); assert.match(result.tasks[0].message, /chưa hỗ trợ/);
    assert.equal(h.api.inspect().pending, false);
});
test('customer logs redact technical identifiers, opcodes and authentication fields', async () => {
    const h = harness();
    h.task('a', async ctx => { ctx.log('opcode 0x6D08 userId 710016800013104 token abc'); throw new Error('session secret'); });
    const result = await h.api.runSelected(['a']);
    const content = JSON.stringify(h.api.state.logs);
    assert.ok(!content.includes('0x6D08') && !content.includes('710016800013104') && !content.includes('secret'));
    assert.match(result.tasks[0].message, /Không xác nhận/);
});
test('listeners cannot break progress updates and can unsubscribe', async () => {
    const h = harness(); let updates = 0;
    const unsubscribe = h.api.subscribe(() => { updates++; throw new Error('view failure'); });
    h.task('a', async () => success); assert.equal((await h.api.runSelected(['a'])).status, 'success');
    assert.ok(updates > 0); const before = updates; unsubscribe();
    await h.api.runSelected(['a']); assert.equal(updates, before);
});
test('runtime and native tasks integrate without accepting a generic mail ACK', async () => {
    const h = harness();
    h.modules.MailNetUtil = {MailNetUtil: {getAllReward() { return Promise.resolve({ret: 0}); }}};
    h.loadTasks();
    const result = await h.api.runSelected(['mail_rewards']);
    assert.equal(result.status, 'failed'); assert.match(result.tasks[0].message, /Không đọc được/);
    h.modules.MailNetUtil.MailNetUtil.getAllReward = () => Promise.resolve({ret: 0, reward: '101001=100'});
    assert.equal((await h.api.runSelected(['mail_rewards'])).status, 'success');
});
