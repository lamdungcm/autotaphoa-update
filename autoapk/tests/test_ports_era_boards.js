'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./test_full_runtime');
function harness() {
    const h = setup(); h.load('ports_era_boards');
    h.P.claimActivity = async () => 0; h.P.claimEventFree = async () => 0;
    h.P.spendItem = async (ctx, id, quantity, send) => {
        const before = h.P.bag(ctx, id); if (before < quantity) return null;
        const response = h.P.ret(await send());
        await ctx.waitFor(() => h.P.bag(ctx, id) === before - quantity); return response;
    };
    h.run = (id, options = {}) => { const task = h.api.tasks.find(t => t.id === id); h.ctx.options = h.P.options(task.options, options); return task.run(h.ctx); };
    h.act = {activityId: 123}; h.P.findActivity = () => h.act;
    return h;
}
function era() {
    const h = harness();
    h.state = {ret: 0, power: 2, topEra: {era: 10001, level: 1, armyLev: 10001, technology: []}, event: [], buff: []};
    const data = {configData: {}, syncConfig() {}, syncInfo(r) { this.power = r.power; this.topEra = r.topEra; }, syncSearch() {},
        getEraConfig: () => ({energy: 1}), getEventConfig: id => ({eventType: id, param: '10|20'}), getArmyConfig: () => null};
    h.modules.ActivityTopEraMgr = {ActivityTopEraMgr: {inst: {model: {getTopEraData: () => ({syncConfig() {}})}}}};
    h.modules.ActivityTopEraStage1Mgr = {ActivityTopEraStage1Mgr: {inst: {model: {getTopEraData: () => data}}}};
    h.modules.ActivityTopEraStage1Utils = {ActivityTopEraStage1Utils: {isStage1ToStart: () => true, checkEraArmy: () => false, checkEraTechnology: () => false, checkEraPromote: () => false}};
    h.P.accept = async () => ({ret: 0});
    h.net = {getInfo: () => plain(h.state)};
    h.modules.ActivityTopEraStage1NetUtils = {ActivityTopEraStage1NetUtils: h.net}; return h;
}
test('era resolves the returned native choice and confirms resource decrement before another search', async () => {
    const h = era(); let handled = 0;
    h.net.getSearch = () => { h.state.power--; h.state.event = [{eventId: 6}]; return {...plain(h.state), events: [{eventId: 6}]}; };
    h.net.getHandleEvent = (id, option) => { assert.equal(id, 123); assert.equal(option, 1); handled++; h.state.event = []; h.state.buff = [{buffId: 999, count: 1}]; return {ret: 0}; };
    assert.equal((await h.run('dinh_cao_thoi_gian', {limit: 1, eventChoice: '1'})).status, 'success');
    assert.equal(handled, 1); assert.equal(h.calls.filter(c => c.method === 'getSearch').length, 1);
});
test('era search ACK without a real energy decrement never triggers event handling or another search', async () => {
    const h = era(); h.net.getSearch = () => ({...plain(h.state), events: [{eventId: 6}]});
    await assert.rejects(h.run('dinh_cao_thoi_gian'), /Thể lực/);
    assert.deepEqual(h.calls.map(c => c.method), ['getInfo', 'getSearch']);
});
test('era multiple-event selection uses the exact server idx and does not attack again after choose already resolves combat', async () => {
    const h = era(); h.state.power = 0; h.state.event = [{eventId: 4, idx: 8}, {eventId: 5, idx: 11}];
    h.net.getTopEraChooseEvent = (id, idx) => { assert.equal(idx, 8); h.state.event = []; h.state.topEra.level++; return {ret: 0, event: {eventId: 4, idx: 8}}; };
    assert.equal((await h.run('dinh_cao_thoi_gian')).status, 'success');
    assert.ok(!h.calls.some(c => c.method === 'getHandleEvent'));
});
test('era unchanged handle ACK is not accepted as completed work', async () => {
    const h = era(); h.state.event = [{eventId: 7}]; h.net.getHandleEvent = () => ({ret: 0});
    await assert.rejects(h.run('dinh_cao_thoi_gian'), /chưa xác nhận thay đổi/);
    assert.equal(h.calls.filter(c => c.method === 'getHandleEvent').length, 1);
});
function sugar() {
    const h = harness(), bag = {120001: {num: 2}, 120002: {num: 0}};
    h.modules.BagMgr = {BagMgr: {inst: {model: {itemDict: bag}}}};
    const cfg = {DOT_GRID_NUM: 2, DOT_GRID_ITEM_ID: 120001, LUCKY_DRAW_ITEM_ID: 120002, LUCKY_DRAW_TEN_TIMES_SCORE_NUM: 0};
    h.act.getConfigNumber = k => cfg[k]; h.act.getConfigStringList = () => ['999=1'];
    h.state = {ret: 0, activityId: 123, clickGirdIds: [], gainedProgressRewardIds: [], score: 0, round: 1, rareRewardId: -1, noticeList: [], rareRewardInfo: []};
    h.modules.SugarPaintingStallMgr = {SugarPaintingStallMgr: {inst: {syncSugarPaintStallConfigRespMsg() {}, syncSugarPaintStallInfoRespMsg() {}, getRareRewardInfoCount: () => 1}}};
    h.modules.SugarPaintingStallUtil = {SugarPaintingStallUtil: {getRoundConfig: () => 1, getItemStatic: () => ({name: 'Thưởng'})}};
    h.net = {
        sendSugarPaintStallConfigReqMsg: () => ({ret: 0, activityId: 123, dotGridConfig: [{id: 7, gridNumber: 2}], luckyDrawConfig: [{id: 8}]}),
        sendSugarPaintStallInfoReqMsg: () => plain(h.state),
        sendSugarPaintStallClickGridReqMsg: (id, cell) => { bag[120001].num--; h.state.clickGirdIds.push(cell); return {ret: 0, activityId: id, clickGirdIds: [...h.state.clickGirdIds]}; },
        sendSugarPaintStallOneKeyProgressRewardReqMsg: id => { h.state.gainedProgressRewardIds = [7]; bag[120002].num++; return {ret: 0, activityId: id, gainedProgressRewardIds: [7], reward: '120002=1'}; },
        sendSugarPaintStallChooseLuckyDrawReqMsg: (id, rareRewardId) => { h.state.rareRewardId = rareRewardId; return {ret: 0, activityId: id, rareRewardId}; },
        sendSugarPaintStallDrawReqMsg: (id, drawCount) => { bag[120002].num -= drawCount; h.state.score += drawCount; return {ret: 0, activityId: id, drawCount, drawRewardIds: [8], score: h.state.score}; }
    };
    h.modules.SugarPaintingStallNetUtil = {SugarPaintingStallNetUtil: h.net}; h.bag = bag; return h;
}
test('sugar uses live board size, claims the real progress ID then selects a configured rare reward before drawing', async () => {
    const h = sugar(); assert.equal((await h.run('quay_tranh_duong')).status, 'success');
    assert.deepEqual(h.calls.filter(c => c.method === 'sendSugarPaintStallClickGridReqMsg').map(c => c.args[1]), [1, 2]);
    assert.deepEqual(h.calls.filter(c => c.method === 'sendSugarPaintStallChooseLuckyDrawReqMsg').map(c => c.args[1]), [999]);
    assert.equal(h.state.score, 1); assert.equal(h.bag[120002].num, 0);
});
test('sugar click ACK without bag decrement cannot open another cell', async () => {
    const h = sugar(); h.net.sendSugarPaintStallClickGridReqMsg = () => ({ret: 0, activityId: 123, clickGirdIds: [1]});
    await assert.rejects(h.run('quay_tranh_duong'), /timeout/);
    assert.equal(h.calls.filter(c => c.method === 'sendSugarPaintStallClickGridReqMsg').length, 1);
});
test('sugar rejects a reward ID outside the live configured list without spending a ticket', async () => {
    const h = sugar(); h.state.clickGirdIds = [1, 2]; h.state.gainedProgressRewardIds = [7]; h.bag[120001].num = 0; h.bag[120002].num = 1;
    await assert.rejects(h.run('quay_tranh_duong', {rareRewards: [111111]}), /Không có thưởng hiếm/);
    assert.ok(!h.calls.some(c => c.method === 'sendSugarPaintStallDrawReqMsg')); assert.equal(h.bag[120002].num, 1);
});
function night(confirm = true) {
    const h = harness(); let round = 10, dispatched = [];
    h.act.getConfigNumber = () => 2;
    const ministers = [{id: 101, nightFreeNum: 0}, {id: 104, nightFreeNum: 0}];
    const data = {syncInfo() {}, nightSceneInfo: {clear() {}, onEnterScene() {}, onExitScene() {}}};
    h.modules.ActivityWuzetianMgr = {ActivityWuzetianMgr: {inst: {checkNightPartyOpen: () => true, getActData: () => data, model: {getConfigData: () => ({syncConfig() {}})}}}};
    h.modules.ActivityWuzetianUtil = {ActivityWuzetianUtil: {getDailyFreeTimes: () => 1}};
    h.net = {
        requestConfig: () => ({ret: 0, activityId: 123}),
        requestInfo: () => ({ret: 0, info: {minister: plain(ministers)}}),
        enterNight: () => ({ret: 0, round, dispatchList: plain(dispatched)}),
        dispatch: (id, r, ids) => { assert.equal(r, round); if (confirm) { for (const m of ministers) if (ids.includes(m.id)) m.nightFreeNum++; dispatched = ids.map(mid => ({playerInfo: {userId: '100'}, minister: {id: mid}})); } return {ret: 0}; },
        exitNight: () => ({ret: 0})
    };
    h.modules.ActivityWuzetianNetUtil = {activityWuzetianNetUtil: h.net};
    h.ctx.sleep = async () => { h.ctx.check(); round++; dispatched = []; };
    return h;
}
test('night dispatch uses real owned ministers, confirms fresh free counters and waits for the next server round', async () => {
    const h = night(); const result = await h.run('than_do_bat_da');
    assert.equal(result.status, 'success'); assert.match(result.message, /kết thúc 1 vòng/);
    assert.deepEqual(plain(h.calls.find(c => c.method === 'dispatch').args[2]), [101, 104]);
    assert.equal(h.calls.filter(c => c.method === 'dispatch').length, 1); assert.equal(h.calls.at(-1).method, 'exitNight');
});
test('night dispatch ACK without fresh membership and counts stops after one attempt', async () => {
    const h = night(false); await assert.rejects(h.run('than_do_bat_da'), /chưa xác nhận quan lại/);
    assert.equal(h.calls.filter(c => c.method === 'dispatch').length, 1);
});
test('night Stop while waiting sends no later query, dispatch or exit', async () => {
    const h = night(); h.ctx.sleep = async () => { h.stop(); h.ctx.check(); };
    await assert.rejects(h.run('than_do_bat_da'), /stopped/);
    assert.equal(h.calls.at(-1).method, 'enterNight'); assert.equal(h.calls.filter(c => c.method === 'dispatch').length, 1);
});
test('night uses the actual per-round minister capacity and never fills extra slots by guessing', async () => {
    const h = night(); h.act.getConfigNumber = () => 1;
    assert.equal((await h.run('than_do_bat_da')).status, 'success');
    assert.deepEqual(h.calls.filter(c => c.method === 'dispatch').map(c => plain(c.args[2])), [[101], [104]]);
});
