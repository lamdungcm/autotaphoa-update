'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
    const tasks = {};
    const api = {registerTask(task) { tasks[task.id] = task; }};
    const sandbox = {window: {AutoAPK: api}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/tasks.js'), 'utf8'), sandbox);
    return {tasks, internal: api.taskInternals};
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function helper(id, level, overrides = {}) {
    return {players: {userId: String(id), id: 999, nickName: 'Trợ thủ'}, level,
        dailyHelpNum: 0, inHelpList: true, entrustQuality: [1, 2, 3], ...overrides};
}
function fixture() {
    return {own_uid: '100', now_ms: Date.now(),
        data: {ret: 0, level: 4, entrust: null},
        config: {playerLvConfig: [{id: 3, power: 300}, {id: 4, power: 400}, {id: 6, power: 600}, {id: 8, power: 800}],
            entrustConfig: [{id: 1001, name: 'Lúa', quality: 1, monsterPower: '100|200|300'},
                {id: 2001, name: 'Buộc Mía', quality: 2, monsterPower: '600|1000|1400'},
                {id: 3001, name: 'Mốc cao', quality: 3, monsterPower: '2200'}]},
        joiners: {ret: 0, players: [helper(201, 6), helper(202, 4), helper(203, 8)]},
        board: {ret: 0, entrusts: [1001, 2001], refresh: 0},
        rules: {help_limit: 30, helper_power_param: 1000, refresh_free: 1, refresh_max: 3}};
}
function lobby(snapshot, helpers = [], taskId = 2001) {
    snapshot.data.entrust = {state: 1, entrustId: taskId, leader: helper(100, snapshot.data.level), teammates: helpers, endTime: 0};
    return snapshot;
}
function harness(initial = fixture(), overrides = {}) {
    const calls = [], logs = [], snapshot = copy(initial);
    const cfg = {FARMING_ENTRUST_HELP_TIMES_MAX: 'help_limit', FARMING_ENTRUST_TEAM_POWER_PARAM: 'helper_power_param',
        FARMING_ENTRUST_RESET_FREE_TIMES: 'refresh_free', FARMING_ENTRUST_RESET_MAX_TIMES: 'refresh_max', EVENT_UPDATE_ENTRUST: 'updated'};
    let stopped = false;
    const mgr = {};
    ['Config', 'Data', 'Joiner', 'EntrustList', 'EntrustRefresh', 'EntrustAccept', 'TeammateSet'].forEach(name => {
        mgr['asynFarming' + name + 'RespMsg'] = () => {};
    });
    mgr.asynFarmingEntrustGoReqMsg = () => {};
    const act = {activityId: 777, getConfigNumber(key) { return snapshot.rules[key]; }};
    const ctx = {uid: '100', options: {}, log(message) { logs.push(message); },
        check() { if (stopped) throw new Error('Đã dừng'); },
        activity(type) { assert.equal(type, 1020); return act; },
        require(name) {
            if (name === 'FarmingSeasonMgr') return {FarmingSeasonMgr: {inst: mgr}};
            if (name === 'FarmingSeasonConfig') return {FarmingSeasonConfig: cfg};
            if (name === 'EventMgr') return {EventMgr: {inst: {emit() {}}}};
            throw new Error('Unexpected module ' + name);
        },
        async call(module, klass, method, args) {
            ctx.check();
            calls.push({module, klass, method, args: copy(args)});
            if (overrides.call) {
                const result = await overrides.call(method, args, snapshot, calls, () => { stopped = true; });
                if (result !== undefined) return result;
            }
            switch (method) {
            case 'sendFarmingConfigReqMsg': return {ret: 0, ...copy(snapshot.config)};
            case 'sendFarmingDataReqMsg': return copy(snapshot.data);
            case 'sendFarmingJoinerReqMsg': return copy(snapshot.joiners);
            case 'sendFarmingEntrustListReqMsg': return copy(snapshot.board);
            case 'sendFarmingEntrustRefreshReqMsg':
                snapshot.board.refresh++;
                snapshot.board.entrusts = [2001];
                return copy(snapshot.board);
            case 'sendFarmingEntrustAcceptReqMsg':
                lobby(snapshot, [], args[1]);
                return {ret: 0, entrust: copy(snapshot.data.entrust)};
            case 'sendFarmingTeammateSetReqMsg':
                snapshot.data.entrust.teammates = args[1].map(id => {
                    const found = snapshot.joiners.players.find(p => p.players.userId === String(id)) ||
                        snapshot.data.entrust.teammates.find(p => p.players.userId === String(id));
                    assert.ok(found, 'member must be from current server data');
                    return copy(found);
                });
                return {ret: 0, entrust: copy(snapshot.data.entrust)};
            case 'sendFarmingEntrustGoReqMsg':
                snapshot.data.entrust.state = 2;
                snapshot.data.entrust.endTime = Date.now() + 14400000;
                return {ret: 0, entrust: copy(snapshot.data.entrust)};
            default: throw new Error('Unexpected native method ' + method);
            }
        }};
    return {ctx, calls, logs, snapshot, stop() { stopped = true; }};
}
const {tasks, internal} = load();

test('only verified native tasks are registered', () => {
    assert.deepEqual(Object.keys(tasks).sort(), ['daily_signin', 'mail_rewards', 'mua_vu_ban_ron']);
});
test('300 plus two 600 selects the 1400 mission', () => {
    const s = fixture(); s.data.level = 3; s.joiners.players = [helper(201, 6), helper(202, 6)];
    const plan = internal.planFarming(s);
    assert.equal(plan.entrust_id, 2001); assert.equal(plan.teams[0].power, 1500);
});
test('600 plus two 400 preserves stronger helpers', () => {
    const s = fixture(); s.data.level = 6; s.joiners.players = [helper(201, 4), helper(202, 4), helper(203, 6)];
    const plan = internal.planFarming(s);
    assert.equal(plan.teams[0].power, 1400); assert.deepEqual(copy(plan.teams[0].uids), ['201', '202']);
});
test('live example 400 plus 600 and 400 meets 1400 exactly', () => {
    const plan = internal.planFarming(fixture());
    assert.equal(plan.entrust_id, 2001); assert.equal(plan.teams[0].power, 1400);
});
test('dynamic help limit 30 permits used 22 and excludes used 30', () => {
    const s = fixture(); s.joiners.players = [helper(201, 6, {dailyHelpNum: 22}), helper(202, 4, {dailyHelpNum: 0}), helper(203, 8, {dailyHelpNum: 30})];
    const plan = internal.planFarming(s);
    assert.equal(plan.teams[0].power, 1400); assert.ok(plan.teams.every(t => !t.uids.includes('203')));
});
test('missing daily-help count does not grant a guessed slot', () => {
    const s = fixture(); s.joiners.players = [helper(201, 6, {dailyHelpNum: undefined}), helper(202, 4)];
    assert.equal(internal.planFarming(s).action, 'unavailable');
});
test('invalid daily-help count is rejected rather than treated as zero', () => {
    const s = fixture(); s.joiners.players = [helper(201, 6, {dailyHelpNum: 'unknown'}), helper(202, 4)];
    assert.equal(internal.planFarming(s).action, 'unavailable');
});
test('quality and willingness restrict new helpers', () => {
    const s = fixture(); s.joiners.players = [helper(201, 8, {inHelpList: false}), helper(202, 8, {entrustQuality: [1]}), helper(203, 4, {entrustQuality: [1]})];
    assert.equal(internal.planFarming(s).entrust_id, 1001);
    s.joiners.players[0].inHelpList = true;
    assert.equal(internal.planFarming(s).entrust_id, 1001);
});
test('duplicate and self UID never form a fake three-person team', () => {
    const s = fixture(); s.joiners.players = [helper(100, 8), helper(201, 8), helper(201, 8)];
    assert.equal(internal.planFarming(s).action, 'unavailable');
});
test('existing helper is kept even absent from joiner list or exhausted', () => {
    const s = lobby(fixture(), [helper(205, 6, {dailyHelpNum: 30, inHelpList: false})]);
    const plan = internal.planFarming(s);
    assert.equal(plan.action, 'invite'); assert.equal(plan.teams[0].uids[0], '205');
});
test('existing low mission is retained rather than replaced', () => {
    const s = lobby(fixture(), [], 1001);
    assert.equal(internal.planFarming(s).entrust_id, 1001);
});
test('two confirmed helpers can start without fresh eligibility', () => {
    const s = lobby(fixture(), [helper(201, 6), helper(202, 4)]); s.joiners = {ret: 9, players: []};
    assert.equal(internal.planFarming(s).action, 'start');
});
test('two insufficient or duplicate helpers cannot start', () => {
    const s = lobby(fixture(), [helper(201, 3), helper(202, 3)]);
    assert.equal(internal.planFarming(s).action, 'unavailable');
    s.data.entrust.teammates = [helper(201, 8), helper(201, 8)];
    assert.equal(internal.planFarming(s).action, 'unavailable');
});
test('helper multiplier and dynamic level configuration are used', () => {
    const s = fixture(); s.rules.helper_power_param = 500;
    s.joiners.players = [helper(201, 8), helper(202, 8)];
    assert.equal(internal.planFarming(s).entrust_id, 1001);
    s.config.playerLvConfig.find(r => r.id === 8).power = 1000;
    assert.equal(internal.planFarming(s).entrust_id, 2001);
});
test('highest feasible board choice and theoretical refresh target differ', () => {
    const s = fixture(); s.board.entrusts = [1001, 1001];
    const plan = internal.planFarming(s);
    assert.equal(plan.entrust_id, 1001); assert.equal(plan.target_id, 2001);
});
test('no feasible board task does not guess a default', () => {
    const s = fixture(); s.board.entrusts = [3001];
    const plan = internal.planFarming(s);
    assert.equal(plan.action, 'unavailable'); assert.equal(plan.target_id, 2001);
});
test('planner never mutates server snapshot', () => {
    const s = fixture(), before = copy(s); internal.planFarming(s); assert.deepEqual(s, before);
});
test('working, finished and unknown room states are distinct', () => {
    const s = lobby(fixture()); s.data.entrust.state = 2; s.data.entrust.endTime = Date.now() + 100000;
    assert.equal(internal.planFarming(s).action, 'working');
    s.data.entrust.endTime = Date.now() - 1; assert.equal(internal.planFarming(s).action, 'finished');
    s.data.entrust.state = 8; assert.equal(internal.planFarming(s).action, 'unavailable');
});
test('working rooms must have the current owner and a real end time', () => {
    const s = lobby(fixture()); s.data.entrust.state = 2;
    assert.equal(internal.planFarming(s).action, 'unavailable');
    s.data.entrust.endTime = Date.now() + 100000; s.data.entrust.leader = helper(999, 4);
    assert.equal(internal.planFarming(s).action, 'unavailable');
});
test('native flow accepts highest mission, sets a full pair, verifies running', async () => {
    const h = harness(), result = await tasks.mua_vu_ban_ron.run(h.ctx);
    assert.equal(result.status, 'success');
    const mutations = h.calls.filter(c => /Accept|TeammateSet|EntrustGo/.test(c.method));
    assert.deepEqual(mutations.map(c => c.method), ['sendFarmingEntrustAcceptReqMsg', 'sendFarmingTeammateSetReqMsg', 'sendFarmingEntrustGoReqMsg']);
    assert.equal(mutations[0].args[1], 2001);
    assert.deepEqual(mutations[1].args[1], [201, 202]);
    assert.equal(h.snapshot.data.entrust.state, 2);
});
test('existing helper is sent in the complete native set request', async () => {
    const h = harness(lobby(fixture(), [helper(205, 6, {dailyHelpNum: 30})]));
    await tasks.mua_vu_ban_ron.run(h.ctx);
    const set = h.calls.find(c => c.method === 'sendFarmingTeammateSetReqMsg');
    assert.deepEqual(set.args[1], [205, 202]);
    assert.ok(!h.calls.some(c => /Accept|Refresh/.test(c.method)));
});
test('already working does not mutate the room', async () => {
    const s = lobby(fixture(), [helper(201, 6), helper(202, 4)]); s.data.entrust.state = 2; s.data.entrust.endTime = Date.now() + 100000;
    const h = harness(s), result = await tasks.mua_vu_ban_ron.run(h.ctx);
    assert.equal(result.status, 'already_done'); assert.equal(h.calls.length, 4);
});
test('refreshes at most once and only within live free allowance', async () => {
    const s = fixture(); s.board.entrusts = [1001];
    const h = harness(s); await tasks.mua_vu_ban_ron.run(h.ctx);
    assert.equal(h.calls.filter(c => c.method === 'sendFarmingEntrustRefreshReqMsg').length, 1);
    const paid = fixture(); paid.board.entrusts = [1001]; paid.board.refresh = 1;
    const h2 = harness(paid); await tasks.mua_vu_ban_ron.run(h2.ctx);
    assert.ok(!h2.calls.some(c => c.method === 'sendFarmingEntrustRefreshReqMsg'));
    assert.equal(h2.calls.find(c => c.method === 'sendFarmingEntrustAcceptReqMsg').args[1], 1001);
});
test('generic accepted ACK cannot fabricate teammates or trigger start', async () => {
    const h = harness(fixture(), {call(method) { if (method === 'sendFarmingTeammateSetReqMsg') return {ret: 0}; }});
    await assert.rejects(tasks.mua_vu_ban_ron.run(h.ctx), /chưa xác nhận đủ/);
    assert.equal(h.calls.filter(c => c.method === 'sendFarmingTeammateSetReqMsg').length, 1);
    assert.ok(!h.calls.some(c => c.method === 'sendFarmingEntrustGoReqMsg'));
});
test('unconfirmed acceptance does not invite or start', async () => {
    const h = harness(fixture(), {call(method) { if (method === 'sendFarmingEntrustAcceptReqMsg') return {ret: 0}; }});
    await assert.rejects(tasks.mua_vu_ban_ron.run(h.ctx), /chưa xác nhận nhận nhiệm vụ/);
    assert.equal(h.calls.filter(c => c.method === 'sendFarmingEntrustAcceptReqMsg').length, 1);
    assert.ok(!h.calls.some(c => /TeammateSet|EntrustGo/.test(c.method)));
});
test('acceptance timeout reconciles successful server state without accepting twice', async () => {
    let once = false;
    const h = harness(fixture(), {call(method, args, s) {
        if (method === 'sendFarmingEntrustAcceptReqMsg' && !once) {
            once = true; lobby(s, [], args[1]); throw new Error('timeout');
        }
    }});
    assert.equal((await tasks.mua_vu_ban_ron.run(h.ctx)).status, 'success');
    assert.equal(h.calls.filter(c => c.method === 'sendFarmingEntrustAcceptReqMsg').length, 1);
});
test('ambiguous team timeout reads server once and never repeats mutation', async () => {
    const h = harness(fixture(), {call(method) { if (method === 'sendFarmingTeammateSetReqMsg') throw new Error('timeout'); }});
    await assert.rejects(tasks.mua_vu_ban_ron.run(h.ctx), /chưa xác nhận đủ/);
    assert.equal(h.calls.filter(c => c.method === 'sendFarmingTeammateSetReqMsg').length, 1);
    assert.ok(!h.calls.some(c => c.method === 'sendFarmingEntrustGoReqMsg'));
});
test('definite team rejection can try another feasible pair', async () => {
    let rejected = false;
    const h = harness(fixture(), {call(method) {
        if (method === 'sendFarmingTeammateSetReqMsg' && !rejected) { rejected = true; return {ret: 7}; }
    }});
    assert.equal((await tasks.mua_vu_ban_ron.run(h.ctx)).status, 'success');
    assert.equal(h.calls.filter(c => c.method === 'sendFarmingTeammateSetReqMsg').length, 2);
});
test('start ret zero with no running state is a failure', async () => {
    const h = harness(fixture(), {call(method, args, s) {
        if (method === 'sendFarmingEntrustGoReqMsg') return {ret: 0, entrust: copy(s.data.entrust)};
    }});
    await assert.rejects(tasks.mua_vu_ban_ron.run(h.ctx), /chưa có xác nhận|Chưa có xác nhận/);
});
test('start timeout can confirm actual running state by a fresh read', async () => {
    const h = harness(fixture(), {call(method, args, s) {
        if (method === 'sendFarmingEntrustGoReqMsg') {
            s.data.entrust.state = 2; s.data.entrust.endTime = Date.now() + 100000;
            throw new Error('timeout');
        }
    }});
    assert.equal((await tasks.mua_vu_ban_ron.run(h.ctx)).status, 'success');
    assert.equal(h.calls.filter(c => c.method === 'sendFarmingEntrustGoReqMsg').length, 1);
});
test('expired start confirmation does not count as running', async () => {
    const h = harness(fixture(), {call(method, args, s) {
        if (method === 'sendFarmingEntrustGoReqMsg') {
            const room = copy(s.data.entrust); room.state = 2; room.endTime = Date.now() - 100;
            return {ret: 0, entrust: room};
        }
    }});
    await assert.rejects(tasks.mua_vu_ban_ron.run(h.ctx), /Chưa có xác nhận/);
});
test('unexpected task or helper in start response cannot confirm success', async () => {
    const h = harness(fixture(), {call(method, args, s) {
        if (method === 'sendFarmingEntrustGoReqMsg') {
            const room = copy(s.data.entrust); room.state = 2; room.endTime = Date.now() + 10000; room.teammates[0] = helper(909, 8);
            return {ret: 0, entrust: room};
        }
    }});
    await assert.rejects(tasks.mua_vu_ban_ron.run(h.ctx), /Chưa có xác nhận/);
});
test('Stop prevents later mutations', async () => {
    const h = harness(fixture(), {call(method, args, s, calls, stop) { if (method === 'sendFarmingJoinerReqMsg') stop(); }});
    await assert.rejects(tasks.mua_vu_ban_ron.run(h.ctx), /Đã dừng/);
    assert.ok(!h.calls.some(c => /Accept|TeammateSet|EntrustGo/.test(c.method)));
});
test('closed activity is skipped without native calls', async () => {
    const h = harness(); h.ctx.activity = () => null;
    assert.equal((await tasks.mua_vu_ban_ron.run(h.ctx)).status, 'skipped'); assert.equal(h.calls.length, 0);
});
test('completed room does not call donation-data as a fake harvest', async () => {
    const s = lobby(fixture(), [helper(201, 6), helper(202, 4)]); s.data.entrust.state = 3;
    const h = harness(s);
    await assert.rejects(tasks.mua_vu_ban_ron.run(h.ctx), /chưa cập nhật kết quả/);
    assert.ok(!h.calls.some(c => /Donate|Accept|TeammateSet|EntrustGo/.test(c.method)));
});
test('mail requires typed successful reward, never just completion of a send', async () => {
    const ctx = {check() {}, async call() { return {ret: 0, reward: '101001=100'}; }};
    assert.equal((await tasks.mail_rewards.run(ctx)).status, 'success');
    ctx.call = async () => ({ret: 0, reward: ''}); assert.equal((await tasks.mail_rewards.run(ctx)).status, 'already_done');
    ctx.call = async () => ({ret: 0}); await assert.rejects(tasks.mail_rewards.run(ctx), /Không đọc được/);
    ctx.call = async () => ({ret: 7}); await assert.rejects(tasks.mail_rewards.run(ctx), /chưa xác nhận/);
});
function signHarness(model, responses) {
    const calls = [], mgr = {model: copy(model), syncSignData(data) { Object.assign(this.model, copy(data)); }};
    const ctx = {check() {}, require() { return {SignMgr: {inst: mgr}}; },
        async call(module, klass, method, args) { calls.push({method, args: copy(args)}); return responses.shift(); }};
    return {ctx, mgr, calls};
}
test('sign-in and eligible accumulation require actual signData', async () => {
    const model = {lastSignDays: 1, currentSignDays: 2, configSignAccumulateRewardDayParam: ['2', '5', '10'], gainedAccumulateIndex: []};
    const h = signHarness(model, [{ret: 0, signData: {...model, lastSignDays: 2}},
        {ret: 0, signData: {...model, lastSignDays: 2, gainedAccumulateIndex: [0]}}]);
    assert.equal((await tasks.daily_signin.run(h.ctx)).status, 'success');
    assert.deepEqual(h.calls, [{method: 'in', args: []}, {method: 'accumulateReward', args: [0]}]);
});
test('already claimed sign-in makes no mutation', async () => {
    const h = signHarness({lastSignDays: 2, currentSignDays: 2, configSignAccumulateRewardDayParam: ['2', '5'], gainedAccumulateIndex: [0]}, []);
    assert.equal((await tasks.daily_signin.run(h.ctx)).status, 'already_done'); assert.equal(h.calls.length, 0);
});
test('sign ACK or unchanged signData is not success', async () => {
    const model = {lastSignDays: 1, currentSignDays: 2, configSignAccumulateRewardDayParam: ['2'], gainedAccumulateIndex: []};
    const h = signHarness(model, [{ret: 0}]); await assert.rejects(tasks.daily_signin.run(h.ctx), /Không đọc được/);
    const h2 = signHarness(model, [{ret: 0, signData: model}]); await assert.rejects(tasks.daily_signin.run(h2.ctx), /chưa cập nhật/);
});
test('accumulation ACK without the claimed index is not success', async () => {
    const model = {lastSignDays: 2, currentSignDays: 2, configSignAccumulateRewardDayParam: ['2'], gainedAccumulateIndex: []};
    const h = signHarness(model, [{ret: 0, signData: model}]);
    await assert.rejects(tasks.daily_signin.run(h.ctx), /chưa xác nhận mốc/);
});
