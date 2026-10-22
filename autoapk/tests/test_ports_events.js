'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./test_full_runtime');
function setupEvents() {
    const h = setup(); h.load('ports_maze'); h.load('ports_events_base'); h.load('ports_mines');
    h.P.vnClock = () => ({getUTCHours: () => 12});
    h.run = (id, options = {}) => { const task = h.api.tasks.find(t => t.id === id); h.ctx.options = h.P.options(task.options, options); return task.run(h.ctx); };
    return h;
}
test('maze BFS follows revealed floor and does not route through fog, a key or a trap', () => {
    const h = setupEvents();
    const row = (x, eventId = 13001, state = 0) => ({pos: {x, y: 1}, eventId, state});
    const grid = {'1,1': row(1), '2,1': row(2), '3,1': row(3)};
    assert.deepEqual(plain(h.P.maze.path(grid, {x: 1, y: 1}, {x: 3, y: 1})), [{x: 2, y: 1}, {x: 3, y: 1}]);
    for (const middle of [row(2, 13001, 1), row(2, 3001), row(2, 14001)]) {
        grid['2,1'] = middle; assert.equal(h.P.maze.path(grid, {x: 1, y: 1}, {x: 3, y: 1}), null);
    }
});
test('using event inventory requires matching receipt and observed exact item decrement', async () => {
    const h = setupEvents(), bag = {num: 12};
    h.modules.BagMgr = {BagMgr: {inst: {model: {itemDict: {120008: bag}}}}};
    h.modules.BagNetUtil = {BagNetUtil: {use: (id, count) => { bag.num -= count; return {ret: 0, goodsId: id, count, reward: '101001=1'}; }}};
    assert.equal(await h.P.useInventory(h.ctx, [120008], 20, 10), 12); assert.equal(bag.num, 0); assert.equal(h.calls.length, 2);
    bag.num = 1; h.modules.BagNetUtil.BagNetUtil.use = () => ({ret: 0});
    await assert.rejects(h.P.useInventory(h.ctx, [120008], 20, 10), /không khớp/);
});
test('event inventory ACK with unchanged RAM cannot trigger another use', async () => {
    const h = setupEvents(), bag = {num: 10};
    h.modules.BagMgr = {BagMgr: {inst: {model: {itemDict: {120008: bag}}}}};
    h.modules.BagNetUtil = {BagNetUtil: {use: (goodsId, count) => ({ret: 0, goodsId, count, reward: '101001=1'})}};
    await assert.rejects(h.P.useInventory(h.ctx, [120008], 20, 10), /timeout/); assert.equal(h.calls.length, 1);
});
test('activity claims use completed live condition IDs and update only explicit server IDs', async () => {
    const h = setupEvents(), marked = [];
    const act = {activityId: 123, info: {beginTime: 1}, conditionTempDict: {10: {conditionId: 10, paramList: [0, 0, 1, 1]}, 20: {conditionId: 20, paramList: [0, 0, 3, 1]}},
        getConditionData: () => ({isGetReward: false, value: '1'}), setConditionRewardReceived: id => marked.push(id)};
    h.modules.ActivityMgr = {ActivityMgr: {inst: {syncActivityData() {}}}};
    h.modules.ActivityUtil = {ActivityUtil: {whichDay: () => 2}};
    h.modules.ActivityTaskUtil = {ActivityTaskUtil: {buildTaskInfo: () => ({isComplete: true})}};
    h.P.packet = async (ctx, symbol, body) => {
        if (symbol === 'S_ACTIVITY_DATA') return {ret: 0, data: {activityId: 123}};
        assert.deepEqual(plain(body.conditionId), [10]); return {ret: 0, activityId: 123, reward: '101001=1', successConditionId: [10]};
    };
    assert.equal(await h.P.claimActivity(h.ctx, act), 1); assert.deepEqual(marked, [10]);
    marked.length = 0;
    h.P.packet = async (ctx, symbol) => symbol === 'S_ACTIVITY_DATA' ? {ret: 0, data: {activityId: 123}} : {ret: 0, activityId: 123, reward: '101001=1', successConditionId: [99]};
    await assert.rejects(h.P.claimActivity(h.ctx, act), /không khớp/); assert.deepEqual(marked, []);
});
test('existing team must be confirmed with self membership, never inferred from a cached team plus ACK', async () => {
    const h = setupEvents();
    h.modules.TeamMgr = {TeamMgr: {inst: {getSelfTeam: () => ({teamId: '55'}), getSelfTeamId: () => 55}}};
    h.modules.TeamNetUtil = {teamNetUtil: {searchActivityTeam: () => ({ret: 0})}};
    await assert.rejects(h.P.ensureTeam(h.ctx, 123), /chưa xác nhận/); assert.equal(h.calls.length, 1);
});
test('mine exploration resumes an active board and confirms a discovered mine without requiring an optional history', async () => {
    const h = setupEvents(); let active = true;
    const mgr = {model: {exploreData: {syncExploreInfo() {}}}, syncMineInfo() {}};
    h.modules.MineMgr = {MineMgr: {inst: mgr}};
    h.modules.MineNetUtil = {MineNetUtil: {
        getMineData: () => ({ret: 0, power: 0, joinNum: [], diamondNum: [], explorateInfo: {active, histories: active ? [{position: 1, result: 0, handled: true}] : []}}),
        explore: (type, position, num) => { assert.deepEqual([type, position, num], [1, 2, 0]); active = false; return {ret: 0, mine: {id: '99'}}; },
        query: id => ({ret: 0, mine: {id}})
    }};
    assert.equal((await h.run('mine_explore')).status, 'success'); assert.ok(!h.calls.some(c => c.method === 'exploreActive'));
});
test('advanced mine join ACK is rejected unless fresh mine lists the player in that exact slot', async () => {
    const h = setupEvents(), mine = {id: '99', mineId: 3, ownerId: '200', joiners: []};
    const mgr = {model: {exploreData: {syncExploreInfo() {}}}, getMaxJoinNum: () => 1, getCurJoinNum: () => 0,
        syncMineInfo: () => ({isMining: () => true})};
    h.modules.MineMgr = {MineMgr: {inst: mgr}};
    h.modules.MineNetUtil = {MineNetUtil: {
        getMineData: () => ({ret: 0, power: 0, joinNum: [{num: 1}], diamondNum: [], explorateInfo: {active: false, histories: []}}),
        getPlayerMineList: () => ({ret: 0, myMines: [], joined: []}), cooperationList: () => ({ret: 0, mineInfos: [mine]}),
        query: () => ({ret: 0, mine}), replace: () => ({ret: 0, success: true})
    }};
    await assert.rejects(h.run('advanced_mine'), /đúng chỗ trống/); assert.equal(h.calls.filter(c => c.method === 'replace').length, 1);
});
