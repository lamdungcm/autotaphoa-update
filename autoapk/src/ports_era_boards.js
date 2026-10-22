/* Native reference: current script_index_decompressed.js, ActivityTopEraStage1*,
 * SugarPaintingStall*, ActivityWuzetian*. No coordinates or guessed opcodes.
 * Native NetUtil methods return their typed response; local ACK counters are
 * deliberately not used as evidence of a completed operation. */
(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    function matching(reply, id) {
        P.ret(reply);
        if (Number(reply.activityId) !== id) throw new Error('Phản hồi không khớp sự kiện đang chạy');
        return reply;
    }
    function ints(values) { return P.list(values).map(function (v) { return P.integer(v); }); }
    function signature(value) { return JSON.stringify(value); }
    function topSignature(state) { return signature({power: state.power, topEra: state.topEra, buff: state.buff, event: state.event, killer: state.killer}); }
    P.register({id: 'dinh_cao_thoi_gian', name: 'Đỉnh cao thời gian', group: 'Sự kiện', desktop: ['action_dinh_cao_thoi_gian'], options: [
        P.numOption('limit', 'Số lượt khám phá tối đa', 60, 1000, 1), P.boolOption('upgrade', 'Nâng quân đội, nghiên cứu và thăng thời đại', true),
        {key: 'eventChoice', label: 'Chọn nhánh khi có hai lựa chọn', type: 'choice', default: '0', choices: [{id: '0', name: 'Nhánh đầu'}, {id: '1', name: 'Nhánh sau'}]},
        P.numOption('reviveWaitSeconds', 'Chờ hồi sinh tự nhiên tối đa (giây)', 120, 600)
    ], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1071], ['đỉnh cao thời gian', 'dinh cao thoi gian']);
        if (!act) return P.skip('Đỉnh cao thời gian chưa mở');
        var id = P.activityId(act), manager = P.instance(ctx, 'ActivityTopEraMgr'), stage = P.instance(ctx, 'ActivityTopEraStage1Mgr');
        var config = P.ret(await P.accept(ctx, 'S_TOP_ERA_CONFIG', {activityId: id}));
        manager.model.getTopEraData(id).syncConfig(config);
        var data = stage.model.getTopEraData(id); data.syncConfig(config);
        var util = ctx.require('ActivityTopEraStage1Utils').ActivityTopEraStage1Utils;
        var rewards = await P.claimEventFree(ctx, act, []) + await P.claimActivity(ctx, act), explored = 0, upgrades = 0, handled = 0;
        if (!util.isStage1ToStart(act, false)) return P.done(rewards, 'nhận thưởng', 'Giai đoạn xây dựng hiện chưa mở');
        async function read() {
            var r = P.ret(await P.call(ctx, 'ActivityTopEraStage1NetUtils', 'getInfo', [id, false]));
            P.fields(r, ['power', 'topEra', 'event', 'buff']); P.integer(r.power); P.integer(r.topEra.era, 1); P.list(r.event); P.list(r.buff);
            data.syncInfo(r); return r;
        }
        var state = await read(), pending = state.event;
        async function verifyChange(before, reply, label) {
            state = await read();
            if (topSignature(state) === before && !(typeof reply.reward === 'string' && reply.reward.trim()))
                throw new Error(label + ': máy chủ chưa xác nhận thay đổi');
        }
        async function resolve(events) {
            if (!events.length) return;
            var event = events[0], choiceResult = null;
            if (events.length > 1) {
                event = events[Math.min(Number(ctx.options.eventChoice), events.length - 1)];
                var before = topSignature(state);
                choiceResult = P.ret(await P.call(ctx, 'ActivityTopEraStage1NetUtils', 'getTopEraChooseEvent', [id, P.integer(event.idx), false]));
                P.fields(choiceResult, ['event']);
                if (Number(choiceResult.event.eventId) !== Number(event.eventId)) throw new Error('Sự kiện được chọn không khớp bảng máy chủ');
                event = choiceResult.event; await verifyChange(before, choiceResult, 'Chọn sự kiện'); handled++;
            }
            var cfg = data.getEventConfig(P.integer(event.eventId, 1));
            if (!cfg) throw new Error('Game chưa có cấu hình sự kiện khám phá');
            var type = P.integer(cfg.eventType, 1), option = Number(ctx.options.eventChoice);
            if ([1, 2, 3].indexOf(type) >= 0 || ([4, 5].indexOf(type) >= 0 && choiceResult)) return;
            if ([4, 5, 6, 7, 8].indexOf(type) < 0) throw new Error('Loại sự kiện khám phá chưa được hỗ trợ');
            if ([6, 7].indexOf(type) >= 0) {
                var params = String(cfg.param || '').split('|').filter(Boolean);
                if (type === 6 && !params[option]) throw new Error('Nhánh thưởng được chọn không có trong cấu hình');
            }
            // Native UI uses option 0 for combat and quitting a gambling event.
            // Quitting preserves energy rather than repeatedly paying to open it.
            if ([4, 5, 8].indexOf(type) >= 0) option = 0;
            before = topSignature(state);
            var reply = P.ret(await P.call(ctx, 'ActivityTopEraStage1NetUtils', 'getHandleEvent', [id, option, false]));
            await verifyChange(before, reply, 'Xử lý sự kiện'); handled++;
        }
        async function upgrade() {
            if (!ctx.options.upgrade) return;
            for (var i = 0; i < 300; i++) {
                ctx.check(); var before, reply;
                var armyConfig = data.getArmyConfig(), nextArmy = armyConfig && data.getArmyConfig(Number(armyConfig.id) + 1);
                if (nextArmy && util.checkEraArmy(data)) {
                    var army = data.getArmyConfig(), item = P.integer(data.configData.configArmyUpgradeItemId, 1), cost = P.integer(army.cost);
                    if (P.bag(ctx, item) < cost) throw new Error('Vật phẩm nâng quân đội chưa đồng bộ');
                    before = P.integer(state.topEra.armyLev);
                    reply = P.ret(await P.call(ctx, 'ActivityTopEraStage1NetUtils', 'getArmyUpgrade', [id, false]));
                    state = await read(); if (P.integer(state.topEra.armyLev) <= before) throw new Error('Cấp quân đội chưa tăng');
                } else if (util.checkEraTechnology(data)) {
                    var techItem = P.integer(data.configData.configTechnologyItemId, 1), need = P.integer(data.configData.configTechnologyDrawNeedNumber, 1);
                    before = signature(state.topEra.technology);
                    reply = await P.spendItem(ctx, techItem, need, function () { return P.call(ctx, 'ActivityTopEraStage1NetUtils', 'getTechnologyDraw', [id, 1, false]); });
                    if (!reply) break; state = await read();
                    if (signature(state.topEra.technology) === before && !P.reward(reply)) throw new Error('Chưa xác nhận kết quả nghiên cứu');
                } else if (util.checkEraPromote(data, false)) {
                    before = P.integer(state.topEra.era, 1);
                    P.ret(await P.call(ctx, 'ActivityTopEraStage1NetUtils', 'getPromotionEra', [id, false]));
                    state = await read(); if (P.integer(state.topEra.era, 1) <= before) throw new Error('Thời đại chưa thăng cấp');
                } else return;
                upgrades++;
            }
            throw new Error('Nâng cấp đã tới giới hạn an toàn; cần chạy tiếp');
        }
        await resolve(pending); await upgrade();
        while (explored < ctx.options.limit && util.isStage1ToStart(act, false)) {
            ctx.check();
            if (state.killer) {
                var era = data.getEraConfig(), time = ctx.require('TimeUtil').TimeUtil;
                var wait = Math.ceil((P.number(state.killer.at) + 1000 * P.number(era.resurrection) - time.getServerTimeMs()) / 1000);
                if (wait > ctx.options.reviveWaitSeconds) break;
                if (wait > 0) { ctx.log('Đang chờ hồi sinh tự nhiên (' + wait + ' giây)'); await ctx.sleep(wait * 1000 + 1000); }
                state = await read(); if (state.killer) throw new Error('Nhân vật sự kiện chưa hồi sinh');
            }
            var energy = P.integer(data.getEraConfig().energy, 1), power = P.integer(state.power);
            if (power < energy) break;
            var searched = P.ret(await P.call(ctx, 'ActivityTopEraStage1NetUtils', 'getSearch', [id, false]));
            P.fields(searched, ['power', 'events', 'topEra']);
            if (P.integer(searched.power) > power - energy) throw new Error('Thể lực chưa xác nhận lượt khám phá');
            P.list(searched.events); data.syncSearch(searched); state = await read(); explored++;
            await resolve(searched.events); await upgrade();
        }
        rewards += await P.claimActivity(ctx, act);
        var result = P.done(explored + handled + upgrades + rewards, 'khám phá ' + explored + ' lượt, xử lý ' + handled + ' sự kiện, nâng ' + upgrades + ' cấp, nhận ' + rewards + ' mốc', 'Không còn lượt đủ thể lực hoặc thưởng đủ điều kiện');
        if (state.killer) result.message += ' · Đang chờ hồi sinh tự nhiên';
        else if (explored >= ctx.options.limit && Number(state.power) > 0) result.message += ' · Đã tới giới hạn lượt cấu hình';
        return result;
    });
    function rareRewards(ctx, act) {
        return P.list(act.getConfigStringList('LUCKY_DRAW_RARE_REWARD')).map(function (entry, i) {
            var parts = String(entry).split('='), id = P.integer(parts[0], 1), name = '';
            try { name = ctx.require('SugarPaintingStallUtil').SugarPaintingStallUtil.getItemStatic(id).name; } catch (_) {}
            return {id: id, index: i, name: name ? P.name(ctx, name) : 'Phần thưởng ' + (i + 1)};
        });
    }
    P.catalogs.sugarRareRewardsLoader = function (ctx) {
        var act = P.findActivity(ctx, [1011], ['quầy tranh', 'tranh đường', 'quay tranh']);
        return P.setCatalog(ctx, 'sugarRareRewards', act ? rareRewards(ctx, act) : []);
    };
    P.register({id: 'quay_tranh_duong', name: 'Quầy tranh đường', group: 'Sự kiện', desktop: ['action_quay_tranh_duong'], options: [
        P.numOption('limit', 'Số lượt mở tranh / quay tối đa', 300, 5000, 1), P.idsOption('rareRewards', 'Ưu tiên thưởng hiếm (trống: theo bảng game)', 'sugarRareRewards')
    ], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1011], ['quầy tranh', 'tranh đường', 'quay tranh']);
        if (!act) return P.skip('Quầy tranh đường chưa mở');
        var id = P.activityId(act), mgr = P.instance(ctx, 'SugarPaintingStallMgr'), used = 0, rewards = await P.claimEventFree(ctx, act, []);
        rewards += await P.claimActivity(ctx, act);
        var config = matching(await P.call(ctx, 'SugarPaintingStallNetUtil', 'sendSugarPaintStallConfigReqMsg', [id, false]), id);
        var milestones = P.list(config.dotGridConfig); P.list(config.luckyDrawConfig); mgr.syncSugarPaintStallConfigRespMsg(config);
        // Native isGetLastGainReward defines the complete board by the largest
        // gridNumber in the server's progress configuration.
        var maxProgress = milestones.reduce(function (n, m) { return Math.max(n, P.integer(m.gridNumber, 1)); }, 0);
        var gridCount = P.integer(maxProgress, 1), gridItem = P.integer(act.getConfigNumber('DOT_GRID_ITEM_ID'), 1), ticket = P.integer(act.getConfigNumber('LUCKY_DRAW_ITEM_ID'), 1);
        if (gridCount > 10000 || !milestones.length || milestones.some(function (r) { return P.integer(r.gridNumber, 1) > gridCount; })) throw new Error('Cấu hình số ô tranh chưa hợp lệ');
        async function read() {
            var r = matching(await P.call(ctx, 'SugarPaintingStallNetUtil', 'sendSugarPaintStallInfoReqMsg', [id, false]), id);
            var cells = ints(r.clickGirdIds); ints(r.gainedProgressRewardIds); P.integer(r.score); P.integer(r.round); P.integer(r.rareRewardId, -1);
            if (cells.some(function (cell, index) { return cell < 1 || cell > gridCount || cells.indexOf(cell) !== index; })) throw new Error('Danh sách ô tranh đã mở không hợp lệ');
            mgr.syncSugarPaintStallInfoRespMsg(r); return r;
        }
        var state = await read();
        async function claimProgress() {
            var before = ints(state.gainedProgressRewardIds), eligible = milestones.filter(function (m) { return state.clickGirdIds.length >= Number(m.gridNumber) && before.indexOf(Number(m.id)) < 0; }).map(function (m) { return P.integer(m.id, 1); });
            if (!eligible.length) return;
            var r = matching(await P.call(ctx, 'SugarPaintingStallNetUtil', 'sendSugarPaintStallOneKeyProgressRewardReqMsg', [id, false]), id), ids = ints(r.gainedProgressRewardIds);
            if (!ids.length || !P.reward(r) || ids.some(function (v) { return eligible.indexOf(v) < 0; })) throw new Error('Thưởng tiến độ tranh chưa được xác nhận');
            state = await read();
            if (ids.some(function (v) { return state.gainedProgressRewardIds.indexOf(v) < 0; })) throw new Error('Mốc tranh chưa được lưu trên máy chủ');
            rewards += ids.length;
        }
        await claimProgress();
        for (var cell = 1; cell <= gridCount && used < ctx.options.limit && P.bag(ctx, gridItem) > 0; cell++) {
            if (state.clickGirdIds.indexOf(cell) >= 0) continue;
            var previous = ints(state.clickGirdIds);
            var opened = await P.spendItem(ctx, gridItem, 1, function () { return P.call(ctx, 'SugarPaintingStallNetUtil', 'sendSugarPaintStallClickGridReqMsg', [id, cell, false]); });
            matching(opened, id); var confirmed = ints(opened.clickGirdIds);
            if (confirmed.indexOf(cell) < 0 || previous.some(function (v) { return confirmed.indexOf(v) < 0; })) throw new Error('Ô tranh vừa mở chưa được xác nhận');
            state = await read(); if (state.clickGirdIds.indexOf(cell) < 0) throw new Error('Ô tranh chưa được lưu trên máy chủ');
            used++; await claimProgress();
        }
        var util = ctx.require('SugarPaintingStallUtil').SugarPaintingStallUtil;
        while (used < ctx.options.limit && P.bag(ctx, ticket) > 0) {
            if (Number(state.rareRewardId) < 1) {
                var choices = rareRewards(ctx, act).filter(function (row) {
                    return Number(state.round) >= Number(util.getRoundConfig(act, row.index)) && Number(mgr.getRareRewardInfoCount(act, row.id, row.index)) > 0;
                });
                if (ctx.options.rareRewards.length) choices = choices.filter(function (row) { return ctx.options.rareRewards.map(String).indexOf(String(row.id)) >= 0; });
                if (!choices.length) throw new Error('Không có thưởng hiếm còn lượt theo lựa chọn; chưa quay vé');
                choices.sort(function (a, b) { return ctx.options.rareRewards.map(String).indexOf(String(a.id)) - ctx.options.rareRewards.map(String).indexOf(String(b.id)) || a.index - b.index; });
                var chosen = choices[0].id, picked = matching(await P.call(ctx, 'SugarPaintingStallNetUtil', 'sendSugarPaintStallChooseLuckyDrawReqMsg', [id, chosen, false]), id);
                if (Number(picked.rareRewardId) !== chosen) throw new Error('Thưởng hiếm trả về không khớp lựa chọn');
                state = await read(); if (Number(state.rareRewardId) !== chosen) throw new Error('Lựa chọn thưởng hiếm chưa được lưu');
            }
            var available = P.bag(ctx, ticket), ten = P.integer(act.getConfigNumber('LUCKY_DRAW_TEN_TIMES_SCORE_NUM'));
            var batch = Number(state.score) >= ten ? Math.min(10, available, ctx.options.limit - used) : 1;
            var oldScore = P.integer(state.score), draw = await P.spendItem(ctx, ticket, batch, function () { return P.call(ctx, 'SugarPaintingStallNetUtil', 'sendSugarPaintStallDrawReqMsg', [id, batch, false]); });
            matching(draw, id);
            var drawnIds = ints(draw.drawRewardIds);
            if (Number(draw.drawCount) !== batch || (!drawnIds.length && !(Number(draw.rareRewardId) > 0)) ||
                drawnIds.some(function (rid) { return !config.luckyDrawConfig.some(function (row) { return Number(row.id) === rid; }); }) || Number(draw.score) <= oldScore)
                throw new Error('Lượt quay tranh chưa được xác nhận');
            state = await read(); if (Number(state.score) !== Number(draw.score)) throw new Error('Điểm quay tranh chưa khớp máy chủ');
            used += batch;
        }
        rewards += await P.claimActivity(ctx, act);
        var result = P.done(used + rewards, 'mở tranh / quay ' + used + ' lượt, nhận ' + rewards + ' mốc', 'Không có kẹo, vé hoặc thưởng đủ điều kiện');
        if (used >= ctx.options.limit) result.message += ' · Đã tới giới hạn cấu hình';
        return result;
    });
    P.register({id: 'than_do_bat_da', name: 'Thần đô bất dạ', group: 'Sự kiện', desktop: ['action_than_do_bat_da'], options: [
        P.numOption('rounds', 'Số vòng tối đa', 30, 100, 1), P.numOption('waitSeconds', 'Chờ kết thúc mỗi vòng tối đa (giây)', 180, 600, 10)
    ], timeoutMs: 3600000}, async function (ctx) {
        var act = P.findActivity(ctx, [1053], ['võ hậu', 'vo hau', 'khai quốc', 'wuzetian']);
        if (!act) return P.skip('Võ hậu khai quốc chưa mở');
        var id = P.activityId(act), mgr = P.instance(ctx, 'ActivityWuzetianMgr');
        if (!mgr.checkNightPartyOpen(act)) return P.skip('Thần đô bất dạ hiện ngoài giờ mở cửa');
        var config = matching(await P.call(ctx, 'ActivityWuzetianNetUtil', 'requestConfig', [id, false], 'activityWuzetianNetUtil'), id);
        mgr.model.getConfigData(id).syncConfig(config);
        var free = P.integer(ctx.require('ActivityWuzetianUtil').ActivityWuzetianUtil.getDailyFreeTimes(act), 1);
        var capacity = P.integer(act.getConfigNumber('WUZETIAN_NIGHT_SESSION_MAX_MINISTER'), 1), data = mgr.getActData(id), sent = 0, settled = 0, entered = false;
        async function read() {
            var info = P.ret(await P.call(ctx, 'ActivityWuzetianNetUtil', 'requestInfo', [id, false], 'activityWuzetianNetUtil'));
            if (!info.info || !P.list(info.info.minister).length) throw new Error('Chưa đọc được quan lại đã sở hữu');
            data.syncInfo(info);
            var scene = P.ret(await P.call(ctx, 'ActivityWuzetianNetUtil', 'enterNight', [id, false], 'activityWuzetianNetUtil'));
            entered = true; P.integer(scene.round); P.list(scene.dispatchList);
            data.nightSceneInfo.clear(); data.nightSceneInfo.onEnterScene(scene);
            return {info: info, scene: scene};
        }
        function ownedDispatch(scene) {
            return P.list(scene.dispatchList).filter(function (row) { return row.playerInfo && String(row.playerInfo.userId) === ctx.uid; }).map(function (row) { return P.integer(row.minister.id, 1); });
        }
        try {
            var state = await read();
            for (var pass = 0; pass < ctx.options.rounds && mgr.checkNightPartyOpen(act); pass++) {
                ctx.check(); var ministers = P.list(state.info.info.minister), current = P.integer(state.scene.round), already = ownedDispatch(state.scene);
                var remaining = ministers.filter(function (m) { return P.integer(m.nightFreeNum) < free; });
                if (!remaining.length && !already.length) break;
                var candidates = remaining.filter(function (m) { return already.indexOf(P.integer(m.id, 1)) < 0; }).slice(0, Math.max(0, capacity - already.length));
                if (candidates.length) {
                    var ids = candidates.map(function (m) { return P.integer(m.id, 1); }), counts = {};
                    candidates.forEach(function (m) { counts[m.id] = Number(m.nightFreeNum); });
                    P.ret(await P.call(ctx, 'ActivityWuzetianNetUtil', 'dispatch', [id, current, ids, false], 'activityWuzetianNetUtil'));
                    state = await read();
                    var dispatched = ownedDispatch(state.scene), freshMinisters = P.list(state.info.info.minister);
                    if (ids.some(function (mid) {
                        var m = freshMinisters.find(function (row) { return Number(row.id) === mid; });
                        return !m || Number(m.nightFreeNum) !== counts[mid] + 1 || (Number(state.scene.round) === current && dispatched.indexOf(mid) < 0);
                    })) throw new Error('Máy chủ chưa xác nhận quan lại đã phái; dừng để tránh đăng ký lặp');
                    sent += ids.length;
                    ctx.log('Đã phái ' + ids.length + ' quan lại bằng lượt miễn phí, vòng ' + current);
                }
                if (Number(state.scene.round) > current) { settled++; continue; }
                var advanced = false;
                for (var elapsed = 0; elapsed < ctx.options.waitSeconds; elapsed += 3) {
                    ctx.check(); await ctx.sleep(Math.min(3, ctx.options.waitSeconds - elapsed) * 1000);
                    if (!mgr.checkNightPartyOpen(act)) break;
                    state = await read();
                    if (Number(state.scene.round) > current) { advanced = true; settled++; break; }
                    if (Number(state.scene.round) < current) throw new Error('Vòng Thần đô trên máy chủ bị lùi');
                }
                if (!advanced) throw new Error('Vòng Thần đô chưa kết thúc trong thời gian chờ; không đăng ký lại');
            }
            var left = P.list(state.info.info.minister).reduce(function (sum, m) { return sum + Math.max(0, free - P.integer(m.nightFreeNum)); }, 0);
            var result = P.done(sent, 'phái ' + sent + ' lượt miễn phí, xác nhận kết thúc ' + settled + ' vòng', 'Các quan lại đã dùng hết lượt miễn phí');
            if (left) result.message += ' · Còn ' + left + ' lượt miễn phí (đã tới giới hạn vòng / giờ)';
            return result;
        } finally {
            ctx.check();
            if (entered) {
                P.ret(await P.call(ctx, 'ActivityWuzetianNetUtil', 'exitNight', [id, false], 'activityWuzetianNetUtil'));
                data.nightSceneInfo.onExitScene();
            }
        }
    });
})(typeof window !== 'undefined' ? window : globalThis);
