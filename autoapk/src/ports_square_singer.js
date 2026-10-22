(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    P.ownedHeroes = function (ctx) {
        var mgr = P.instance(ctx, 'HeroMgr');
        return P.list(mgr.getOwnHeroIdList()).map(function (id) { return P.integer(id, 1); }).sort(function (a, b) {
            return P.number(mgr.getFinalAbilityValue(b)) - P.number(mgr.getFinalAbilityValue(a));
        });
    };
    async function square(ctx, night) {
        function open() { var hour = P.vnClock().getUTCHours(); return night ? hour === 20 : hour >= 12 && hour < 14; }
        if (!open()) return P.skip(night ? 'Thương nhân phi pháp mở 20:00–21:00' : 'Đá gà mở 12:00–14:00');
        var mgr = P.instance(ctx, 'SquareMgr'), battles = 0, boxes = 0;
        var info = await P.call(ctx, 'SquareNetUtil', 'getActivityInfo', [false]);
        P.fields(info, ['actionId', 'noticeList']); mgr.synSquareActivityInfo(info);
        P.ret(await P.call(ctx, 'SquareNetUtil', 'enter', [false]));
        try {
            var ready = await P.call(ctx, 'SquareNetUtil', 'getReady', [false]); P.list(ready.actionHeroList);
            if (night) mgr.synActionHeroList(ready); else mgr.syncDayActionHeroList(ready);
            var heroes = P.ownedHeroes(ctx);
            for (var i = 0; i < heroes.length && battles < ctx.options.limit && open(); i++) {
                var hero = heroes[i], allowed = night ? mgr.isNightActionHeroIdle(hero) : mgr.isDayActionHeroIdle(hero);
                while (allowed && battles < ctx.options.limit && open()) {
                    var reply = P.ret(await P.call(ctx, 'SquareNetUtil', night ? 'startNightBattle' : 'startDayBattle', [hero, false]));
                    if (Number(reply.heroId) !== hero || (night ? reply.harmVal == null : reply.enemyHp == null)) throw new Error('Chưa xác nhận kết quả thi đấu đúng nhân tài');
                    if (night) mgr.synActionHero(hero); else mgr.syncDayActionHero(hero);
                    battles++; allowed = night ? mgr.isNightActionHeroIdle(hero) : mgr.isDayActionHeroIdle(hero);
                }
            }
            if (!night && open()) {
                info = await P.call(ctx, 'SquareNetUtil', 'getActivityInfo', [false]); P.list(info.noticeList);
                for (var j = 0; j < info.noticeList.length && open(); j++) {
                    var box = info.noticeList[j];
                    if (P.list(box.rewardedPlayerIds).some(function (uid) { return String(uid) === ctx.uid; })) continue;
                    var result = P.ret(await P.call(ctx, 'SquareNetUtil', 'getGiftBox', [P.id(box.id), false]));
                    if (!result.notice || String(result.notice.id) !== String(box.id) || !P.list(result.notice.rewardedPlayerIds).some(function (uid) { return String(uid) === ctx.uid; }) || !P.reward(result)) throw new Error('Hộp quà đá gà chưa xác nhận đã nhận');
                    boxes++;
                }
            }
        } finally { ctx.check(); P.ret(await P.call(ctx, 'SquareNetUtil', 'leave', [false])); }
        return P.done(battles + boxes, 'thi đấu ' + battles + ' lượt, nhận ' + boxes + ' hộp', 'Các nhân tài đã dùng hết lượt đủ điều kiện');
    }
    P.register({id: 'da_ga', name: 'Đá gà', group: 'Hằng ngày', desktop: ['action_da_ga'], options: [P.numOption('limit', 'Số trận tối đa', 500, 2000, 1)], timeoutMs: 1800000}, function (ctx) { return square(ctx, false); });
    P.register({id: 'thuong_nhan_phi_phap', name: 'Thương nhân phi pháp', group: 'Hằng ngày', desktop: ['action_thuong_nhan_phi_phap'], options: [P.numOption('limit', 'Số trận tối đa', 500, 2000, 1)], timeoutMs: 1800000}, function (ctx) { return square(ctx, true); });
    P.register({id: 'sieu_giong_hat', name: 'Siêu giọng hát: nhận và nâng cấp', group: 'Hằng ngày', desktop: ['action_sieu_giong_hat'],
        options: [P.boolOption('claim', 'Nhận thu nhập tích lũy', true), P.numOption('limit', 'Số cấp nội thất tối đa', 150, 2000), P.numOption('budget', 'Ngân sách xu giọng hát (0 = dùng số đang có)', 0, Number.MAX_SAFE_INTEGER)], timeoutMs: 1800000}, async function (ctx) {
        var mgr = P.instance(ctx, 'SingerMakerMgr'), model = mgr.model, util = ctx.require('SingerMakerUtil').singerMakerUtil;
        var cfg = ctx.require('SingerMakerConfig').SingerMakerConfig, nums = ctx.require('NumberUtil').NumberUtil;
        var data = P.ret(await P.call(ctx, 'SingerMakerNetUtil', 'data', [false], 'singerMakerNetUtil'));
        P.list(data.rooms); model.clearUpdater(); model.syncData(data);
        var claims = 0, upgrades = 0, spent = '0';
        if (ctx.options.claim && P.number(data.accumulateCoin) > 0) {
            var claim = P.ret(await P.call(ctx, 'SingerMakerNetUtil', 'reward', [false], 'singerMakerNetUtil'));
            if (!(Number(claim.lastRewardTime) > Number(data.lastRewardTime))) throw new Error('Chưa xác nhận mốc nhận thu nhập mới');
            model.clearUpdater(); model.syncReward(claim); claims++;
        }
        while (upgrades < ctx.options.limit) {
            var ids = [];
            P.list(util.getAllUnlockedSettingIds()).forEach(function (room) {
                P.list(util.getFurnitureIdsBySettingId(room)).forEach(function (id) {
                    var f = model.getFurnitureData(id);
                    if (f.isUnlock && !f.isMaxLevel && util.canUpgradeFurniture(id)) ids.push(id);
                });
            });
            ids.sort(function (a, b) { var ca = model.getFurnitureData(a).getUpgradeCostValue(), cb = model.getFurnitureData(b).getUpgradeCostValue(); return nums.isSmall(ca, cb) ? -1 : nums.isSame(ca, cb) ? Number(a) - Number(b) : 1; });
            if (!ids.length) break;
            var id = P.integer(ids[0], 1), furniture = model.getFurnitureData(id), before = P.integer(furniture.level), cost = furniture.getUpgradeCostValue();
            if (ctx.options.budget && !nums.isBigSame(String(ctx.options.budget), nums.add(spent, cost))) break;
            if (!nums.isBigSame(cost, '1')) throw new Error('Chi phí nâng cấp nội thất chưa hợp lệ');
            var wallet = String(P.instance(ctx, 'BagMgr').getOwnCount(cfg.ITEM_COIN_ID));
            var reply = P.ret(await P.call(ctx, 'SingerMakerNetUtil', 'levelUpFurniture', [P.integer(furniture.getStatic().settingId, 1), id, 1, false], 'singerMakerNetUtil'));
            if (!reply.room) throw new Error('Không có dữ liệu nội thất sau nâng cấp');
            model.clearUpdater(); model.syncSetting(reply.room); model.syncUpgraded(reply);
            if (P.integer(model.getFurnitureData(id).level) !== before + 1) throw new Error('Cấp nội thất chưa tăng đúng một cấp');
            spent = nums.add(spent, cost); upgrades++;
            // Require the native inventory push before another paid upgrade.
            await ctx.waitFor(function () { return nums.isSame(String(P.instance(ctx, 'BagMgr').getOwnCount(cfg.ITEM_COIN_ID)), nums.sub(wallet, cost)); }, {timeoutMs: 5000, message: 'Túi chưa xác nhận chi phí nâng nội thất; dừng để tránh chi lặp'});
        }
        return P.done(claims + upgrades, 'nhận thu nhập ' + claims + ' lần, nâng ' + upgrades + ' cấp', 'Chưa có thu nhập hoặc nội thất đủ điều kiện');
    });
    P.register({id: 'doi_tem_lay_do', name: 'Đổi tem lấy đồ', group: 'Sự kiện', desktop: ['action_doi_tem_lay_do'], options: [P.numOption('limit', 'Số tem tối đa', 100000, 1000000, 1)]}, async function (ctx) {
        var act = P.findActivity(ctx, [37], ['đổi tem', 'doi tem']); if (!act) return P.skip('Sự kiện đổi tem chưa mở');
        var claimed = await P.claimActivity(ctx, act), count = Math.min(P.bag(ctx, 120136), ctx.options.limit);
        if (count) {
            var before = P.bag(ctx, 120136);
            P.ret(await P.call(ctx, 'ActivityStampGiftNetUtil', 'reqUseActivityStamps', [P.activityId(act), count, false]));
            await ctx.waitFor(function () { return P.bag(ctx, 120136) === before - count; }, {timeoutMs: 5000, message: 'Túi chưa xác nhận số tem đã đổi; dừng để tránh đổi lặp'});
        }
        claimed += await P.claimActivity(ctx, act);
        return P.done(count + claimed, 'đổi ' + count + ' tem và nhận ' + claimed + ' mốc', 'Chưa có tem hoặc mốc thưởng đủ điều kiện');
    });
})(typeof window !== 'undefined' ? window : globalThis);
