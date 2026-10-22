(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    function register(id, name, desktop, options, handler) {
        P.register({id: id, name: name, group: 'Thị trấn', desktop: desktop, options: options || []}, handler);
    }
    function sceneEvents(ctx, ids, type) {
        var db = ctx.require('DBUtil').DBUtil;
        return P.values(P.model(ctx, 'MainEventMgr').eventDict).filter(function (row) {
            var cfg = db.getMainsceneEvent(row.eventId);
            return ids.indexOf(Number(row.eventId)) >= 0 || type != null && cfg && Number(cfg.type) === type;
        });
    }
    async function handle(ctx, row, answer) {
        var reply = P.ret(await P.call(ctx, 'MainEventNetUtil', 'sceneEventHandle', [row.uid, answer, '', false]));
        if (!P.reward(reply, 'rewards')) throw new Error('Chưa nhận được thưởng tương tác');
        return reply;
    }
    register('bat_trom', 'Bắt trộm', ['action_bat_trom'], [], async function (ctx) {
        var rows = sceneEvents(ctx, [5002]);
        if (!rows.length) return P.done(0, '', 'Chưa có kẻ trộm trong thị trấn');
        await handle(ctx, rows[0], 0); return P.done(1, 'bắt trộm');
    });
    register('nem_vong', 'Ném vòng', ['action_nem_vong'], [P.numOption('answer', 'Mức ném vòng', 2, 3, 1)], async function (ctx) {
        var rows = sceneEvents(ctx, [5001]);
        if (!rows.length) return P.done(0, '', 'Chưa có trò ném vòng trong thị trấn');
        await handle(ctx, rows[0], ctx.options.answer); return P.done(1, 'ném vòng');
    });
    register('fishing', 'Câu cá thị trấn', ['action_fishing'], [P.numOption('casts', 'Tổng lượt câu trong ngày', 3, 3)], async function (ctx) {
        var info = P.ret(await P.call(ctx, 'MainEventNetUtil', 'requestFishInfo', [false]));
        var done = P.integer(info.fishTime), count = 0;
        if (done >= ctx.options.casts) return P.done(0, '', 'Đã đủ lượt câu hôm nay');
        var rows = sceneEvents(ctx, [7001], 7);
        if (!rows.length) return P.skip('Chưa có điểm câu cá trong thị trấn');
        while (done < ctx.options.casts) {
            // Native MainEventFishGameView sends answer 1 for a successful cast.
            // fishRecord stores fish weights; it is not a list of bait quantities.
            var reply = await handle(ctx, rows[0], 1);
            if (!reply.fish || Number(reply.fish.fishTime) <= done) throw new Error('Lượt câu cá chưa tăng');
            var expected = P.integer(reply.fish.fishTime);
            info = P.ret(await P.call(ctx, 'MainEventNetUtil', 'requestFishInfo', [false]));
            done = P.integer(info.fishTime);
            if (done < expected) throw new Error('Máy chủ chưa lưu lượt câu cá');
            count++;
        }
        return P.done(count, 'câu cá');
    });
    register('thau_phuong_trai', 'Thấu Phương Trại', ['action_thau_phuong_trai'], [P.numOption('rolls', 'Số lượt tối đa', 5, 100)], async function (ctx) {
        var info = await P.accept(ctx, 'S_SHU_FANG_ZHAI_INFO', {}), initial = P.integer(info.talkTimes), count = 0;
        if (info.enter !== true) await P.accept(ctx, 'S_SHU_FANG_ZHAI_ENTER', {});
        for (var i = 0; i < ctx.options.rolls; i++) {
            var reply = await P.packet(ctx, 'S_SHU_FANG_ZHAI_TALK', {});
            if (reply.ret !== 0) break;
            info = await P.accept(ctx, 'S_SHU_FANG_ZHAI_INFO', {});
            if (P.integer(info.talkTimes) !== initial + count + 1) throw new Error('Lượt đối thoại chưa được lưu');
            count++;
        }
        return P.done(count, 'đối thoại Thấu Phương Trại');
    });
    register('hem_nua_dem', 'Hẻm nửa đêm', ['action_hem_nua_dem'], [P.numOption('hunts', 'Số lượt bắt ma tối đa', 5, 100)], async function (ctx) {
        var info = await P.accept(ctx, 'S_SOUL_HOUSE_INFO', {}), energy = P.integer(info.energy), count = 0;
        if (info.calReward && Number(info.calReward.accumulateCoin) > 0) {
            var income = await P.accept(ctx, 'S_SOUL_HOUSE_GAIN', {});
            if (!income.calReward || Number(income.calReward.accumulateCoin) >= Number(info.calReward.accumulateCoin)) throw new Error('Chưa xác nhận nhận tiền hẻm nửa đêm');
            count++;
        }
        for (var i = 0; i < ctx.options.hunts && energy > 0; i++) {
            var start = await P.accept(ctx, 'S_SOUL_HOUSE_START_HUNT', {});
            P.fields(start, ['ghostId', 'placeId']);
            var hunted = await P.accept(ctx, 'S_SOUL_HOUSE_HUNT', {type: 0});
            if (!P.list(hunted.huntGhost).length || P.integer(hunted.energy) >= energy) throw new Error('Chưa xác nhận kết quả bắt ma');
            energy = P.integer(hunted.energy); count++;
        }
        return P.done(count, 'nhận tiền/bắt ma', 'Chưa có thu nhập hoặc thể lực bắt ma');
    });
    register('film_legend', 'Điện truyền kỳ: quỳ bái và thưởng', ['action_film_legend'], [], async function (ctx) {
        var info = await P.accept(ctx, 'S_LEGEND_UNION_DATA', {}), count = 0;
        if (!info.unionInfo) return P.skip('Chưa có công hội trong Điện truyền kỳ');
        var before = Number(info.legendWorships), midnight = P.vnClock(); midnight.setUTCHours(0, 0, 0, 0);
        var today = midnight.getTime() - 7 * 3600000;
        if (before * (before < 100000000000 ? 1000 : 1) < today) {
            var worship = await P.accept(ctx, 'S_LEGEND_UNION_WORSHIP', {});
            if (Number(worship.worships) <= before) throw new Error('Chưa xác nhận quỳ bái');
            count++;
        }
        var reward = P.fields(await P.accept(ctx, 'S_LEGEND_TROPHY_LIST', {}), ['award']);
        // EnumLegendDailyRewardState is read from the running game, never inferred from ret.
        var states = ctx.require('LegendConfig').EnumLegendDailyRewardState;
        if (reward.award === states.CanGet) {
            var claim = await P.accept(ctx, 'S_LEGEND_TROPHY_DAILY_REWARD_CLAIM', {});
            if (!P.reward(claim)) throw new Error('Chưa nhận được thưởng Điện truyền kỳ'); count++;
        }
        return P.done(count, 'quỳ bái/nhận thưởng Điện truyền kỳ');
    });
})(typeof window !== 'undefined' ? window : globalThis);
