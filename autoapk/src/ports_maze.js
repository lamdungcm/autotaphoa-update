/* Couple mazes: source rules from current CachCachCell and the native protocol.
 * Every board update comes from the server. No optimistic clearing of a cell. */
(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    P.findActivity = function (ctx, types, keywords, reject) {
        var rows = P.values(P.model(ctx, 'ActivityMgr').activityDict).filter(function (act) {
            var info = act.info || {}, state = act.state == null ? info.state : act.state;
            var name = String(act.name || info.activityName || act.title || '').toLowerCase();
            if (Number(state) !== 2 || reject && reject.test(name)) return false;
            return types.indexOf(Number(act.type || act.activityType || info.activityType)) >= 0 || keywords && keywords.some(function (word) { return name.indexOf(word) >= 0; });
        });
        rows.sort(function (a, b) { return Number(b.activityId) - Number(a.activityId); }); return rows[0] || null;
    };
    P.ensureTeam = async function (ctx, activityId) {
        var mgr = P.instance(ctx, 'TeamMgr'), cached = mgr.getSelfTeam(activityId);
        function joined(team) { return team && P.list(team.members).some(function (member) { return String(member.playerId) === ctx.uid; }); }
        function keep(team) {
            if (!joined(team)) throw new Error('Máy chủ chưa xác nhận nhân vật trong đội');
            mgr.syncActivityTeam(team); mgr.syncSelfActivityTeam(activityId, team); return team;
        }
        if (cached && Number(mgr.getSelfTeamId(activityId)) > 0) {
            var response = P.ret(await P.call(ctx, 'TeamNetUtil', 'searchActivityTeam', [activityId, cached.teamId, false], 'teamNetUtil'));
            return keep(response.team || response.teamTerm && response.teamTerm.team);
        }
        var reply = await P.accept(ctx, 'S_ACTIVITY_TEAM_LIST', {activityId: activityId, count: 30});
        var teams = P.list(reply.list).map(function (term) { return term.team; }).filter(Boolean);
        for (var i = 0; i < teams.length; i++) if (joined(teams[i])) return keep(teams[i]);
        var capacity = P.integer(mgr.getTeamMemberMax(activityId), 1);
        for (i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team.joinNeedApply !== false || Number(team.titleNeed) > 0 || P.list(team.members).length >= capacity) continue;
            reply = await P.packet(ctx, 'S_ACTIVITY_TEAM_JOIN', {activityId: activityId, teamId: team.teamId});
            if (reply.ret === 0) return keep(reply.team || reply.teamTerm && reply.teamTerm.team);
        }
        var maxName = P.integer(mgr.getTeamNameMax(activityId), 1);
        var createCount = P.integer(mgr.getCreateCount(activityId)), cost = P.number(mgr.getCostCount(activityId, createCount));
        if (cost > 0) throw new Error('Tạo đội đang cần phí; anh tạo/chọn đội trong game trước');
        var name = ('A' + ctx.uid.slice(-3) + Math.floor(Math.random() * 100)).slice(0, Math.min(6, maxName));
        reply = await P.accept(ctx, 'S_ACTIVITY_TEAM_CREATE', {activityId: activityId, name: name, joinNeedApply: false, titleNeed: 0});
        return keep(reply.team);
    };
    function key(pos) { return Number(pos.x) + ',' + Number(pos.y); }
    function flags(cell) {
        var id = Number(cell.eventId), type = String(cell.figureId || '');
        return {wall: id >= 14000 && id < 15000 || id >= 6000 && id < 7000 || ['1201', '1202', '1203', '1204', 'trap'].indexOf(type) >= 0,
            key: id === 3001 || id === 3002 || type === '1' || type === '2',
            box: !!cell.reward || id >= 5000 && id < 6000 || ['box1', 'box2', 'box3', '3'].indexOf(type) >= 0,
            water: id >= 11000 && id < 12000 || type === '1002' || type === 'water',
            special: id >= 9000 && id < 10000 || id >= 12000 && id < 13000 || ['901', '902', '1003', 'tp', 'portal'].indexOf(type) >= 0,
            buff: id >= 10000 && id < 11000 || type === '1001' || type === 'double',
            exit: [2001, 2101, 2102, 2103].indexOf(id) >= 0 || type === 'exit1' || type === 'exit2', fog: Number(cell.state) !== 0};
    }
    function pass(cell) {
        var f = flags(cell); return !f.wall && !f.fog && !f.box && !f.key && !f.water && !f.special && !(Number(cell.eventId) >= 5000 && Number(cell.eventId) < 13000);
    }
    function path(grid, start, target) {
        var wanted = key(target), queue = [[start]], seen = {}; seen[key(start)] = true;
        for (var head = 0; head < queue.length; head++) {
            var steps = queue[head], pos = steps[steps.length - 1], current = key(pos);
            if (current === wanted) return steps.slice(1);
            if (steps.length > 1 && (!grid[current] || !pass(grid[current]))) continue;
            [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (delta) {
                var next = {x: Number(pos.x) + delta[0], y: Number(pos.y) + delta[1]}, id = key(next);
                if (!seen[id] && grid[id] && !flags(grid[id]).wall) { seen[id] = true; queue.push(steps.concat([next])); }
            });
        }
        return null;
    }
    P.maze = {flags: flags, path: path};
    async function run(ctx, act) {
        if (!act) return P.skip('Sự kiện mê cung chưa mở');
        var activityId = P.activityId(act), count = 0, stalled = 0;
        if (ctx.options.autoTeam) await P.ensureTeam(ctx, activityId);
        var info = await P.accept(ctx, 'S_COUPLE_MAZE_INFO', {activityId: activityId});
        for (var turn = 0; turn < ctx.options.moves; turn++) {
            ctx.check(); P.fields(info, ['pos', 'map', 'power', 'layer']);
            var cells = P.list(info.map.cell), grid = {}, keys = P.list(info.map.keyEventId), power = P.integer(info.power), layer = Number(info.layer);
            cells.forEach(function (cell) { if (cell.pos) grid[key(cell.pos)] = cell; });
            var boxes = cells.filter(function (c) { return flags(c).box; });
            var cleared = info.map.canPass === true || info.mate && Number(info.mate.layer) > layer || keys.indexOf(3001) >= 0 && keys.indexOf(3002) >= 0 || layer % 5 === 0 && boxes.length === 0;
            var candidates = [];
            cells.forEach(function (cell) {
                var f = flags(cell); if (f.wall) return;
                var score = cleared && f.exit ? 0 : f.water ? 1 : f.key ? 2 : layer % 5 === 0 && f.box ? 3 : f.fog ? 4 : f.special ? 5 : f.box || f.buff ? 6 : 99;
                if (score === 99 || power === 0 && !(cleared && f.exit)) return;
                var route = path(grid, info.pos, cell.pos); if (!route) return;
                if (!power && route.some(function (pos) { return flags(grid[key(pos)]).fog; })) return;
                candidates.push({cell: cell, route: route, score: score});
            });
            candidates.sort(function (a, b) { return a.score - b.score || a.route.length - b.route.length; });
            if (!candidates.length) break;
            var target = candidates[0], oldSignature = JSON.stringify([info.layer, info.pos, info.map, info.power]);
            if (target.route.length) {
                var moved = await P.accept(ctx, 'S_COUPLE_MAZE_MOVE', {activityId: activityId, pos: target.route});
                if (!moved.pos || key(moved.pos) === key(info.pos) && !P.list(moved.changeCell).length) throw new Error('Mê cung chưa xác nhận di chuyển');
            } else if (flags(target.cell).exit && cleared) {
                var next = await P.accept(ctx, 'S_COUPLE_MAZE_ENTER_LAYER', {activityId: activityId});
                if (Number(next.layer) <= layer) throw new Error('Mê cung chưa chuyển tầng');
            } else {
                var body = {activityId: activityId, pos: target.cell.pos, operateType: 0};
                if (Number(target.cell.eventId) >= 9000 && Number(target.cell.eventId) < 10000)
                    body.lightPos = cells.filter(function (c) { return flags(c).fog && !flags(c).wall && !flags(c).exit; }).slice(0, 3).map(function (c) { return c.pos; });
                await P.accept(ctx, 'S_COUPLE_MAZE_HANDLE_EVENT', body);
            }
            info = await P.accept(ctx, 'S_COUPLE_MAZE_INFO', {activityId: activityId});
            var changed = JSON.stringify([info.layer, info.pos, info.map, info.power]) !== oldSignature;
            stalled = changed ? 0 : stalled + 1;
            if (stalled >= 2) throw new Error('Mê cung không thay đổi sau thao tác');
            if (changed) count++;
        }
        var result = P.done(count, 'xử lý bước mê cung', 'Mê cung hết thể lực hoặc chưa có đường đi phù hợp');
        result.message += ' · Tầng ' + P.integer(info.layer) + ', còn ' + P.integer(info.power) + ' thể lực'; return result;
    }
    var options = [P.numOption('moves', 'Số bước/thao tác tối đa', 250, 10000, 1), P.boolOption('autoTeam', 'Tìm hoặc tạo đội khi chưa có', true)];
    P.register({id: 'cach_cach_bo_tron', name: 'Cách Cách bỏ trốn', group: 'Sự kiện', desktop: ['action_cach_cach_bo_tron'], options: options, timeoutMs: 1800000}, function (ctx) {
        return run(ctx, P.findActivity(ctx, [1027, 1066], ['cách cách', 'cach cach', 'couplemaze'], /bạch xà|bach xa/));
    });
    P.register({id: 'bach_xa_truyen', name: 'Bạch Xà truyện', group: 'Sự kiện', desktop: ['action_bach_xa_truyen'], options: options, timeoutMs: 1800000}, function (ctx) {
        return run(ctx, P.findActivity(ctx, [1014], ['bạch xà', 'bach xa', 'thanh xà']));
    });
})(typeof window !== 'undefined' ? window : globalThis);
