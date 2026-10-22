(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    P.claimActivity = async function (ctx, act, allowedIds) {
        var id = P.activityId(act), mgr = P.instance(ctx, 'ActivityMgr'), util = ctx.require('ActivityTaskUtil').ActivityTaskUtil;
        var response = await P.accept(ctx, 'S_ACTIVITY_DATA', {activityId: id});
        if (!response.data || Number(response.data.activityId) !== id) throw new Error('Dữ liệu nhiệm vụ không khớp sự kiện');
        mgr.syncActivityData(response.data);
        var rows = P.values(act.conditionTempDict), ids = [];
        var day = ctx.require('ActivityUtil').ActivityUtil.whichDay(act.info.beginTime);
        rows.forEach(function (condition) {
            if (allowedIds && allowedIds.map(Number).indexOf(Number(condition.conditionId)) < 0) return;
            var data = act.getConditionData(condition.conditionId, true);
            if (!data || data.isGetReward) return;
            var requiredDay = Number(condition.paramList && condition.paramList[2]);
            if (requiredDay > 0 && Number(day) < requiredDay) return;
            var info = util.buildTaskInfo(act, condition, data);
            if (info && info.isComplete === true) ids.push(P.integer(condition.conditionId, 1));
        });
        ids = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
        var count = 0;
        for (var i = 0; i < ids.length; i += 64) {
            var batch = ids.slice(i, i + 64);
            response = await P.accept(ctx, 'S_ACTIVITY_GET_MULTI_REWARD', {activityId: id, conditionId: batch});
            var accepted = P.list(response.successConditionId);
            if (Number(response.activityId) !== id || !P.reward(response) || accepted.some(function (n, index) { return batch.indexOf(n) < 0 || accepted.indexOf(n) !== index; }))
                throw new Error('Kết quả nhận thưởng không khớp sự kiện');
            accepted.forEach(function (n) { act.setConditionRewardReceived(n); }); count += accepted.length;
            if (accepted.length !== batch.length) throw new Error('Máy chủ mới xác nhận một phần thưởng sự kiện');
        }
        return count;
    };
    P.register({id: 'limited_quests', name: 'Nhiệm vụ hạn giờ', group: 'Nhận thưởng', desktop: ['action_limited_quests']}, async function (ctx) {
        var acts = P.values(P.model(ctx, 'ActivityMgr').activityDict).filter(function (act) {
            var info = act.info || {}, state = act.state == null ? info.state : act.state;
            return Number(state) === 2 && Number(act.type || act.activityType || info.activityType) === 6;
        });
        var count = 0;
        for (var i = 0; i < acts.length; i++) count += await P.claimActivity(ctx, acts[i]);
        return P.done(count, 'nhận mốc nhiệm vụ hạn giờ', 'Không còn nhiệm vụ hạn giờ đủ điều kiện');
    });
    P.claimEventFree = async function (ctx, act, fallbackIds) {
        var db = ctx.require('DBUtil').DBUtil, ids = (fallbackIds || []).slice();
        if (typeof act.getMallList === 'function') P.list(act.getMallList()).forEach(function (mall) { ids.push(Number(mall.mallId)); });
        var orders = [], seen = {};
        ids.forEach(function (id) {
            if (seen[id]) return; seen[id] = true;
            var row = db.getShop(id);
            if (!row || String(row.price) !== '0' || Number(row.priceAdd) !== 0 || Number(row.rechargeId) !== 0 || Number(row.isShow) !== 1 || !(Number(row.buyLimit) > 0)) return;
            if (Number(row.vipLimit) > 0 && P.instance(ctx, 'VipMgr').getVipLevel() < Number(row.vipLimit)) return;
            orders.push({id: id, count: Math.min(P.integer(row.buyLimit, 1), 10000)});
        });
        if (orders.length) return P.integer((await P.buyOrders(ctx, orders)).count);
        return 0;
    };
    P.claimWarOrder = async function (ctx, act) {
        if (typeof act.getMallListByShopType !== 'function' || !P.list(act.getMallListByShopType(1024)).length) return 0;
        var id = P.activityId(act), mgr = P.instance(ctx, 'ActivityWarOrderMgr'), util = ctx.require('ActivityWarOrderUtil').ActivityWarOrderUtil;
        async function read() {
            var r = P.ret(await P.call(ctx, 'ActivityWarOrderNetUtil', 'reqGetActivityWarOrderinfo', [id, false]));
            if (!r.warfare || Number(r.warfare.activityId) !== id) throw new Error('Dữ liệu chiến lệnh không khớp sự kiện');
            mgr.syncWarOrderData(r.warfare); return P.fields(mgr.getWarOrderTaskData(id), ['gradeInfo', 'progress']);
        }
        function keys(grades) {
            var result = [];
            P.list(grades).forEach(function (grade) { P.list(grade.gainProgressIds).forEach(function (n) { result.push(P.integer(grade.gradeId) + ':' + P.integer(n)); }); });
            return result;
        }
        var state = await read(); if (!util.canGetReward(act)) return 0;
        var before = keys(state.gradeInfo), reply = P.ret(await P.call(ctx, 'ActivityWarOrderNetUtil', 'reqGetActivityWarOrderReward', [id, false]));
        var received = keys(reply.gradeInfo).filter(function (key) { return before.indexOf(key) < 0; });
        if (Number(reply.activityId) !== id || !received.length || !P.reward(reply)) throw new Error('Chiến lệnh chưa xác nhận mốc mới và thưởng');
        var current = keys((await read()).gradeInfo);
        if (received.some(function (key) { return current.indexOf(key) < 0; })) throw new Error('Máy chủ chưa lưu các mốc chiến lệnh vừa nhận');
        return received.length;
    };
    P.useInventory = async function (ctx, ids, limit, batchSize) {
        var total = 0;
        for (var i = 0; i < ids.length && total < limit; i++) {
            var id = ids[i], count = P.bag(ctx, id);
            while (count > 0 && total < limit) {
                var batch = Math.min(count, limit - total, batchSize || 10);
                var reply = P.ret(await P.call(ctx, 'BagNetUtil', 'use', [id, batch, 0, '', false]));
                if (Number(reply.goodsId) !== Number(id) || Number(reply.count) !== batch || !P.reward(reply))
                    throw new Error('Kết quả dùng vật phẩm không khớp yêu cầu');
                await ctx.waitFor(function () { return P.bag(ctx, id) <= count - batch; }, {message: 'Máy chủ chưa cập nhật vật phẩm đã sử dụng'});
                var remaining = P.bag(ctx, id);
                if (remaining !== count - batch) throw new Error('Số lượng vật phẩm thay đổi ngoài lượt auto');
                count = remaining; total += batch;
            }
        }
        return total;
    };
    var minis = [
        {id: 'dap_anh', name: 'Đập ảnh', type: 800, names: ['đập ảnh', 'dap anh'], mall: 800100101, items: [120004, 120005, 120006, 120007, 120016]},
        {id: 'nem_da', name: 'Ném đá', type: 802, names: ['ném đá', 'nem da'], mall: 802100101, items: [120008]},
        {id: 'choi_day', name: 'Chơi dây', type: 803, names: ['chơi dây', 'choi day'], mall: 803100101, items: [120012]},
        {id: 'nem_bao_cat', name: 'Ném bao cát', type: 804, names: ['ném bao cát', 'nem bao cat'], mall: 804100101, items: [120022]}
    ];
    minis.forEach(function (definition) {
        P.register({id: definition.id, name: definition.name, group: 'Mini game ngày', desktop: ['action_' + definition.id], options: [P.numOption('limit', 'Số vật phẩm tối đa mỗi lượt', 300, 10000)]}, async function (ctx) {
            var act = P.findActivity(ctx, [definition.type], definition.names);
            if (!act) return P.skip('Sự kiện chưa mở');
            await P.claimEventFree(ctx, act, [definition.mall]);
            var count = await P.useInventory(ctx, definition.items, ctx.options.limit, 10);
            var left = definition.items.reduce(function (sum, id) { return sum + P.bag(ctx, id); }, 0);
            var result = P.done(count, 'sử dụng vật phẩm sự kiện', 'Không còn vật phẩm sự kiện');
            if (left) result.message += ' · Còn ' + left + ' vật phẩm';
            return result;
        });
    });
    P.register({id: 'su_kien_daily', name: 'Sự kiện mini hằng ngày: tất cả', group: 'Nhóm tác vụ', desktop: ['action_su_kien_daily'], timeoutMs: 3600000}, function (ctx) {
        return P.sequence(ctx, ['dap_anh', 'nem_bao_cat', 'choi_day', 'nem_da']);
    });
})(typeof window !== 'undefined' ? window : globalThis);
