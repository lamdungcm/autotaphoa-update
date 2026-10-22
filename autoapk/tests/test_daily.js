'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const copy = x => JSON.parse(JSON.stringify(x));

function harness(options = {}) {
    const tasks = {}, calls = [], completed = [];
    let stopped = false;
    const server = {likes: [], bought: {}};
    const model = {taskDict: {11: {taskId: 11, state: 0}, 12: {taskId: 12, state: 0},
        13: {taskId: 13, state: 1}, 21: {taskId: 21, state: 0}},
        taskActive: 30, rewardIndexList: [10], configDailyTaskActivityRequire: ['10', '20', '40']};
    const definitions = {11: {type: 1}, 12: {type: 1}, 13: {type: 1}, 21: {type: 3}};
    const info = {11: true, 12: false, 13: true, 21: true};
    const members = [{userId: 100, position: 3, thumpUpTargetPlayerId: []},
        {userId: 200, position: 1}, {userId: 201, position: 4}];
    const shop = {id: 501, shopType: 1, isShow: 1, rechargeId: 0, price: '0', priceAdd: 0, buyLimit: 1, vipLimit: 0};
    const shops = {501: shop, 502: {...shop, id: 502, price: '101001=2'}, 503: {...shop, id: 503, shopType: 1020}};
    const taskMgr = {model, getTaskData(id) { return model.taskDict[id]; },
        getTaskInfo(id) { return {isComplete: info[id] === true}; },
        completeTask(id) { completed.push(id); if (model.taskDict[id]) model.taskDict[id].state = 1; }};
    const modules = {TaskMgr: {TaskMgr: {inst: taskMgr}},
        TaskConfig: {TaskConfig: {TASK_TYPE_1: 1, TASK_TYPE_3: 3}, EnumTaskState: {unReceived: 0, received: 1}},
        DBUtil: {DBUtil: {getTask(id) { return definitions[id]; }, getShop(id) { return shops[id]; }}},
        PlayerMgr: {PlayerMgr: {inst: {model: {playerBaseData: {unionUid: 'guild-a'}}}}},
        ShopConfig: {ShopConfig: {SHOP_TYPE_1: 1}},
        ActivityMgr: {ActivityMgr: {inst: {model: {activityDict: {}}}}},
        VipMgr: {VipMgr: {inst: {getVipLevel() { return 0; }}}},
        ShopMgr: {ShopMgr: {inst: {model: {shopGoodsInfoDict: {}}, getShopBuyGoodsCount(id) { return server.bought[id] || 0; }}}}};
    const ctx = {uid: '100', require(name) { if (!modules[name]) throw new Error('Missing module ' + name); return modules[name]; },
        check() { if (stopped) throw new Error('Đã dừng'); },
        async waitFor(predicate, spec) {
            ctx.check(); if (options.onWait) options.onWait({model, server, modules});
            if (!predicate()) throw new Error(spec.message);
        },
        async call(module, klass, method, args) {
            ctx.check(); calls.push({module, klass, method, args: copy(args)});
            if (options.call) {
                const value = await options.call(method, args, {model, server, modules, members, shops, stop() { stopped = true; }});
                if (value !== undefined) return value;
            }
            switch (method) {
            case 'getRewardOneKey': return {ret: 0, taskId: copy(args[0]), reward: '101001=1'};
            case 'getActiveReward': model.rewardIndexList.push(args[0]); return {ret: 0};
            case 'getUnionDetail':
                return {unionUid: 'guild-a', memberList: members.map(m => m.userId === 100 ? {...m, thumpUpTargetPlayerId: copy(server.likes)} : copy(m))};
            case 'guildClickLikeHuman': server.likes.push(args[0]); return {ret: 0, rewards: '101007=1', likeNum: 1};
            case 'getGoodsList': return {ret: 0, shopType: 1, shopGoodsList: [501, 502, 503]};
            case 'buyGoods': server.bought[args[0]] = (server.bought[args[0]] || 0) + args[1];
                return {ret: 0, shopGoodsId: args[0], count: args[1], goodsDeatil: '101001=1'};
            default: throw new Error('Unexpected native method ' + method);
            }
        }};
    const window = {AutoAPK: {registerTask(task) { tasks[task.id] = task; }}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/daily.js'), 'utf8'), {window});
    return {tasks, ctx, model, definitions, info, members, shops, modules, calls, completed, server,
        run(id) { return tasks[id].run(ctx); }, stop() { stopped = true; }};
}

test('daily module registers five executable additions without replacing existing tasks', () => {
    const h = harness();
    assert.equal(Object.keys(h.tasks).length, 5);
    assert.ok(Object.values(h.tasks).every(t => typeof t.run === 'function' && t.name));
});
test('daily rewards exclude incomplete, claimed, achievement and event tasks', async () => {
    const h = harness(); h.model.taskDict[31] = {taskId: 31, state: 0}; h.definitions[31] = {type: 1020}; h.info[31] = true;
    assert.equal((await h.run('daily_task_rewards')).status, 'success');
    assert.deepEqual(h.calls[0].args, [[11]]); assert.deepEqual(h.completed, [11]);
});
test('achievement rewards select only completed achievement records', async () => {
    const h = harness(); await h.run('achievement_rewards');
    assert.deepEqual(h.calls[0].args, [[21]]); assert.deepEqual(h.completed, [21]);
});
test('repeat task claims do not send another mutation', async () => {
    const h = harness(); await h.run('daily_task_rewards');
    assert.equal((await h.run('daily_task_rewards')).status, 'already_done'); assert.equal(h.calls.length, 1);
});
test('missing task model fails instead of declaring no rewards', async () => {
    const h = harness(); delete h.model.taskDict;
    await assert.rejects(h.run('daily_task_rewards'), /chưa sẵn sàng/); assert.equal(h.calls.length, 0);
});
test('generic task ACK, empty receipt and foreign IDs never mark requested tasks claimed', async () => {
    for (const receipt of [{ret: 0}, {ret: 0, taskId: [11], reward: ''}, {ret: 0, taskId: [21], reward: 'x'},
        {ret: 0, taskId: [11, 11], reward: 'x'}]) {
        const h = harness({call(method) { if (method === 'getRewardOneKey') return receipt; }});
        await assert.rejects(h.run('daily_task_rewards')); assert.deepEqual(h.completed, []);
    }
});
test('partial receipt updates only confirmed IDs and reports incomplete result', async () => {
    const h = harness({call(method) { if (method === 'getRewardOneKey') return {ret: 0, taskId: [11], reward: 'x'}; }});
    h.info[12] = true;
    await assert.rejects(h.run('daily_task_rewards'), /một phần/); assert.deepEqual(h.completed, [11]);
    assert.equal(h.model.taskDict[12].state, 0);
});
test('large daily list is claimed in bounded native batches', async () => {
    const h = harness(); h.model.taskDict = {};
    for (let id = 1000; id < 1129; id++) { h.model.taskDict[id] = {taskId: id, state: 0}; h.definitions[id] = {type: 1}; h.info[id] = true; }
    await h.run('daily_task_rewards');
    assert.deepEqual(h.calls.map(c => c.args[0].length), [64, 64, 1]); assert.equal(h.completed.length, 129);
});
test('Stop after native response prevents client updates and following task batches', async () => {
    const h = harness({call(method, args, f) { if (method === 'getRewardOneKey') { f.stop(); return {ret: 0, taskId: args[0], reward: 'x'}; } }});
    await assert.rejects(h.run('daily_task_rewards'), /Đã dừng/); assert.equal(h.calls.length, 1); assert.deepEqual(h.completed, []);
});
test('active rewards use threshold values, excluding claimed and unreachable thresholds', async () => {
    const h = harness(); await h.run('daily_active_rewards');
    assert.deepEqual(h.calls.map(c => c.args), [[20]]); assert.deepEqual(h.model.rewardIndexList, [10, 20]);
});
test('active ret-zero reply without a matching state push is not success or retried', async () => {
    const h = harness({call(method) { if (method === 'getActiveReward') return {ret: 0}; }});
    await assert.rejects(h.run('daily_active_rewards'), /chưa cập nhật/); assert.equal(h.calls.length, 1);
    assert.deepEqual(h.model.rewardIndexList, [10]);
});
test('active claim accepts a delayed matching TaskActiveMsg push', async () => {
    const h = harness({call(method) { if (method === 'getActiveReward') return {ret: 0}; }, onWait({model}) { model.rewardIndexList.push(20); }});
    assert.equal((await h.run('daily_active_rewards')).status, 'success');
});
test('unknown or malformed activity configuration blocks reward mutations', async () => {
    for (const values of [[], [''], ['20', 'bad']]) {
        const h = harness(); h.model.configDailyTaskActivityRequire = values;
        await assert.rejects(h.run('daily_active_rewards')); assert.equal(h.calls.length, 0);
    }
});
test('guild absence is an explicit skip without any network call', async () => {
    const h = harness(); h.modules.PlayerMgr.PlayerMgr.inst.model.playerBaseData.unionUid = '';
    assert.equal((await h.run('guild_likes')).status, 'skipped'); assert.equal(h.calls.length, 0);
});
test('guild likes exclude self, ordinary members and duplicate officials', async () => {
    const h = harness(); h.members.push({userId: 200, position: 1});
    assert.equal((await h.run('guild_likes')).status, 'success');
    assert.deepEqual(h.calls.filter(c => c.method === 'guildClickLikeHuman').map(c => c.args), [[200]]);
    assert.equal(h.calls.filter(c => c.method === 'getUnionDetail').length, 2);
});
test('guild repeated run reads fresh server history and does not like twice', async () => {
    const h = harness(); await h.run('guild_likes');
    assert.equal((await h.run('guild_likes')).status, 'already_done');
    assert.equal(h.calls.filter(c => c.method === 'guildClickLikeHuman').length, 1);
});
test('guild ACK without typed receipt or independent matching history is not success', async () => {
    for (const receipt of [{ret: 0}, {ret: 0, likeNum: 1, rewards: 'x'}]) {
        const h = harness({call(method) { if (method === 'guildClickLikeHuman') return receipt; }});
        await assert.rejects(h.run('guild_likes'));
        assert.equal(h.calls.filter(c => c.method === 'guildClickLikeHuman').length, 1);
    }
});
test('wrong guild or missing self record prevents any like', async () => {
    for (const data of [{unionUid: 'old', memberList: []}, {unionUid: 'guild-a', memberList: [{userId: 200, position: 1}]}]) {
        const h = harness({call(method) { if (method === 'getUnionDetail') return data; }});
        await assert.rejects(h.run('guild_likes')); assert.equal(h.calls.length, 1);
    }
});
test('unsafe numeric target cannot be rounded and sent to a different player', async () => {
    const h = harness(); h.members[1].userId = '9007199254740993';
    await assert.rejects(h.run('guild_likes'), /Không xác nhận/);
    assert.equal(h.calls.filter(c => c.method === 'guildClickLikeHuman').length, 0);
});
test('free shop takes only explicit zero-price visible regular offers', async () => {
    const h = harness(); await h.run('shop_free_gifts');
    assert.deepEqual(h.calls.filter(c => c.method === 'buyGoods').map(c => c.args), [[501, 1]]);
});
test('free gift in the live shop gift tab is claimed from its actual mall ID', async () => {
    const h = harness({call(method) {
        if (method === 'getGoodsList') return {ret: 0, shopType: 1, shopGoodsList: [501, 601]};
    }}); h.shops[601] = {...h.shops[501], id: 601, shopType: 1051};
    h.modules.ActivityMgr.ActivityMgr.inst.model.activityDict[777] = {type: 20, state: 2,
        getMallList() { return [{...h.shops[601], mallId: 601}]; }};
    await h.run('shop_free_gifts');
    assert.deepEqual(h.calls.filter(c => c.method === 'buyGoods').map(c => c.args), [[501, 1], [601, 1]]);
});
test('closed, preview or unrelated activity shops do not contribute gift IDs', async () => {
    for (const flags of [{type: 20, state: 0}, {type: 20, state: 1}, {type: 1020, state: 2}]) {
        const h = harness(); h.modules.ActivityMgr.ActivityMgr.inst.model.activityDict[777] = {...flags,
            getMallList() { return [{...h.shops[503], mallId: 503}]; }};
        await h.run('shop_free_gifts');
        assert.deepEqual(h.calls.filter(c => c.method === 'buyGoods').map(c => c.args), [[501, 1]]);
    }
});
test('a gift tab closing after selection cannot cause a purchase', async () => {
    const h = harness(); let reads = 0;
    h.shops[601] = {...h.shops[501], id: 601, shopType: 1051};
    const act = h.modules.ActivityMgr.ActivityMgr.inst.model.activityDict[777] = {type: 20, state: 2,
        getMallList() { reads++; if (reads === 2) act.state = 0; return [{...h.shops[601], mallId: 601}]; }};
    await h.run('shop_free_gifts');
    assert.deepEqual(h.calls.filter(c => c.method === 'buyGoods').map(c => c.args), [[501, 1]]);
});
test('missing, paid, recharge, escalating, hidden, unlimited and restricted VIP offers are excluded', async () => {
    for (const change of [{price: undefined}, {price: ''}, {price: '101001=1'}, {rechargeId: 2}, {priceAdd: 1},
        {priceAdd: undefined}, {isShow: 0}, {buyLimit: -1}, {vipLimit: 1}, {rechargeId: false}, {priceAdd: false}]) {
        const h = harness(); Object.assign(h.shops[501], change);
        assert.equal((await h.run('shop_free_gifts')).status, 'already_done');
        assert.equal(h.calls.filter(c => c.method === 'buyGoods').length, 0);
    }
});
test('missing VIP level cannot unlock a VIP-only free offer', async () => {
    const h = harness(); h.shops[501].vipLimit = 1;
    h.modules.VipMgr.VipMgr.inst.getVipLevel = () => undefined;
    await h.run('shop_free_gifts'); assert.equal(h.calls.filter(c => c.method === 'buyGoods').length, 0);
});
test('free gift already at its limit is not purchased again', async () => {
    const h = harness(); h.server.bought[501] = 1;
    assert.equal((await h.run('shop_free_gifts')).status, 'already_done'); assert.equal(h.calls.length, 1);
});
test('shop ACK, wrong item, missing reward or wrong quantity is not success', async () => {
    for (const receipt of [{ret: 0}, {ret: 0, shopGoodsId: 502, count: 1, goodsDeatil: 'x'},
        {ret: 0, shopGoodsId: 501, count: 1, goodsDeatil: ''}, {ret: 0, shopGoodsId: 501, count: 2, goodsDeatil: 'x'}]) {
        const h = harness({call(method) { if (method === 'buyGoods') return receipt; }});
        await assert.rejects(h.run('shop_free_gifts')); assert.equal(h.calls.filter(c => c.method === 'buyGoods').length, 1);
    }
});
test('unloaded shop state fails before querying or buying', async () => {
    const h = harness(); delete h.modules.ShopMgr.ShopMgr.inst.model.shopGoodsInfoDict;
    await assert.rejects(h.run('shop_free_gifts'), /chưa sẵn sàng/); assert.equal(h.calls.length, 0);
});
