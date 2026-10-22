/* Native day tasks. Provenance: current action_request_engine.py and the
 * Assistant/Beauty/Car/Farm/Film native modules; no desktop process is used. */
(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    function register(id, name, desktop, options, run) {
        P.register({id: id, name: name, group: 'Hằng ngày', desktop: desktop, options: options || []}, run);
    }
    function apply(owner, method, args) {
        if (typeof owner[method] === 'function') owner[method].apply(owner, args);
    }
    function studio(reply, index) {
        P.ret(reply);
        if (!reply.studio || Number(reply.studio.studioIndex) !== index) throw new Error('Máy chủ chưa xác nhận trường quay');
        return reply.studio;
    }
    register('secretary', 'Thư ký', ['action_secretary'], [
        P.boolOption('configurePromote', 'Đổi cấu hình chiêu mộ', false),
        P.boolOption('upgrade', 'Nâng cấp', true), P.boolOption('promote', 'Chiêu mộ', true),
        P.numOption('promoteCount', 'Số lần chiêu mộ', 200, 2000, 1)
    ], async function (ctx) {
        var mgr = P.instance(ctx, 'AssistantMgr');
        if (!mgr.checkSystemOpen()) return P.skip('Chức năng thư ký chưa mở');
        var current = P.ret(await P.call(ctx, 'AssistantNetUtil', 'getInfo', [false]));
        apply(mgr.model, 'asynUpdateAssistantSettingRespMsg', [current]);
        if (ctx.options.configurePromote) {
            var setting = {openUpgrade: ctx.options.upgrade, openPromote: ctx.options.promote, num: ctx.options.promoteCount, addition: '1.0'};
            P.ret(await P.call(ctx, 'AssistantNetUtil', 'setInfo', [{promoteSetting: setting}, false]));
            current = P.ret(await P.call(ctx, 'AssistantNetUtil', 'getInfo', [false]));
            if (!current.promoteSetting || Object.keys(setting).some(function (key) { return String(current.promoteSetting[key]) !== String(setting[key]); }))
                throw new Error('Chưa xác nhận cấu hình thư ký');
            apply(mgr.model, 'asynUpdateAssistantSettingRespMsg', [current]);
        }
        var response = P.ret(await P.call(ctx, 'AssistantNetUtil', 'run', [false]));
        var sections = Object.keys(response).filter(function (key) { return key !== 'ret' && response[key] && typeof response[key] === 'object'; });
        if (!sections.length) throw new Error('Thư ký chưa trả kết quả công việc');
        if (sections.some(function (key) { return response[key].ret != null && response[key].ret !== 0; }))
            throw new Error('Có công việc thư ký chưa thực hiện được');
        apply(mgr.model, 'asynUpdateAssistantActionRespMsg', [response]);
        return P.done(sections.length, 'xử lý nhóm công việc thư ký');
    });
    register('secretary_double', 'Thư ký hai lượt', ['action_secretary_double'], [], async function (ctx) {
        return P.sequence(ctx, ['secretary', 'secretary'], {repeatDuplicates: true});
    });
    register('advisor_income', 'Nhận tiền cố vấn', ['action_advisor_money'], [], async function (ctx) {
        var reply = await P.accept(ctx, 'S_MENTOR_GET_INCOME', {});
        return P.done(P.reward(reply) ? 1 : 0, 'nhận tiền cố vấn', 'Chưa có thu nhập cố vấn');
    });
    register('share_game', 'Chia sẻ game', ['action_share_game'], [], async function (ctx) {
        var mgr = P.instance(ctx, 'TaskMgr'), db = ctx.require('DBUtil').DBUtil;
        var kind = ctx.require('TaskConfig').TaskConfig.DAILY_TASK_SHARE;
        var rows = db.getTaskListByType(1).filter(function (row) { return Number(row.additionalPar) === Number(kind); });
        if (!rows.length) throw new Error('Không đọc được nhiệm vụ chia sẻ');
        var before = rows.map(function (row) { var t = mgr.getTaskInfo(row.id), data = mgr.getTaskData(row.id); return {id: row.id, value: data && Number(data.value), complete: t && t.isComplete}; });
        if (before.every(function (t) { return t.complete; })) return P.done(0, '', 'Đã chia sẻ hôm nay');
        P.ret(await P.call(ctx, 'TaskNetUtil', 'shareGameVN', []));
        await ctx.waitFor(function () { return before.some(function (t) { var now = mgr.getTaskInfo(t.id), data = mgr.getTaskData(t.id); return now && (now.isComplete && !t.complete || data && Number(data.value) > t.value); }); });
        return P.done(1, 'chia sẻ game');
    });
    function beautyRows(ctx) { return P.values(P.model(ctx, 'BeautyMgr').beautyDict); }
    P.catalogs.beautiesLoader = function (ctx) {
        var db = ctx.require('DBUtil').DBUtil;
        return P.setCatalog(ctx, 'beauties', beautyRows(ctx).map(function (row) {
            var cfg = db.getBeauty(row.beautyId);
            return {id: String(row.beautyId), name: P.name(ctx, cfg && cfg.name) || 'Nghệ sĩ ' + row.beautyId};
        }));
    };
    register('artist_gifts', 'Nghệ sĩ: tặng quà', ['action_artist_gift'], [
        P.idsOption('artists', 'Nghệ sĩ (trống = tự chọn)', 'beauties'),
        P.numOption('giftId', 'Mã vật phẩm quà', 110028, 999999999, 1),
        P.numOption('count', 'Tổng số quà tối đa', 2, 1000)
    ], async function (ctx) {
        var rows = P.filterSelected(beautyRows(ctx), ctx.options.artists, 'beautyId');
        if (!rows.length) return P.skip('Chưa có nghệ sĩ phù hợp');
        var count = Math.min(P.bag(ctx, ctx.options.giftId), ctx.options.count);
        if (!count) return P.done(0, '', 'Không có quà tặng trong túi');
        var reply = P.ret(await P.call(ctx, 'BeautyNetUtil', 'giftReward', [P.integer(rows[0].beautyId, 1), ctx.options.giftId, count, false]));
        if (!(Number(reply.addAffinity) > 0 || Number(reply.addInfluence) > 0)) throw new Error('Chưa xác nhận kết quả tặng quà');
        return P.done(count, 'tặng quà nghệ sĩ');
    });
    register('artist_skills', 'Nghệ sĩ: kỹ năng', ['action_artist_skill'], [
        P.idsOption('artists', 'Nghệ sĩ (trống = tự chọn)', 'beauties'), P.numOption('times', 'Số lần tối đa', 5, 1000)
    ], async function (ctx) {
        var mgr = P.instance(ctx, 'BeautyMgr'), choices = [];
        P.filterSelected(beautyRows(ctx), ctx.options.artists, 'beautyId').forEach(function (b) {
            P.list(b.skillList).forEach(function (s) { choices.push({id: b.beautyId, skill: s}); });
        });
        var count = 0;
        while (count < ctx.options.times && choices.length) {
            choices.sort(function (a, b) { return P.integer(a.skill.modifyNum) - P.integer(b.skill.modifyNum); });
            var choice = choices[0], old = P.integer(choice.skill.modifyNum), pos = P.integer(choice.skill.skillPos);
            var reply = P.ret(await P.call(ctx, 'BeautyNetUtil', 'skillModify', [choice.id, pos, false, false, false, 0, 0, false]));
            if (!reply.beautySkill || Number(reply.beautySkill.skillPos) !== pos || Number(reply.beautySkill.modifyNum) <= old)
                throw new Error('Máy chủ chưa xác nhận lượt kỹ năng nghệ sĩ');
            apply(mgr, 'syncSkillModify', [reply, choice.id, pos]); choice.skill = reply.beautySkill; count++;
        }
        return P.done(count, 'cải thiện kỹ năng nghệ sĩ');
    });
    register('artists', 'Nghệ sĩ: quà và kỹ năng', ['action_artist'], [], async function (ctx) {
        return P.sequence(ctx, ['artist_gifts', 'artist_skills']);
    });
    function cars(ctx) {
        var dict = P.model(ctx, 'CarMgr').carDict;
        if (!dict) throw new Error('Danh sách xe chưa sẵn sàng');
        return Object.keys(dict).map(function (id) { return {id: id, car: dict[id]}; });
    }
    P.catalogs.carsLoader = function (ctx) {
        var db = ctx.require('DBUtil').DBUtil;
        return P.setCatalog(ctx, 'cars', cars(ctx).map(function (row) {
            var cfg = db.getCar(row.car.templateId);
            return {id: row.id, name: (P.name(ctx, cfg && cfg.name) || 'Xe ' + row.car.templateId) + ' · cấp ' + row.car.level};
        }));
    };
    register('vehicle_catalog', 'Quét danh sách xe', ['action_scan_vehicle_catalog'], [], async function (ctx) {
        return P.done(P.catalogs.carsLoader(ctx).length, 'đọc xe vào danh sách cấu hình');
    });
    register('car_improve', 'Cải tiến xe', ['action_car_improve'], [
        P.idsOption('cars', 'Xe (trống = tự chọn)', 'cars'), P.numOption('times', 'Số lần tối đa', 5, 1000)
    ], async function (ctx) {
        var mgr = P.instance(ctx, 'CarMgr'), choices = [];
        cars(ctx).filter(function (row) { return !ctx.options.cars.length || ctx.options.cars.map(String).indexOf(row.id) >= 0; }).forEach(function (row) {
            P.list(row.car.skillList).forEach(function (s) { choices.push({id: row.id, skill: s}); });
        });
        var count = 0;
        while (count < ctx.options.times && choices.length) {
            choices.sort(function (a, b) { return P.integer(a.skill.skillModifyTimes) - P.integer(b.skill.skillModifyTimes); });
            var row = choices[0], s = row.skill, old = P.integer(s.skillModifyTimes), pos = P.integer(s.skillPos), type = P.integer(s.skillType, 1);
            var reply = P.ret(await P.call(ctx, 'CarNetUtil', 'skillModify', [row.id, type, pos, false, false, false, 0, 0, false]));
            if (String(reply.carId) !== row.id || !reply.skill || Number(reply.skill.skillPos) !== pos || Number(reply.skill.skillType) !== type || Number(reply.skill.skillModifyTimes) <= old)
                throw new Error('Máy chủ chưa xác nhận lượt cải tiến xe');
            apply(mgr, 'syncSkillModify', [reply, row.id, pos]); row.skill = reply.skill; count++;
        }
        return P.done(count, 'cải tiến xe');
    });
    register('farm', 'Nông trại: thu hoạch và trồng', ['action_farm'], [P.boolOption('sow', 'Trồng lại sau thu hoạch', true)], async function (ctx) {
        var mgr = P.instance(ctx, 'FarmMgr'), count = 0;
        async function read() {
            var response = await P.accept(ctx, 'S_FARMLAND_AREA', {});
            P.list(response.unlockArea); apply(mgr, 'syncUnlockArea', [response.unlockArea]); return response.unlockArea;
        }
        var rows = await read(), mature = rows.filter(function (row) { return row.mature === true; });
        if (mature.length) {
            var collected = await P.accept(ctx, 'S_FARMLAND_COLLECT', {});
            if (!P.list(collected.areaProduct).length) throw new Error('Chưa nhận được sản lượng thu hoạch');
            rows = await read();
            if (mature.some(function (old) { return rows.some(function (now) { return now.areaId === old.areaId && now.mature; }); }))
                throw new Error('Chưa xác nhận đất đã thu hoạch');
            count += mature.length;
        }
        if (ctx.options.sow) {
            var db = ctx.require('DBUtil').DBUtil, util = ctx.require('FarmUtil').farmUtil;
            var planting = rows.filter(function (row) { return Number(mgr.model.getAreaState(row.areaId)) === 2; }).map(function (row) {
                var area = db.getFarmlandArea(row.areaId), crop = area && util.findNewCorpBy(area.farmlandType);
                if (!crop) throw new Error('Không tìm được cây trồng đã mở');
                return {areaId: P.integer(row.areaId, 1), cropsId: P.integer(crop.id, 1)};
            });
            if (planting.length) {
                await P.accept(ctx, 'S_FARMLAND_PLANT', {plant: planting}); rows = await read();
                if (!planting.every(function (p) { return rows.some(function (r) { return r.areaId === p.areaId && r.cropsId === p.cropsId && Number(r.startSecond) > 0; }); }))
                    throw new Error('Chưa xác nhận cây đã trồng');
                count += planting.length;
            }
        }
        return P.done(count, 'xử lý ô đất', 'Cây đang trồng hoặc chưa có đất trống');
    });
    register('studio', 'Trường quay Studio', ['action_studio'], [
        P.boolOption('quick', 'Quay nhanh bằng lượt hiện có', false), P.boolOption('restart', 'Bắt đầu kịch bản mới', true),
        P.numOption('shots', 'Số lượt quay tối đa mỗi phòng', 100, 10000)
    ], async function (ctx) {
        var mgr = P.instance(ctx, 'FilmMgr');
        var data = P.ret(await P.call(ctx, 'FilmNetUtil', 'getFilmsData', [false])), rows = P.list(data.studios), count = 0;
        apply(mgr, 'synFilmsData', [data]);
        for (var i = 0; i < rows.length; i++) {
            ctx.check(); var current = rows[i], index = P.integer(current.studioIndex);
            if (Number(current.state) === 0) continue;
            if (Number(current.state) === 2 && ctx.options.quick && Number(current.shotNum) > 0) {
                var before = Number(current.progress), shots = Math.min(P.integer(current.shotNum), ctx.options.shots);
                if (shots) {
                    current = studio(await P.call(ctx, 'FilmNetUtil', 'shoot', [index, shots, false]), index);
                    if (!(Number(current.progress) > before || Number(current.state) === 3)) throw new Error('Lượt quay chưa tăng tiến độ');
                    count++;
                }
            }
            if (Number(current.state) === 3) {
                var reply = P.ret(await P.call(ctx, 'FilmNetUtil', 'completeShoot', [index, false]));
                if (!reply.telecast || !reply.telecast.id) throw new Error('Chưa nhận được phim hoàn thành');
                current = studio(reply, index); count++;
            }
            if (Number(current.state) === 1 && ctx.options.restart) {
                current = studio(await P.call(ctx, 'FilmNetUtil', 'startShoot', [index, ctx.require('FilmConfig').multipleType.normal, false]), index);
                if (Number(current.state) !== 2) throw new Error('Trường quay chưa bắt đầu');
                count++;
            }
            apply(mgr, 'synStudio', [current]);
        }
        return P.done(count, 'xử lý trường quay', 'Các trường quay đang làm việc');
    });
})(typeof window !== 'undefined' ? window : globalThis);
