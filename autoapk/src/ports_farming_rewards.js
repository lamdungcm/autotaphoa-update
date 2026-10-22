/* Add the desktop reward stages around the preserved entrust workflow.
 * Rank-list queries from the old PC code are not harvested rewards. */
(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    var original = api.tasks.find(function (t) { return t.id === 'mua_vu_ban_ron'; }).run;
    P.farmingRewards = async function (ctx, act) {
        var count = await P.claimEventFree(ctx, act, []), id = P.activityId(act);
        var ids = [];
        [2, 3].forEach(function (type) { P.list(act.getConditionTempListByDataType(type)).forEach(function (row) { ids.push(P.integer(row.conditionId, 1)); }); });
        count += await P.claimActivity(ctx, act, ids);
        var info = P.ret(await P.call(ctx, 'FarmingSeasonNetUtil', 'sendFarmingDataReqMsg', [id, false]));
        var donated = P.number(info.totalDonate), rows = P.list(act.getConditionTempListByDataType(101));
        P.instance(ctx, 'FarmingSeasonMgr').asynFarmingDataRespMsg(info, id);
        var ready = rows.filter(function (row) { return !act.getConditionData(row.conditionId, true).isGetReward && donated >= P.number(row.paramList[3]); });
        if (ready.length) {
            var wanted = ready.map(function (row) { return P.integer(row.conditionId, 1); });
            var reply = P.ret(await P.packet(ctx, 'S_ACTIVITY_GET_MULTI_REWARD', {activityId: id, conditionId: wanted}));
            var actual = P.list(reply.successConditionId).map(Number);
            if (Number(reply.activityId) !== id || !P.reward(reply) || actual.length !== wanted.length || actual.some(function (n, i) { return wanted.indexOf(n) < 0 || actual.indexOf(n) !== i; }))
                throw new Error('Chưa xác nhận đầy đủ mốc đóng góp Mùa Vụ');
            actual.forEach(function (n) { act.setConditionRewardReceived(n); }); count += actual.length;
        }
        count += await P.claimWarOrder(ctx, act);
        return count;
    };
    P.register({id: 'mua_vu_ban_ron', name: 'Mùa Vụ Bận Rộn', group: 'Sự kiện', desktop: ['action_mua_vu_ban_ron'], options: [
        P.boolOption('rewards', 'Nhận quà miễn phí, nhiệm vụ, đóng góp và chiến lệnh', true),
        P.boolOption('entrust', 'Nhận ủy thác, ghép đội và bắt đầu', true)
    ], timeoutMs: 900000}, async function (ctx) {
        var act = ctx.activity(1020); if (!act) return P.skip('Mùa Vụ Bận Rộn chưa mở');
        var count = ctx.options.rewards ? await P.farmingRewards(ctx, act) : 0;
        var result = ctx.options.entrust ? await original(ctx) : P.done(0, '', 'Chưa bật làm ủy thác');
        if (count) { result.status = 'success'; result.message = 'Đã nhận ' + count + ' mốc/quà · ' + result.message; }
        return result;
    });
})(typeof window !== 'undefined' ? window : globalThis);
