'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./test_full_runtime');
function core() {
    const h = setup(); h.load('ports_core');
    h.run = async (id, values = {}) => {
        const task = h.api.tasks.find(t => t.id === id); h.ctx.options = h.P.options(task.options, values); return task.run(h.ctx);
    };
    return h;
}
test('artist gift derives owned artist and existing inventory, preserves configured quantity', async () => {
    const h = core(); h.modules.BeautyMgr = {BeautyMgr: {inst: {model: {beautyDict: {1: {beautyId: 998877}}}}}};
    h.modules.BagMgr = {BagMgr: {inst: {model: {itemDict: {110028: {num: 7}}}}}};
    let sent; h.modules.BeautyNetUtil = {BeautyNetUtil: {giftReward: (...args) => { sent = args; return {ret: 0, addAffinity: 6}; }}};
    assert.equal((await h.run('artist_gifts', {count: 3})).status, 'success'); assert.deepEqual(plain(sent.slice(0, 3)), [998877, 110028, 3]);
    h.modules.BeautyNetUtil.BeautyNetUtil.giftReward = () => ({ret: 0});
    await assert.rejects(h.run('artist_gifts'), /tặng quà/);
});
test('artist skill uses actual owned slot and requires modifyNum to increase', async () => {
    const h = core(), b = {beautyId: 555, skillList: [{skillPos: 27, modifyNum: 2}]};
    h.modules.BeautyMgr = {BeautyMgr: {inst: {model: {beautyDict: {555: b}}}}};
    h.modules.BeautyNetUtil = {BeautyNetUtil: {skillModify: (...args) => {
        assert.deepEqual(plain(args.slice(0, 2)), [555, 27]); return {ret: 0, beautySkill: {skillPos: 27, modifyNum: 3}};
    }}};
    assert.equal((await h.run('artist_skills', {times: 1})).status, 'success');
    h.modules.BeautyNetUtil.BeautyNetUtil.skillModify = () => ({ret: 0, beautySkill: {skillPos: 27, modifyNum: 2}});
    await assert.rejects(h.run('artist_skills', {times: 1}), /chưa xác nhận/);
});
test('car improvement retains real UUID, type, slot and rejects a stale or different car receipt', async () => {
    const h = core(); const id = 'actual-owned-uuid';
    h.modules.CarMgr = {CarMgr: {inst: {model: {carDict: {[id]: {skillList: [{skillPos: 19, skillType: 2, skillModifyTimes: 0}]}}}}}};
    h.modules.CarNetUtil = {CarNetUtil: {skillModify: (...args) => {
        assert.deepEqual(plain(args.slice(0, 3)), [id, 2, 19]); return {ret: 0, carId: id, skill: {skillPos: 19, skillType: 2, skillModifyTimes: 1}};
    }}};
    assert.equal((await h.run('car_improve', {times: 1})).status, 'success');
    h.modules.CarNetUtil.CarNetUtil.skillModify = () => ({ret: 0, carId: 'another', skill: {skillPos: 19, skillType: 2, skillModifyTimes: 1}});
    await assert.rejects(h.run('car_improve', {times: 1}), /chưa xác nhận/);
});
test('farm plants dynamic unlocked crop and verifies fresh crop/start state', async () => {
    const h = core(); const rows = [{areaId: 901, cropsId: 0, mature: false}];
    const model = {getAreaState: () => rows[0].cropsId ? 4 : 2};
    h.modules.FarmMgr = {FarmMgr: {inst: {model}}};
    h.modules.DBUtil = {DBUtil: {getFarmlandArea: () => ({farmlandType: 2})}};
    h.modules.FarmUtil = {farmUtil: {findNewCorpBy: type => { assert.equal(type, 2); return {id: 5566}; }}};
    h.P.packet = async (ctx, symbol, body) => {
        if (symbol === 'S_FARMLAND_AREA') return {ret: 0, unlockArea: rows};
        assert.equal(symbol, 'S_FARMLAND_PLANT'); assert.deepEqual(plain(body.plant), [{areaId: 901, cropsId: 5566}]);
        rows[0] = {areaId: 901, cropsId: 5566, startSecond: '5000', mature: false}; return {ret: 0};
    };
    assert.equal((await h.run('farm')).status, 'success');
});
test('farm harvest ACK without production is not counted as harvested', async () => {
    const h = core(); h.modules.FarmMgr = {FarmMgr: {inst: {model: {}}}};
    h.P.packet = async (ctx, symbol) => symbol === 'S_FARMLAND_AREA' ? {ret: 0, unlockArea: [{areaId: 1, mature: true}]} : {ret: 0, areaProduct: []};
    await assert.rejects(h.run('farm', {sow: false}), /sản lượng/);
});
test('studio handles only actual unlocked indices and requires state transition after start', async () => {
    const h = core(), changed = [];
    h.modules.FilmMgr = {FilmMgr: {inst: {synFilmsData() {}, synStudio: s => changed.push(s)}}};
    h.modules.FilmConfig = {multipleType: {normal: 1}};
    h.modules.FilmNetUtil = {FilmNetUtil: {getFilmsData: () => ({ret: 0, studios: [{studioIndex: 8, state: 1}, {studioIndex: 9, state: 0}]}),
        startShoot: index => { assert.equal(index, 8); return {ret: 0, studio: {studioIndex: 8, state: 2}}; }}};
    assert.equal((await h.run('studio')).status, 'success'); assert.equal(changed.length, 1);
    h.modules.FilmNetUtil.FilmNetUtil.startShoot = () => ({ret: 0}); await assert.rejects(h.run('studio'), /trường quay/);
});
test('studio completed film requires actual telecast id, not just ret zero', async () => {
    const h = core(); h.modules.FilmMgr = {FilmMgr: {inst: {}}};
    h.modules.FilmNetUtil = {FilmNetUtil: {getFilmsData: () => ({ret: 0, studios: [{studioIndex: 4, state: 3}]}), completeShoot: () => ({ret: 0, studio: {studioIndex: 4, state: 1}})}};
    await assert.rejects(h.run('studio'), /phim hoàn thành/);
});
test('secretary rejects an empty generic ACK and preserves settings unless requested', async () => {
    const h = core(); h.modules.AssistantMgr = {AssistantMgr: {inst: {checkSystemOpen: () => true, model: {}}}};
    h.modules.AssistantNetUtil = {AssistantNetUtil: {getInfo: () => ({ret: 0}), run: () => ({ret: 0})}};
    await assert.rejects(h.run('secretary'), /công việc/); assert.ok(!h.calls.some(c => c.method === 'setInfo'));
});
test('share requires actual task completion push after ACK', async () => {
    const h = core(); let complete = false;
    h.modules.TaskConfig = {TaskConfig: {DAILY_TASK_SHARE: 3}};
    h.modules.DBUtil = {DBUtil: {getTaskListByType: () => [{id: 99, additionalPar: '3'}]}};
    h.modules.TaskMgr = {TaskMgr: {inst: {getTaskInfo: () => ({isComplete: complete}), getTaskData: () => ({value: '0'})}}};
    h.modules.TaskNetUtil = {TaskNetUtil: {shareGameVN: () => ({ret: 0})}};
    await assert.rejects(h.run('share_game'), /timeout/);
    h.modules.TaskNetUtil.TaskNetUtil.shareGameVN = () => { complete = true; return {ret: 0}; };
    assert.equal((await h.run('share_game')).status, 'success');
});
