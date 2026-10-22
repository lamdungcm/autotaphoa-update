/* Native tasks for the embedded Cocos runtime. No opcodes or fabricated replies.
 * Sources: game FarmingSeasonNetUtil/SignNetUtil/MailNetUtil and the verified
 * PC Farming Season planner. Network timeouts are bounded by ctx.call.
 */
(function (root) {
    'use strict';
    var api = root.AutoAPK;
    if (!api || typeof api.registerTask !== 'function') throw new Error('AutoAPK runtime missing');

    function list(value) { return Array.isArray(value) ? value : []; }
    function number(value) { var n = Number(value); return isFinite(n) ? n : 0; }
    function uid(player) {
        var value = player && player.players && player.players.userId;
        return value == null ? '' : String(value);
    }
    function player(value) {
        if (!value) return null;
        return {players: {userId: uid(value), nickName: (value.players || {}).nickName || ''},
            level: value.level, dailyHelpNum: value.dailyHelpNum,
            inHelpList: value.inHelpList, entrustQuality: list(value.entrustQuality).slice()};
    }
    function entrust(value) {
        if (!value) return null;
        return {state: value.state, entrustId: value.entrustId, workTime: value.workTime,
            endTime: number(value.endTime), leader: player(value.leader),
            teammates: list(value.teammates).map(player)};
    }
    function requirement(task) {
        var parts = String((task || {}).monsterPower || '').split('|').map(Number);
        if (!parts.length || parts.some(function (n) { return !isFinite(n) || n <= 0; })) return 0;
        return Math.max.apply(Math, parts);
    }
    function sameIds(a, b) {
        return a.length === b.length && a.slice().sort().every(function (value, index) {
            return value === b.slice().sort()[index];
        });
    }
    function failPlan(message) { return {action: 'unavailable', teams: [], reason: message}; }

    function planFarming(snapshot) {
        snapshot = snapshot || {};
        var data = snapshot.data || {}, config = snapshot.config || {}, rules = snapshot.rules || {};
        var ownUid = String(snapshot.own_uid || ''), room = data.entrust;
        if (data.ret !== 0 || !ownUid) return failPlan('Không đọc được dữ liệu nhân vật từ máy chủ');
        if (room && uid(room.leader) !== ownUid) return failPlan('Phòng ủy thác không thuộc nhân vật hiện tại');
        if (room && number(room.state) === 2) {
            if (number(room.endTime) <= 0) return failPlan('Chưa xác nhận được thời gian ủy thác');
            return {action: number(room.endTime) <= number(snapshot.now_ms) ? 'finished' : 'working',
                entrust_id: number(room.entrustId), teams: []};
        }
        if (room && number(room.state) === 3) return {action: 'finished', entrust_id: number(room.entrustId), teams: []};
        if (room && number(room.state) !== 1) return failPlan('Trạng thái ủy thác chưa xác định');

        var levels = {}, tasks = {};
        list(config.playerLvConfig).forEach(function (row) { levels[number(row.id)] = number(row.power); });
        list(config.entrustConfig).forEach(function (row) { tasks[number(row.id)] = row; });
        var ownPower = levels[number(data.level)] || 0;
        var limit = number(rules.help_limit), multiplier = number(rules.helper_power_param);
        if (ownPower <= 0 || !Object.keys(tasks).length || limit <= 0 || multiplier <= 0) {
            return failPlan('Không đọc được cấu hình năng lực hoặc lượt hỗ trợ');
        }
        function power(p) { return Math.ceil((levels[number(p.level)] || 0) * multiplier / 1000); }
        var existing = list((room || {}).teammates).slice(), existingIds = existing.map(uid);
        if (existingIds.length > 2 || existingIds.some(function (id, index) {
            return !id || id === ownUid || existingIds.indexOf(id) !== index;
        })) return failPlan('Danh sách trợ thủ hiện tại không hợp lệ');
        if (existing.some(function (p) { return power(p) <= 0; })) return failPlan('Không đọc được năng lực trợ thủ đang trong đội');

        var candidates = {}, joiners = snapshot.joiners || {};
        list(joiners.players).forEach(function (p) {
            var id = uid(p), used = p.dailyHelpNum;
            if (id && id !== ownUid && existingIds.indexOf(id) < 0 && used != null &&
                    isFinite(Number(used)) && Number(used) >= 0 && Number(used) < limit &&
                    Math.floor(Number(used)) === Number(used) && p.inHelpList === true && power(p) > 0) candidates[id] = p;
        });
        function teamsFor(task) {
            var required = requirement(task), teams = [], quality = number(task.quality);
            if (!required) return teams;
            var eligible = Object.keys(candidates).map(function (id) { return candidates[id]; }).filter(function (p) {
                return list(p.entrustQuality).some(function (q) { return number(q) === quality; });
            });
            function add(extra) {
                var helpers = existing.concat(extra), total = ownPower;
                helpers.forEach(function (p) { total += power(p); });
                if (total >= required) teams.push({uids: helpers.map(uid), helpers: helpers, power: total});
            }
            if (existing.length === 2) add([]);
            else if (existing.length === 1) eligible.forEach(function (p) { add([p]); });
            else for (var i = 0; i < eligible.length; i++) for (var j = i + 1; j < eligible.length; j++) add([eligible[i], eligible[j]]);
            teams.sort(function (a, b) {
                var delta = a.power - b.power;
                if (delta) return delta;
                delta = Math.max.apply(Math, a.helpers.map(power)) - Math.max.apply(Math, b.helpers.map(power));
                return delta || a.uids.join(',').localeCompare(b.uids.join(','));
            });
            return teams;
        }
        var feasible = {};
        Object.keys(tasks).forEach(function (id) {
            var teams = teamsFor(tasks[id]);
            if (teams.length) feasible[id] = teams;
        });
        function result(action, taskId, targetId) {
            return {action: action, entrust_id: number(taskId), target_id: number(targetId), teams: feasible[taskId],
                own_power: ownPower, required_power: requirement(tasks[taskId])};
        }
        if (room) {
            var roomId = number(room.entrustId);
            if (!tasks[roomId]) return failPlan('Không tìm thấy cấu hình nhiệm vụ đang nhận');
            if (!feasible[roomId]) return failPlan('Chưa có đội hợp lệ đủ năng lực cho nhiệm vụ đang nhận');
            return result(existing.length === 2 ? 'start' : 'invite', roomId, roomId);
        }
        if (joiners.ret !== 0) return failPlan('Không đọc được danh sách trợ thủ từ máy chủ');
        var ids = Object.keys(feasible);
        if (!ids.length) return failPlan('Chưa có hai trợ thủ hợp lệ đủ năng lực');
        function rank(a, b) { return requirement(tasks[b]) - requirement(tasks[a]) || number(b) - number(a); }
        ids.sort(rank);
        var targetId = number(ids[0]), board = snapshot.board || {};
        if (board.ret !== 0) return failPlan('Không đọc được bảng nhiệm vụ từ máy chủ');
        var available = list(board.entrusts).map(Number).filter(function (id) { return !!feasible[id]; }).sort(rank);
        if (!available.length) {
            var missing = failPlan('Bảng chưa có nhiệm vụ phù hợp với đội');
            missing.target_id = targetId;
            return missing;
        }
        return result('accept', available[0], targetId);
    }

    function requireSuccess(response, message) {
        if (!response || response.ret !== 0) throw new Error(message);
        return response;
    }
    async function nativeFarming(ctx, activityId, operation, extra) {
        var methods = {
            config: ['sendFarmingConfigReqMsg', 'asynFarmingConfigRespMsg'],
            data: ['sendFarmingDataReqMsg', 'asynFarmingDataRespMsg'],
            joiners: ['sendFarmingJoinerReqMsg', 'asynFarmingJoinerRespMsg'],
            board: ['sendFarmingEntrustListReqMsg', 'asynFarmingEntrustListRespMsg'],
            refresh: ['sendFarmingEntrustRefreshReqMsg', 'asynFarmingEntrustRefreshRespMsg'],
            accept: ['sendFarmingEntrustAcceptReqMsg', 'asynFarmingEntrustAcceptRespMsg'],
            team: ['sendFarmingTeammateSetReqMsg', 'asynFarmingTeammateSetRespMsg'],
            start: ['sendFarmingEntrustGoReqMsg', 'asynFarmingEntrustGoReqMsg']
        };
        ctx.check();
        var spec = methods[operation], args = [activityId].concat(extra || []);
        if (!spec) throw new Error('Thao tác sự kiện chưa được hỗ trợ');
        var response = await ctx.call('FarmingSeasonNetUtil', 'FarmingSeasonNetUtil', spec[0], args, {timeoutMs: 12000});
        if (response && response.ret === 0) {
            var mgr = ctx.require('FarmingSeasonMgr').FarmingSeasonMgr.inst;
            mgr[spec[1]](response, activityId);
            if (['refresh', 'accept', 'team', 'start'].indexOf(operation) >= 0) {
                var cfg = ctx.require('FarmingSeasonConfig').FarmingSeasonConfig;
                ctx.require('EventMgr').EventMgr.inst.emit(cfg.EVENT_UPDATE_ENTRUST);
            }
        }
        ctx.check();
        return response;
    }
    async function farmingSnapshot(ctx, act) {
        var activityId = number(act.activityId), cfg = ctx.require('FarmingSeasonConfig').FarmingSeasonConfig;
        var c = requireSuccess(await nativeFarming(ctx, activityId, 'config'), 'Không lấy được cấu hình sự kiện');
        var d = requireSuccess(await nativeFarming(ctx, activityId, 'data', [false]), 'Không lấy được trạng thái ủy thác');
        var j = requireSuccess(await nativeFarming(ctx, activityId, 'joiners'), 'Không lấy được danh sách trợ thủ');
        var b = requireSuccess(await nativeFarming(ctx, activityId, 'board'), 'Không lấy được bảng nhiệm vụ');
        return {own_uid: String(ctx.uid), now_ms: Date.now(),
            data: {ret: d.ret, level: d.level, entrust: entrust(d.entrust)},
            joiners: {ret: j.ret, players: list(j.players).map(player)},
            config: {playerLvConfig: c.playerLvConfig, entrustConfig: c.entrustConfig},
            board: {ret: b.ret, entrusts: list(b.entrusts).map(Number), refresh: b.refresh},
            rules: {help_limit: act.getConfigNumber(cfg.FARMING_ENTRUST_HELP_TIMES_MAX),
                helper_power_param: act.getConfigNumber(cfg.FARMING_ENTRUST_TEAM_POWER_PARAM),
                refresh_free: act.getConfigNumber(cfg.FARMING_ENTRUST_RESET_FREE_TIMES),
                refresh_max: act.getConfigNumber(cfg.FARMING_ENTRUST_RESET_MAX_TIMES)}};
    }
    function applyRoom(snapshot, response) {
        if (response && response.ret === 0 && response.entrust) {
            snapshot.data.entrust = entrust(response.entrust);
            snapshot.now_ms = Date.now();
            return true;
        }
        return false;
    }
    function verifyRoom(snapshot, expectedTask, expectedIds, expectedState) {
        var room = snapshot.data.entrust || {}, ids = list(room.teammates).map(uid);
        if (number(room.entrustId) !== expectedTask || uid(room.leader) !== snapshot.own_uid ||
                number(room.state) !== expectedState || !sameIds(ids, expectedIds)) return false;
        if (expectedState === 2 && number(room.endTime) <= Date.now()) return false;
        var copy = Object.assign({}, snapshot, {data: Object.assign({}, snapshot.data,
            {entrust: Object.assign({}, room, {state: 1})})});
        return planFarming(copy).action === 'start';
    }
    async function runFarming(ctx) {
        ctx.check();
        var act = ctx.activity(1020);
        if (!act) return {status: 'skipped', message: 'Mùa Vụ Bận Rộn chưa mở'};
        var activityId = number(act.activityId), snapshot = await farmingSnapshot(ctx, act), plan = planFarming(snapshot);
        if (plan.action === 'finished') {
            // Finishing is handled by the native server notification; DONATE_DATA is not harvest.
            snapshot = await farmingSnapshot(ctx, act);
            plan = planFarming(snapshot);
            if (plan.action === 'finished') throw new Error('Máy chủ chưa cập nhật kết quả ủy thác đã kết thúc');
        }
        if (plan.action === 'working') return {status: 'already_done', message: 'Ủy thác đang thực hiện'};
        if (!snapshot.data.entrust && plan.target_id && snapshot.board.entrusts.indexOf(plan.target_id) < 0 &&
                snapshot.board.refresh != null && number(snapshot.board.refresh) <
                Math.min(number(snapshot.rules.refresh_free), number(snapshot.rules.refresh_max))) {
            ctx.log('Làm mới bảng nhiệm vụ một lần');
            requireSuccess(await nativeFarming(ctx, activityId, 'refresh'), 'Chưa xác nhận được làm mới bảng nhiệm vụ');
            snapshot = await farmingSnapshot(ctx, act);
            plan = planFarming(snapshot);
        }
        if (plan.action === 'unavailable') throw new Error(plan.reason);
        if (plan.action === 'accept') {
            var taskId = plan.entrust_id, task = list(snapshot.config.entrustConfig).filter(function (t) { return number(t.id) === taskId; })[0];
            ctx.log('Chọn ' + (task.name || 'ủy thác') + ' — yêu cầu ' + plan.required_power + ' lực');
            var accepted;
            try { accepted = await nativeFarming(ctx, activityId, 'accept', [taskId]); }
            catch (error) { ctx.check(); accepted = null; }
            if (!applyRoom(snapshot, accepted)) snapshot = await farmingSnapshot(ctx, act);
            var room = snapshot.data.entrust || {};
            if (number(room.entrustId) !== taskId || uid(room.leader) !== snapshot.own_uid) {
                throw new Error('Máy chủ chưa xác nhận nhận nhiệm vụ');
            }
            plan = planFarming(snapshot);
        }
        if (plan.action === 'working') return {status: 'already_done', message: 'Ủy thác đang thực hiện'};
        if (plan.action === 'invite') {
            var selectedTask = plan.entrust_id, rejected = {}, attempts = 0;
            while (plan.action === 'invite' && attempts < 4) {
                ctx.check();
                var team = plan.teams.filter(function (t) { return !rejected[t.uids.slice().sort().join(',')]; })[0];
                if (!team) break;
                // Native SET replaces the whole list; both UIDs include any existing helper.
                var numericIds = team.uids.map(function (id) {
                    var numeric = Number(id);
                    if (!Number.isSafeInteger(numeric) || String(numeric) !== id) throw new Error('Không xác nhận được danh tính trợ thủ');
                    return numeric;
                });
                ctx.log('Mời trợ thủ để đạt ' + team.power + '/' + plan.required_power + ' lực');
                var response;
                try { response = await nativeFarming(ctx, activityId, 'team', [numericIds]); }
                catch (error) { ctx.check(); response = null; }
                attempts++;
                if (applyRoom(snapshot, response)) {
                    if (!verifyRoom(snapshot, selectedTask, team.uids, 1)) throw new Error('Máy chủ chưa xác nhận đúng đội đủ lực');
                    plan = planFarming(snapshot);
                    break;
                }
                snapshot = await farmingSnapshot(ctx, act);
                if (number((snapshot.data.entrust || {}).entrustId) !== selectedTask) throw new Error('Nhiệm vụ đã thay đổi, cần kiểm tra lại');
                plan = planFarming(snapshot);
                // Ambiguous outcomes are only reconciled, never retried blindly.
                if (!response || response.ret === 0) break;
                rejected[team.uids.slice().sort().join(',')] = true;
            }
        }
        if (plan.action !== 'start') throw new Error(plan.reason || 'Máy chủ chưa xác nhận đủ ba người hợp lệ');
        var expectedIds = plan.teams[0].uids.slice(), expectedTask = plan.entrust_id;
        ctx.log('Đội đủ ba người, ' + plan.teams[0].power + '/' + plan.required_power + ' lực');
        var started;
        try { started = await nativeFarming(ctx, activityId, 'start'); }
        catch (error) { ctx.check(); started = null; }
        if (!applyRoom(snapshot, started)) snapshot = await farmingSnapshot(ctx, act);
        if (!verifyRoom(snapshot, expectedTask, expectedIds, 2)) throw new Error('Chưa có xác nhận ủy thác đang chạy từ máy chủ');
        return {status: 'success', message: 'Đã bắt đầu ủy thác'};
    }

    async function runMail(ctx) {
        ctx.check();
        var response = requireSuccess(await ctx.call('MailNetUtil', 'MailNetUtil', 'getAllReward', [], {timeoutMs: 12000}),
            'Máy chủ chưa xác nhận nhận thưởng thư');
        ctx.check();
        // reward is the actual typed server field used by MailMainView.doGet.
        if (typeof response.reward !== 'string') throw new Error('Không đọc được kết quả nhận thưởng thư');
        if (!response.reward.trim()) return {status: 'already_done', message: 'Không có thưởng thư để nhận'};
        return {status: 'success', message: 'Đã nhận thưởng thư'};
    }
    async function runSignin(ctx) {
        ctx.check();
        var mgr = ctx.require('SignMgr').SignMgr.inst, model = mgr.model;
        if (!model || model.lastSignDays == null || model.currentSignDays == null ||
                !isFinite(Number(model.lastSignDays)) || !isFinite(Number(model.currentSignDays)) ||
                !Array.isArray(model.configSignAccumulateRewardDayParam) || !Array.isArray(model.gainedAccumulateIndex)) {
            throw new Error('Dữ liệu điểm danh chưa sẵn sàng');
        }
        var claimed = 0;
        function sync(response) {
            requireSuccess(response, 'Máy chủ chưa xác nhận điểm danh');
            var data = response.signData;
            if (!data || data.lastSignDays == null || data.currentSignDays == null ||
                    !isFinite(Number(data.lastSignDays)) || !isFinite(Number(data.currentSignDays)) ||
                    !Array.isArray(data.gainedAccumulateIndex)) throw new Error('Không đọc được kết quả điểm danh');
            mgr.syncSignData(data);
            model = mgr.model;
        }
        if (Number(model.lastSignDays) < Number(model.currentSignDays)) {
            var before = Number(model.lastSignDays);
            sync(await ctx.call('SignNetUtil', 'SignNetUtil', 'in', [], {timeoutMs: 12000}));
            ctx.check();
            if (Number(model.lastSignDays) <= before) throw new Error('Máy chủ chưa cập nhật ngày điểm danh');
            claimed++;
        }
        // Snapshot eligible indices, then require their actual server confirmation.
        var indices = model.configSignAccumulateRewardDayParam.map(function (day, index) {
            return Number(model.lastSignDays) >= Number(day) && model.gainedAccumulateIndex.indexOf(index) < 0 ? index : -1;
        }).filter(function (index) { return index >= 0; });
        if (indices.length > 32) throw new Error('Cấu hình thưởng điểm danh chưa được hỗ trợ');
        for (var i = 0; i < indices.length; i++) {
            ctx.check();
            sync(await ctx.call('SignNetUtil', 'SignNetUtil', 'accumulateReward', [indices[i]], {timeoutMs: 12000}));
            ctx.check();
            if (model.gainedAccumulateIndex.indexOf(indices[i]) < 0) throw new Error('Máy chủ chưa xác nhận mốc thưởng điểm danh');
            claimed++;
        }
        return {status: claimed ? 'success' : 'already_done',
            message: claimed ? 'Đã nhận thưởng điểm danh và các mốc đủ điều kiện' : 'Điểm danh và các mốc đã nhận đủ'};
    }

    api.registerTask({id: 'mail_rewards', name: 'Nhận thưởng thư', run: runMail});
    api.registerTask({id: 'daily_signin', name: 'Điểm danh', run: runSignin});
    api.registerTask({id: 'mua_vu_ban_ron', name: 'Mùa Vụ Bận Rộn', run: runFarming});
    api.taskInternals = {planFarming: planFarming, requirement: requirement, verifyRoom: verifyRoom};
})(typeof window !== 'undefined' ? window : globalThis);
