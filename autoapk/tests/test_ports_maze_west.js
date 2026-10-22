'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./test_full_runtime');
function init(type) {
    const h = setup(), act = {activityId: 987654, activityType: type, state: 2, getConfigNumber: () => 120251};
    h.modules.ActivityMgr = {ActivityMgr: {inst: {model: {activityDict: {987654: act}}}}};
    h.P.vnClock = () => ({getUTCHours: () => 12});
    h.P.claimEventFree = h.P.claimActivity = h.P.claimWarOrder = async () => 0;
    h.load('ports_maze'); h.load('ports_maze_west');
    h.sent = [];
    h.respond = fn => { h.P.packet = async (ctx, symbol, body) => { ctx.check(); h.sent.push({symbol, body: plain(body)}); return fn(symbol, body); }; };
    h.run = (id, opts = {}) => {
        const task = h.api.tasks.find(t => t.id === id); h.ctx.options = h.P.options(task.options, {freeGift: false, claimTasks: false, autoTeam: false, ...opts}); return task.run(h.ctx);
    };
    return h;
}
function quad(h, overrides = {}) {
    let latest;
    const scene = {isCanPass: () => false, getTaskStateWithEventId: () => 0, isPlayerInTrap: () => false, ...overrides};
    const data = {syncConfig() {}, syncInfo(info) { latest = info; }};
    h.modules.QuadMazeMgr = {QuadMazeMgr: {inst: {getData: () => data, getMainSceneData: () => scene}}};
    h.modules.QuadMazeUtil = {QuadMazeUtil: {checkOpenTime: () => true, getBossAttackInterval: () => 60, getAttackLimit: () => 1}};
    h.modules.TimeUtil = {TimeUtil: {getServerTime: () => 100}};
    return {scene, get latest() { return latest; }};
}
function west(h, overrides = {}) {
    const state = {checkWeaponUpgrade: () => false, hasTaskReward: () => false, getNextRegionId: () => -1, checkNextRegionUnlock: () => false, syncAllWeapon() {}, ...overrides};
    const data = {syncConfig() {}, syncInfo() {}, westModule: state};
    h.modules.ActivityXiyouMgr = {ActivityXiyouMgr: {inst: {getXiyouData: () => data, checkHotelOpen: () => true}}}; return state;
}
test('Quad uses native event types and never routes through hidden floor, tombs, monsters or obstacles', () => {
    const h = init(1039), type = h.P.quadMaze.type;
    assert.equal(type({eventType: 3, subEventType: 8}), 'key'); assert.equal(type({eventType: 5, subEventType: 1}), 'wall');
    const pos = x => ({x, y: 1}), row = (x, type = 'floor', fog = false) => ({cell: {pos: pos(x)}, type, fog});
    const grid = {'1,1': row(1), '2,1': row(2), '3,1': row(3)};
    assert.deepEqual(plain(h.P.quadMaze.path(grid, pos(1), pos(3))), [pos(2), pos(3)]);
    for (const middle of [row(2, 'floor', true), row(2, 'wall'), row(2, 'monster')]) {
        grid['2,1'] = middle; assert.equal(h.P.quadMaze.path(grid, pos(1), pos(3)), null);
    }
    assert.deepEqual(plain(h.P.quadMaze.path(grid, pos(1), pos(2), true)), []);
});
test('Quad passes a completed layer even with zero stamina and confirms the new layer', async () => {
    const h = init(1039); quad(h, {isCanPass: () => true}); let layer = 4, x = 1;
    h.respond(symbol => {
        if (symbol === 'S_QUAD_MAZE_CONFIG') return {ret: 0, eventConfig: [{id: 10, eventType: 2, subEventType: 1}], mapConfig: []};
        if (symbol === 'S_QUAD_MAZE_INFO') return {ret: 0, layer, power: 0, curBlood: 1, curPos: {x, y: 1}, map: {cell: [{pos: {x: 2, y: 1}, eventId: 10, state: 0}]}};
        if (symbol === 'S_QUAD_MAZE_MOVE') { x = 2; return {ret: 0, endCell: {pos: {x: 2, y: 1}}}; }
        assert.equal(symbol, 'S_QUAD_MAZE_NEXT_LAYER'); layer++; return {ret: 0, layer};
    });
    assert.equal((await h.run('thien_nu_u_hon', {layers: 1})).status, 'success'); assert.equal(layer, 5);
});
test('Quad does not accept a generic next-layer ACK or send another mutation', async () => {
    const h = init(1039); quad(h, {isCanPass: () => true});
    h.respond(symbol => {
        if (symbol === 'S_QUAD_MAZE_CONFIG') return {ret: 0, eventConfig: [{id: 10, eventType: 2, subEventType: 1}], mapConfig: []};
        if (symbol === 'S_QUAD_MAZE_INFO') return {ret: 0, layer: 1, power: 0, curBlood: 1, curPos: {x: 2, y: 1}, map: {cell: [{pos: {x: 2, y: 1}, eventId: 10, state: 0}]}};
        return {ret: 0};
    });
    await assert.rejects(h.run('thien_nu_u_hon'), /tầng mới/);
    assert.equal(h.sent.filter(x => x.symbol === 'S_QUAD_MAZE_NEXT_LAYER').length, 1);
});
test('Quad waits for a fresh map change after movement instead of clearing a fog tile locally', async () => {
    const h = init(1039); quad(h);
    const info = {ret: 0, layer: 1, power: 2, curBlood: 1, curPos: {x: 1, y: 1}, map: {cell: [{pos: {x: 1, y: 1}, eventId: 1, state: 0}, {pos: {x: 2, y: 1}, eventId: 1, state: 1}]}};
    h.respond(symbol => symbol === 'S_QUAD_MAZE_CONFIG' ? {ret: 0, eventConfig: [{id: 1, eventType: 1, subEventType: 1}], mapConfig: []} : symbol === 'S_QUAD_MAZE_INFO' ? info : {ret: 0, endCell: info.map.cell[1]});
    await assert.rejects(h.run('thien_nu_u_hon'), /không thay đổi/);
    assert.equal(h.sent.filter(x => x.symbol === 'S_QUAD_MAZE_MOVE').length, 1); assert.equal(info.map.cell[1].state, 1);
});
test('Quad avoids a monster after the actual per-player attack limit and explores another reachable tile', async () => {
    const h = init(1039); quad(h); let moved = false;
    h.respond((symbol, body) => {
        if (symbol === 'S_QUAD_MAZE_CONFIG') return {ret: 0, eventConfig: [{id: 1, eventType: 1, subEventType: 1}, {id: 2, eventType: 3, subEventType: 1}], mapConfig: []};
        if (symbol === 'S_QUAD_MAZE_INFO') return {ret: 0, layer: 1, power: moved ? 0 : 2, curBlood: 1, curPos: {x: 1, y: moved ? 2 : 1}, map: {cell: [
            {pos: {x: 1, y: 1}, eventId: 1, state: 0}, {pos: {x: 2, y: 1}, eventId: 2, state: 0, monster: {blood: 100, attackInfo: [{attacker: {userId: '100'}}]}},
            {pos: {x: 1, y: 2}, eventId: 1, state: moved ? 0 : 1}]}};
        assert.equal(symbol, 'S_QUAD_MAZE_MOVE'); assert.deepEqual(plain(body.path), [{x: 1, y: 2}]); moved = true; return {ret: 0, endCell: {pos: {x: 1, y: 2}}};
    });
    assert.equal((await h.run('thien_nu_u_hon', {steps: 1})).status, 'success'); assert.equal(moved, true);
});
test('Quad accepts a native teammate race only when a fresh board proves that event changed', async () => {
    for (const actualChange of [true, false]) {
        const h = init(1039); quad(h); let attempted = false;
        h.respond(symbol => {
            if (symbol === 'S_QUAD_MAZE_CONFIG') return {ret: 0, eventConfig: [{id: 1, eventType: 1, subEventType: 1}, {id: 2, eventType: 3, subEventType: 8}], mapConfig: []};
            if (symbol === 'S_QUAD_MAZE_INFO') return {ret: 0, layer: 1, power: 2, curBlood: 1, curPos: {x: 1, y: 1}, map: {cell: [{pos: {x: 1, y: 1}, eventId: attempted && actualChange ? 1 : 2, state: 0}]}};
            assert.equal(symbol, 'S_QUAD_MAZE_HANDLE_EVENT'); attempted = true; return {ret: 8998};
        });
        if (actualChange) assert.equal((await h.run('thien_nu_u_hon', {steps: 1})).status, 'success');
        else await assert.rejects(h.run('thien_nu_u_hon', {steps: 1}), /không thay đổi/);
        assert.equal(h.sent.filter(x => x.symbol === 'S_QUAD_MAZE_HANDLE_EVENT').length, 1);
    }
});
test('Xiyou claims only the real current completed task, with an actual reward and fresh claimed state', async () => {
    const h = init(1043); let done = false; west(h, {hasTaskReward: () => !done});
    h.respond((symbol, body) => {
        if (symbol === 'S_XIYOU_CONFIG') return {ret: 0, eventConfig: [], regionConfig: [{id: 17001, energy: 1}], weaponConfig: [], weaponLevelConfig: [], taskConfig: [{id: 709}]};
        if (symbol === 'S_XIYOU_INFO') return {ret: 0, myRegion: 17001, power: 0, blood: 10, task: {taskId: 709, state: done ? 1 : 0}};
        assert.equal(symbol, 'S_XIYOU_GAIN_TASK'); assert.equal(body.taskId, 709); done = true; return {ret: 0, reward: '101001=1'};
    });
    assert.equal((await h.run('tay_du_ky', {upgradeWeapons: false})).status, 'success');
    assert.ok(!h.sent.some(x => x.symbol === 'S_XIYOU_WEAPON_UPGRADE'));
});
test('Xiyou refuses an upgrade ACK when the fresh actual weapon level did not increase', async () => {
    const h = init(1043); west(h, {checkWeaponUpgrade: () => true});
    h.respond(symbol => {
        if (symbol === 'S_XIYOU_CONFIG') return {ret: 0, eventConfig: [], regionConfig: [{id: 20001, energy: 1}], weaponConfig: [{id: 321}], weaponLevelConfig: [], taskConfig: []};
        if (symbol === 'S_XIYOU_INFO') return {ret: 0, myRegion: 20001, power: 0, blood: 10};
        if (symbol === 'S_XIYOU_WEAPON') return {ret: 0, weapon: [{weaponId: 321, level: 2, count: 8}]};
        return {ret: 0};
    });
    await assert.rejects(h.run('tay_du_ky'), /cấp pháp bảo tăng/);
    assert.equal(h.sent.filter(x => x.symbol === 'S_XIYOU_WEAPON_UPGRADE').length, 1);
    assert.equal(h.sent.find(x => x.symbol === 'S_XIYOU_WEAPON_UPGRADE').body.weaponId, 321);
});
test('Xiyou accepts a cyclic native task resetting progress after an actual claim', async () => {
    const h = init(1043); let progress = 3; west(h, {hasTaskReward: () => progress === 3});
    h.respond(symbol => {
        if (symbol === 'S_XIYOU_CONFIG') return {ret: 0, eventConfig: [], regionConfig: [{id: 20001, energy: 1}], weaponConfig: [], weaponLevelConfig: [], taskConfig: []};
        if (symbol === 'S_XIYOU_INFO') return {ret: 0, myRegion: 20001, power: 0, blood: 10, task: {taskId: 709, state: 0, progress}};
        assert.equal(symbol, 'S_XIYOU_GAIN_TASK'); progress = 0; return {ret: 0, reward: '101001=1', nextTask: {taskId: 709, state: 0, progress: 0}};
    });
    assert.equal((await h.run('tay_du_ky', {upgradeWeapons: false})).status, 'success');
    assert.equal(h.sent.filter(x => x.symbol === 'S_XIYOU_GAIN_TASK').length, 1);
});
test('Xiyou does not decrement stamina locally or retry a search while fresh state is unchanged', async () => {
    const h = init(1043); west(h);
    h.respond(symbol => {
        if (symbol === 'S_XIYOU_CONFIG') return {ret: 0, eventConfig: [], regionConfig: [{id: 20001, energy: 2}], weaponConfig: [], weaponLevelConfig: [], taskConfig: []};
        if (symbol === 'S_XIYOU_INFO') return {ret: 0, myRegion: 20001, power: 2, blood: 10};
        return {ret: 0, power: 0};
    });
    await assert.rejects(h.run('tay_du_ky', {upgradeWeapons: false}), /không thay đổi/);
    assert.equal(h.sent.filter(x => x.symbol === 'S_XIYOU_SEARCH').length, 1);
});
function bull(h, options = {}) {
    h.modules.ActivityBullDemonUtil = {ActivityBullDemonUtil: {checkStartGameTimeOpen: () => true, getFightPower: () => 0, getMonsterColorById: (act, block) => block.color || 0, ...options}};
    h.modules.ActivityBullDemonMgr = {ActivityBullDemonMgr: {inst: {syncConfig() {}, syncInfo() {}}}};
    return h.modules.ActivityBullDemonUtil.ActivityBullDemonUtil;
}
test('Bull Demon path begins at the actual player and respects adjacency, colors and monster combo HP', () => {
    const h = init(1058), util = bull(h), block = (x, y, type, color, hp = 0) => ({pos: {x, y}, type, color, monster: type === 2 ? {hp} : null});
    const game = {block: [block(0, 0, 1, 0), block(1, 0, 3, 1), block(2, 0, 2, 1, 1), block(3, 0, 3, 2), block(6, 6, 3, 1)]};
    const path = plain(h.P.bullDemonPath(h.ctx, {}, game, {terrain: '0'}, util, 2000));
    assert.deepEqual(path, [{x: 1, y: 0}, {x: 2, y: 0}]);
    game.block[1].type = 2; game.block[1].monster = {hp: 1};
    assert.deepEqual(plain(h.P.bullDemonPath(h.ctx, {}, game, {terrain: '0'}, util, 2000)), []);
});
test('Bull Demon sends native normal-game type 0 even on later rounds and confirms a fresh changed board', async () => {
    const h = init(1058); bull(h); let rounds = 3;
    const game = () => ({levelId: 70001, bossHp: 100 - rounds, playerHp: 10, rounds, block: [{pos: {x: 0, y: 0}, type: 1}, {pos: {x: 1, y: 0}, type: 3, color: 1}]});
    h.respond((symbol, body) => {
        if (symbol === 'S_BULL_DEMON_CONFIG') return {ret: 0, chapterConfig: [{id: 70001, type: 1, rounds: 10, terrain: '0', energyCost: 1, skipPower: 999}], swordConfig: []};
        if (symbol === 'S_BULL_DEMON_INFO') return {ret: 0, power: 0, info: {maxLevelId: 0, swordLevel: 1}, levelGame: game()};
        assert.equal(symbol, 'S_BULL_DEMON_BATTLE'); assert.equal(body.type, 0); assert.deepEqual(plain(body.pos), [{x: 1, y: 0}]); rounds++; return {ret: 0, game: game()};
    });
    assert.equal((await h.run('nguu_ma_giang_the', {upgradeSword: false, steps: 1})).status, 'success');
});
test('Bull Demon sweep stops after one receipt if fresh stamina did not change', async () => {
    const h = init(1058); bull(h);
    h.respond(symbol => {
        if (symbol === 'S_BULL_DEMON_CONFIG') return {ret: 0, chapterConfig: [{id: 70001, type: 1, energyCost: 1, skipPower: 999}], swordConfig: []};
        if (symbol === 'S_BULL_DEMON_INFO') return {ret: 0, power: 1, info: {maxLevelId: 70001, swordLevel: 1}};
        assert.equal(symbol, 'S_BULL_DEMON_SWEEP'); return {ret: 0, power: 0, reward: '120251=1'};
    });
    await assert.rejects(h.run('nguu_ma_giang_the', {upgradeSword: false}), /đọc lại chưa tiêu hao/);
    assert.equal(h.sent.filter(x => x.symbol === 'S_BULL_DEMON_SWEEP').length, 1);
});
test('Bull Demon uses a skill only with real anger, non-silenced state and fresh matching damage', async () => {
    const h = init(1058); bull(h); let used = false;
    const game = () => ({levelId: 70001, bossHp: used ? 10 : 100, playerHp: 10, rounds: 0, playerAnger: used ? 0 : 120251, block: []});
    h.modules.ActivityBullDemonMgr.ActivityBullDemonMgr.inst.model = {getIsSilent: () => false};
    h.respond((symbol, body) => {
        if (symbol === 'S_BULL_DEMON_CONFIG') return {ret: 0, chapterConfig: [{id: 70001, type: 1, rounds: 10, terrain: '0', energyCost: 1, skipPower: 999}], swordConfig: []};
        if (symbol === 'S_BULL_DEMON_INFO') return {ret: 0, power: 0, info: {maxLevelId: 0, swordLevel: 1}, levelGame: game()};
        assert.equal(symbol, 'S_BULL_DEMON_USE_SKILL'); assert.equal(body.type, 0); used = true; return {ret: 0, game: game()};
    });
    assert.equal((await h.run('nguu_ma_giang_the', {upgradeSword: false, steps: 1})).status, 'success'); assert.equal(used, true);
});
test('all three events stop before native requests when cancellation is active', async () => {
    for (const [type, id] of [[1039, 'thien_nu_u_hon'], [1043, 'tay_du_ky'], [1058, 'nguu_ma_giang_the']]) {
        const h = init(type); quad(h); west(h); bull(h); h.respond(() => { throw Error('must not reach'); }); h.stop();
        await assert.rejects(h.run(id), /stopped/); assert.equal(h.sent.length, 0);
    }
});
