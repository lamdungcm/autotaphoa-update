/* Native sources: QuadMaze{Config,Model,NetUtil,Util}, ActivityXiyou{Config,
 * Model,NetUtil}, ActivityBullDemon{NetUtil,Util,Model}, BullDemonGrid and
 * ActivityBullDemonObstacle in script_index_decompressed.js (current source).
 * Mutation ACKs are followed by fresh server reads. No guessed activity IDs,
 * task/weapon IDs, optimistic stamina subtraction, or UI callbacks as receipts. */
(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    function k(pos) { return Number(pos.x) + ',' + Number(pos.y); }
    function same(a, b) { return !!a && !!b && k(a) === k(b); }
    function rows(value) { return P.list(value); }
    function signature(value) { return JSON.stringify(value); }
    function open(ctx, act, prefix) {
        if (!act) return false;
        var util = ctx.require(prefix)[prefix];
        if (util && typeof util.checkStartGameTimeOpen === 'function') return util.checkStartGameTimeOpen(act);
        var hour = P.vnClock().getUTCHours(); return hour >= 10 && hour < 22;
    }
    async function extras(ctx, act) {
        var n = 0;
        if (ctx.options.freeGift && P.claimEventFree) n += await P.claimEventFree(ctx, act, []);
        if (ctx.options.claimTasks && P.claimActivity) n += await P.claimActivity(ctx, act);
        return n;
    }
    function reward(reply, text) { if (!P.reward(reply)) throw new Error(text || 'Máy chủ chưa trả thưởng thực tế'); }
    function changed(before, after, message) { if (signature(before) === signature(after)) throw new Error(message); }
    function quadType(config) {
        var t = Number(config.eventType), s = Number(config.subEventType);
        if (t === 1) return s === 1 ? 'floor' : s === 2 ? 'entry' : 'wall';
        if (t === 2) return ({1: 'exit', 2: 'task', 3: 'lottery', 4: 'fire'})[s] || 'wall';
        if (t === 3) return ({0: 'floor', 1: 'monster', 2: 'boss', 3: 'monster', 4: 'curse', 5: 'pack', 6: 'box', 7: 'trap', 8: 'key'})[s] || 'wall';
        return 'wall';
    }
    function quadGrid(info, configs) {
        var grid = {};
        rows(info.map.cell).forEach(function (cell) {
            var config = configs[Number(cell.eventId)];
            if (!config) throw new Error('Thiện Nữ chưa có cấu hình của ô bản đồ');
            grid[k(cell.pos)] = {cell: cell, config: config, type: quadType(config), fog: Number(cell.state) !== 0};
        }); return grid;
    }
    function quadPath(grid, start, target, adjacent) {
        var queue = [[start]], seen = {}; seen[k(start)] = true;
        function goal(pos) { return adjacent ? Math.abs(pos.x - target.x) + Math.abs(pos.y - target.y) === 1 : same(pos, target); }
        for (var index = 0; index < queue.length; index++) {
            var path = queue[index], current = path[path.length - 1], item = grid[k(current)];
            if (goal(current)) return path.slice(1);
            if (path.length > 1 && (!item || item.fog || ['floor', 'entry', 'exit', 'fire', 'pack'].indexOf(item.type) < 0)) continue;
            [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
                var next = {x: Number(current.x) + d[0], y: Number(current.y) + d[1]}, id = k(next), row = grid[id];
                if (seen[id] || !row || row.type === 'wall') return;
                seen[id] = true; queue.push(path.concat([next]));
            });
        } return null;
    }
    P.quadMaze = {type: quadType, grid: quadGrid, path: quadPath};
    async function quad(ctx) {
        ctx.check();
        var act = P.findActivity(ctx, [1039], ['thiện nữ', 'thien nu', 'thiên nữ']);
        if (!act) return P.skip('Thiện Nữ U Hồn chưa mở');
        if (!ctx.require('QuadMazeUtil').QuadMazeUtil.checkOpenTime(act)) return P.skip('Thiện Nữ ngoài giờ hoạt động');
        var id = P.activityId(act), count = await extras(ctx, act), config = await P.accept(ctx, 'S_QUAD_MAZE_CONFIG', {activityId: id});
        P.fields(config, ['eventConfig', 'mapConfig']);
        var cfg = {}; rows(config.eventConfig).forEach(function (c) { cfg[c.id] = c; });
        if (ctx.options.autoTeam) await P.ensureTeam(ctx, id);
        var mgr = P.instance(ctx, 'QuadMazeMgr'), data = mgr.getData(act);
        data.syncConfig(config);
        async function update(symbol, body, allowed) {
            var reply = await P.packet(ctx, symbol, body);
            if (reply.ret !== 0 && allowed.indexOf(reply.ret) < 0) P.ret(reply);
            return reply;
        }
        async function read() {
            var info = await P.accept(ctx, 'S_QUAD_MAZE_INFO', {activityId: id});
            P.fields(info, ['layer', 'power', 'curPos', 'curBlood', 'map']); data.syncInfo(info); return info;
        }
        var info = await read(), firstLayer = Number(info.layer), limit = ctx.options.steps;
        for (var step = 0; step < limit && Number(info.layer) - firstLayer < ctx.options.layers; step++) {
            ctx.check();
            var grid = quadGrid(info, cfg), all = Object.keys(grid).map(function (key) { return grid[key]; }), scene = mgr.getMainSceneData(act), before = info;
            var exit = all.find(function (r) { return r.type === 'exit'; }), deadBoss = exit && exit.cell.boss && Number(exit.cell.boss.blood) <= 0;
            if (deadBoss && rows(exit.cell.boss.killRewardUserId).map(String).indexOf(ctx.uid) < 0) {
                var claimed = await P.accept(ctx, 'S_QUAD_MAZE_BOSS_REWARD', {activityId: id}); reward(claimed);
                if (rows(claimed.killRewardUserId).map(String).indexOf(ctx.uid) < 0) throw new Error('Thiện Nữ chưa xác nhận nhân vật nhận quà Boss');
            } else if (scene.isCanPass()) {
                if (!exit) throw new Error('Thiện Nữ không xác định được cửa ra');
                if (!same(info.curPos, exit.cell.pos)) {
                    var exitPath = quadPath(grid, info.curPos, exit.cell.pos, false);
                    if (!exitPath || !exitPath.length) throw new Error('Thiện Nữ chưa có đường đến cửa ra');
                    var exitMove = await P.accept(ctx, 'S_QUAD_MAZE_MOVE', {activityId: id, path: exitPath});
                    if (!exitMove.endCell || !same(exitMove.endCell.pos, exit.cell.pos)) throw new Error('Thiện Nữ chưa xác nhận đã đến cửa ra');
                } else {
                    var advanced = await P.accept(ctx, 'S_QUAD_MAZE_NEXT_LAYER', {activityId: id});
                    if (advanced.layer == null || Number(advanced.layer) <= Number(info.layer)) throw new Error('Thiện Nữ chưa xác nhận tầng mới');
                }
            } else if (Number(info.curBlood) <= 0) {
                var revived = await P.accept(ctx, 'S_QUAD_MAZE_REVIVE', {activityId: id});
                if (!(Number(revived.blood) > 0) || !revived.revivePos) throw new Error('Thiện Nữ chưa xác nhận hồi sinh');
            } else if (info.taskInfo && scene.getTaskStateWithEventId(info.taskInfo.eventId, ctx.uid) === 2) {
                reward(await P.accept(ctx, 'S_QUAD_MAZE_TASK_NPC_REWARD', {activityId: id}));
            } else if (scene.isPlayerInTrap()) {
                var trap = all.find(function (r) { return r.type === 'trap' && same(r.cell.pos, info.curPos); });
                if (!trap) throw new Error('Thiện Nữ không xác định được ô bẫy hiện tại');
                await update('S_QUAD_MAZE_HANDLE_EVENT', {activityId: id, pos: trap.cell.pos, operation: 1}, [8972, 8998]);
            } else {
                if (Number(info.power) <= 0) break;
                var boss = all.filter(function (r) { return r.type === 'boss' && r.cell.boss && Number(r.cell.boss.blood) > 0; });
                var tombs = all.filter(function (r) { return Number(r.config.eventType) === 5; }), candidates = [];
                all.forEach(function (row) {
                    var isBoss = row.type === 'boss', isMonster = row.type === 'monster';
                    if (boss.length && !isBoss || row.type === 'wall' || row.type === 'pack' || row.type === 'curse' || row.type === 'fire' || row.type === 'exit' || row.type === 'entry') return;
                    if (!row.fog && ['monster', 'boss', 'box', 'key', 'task', 'lottery'].indexOf(row.type) < 0) return;
                    if (row.type === 'task' && Number(row.cell.belongId) > 0) return;
                    if (isMonster && row.cell.monster && rows(row.cell.monster.attackInfo).filter(function (a) { return a.attacker && String(a.attacker.userId) === ctx.uid; }).length >=
                        P.integer(ctx.require('QuadMazeUtil').QuadMazeUtil.getAttackLimit(act), 1)) return;
                    var nearTomb = tombs.some(function (t) { return Math.abs(t.cell.pos.x - row.cell.pos.x) <= 1 && Math.abs(t.cell.pos.y - row.cell.pos.y) <= 1; });
                    var adjacent = isBoss;
                    var route = quadPath(grid, info.curPos, row.cell.pos, adjacent);
                    if (route) candidates.push({row: row, path: route, score: isBoss ? 0 : row.type === 'key' ? 1 : row.fog && nearTomb ? 2 : row.type === 'monster' ? 3 : row.fog ? 4 : 5});
                });
                candidates.sort(function (a, b) { return a.score - b.score || a.path.length - b.path.length; });
                if (!candidates.length) break;
                var choice = candidates[0];
                if (choice.path.length) {
                    var moved = await update('S_QUAD_MAZE_MOVE', {activityId: id, path: choice.path}, [8979]);
                    if (moved.ret === 0 && !moved.endCell && !rows(moved.movePath).length && !rows(moved.changeCell).length) throw new Error('Thiện Nữ chưa xác nhận bước di chuyển');
                } else {
                    if (choice.row.type === 'boss') {
                        var lastAttack = rows(choice.row.cell.boss.attackInfo).filter(function (a) { return a.attacker && String(a.attacker.userId) === ctx.uid; })
                            .reduce(function (time, a) { return Math.max(time, P.number(a.attackAt)); }, 0);
                        if (lastAttack) {
                            var interval = P.number(ctx.require('QuadMazeUtil').QuadMazeUtil.getBossAttackInterval(act));
                            var now = P.number(ctx.require('TimeUtil').TimeUtil.getServerTime()), cooldown = lastAttack + interval - now;
                            while (cooldown > 0) { await ctx.sleep(Math.min(cooldown * 1000 + 50, 120000)); ctx.check(); now = P.number(ctx.require('TimeUtil').TimeUtil.getServerTime()); cooldown = lastAttack + interval - now; }
                        }
                    }
                    var operation = choice.row.type === 'task' ? P.integer(String(choice.row.config.paramList).split('=')[0], 1) : 0;
                    var handled = await update('S_QUAD_MAZE_HANDLE_EVENT', {activityId: id, pos: choice.row.cell.pos, operation: operation}, [8972, 8998]);
                    if (handled.ret === 0 && !handled.attackResult && !handled.reward && !rows(handled.changeCell).length && !handled.endPos) throw new Error('Thiện Nữ chưa trả kết quả sự kiện');
                }
            }
            info = await read(); changed(before, info, 'Thiện Nữ không thay đổi sau thao tác; đã dừng để tránh lặp'); count++;
        }
        if (ctx.options.claimTasks && P.claimActivity) count += await P.claimActivity(ctx, act);
        if (ctx.options.claimTasks && P.claimWarOrder) count += await P.claimWarOrder(ctx, act);
        var result = P.done(count, 'xử lý Thiện Nữ', 'Thiện Nữ hết thể lực hoặc chưa có ô phù hợp');
        result.message += ' · Tầng ' + P.integer(info.layer) + ', còn ' + P.integer(info.power) + ' thể lực'; return result;
    }
    async function xiyou(ctx) {
        ctx.check();
        var act = P.findActivity(ctx, [1043], ['tây du', 'tay du']);
        if (!act) return P.skip('Tây Du Ký chưa mở');
        var mgr = P.instance(ctx, 'ActivityXiyouMgr');
        if (!mgr.checkHotelOpen(act)) return P.skip('Tây Du Ký ngoài giờ khám phá');
        var id = P.activityId(act), count = await extras(ctx, act);
        if (ctx.options.autoTeam) await P.ensureTeam(ctx, id);
        var config = await P.accept(ctx, 'S_XIYOU_CONFIG', {activityId: id});
        P.fields(config, ['eventConfig', 'regionConfig', 'weaponConfig', 'weaponLevelConfig', 'taskConfig']);
        var data = mgr.getXiyouData(id); data.syncConfig(config);
        async function read() {
            var info = await P.accept(ctx, 'S_XIYOU_INFO', {activityId: id, clearBeAttack: false});
            P.fields(info, ['myRegion', 'power', 'blood']); data.syncInfo(info); return info;
        }
        async function weapons() {
            var reply = await P.accept(ctx, 'S_XIYOU_WEAPON', {activityId: id});
            data.westModule.syncAllWeapon(rows(reply.weapon)); return reply.weapon;
        }
        var info = await read(), upgrades = 0;
        for (var turn = 0; turn < ctx.options.steps; turn++) {
            ctx.check(); var before = info, west = data.westModule, mutated = false;
            if (ctx.options.upgradeWeapons && upgrades < ctx.options.upgrades) {
                var own = await weapons(), candidate = own.find(function (w) { return west.checkWeaponUpgrade(Number(w.weaponId)); });
                if (candidate) {
                    await P.accept(ctx, 'S_XIYOU_WEAPON_UPGRADE', {activityId: id, weaponId: Number(candidate.weaponId)});
                    var updated = (await weapons()).find(function (w) { return Number(w.weaponId) === Number(candidate.weaponId); });
                    if (!updated || Number(updated.level) <= Number(candidate.level)) throw new Error('Tây Du chưa xác nhận cấp pháp bảo tăng');
                    upgrades++; count++; continue;
                }
            }
            if (west.hasTaskReward()) {
                var taskId = P.integer(info.task.taskId, 1), oldProgress = Number(info.task.progress), claim = await P.accept(ctx, 'S_XIYOU_GAIN_TASK', {activityId: id, taskId: taskId}); reward(claim);
                info = await read();
                if (info.task && Number(info.task.taskId) === taskId && Number(info.task.state) === 0 && !(Number(info.task.progress) < oldProgress)) throw new Error('Tây Du chưa xác nhận nhiệm vụ đã nhận thưởng');
                count++; continue;
            }
            var nextId = Number(west.getNextRegionId()), regions = rows(config.regionConfig).map(function (c) { return Number(c.id); }).sort(function (a, b) { return a - b; });
            var maxId = regions[Math.min(ctx.options.maxRegion, regions.length) - 1];
            if (nextId > 0 && nextId <= maxId && west.checkNextRegionUnlock()) {
                await P.accept(ctx, 'S_XIYOU_ENTER_REGION', {activityId: id, regionId: nextId});
                info = await read(); if (Number(info.myRegion) !== nextId) throw new Error('Tây Du chưa xác nhận khu vực mới'); count++; continue;
            }
            if (info.waitEvent && Number(info.waitEvent.eventId) > 0) {
                var event = info.waitEvent, eventConfig = rows(config.eventConfig).find(function (c) { return Number(c.id) === Number(event.eventId); });
                if (!eventConfig) throw new Error('Tây Du chưa có cấu hình sự kiện hiện tại');
                var type = Number(eventConfig.eventType);
                if (type !== 1 && type !== 2) throw new Error('Tây Du gặp sự kiện chờ không có thao tác native xác thực');
                var operation = type === 2 && !ctx.options.attackPlayers ? '1' : '0';
                var resolved = await P.accept(ctx, 'S_XIYOU_HANDLE_EVENT', {activityId: id, param: operation});
                if (operation === '0' && (!resolved.attackResult || !(Number(resolved.attackResult.damage) > 0))) throw new Error('Tây Du chưa xác nhận sát thương');
                mutated = true;
            } else {
                var region = rows(config.regionConfig).find(function (r) { return Number(r.id) === Number(info.myRegion); });
                if (!region) throw new Error('Tây Du chưa có cấu hình khu vực hiện tại');
                var energyCost = P.integer(region.energy);
                if (Number(info.power) < energyCost) break;
                var searched = await P.accept(ctx, 'S_XIYOU_SEARCH', {activityId: id});
                if (searched.power == null || energyCost > 0 && Number(searched.power) >= Number(info.power) || energyCost === 0 && !searched.event && !searched.reward)
                    throw new Error('Tây Du chưa xác nhận kết quả lượt khám phá');
                mutated = true;
            }
            info = await read();
            if (mutated) { changed(before, info, 'Tây Du không thay đổi trạng thái sau thao tác'); count++; }
        }
        if (ctx.options.claimTasks && P.claimActivity) count += await P.claimActivity(ctx, act);
        if (ctx.options.claimTasks && P.claimWarOrder) count += await P.claimWarOrder(ctx, act);
        var result = P.done(count, 'xử lý Tây Du Ký', 'Tây Du Ký hết thể lực hoặc chưa có lượt phù hợp');
        result.message += ' · Khu vực ' + P.integer(info.myRegion) + ', còn ' + P.integer(info.power) + ' thể lực'; return result;
    }
    /* Bull Demon native battle type is a game mode (0 for normal/hard), never a
     * turn number. Paths start at the real player's block; the request excludes
     * that first block. Monster HP and prison HP consume accumulated combo. */
    function bullPath(ctx, act, game, config, util, budget) {
        var grid = {}, start, terrain = {}, visited = {}, best = [], nodes = 0;
        rows(game.block).forEach(function (block) { grid[k(block.pos)] = block; if (Number(block.type) === 1) start = block; });
        if (!start) throw new Error('Ngưu Ma không xác định được vị trí nhân vật');
        String(config.terrain || '0').split('|').forEach(function (part) {
            if (part === '0') return; var split = part.split('='), pieces = String(split[1]).split('#'), type = Number(pieces[0]);
            if ([200, 300, 501].indexOf(type) >= 0) terrain[split[0]] = {type: type, hp: Number(pieces[1])};
        });
        function dfs(path, previousColor, spent) {
            if (++nodes % 256 === 0) ctx.check();
            if (path.length - 1 > best.length) best = path.slice(1);
            if (nodes >= budget || path.length >= 29) return;
            var last = path[path.length - 1], combo = path.length - 1 - spent;
            for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
                if (nodes >= budget) return;
                if (!dx && !dy) continue;
                var id = (Number(last.pos.x) + dx) + ',' + (Number(last.pos.y) + dy), block = grid[id], t = terrain[id];
                if (!block || visited[id] || Number(block.type) === 1 || Number(block.type) === 4 || Number(block.state) === 3) continue;
                if (t && (t.type === 200 || t.type === 501 && Number(block.state) !== 4)) continue;
                var color = Number(util.getMonsterColorById(act, block)), prison = t && t.type === 300 && Number(block.state) === 1 ? P.integer(t.hp) : 0;
                var hp = Number(block.type) === 2 && block.monster ? P.integer(block.monster.hp) : 0;
                if (combo < hp || combo < prison || previousColor && color && previousColor !== color) continue;
                visited[id] = true; dfs(path.concat([block]), color, spent + hp + prison); delete visited[id];
            }
        }
        visited[k(start.pos)] = true; dfs([start], Number(util.getMonsterColorById(act, start)), 0);
        return best.map(function (b) { return b.pos; });
    }
    P.bullDemonPath = bullPath;
    async function bull(ctx) {
        ctx.check();
        var act = P.findActivity(ctx, [1058], ['ngưu ma', 'nguu ma']);
        if (!act) return P.skip('Ngưu Ma Giáng Thế chưa mở');
        if (!open(ctx, act, 'ActivityBullDemonUtil')) return P.skip('Ngưu Ma ngoài giờ hoạt động');
        var id = P.activityId(act), mgr = P.instance(ctx, 'ActivityBullDemonMgr'), util = ctx.require('ActivityBullDemonUtil').ActivityBullDemonUtil;
        var config = await P.accept(ctx, 'S_BULL_DEMON_CONFIG', {activityId: id});
        P.fields(config, ['chapterConfig', 'swordConfig']); mgr.syncConfig(config);
        var levels = rows(config.chapterConfig).filter(function (c) { return Number(c.type) === 1 || Number(c.type) === 2; }).sort(function (a, b) { return Number(a.id) - Number(b.id); });
        if (!levels.length) throw new Error('Ngưu Ma chưa có danh sách ải thực tế');
        var count = await extras(ctx, act), sweeps = 0, upgrades = 0;
        async function read() {
            var info = await P.accept(ctx, 'S_BULL_DEMON_INFO', {activityId: id});
            P.fields(info, ['info', 'power']); P.fields(info.info, ['maxLevelId', 'swordLevel']); mgr.syncInfo(info); return info;
        }
        var info = await read();
        for (var turn = 0; turn < ctx.options.steps; turn++) {
            ctx.check(); var max = Number(info.info.maxLevelId), next = levels.find(function (l) { return Number(l.id) > max; });
            var currentSword = rows(config.swordConfig).find(function (s) { return Number(s.level) === Number(info.info.swordLevel); });
            var nextSword = rows(config.swordConfig).find(function (s) { return Number(s.level) === Number(info.info.swordLevel) + 1; });
            var itemId = ctx.options.upgradeSword ? P.integer(act.getConfigNumber('BULLDEMON_KUNGFU_UPGRADE_ITEM_ID'), 1) : 0;
            if (ctx.options.upgradeSword && upgrades < ctx.options.upgrades && currentSword && nextSword && P.bag(ctx, itemId) >= P.integer(currentSword.cost)) {
                var up = await P.accept(ctx, 'S_BULL_DEMON_UPGRADE_SWORD', {activityId: id});
                if (up.swordLevel == null || Number(up.swordLevel) <= Number(info.info.swordLevel)) throw new Error('Ngưu Ma chưa xác nhận cấp lực chiến tăng');
                var oldLevel = Number(info.info.swordLevel); info = await read();
                if (Number(info.info.swordLevel) <= oldLevel) throw new Error('Ngưu Ma đọc lại chưa có cấp lực chiến mới');
                upgrades++; count++; continue;
            }
            if (info.levelGame) {
                var game = info.levelGame, level = levels.find(function (l) { return Number(l.id) === Number(game.levelId); });
                if (!level) throw new Error('Ngưu Ma trận hiện tại không thuộc ải thường/khó');
                P.fields(game, ['bossHp', 'playerHp', 'rounds', 'block']);
                if (Number(game.bossHp) === 0 || Number(game.rounds) >= Number(level.rounds) || Number(game.playerHp) === 0) {
                    var end = await P.accept(ctx, 'S_BULL_DEMON_END_LEVEL', {activityId: id});
                    if (!end.info) throw new Error('Ngưu Ma chưa có kết quả kết thúc trận');
                    var oldMax = Number(info.info.maxLevelId); info = await read();
                    if (info.levelGame) throw new Error('Ngưu Ma chưa xác nhận đã kết thúc trận');
                    if (Number(game.levelId) > oldMax && Number(info.info.maxLevelId) < Number(game.levelId)) throw new Error('Ngưu Ma trận đã kết thúc nhưng chưa vượt được ải');
                    count++; continue;
                }
                var angerCost = Number(act.getConfigNumber('BULLDEMON_PLAYER_SKILL_NEED_ANGER'));
                if (ctx.options.useSkill && angerCost > 0 && Number(game.playerAnger) >= angerCost && !mgr.model.getIsSilent(game.levelId)) {
                    var skill = await P.accept(ctx, 'S_BULL_DEMON_USE_SKILL', {activityId: id, type: 0});
                    if (!skill.game || skill.game.bossHp == null || skill.game.playerAnger == null || Number(skill.game.levelId) !== Number(game.levelId) || Number(skill.game.bossHp) >= Number(game.bossHp) || Number(skill.game.playerAnger) >= Number(game.playerAnger))
                        throw new Error('Ngưu Ma chưa xác nhận chiêu thức tiêu hao nộ và gây sát thương');
                    info = await read();
                    if (!info.levelGame || !(Number(info.levelGame.bossHp) < Number(game.bossHp)) || !(Number(info.levelGame.playerAnger) < Number(game.playerAnger)))
                        throw new Error('Ngưu Ma đọc lại chưa có kết quả chiêu thức');
                    count++; continue;
                }
                var path = bullPath(ctx, act, game, level, util, ctx.options.searchNodes);
                if (!path.length) throw new Error('Ngưu Ma không tìm được chuỗi hợp lệ từ vị trí nhân vật');
                var battle = await P.accept(ctx, 'S_BULL_DEMON_BATTLE', {activityId: id, type: 0, pos: path});
                if (!battle.game || Number(battle.game.levelId) !== Number(game.levelId)) throw new Error('Ngưu Ma phản hồi trận không khớp');
                changed(game, battle.game, 'Ngưu Ma chưa xác nhận bàn cờ thay đổi');
                info = await read(); changed(game, info.levelGame, 'Ngưu Ma đọc lại vẫn là bàn cờ cũ'); count++; continue;
            }
            var fightPower = P.number(util.getFightPower());
            if (next && Number(info.power) >= P.integer(next.energyCost) && fightPower >= P.number(next.skipPower)) {
                var fast = await P.accept(ctx, 'S_BULL_DEMON_START_LEVEL', {activityId: id, levelId: P.integer(next.id, 1), fast: true});
                if (!fast.info || fast.info.maxLevelId == null || Number(fast.info.maxLevelId) < Number(next.id)) throw new Error('Ngưu Ma chưa xác nhận vượt nhanh');
                reward(fast); info = await read();
                if (Number(info.info.maxLevelId) < Number(next.id)) throw new Error('Ngưu Ma đọc lại chưa vượt ải mới'); count++; continue;
            }
            var cleared = levels.filter(function (l) { return Number(l.id) <= max && Number(l.energyCost) <= Number(info.power); }).pop();
            if (cleared && sweeps < ctx.options.sweeps) {
                var oldPower = Number(info.power), sweep = await P.accept(ctx, 'S_BULL_DEMON_SWEEP', {activityId: id, levelId: P.integer(cleared.id, 1), times: 1});
                if (Number(sweep.power) >= oldPower || sweep.power == null) throw new Error('Ngưu Ma chưa xác nhận lượt càn quét'); reward(sweep);
                info = await read(); if (Number(info.power) >= oldPower) throw new Error('Ngưu Ma đọc lại chưa tiêu hao thể lực'); sweeps++; count++; continue;
            }
            if (!levels.some(function (l) { return Number(l.id) <= max; }) && next && Number(info.power) >= Number(next.energyCost)) {
                var start = await P.accept(ctx, 'S_BULL_DEMON_START_LEVEL', {activityId: id, levelId: P.integer(next.id, 1), fast: false});
                if (!start.levelGame || Number(start.levelGame.levelId) !== Number(next.id)) throw new Error('Ngưu Ma chưa mở trận đúng ải');
                info = await read(); if (!info.levelGame || Number(info.levelGame.levelId) !== Number(next.id)) throw new Error('Ngưu Ma đọc lại chưa có trận vừa mở'); count++; continue;
            }
            break;
        }
        if (ctx.options.claimTasks && P.claimActivity) count += await P.claimActivity(ctx, act);
        if (ctx.options.claimTasks && P.claimWarOrder) count += await P.claimWarOrder(ctx, act);
        var result = P.done(count, 'xử lý Ngưu Ma', 'Ngưu Ma hết thể lực hoặc chưa đủ lực chiến vượt ải mới');
        result.message += ' · Đã vượt ải ' + P.integer(info.info.maxLevelId) + ', càn quét ' + sweeps + ' lượt'; return result;
    }
    var common = [P.boolOption('freeGift', 'Nhận quà miễn phí', true), P.boolOption('claimTasks', 'Nhận thưởng mốc đã hoàn thành', true)];
    P.register({id: 'thien_nu_u_hon', name: 'Thiện Nữ U Hồn', group: 'Sự kiện', desktop: ['action_thien_nu_u_hon'], timeoutMs: 1800000,
        options: common.concat([P.boolOption('autoTeam', 'Tìm hoặc tạo đội', true), P.numOption('layers', 'Số tầng tối đa', 10, 100, 1), P.numOption('steps', 'Số thao tác tối đa', 500, 10000, 1)])}, quad);
    P.register({id: 'tay_du_ky', name: 'Tây Du Ký', group: 'Sự kiện', desktop: ['action_tay_du_ky'], timeoutMs: 1800000,
        options: common.concat([P.boolOption('autoTeam', 'Tìm hoặc tạo đội', true), P.numOption('steps', 'Số thao tác tối đa', 500, 10000, 1),
            P.numOption('maxRegion', 'Dừng ở khu vực thứ', 2, 100, 1), P.boolOption('upgradeWeapons', 'Nâng pháp bảo bằng nguyên liệu sẵn có', true),
            P.numOption('upgrades', 'Số lần nâng pháp bảo tối đa', 300, 1000), P.boolOption('attackPlayers', 'Tấn công khi gặp người chơi', true)])}, xiyou);
    P.register({id: 'nguu_ma_giang_the', name: 'Ngưu Ma Giáng Thế', group: 'Sự kiện', desktop: ['action_nguu_ma_giang_the'], timeoutMs: 1800000,
        options: common.concat([P.numOption('steps', 'Số thao tác tối đa', 500, 10000, 1), P.numOption('sweeps', 'Số lượt càn quét tối đa', 100, 1000),
            P.boolOption('upgradeSword', 'Nâng lực chiến bằng nguyên liệu sẵn có', true), P.boolOption('useSkill', 'Dùng chiêu thức khi đủ nộ', true), P.numOption('upgrades', 'Số lần nâng lực chiến tối đa', 500, 2000),
            P.numOption('searchNodes', 'Giới hạn tìm chuỗi mỗi lượt', 20000, 100000, 256)])}, bull);
})(typeof window !== 'undefined' ? window : globalThis);
