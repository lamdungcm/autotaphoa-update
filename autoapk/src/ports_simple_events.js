(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    async function spend(ctx, itemId, quantity, send) {
        var before = P.bag(ctx, itemId); if (before < quantity) return null;
        var reply = P.ret(await send());
        await ctx.waitFor(function () { return P.bag(ctx, itemId) === before - quantity; }, {timeoutMs: 5000, message: 'Túi chưa xác nhận vật phẩm đã dùng; dừng để tránh dùng lặp'});
        return reply;
    }
    P.spendItem = spend;
    P.register({id: 'game_vuon_truong', name: 'Game vườn trường', group: 'Sự kiện', desktop: ['action_game_vuon_truong'], options: [P.numOption('limit', 'Số lượt chơi tối đa', 150, 2000, 1)], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1015], ['vườn trường', 'vuon truong']); if (!act) return P.skip('Game vườn trường chưa mở');
        var id = P.activityId(act), rewards = await P.claimActivity(ctx, act), played = 0;
        var state = P.ret(await P.call(ctx, 'ActivityCampusGamesNetUtil', 'reqActivityData', [id, false]));
        P.fields(state, ['info']);
        while (played < ctx.options.limit) {
            if (!P.bag(ctx, 120100)) {
                var newRewards = await P.claimActivity(ctx, act); rewards += newRewards;
                if (!newRewards || !P.bag(ctx, 120100)) break;
            }
            var before = P.integer(state.info.joinTimes);
            var moved = await spend(ctx, 120100, 1, function () { return P.call(ctx, 'ActivityCampusGamesNetUtil', 'reqActivityForward', [id, 1, false]); });
            if (!moved) break;
            if (Number(moved.activityId) !== id || !P.list(moved.reportList).length) throw new Error('Chưa đọc được báo cáo lượt chơi vườn trường');
            state = P.ret(await P.call(ctx, 'ActivityCampusGamesNetUtil', 'reqActivityData', [id, false]));
            if (!state.info || Number(state.info.joinTimes) !== before + 1) throw new Error('Lượt chơi vườn trường chưa tăng');
            played++;
        }
        rewards += await P.claimActivity(ctx, act);
        return P.done(played + rewards, 'chơi ' + played + ' lượt, nhận ' + rewards + ' mốc', 'Đã kiểm tra, không còn vé hoặc mốc đủ điều kiện');
    });
    P.register({id: 'con_duong_anh_sao', name: 'Con đường ánh sao', group: 'Sự kiện', desktop: ['action_con_duong_anh_sao'], options: [P.numOption('limit', 'Số lượt tối đa', 150, 2000, 1), P.boolOption('draw', 'Quay Đêm vương miện khi có vé', true)], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1065], ['con đường ánh sao', 'anh sao']); if (!act) return P.skip('Con đường ánh sao chưa mở');
        var id = P.activityId(act), count = await P.claimEventFree(ctx, act, [106510100]);
        count += await P.claimActivity(ctx, act);
        var mgr = P.instance(ctx, 'ActivityStarLightMgr'), data = mgr.getData(act);
        var config = P.ret(await P.packet(ctx, 'S_STARLIGHT_CONFIG', {activityId: id})); data.syncConfig(config);
        async function read() { var reply = P.ret(await P.packet(ctx, 'S_STARLIGHT_INFO', {activityId: id})); P.fields(reply, ['selectCount', 'drawCount']); data.syncInfo(reply); return reply; }
        var state = await read(), used = 0, util = ctx.require('ActivityStarLightUtil').activityStarLightUtil;
        for (var pass = 0; pass < 3 && used < ctx.options.limit; pass++) {
            while (P.bag(ctx, 120278) > 0 && used < ctx.options.limit) {
                var before = P.integer(state.selectCount);
                var reply = await spend(ctx, 120278, 1, function () { return P.packet(ctx, 'S_STARLIGHT_SELECT', {activityId: id}); });
                if (!reply || Number(reply.selectCount) !== before + 1 || !P.list(reply.allSelectBeautyId).length) throw new Error('Chưa xác nhận kết quả hải tuyển');
                state = await read(); if (Number(state.selectCount) !== before + 1) throw new Error('Số lượt hải tuyển chưa cập nhật');
                used++; count++;
            }
            var cost = P.integer(util.getDrawCostCount(act), 1);
            if (ctx.options.draw && P.bag(ctx, 120279) >= cost) {
                P.ret(await P.packet(ctx, 'S_STARLIGHT_CHANGE_DRAW_SCENE', {activityId: id, enter: true}));
                try {
                    while (P.bag(ctx, 120279) >= cost && used < ctx.options.limit) {
                        var drawBefore = P.integer(state.drawCount);
                        var drawn = await spend(ctx, 120279, cost, function () { return P.packet(ctx, 'S_STARLIGHT_DRAW', {activityId: id, count: 1}); });
                        if (!drawn || Number(drawn.drawCount) !== drawBefore + 1) throw new Error('Chưa xác nhận lượt quay Đêm vương miện');
                        state = await read(); if (Number(state.drawCount) !== drawBefore + 1) throw new Error('Số lượt quay chưa cập nhật');
                        used++; count++;
                    }
                } finally { ctx.check(); P.ret(await P.packet(ctx, 'S_STARLIGHT_CHANGE_DRAW_SCENE', {activityId: id, enter: false})); }
            }
            var extra = await P.claimActivity(ctx, act); count += extra; if (!extra) break;
        }
        return P.done(count, 'hải tuyển / quay / nhận thưởng', 'Không có vé hoặc mốc thưởng đủ điều kiện');
    });
    P.register({id: 'than_bep_cho_dem', name: 'Thần bếp chợ đêm', group: 'Sự kiện', desktop: ['action_than_bep_cho_dem'], options: [P.numOption('help', 'Số quầy hỗ trợ tối đa', 20, 100), P.numOption('items', 'Số món dùng tối đa', 100000, 1000000)], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1017], ['thần bếp', 'chợ đêm']); if (!act) return P.skip('Thần bếp chợ đêm chưa mở');
        var id = P.activityId(act), mgr = P.instance(ctx, 'NightMarketMgr'), count = await P.claimEventFree(ctx, act, [101710100]), consumed = 0;
        var config = P.ret(await P.packet(ctx, 'S_NIGHT_MARKET_CONFIG', {activityId: id})); P.list(config.rewardConfig); mgr.syncNightMarketConfigRespMsg(config);
        async function read() { var r = P.ret(await P.packet(ctx, 'S_NIGHT_MARKET_INFO', {activityId: id})); P.fields(r, ['data', 'globalData']); mgr.syncNightMarketInfoResp(r); return r; }
        var state = await read(); count += await P.claimActivity(ctx, act);
        if (ctx.options.help && Number(state.data.todayHelpTimes) > 0) {
            var others = P.ret(await P.packet(ctx, 'S_NIGHT_MARKET_GET_OTHER_INFO', {activityId: id, type: 1, targetPlayerIds: []})), rows = P.list(others.otherDataList), helped = 0, seen = {};
            for (var i = 0; i < rows.length && helped < ctx.options.help && Number(state.data.todayHelpTimes) > 0; i++) {
                var uid = P.id(rows[i].playerId); if (uid === ctx.uid || seen[uid]) continue; seen[uid] = true;
                var before = P.integer(state.data.todayHelpTimes), reply = P.ret(await P.packet(ctx, 'S_NIGHT_MARKET_HELP_OTHER', {activityId: id, targetPlayerId: uid}));
                if (String(reply.targetPlayerId) !== uid || !reply.myData || Number(reply.myData.todayHelpTimes) !== before - 1) throw new Error('Chưa xác nhận hỗ trợ đúng quầy chợ đêm');
                mgr.syncNightMarketHelpOtherResp(reply); state = await read();
                if (Number(state.data.todayHelpTimes) !== before - 1) throw new Error('Lượt hỗ trợ chợ đêm chưa cập nhật');
                count++; helped++;
            }
        }
        for (var pass = 0; pass < 3 && consumed < ctx.options.items; pass++) {
            for (var itemId = 120081; itemId <= 120085 && consumed < ctx.options.items; itemId++) {
                var quantity = Math.min(P.bag(ctx, itemId), ctx.options.items - consumed); if (!quantity) continue;
                var used = await spend(ctx, itemId, quantity, function () { return P.packet(ctx, 'S_NIGHT_MARKET_USE_STALL_ITEM', {activityId: id, itemId: itemId, count: quantity}); });
                if (!used || Number(used.activityId) !== id || !used.stall) throw new Error('Chưa có dữ liệu quầy sau dùng món ăn');
                mgr.syncNightMarketUseStallItemRespMsg(used); count += quantity; consumed += quantity;
            }
            state = await read();
            if (P.list(state.data.canGainUnionRewardIds).length) {
                var union = P.ret(await P.packet(ctx, 'S_NIGHT_MARKET_GAIN_UNION_REWARD', {activityId: id}));
                if (!P.reward(union)) throw new Error('Chưa có thưởng công hội chợ đêm');
                mgr.syncNightMarketGainUnionRewardRespMsg(union); count++;
            }
            state = await read();
            var available = config.rewardConfig.filter(function (r) { return Number(state.globalData.popularity) >= Number(r.popularity) && P.list(state.data.gainGlobalPopularityRewardIds).map(Number).indexOf(Number(r.id)) < 0; });
            for (var j = 0; j < available.length; j++) {
                var milestone = P.integer(available[j].id, 1), claim = P.ret(await P.packet(ctx, 'S_NIGHT_MARKET_GAIN_GLOBAL_POPULARITY_REWARD', {activityId: id, id: milestone}));
                if (Number(claim.id) !== milestone) throw new Error('Mốc toàn cầu trả về không khớp');
                state = await read(); if (state.data.gainGlobalPopularityRewardIds.map(Number).indexOf(milestone) < 0) throw new Error('Mốc toàn cầu chưa được lưu');
                count++;
            }
            var extra = await P.claimActivity(ctx, act); count += extra; if (!extra) break;
        }
        var remaining = [120081, 120082, 120083, 120084, 120085].reduce(function (n, id) { return n + P.bag(ctx, id); }, 0);
        var result = P.done(count, 'hỗ trợ / dùng món / nhận thưởng', 'Chưa có lượt hoặc thưởng đủ điều kiện');
        if (remaining) result.message += ' · Còn ' + remaining + ' món trong túi (đã tới giới hạn cấu hình)';
        return result;
    });
    P.register({id: 'rua_cham_tran', name: 'Rùa chạm trán', group: 'Sự kiện', desktop: ['action_rua_cham_tran'], options: [P.numOption('games', 'Số ván tối đa', 50, 1000, 1),
        {key: 'lucky', label: 'Màu may mắn', type: 'choice', default: '4', choices: ['Xanh lá', 'Xanh ngọc', 'Xanh', 'Xanh đậm', 'Tím', 'Hồng', 'Đỏ', 'Cam', 'Nâu', 'Vàng'].map(function (name, i) { return {id: String(i + 1), name: name}; })}], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1057], ['rùa chạm trán', 'rua cham tran']); if (!act) return P.skip('Rùa chạm trán chưa mở');
        var id = P.activityId(act), rewards = await P.claimActivity(ctx, act), finished = 0, mgr = P.instance(ctx, 'ActivityTurtleMgr');
        var cfg = P.ret(await P.call(ctx, 'ActivityTurtleNetUtil', 'reqConfig', [id, false], 'activityTurtleNetUtil'));
        mgr.model.getConfigData(id).syncConfig(cfg);
        var data = mgr.model.getTempData(id), maxRound = P.integer(ctx.require('ActivityTurtleUtil').activityTurtleUtil.getEndEnforeNum(act), 1);
        async function read() { var r = P.ret(await P.call(ctx, 'ActivityTurtleNetUtil', 'reqInfo', [id, false], 'activityTurtleNetUtil')); P.fields(r, ['totalGameTimes']); data.syncInfo(r); return r; }
        var state = await read();
        while (finished < ctx.options.games) {
            if (!data.finalPanel.isValid) {
                if (!P.bag(ctx, 120253)) break;
                var before = P.integer(state.totalGameTimes);
                var start = await spend(ctx, 120253, 1, function () { return P.call(ctx, 'ActivityTurtleNetUtil', 'newGame', [id, Number(ctx.options.lucky), false], 'activityTurtleNetUtil'); });
                if (!start || !start.afterPanel) throw new Error('Không có bàn rùa sau khi bắt đầu');
                state = await read(); if (Number(state.totalGameTimes) !== before + 1 || !data.finalPanel.isValid) throw new Error('Máy chủ chưa xác nhận ván rùa mới');
            }
            for (var round = 0; data.finalPanel.packetNum > 0 && data.finalPanel.round < maxRound; round++) {
                if (round >= maxRound + 1) throw new Error('Bàn rùa vượt số vòng quy định');
                var previous = P.integer(data.finalPanel.round);
                var next = P.ret(await P.call(ctx, 'ActivityTurtleNetUtil', 'nextRound', [id, false], 'activityTurtleNetUtil'));
                if (!next.panel || Number(next.panel.round) <= previous) throw new Error('Vòng rùa không tiến triển');
                data.syncFinalPanel(next.panel);
            }
            P.ret(await P.call(ctx, 'ActivityTurtleNetUtil', 'reqResult', [id, false], 'activityTurtleNetUtil'));
            state = await read(); if (data.finalPanel.isValid) throw new Error('Ván rùa chưa kết toán');
            finished++; rewards += await P.claimActivity(ctx, act);
        }
        return P.done(finished + rewards, 'hoàn tất ' + finished + ' ván, nhận ' + rewards + ' mốc', 'Không có vé hoặc mốc thưởng đủ điều kiện');
    });
})(typeof window !== 'undefined' ? window : globalThis);
