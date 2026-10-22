/* Logistics events and identifiers come from the current map/configuration.
 * Search already awards buff/box/gift events; only native interactive events
 * receive HANDLE_EVENT. Never unlock a paid auto mode or fabricate event IDs. */
(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    P.logisticsEventKey = function (row) {
        return P.integer(row.eventId, 1) + ':' + (row.monster ? P.id(row.monster.monsterId) : row.team ? P.id(row.team.id) : 'trap');
    };
    P.register({id: 'tranh_doat_mo_khoang', name: 'Tranh đoạt mỏ khoáng', group: 'Sự kiện', desktop: ['action_tranh_doat_mo_khoang'],
        options: [P.numOption('searches', 'Số lần tìm kiếm tối đa', 50, 500), P.numOption('joins', 'Số đội tham gia tối đa', 5, 20),
            P.boolOption('escape', 'Dùng thể lực hiện có để thoát bẫy', true)], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1059], ['tranh đoạt mỏ', 'mỏ khoáng']); if (!act) return P.skip('Tranh đoạt mỏ khoáng chưa mở');
        var id = P.activityId(act), mgr = P.instance(ctx, 'ActivityLogisticsMgr'), data = mgr.getData(act), common = mgr.getCommonData(act), scene = mgr.getSceneData(act, 1);
        var total = 0, searches = 0, joined = 0, handled = 0, entered = false;
        async function send(name, body) { return P.ret(await P.packet(ctx, 'S_LOGISTICS_' + name, Object.assign({activityId: id}, body || {}))); }
        data.syncConfig(await send('CONFIG'));
        var eligible = await send('UNION'); data.syncUnionEligible(eligible);
        if (eligible.hasEligible !== true) return P.skip('Hội chưa đủ điều kiện tham gia mỏ khoáng');
        total += await P.claimEventFree(ctx, act, [105910100]);
        async function info() {
            var r = await send('INFO');
            if (!r.pveInfo) throw new Error('Chưa đọc được thể lực/năng lực khai thác');
            P.integer(r.pveInfo.power); P.number(r.pveInfo.ability); P.list(r.pveInfo.box);
            common.setInfoData(r); scene.syncInfo(r); return r;
        }
        async function map() {
            var r = await send('ENTER_SCENE'); entered = true;
            if (!r.map) throw new Error('Chưa đọc được bản đồ mỏ');
            P.list(r.map.myEvent); P.integer(r.level, 1); P.integer(r.exp);
            common.setPveEnterSceneData(r); scene.syncPveEnterScene(r); return r;
        }
        function events(state) { return state.map.myEvent.concat(state.pveEvent ? [state.pveEvent] : []); }
        async function process(state) {
            for (var i = 0; i < 200; i++) {
                ctx.check();
                var rows = events(state), chosen = null, param = null;
                for (var j = 0; j < rows.length; j++) {
                    var row = rows[j], cfg = data.getEventConfig(row.eventId); if (!cfg) throw new Error('Chưa có cấu hình sự kiện trên bản đồ mỏ');
                    var type = Number(cfg.eventType);
                    if ([1, 4, 5].indexOf(type) < 0) continue;
                    if (type === 1 && row.monster && P.number(row.monster.blood) <= P.number(common.myPveAbility)) { chosen = row; param = P.id(row.monster.monsterId); }
                    if (type === 5 && row.team && row.team.captain && row.team.captain.player && String(row.team.captain.player.userId) === ctx.uid && Number(row.team.state) === 0) {
                        var ability = P.number(row.team.captain.ability) + P.list(row.team.member).reduce(function (n, m) { return n + P.number(m.ability); }, 0);
                        if (row.team.monster && ability >= P.number(row.team.monster.totalBlood)) { chosen = row; param = P.id(row.team.id); }
                    }
                    if (type === 4) {
                        var cost = P.number(common.configEnergyCost) * P.number(data.configTrapPowerScale);
                        if (!ctx.options.escape || common.energy < cost) return {state: state, trapped: true};
                        chosen = row; param = '1';
                    }
                    if (chosen) break;
                }
                if (!chosen) return {state: state, trapped: false};
                var eventKey = P.logisticsEventKey(chosen), reply = await send('HANDLE_EVENT', {eventId: P.integer(chosen.eventId, 1), param: param});
                var chosenType = Number(data.getEventConfig(chosen.eventId).eventType);
                if ([1, 5].indexOf(chosenType) >= 0 && (!reply.attack || typeof reply.attack.win !== 'boolean')) throw new Error('Chưa có kết quả đánh mỏ thực tế');
                common.syncPveHandleEvent(reply);
                state = await map();
                if (events(state).some(function (r) { return P.logisticsEventKey(r) === eventKey; })) throw new Error('Sự kiện mỏ vẫn còn trên máy chủ; dừng để tránh xử lý lặp');
                handled++; await info();
            }
            throw new Error('Bản đồ mỏ vượt giới hạn xử lý');
        }
        try {
            await info(); var state = await map();
            if (ctx.options.joins > 0) {
                var listing = await send('PVE_LIST', {type: 2, subType: 2, pageIndex: 0, pageSize: 0});
                var teams = P.list(listing.team), util = ctx.require('ActivityLogisticsUtil').logisticsUtil;
                var now = ctx.require('TimeUtil').TimeUtil.getServerTimeMs(), duration = P.number(util.getTeamTime(act)) * 1000;
                for (var t = 0; t < teams.length && joined < ctx.options.joins; t++) {
                    var team = teams[t];
                    if (!team.captain || !team.captain.player || String(team.captain.player.userId) === ctx.uid || Number(team.state) !== 0 || now >= P.number(team.createAt) + duration) continue;
                    if (P.list(team.member).some(function (m) { return m.player && String(m.player.userId) === ctx.uid; })) continue;
                    var r = await send('JOIN_TEAM', {teamId: P.id(team.id)});
                    if (!r.team || String(r.team.id) !== String(team.id) || !P.list(r.team.member).some(function (m) { return m.player && String(m.player.userId) === ctx.uid; })) throw new Error('Máy chủ chưa xác nhận nhân vật trong đội mỏ');
                    var used = P.integer(r.joinTeamTimes, 1); common.syncJoinTeamTimes(used); joined++;
                    if (used >= P.integer(util.getJoinTeamMax(act), 1)) break;
                }
            }
            state = await map();
            var processed = await process(state); state = processed.state;
            while (!processed.trapped && searches < ctx.options.searches) {
                await info(); var power = P.integer(common.energy), cost = P.integer(common.configEnergyCost, 1);
                if (power < cost) break;
                var searched = await send('SEARCH', {count: 1});
                P.list(searched.result); if (!searched.result.length || Number(searched.power) > power - cost) throw new Error('Tìm mỏ chưa có kết quả hoặc chưa trừ thể lực');
                common.syncPveSearch(searched); searches++;
                var fresh = await info(); if (Number(fresh.pveInfo.power) !== Number(searched.power)) throw new Error('Thể lực khai thác chưa khớp dữ liệu mới');
                state = await map(); processed = await process(state); state = processed.state;
            }
            await info();
            var boxes = P.list(scene.goldSilverBoxDataList).slice();
            for (var b = 0; b < boxes.length; b++) {
                var box = boxes[b], cfg = data.getGoldSilverBoxConfigInfo(box.boxId); if (!cfg) throw new Error('Chưa đọc được khóa mở rương mỏ');
                var keyId = P.integer(cfg.keyItemId, 1), cost = P.integer(cfg.cost, 1), before = P.integer(box.num), num = Math.min(before, Math.floor(P.bag(ctx, keyId) / cost));
                if (!num) continue;
                var bagBefore = P.bag(ctx, keyId), opened = await send('OPEN_BOX', {boxId: P.integer(box.boxId, 1), num: num});
                if (!P.reward(opened)) throw new Error('Mở rương chưa có phần thưởng');
                await ctx.waitFor(function () { return P.bag(ctx, keyId) === bagBefore - num * cost; }, {timeoutMs: 10000});
                await info(); var left = scene.goldSilverBoxDataList.find(function (r) { return Number(r.boxId) === Number(box.boxId); });
                if ((left ? P.integer(left.num) : 0) !== before - num) throw new Error('Số rương còn lại chưa được lưu'); total += num;
            }
            var packageInfo = await info();
            if (typeof packageInfo.packageReward === 'string' && packageInfo.packageReward.trim()) {
                await send('CLEAN_PACKAGE_REWARD');
                var clean = await info(); if (clean.packageReward !== '') throw new Error('Danh sách thưởng mỏ chờ thu vẫn còn'); total++;
            }
            var packets = await send('LEVEL_REWARD_LIST'), pending = P.list(packets.redPacket).filter(function (r) { return !P.list(r.rewardList).some(function (p) { return String(p.userId) === ctx.uid; }); });
            if (pending.length) {
                var claimed = await send('MULTI_LEVEL_REWARD'); if (!P.reward(claimed)) throw new Error('Nhận mốc mỏ chưa có thưởng');
                var actual = P.list((await send('LEVEL_REWARD_LIST')).redPacket);
                if (pending.some(function (p) { return !actual.some(function (a) { return Number(a.level) === Number(p.level) && P.list(a.rewardList).some(function (r) { return String(r.userId) === ctx.uid; }); }); })) throw new Error('Mốc thưởng mỏ chưa được ghi nhận');
                total += pending.length;
            }
            total += await P.claimActivity(ctx, act); total += await P.claimWarOrder(ctx, act);
            if (processed.trapped) ctx.log('Đang mắc bẫy; chưa đủ điều kiện thoát bằng thể lực hiện có');
            return P.done(total + searches + joined + handled, 'tìm mỏ ' + searches + ' lần, xử lý ' + handled + ' sự kiện, tham gia ' + joined + ' đội', 'Chưa có lượt khai thác đủ điều kiện');
        } finally { if (entered) { ctx.check(); await send('EXIT_SCENE'); } }
    });
})(typeof window !== 'undefined' ? window : globalThis);
