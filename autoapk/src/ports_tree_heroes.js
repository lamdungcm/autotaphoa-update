(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    function village(ctx) { return P.instance(ctx, 'VillageMgr'); }
    function stores(ctx) {
        var db = ctx.require('DBUtil').DBUtil, v = village(ctx);
        return P.list(v.getOwnBuildingIdList()).map(Number).filter(function (id) { return P.instance(ctx, 'BuildingMgr').checkBuildingStatusOpened(id) && P.list(db.getStoreStaffListByBuildingId(id)).length > 0; });
    }
    P.catalogs.buildingsLoader = function (ctx) { return P.setCatalog(ctx, 'buildings', stores(ctx).map(function (id) { var row = ctx.require('DBUtil').DBUtil.getMainBuilding(id); return {id: String(id), name: P.name(ctx, row && row.name) || 'Cửa hàng ' + id}; })); };
    function assigned(ctx, id) { return P.list(village(ctx).getBuildingData(id).heroIdList).filter(function (n) { return Number(n) > 0; }).map(Number); }
    async function dispatch(ctx, id, heroes) {
        P.ret(await P.call(ctx, 'BuildingNetUtil', 'dispatchHero', [id, heroes, false]));
        await ctx.waitFor(function () {
            var actual = assigned(ctx, id).slice().sort(function (a, b) { return a - b; }), expected = heroes.slice().sort(function (a, b) { return a - b; });
            return JSON.stringify(actual) === JSON.stringify(expected);
        }, {timeoutMs: 5000, message: 'Cửa hàng chưa xác nhận danh sách nhân tài; dừng để tránh gán lặp'});
    }
    P.register({id: 'thao_lap_nhan_tai', name: 'Tháo / lắp nhân tài cửa hàng', group: 'Hằng ngày', desktop: ['action_thao_lap_nhan_tai'], options: [
        {key: 'mode', label: 'Thao tác', type: 'choice', choices: [{id: 'both', name: 'Tháo rồi lắp lại'}, {id: 'equip', name: 'Chỉ lắp ô trống'}, {id: 'unequip', name: 'Chỉ tháo'}], default: 'both'},
        P.idsOption('shops', 'Cửa hàng (trống = tất cả đã mở)', 'buildings')], timeoutMs: 600000}, async function (ctx) {
        var ids = stores(ctx).filter(function (id) { return !ctx.options.shops.length || ctx.options.shops.indexOf(String(id)) >= 0; }), changed = 0;
        if (ctx.options.mode !== 'equip') for (var i = 0; i < ids.length; i++) {
            if (assigned(ctx, ids[i]).length) { await dispatch(ctx, ids[i], []); changed++; }
        }
        if (ctx.options.mode !== 'unequip') {
            var heroMgr = P.instance(ctx, 'HeroMgr'), taskUtil = ctx.require('TaskUtil').TaskUtil, db = ctx.require('DBUtil').DBUtil;
            for (var j = 0; j < ids.length; j++) {
                var id = ids[j], current = assigned(ctx, id), slots = P.list(db.getStoreStaffListByBuildingId(id)).filter(function (row) { return taskUtil.isCompelte(row.unlockCondition); }).length;
                var used = {};
                P.list(village(ctx).getOwnBuildingIdList()).forEach(function (bid) { P.list(village(ctx).getBuildingData(bid).heroIdList).forEach(function (hid) { used[hid] = true; }); });
                var idle = P.ownedHeroes(ctx).filter(function (hid) { return hid !== 102421 && !used[hid] && Number(heroMgr.getHeroData(hid).buildingId) === 0; });
                var added = idle.slice(0, Math.max(0, slots - current.length));
                if (added.length) { await dispatch(ctx, id, current.concat(added)); changed++; }
            }
        }
        return P.done(changed, 'cập nhật cửa hàng', 'Danh sách nhân tài đã đúng cấu hình');
    });
    async function treeData(ctx) {
        var reply = P.ret(await P.packet(ctx, 'S_PLANT_TREE_DATA', {}));
        P.fields(reply, ['info', 'rewardInfo', 'touchTimes', 'sign', 'signDay', 'missionRewardIndex']);
        P.instance(ctx, 'TreePlantingMgr').getData().syncData(reply); return reply;
    }
    async function ownRewards(ctx, data) {
        var count = 0, treeId = P.integer(data.info.treeId, 1);
        for (var i = 0; i < data.rewardInfo.length; i++) {
            var gift = data.rewardInfo[i], uid = P.id(gift.uid);
            var reply = P.ret(await P.packet(ctx, 'S_PLANT_TREE_REWARD', {treeId: treeId, uid: uid}));
            if (!P.reward(reply)) throw new Error('Chưa xác nhận thưởng thu hoạch cây');
            var fresh = await treeData(ctx);
            if (fresh.rewardInfo.some(function (row) { return String(row.uid) === uid; })) throw new Error('Quả cây vừa nhận vẫn còn trong danh sách');
            count++;
        }
        return count;
    }
    P.register({id: 'water_tree', name: 'Tưới cây / thu hoạch / thăm hội', group: 'Hằng ngày', desktop: ['action_water_tree'], options: [
        P.numOption('waterLimit', 'Số giọt nước tối đa', 100000, 1000000), P.boolOption('visit', 'Thăm và nhận quả cây thành viên hội', true),
        {key: 'targets', label: 'UID cây muốn thăm (trống = danh sách hội)', type: 'text', default: '', maxLength: 2000},
        P.numOption('members', 'Số thành viên thăm tối đa', 8, 100)], timeoutMs: 900000}, async function (ctx) {
        var data = await treeData(ctx), count = await ownRewards(ctx, data), mgr = P.instance(ctx, 'TreePlantingMgr');
        if (!data.sign) {
            var signed = P.ret(await P.packet(ctx, 'S_PLANT_TREE_SIGN', {}));
            var fresh = await treeData(ctx);
            if (!fresh.sign || Number(fresh.signDay) <= Number(data.signDay) || Number(signed.signDay) !== Number(fresh.signDay)) throw new Error('Cây chưa xác nhận điểm danh mới');
            data = fresh; count++;
        }
        var tasks = await api.fullClaims.claimTasks(ctx, 'TASK_TYPE_47', 'nhiệm vụ tưới cây'); count += tasks.count;
        var states = ctx.require('TaskConfig').EnumTaskState, rows = ctx.require('TaskUtil').TaskUtil.getTreePlantingTaskList();
        var received = P.list(rows).filter(function (row) { return row.state === states.received; }).length;
        var stages = P.list(mgr.model.configTaskStageRewardParam), canClaim = stages.some(function (text, index) { return index > Number(data.missionRewardIndex) && received >= P.integer(text.split('=')[0]); });
        if (canClaim) {
            var claimed = P.ret(await P.packet(ctx, 'S_PLANT_TREE_MISSION_REWARD', {})), previous = Number(data.missionRewardIndex);
            data = await treeData(ctx);
            if (!(Number(data.missionRewardIndex) > previous) || Number(claimed.missionRewardIndex) !== Number(data.missionRewardIndex)) throw new Error('Mốc nhiệm vụ cây chưa được xác nhận');
            count++;
        }
        if (ctx.options.visit && ctx.options.members && Number(data.touchTimes) > 0) {
            var wanted = ctx.options.targets.split(/[\s,;]+/).filter(Boolean).map(P.id);
            var members = wanted.length ? wanted.map(function (id) { return {member: {playerBaseData: {userId: id}}, ableTouch: true}; }) :
                P.list(P.ret(await P.packet(ctx, 'S_PLANT_TREE_UNION_MEMBER_LIST', {})).members);
            var seen = {};
            members = members.filter(function (row) { var id = P.id(row.member && row.member.playerBaseData && row.member.playerBaseData.userId); if (seen[id] || id === ctx.uid || !row.ableTouch) return false; seen[id] = true; return true; }).slice(0, ctx.options.members);
            for (var j = 0; j < members.length && Number(data.touchTimes) > 0; j++) {
                var uid = P.id(members[j].member.playerBaseData.userId), visit = P.ret(await P.packet(ctx, 'S_PLANT_TREE_VISIT', {userId: uid}));
                var gifts = P.list(visit.rewardInfo).filter(function (row) { return row.ableTouch === true && !row.trigger; });
                for (var k = 0; k < gifts.length && Number(data.touchTimes) > 0; k++) {
                    var previousTouches = Number(data.touchTimes), reply = P.ret(await P.packet(ctx, 'S_PLANT_TREE_TOUCH', {userId: uid, rewardUid: P.id(gifts[k].uid)}));
                    P.list(reply.rewardInfo); data = await treeData(ctx);
                    if (Number(data.touchTimes) !== previousTouches - 1) throw new Error('Lượt thăm cây chưa giảm; dừng để tránh nhận lặp');
                    count++;
                }
            }
        }
        var waterId = P.integer(ctx.require('TreePlantingUtil').treePlantingUtil.getWaterId(), 1);
        var water = Math.min(P.bag(ctx, waterId), ctx.options.waterLimit);
        if (water) {
            var before = P.bag(ctx, waterId), treeId = P.integer(data.info.treeId, 1);
            var watered = P.ret(await P.packet(ctx, 'S_PLANT_TREE_WATER', {treeId: treeId, num: water}));
            if (!watered.info || Number(watered.info.treeId) !== treeId) throw new Error('Kết quả tưới không khớp cây đang trồng');
            await ctx.waitFor(function () { return P.bag(ctx, waterId) === before - water; }, {timeoutMs: 5000, message: 'Túi chưa xác nhận lượng nước đã tưới'});
            data = await treeData(ctx); count += water; count += await ownRewards(ctx, data);
        }
        return P.done(count, 'tưới / nhận thưởng / thăm cây', 'Cây chưa có quả, nước hoặc nhiệm vụ đủ điều kiện');
    });
})(typeof window !== 'undefined' ? window : globalThis);
