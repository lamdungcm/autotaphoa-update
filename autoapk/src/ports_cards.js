(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    P.register({id: 'mo_the_mua', name: 'Mở thẻ mùa và nhận bộ sưu tập', group: 'Sự kiện', desktop: ['action_mo_the_mua'],
        options: [P.numOption('limit', 'Số gói tối đa', 2500, 10000, 1), P.numOption('batch', 'Số gói mỗi lần', 10, 10, 1)], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1073], ['thẻ mùa', 'sưu tập thẻ']); if (!act) return P.skip('Mùa thẻ chưa mở');
        var id = P.activityId(act), mgr = P.instance(ctx, 'ActivityGuardianCollectMgr'), data = mgr.getData(act), opened = 0, claimed = 0;
        var cfg = P.ret(await P.packet(ctx, 'S_GUARDIAN_COLLECT_CONFIG', {activityId: id}));
        P.list(cfg.packConfig); P.list(cfg.taskConfig); data.syncConfig(cfg);
        async function read() {
            var r = P.ret(await P.packet(ctx, 'S_GUARDIAN_COLLECT_DATA', {activityId: id}));
            P.list(r.cardIds); P.list(r.taskData); data.syncInfo(r); return r;
        }
        async function rewards() {
            var count = await P.claimActivity(ctx, act); await read();
            var groups = Array.from(data.taskMap.values());
            for (var i = 0; i < groups.length; i++) {
                var row = groups[i], eligible = P.list(row.progress).filter(function (task) {
                    return mgr.isCanGetTaskReward(act, task);
                }).map(function (task) { return P.integer(task.taskId, 1); });
                if (!eligible.length) continue;
                var reply = P.ret(await P.packet(ctx, 'S_GUARDIAN_COLLECT_TAKE_TASK_REWARD', {
                    activityId: id, activityType: P.integer(row.activityType, 1), childType: P.integer(row.childType), taskId: eligible
                }));
                if (!reply.taskData || Number(reply.taskData.activityType) !== Number(row.activityType) || Number(reply.taskData.childType) !== Number(row.childType) || eligible.some(function (taskId) { return P.list(reply.taskData.rewardTaskIds).map(Number).indexOf(taskId) < 0; })) throw new Error('Máy chủ chưa xác nhận các nhiệm vụ mùa thẻ đã nhận');
                data.updateTaskData(reply.taskData); count += eligible.length;
            }
            return count;
        }
        await read(); claimed += await rewards();
        var packs = data.packConfig.filter(function (pack) { return [2, 3].indexOf(Number(pack.type)) < 0; });
        for (var pass = 0; pass < 3 && opened < ctx.options.limit; pass++) {
            for (var i = 0; i < packs.length && opened < ctx.options.limit; i++) {
                var packId = P.integer(packs[i].id, 1);
                while (P.bag(ctx, packId) > 0 && opened < ctx.options.limit) {
                    var num = Math.min(P.bag(ctx, packId), ctx.options.batch, ctx.options.limit - opened), previous = P.integer(data.openPackTimes);
                    var reply = await P.spendItem(ctx, packId, num, function () { return P.packet(ctx, 'S_GUARDIAN_COLLECT_OPEN_PACK', {activityId: id, packId: packId, num: num}); });
                    if (!reply || !P.list(reply.drawCards).length || P.integer(reply.openPack) !== previous + num) throw new Error('Kết quả mở gói thẻ chưa đầy đủ');
                    data.syncOpenPack(reply); await read();
                    if (P.integer(data.openPackTimes) !== previous + num) throw new Error('Số gói đã mở chưa được lưu');
                    opened += num;
                }
            }
            var extra = await rewards(); claimed += extra; if (!extra) break;
        }
        var optional = data.packConfig.filter(function (pack) { return [2, 3].indexOf(Number(pack.type)) >= 0 && P.bag(ctx, pack.id) > 0; });
        var result = P.done(opened + claimed, 'mở ' + opened + ' gói, nhận ' + claimed + ' mốc', 'Không có gói thẻ hoặc mốc đủ điều kiện');
        if (optional.length) result.message += ' · Còn gói tự chọn cần anh chọn thẻ trong game';
        return result;
    });
})(typeof window !== 'undefined' ? window : globalThis);
