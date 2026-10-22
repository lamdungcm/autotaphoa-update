/* Daily claims. Provenance and exact native response fields: FEATURES_20261022.md.
 * All choices come from the current game's models, DB and native server replies.
 */
(function (root) {
    'use strict';
    var api = root.AutoAPK;
    if (!api || typeof api.registerTask !== 'function') throw new Error('AutoAPK runtime missing');

    function integer(value, minimum) {
        return (typeof value === 'number' || typeof value === 'string') && value !== '' &&
            Number.isSafeInteger(Number(value)) && Number(value) >= minimum;
    }
    function ok(response, message) {
        if (!response || response.ret !== 0) throw new Error(message);
        return response;
    }
    function result(count, unit, empty) {
        return {status: count ? 'success' : 'already_done', message: count ? 'Đã nhận ' + count + ' ' + unit : empty};
    }
    async function call(ctx, module, method, args) {
        ctx.check();
        var response = await ctx.call(module, module, method, args || [], {timeoutMs: 12000});
        ctx.check();
        return response;
    }
    async function claimTasks(ctx, typeKey, unit) {
        ctx.check();
        var mgr = ctx.require('TaskMgr').TaskMgr.inst, config = ctx.require('TaskConfig');
        var db = ctx.require('DBUtil').DBUtil, model = mgr.model;
        var type = config.TaskConfig[typeKey], states = config.EnumTaskState;
        if (!model || !model.taskDict || !integer(type, 1) || !states ||
                states.unReceived !== 0 || states.received !== 1) throw new Error('Dữ liệu nhiệm vụ chưa sẵn sàng');
        var ids = [], seen = {};
        Object.keys(model.taskDict).forEach(function (key) {
            var row = model.taskDict[key];
            if (!row || !integer(row.taskId, 1)) return;
            var id = Number(row.taskId), definition = db.getTask(id);
            if (!definition || Number(definition.type) !== Number(type) || row.state !== states.unReceived) return;
            var info = mgr.getTaskInfo(id);
            if (info && info.isComplete === true && !seen[id]) { seen[id] = true; ids.push(id); }
        });
        if (ids.length > 256) throw new Error('Có quá nhiều nhiệm vụ, cần chia lượt nhận thưởng');
        var claimed = 0;
        for (var i = 0; i < ids.length; i += 64) {
            ctx.check();
            var batch = ids.slice(i, i + 64).filter(function (id) {
                var current = mgr.getTaskData(id), info = mgr.getTaskInfo(id);
                return current && current.state === states.unReceived && info && info.isComplete === true;
            });
            if (!batch.length) continue;
            var response = ok(await call(ctx, 'TaskNetUtil', 'getRewardOneKey', [batch]), 'Máy chủ chưa xác nhận nhận thưởng nhiệm vụ');
            if (!Array.isArray(response.taskId) || typeof response.reward !== 'string' || !response.reward.trim())
                throw new Error('Không đọc được danh sách nhiệm vụ đã nhận thưởng');
            var confirmed = response.taskId.map(Number);
            if (confirmed.some(function (id, index) {
                return !integer(id, 1) || batch.indexOf(id) < 0 || confirmed.indexOf(id) !== index;
            })) throw new Error('Kết quả nhận thưởng không khớp nhiệm vụ đã chọn');
            // Only explicit IDs in the typed server receipt may update client state.
            confirmed.forEach(function (id) { mgr.completeTask(id); });
            claimed += confirmed.length;
            if (confirmed.length !== batch.length) throw new Error('Máy chủ mới xác nhận một phần nhiệm vụ');
        }
        return result(claimed, unit, 'Chưa có thưởng nhiệm vụ đủ điều kiện để nhận');
    }
    async function claimActive(ctx) {
        ctx.check();
        var mgr = ctx.require('TaskMgr').TaskMgr.inst, model = mgr.model;
        if (!model || !integer(model.taskActive, 0) || !Array.isArray(model.rewardIndexList) ||
                !Array.isArray(model.configDailyTaskActivityRequire) || !model.configDailyTaskActivityRequire.length)
            throw new Error('Dữ liệu mốc hoạt động chưa sẵn sàng');
        var thresholds = model.configDailyTaskActivityRequire.slice();
        if (thresholds.length > 32 || thresholds.some(function (n) { return !integer(n, 1); }))
            throw new Error('Không đọc được điều kiện mốc hoạt động');
        thresholds = thresholds.map(Number).filter(function (n, i, a) { return a.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
        var claimed = 0;
        for (var i = 0; i < thresholds.length; i++) {
            ctx.check();
            var threshold = thresholds[i];
            model = mgr.model;
            if (!integer(model.taskActive, 0) || !Array.isArray(model.rewardIndexList)) throw new Error('Dữ liệu hoạt động đã thay đổi');
            if (Number(model.taskActive) < threshold || model.rewardIndexList.indexOf(threshold) >= 0) continue;
            ok(await call(ctx, 'TaskNetUtil', 'getActiveReward', [threshold]), 'Máy chủ chưa xác nhận nhận mốc hoạt động');
            // This native reply contains only ret. Require the separate TaskActiveMsg push.
            await ctx.waitFor(function () {
                return Array.isArray(mgr.model.rewardIndexList) && mgr.model.rewardIndexList.indexOf(threshold) >= 0;
            }, {timeoutMs: 3000, message: 'Máy chủ chưa cập nhật mốc hoạt động đã nhận'});
            claimed++;
        }
        return result(claimed, 'mốc hoạt động', 'Chưa có mốc hoạt động để nhận');
    }
    function guildSelf(data, ownUid, guildId) {
        if (!data || data.unionUid !== guildId || !Array.isArray(data.memberList))
            throw new Error('Không đọc được dữ liệu công hội hiện tại');
        var self = data.memberList.filter(function (row) { return String(row.userId) === ownUid; })[0];
        if (!self || !Array.isArray(self.thumpUpTargetPlayerId)) throw new Error('Không đọc được lượt like công hội');
        return self;
    }
    async function guildLikes(ctx) {
        ctx.check();
        var base = ctx.require('PlayerMgr').PlayerMgr.inst.model.playerBaseData;
        if (!base || typeof base.unionUid !== 'string') throw new Error('Dữ liệu công hội chưa sẵn sàng');
        if (!base.unionUid) return {status: 'skipped', message: 'Nhân vật chưa tham gia công hội'};
        var guildId = base.unionUid, data = await call(ctx, 'GuildNetUtil', 'getUnionDetail');
        var self = guildSelf(data, String(ctx.uid), guildId), seen = {};
        var targets = data.memberList.filter(function (row) {
            var id = String(row.userId);
            if (id === String(ctx.uid) || seen[id] || !integer(row.position, 1) || Number(row.position) > 3) return false;
            seen[id] = true;
            return self.thumpUpTargetPlayerId.map(String).indexOf(id) < 0;
        }).sort(function (a, b) { return Number(a.position) - Number(b.position); });
        if (targets.length > 32) throw new Error('Danh sách cán sự công hội cần kiểm tra lại');
        var liked = 0;
        for (var i = 0; i < targets.length; i++) {
            ctx.check();
            if (ctx.require('PlayerMgr').PlayerMgr.inst.model.playerBaseData.unionUid !== guildId)
                throw new Error('Công hội đã thay đổi, auto đã dừng');
            var id = String(targets[i].userId);
            if (!integer(id, 1)) throw new Error('Không xác nhận được cán sự công hội');
            var currentTarget = data.memberList.filter(function (row) { return String(row.userId) === id; })[0];
            if (!currentTarget || !integer(currentTarget.position, 1) || Number(currentTarget.position) > 3) continue;
            if (self.thumpUpTargetPlayerId.map(String).indexOf(id) >= 0) continue;
            var response = ok(await call(ctx, 'GuildNetUtil', 'guildClickLikeHuman', [Number(id)]), 'Chưa thể like cán sự công hội');
            if (!integer(response.likeNum, 1) || typeof response.rewards !== 'string')
                throw new Error('Không đọc được kết quả like công hội');
            data = await call(ctx, 'GuildNetUtil', 'getUnionDetail');
            self = guildSelf(data, String(ctx.uid), guildId);
            if (self.thumpUpTargetPlayerId.map(String).indexOf(id) < 0)
                throw new Error('Máy chủ chưa xác nhận cán sự vừa like');
            liked++;
        }
        return {status: liked ? 'success' : 'already_done',
            message: liked ? 'Đã like ' + liked + ' cán sự công hội' : 'Không còn cán sự công hội cần like'};
    }
    function giftActivity(ctx, id, allowedTypes) {
        var model = ctx.require('ActivityMgr').ActivityMgr.inst.model;
        if (!model || !model.activityDict) throw new Error('Dữ liệu gói ưu đãi chưa sẵn sàng');
        var act = model.activityDict[id], info = (act || {}).info || {};
        if (!act || (allowedTypes || [20]).indexOf(Number(act.type || act.activityType || info.activityType)) < 0 ||
                Number(act.state == null ? info.state : act.state) !== 2 || typeof act.getMallList !== 'function') return null;
        return act;
    }
    function freeShopRow(ctx, entry) {
        var id = entry.id;
        var row = ctx.require('DBUtil').DBUtil.getShop(id);
        // Missing/empty prices never mean free. Exclude recharge, escalating prices,
        // unrelated event shops, hidden goods and unlimited offers.
        if (entry.activityId) {
            var act = giftActivity(ctx, entry.activityId, entry.allowedTypes);
            var mall = act && act.getMallList().filter(function (m) { return Number(m.mallId) === id; })[0];
            if (!mall || !row || row.price !== mall.price || Number(row.rechargeId) !== Number(mall.rechargeId || 0) ||
                    Number(row.shopType) !== Number(mall.shopType)) return null;
        } else if (!row || Number(row.shopType) !== entry.shopType) return null;
        if (!row || !integer(row.isShow, 1) ||
                !integer(row.rechargeId, 0) || Number(row.rechargeId) !== 0 ||
                !(row.price === 0 || row.price === '0') || !integer(row.priceAdd, 0) || Number(row.priceAdd) !== 0 ||
                !integer(row.buyLimit, 1) || !integer(row.vipLimit, 0)) return null;
        if (Number(row.vipLimit) > 0) {
            var vip = ctx.require('VipMgr').VipMgr.inst.getVipLevel();
            if (!integer(vip, 0) || Number(vip) < Number(row.vipLimit)) return null;
        }
        return row;
    }
    async function freeShop(ctx, options) {
        ctx.check();
        options = options || {};
        var allowedTypes = options.activityTypes || [20];
        var type = ctx.require('ShopConfig').ShopConfig.SHOP_TYPE_1, mgr = ctx.require('ShopMgr').ShopMgr.inst;
        if (!integer(type, 1) || !mgr.model || !mgr.model.shopGoodsInfoDict) throw new Error('Dữ liệu tiệm chưa sẵn sàng');
        type = Number(type);
        var response = options.regular === false ? {shopType: type, shopGoodsList: []} :
            ok(await call(ctx, 'ShopNetUtil', 'getGoodsList', [type]), 'Không đọc được danh sách quà trong tiệm');
        if (Number(response.shopType) !== type || !Array.isArray(response.shopGoodsList)) throw new Error('Danh sách tiệm không khớp');
        var ids = response.shopGoodsList.filter(function (id, i, a) { return integer(id, 1) && a.indexOf(id) === i; });
        var entries = ids.map(function (id) { return {id: Number(id), shopType: type}; });
        var activities = ctx.require('ActivityMgr').ActivityMgr.inst.model.activityDict;
        if (!activities) throw new Error('Dữ liệu gói ưu đãi chưa sẵn sàng');
        Object.keys(activities).forEach(function (id) {
            var act = giftActivity(ctx, id, allowedTypes);
            if (!act) return;
            var malls = act.getMallList();
            if (!Array.isArray(malls)) throw new Error('Không đọc được gói ưu đãi trong tiệm');
            malls.forEach(function (mall) {
                if (mall && integer(mall.mallId, 1)) entries.push({id: Number(mall.mallId), activityId: id, allowedTypes: allowedTypes});
            });
        });
        var eligible = entries.filter(function (entry) { return !!freeShopRow(ctx, entry); }).filter(function (entry, i, a) {
            return a.findIndex(function (item) { return item.id === entry.id; }) === i;
        });
        if (eligible.length > 32) throw new Error('Có quá nhiều gói quà, cần kiểm tra lại tiệm');
        var claimed = 0;
        for (var i = 0; i < eligible.length; i++) {
            ctx.check();
            var id = eligible[i].id, row = freeShopRow(ctx, eligible[i]), bought = mgr.getShopBuyGoodsCount(id);
            if (!row) continue;
            if (!integer(bought, 0)) throw new Error('Không đọc được số lượt nhận quà trong tiệm');
            if (Number(bought) >= Number(row.buyLimit)) continue;
            var receipt = ok(await call(ctx, 'ShopNetUtil', 'buyGoods', [id, 1]), 'Máy chủ chưa xác nhận nhận quà miễn phí');
            if (Number(receipt.shopGoodsId) !== id || receipt.count !== 1 || typeof receipt.goodsDeatil !== 'string' || !receipt.goodsDeatil.trim())
                throw new Error('Kết quả nhận quà trong tiệm chưa đầy đủ');
            // Each visible, explicitly free offer is claimed once per run, as in ShopMgr.buy.
            claimed++;
        }
        return result(claimed, 'gói quà miễn phí', 'Không có gói quà miễn phí đủ điều kiện');
    }

    api.fullClaims = {freeShop: freeShop};
    api.registerTask({id: 'shop_free_gifts', name: 'Quà miễn phí trong tiệm', run: freeShop});
    api.registerTask({id: 'guild_likes', name: 'Like công hội', run: guildLikes});
    api.registerTask({id: 'daily_task_rewards', name: 'Thưởng nhiệm vụ ngày', run: function (ctx) { return claimTasks(ctx, 'TASK_TYPE_1', 'thưởng nhiệm vụ ngày'); }});
    api.registerTask({id: 'daily_active_rewards', name: 'Mốc hoạt động ngày', run: claimActive});
    api.registerTask({id: 'achievement_rewards', name: 'Thưởng thành tựu', run: function (ctx) { return claimTasks(ctx, 'TASK_TYPE_3', 'thưởng thành tựu'); }});
})(typeof window !== 'undefined' ? window : globalThis);
