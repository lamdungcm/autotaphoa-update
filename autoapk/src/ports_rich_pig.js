/* Rich rewards: bundled richQuickSecret/index.jsc model, native Fund/BattlePass.
 * PigPig: current PigPigGame/PigPigItem physics and typed NetUtil methods.
 * No client recharge flags, invented boards, scores or merge results are sent.
 */
(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    function util(ctx, module, name) { return ctx.require(module)[name || module]; }
    function digits(value) {
        if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Tiến độ lớn cần dữ liệu nguyên bản từ máy chủ');
        var text = String(value);
        if (!/^\d+$/.test(text)) throw new Error('Tiến độ phần thưởng chưa hợp lệ');
        return text.replace(/^0+(?=\d)/, '');
    }
    function atLeast(value, threshold) {
        var a = digits(value), b = digits(threshold);
        return a.length > b.length || a.length === b.length && a >= b;
    }
    function bit(value, index) {
        var text = digits(value), remainder = 0;
        for (var k = 0; k <= index; k++) {
            var next = ''; remainder = 0;
            for (var j = 0; j < text.length; j++) {
                var n = remainder * 10 + Number(text[j]); next += Math.floor(n / 2); remainder = n % 2;
            }
            text = next.replace(/^0+/, '') || '0';
        }
        return remainder === 1;
    }
    async function richInfo(ctx) {
        // This native message has no ret field; its typed cycle/mission data is the receipt.
        var reply = await P.packet(ctx, 'S_SECRET_INFO', {});
        P.fields(reply, ['cycleId', 'moduleMissionList']); P.list(reply.moduleMissionList);
        if (Number(reply.cycleId) > 0) P.fields(reply, ['giftPack', 'systemCycle']);
        return reply;
    }
    function richTargets(ctx, info, mission) {
        var db = util(ctx, 'DBUtil'), time = util(ctx, 'TimeUtil');
        var configs = P.list(db.getRichQuickSecretFundConfig()).filter(function (row) { return Number(row.templateId) === Number(mission.templateId); });
        var free = P.list(mission.freeReward), paid = P.list(mission.paidReward);
        var now = P.number(time.getServerTimeMs()), start = P.number(info.systemCycle.curStartTime);
        var day = Math.floor((P.number(time.getCurZeroTime(now / 1000)) - P.number(time.getCurZeroTime(start / 1000))) / 86400) + 1;
        var end = P.number(time.getCurZeroTime(start / 1000)) * 1000 + P.integer(db.getRichQuickSecretMainConfigById(info.cycleId).sustainedDay, 1) * 86400000;
        if (now >= end || day < 1) return [];
        return configs.filter(function (row) {
            var ready = Number(row.type) === 1 ? (Number(row.param) === day || Number(row.param) < day && bit(mission.value, P.integer(row.param, 1))) :
                Number(row.type) === 2 && atLeast(mission.value, row.param);
            return ready && (free.map(Number).indexOf(Number(row.id)) < 0 && String(row.freeReward || '').trim() ||
                mission.buy === true && paid.map(Number).indexOf(Number(row.id)) < 0 && String(row.payReward || '').trim());
        }).map(function (row) { return {id: P.integer(row.id, 1), free: free.map(Number).indexOf(Number(row.id)) < 0 && !!String(row.freeReward || '').trim(),
            paid: mission.buy === true && paid.map(Number).indexOf(Number(row.id)) < 0 && !!String(row.payReward || '').trim()}; });
    }
    async function richTasks(ctx, main) {
        var rows = P.list(util(ctx, 'TaskUtil').getRichQuickSecretTaskList()), mgr = P.instance(ctx, 'TaskMgr'), db = util(ctx, 'DBUtil');
        var state = ctx.require('TaskConfig').EnumTaskState, ids = [];
        rows.forEach(function (row) {
            var definition = db.getTask(row.taskId), progress = mgr.getTaskInfo(row.taskId);
            if (definition && Number(definition.littleType) === Number(main.taskAndRewardId) && row.state === state.unReceived && progress && progress.isComplete === true)
                ids.push(P.integer(row.taskId, 1));
        });
        ids = ids.filter(function (id, index) { return ids.indexOf(id) === index; });
        if (ids.length > 256) throw new Error('Danh sách nhiệm vụ Bí Kíp vượt giới hạn lượt nhận');
        for (var i = 0; i < ids.length; i += 64) {
            var batch = ids.slice(i, i + 64), reply = P.ret(await P.call(ctx, 'TaskNetUtil', 'getRewardOneKey', [batch]));
            var accepted = P.list(reply.taskId).map(Number);
            if (!P.reward(reply) || accepted.length !== batch.length || accepted.some(function (id, index) { return batch.indexOf(id) < 0 || accepted.indexOf(id) !== index; }))
                throw new Error('Máy chủ chưa xác nhận đủ nhiệm vụ Bí Kíp đã nhận');
            accepted.forEach(function (id) { mgr.completeTask(id); });
        }
        return ids.length;
    }
    async function richMain(ctx) {
        var info = await richInfo(ctx), count = 0;
        if (Number(info.cycleId) <= 0) return 0;
        var main = util(ctx, 'DBUtil').getRichQuickSecretMainConfigById(info.cycleId);
        if (!main) throw new Error('Chưa nạp cấu hình Bí Kíp của chu kỳ hiện tại');
        var clock = util(ctx, 'TimeUtil');
        if (P.number(clock.getServerTimeMs()) >= P.number(clock.getCurZeroTime(P.number(info.systemCycle.curStartTime) / 1000)) * 1000 + P.integer(main.sustainedDay, 1) * 86400000)
            return 0;
        var ids = info.moduleMissionList.map(function (row) { return P.integer(row.templateId, 1); });
        for (var i = 0; i < ids.length; i++) {
            ctx.check();
            var mission = info.moduleMissionList.find(function (row) { return Number(row.templateId) === ids[i]; });
            if (!mission) throw new Error('Chu kỳ Bí Kíp thay đổi trong lúc nhận');
            var targets = richTargets(ctx, info, mission);
            if (!targets.length) continue;
            var reply = P.ret(await P.packet(ctx, 'S_SECRET_GET_REWARD', {templateId: ids[i]}));
            if (Number(reply.templateId) !== ids[i] || !P.reward(reply)) throw new Error('Thưởng Bí Kíp không khớp nhiệm vụ đã chọn');
            var fresh = await richInfo(ctx);
            if (Number(fresh.cycleId) !== Number(info.cycleId)) throw new Error('Chu kỳ Bí Kíp đã thay đổi');
            var after = fresh.moduleMissionList.find(function (row) { return Number(row.templateId) === ids[i]; });
            if (!after || targets.some(function (target) { return target.free && P.list(after.freeReward).map(Number).indexOf(target.id) < 0 ||
                target.paid && P.list(after.paidReward).map(Number).indexOf(target.id) < 0; })) throw new Error('Chưa xác nhận mốc Bí Kíp đã chuyển sang đã nhận');
            info = fresh; count += targets.length;
        }
        count += await richTasks(ctx, main);
        info = await richInfo(ctx);
        var gift = info.giftPack, time = util(ctx, 'TimeUtil');
        if (gift && (Number(gift.lastGainFreeRewardTime) <= 0 || !time.isToday(P.number(gift.lastGainFreeRewardTime) / 1000))) {
            var configured = util(ctx, 'DBUtil').getConfigByParam('RICH_QUICK_SECRET_GIFT_FREE_REWARD');
            if (!configured || !String(configured.value || '').trim()) throw new Error('Chưa xác nhận quà ngày miễn phí Bí Kíp');
            var free = P.ret(await P.packet(ctx, 'S_SECRET_GIFT_PACK_REWARD', {times: 0}));
            if (!free.giftPack || !time.isToday(P.number(free.giftPack.lastGainFreeRewardTime) / 1000)) throw new Error('Chưa xác nhận đã nhận quà ngày Bí Kíp');
            gift = free.giftPack; count++;
        }
        if (gift) {
            var loop = util(ctx, 'DBUtil').getConfigByParam('RICH_QUICK_SECRET_GIFT_ACCUMULATED_REWARDS');
            var interval = P.integer(loop && loop.value, 1), claimed = P.list(gift.receivedTimeRewards).map(Number);
            var next = (claimed.length ? Math.max.apply(Math, claimed) : 0) + interval;
            for (var step = 0; next <= P.integer(gift.times) && step < 100; step++) {
                var bands = String(main.giftAddReward || '').split('|').map(function (entry) { return entry.split('='); });
                var band = bands.find(function (entry, index) { return /^\d+$/.test(entry[0]) && Number(entry[0]) <= next / interval &&
                    (index === bands.length - 1 || Number(bands[index + 1][0]) > next / interval); });
                if (!band || !/^\d+,\d+$/.test(String(band[1]))) throw new Error('Chưa xác nhận cấu hình thưởng mốc quà Bí Kíp');
                var milestone = P.ret(await P.packet(ctx, 'S_SECRET_GIFT_PACK_REWARD', {times: next}));
                if (!milestone.giftPack || P.list(milestone.giftPack.receivedTimeRewards).map(Number).indexOf(next) < 0)
                    throw new Error('Máy chủ chưa xác nhận mốc quà mua tích lũy Bí Kíp');
                gift = milestone.giftPack; count++; next += interval;
            }
        }
        return count;
    }
    async function keyRewards(ctx) {
        var count = 0, battle = P.model(ctx, 'BattlePassMgr').battlePassData;
        if (!battle || typeof battle.hasLevelReward !== 'function') throw new Error('Dữ liệu Chìa Khóa Làm Giàu chưa sẵn sàng');
        if (battle.hasLevelReward()) {
            var reply = P.ret(await P.call(ctx, 'BattlePassNetUtil', 'getReward', [false]));
            if (!P.reward(reply)) throw new Error('Máy chủ chưa trả thưởng Chìa Khóa Làm Giàu');
            count++;
        }
        var funds = P.list(P.instance(ctx, 'FundMgr').getOpenFundList()), fundUtil = util(ctx, 'FundUtil');
        for (var i = 0; i < funds.length; i++) if (fundUtil.checkFundRedPoint(funds[i])) {
            var fundReply = P.ret(await P.call(ctx, 'FundNetUtil', 'getReward', [P.integer(funds[i].fundId, 1), false]));
            if (!P.reward(fundReply, 'rewards')) throw new Error('Máy chủ chưa trả thưởng quỹ đã đủ điều kiện');
            count++;
        }
        var activities = P.instance(ctx, 'ActivityMgr'), actFund = P.instance(ctx, 'ActivityFundMgr'), pass = util(ctx, 'ActivityBattlePassUtil');
        var choices = P.list(activities.getActivityList(34)).concat(P.list(activities.getActivityList(5)));
        for (var j = 0; j < choices.length; j++) {
            ctx.check(); var act = choices[j]; if (Number(act.state) !== 2) continue;
            var activityId = P.activityId(act), data = P.ret(await P.packet(ctx, 'S_ACTIVITY_DATA', {activityId: activityId}));
            if (!data.data || Number(data.data.activityId) !== activityId) throw new Error('Dữ liệu quỹ sự kiện không khớp');
            activities.syncActivityData(data.data); var selected = [];
            if (P.list(activities.getActivityList(34)).indexOf(act) >= 0) {
                P.list(actFund.getOpenFundList(activityId)).forEach(function (fund) {
                    P.list(fund.conditionList).forEach(function (row) {
                        if (fund.getFreeRewardState(row.conditionId) === 1 || typeof fund.getPayRewardState === 'function' && fund.getPayRewardState(row.conditionId) === 1)
                            selected.push(P.integer(row.conditionId, 1));
                    });
                });
            } else P.list(pass.buildBattlePassLevelRewardList(act)).forEach(function (level) {
                P.list(level.freeRewardList).concat(P.list(level.payRewardList)).forEach(function (item) {
                    if (pass.getBattlePassItemRewardState(act, item) === 1) selected.push(P.integer(item.conditionId, 1));
                });
            });
            selected = selected.filter(function (id, index) { return selected.indexOf(id) === index; });
            for (var r = 0; r < selected.length; r++) {
                var reward = P.ret(await P.packet(ctx, 'S_ACTIVITY_GET_REWARD', {activityId: activityId, conditionId: selected[r]}));
                if (Number(reward.activityId) !== activityId || Number(reward.conditionId) !== selected[r] || !P.reward(reward)) throw new Error('Mốc thưởng quỹ sự kiện không khớp yêu cầu');
                act.setConditionRewardReceived(selected[r]); count++;
            }
        }
        return count;
    }
    P.register({id: 'rich_quick_secret', name: 'Bí Kíp và Chìa Khóa Làm Giàu', group: 'Nhận thưởng', desktop: ['action_bi_kip_lam_giau'], options: [
        P.boolOption('keys', 'Nhận Chìa Khóa và quỹ đã đủ điều kiện', true)
    ]}, async function (ctx) {
        var count = 0;
        var open = util(ctx, 'SystemOpenUtil').getSystemIsOpenById(ctx.require('GameDefine').EnumSystemOpenId.SYSTEM_128);
        if (open) count += await richMain(ctx);
        if (ctx.options.keys) count += await keyRewards(ctx);
        return P.done(count, 'nhận mốc thưởng', open ? 'Chưa có mốc Bí Kíp hoặc quỹ đủ điều kiện' : 'Bí Kíp chưa mở; đã kiểm tra quỹ');
    });

    function sameBoard(a, b) {
        function normalize(text) {
            var board = JSON.parse(text);
            var rows = P.list(board.fruitDatas).map(function (f) {
                return [P.integer(f.fruitId, 1), P.integer(f.level, 1), P.number(f.position.x).toFixed(4), P.number(f.position.y).toFixed(4)];
            }).sort(function (x, y) { return x[0] - y[0]; });
            return JSON.stringify([P.integer(board.nextFruitId, 1), P.integer(board.nextFruitStep, 1), rows]);
        }
        return normalize(a) === normalize(b);
    }
    function landingX(game) {
        var next = game.nextFruitCom, low = P.number(game.minX), high = P.number(game.maxX);
        if (!next || high <= low) throw new Error('Bàn thả heo chưa sẵn sàng');
        var all = P.list(game.fruitItemList).filter(function (item) { return !item.isDispose && !item.isReadyToDispose && !item.isNext; });
        var candidates = [(low + high) / 2, low, high].concat(all.map(function (item) { return Math.max(low, Math.min(high, P.number(item.node.x))); }));
        var best = null;
        candidates.forEach(function (x) {
            var height = -Infinity, topItem = null;
            all.forEach(function (item) {
                var dx = Math.abs(x - P.number(item.node.x)), radius = (P.number(item.width) + P.number(next.width)) / 2;
                if (dx >= radius) return;
                var surface = P.number(item.node.y) + Math.sqrt(radius * radius - dx * dx);
                if (surface > height) { height = surface; topItem = item; }
            });
            var merge = !!topItem && Number(topItem.level) === Number(next.level);
            var rank = [merge ? 1 : 0, isFinite(height) ? -height : 1000000, -Math.abs(x - (low + high) / 2)];
            if (!best || rank[0] > best.rank[0] || rank[0] === best.rank[0] && (rank[1] > best.rank[1] || rank[1] === best.rank[1] && rank[2] > best.rank[2])) best = {x: x, rank: rank};
        });
        return best.x;
    }
    async function pigRead(ctx, id, mgr) {
        var reply = P.ret(await P.call(ctx, 'PigPigNetUtil', 'activityInfo', [id, false]));
        P.fields(reply, ['power', 'powerRecoveryTime', 'book']);
        mgr.syncPower(id, reply.power, reply.powerRecoveryTime); mgr.syncGameInfo(id, reply.info || null); mgr.syncBook(id, P.list(reply.book));
        if (reply.fourSpeed != null && reply.sixteenSpeed != null) mgr.syncUnlockGameType(id, reply.fourSpeed, reply.sixteenSpeed);
        ['DayScore', 'TotalScore', 'DayToken', 'TotalToken'].forEach(function (suffix) {
            var key = suffix[0].toLowerCase() + suffix.slice(1); if (reply[key] != null) mgr['sync' + suffix](id, reply[key]);
        });
        return reply;
    }
    async function physicsDrop(ctx, game, sceneCheck) {
        ctx.check();
        var next = game.nextFruitCom, cfg = util(ctx, 'SpineConfig').SpineConfig || util(ctx, 'SpineConfig');
        var mgr = P.instance(ctx, 'PigPigMgr'), id = P.integer(game.activityId, 1);
        if (!next || Number(game.info.costType) !== 1) throw new Error('Máy chủ chưa cấp lượt thả heo');
        next.updateX(landingX(game)); game.updatePeopleX(next.node.x);
        var level = P.integer(next.level, 1), pig = P.integer(next.pigId, 1);
        next.node.active || next.show(); next.enableRigidbody(); game.clearComposes();
        next.setIsNext(false); next.modifyMoveSpeed(0, -240); next.randomXOnCollider = true;
        next.playAnimation(cfg.ANI_IDLE2, true);
        game.drop = {pigId: pig, count: 1}; game.nextFruitCom = null; game.gameStatus = 1;
        var dropScore = P.number(mgr.calcDropScoreByConfig(id, mgr.getPigPigBallConfigByLevel(id, level)));
        game.info.score = P.number(game.info.score) + dropScore; game.refreshScore();
        // Match native updateByView/checkAwake: real Box2D world, same frame check,
        // acceleration and five-second protection; no geometry is submitted as simulation output.
        var physics = root.cc.director.getPhysicsManager(), elapsed = 0, protection = 0, frames = 0, settled = false, over = false, lastTick = Date.now();
        for (var tick = 0; tick < 1800; tick++) {
            await ctx.sleep(16); ctx.check();
            if (!game.isViewValid() || sceneCheck && !sceneCheck() || game.inBackground || game.inCanvasResize || game.isDataRecovering)
                throw new Error('Bàn vật lý phối heo đã đổi hoặc bị tạm dừng');
            var dt = Math.max(16, Math.min(100, Date.now() - lastTick)); lastTick = Date.now(); elapsed += dt; physics.enabled = true;
            try { physics.update(dt / 1000 * (elapsed / 1000 * P.number(game.FRAME_SPEED) + 1)); } finally { physics.enabled = false; }
            if (elapsed < 500 || game.inCreate) continue;
            protection += dt;
            if (++frames < P.integer(util(ctx, 'PigPigConfig').DINNER_GAME_CHECK_FRAME, 1)) continue;
            frames = 0; settled = true; var highest = -Infinity;
            P.list(game.fruitItemList).forEach(function (item) {
                if (item.isDispose || item.isNext) return;
                if (item.isAwake()) settled = false;
                highest = Math.max(highest, P.number(item.getHeight()));
            });
            over = highest >= P.number(game.getGameContainerTBLR().top);
            if (settled || protection > P.number(util(ctx, 'PigPigConfig').GAME_SLEEP_TIME)) { settled = true; break; }
        }
        if (!settled) throw new Error('Vật lý phối heo chưa ổn định; chưa gửi kết quả');
        P.list(game.fruitItemList).forEach(function (item) { if (!item.isDispose && !item.isNext) item.clearMoveSpeed(); });
        game.unEnabledPhysicsManager(); game.gameStatus = 0;
        return {board: game._getBoardData(true), drop: game._getDropPigId(), compose: game._getComposePigIdList(), pigs: game._getPigList(), over: over};
    }
    async function pigBooks(ctx, id, mgr, data) {
        var ready = P.list(data.book).filter(function (book) { return Number(book.pigId) > 1 && Number(book.state) === 0; }).map(function (book) { return P.integer(book.pigId, 1); });
        if (!ready.length) return 0;
        var reply = P.ret(await P.call(ctx, 'PigPigNetUtil', 'getBookReward', [id, ready, false]));
        if (!P.reward(reply)) throw new Error('Chưa có thưởng bộ sưu tập heo từ máy chủ');
        var fresh = await pigRead(ctx, id, mgr);
        if (ready.some(function (pig) { return !fresh.book.some(function (book) { return Number(book.pigId) === pig && Number(book.state) === 1; }); }))
            throw new Error('Bộ sưu tập heo chưa chuyển sang đã nhận');
        return ready.length;
    }
    P.register({id: 'pig_breeding', name: 'Phối Heo Giống', group: 'Sự kiện', timeoutMs: 1800000,
        desktop: ['action_phoi_heo_giong_request', 'action_phoi_heo_giong'], options: [
            P.numOption('turns', 'Số lượt thả tối đa', 150, 1000, 1),
            P.numOption('powerItems', 'Vật phẩm hồi thể lực tối đa', 0, 1000),
            P.boolOption('freeGifts', 'Nhận quà và các mốc đã đủ điều kiện', true)
        ]}, async function (ctx) {
        var hour = P.vnClock().getUTCHours(); if (hour < 10 || hour >= 22) return P.skip('Phối Heo Giống mở từ 10:00 đến 22:00 giờ Việt Nam');
        var act = P.findActivity(ctx, [1019], ['phối heo', 'phoi heo', 'heo giống']);
        if (!act) return P.skip('Phối Heo Giống chưa mở');
        var id = P.activityId(act), mgr = P.instance(ctx, 'PigPigMgr');
        if (!mgr.checkInOpenTime(act)) return P.skip('Phối Heo Giống chưa tới giờ mở của sự kiện');
        var schema = P.schema(ctx, 'S_MERGE_PIG_FINISH_ITEM');
        if (!['boardData', 'dropPigId', 'composePigId', 'pig'].every(function (key) { return !!schema.requestFields[key]; }))
            throw new Error('Phiên bản giao thức phối heo không khớp controller; chưa tiêu hao thể lực');
        P.validate(schema.requestFields, {activityId: id, timeId: '1', costType: 1, boardData: '', dropPigId: 1, composePigId: [], pig: []}, true);
        var config = P.ret(await P.call(ctx, 'PigPigNetUtil', 'activityConfig', [id, false]));
        if (Number(config.activityId) !== id || !P.list(config.paramConfig).length) throw new Error('Chưa nạp cấu hình vật lý phối heo');
        mgr.syncActivityConfig(config); mgr.initConfigParam(act);
        var data = await pigRead(ctx, id, mgr), count = 0, gifts = 0, usedItems = 0;
        if (ctx.options.freeGifts) gifts += await P.claimEventFree(ctx, act, []);
        var ui = P.instance(ctx, 'UIMgr'), viewType = util(ctx, 'PigPigGameView'), view = null, game = null;
        viewType = viewType.PigPigGameView || viewType;
        var previousTop = ui.getTopViewUuid(), physics = root.cc.director.getPhysicsManager(), collision = root.cc.director.getCollisionManager();
        var physicalState = {enabled: physics.enabled, gravity: physics.gravity && {x: physics.gravity.x, y: physics.gravity.y},
            enabledAccumulator: physics.enabledAccumulator, debugDrawFlags: physics.debugDrawFlags, collision: collision.enabled};
        // A private view class blocks native request callbacks before resource loading
        // starts. The original view class/prototype and singleton remain unchanged.
        var initialInfo;
        var AutoView = class extends viewType {
            afterInitView() {
                try { ctx.check(); } catch (_) { ui.close(AutoView); return; }
                mgr.syncGameInfo(id, initialInfo);
                return viewType.prototype.afterInitView.call(this);
            }
            addEvents() {
                try { ctx.check(); } catch (_) { return; }
                viewType.prototype.addEvents.call(this);
                if (this.pigPigGame) this.pigPigGame.removeEvents();
            }
            update() {}
            onNetConnect() { if (this.pigPigGame) this.pigPigGame.isDataRecovering = true; }
        };
        try {
            if (ui.getView(viewType.getUuid())) throw new Error('Đóng bàn Phối Heo đang mở trước khi chạy auto để tránh thao tác trùng');
            if (!data.info) {
                var started = P.ret(await P.call(ctx, 'PigPigNetUtil', 'startGame', [id, false]));
                if (!started.info || !P.id(started.info.timeId)) throw new Error('Chưa xác nhận bắt đầu ván phối heo');
                mgr.syncGameInfo(id, started.info); data.info = started.info;
            }
            if ([2, 3].indexOf(Number(data.info.costType)) >= 0) {
                var cancelled = P.ret(await P.call(ctx, 'PigPigNetUtil', 'cancelUseItem', [id, data.info.timeId, false]));
                if (!cancelled.info || Number(cancelled.info.costType) !== 0) throw new Error('Chưa thoát chế độ vật phẩm phối heo đang dở');
                mgr.syncGameInfo(id, cancelled.info); mgr.syncPower(id, cancelled.power, cancelled.powerRecoveryTime); data.info = cancelled.info;
            }
            P.integer(mgr.getNextBallLevel(id, mgr.getCurGameType(id)), 1);
            // Supply confirmed model data before opening: afterInitView resumes it
            // without invoking the native reqStartGame or change-item branch.
            initialInfo = data.info;
            await ctx.call('UIMgr', 'UIMgr.inst', 'openWith', [AutoView, {act: act}], {timeoutMs: 15000});
            await ctx.waitFor(function () { view = ui.getView(viewType.getUuid()); game = view && view.pigPigGame;
                return game && game.isViewValid() && game.nextFruitCom && game.canOperate && !game.nextFruitCom.inInit; }, {timeoutMs: 120000});
            ctx.check();
            if (Number(game.activityId) !== id || String(game.timeId) !== String(data.info.timeId)) throw new Error('Bàn phối heo không khớp ván máy chủ');
            game.removeEvents(); game.canOperate = false;
            for (; count < ctx.options.turns;) {
                ctx.check(); if (P.vnClock().getUTCHours() < 10 || P.vnClock().getUTCHours() >= 22) break;
                if (!game.isViewValid() || ui.getTopViewUuid() !== viewType.getUuid()) throw new Error('Giao diện phối heo đã thay đổi');
                data = await pigRead(ctx, id, mgr);
                var info = data.info;
                if (!info || String(info.timeId) !== String(game.timeId)) throw new Error('Ván phối heo đã thay đổi trên máy chủ');
                var cost = P.integer(mgr.getPowerCost(act), 1);
                if (Number(info.costType) === 0 && P.integer(data.power) < cost) {
                    if (usedItems >= ctx.options.powerItems) break;
                    var item = P.integer(mgr.getPowerPropId(act), 1), beforeItems = P.bag(ctx, item); if (!beforeItems) break;
                    var recovered = P.ret(await P.call(ctx, 'PigPigNetUtil', 'recoverPower', [id, 1, false]));
                    if (P.integer(recovered.power) <= P.integer(data.power)) throw new Error('Thể lực phối heo chưa tăng sau hồi');
                    await ctx.waitFor(function () { return P.bag(ctx, item) === beforeItems - 1; });
                    usedItems++; data = await pigRead(ctx, id, mgr);
                    if (P.integer(data.power) < cost) continue;
                }
                if (Number(info.costType) !== 1) {
                    if (Number(info.costType) !== 0) throw new Error('Phối heo đang ở chế độ vật phẩm khác');
                    var reserved = P.ret(await P.call(ctx, 'PigPigNetUtil', 'useItem', [id, info.timeId, 1, false]));
                    if (!reserved.info || String(reserved.info.timeId) !== String(info.timeId) || Number(reserved.info.costType) !== 1 ||
                        P.integer(reserved.power) !== P.integer(data.power) - cost) throw new Error('Máy chủ chưa xác nhận lượt thả và thể lực đã dùng');
                    info = reserved.info; mgr.syncGameInfo(id, info); mgr.syncPower(id, reserved.power, reserved.powerRecoveryTime);
                }
                game.info = info;
                await ctx.waitFor(function () { return game.nextFruitCom && !game.nextFruitCom.inInit; }, {timeoutMs: 10000});
                if (Number(game.nextFruitCom.level) !== P.integer(mgr.getNextBallLevel(id, mgr.getCurGameType(id)), 1))
                    throw new Error('Heo sắp thả không khớp heo máy chủ cấp; giữ lượt đã dành để đồng bộ lại');
                var played = await physicsDrop(ctx, game, function () { return ui.getTopViewUuid() === viewType.getUuid() && ui.getView(viewType.getUuid()) === view; });
                ctx.check();
                var finished = P.ret(await P.call(ctx, 'PigPigNetUtil', 'finishUseItem', [id, info.timeId, 1, played.board, played.drop, played.compose, played.pigs, false]));
                if (!finished.info || String(finished.info.timeId) !== String(info.timeId) || Number(finished.info.costType) !== 0 || !sameBoard(played.board, finished.info.boardData))
                    throw new Error('Máy chủ chưa xác nhận đúng bàn vật lý sau lượt thả');
                mgr.syncGameInfo(id, finished.info); if (Array.isArray(finished.book)) mgr.syncBook(id, finished.book);
                game.info = finished.info; game.clearComposes(); game.stepNum = P.integer(JSON.parse(played.board).nextFruitStep, 1);
                game.fruitId++; count++;
                ctx.log('Phối Heo Giống: đã xác nhận ' + count + ' lượt thả; thể lực ' + mgr.model.getActivityData(id).power);
                if (played.over) {
                    var ended = P.ret(await P.call(ctx, 'PigPigNetUtil', 'reqGameOver', [id, game.timeId, false]));
                    var endState = await pigRead(ctx, id, mgr);
                    if (endState.info) throw new Error('Máy chủ chưa chốt ván phối heo đã đầy');
                    mgr.syncGameInfo(id, null);
                    if (count >= ctx.options.turns || P.integer(endState.power) < cost) break;
                    var restart = P.ret(await P.call(ctx, 'PigPigNetUtil', 'startGame', [id, false]));
                    if (!restart.info || String(restart.info.timeId) === String(game.timeId)) throw new Error('Chưa xác nhận ván phối heo mới');
                    mgr.syncGameInfo(id, restart.info); game.info = restart.info; game.timeId = restart.info.timeId; game.resumeGame();
                } else {
                    await game.creatorNextFruit(P.integer(mgr.getNextBallLevel(id, mgr.getCurGameType(id)), 1), game.fruitId);
                    game.refreshGameView(); game.refreshStep(game.stepNum);
                }
            }
        } finally {
            // Closing this exact view invalidates delayed physics/animation callbacks.
            // It also prevents an unsettled reserved turn from being sent by native update.
            if (game) { game.canOperate = false; game.gameStatus = 0; try { game.unEnabledPhysicsManager(); } catch (_) {} }
            try { if (view && ui.getView(viewType.getUuid()) === view) ui.close(AutoView); }
            finally {
                if (!ui.getView(viewType.getUuid()) && ui.getTopViewUuid() === previousTop) {
                    physics.enabled = physicalState.enabled;
                    if (physicalState.gravity) physics.gravity = root.cc.v2(physicalState.gravity.x, physicalState.gravity.y);
                    physics.enabledAccumulator = physicalState.enabledAccumulator; physics.debugDrawFlags = physicalState.debugDrawFlags;
                    collision.enabled = physicalState.collision;
                }
            }
        }
        data = await pigRead(ctx, id, mgr);
        if (ctx.options.freeGifts) {
            gifts += await pigBooks(ctx, id, mgr, data);
            gifts += await P.claimActivity(ctx, act);
            if (typeof P.claimWarOrder === 'function') gifts += await P.claimWarOrder(ctx, act);
        }
        ctx.log('Phối Heo Giống: ' + count + ' lượt đã xác nhận, ' + gifts + ' phần quà; thể lực còn ' + P.integer(data.power));
        return P.done(count + gifts, 'thả heo/nhận quà', 'Không còn lượt phối heo hoặc mốc đủ điều kiện');
    });
    P.richPig = {bit: bit, atLeast: atLeast, richTargets: richTargets, richMain: richMain, keyRewards: keyRewards,
        sameBoard: sameBoard, landingX: landingX, physicsDrop: physicsDrop, pigBooks: pigBooks};
})(typeof window !== 'undefined' ? window : globalThis);
