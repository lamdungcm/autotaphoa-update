(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    P.phoneMove = function (cells, levels) {
        var map = {}, visited = {}, groups = [], singles = [];
        P.list(cells).forEach(function (cell) {
            var x = P.integer(cell.x), y = P.integer(cell.y), key = x + ',' + y;
            if (map[key]) throw new Error('Bàn PHS có ô trùng vị trí');
            map[key] = cell;
        });
        Object.keys(map).forEach(function (key) {
            var cell = map[key]; if (visited[key] || !levels[Number(cell.level)]) return;
            var queue = [cell], group = []; visited[key] = true;
            while (queue.length) {
                var row = queue.shift(); group.push(row); singles.push(row);
                [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (delta) {
                    var nextKey = (Number(row.x) + delta[0]) + ',' + (Number(row.y) + delta[1]), next = map[nextKey];
                    if (next && !visited[nextKey] && Number(next.level) === Number(cell.level)) { visited[nextKey] = true; queue.push(next); }
                });
            }
            if (group.length >= 3) groups.push(group);
        });
        groups.sort(function (a, b) { return Number(b[0].level) - Number(a[0].level) || b.length - a.length; });
        var candidates = groups.length ? groups[0] : singles;
        candidates.sort(function (a, b) { return groups.length ? Number(b.y) - Number(a.y) || Number(b.x) - Number(a.x) : Number(b.level) - Number(a.level); });
        if (!candidates.length) throw new Error('Bàn PHS chưa có ô hợp lệ để thao tác');
        return {operation: groups.length ? 1 : 2, x: Number(candidates[0].x), y: Number(candidates[0].y)};
    };
    P.register({id: 'dien_thoai_phs', name: 'Điện thoại PHS mạnh', group: 'Sự kiện', desktop: ['action_dien_thoai_phs'],
        options: [P.numOption('rounds', 'Số lượt chơi tối đa', 10, 200, 1)], timeoutMs: 1800000}, async function (ctx) {
        var act = P.findActivity(ctx, [1031], ['điện thoại', 'phs']); if (!act) return P.skip('Điện thoại PHS chưa mở');
        var id = P.activityId(act), count = await P.claimEventFree(ctx, act, [311100200]), played = 0, moves = 0;
        count += await P.claimActivity(ctx, act);
        var mgr = P.instance(ctx, 'ActivityPhoneStoreMgr'), model = mgr.model.getPhoneStoreData(id);
        var config = P.ret(await P.call(ctx, 'ActivityPhoneStoreNetUtil', 'getConfig', [id, false])); model.syncConfig(config);
        var levels = {}; P.list(config.phoneConfig).forEach(function (row) { levels[P.integer(row.id, 1)] = true; });
        async function read() {
            var r = P.ret(await P.call(ctx, 'ActivityPhoneStoreNetUtil', 'getInfo', [id, false]));
            P.fields(r, ['store', 'energy', 'action']);
            if (!r.game || !r.game.chessboard) throw new Error('Chưa có bàn PHS thực tế');
            P.list(r.game.chessboard.cells); model.syncInfo(r); return r;
        }
        var state = await read();
        if (mgr.getIsInServerGuide(act)) {
            for (var guideStep = Number(state.action) + 1; guideStep <= 2; guideStep++) {
                var guide = P.ret(await P.call(ctx, 'ActivityPhoneStoreNetUtil', 'guide', [id, guideStep, false]));
                if (Number(guide.action) !== guideStep) throw new Error('Bước hướng dẫn PHS chưa được xác nhận');
                state = await read(); if (Number(state.action) !== guideStep) throw new Error('Hướng dẫn PHS chưa cập nhật');
                count++;
            }
        }
        while (played < ctx.options.rounds) {
            if (P.integer(state.store.step) === 0) {
                var levelCfg = config.storeLevelConfig.find(function (row) { return Number(row.level) === Number(state.store.level); });
                if (!levelCfg) throw new Error('Chưa đọc được chi phí mở tiệm PHS');
                var energy = P.integer(state.energy), cost = P.integer(levelCfg.energyCost, 1);
                if (energy < cost) break;
                var start = P.ret(await P.call(ctx, 'ActivityPhoneStoreNetUtil', 'spread', [id, false]));
                if (!start.store || Number(start.energy) !== energy - cost || !(Number(start.store.step) > 0)) throw new Error('Máy chủ chưa xác nhận lượt mở tiệm mới');
                state = await read(); if (Number(state.energy) !== energy - cost || Number(state.store.step) !== Number(start.store.step)) throw new Error('Lượt mở tiệm PHS chưa được lưu');
            }
            var maximum = P.integer(state.store.step, 1);
            for (var step = 0; Number(state.store.step) > 0; step++) {
                if (step >= maximum) throw new Error('Bàn PHS không giảm số bước');
                var move = P.phoneMove(state.game.chessboard.cells, levels), before = P.integer(state.store.step, 1);
                var reply = P.ret(await P.call(ctx, 'ActivityPhoneStoreNetUtil', 'operationCell', [id, move.operation, move.x, move.y, false]));
                var cell = reply.chessboard && reply.chessboard.operateResult && reply.chessboard.operateResult.operateCell;
                if (!cell || Number(cell.x) !== move.x || Number(cell.y) !== move.y || Number(reply.chessboard.step) !== before - 1) throw new Error('Kết quả ghép/bán ô PHS không khớp thao tác');
                state = await read(); if (Number(state.store.step) !== before - 1) throw new Error('Bước PHS chưa giảm trên máy chủ');
                moves++;
            }
            played++; count += await P.claimActivity(ctx, act);
        }
        return P.done(count + moves, 'chơi ' + played + ' lượt PHS, thao tác ' + moves + ' ô', 'Không còn năng lượng hoặc mốc đủ điều kiện');
    });
    P.register({id: 'lat_bai_quyet_thang', name: 'Lật bài quyết thắng', group: 'Sự kiện', desktop: ['action_lat_bai_quyet_thang'], options: [P.numOption('tickets', 'Số vé tối đa', 3, 1000, 1)]}, async function (ctx) {
        var act = P.findActivity(ctx, [1033], ['lật bài', 'lat bai']); if (!act) return P.skip('Lật bài quyết thắng chưa mở');
        var count = await P.claimEventFree(ctx, act, []); count += await P.claimActivity(ctx, act);
        count += await P.useInventory(ctx, [121033], ctx.options.tickets, 1);
        count += await P.claimActivity(ctx, act);
        return P.done(count, 'dùng vé / nhận thưởng lật bài', 'Không có vé hoặc mốc thưởng đủ điều kiện');
    });
})(typeof window !== 'undefined' ? window : globalThis);
