'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./test_full_runtime');
function fixture() {
    const h = setup(); ['ports_events_base', 'ports_phone', 'ports_investment', 'ports_logistics'].forEach(n => h.load(n));
    h.P.findActivity = () => ({activityId: 123}); h.P.claimActivity = h.P.claimEventFree = h.P.claimWarOrder = async () => 0;
    h.run = (id, values = {}) => { const t = h.api.tasks.find(t => t.id === id); h.ctx.options = h.P.options(t.options, values); return t.run(h.ctx); };
    return h;
}
test('PHS chooses an actual adjacent matching component on a sparse non-square board', () => {
    const h = fixture(), cells = [{x: 10, y: 2, level: 1}, {x: 11, y: 2, level: 1}, {x: 11, y: 3, level: 1}, {x: 8, y: 2, level: 2}];
    assert.deepEqual(plain(h.P.phoneMove(cells, {1: true, 2: true})), {operation: 1, x: 11, y: 3});
    assert.equal(h.P.phoneMove(cells.slice(2), {1: true, 2: true}).operation, 2);
    assert.throws(() => h.P.phoneMove([cells[0], cells[0]], {1: true}), /trùng/);
});
test('PHS does not send another board operation after an ACK without the changed step', async () => {
    const h = fixture(); let operations = 0;
    h.modules.ActivityPhoneStoreMgr = {ActivityPhoneStoreMgr: {inst: {model: {getPhoneStoreData: () => ({syncConfig() {}, syncInfo() {}})}, getIsInServerGuide: () => false}}};
    h.modules.ActivityPhoneStoreNetUtil = {ActivityPhoneStoreNetUtil: {
        getConfig: () => ({ret: 0, phoneConfig: [{id: 1}]}),
        getInfo: () => ({ret: 0, action: 2, energy: 1, store: {step: 2}, game: {chessboard: {cells: [{x: 4, y: 5, level: 1}]}}}),
        operationCell: () => { operations++; return {ret: 0}; }
    }};
    await assert.rejects(h.run('dien_thoai_phs'), /không khớp/); assert.equal(operations, 1);
});

