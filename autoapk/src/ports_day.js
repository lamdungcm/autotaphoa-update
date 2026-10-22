(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    function register(id, name, methods, options, handler) {
        P.register({id: id, name: name, group: 'Hằng ngày', desktop: methods, options: options || []}, handler);
    }
    function map(id, methods) {
        if (!api.tasks.some(function (task) { return task.id === id; })) throw new Error('Missing base task');
        methods.forEach(function (method) { if (P.desktop[method]) throw new Error('Duplicate mapping'); P.desktop[method] = id; });
    }
    map('mail_rewards', ['action_claim_mail']);
    map('daily_signin', ['action_daily_checkin']);
    map('mua_vu_ban_ron', ['action_mua_vu_ban_ron']);
    map('shop_free_gifts', ['action_shop_free_gift']);
    map('guild_likes', ['action_guild_like']);
    register('county_limited', 'Quà ưu đãi miễn phí', ['action_county_limited'], [], function (ctx) {
        return api.fullClaims.freeShop(ctx, {activityTypes: [3], regular: false});
    });
    register('daily_claim_all', 'Nhận nhiệm vụ và mốc ngày', ['action_daily_quick_claim'], [], function (ctx) {
        return P.sequence(ctx, ['daily_task_rewards', 'daily_active_rewards']);
    });
    register('limited_gifts_all', 'Nhận quà hạn giờ', ['action_nhan_qua_han_gio'], [], function (ctx) {
        return P.sequence(ctx, ['county_limited', 'shop_free_gifts', 'limited_quests']);
    });
    register('mail_individual', 'Đọc thư và nhận quà từng thư', ['action_claim_individual_mails'], [P.boolOption('deleteRead', 'Xóa thư đã đọc, đã nhận hết quà', false)], async function (ctx) {
        var mgr = P.instance(ctx, 'MailMgr'), uids = P.list(mgr.getMailUidList()).slice(), count = 0;
        if (uids.length > 1000) throw new Error('Có quá nhiều thư, cần chia lượt xử lý');
        for (var i = 0; i < uids.length; i++) {
            ctx.check(); var uid = String(uids[i]), row = mgr.getMailData(uid); if (!row) continue;
            if (!row.isRead) {
                P.ret(await P.call(ctx, 'MailNetUtil', 'readMail', [uid, false]));
                // Native MailMgr applies this exact, UID-scoped ACK in the mail view.
                mgr.readMail(uid); count++;
            }
            row = mgr.getMailData(uid);
            if (row && !row.isGetReward && row.annexes) {
                P.ret(await P.call(ctx, 'MailNetUtil', 'getReward', [uid, false])); mgr.getRewardMail(uid); count++;
            }
            row = mgr.getMailData(uid);
            if (ctx.options.deleteRead && row && row.isRead && (row.isGetReward || !row.annexes)) {
                P.ret(await P.call(ctx, 'MailNetUtil', 'deleteMail', [uid, false])); mgr.deleteMail(uid); count++;
            }
        }
        return P.done(count, 'xử lý thư', 'Không có thư cần xử lý');
    });
    register('training', 'Vượt ải đào tạo', ['action_training'], [P.numOption('ticks', 'Số ải/bước tối đa', 4, 1000, 1)], async function (ctx) {
        var response = await P.packet(ctx, 'S_WORKSHOP_INFO', {}), data = P.fields(response, ['workshopData']).workshopData, count = 0;
        for (var i = 0; i < ctx.options.ticks; i++) {
            var before = String(data.workshopId) + ':' + String(data.sectionProgress), body = {isBackend: false};
            if (data.isBoss) { body.maxCashBuffTimes = 0; body.maxItemBuffTimes = 0; }
            var reply = await P.accept(ctx, data.isBoss ? 'S_WORKSHOP_BOSS_BATTLE' : 'S_WORKSHOP_UPGRADE', body);
            data = P.fields(reply, ['workshopData']).workshopData;
            if (String(data.workshopId) + ':' + String(data.sectionProgress) === before) throw new Error('Ải chưa tăng tiến độ');
            count++;
        }
        return P.done(count, 'vượt bước đào tạo');
    });
    register('visit_likes', 'Ghé thăm và like người chơi', ['action_visit_like'], [
        {key: 'targets', label: 'UID người nhận (cách nhau bởi dấu phẩy)', type: 'text', default: '', maxLength: 2000},
        P.numOption('serverId', 'Máy chủ (0 = hiện tại)', 0, 2147483647)
    ], async function (ctx) {
        var ids = ctx.options.targets.split(/[\s,;]+/).filter(Boolean).map(P.id).filter(function (id, i, all) { return id !== ctx.uid && all.indexOf(id) === i; });
        if (!ids.length) return P.skip('Chưa chọn người nhận like');
        var count = 0;
        for (var i = 0; i < ids.length; i++) {
            var response = await P.accept(ctx, 'S_LIKE_PLAYER', {userId: ids[i], serverId: ctx.options.serverId});
            if (!response.targetTempMsg || String(response.targetTempMsg.userId) !== ids[i] || !P.list(response.likePlayerIdSet).some(function (id) { return String(id) === ctx.uid; }))
                throw new Error('Máy chủ chưa xác nhận like đúng người');
            count++;
        }
        return P.done(count, 'like người chơi');
    });
    P.catalogs.shopGoodsLoader = function (ctx) {
        var db = ctx.require('DBUtil').DBUtil, rows = P.list(db.getShopList());
        return P.setCatalog(ctx, 'shopGoods', rows.filter(function (row) { return Number(row.isShow) === 1 && Number(row.rechargeId) === 0; }).map(function (row) {
            var goods = String(row.goods || '').split('=')[0], item = db.getItem(Number(goods));
            return {id: String(row.id), group: 'Tiệm ' + row.shopType, name: P.name(ctx, item && item.name) || P.name(ctx, row.name) || 'Vật phẩm ' + row.id,
                detail: 'Giá: ' + row.price + ' · Giới hạn: ' + row.buyLimit};
        }));
    };
    P.buyOrders = async function (ctx, orders) {
        var db = ctx.require('DBUtil').DBUtil, mgr = P.instance(ctx, 'ShopMgr'), total = 0;
        for (var i = 0; i < orders.length; i++) {
            var order = orders[i], row = db.getShop(order.id);
            if (!row || Number(row.isShow) !== 1 || Number(row.rechargeId) !== 0 || row.price == null) throw new Error('Vật phẩm không còn bán trong tiệm bằng tài nguyên game');
            var bought = P.integer(mgr.getShopBuyGoodsCount(order.id)), limit = P.integer(row.buyLimit, -1);
            var count = limit < 0 ? order.count : Math.min(order.count, Math.max(0, limit - bought));
            if (!count) continue;
            var reply = P.ret(await P.call(ctx, 'ShopNetUtil', 'buyGoods', [order.id, count, false]));
            if (Number(reply.shopGoodsId) !== order.id || Number(reply.count) !== count || !P.reward(reply, 'goodsDeatil')) throw new Error('Kết quả mua không khớp vật phẩm và số lượng');
            total += count;
        }
        return P.done(total, 'mua vật phẩm', 'Các vật phẩm đã hết lượt mua');
    };
    register('quick_buy', 'Mua nhanh nhiều tiệm', ['action_quick_buy', 'action_quick_buy_shop', 'action_buy_shop_item'], [
        {key: 'orders', label: 'Danh sách vật phẩm và số lượng', type: 'orders', catalog: 'shopGoods', default: []}
    ], function (ctx) { return ctx.options.orders.length ? P.buyOrders(ctx, ctx.options.orders) : Promise.resolve(P.skip('Chưa cấu hình vật phẩm cần mua')); });
    register('billionaire_shop', 'Tiệm Ai là tỷ phú', ['action_billionaire_shop'], [P.numOption('count', 'Số lượng mỗi vật phẩm tối đa', 5, 1000)], function (ctx) {
        return P.buyOrders(ctx, [{id: 1060101038, count: ctx.options.count}, {id: 1060110056, count: ctx.options.count}]);
    });
    register('cinema_quiz', 'Rạp phim: doanh thu và trắc nghiệm', ['action_cinema_quiz'], [P.numOption('rounds', 'Số lượt thi tối đa', 2, 2)], async function (ctx) {
        var income = await P.accept(ctx, 'S_VIDEO_HALL_GET_RECEPTION_INCOME', {}), count = P.reward(income) ? 1 : 0;
        var rental = P.fields(await P.accept(ctx, 'S_VIDEO_HALL_RENTAL', {}), ['rental']).rental;
        var answers = api.quizAnswers;
        if (!answers) throw new Error('Chưa nạp ngân hàng đáp án rạp phim');
        for (var round = P.integer(rental.dayAskCount); round < ctx.options.rounds; round++) {
            ctx.check(); var customer = rental.rentalCustomer;
            if (!customer || !P.list(customer.question).length) customer = P.fields(await P.accept(ctx, 'S_VIDEO_HALL_RENTAL_ACCEPT', {}), ['rentalCustomer']).rentalCustomer;
            var questions = P.list(customer.question).slice().sort(function (a, b) { return Number(a.order) - Number(b.order); });
            if (!questions.length) throw new Error('Chưa nhận được đề thi');
            if (questions.some(function (q) { return answers[String(q.id)] !== 1 && answers[String(q.id)] !== 2; })) throw new Error('Gặp câu hỏi mới, cần cập nhật đáp án');
            var ended = false;
            for (var qi = 0; qi < questions.length; qi++) {
                var q = questions[qi]; if (Number(q.finishSecondTime) > 0) continue;
                var reply = await P.accept(ctx, 'S_VIDEO_HALL_RENTAL_ASK', {order: P.integer(q.order), answer: answers[String(q.id)]});
                if (reply.end === true) {
                    if (!reply.result || !P.reward(reply.result)) throw new Error('Chưa nhận được kết quả thi và phần thưởng');
                    ended = true; count++; break;
                }
            }
            rental = P.fields(await P.accept(ctx, 'S_VIDEO_HALL_RENTAL', {}), ['rental']).rental;
            if (!ended || Number(rental.dayAskCount) <= round) throw new Error('Máy chủ chưa xác nhận lượt thi đã xong');
        }
        return P.done(count, 'nhận doanh thu/lượt thi rạp phim');
    });
})(typeof window !== 'undefined' ? window : globalThis);
