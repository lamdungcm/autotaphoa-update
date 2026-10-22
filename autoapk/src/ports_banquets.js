/* Banquets use the actual JOIN operation. EXIST is exit, HISTORY is history;
 * neither is an eating/reward confirmation. */
(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    var choices = [{id: 'both', name: 'Tất cả'}, {id: 'small', name: 'Tiệc nhỏ'}, {id: 'big', name: 'Tiệc lớn'}, {id: 'studio', name: 'Tiệc Studio'}];
    var guestOptions = [
        {key: 'kind', label: 'Loại tiệc', type: 'choice', choices: choices, default: 'both'},
        {key: 'hosts', label: 'UID chủ tiệc (trống = tất cả)', type: 'text', default: '', maxLength: 2000},
        P.numOption('count', 'Số bàn tối đa mỗi lượt', 10, 100),
        P.boolOption('wait', 'Chờ khi chưa có bàn phù hợp', false), P.numOption('waitMinutes', 'Thời gian chờ tối đa (phút)', 30, 60, 1)
    ];
    function targets(text) { return text.split(/[\s,;]+/).filter(Boolean).map(P.id); }
    function outcome(count, label, empty) { return Object.assign(P.done(count, label, empty), {count: count}); }
    function hotelKind(id, selected) {
        return selected === 'both' || selected === 'small' && Number(id) === 10001 || selected === 'big' && Number(id) === 10002 || selected === 'studio' && Number(id) === 40001;
    }
    async function checkRewards(ctx) {
        var reply = P.ret(await P.call(ctx, 'RestaurantNetUtil', 'checkBanquet', [false]));
        P.list(reply.finishBanquets); return reply;
    }
    async function hotel(ctx) {
        var wanted = targets(ctx.options.hosts), seen = {}, count = 0, end = Date.now() + ctx.options.waitMinutes * 60000;
        var db = ctx.require('DBUtil').DBUtil;
        do {
            for (var type = 1; type <= 2 && count < ctx.options.count; type++) {
                for (var page = 1; page <= 10 && count < ctx.options.count; page++) {
                    var data = P.ret(await P.call(ctx, 'RestaurantNetUtil', 'getBanquetList', [type, page, [], false]));
                    var rows = P.list(data.banquets); if (!rows.length) break;
                    for (var i = 0; i < rows.length && count < ctx.options.count; i++) {
                        var row = rows[i], uid = P.id(row.uid);
                        if (seen[uid] || row.isJoin || String(row.hostId) === ctx.uid || wanted.length && wanted.indexOf(String(row.hostId)) < 0 || !hotelKind(row.banquetId, ctx.options.kind)) continue;
                        var cfg = db.getRestaurantBanquet(row.banquetId);
                        if (!cfg) throw new Error('Chưa đọc được loại bàn tiệc');
                        var tableType = P.integer(cfg.type, 1);
                        var entered = P.ret(await P.call(ctx, 'RestaurantNetUtil', 'getBanquetData', [uid, false, tableType, false]));
                        if (!entered.baseInfo || String(entered.baseInfo.uid) !== uid) throw new Error('Bàn tiệc mở không khớp danh sách');
                        if (entered.baseInfo.isJoin) { seen[uid] = true; continue; }
                        var joined = await P.call(ctx, 'RestaurantNetUtil', 'seatBanquet', [uid, P.integer(row.banquetId, 1), 0, tableType, false]);
                        if (joined && joined.ret === 4406) return outcome(count, 'ăn tiệc khách sạn', 'Đã hết lượt ăn tiệc hôm nay');
                        if (joined && [4407, 4417].indexOf(joined.ret) >= 0) { seen[uid] = true; continue; }
                        P.ret(joined);
                        if (!joined.myInfo || String(joined.myInfo.userId) !== ctx.uid || !P.list(joined.rewards).length) throw new Error('Chưa xác nhận nhân vật đã ngồi và nhận thưởng bàn tiệc');
                        seen[uid] = true; count++;
                        P.ret(await P.call(ctx, 'RestaurantNetUtil', 'exitBanquet', [uid, tableType, false]));
                    }
                    if (rows.length < Number(data.pageSize)) break;
                }
            }
            await checkRewards(ctx);
            if (count >= ctx.options.count || !ctx.options.wait || Date.now() >= end) break;
            ctx.log('Ăn tiệc: đang chờ bàn phù hợp'); await ctx.sleep(10000);
        } while (true);
        return outcome(count, 'ăn tiệc khách sạn', wanted.length ? 'Chưa có bàn của người đã chỉ định' : 'Chưa có bàn tiệc phù hợp');
    }
    async function eventGuest(ctx) {
        var act = P.findActivity(ctx, [], ['nhà hàng', 'nha hang', 'thủy yến', 'thuy yen', 'lưu thủy']);
        if (!act) return Object.assign(P.skip('Sự kiện tiệc chưa mở'), {count: 0});
        var id = P.activityId(act), wanted = targets(ctx.options.hosts), seen = {}, count = 0;
        var end = Date.now() + ctx.options.waitMinutes * 60000;
        var mgr = P.instance(ctx, 'CrossRestaurantMgr');
        if (ctx.options.kind !== 'both') {
            var config = P.ret(await P.call(ctx, 'CrossRestaurantNetUtil', 'getConfig', [id, false], 'crossRestaurantNetUtil'));
            if (Number(config.activityId) !== id) throw new Error('Cấu hình bàn tiệc không khớp sự kiện');
            mgr.model.setConfigData(P.list(config.config), id);
        }
        do {
            for (var type = 1; type <= 2 && count < ctx.options.count; type++) {
                var response = P.ret(await P.call(ctx, 'CrossRestaurantNetUtil', 'getBanquetList', [id, type, false], 'crossRestaurantNetUtil'));
                var rows = P.list(response.banquetList);
                for (var i = 0; i < rows.length && count < ctx.options.count; i++) {
                    var row = rows[i], base = P.fields(row, ['banquetBase']).banquetBase, uid = P.id(base.uid);
                    if (seen[uid] || String(base.ownerId) === ctx.uid || wanted.length && wanted.indexOf(String(base.ownerId)) < 0 || P.list(row.memberList).some(function (m) { return String(m.playerId) === ctx.uid; })) continue;
                    if (ctx.options.kind !== 'both') {
                        var cfg = mgr.model.getBanquetJson(id, base.banquetConfigId);
                        if (!cfg) throw new Error('Chưa đọc được loại bàn tiệc sự kiện');
                        if (ctx.options.kind === 'small' && [1, 3].indexOf(Number(cfg.miniType)) < 0 || ctx.options.kind === 'big' && [2, 4].indexOf(Number(cfg.miniType)) < 0 || ctx.options.kind === 'studio' && Number(cfg.type) !== 4) continue;
                    }
                    var reply = await P.call(ctx, 'CrossRestaurantNetUtil', 'join', [id, uid, P.integer(base.banquetConfigId, 1), 0, false], 'crossRestaurantNetUtil');
                    if (reply && reply.ret === 8411) return outcome(count, 'ăn tiệc sự kiện', 'Đã hết lượt ăn tiệc sự kiện');
                    P.ret(reply);
                    if (!reply.banquetData || String(reply.banquetData.banquetBase.uid) !== uid || !P.list(reply.banquetData.memberList).some(function (m) { return String(m.playerId) === ctx.uid; }) || !P.reward(reply, 'joinReward'))
                        throw new Error('Chưa xác nhận nhân vật đã ăn đúng bàn tiệc sự kiện');
                    seen[uid] = true; count++;
                    P.ret(await P.call(ctx, 'CrossRestaurantNetUtil', 'exitBanquet', [id, uid, false], 'crossRestaurantNetUtil'));
                }
            }
            if (count >= ctx.options.count || !ctx.options.wait || Date.now() >= end) break;
            ctx.log('Ăn tiệc sự kiện: đang chờ bàn phù hợp'); await ctx.sleep(10000);
        } while (true);
        return outcome(count, 'ăn tiệc sự kiện', wanted.length ? 'Chưa có bàn sự kiện của người chỉ định' : 'Chưa có bàn tiệc sự kiện phù hợp');
    }
    P.register({id: 'banquet_hotel_guest', name: 'Ăn tiệc khách sạn / liên server', group: 'Tiệc', desktop: ['action_an_tiec_lsv', 'action_an_tiec_lien_server'], options: guestOptions, timeoutMs: 3600000}, hotel);
    P.register({id: 'banquet_event_guest', name: 'Ăn tiệc sự kiện', group: 'Tiệc', desktop: ['action_an_tiec_su_kien'], options: guestOptions, timeoutMs: 3600000}, eventGuest);
    P.register({id: 'banquet_all', name: 'Ăn tiệc tổng hợp', group: 'Nhóm tác vụ', desktop: ['action_an_tiec_tong_hop'], options: guestOptions, timeoutMs: 3600000}, async function (ctx) {
        var settings = ctx.options, event = await eventGuest(ctx);
        if (event.count >= settings.count) return event;
        try {
            ctx.options = Object.assign({}, settings, {count: settings.count - event.count});
            var hotelResult = await hotel(ctx);
            return {status: event.status === 'success' || hotelResult.status === 'success' ? 'success' : 'already_done', message: event.message + ' · ' + hotelResult.message};
        } finally { ctx.options = settings; }
    });
    async function host(ctx, studio) {
        var made = 0, rewards = 0, seenRewards = {}, usedNews = {}, end = Date.now() + ctx.options.waitMinutes * 60000;
        var mgr = P.instance(ctx, 'RestaurantMgr'), time = ctx.require('TimeUtil').TimeUtil;
        while (true) {
            ctx.check(); var current = await checkRewards(ctx);
            current.finishBanquets.forEach(function (b) {
                var uid = P.id(b.baseInfo && b.baseInfo.uid);
                if (!seenRewards[uid] && P.list(b.myReward).length) { seenRewards[uid] = true; rewards++; }
            });
            var running = current.startingBanquet;
            if (running && Number(running.endAt) > time.getServerTime()) {
                if (!ctx.options.wait) return P.done(made + rewards, 'mở/nhận thưởng tiệc', 'Tiệc hiện tại đang chờ khách');
                if (Date.now() >= end) throw new Error('Tiệc vẫn đang chờ khách; đã đạt thời gian chờ cấu hình');
                ctx.log('Mở tiệc: đang chờ khách hoàn thành bàn hiện tại'); await ctx.sleep(10000); continue;
            }
            if (ctx.options.count > 0 && made >= ctx.options.count) break;
            var banquetId = 0, goodNewsId;
            if (studio) {
                var rows = P.list(mgr.getVaildGoodNews());
                var available = rows.filter(function (row) { return !usedNews[String(row.id)]; });
                if (!available.length) break;
                banquetId = P.integer(available[0].banquetId, 1); goodNewsId = P.id(available[0].id);
                if (!goodNewsId) throw new Error('Không đọc được thiệp tiệc Studio');
            } else {
                if (ctx.options.kind !== 'big' && P.bag(ctx, 110066) > 0 && P.bag(ctx, 110067) > 0) banquetId = 10001;
                else if (ctx.options.kind !== 'small' && P.bag(ctx, 110068) > 0 && P.bag(ctx, 110069) > 0) banquetId = 10002;
                if (!banquetId) break;
            }
            var opened = P.ret(await P.call(ctx, 'RestaurantNetUtil', 'hostBanquet', [banquetId, goodNewsId, false]));
            var info = opened.banquetSceneInfo && opened.banquetSceneInfo.baseInfo;
            if (!info || Number(info.banquetId) !== banquetId || String(info.hostId) !== ctx.uid) throw new Error('Máy chủ chưa xác nhận đã mở đúng bàn tiệc');
            made++;
            if (studio) { usedNews[goodNewsId] = true; mgr.removeGoodNews(goodNewsId); }
            mgr.synHostBanquetData(info); mgr.synOpenHistory(banquetId);
            if (!ctx.options.wait) break;
        }
        return P.done(made + rewards, 'mở/nhận thưởng tiệc', studio ? 'Không có thiệp tiệc Studio còn hạn' : 'Không có vật phẩm mở tiệc');
    }
    var hostOptions = [{key: 'kind', label: 'Loại tiệc', type: 'choice', choices: choices.slice(0, 3), default: 'both'}, P.numOption('count', 'Số tiệc tối đa (0 = hết vật phẩm)', 0, 1000), P.boolOption('wait', 'Chờ khách và mở tiếp', true), P.numOption('waitMinutes', 'Thời gian chờ tối đa (phút)', 30, 60, 1)];
    P.register({id: 'banquet_hotel_host', name: 'Mở tiệc khách sạn', group: 'Tiệc', desktop: ['action_mo_tiec_khach_san'], options: hostOptions, timeoutMs: 3600000}, function (ctx) { return host(ctx, false); });
    P.register({id: 'banquet_studio_host', name: 'Mở tiệc Studio', group: 'Tiệc', desktop: ['action_mo_tiec_studio'], options: [P.numOption('count', 'Số tiệc tối đa', 1, 1000), P.boolOption('wait', 'Chờ khách', false), P.numOption('waitMinutes', 'Thời gian chờ tối đa (phút)', 30, 60, 1)], timeoutMs: 3600000}, function (ctx) { return host(ctx, true); });
})(typeof window !== 'undefined' ? window : globalThis);