test('PHS starts a round using its real configured energy cost, never a fixed six-step assumption', async () => {
    const h = fixture(); let started = false, step = 0;
    h.modules.ActivityPhoneStoreMgr = {ActivityPhoneStoreMgr: {inst: {model: {getPhoneStoreData: () => ({syncConfig() {}, syncInfo() {}})}, getIsInServerGuide: () => false}}};
    h.modules.ActivityPhoneStoreNetUtil = {ActivityPhoneStoreNetUtil: {
        getConfig: () => ({ret: 0, phoneConfig: [{id: 1}], storeLevelConfig: [{level: 4, energyCost: 3}]}),
        getInfo: () => ({ret: 0, action: 2, energy: started ? 0 : 3, store: {step, level: 4}, game: {chessboard: {cells: [{x: 4, y: 5, level: 1}]}}}),
        spread: () => { started = true; step = 1; return {ret: 0, energy: 0, store: {step: 1}}; },
        operationCell: () => { step = 0; return {ret: 0, chessboard: {step: 0, operateResult: {operateCell: {x: 4, y: 5}}}}; }
    }};
    assert.equal((await h.run('dien_thoai_phs')).status, 'success'); assert.equal(h.calls.filter(c => c.method === 'operationCell').length, 1);
});
test('investment news applies sector stories to matching configured sectors, without inventing unknown good news', () => {
    const h = fixture(), data = {gameInfo: {stocks: [{stockId: 1, price: 10}, {stockId: 2, price: 3}], news: [{newsId: 3, effectId: 9}]}, getStockConfig: id => ({sectors: id === 1 ? 9 : 8}), getNewsConfig: () => ({type: 1})};
    assert.equal(h.P.investPick(data, 'news').stockId, 1); data.gameInfo.news[0].newsId = 999;
    assert.equal(h.P.investPick(data, 'news').stockId, 2);
});
function invest(h, invalid) {
    let held = 0, funds = 100, settled = false;
    const snapshot = () => ({curTurn: 1, curRound: 1, funds, freeTimes: 0, news: [], stocks: [{stockId: 1, price: 10, heldNum: held}]});
    const data = {investParam: {investStockTurnRoundNum: 5, investStockHoldingMaxNum: 10}, syncConfig() {}, syncData() {}, syncStartGame: r => { data.gameInfo = r.gameInfo; }, syncBuyStock() {}, syncInvestResultRound() {}, getStockConfig: () => ({sectors: 1})};
    h.modules.ActivityStockMarketMgr = {ActivityStockMarketMgr: {inst: {model: {getInvestData: () => data}}}};
    h.modules.ActivityStockMarketNetUtil = {ActivityStockMarketNetUtil: {
        getConfig: () => ({ret: 0}), getData: () => ({ret: 0, freeTimes: 1, continue: false}),
        getStartGame: () => ({ret: 0, gameInfo: snapshot()}),
        getBuyStock: (id, sid, num) => { held = num; funds = 0; return invalid ? {ret: 0, funds: 1, stock: {stockId: sid, heldNum: num}} : {ret: 0, funds, stock: {stockId: sid, heldNum: num}}; },
        getInvestResultRound: () => { settled = true; return {ret: 0, gameInfo: snapshot(), turnResult: {}}; }
    }};
    return () => settled;
}
test('investment confirms actual holdings/funds on a fresh read before settling and reports actual ending capital', async () => {
    const h = fixture(), settled = invest(h, false);
    const result = await h.run('con_bao_dau_tu', {weeks: 1, autoTeam: false}); assert.equal(result.status, 'success');
    assert(settled()); assert.match(result.message, /Vốn cuối 100/); assert.equal(h.calls.filter(c => c.method === 'getStartGame').length, 2);
});
test('investment refuses a purchase whose funds do not match the confirmed stock quantity', async () => {
    const h = fixture(), settled = invest(h, true);
    await assert.rejects(h.run('con_bao_dau_tu', {weeks: 1, autoTeam: false}), /không khớp/); assert(!settled());
});
test('investment without a free or running game never invokes start or trades', async () => {
    const h = fixture(); invest(h, false); h.modules.ActivityStockMarketNetUtil.ActivityStockMarketNetUtil.getData = () => ({ret: 0, freeTimes: 0, continue: false});
    assert.equal((await h.run('con_bao_dau_tu', {autoTeam: false})).status, 'already_done'); assert(!h.calls.some(c => c.method === 'getStartGame'));
});
function logistics(h, rows, searchReply) {
    let current = rows, power = 2; const sent = [];
    const common = {energy: 2, myPveAbility: 600, configEnergyCost: 1, setInfoData: r => { common.energy = r.pveInfo.power; }, setPveEnterSceneData() {}, syncPveHandleEvent() {}, syncPveSearch() {}};
    const scene = {goldSilverBoxDataList: [], syncInfo() {}, syncPveEnterScene() {}};
    const data = {syncConfig() {}, syncUnionEligible() {}, getEventConfig: () => ({eventType: 1})};
    h.modules.ActivityLogisticsMgr = {ActivityLogisticsMgr: {inst: {getData: () => data, getCommonData: () => common, getSceneData: () => scene}}};
    h.P.packet = async (ctx, symbol, body) => {
        sent.push([symbol, plain(body)]);
        if (symbol.endsWith('_UNION')) return {ret: 0, hasEligible: true};
        if (symbol.endsWith('_INFO')) return {ret: 0, packageReward: '', pveInfo: {power, ability: 600, box: []}};
        if (symbol.endsWith('_ENTER_SCENE')) return {ret: 0, level: 1, exp: 0, map: {myEvent: current}};
        if (symbol.endsWith('_HANDLE_EVENT')) { current = []; return {ret: 0, attack: {win: true}}; }
        if (symbol.endsWith('_SEARCH')) return searchReply;
        if (symbol.endsWith('_LEVEL_REWARD_LIST')) return {ret: 0, redPacket: []};
        return {ret: 0};
    };
    return sent;
}
test('logistics handles the actual monster ID and verifies removal rather than sending the PC hardcoded param', async () => {
    const h = fixture(), sent = logistics(h, [{eventId: 97001, monster: {monsterId: '9933', blood: 500}}]);
    assert.equal((await h.run('tranh_doat_mo_khoang', {searches: 0, joins: 0})).status, 'success');
    assert.deepEqual(sent.find(r => r[0].endsWith('_HANDLE_EVENT'))[1], {activityId: 123, eventId: 97001, param: '9933'});
});
test('logistics search ACK without results halts before a second search and exits the scene', async () => {
    const h = fixture(), sent = logistics(h, [], {ret: 0});
    await assert.rejects(h.run('tranh_doat_mo_khoang', {joins: 0}), /Danh sách/);
    assert.equal(sent.filter(r => r[0].endsWith('_SEARCH')).length, 1); assert(sent.at(-1)[0].endsWith('_EXIT_SCENE'));
});
test('free event shop helper returns a numeric count usable by every caller', async () => {
    const h = setup(); h.load('ports_events_base');
    h.modules.DBUtil = {DBUtil: {getShop: () => ({price: '0', priceAdd: 0, rechargeId: 0, isShow: 1, buyLimit: 1, vipLimit: 0})}};
    h.P.buyOrders = async () => h.P.done(1, 'mua');
    assert.equal(await h.P.claimEventFree(h.ctx, {activityId: 1}, [9]), 1);
});
test('war order only succeeds when new grade receipts survive a fresh query', async () => {
    const h = setup(); h.load('ports_events_base'); let state = [];
    h.modules.ActivityWarOrderMgr = {ActivityWarOrderMgr: {inst: {syncWarOrderData: r => { state = r.gradeInfo; }, getWarOrderTaskData: () => ({gradeInfo: state, progress: 1})}}};
    h.modules.ActivityWarOrderUtil = {ActivityWarOrderUtil: {canGetReward: () => true}};
    h.modules.ActivityWarOrderNetUtil = {ActivityWarOrderNetUtil: {reqGetActivityWarOrderinfo: () => ({ret: 0, warfare: {activityId: 123, gradeInfo: []}}), reqGetActivityWarOrderReward: () => ({ret: 0, activityId: 123, gradeInfo: [{gradeId: 1, gainProgressIds: [10]}], reward: '101001=1'})}};
    await assert.rejects(h.P.claimWarOrder(h.ctx, {activityId: 123, getMallListByShopType: () => [{}]}), /chưa lưu/);
});

test('farming reward stages run before the existing entrust handler and can be disabled independently', async () => {
    const h = setup(), sequence = [];
    h.api.registerTask({id: 'mua_vu_ban_ron', name: 'Mùa Vụ', run: async () => { sequence.push('entrust'); return {status: 'already_done', message: 'Ủy thác đang chạy'}; }});
    h.ctx.activity = () => ({activityId: 1}); h.load('ports_farming_rewards');
    h.P.farmingRewards = async () => { sequence.push('rewards'); return 2; };
    const task = h.api.tasks.find(t => t.id === 'mua_vu_ban_ron'); h.ctx.options = h.P.options(task.options, {});
    assert.equal((await task.run(h.ctx)).status, 'success'); assert.deepEqual(sequence, ['rewards', 'entrust']);
    sequence.length = 0; h.ctx.options = h.P.options(task.options, {rewards: false}); await task.run(h.ctx); assert.deepEqual(sequence, ['entrust']);
});
