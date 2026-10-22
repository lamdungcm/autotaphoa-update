'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./test_full_runtime');
function create() {
    const h = setup(); h.load('ports_rich_pig'); h.P.vnClock = () => ({getUTCHours: () => 12});
    h.run = (id, values = {}) => { const task = h.api.tasks.find(t => t.id === id); h.ctx.options = h.P.options(task.options, values); return task.run(h.ctx); };
    return h;
}
function rich(h, configs) {
    h.modules.DBUtil = {DBUtil: {getRichQuickSecretFundConfig: () => configs,
        getRichQuickSecretMainConfigById: () => ({sustainedDay: 7, taskAndRewardId: 9, giftAddReward: '1=101001,10'}), getTask: () => null,
        getConfigByParam: key => ({value: key.includes('ACCUMULATED') ? '3' : '101001=1'})}};
    h.modules.TimeUtil = {TimeUtil: {getServerTimeMs: () => 3 * 86400000, getCurZeroTime: t => Math.floor(t / 86400) * 86400, isToday: t => t === 3 * 86400}};
    h.modules.TaskUtil = {TaskUtil: {getRichQuickSecretTaskList: () => []}};
    h.modules.TaskConfig = {EnumTaskState: {unReceived: 0, received: 1}};
    h.modules.TaskMgr = {TaskMgr: {inst: {getTaskInfo() {}, completeTask() {}}}};
}
test('rich progress keeps exact large integer bits and never rounds an unsafe numeric value', () => {
    const h = create(); assert.equal(h.P.richPig.bit('9007199254740993', 0), true);
    assert.equal(h.P.richPig.bit('9007199254740993', 53), true); assert.equal(h.P.richPig.bit('9007199254740993', 1), false);
    assert.equal(h.P.richPig.atLeast('9007199254740993', '9007199254740992'), true);
    assert.throws(() => h.P.richPig.bit(9007199254740992, 1), /nguyên bản/);
});
test('rich sign selection uses current server day, signed earlier days and genuine paid ownership', () => {
    const h = create(); rich(h, [1, 2, 3, 4].map(day => ({id: day, templateId: 101, type: 1, param: day, freeReward: 'x', payReward: 'y'})));
    const info = {cycleId: 1, systemCycle: {curStartTime: 86400000}};
    const mission = {templateId: 101, value: 4, freeReward: [2], paidReward: [], buy: false}; // day 2 signed; now day 3
    assert.deepEqual(plain(h.P.richPig.richTargets(h.ctx, info, mission)).map(x => x.id), [3]);
    mission.buy = true;
    assert.deepEqual(plain(h.P.richPig.richTargets(h.ctx, info, mission)).map(x => x.id), [2, 3]);
});
test('rich claim requires the fresh mission list to mark the exact eligible tier received', async () => {
    const h = create(); rich(h, [{id: 201, templateId: 102, type: 2, param: 100, freeReward: 'x', payReward: 'y'}]);
    const info = {cycleId: 1, moduleMissionList: [{templateId: 102, value: '100', freeReward: [], paidReward: [], buy: false}],
        systemCycle: {curStartTime: 86400000}, giftPack: {times: 0, receivedTimeRewards: [], lastGainFreeRewardTime: 3 * 86400000}};
    const sent = [];
    h.P.packet = async (ctx, symbol, body) => { sent.push([symbol, plain(body)]); return symbol === 'S_SECRET_INFO' ? info : {ret: 0, templateId: 102, reward: '101001=1'}; };
    await assert.rejects(h.P.richPig.richMain(h.ctx), /chuyển sang đã nhận/);
    assert.deepEqual(sent.map(x => x[0]), ['S_SECRET_INFO', 'S_SECRET_GET_REWARD', 'S_SECRET_INFO']);
    assert.ok(!sent.some(x => /CLIENT|CHECK|RECHARGE/.test(x[0])));
});
test('rich rewards use configured mission IDs and cumulative purchase threshold without buying or forging progress', async () => {
    const h = create(); rich(h, [{id: 801, templateId: 877, type: 2, param: 100, freeReward: 'x', payReward: 'y'}]);
    const info = {cycleId: 1, moduleMissionList: [{templateId: 877, value: '100', freeReward: [], paidReward: [], buy: false}],
        systemCycle: {curStartTime: 86400000}, giftPack: {times: 3, receivedTimeRewards: [], lastGainFreeRewardTime: 3 * 86400000}};
    const mutations = [];
    h.P.packet = async (ctx, symbol, body) => {
        if (symbol === 'S_SECRET_INFO') return info;
        mutations.push([symbol, plain(body)]);
        if (symbol === 'S_SECRET_GET_REWARD') { info.moduleMissionList[0].freeReward.push(801); return {ret: 0, templateId: 877, reward: '101001=1'}; }
        info.giftPack.receivedTimeRewards.push(body.times); return {ret: 0, giftPack: info.giftPack};
    };
    assert.equal(await h.P.richPig.richMain(h.ctx), 2);
    assert.deepEqual(mutations, [['S_SECRET_GET_REWARD', {templateId: 877}], ['S_SECRET_GIFT_PACK_REWARD', {times: 3}]]);
});
test('activity pass rewards use conditionId from native reward items and deduplicate free reward icons', async () => {
    const h = create();
    h.modules.BattlePassMgr = {BattlePassMgr: {inst: {model: {battlePassData: {hasLevelReward: () => false}}}}};
    h.modules.FundMgr = {FundMgr: {inst: {getOpenFundList: () => []}}}; h.modules.FundUtil = {FundUtil: {}};
    const marked = [], act = {state: 2, activityId: 5, setConditionRewardReceived: id => marked.push(id)};
    h.modules.ActivityMgr = {ActivityMgr: {inst: {getActivityList: type => type === 5 ? [act] : [], syncActivityData() {}}}};
    h.modules.ActivityFundMgr = {ActivityFundMgr: {inst: {getOpenFundList: () => []}}};
    h.modules.ActivityBattlePassUtil = {ActivityBattlePassUtil: {buildBattlePassLevelRewardList: () => [{freeRewardList: [{id: 101001, conditionId: 123}, {id: 101002, conditionId: 123}], payRewardList: []}], getBattlePassItemRewardState: () => 1}};
    h.P.packet = async (ctx, symbol, body) => symbol === 'S_ACTIVITY_DATA' ? {ret: 0, data: {activityId: 5}} : {ret: 0, activityId: 5, conditionId: body.conditionId, reward: 'x'};
    assert.equal(await h.P.richPig.keyRewards(h.ctx), 1); assert.deepEqual(marked, [123]);
});
function pigPhysics(h) {
    let updates = 0;
    const collision = {enabled: false}, physics = {enabled: false, update() { updates++; }};
    h.root.cc.director = {getPhysicsManager: () => physics, getCollisionManager: () => collision};
    h.root.cc.v2 = (x, y) => ({x, y});
    h.modules.SpineConfig = {SpineConfig: {ANI_IDLE2: 'idle2'}};
    h.modules.PigPigConfig = {PigPigConfig: {DINNER_GAME_CHECK_FRAME: 24, GAME_SLEEP_TIME: 5000}};
    const next = {node: {active: true, x: 50, y: 20}, level: 2, pigId: 2, width: 20, isNext: true, isAwake: () => false, getHeight: () => -10,
        updateX(x) { this.node.x = x; }, enableRigidbody() {}, setIsNext(v) { this.isNext = v; }, modifyMoveSpeed() {}, playAnimation() {}, clearMoveSpeed() {}};
    const game = {activityId: 44, minX: 10, maxX: 90, nextFruitCom: next, fruitItemList: [next], FRAME_SPEED: 2, info: {costType: 1, score: 0},
        isViewValid: () => true, updatePeopleX() {}, clearComposes() {}, refreshScore() {}, getGameContainerTBLR: () => ({top: 0}),
        unEnabledPhysicsManager() { physics.enabled = false; }, _getBoardData: () => '{"nextFruitId":2,"nextFruitStep":2,"fruitDatas":[]}',
        _getDropPigId() { return this.drop.pigId; }, _getComposePigIdList: () => [], _getPigList: () => [{pigId: 2, count: 1}]};
    h.modules.PigPigMgr = {PigPigMgr: {inst: {calcDropScoreByConfig: () => 1, getPigPigBallConfigByLevel: () => ({})}}};
    return {game, physics, collision, next, updates: () => updates};
}
test('pig drop reads the actual controller board after running physics and sends no network request itself', async () => {
    const h = create(), p = pigPhysics(h);
    const result = await h.P.richPig.physicsDrop(h.ctx, p.game);
    assert.ok(p.updates() >= 24); assert.equal(p.physics.enabled, false); assert.equal(result.drop, 2);
    assert.deepEqual(plain(result.pigs), [{pigId: 2, count: 1}]); assert.equal(result.board, p.game._getBoardData());
    assert.equal(h.calls.length, 0); assert.equal(p.next.isNext, false);
});
test('Stop during pig physics aborts before a finish request can be constructed', async () => {
    const h = create(), p = pigPhysics(h); let sleeps = 0;
    h.ctx.sleep = async () => { if (++sleeps === 2) h.stop(); h.ctx.check(); };
    await assert.rejects(h.P.richPig.physicsDrop(h.ctx, p.game), /stopped/); assert.equal(h.calls.length, 0);
});
test('changing the top scene during pig physics aborts before any finish request', async () => {
    const h = create(), p = pigPhysics(h);
    await assert.rejects(h.P.richPig.physicsDrop(h.ctx, p.game, () => false), /đã đổi/); assert.equal(h.calls.length, 0);
});
test('pig board receipt must match every live fruit position and next step', () => {
    const h = create();
    const board = {nextFruitId: 9, nextFruitStep: 8, fruitDatas: [{fruitId: 1, level: 3, position: {x: 10.1234, y: -22.1234}}]};
    assert.equal(h.P.richPig.sameBoard(JSON.stringify(board), JSON.stringify(board)), true);
    const altered = plain(board); altered.fruitDatas[0].position.y++;
    assert.equal(h.P.richPig.sameBoard(JSON.stringify(board), JSON.stringify(altered)), false);
    altered.fruitDatas = []; assert.equal(h.P.richPig.sameBoard(JSON.stringify(board), JSON.stringify(altered)), false);
});
test('pig refuses obsolete finish protocol before any power or game mutation', async () => {
    const h = create(); h.P.findActivity = () => ({activityId: 44}); h.P.schema = () => ({requestFields: {boardData: {}, gameOver: {}}});
    h.modules.PigPigMgr = {PigPigMgr: {inst: {checkInOpenTime: () => true}}};
    await assert.rejects(h.run('pig_breeding'), /chưa tiêu hao/); assert.equal(h.calls.length, 0);
});
function fullPig(h, wrongReceipt = false) {
    const p = pigPhysics(h), game = p.game; let currentView = null, closeCount = 0, power = 1, view = null, openedType = null;
    Object.assign(p.physics, {enabled: true, gravity: {x: 3, y: -123}, enabledAccumulator: false, debugDrawFlags: 12});
    const model = {getActivityData: () => ({power})};
    let info = {timeId: '99', costType: 0, score: 0, boardData: '{"nextFruitId":1,"nextFruitStep":1,"fruitDatas":[]}'};
    class View { static getUuid() { return 'pig'; } update() {} onNetConnect() {}
        afterInitView() { this.pigPigGame = game; p.physics.gravity = {x: 0, y: -960}; p.physics.enabledAccumulator = true; p.physics.debugDrawFlags = 0; }
        addEvents() {} }
    Object.assign(game, {timeId: '99', canOperate: true, removeEvents() {}, creatorNextFruit: async () => {}, refreshGameView() {}, refreshStep() {}, fruitId: 1,
        isViewValid: () => currentView === view});
    h.modules.PigPigGameView = {PigPigGameView: View};
    const mgr = h.modules.PigPigMgr.PigPigMgr.inst;
    Object.assign(mgr, {model, checkInOpenTime: () => true, syncActivityConfig() {}, initConfigParam() {}, syncPower(id, value) { power = value; },
        syncGameInfo(id, value) { info = value; }, syncBook() {}, getCurGameType: () => 0, getNextBallLevel: () => 2, getPowerCost: () => 1});
    h.modules.UIMgr = {UIMgr: {inst: {getView: () => currentView, getTopViewUuid: () => currentView ? 'pig' : 'previous', openWith(type) {
        openedType = type; currentView = view = new type(); view.afterInitView(); view.addEvents(); game.info = info;
    },
        close() { closeCount++; currentView = null; }}}};
    h.modules.PigPigNetUtil = {PigPigNetUtil: {
        activityConfig: id => ({ret: 0, activityId: id, paramConfig: [{id: 2}]}),
        activityInfo: () => ({ret: 0, power, powerRecoveryTime: 0, book: [], info: {...info}}),
        useItem: () => { power--; info = {...info, costType: 1}; return {ret: 0, power, powerRecoveryTime: 0, info}; },
        finishUseItem: (id, time, type, board) => { info = {...info, costType: 0, boardData: wrongReceipt ? '{"nextFruitId":5,"nextFruitStep":3,"fruitDatas":[]}' : board}; return {ret: 0, info}; }
    }};
    h.P.schema = () => ({requestFields: Object.fromEntries(['activityId', 'timeId', 'costType', 'boardData', 'dropPigId', 'composePigId', 'pig'].map(key => [key, {}]))});
    h.P.findActivity = () => ({activityId: 44});
    return {get view() { return view; }, nativeType: View, openedType: () => openedType, physics: p.physics, closeCount: () => closeCount, power: () => power};
}
test('pig completes the last reserved turn even when remaining power becomes zero without patching native view descriptors', async () => {
    const h = create(), p = fullPig(h);
    assert.equal((await h.run('pig_breeding', {turns: 1, freeGifts: false})).status, 'success');
    assert.equal(p.power(), 0); assert.equal(h.calls.filter(c => c.method === 'finishUseItem').length, 1); assert.equal(p.closeCount(), 1);
    assert.equal(Object.hasOwn(p.view, 'update'), false); assert.equal(Object.hasOwn(p.view, 'onNetConnect'), false);
    assert.notEqual(p.openedType(), p.nativeType); assert.notEqual(p.openedType().prototype.update, p.nativeType.prototype.update);
    assert.equal(p.physics.enabled, true); assert.deepEqual(plain(p.physics.gravity), {x: 3, y: -123});
    assert.equal(p.physics.enabledAccumulator, false); assert.equal(p.physics.debugDrawFlags, 12);
});
test('pig rejects a mismatched finish board and closes only its view before another power reservation', async () => {
    const h = create(), p = fullPig(h, true);
    await assert.rejects(h.run('pig_breeding', {turns: 2, freeGifts: false}), /đúng bàn vật lý/);
    assert.equal(h.calls.filter(c => c.method === 'useItem').length, 1); assert.equal(p.closeCount(), 1);
    assert.equal(Object.hasOwn(p.view, 'update'), false);
});
test('Stop closes the private pig view and restores previous physics before another request', async () => {
    const h = create(), p = fullPig(h); let sleeps = 0;
    h.ctx.sleep = async () => { if (++sleeps === 2) h.stop(); h.ctx.check(); };
    await assert.rejects(h.run('pig_breeding', {turns: 2, freeGifts: false}), /stopped/);
    assert.equal(h.calls.filter(c => c.method === 'finishUseItem').length, 0); assert.equal(p.closeCount(), 1);
    assert.equal(p.physics.enabled, true); assert.deepEqual(plain(p.physics.gravity), {x: 3, y: -123});
});
