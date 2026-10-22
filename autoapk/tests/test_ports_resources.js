'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./test_full_runtime');
function fixture() {
    const h = setup(); ['ports_maze', 'ports_square_singer', 'ports_tree_heroes', 'ports_simple_events', 'ports_cards'].forEach(n => h.load(n));
    h.run = (id, options = {}) => { const task = h.api.tasks.find(t => t.id === id); h.ctx.options = h.P.options(task.options, options); return task.run(h.ctx); };
    return h;
}
test('assigning heroes uses only opened stores and unlocked slots, preserves existing heroes', async () => {
    const h = fixture(), stores = {1: {heroIdList: [10]}, 2: {heroIdList: []}};
    h.modules.BuildingMgr = {BuildingMgr: {inst: {checkBuildingStatusOpened: id => id === 1}}};
    h.modules.VillageMgr = {VillageMgr: {inst: {getOwnBuildingIdList: () => ['1', '2'], getBuildingData: id => stores[id]}}};
    h.modules.DBUtil = {DBUtil: {getStoreStaffListByBuildingId: () => [{unlockCondition: 1}, {unlockCondition: 2}, {unlockCondition: 3}]}};
    h.modules.TaskUtil = {TaskUtil: {isCompelte: id => id < 3}};
    h.modules.HeroMgr = {HeroMgr: {inst: {getOwnHeroIdList: () => [10, 20, 30], getFinalAbilityValue: id => id, getHeroData: id => ({buildingId: id === 10 ? 1 : 0})}}};
    h.modules.BuildingNetUtil = {BuildingNetUtil: {dispatchHero: (id, heroes) => { stores[id].heroIdList = heroes; return {ret: 0}; }}};
    assert.equal((await h.run('thao_lap_nhan_tai', {mode: 'equip'})).status, 'success');
    assert.deepEqual(plain(stores[1].heroIdList), [10, 30]); assert.equal(h.calls.length, 1);
});
test('an unconfirmed hero removal never starts reassigning heroes', async () => {
    const h = fixture();
    h.modules.BuildingMgr = {BuildingMgr: {inst: {checkBuildingStatusOpened: () => true}}};
    h.modules.VillageMgr = {VillageMgr: {inst: {getOwnBuildingIdList: () => [1], getBuildingData: () => ({heroIdList: [10]})}}};
    h.modules.DBUtil = {DBUtil: {getStoreStaffListByBuildingId: () => [{unlockCondition: 1}]}};
    h.modules.BuildingNetUtil = {BuildingNetUtil: {dispatchHero: () => ({ret: 0})}};
    await assert.rejects(h.run('thao_lap_nhan_tai'), /timeout/); assert.equal(h.calls.length, 1);
});
test('tree harvest uses actual reward UID and stops on an unchanged fresh list without probing fabricated IDs', async () => {
    const h = fixture(), sent = [];
    h.modules.TreePlantingMgr = {TreePlantingMgr: {inst: {getData: () => ({syncData() {}})}}};
    h.P.packet = async (ctx, symbol, body) => {
        sent.push([symbol, plain(body)]);
        if (symbol === 'S_PLANT_TREE_DATA') return {ret: 0, info: {treeId: 7}, rewardInfo: [{uid: '900'}], touchTimes: 0, sign: true, signDay: 1, missionRewardIndex: -1};
        return {ret: 0, reward: '101001=1'};
    };
    await assert.rejects(h.run('water_tree'), /vẫn còn/);
    assert.deepEqual(sent.filter(x => x[0] === 'S_PLANT_TREE_REWARD'), [['S_PLANT_TREE_REWARD', {treeId: 7, uid: '900'}]]);
});
test('inventory confirmation gates the next campus game even if the request returned a valid report', async () => {
    const h = fixture(), act = {activityId: 123}; let games = 0;
    h.P.findActivity = () => act; h.P.claimActivity = async () => 0;
    h.modules.BagMgr = {BagMgr: {inst: {model: {itemDict: {120100: {num: 2}}}}}};
    h.modules.ActivityCampusGamesNetUtil = {ActivityCampusGamesNetUtil: {reqActivityData: () => ({ret: 0, info: {joinTimes: games}}), reqActivityForward: () => { games++; return {ret: 0, activityId: 123, reportList: [{}]}; }}};
    await assert.rejects(h.run('game_vuon_truong'), /timeout/); assert.equal(games, 1);
});
test('card packs require server-drawn cards as well as an observed consumed pack', async () => {
    const h = fixture(), act = {activityId: 123}, item = {num: 1}; let opened = 0;
    h.P.findActivity = () => act; h.P.claimActivity = async () => 0;
    const data = {taskMap: new Map(), syncConfig: r => { data.packConfig = r.packConfig; }, syncInfo: r => { data.openPackTimes = r.openPack; }};
    h.modules.ActivityGuardianCollectMgr = {ActivityGuardianCollectMgr: {inst: {getData: () => data}}};
    h.modules.BagMgr = {BagMgr: {inst: {model: {itemDict: {120327: item}}}}};
    h.P.packet = async (ctx, symbol) => {
        if (symbol.endsWith('_CONFIG')) return {ret: 0, packConfig: [{id: 120327, type: 1}], taskConfig: []};
        if (symbol.endsWith('_DATA')) return {ret: 0, cardIds: [], taskData: [], openPack: opened};
        opened++; item.num--; return {ret: 0, openPack: opened, drawCards: []};
    };
    await assert.rejects(h.run('mo_the_mua'), /chưa đầy đủ/); assert.equal(opened, 1);
});
