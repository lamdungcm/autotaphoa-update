'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function load(name, sandbox) { vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/', name + '.js'), 'utf8'), sandbox); }
const plain = x => JSON.parse(JSON.stringify(x));
function setup() {
    let now = 1000000, next = 0, blocked = false;
    const timers = new Map(), storage = {}, modules = {}, calls = [];
    const account = {userId: '100', nickName: 'Test'};
    modules.PlayerMgr = {PlayerMgr: {inst: {model: account}}};
    modules.Protocol = {Protocol: {S_TEST_DATA: 1, S_TEST_MOVE: 2}};
    const root = {__require: n => { if (!modules[n]) throw Error('missing ' + n); return modules[n]; },
        setInterval(fn) { timers.set(++next, fn); return next; }, clearInterval(id) { timers.delete(id); },
        cc: {sys: {localStorage: {getItem: key => storage[key] || null, setItem: (key, value) => { storage[key] = value; }}}}};
    class Clock extends Date { static now() { return now; } }
    const sandbox = vm.createContext({window: root, Date: Clock});
    load('runtime', sandbox); load('port_kernel', sandbox); load('native_scope', sandbox);
    const api = root.AutoAPK, P = api.port;
    api.gameSchema = {protocols: {S_TEST_DATA: {request: 'Q', response: 'R', requestFields: {}, responseFields: {ret: {type: 'int32', rule: 'required'}, power: {type: 'int32', rule: 'optional'}}},
        S_TEST_MOVE: {request: 'Q', response: 'R', requestFields: {times: {type: 'int32', rule: 'required'}}, responseFields: {ret: {type: 'int32', rule: 'required'}, power: {type: 'int32', rule: 'optional'}}}}};
    const ctx = {uid: '100', options: {}, require: root.__require, check: () => { if (blocked) throw Error('stopped'); }, log() {},
        call: async (module, owner, method, args) => {
            calls.push({module, owner, method, args});
            let target = modules[module]; owner.split('.').forEach(key => { target = target[key]; });
            return target[method](...args);
        }, sleep: async () => { ctx.check(); }, waitFor: async predicate => { for (let i = 0; i < 40; i++) { if (predicate()) return; await new Promise(r => setImmediate(r)); } throw Error('state timeout'); }};
    return {api, P, root, sandbox, modules, ctx, account, storage, calls, timers,
        stop() { blocked = true; }, async tick(ms = 100) { now += ms; [...timers.values()].forEach(fn => fn()); await new Promise(r => setImmediate(r)); },
        load: name => load(name, sandbox)};
}
test('configuration persists by character, validates ranges and restores another character defaults', () => {
    const h = setup(); h.P.register({id: 'config', name: 'Config', options: [h.P.numOption('count', 'Count', 2, 10)]}, async () => h.P.done(0));
    h.api.configureTask('config', {count: 7}); assert.equal(h.api.getTaskOptions('config').count, 7);
    assert.throws(() => h.api.configureTask('config', {count: 11}), /giới hạn/);
    h.account.userId = '200'; assert.equal(h.api.getTaskOptions('config').count, 2);
    h.api.configureTask('config', {count: 4}); h.account.userId = '100'; assert.equal(h.api.getTaskOptions('config').count, 7);
});
test('failed preference write leaves in-memory configuration unchanged', () => {
    const h = setup(); h.P.register({id: 'c', name: 'C', options: [h.P.numOption('n', 'N', 1, 10)]}, async () => h.P.done(0));
    h.api.configureTask('c', {n: 2}); h.root.cc.sys.localStorage.setItem = () => { throw Error('disk full'); };
    assert.throws(() => h.api.configureTask('c', {n: 5}), /lưu/); assert.equal(h.api.getTaskOptions('c').n, 2);
});
test('composite uses each child settings and detects cycles', async () => {
    const h = setup(), seen = [];
    h.P.register({id: 'child', name: 'Child', options: [h.P.numOption('n', 'N', 2, 10)]}, async ctx => { seen.push(ctx.options.n); return h.P.done(1, 'child'); });
    h.P.register({id: 'parent', name: 'Parent'}, ctx => h.P.sequence(ctx, ['child', 'child']));
    h.api.configureTask('child', {n: 5}); assert.equal((await h.api.runSelected(['parent'])).status, 'success'); assert.deepEqual(seen, [5, 5]);
    h.P.register({id: 'cycle', name: 'Cycle'}, ctx => ctx.runTask('cycle'));
    assert.equal((await h.api.runSelected(['cycle'])).status, 'failed');
});
test('Stop interrupts a long sleep before the next native mutation', async () => {
    const h = setup(); let called = false;
    h.P.register({id: 'sleep', name: 'Sleep'}, async ctx => { await ctx.sleep(30000); called = true; return h.P.done(1); });
    const run = h.api.runSelected(['sleep']); h.api.stop(); await h.tick();
    assert.equal((await run).status, 'stopped'); assert.equal(called, false); assert.equal(h.timers.size, 0);
});
test('packet validation rejects missing fields, unsafe integers, bools as numbers and unknown fields before send', async () => {
    const h = setup(); h.modules.GameNetUtil = {GameNetUtil: {syncSeqSendMsg: () => ({ret: 0, power: 1})}};
    for (const body of [{}, {times: true}, {times: 9007199254740992}, {times: 1, guessed: 3}])
        await assert.rejects(h.P.packet(h.ctx, 'S_TEST_MOVE', body));
    assert.equal(h.calls.length, 0);
    assert.equal((await h.P.packet(h.ctx, 'S_TEST_MOVE', {times: 1})).power, 1);
});
test('live protobuf reflection replaces obsolete base APK request shape', async () => {
    const h = setup(); const request = {$type: {_fields: [{className: 'Message.Field', id: 1, name: 'newField', type: {name: 'int32'}, required: true}]}}, response = {$type: {_fields: [{className: 'Message.Field', id: 1, name: 'ret', type: {name: 'int32'}, required: true}]}};
    h.modules.ProtobufMgr = {ProtobufMgr: {inst: {cmdList: {2: {smMsgId: 102, smMethod: 'Current'}}, getMsg: n => n === 2 ? request : response}}};
    h.modules.GameNetUtil = {GameNetUtil: {syncSeqSendMsg: () => ({ret: 0})}};
    await h.P.packet(h.ctx, 'S_TEST_MOVE', {newField: 4}); assert.equal(h.calls.length, 1);
    await assert.rejects(h.P.packet(h.ctx, 'S_TEST_MOVE', {times: 1}));
});
test('scoped copied native method uses live model and private transport without replacing game prototypes', async () => {
    const h = setup(); class Original { method() { throw Error('original mutation must not run'); } }
    const live = new Original(); live.model = {power: 9}; Original.inst = live; h.modules.FeatureMgr = {FeatureMgr: Original};
    h.modules.GameNetUtil = {GameNetUtil: {syncSeqSendMsg: async () => ({ret: 0, power: 8})}};
    h.P.nativeModules = {FeatureMgr: {deps: {}, factory(req, mod, exports) {
        class Copy { async method() { const r = await req('GameNetUtil').GameNetUtil.syncSeqSendMsg(2, {times: 1}); this.model.power = r.power; return r; } }
        Object.defineProperty(Copy, 'inst', {get() { return {}; }, configurable: true}); exports.FeatureMgr = Copy;
    }}};
    const originalMethod = Original.prototype.method, scope = h.P.nativeScope(h.ctx), mgr = scope.require('FeatureMgr').FeatureMgr.inst;
    assert.equal((await mgr.method()).power, 8); assert.equal(live.model.power, 8);
    mgr.method = () => 'temporary'; assert.equal(mgr.method(), 'temporary'); assert.equal(Original.prototype.method, originalMethod);
    assert.equal(scope.evidence.length, 1); scope.close(); assert.throws(() => scope.require('FeatureMgr'), /kết thúc/);
});
test('scoped transport queues parallel calls and poisons queued follow-ups after uncertain failure', async () => {
    const h = setup(); let count = 0;
    h.modules.GameNetUtil = {GameNetUtil: {syncSeqSendMsg: async () => { count++; throw Error('network'); }}};
    const scope = h.P.nativeScope(h.ctx), net = scope.require('GameNetUtil').GameNetUtil;
    const results = await Promise.allSettled([net.syncSeqSendMsg(2, {times: 1}), net.syncSeqSendMsg(2, {times: 1})]);
    assert.ok(results.every(r => r.status === 'rejected')); assert.equal(count, 1); await assert.rejects(scope.drain()); scope.close();
});
test('closing scope removes only the event listeners created by that scope', () => {
    const h = setup(), registered = [], removed = [];
    h.modules.EventMgr = {EventMgr: {inst: {on: (...args) => registered.push(args), off: (...args) => removed.push(args)}}};
    const scope = h.P.nativeScope(h.ctx); scope.require('EventMgr').EventMgr.inst.on('event', () => {}, {});
    assert.equal(registered.length, 1); scope.close(); assert.deepEqual(removed, registered);
});
module.exports = {setup, plain};
