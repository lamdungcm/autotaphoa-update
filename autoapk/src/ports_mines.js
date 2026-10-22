(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    function opened() { return P.vnClock().getUTCHours() >= 8; }
    async function read(ctx) {
        var data = P.ret(await P.call(ctx, 'MineNetUtil', 'getMineData', [false]));
        P.fields(data, ['explorateInfo', 'power']); P.list(data.explorateInfo.histories);
        var model = P.model(ctx, 'MineMgr');
        model.power = data.power; model.lastPowerTime = data.lastPowerTime;
        model.joinNumDetailList = P.list(data.joinNum); model.diamondNumDetailList = P.list(data.diamondNum);
        if (model.exploreData && typeof model.exploreData.syncExploreInfo === 'function') model.exploreData.syncExploreInfo(data.explorateInfo);
        return data;
    }
    P.register({id: 'mine_explore', name: 'Thăm dò mỏ', group: 'Mỏ khoáng', desktop: ['action_mine_explore'], options: [P.numOption('rounds', 'Số lượt thăm dò tối đa', 3, 100, 1)]}, async function (ctx) {
        if (!opened()) return P.skip('Mỏ khoáng mở từ 08:00 đến 24:00 giờ Việt Nam');
        var data = await read(ctx), rounds = 0, digs = 0, rewards = 0;
        while (rounds < ctx.options.rounds) {
            ctx.check(); if (!opened()) break;
            if (data.explorateInfo.active !== true) {
                if (P.integer(data.power) === 0) break;
                var started = P.ret(await P.call(ctx, 'MineNetUtil', 'exploreActive', [false]));
                if (!started.explorateInfo || started.explorateInfo.active !== true) throw new Error('Chưa xác nhận bắt đầu lượt thăm dò');
                data = await read(ctx);
            }
            rounds++;
            for (var step = 0; step < 16; step++) {
                ctx.check(); if (!opened()) break;
                var history = P.list(data.explorateInfo.histories);
                var chest = history.filter(function (h) { return Number(h.result) === 1 && h.handled === false; })[0];
                if (chest) {
                    var claimed = P.ret(await P.call(ctx, 'MineNetUtil', 'eventHandle', [1, false]));
                    if (!P.reward(claimed)) throw new Error('Chưa nhận được thưởng rương mỏ');
                    data = await read(ctx);
                    if (data.explorateInfo.histories.some(function (h) { return Number(h.position) === Number(chest.position) && h.handled !== true; }))
                        throw new Error('Rương mỏ chưa được đánh dấu đã nhận');
                    rewards++; continue;
                }
                if (data.explorateInfo.active !== true) break;
                var used = history.map(function (h) { return Number(h.position); }), position = 0;
                for (var p = 1; p <= 7; p++) if (used.indexOf(p) < 0) { position = p; break; }
                if (!position) break;
                var reply = P.ret(await P.call(ctx, 'MineNetUtil', 'explore', [1, position, 0, false]));
                if (!reply.history && !reply.mine || reply.history && Number(reply.history.position) !== position) throw new Error('Kết quả thăm dò không khớp ô đã chọn');
                digs++;
                if (reply.mine) {
                    var uid = P.id(reply.mine.id);
                    var confirmed = P.ret(await P.call(ctx, 'MineNetUtil', 'query', [uid, false, false]));
                    if (!confirmed.mine || String(confirmed.mine.id) !== uid) throw new Error('Chưa xác nhận mỏ vừa tìm thấy');
                    P.instance(ctx, 'MineMgr').syncMineInfo(confirmed.mine);
                }
                data = await read(ctx);
                if (reply.mine) break;
            }
            if (data.explorateInfo.active === true) break;
        }
        return P.done(digs + rewards, 'thăm dò ô/nhận rương', 'Đã hết lượt thăm dò mỏ');
    });
    function diamond(mine) { return mine && [3, 10003].indexOf(Number(mine.mineId)) >= 0; }
    function member(mine, uid) { return P.list(mine.joiners).some(function (j) { return String(j.playerId) === uid; }); }
    async function owned(ctx) {
        var response = P.ret(await P.call(ctx, 'MineNetUtil', 'getPlayerMineList', [false]));
        var own = P.list(response.myMines), joined = P.list(response.joined), mgr = P.instance(ctx, 'MineMgr');
        own.concat(joined).forEach(function (row) { if (row.mine) mgr.syncMineInfo(row.mine); });
        return {own: own, joined: joined};
    }
    P.register({id: 'advanced_mine', name: 'Mỏ cao cấp: tham gia hoặc mở', group: 'Mỏ khoáng', desktop: ['action_mo_cao_cap'], options: [
        P.numOption('joins', 'Số mỏ tham gia tối đa mỗi lượt', 3, 100),
        P.boolOption('create', 'Mở mỏ khi không có chỗ trống', true), P.numOption('radars', 'Số radar tối đa để mở mỏ', 5, 1000)
    ]}, async function (ctx) {
        if (!opened()) return P.skip('Mỏ khoáng mở từ 08:00 đến 24:00 giờ Việt Nam');
        await read(ctx); await owned(ctx);
        var mgr = P.instance(ctx, 'MineMgr'), maximum = P.integer(mgr.getMaxJoinNum(), 1), count = 0, hasSlot = false;
        for (var page = 1; page <= 10 && opened() && count < ctx.options.joins && P.integer(mgr.getCurJoinNum()) < maximum; page++) {
            var list = P.ret(await P.call(ctx, 'MineNetUtil', 'cooperationList', [page, 20, false]));
            var mines = P.list(list.mineInfos); if (!mines.length) break;
            for (var i = 0; i < mines.length && count < ctx.options.joins && P.integer(mgr.getCurJoinNum()) < maximum; i++) {
                ctx.check(); if (!opened()) break;
                var mine = mines[i];
                if (!diamond(mine) || String(mine.ownerId) === ctx.uid || member(mine, ctx.uid)) continue;
                var query = P.ret(await P.call(ctx, 'MineNetUtil', 'query', [mine.id, false, false]));
                mine = P.fields(query, ['mine']).mine;
                if (!mgr.syncMineInfo(mine).isMining()) continue;
                var positions = P.list(mine.joiners).map(function (j) { return Number(j.position); }), position = 0;
                for (var pos = 1; pos <= 4; pos++) if (positions.indexOf(pos) < 0) { position = pos; break; }
                if (!position) continue;
                hasSlot = true;
                var reply = P.ret(await P.call(ctx, 'MineNetUtil', 'replace', [mine.id, false, position, 0, false]));
                if (reply.success !== true) continue;
                query = P.ret(await P.call(ctx, 'MineNetUtil', 'query', [mine.id, false, false]));
                if (!query.mine || !member(query.mine, ctx.uid) || !query.mine.joiners.some(function (j) { return String(j.playerId) === ctx.uid && Number(j.position) === position; }))
                    throw new Error('Máy chủ chưa xác nhận đã vào đúng chỗ trống trong mỏ');
                mgr.syncMineInfo(query.mine); count++;
            }
            if (mines.length < 20) break;
        }
        if (!count && !hasSlot && ctx.options.create && opened()) {
            await read(ctx); await owned(ctx);
            var current = P.integer(mgr.getCurDiamondMineNum()), max = P.integer(mgr.getMaxDiamondMineNum());
            if (current > 0 || current >= max) return P.done(0, '', 'Đang sở hữu mỏ kim cương hoặc đã đủ số mỏ');
            var item = P.integer(mgr.model.configExploreItemId, 1), available = P.bag(ctx, item), amount = Math.min(available, ctx.options.radars);
            if (amount > 0) {
                var created = P.ret(await P.call(ctx, 'MineNetUtil', 'explore', [2, 0, amount, false]));
                if (!created.mine || !diamond(created.mine) || String(created.mine.ownerId) !== ctx.uid) throw new Error('Chưa xác nhận mỏ cao cấp đã mở');
                mgr.syncMineInfo(created.mine);
                var after = await owned(ctx);
                if (!after.own.some(function (row) { return row.mine && String(row.mine.id) === String(created.mine.id); })) throw new Error('Mỏ mới chưa có trong danh sách sở hữu');
                count++;
            }
        }
        return P.done(count, 'tham gia/mở mỏ cao cấp', 'Không có lượt hoặc radar để mở mỏ cao cấp');
    });
})(typeof window !== 'undefined' ? window : globalThis);
