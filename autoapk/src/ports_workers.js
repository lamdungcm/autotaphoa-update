/* Per-event controllers around the current desktop algorithms. Worker globals,
 * temporary method overrides, listeners and transport all belong to this run. */
(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    P.vnClock = function () { return new Date(Date.now() + 7 * 3600000); };
    function decode(value) {
        if (typeof value === 'string') {
            try { return JSON.parse(value); } catch (_) { throw new Error('Không đọc được kết quả sự kiện'); }
        }
        return value;
    }
    function active(def, ctx) {
        if (!def.types.length) return {};
        for (var i = 0; i < def.types.length; i++) {
            var act = ctx.activity(def.types[i]); if (act) return act;
        }
        return null;
    }
    P.stateReceipt = function (entry) {
        var r = entry.response;
        if (!r || r.ret !== 0 || /(?:_INFO|_DATA|_LIST|_QUERY|_DETAIL|_RANK)(?:_|$)/.test(entry.symbol)) return false;
        return Object.keys(r).some(function (key) {
            var value = r[key];
            return key !== 'ret' && value != null && (typeof value === 'object' && Object.keys(value).length > 0 || typeof value === 'string' && value.trim() !== '' || typeof value === 'number' && isFinite(value));
        });
    };
    P.runWorker = async function (ctx, id, overrides) {
        var worker = P.workers[id], def = worker.definition, act = active(def, ctx);
        if (!act) return P.skip('Sự kiện chưa mở');
        if (id === 'do_xe' && [0, 6].indexOf(P.vnClock().getUTCDay()) < 0) return P.skip('Đỗ xe chỉ chạy thứ bảy và chủ nhật');
        var scope = P.nativeScope(ctx, {shopBudget: ctx.options.shopBudget || 0}), result, returned;
        var params = Object.assign({activityId: def.types.length ? P.activityId(act) : 0, limit: ctx.options.limit || def.limit || 150}, overrides || {});
        try {
            [def.result, def.error, def.doneGlobal].filter(Boolean).forEach(function (key) { scope.window[key] = undefined; });
            returned = worker.launch(scope, params);
            if (typeof returned === 'string') {
                if (/^\s*\{/.test(returned)) returned = decode(returned);
                else if (!/^(?:STARTED|LAUNCHED)$/i.test(returned)) throw new Error('Chưa khởi động được sự kiện');
            }
            if (returned && (returned.ok === false || returned.error || returned.err)) throw new Error('Chưa khởi động được sự kiện');
            await ctx.waitFor(function () {
                if (def.error && scope.window[def.error]) throw new Error('Sự kiện đã dừng vì lỗi xử lý');
                result = decode(scope.window[def.result]);
                if (!result) return false;
                if (def.doneGlobal) return scope.window[def.doneGlobal] === true;
                if (def.done) return result[def.done] === true;
                return result.ok != null || result.success != null || result.err || result.error ||
                    def.counters.some(function (key) { return result[key] != null; });
            }, {timeoutMs: 1800000, message: 'Sự kiện đang xử lý lâu hơn dự kiến'});
            await scope.drain(); ctx.check();
            if (result.error || result.err || result.ok === false || result.success === false || /(?:fail|error|no_response)/i.test(result.stopReason || ''))
                throw new Error('Sự kiện chưa hoàn thành; hãy kiểm tra trạng thái trong game');
            var actions = scope.evidence.filter(P.stateReceipt).length;
            var claimed = def.counters.reduce(function (total, key) {
                var value = result[key]; if (typeof value === 'boolean') return total + Number(value);
                if (value == null) return total;
                return total + P.integer(value);
            }, 0);
            if (claimed && !actions) throw new Error('Chưa có dữ liệu máy chủ chứng minh thao tác sự kiện');
            if (!scope.evidence.length) {
                if (result.moving || result.isEventOpen === false) return P.skip(result.moving ? 'Đoàn xe đang di chuyển' : 'Sự kiện chưa mở');
                throw new Error('Chưa đọc được dữ liệu máy chủ của sự kiện');
            }
            var count = claimed || actions, tail = '';
            ['powerLeft', 'energyLeft', 'ticketsLeft', 'remainingCandles', 'endEnergy', 'turnsLeft'].forEach(function (key) {
                if (result[key] != null) tail = ' · Còn ' + P.integer(result[key]) + ' lượt/vật phẩm';
            });
            var outcome = P.done(count, 'thực hiện thao tác sự kiện', 'Đã kiểm tra, chưa có lượt hoặc thưởng đủ điều kiện');
            outcome.message += tail; return outcome;
        } finally { scope.close(); }
    };
    Object.keys(P.workers).forEach(function (id) {
        var def = P.workers[id].definition;
        // The two Vo Lam workers are separate configurable parts of one desktop action.
        var desktop = id === 'vo_lam_forge' || id === 'vo_lam_tower' ? [] : [def.action];
        var options = def.limit ? [P.numOption('limit', 'Số lượt/bước tối đa', def.limit, 10000, 1)] : [];
        if (id === 'guild_exp_boxes') options.push(P.numOption('shopBudget', 'Ngân sách kim cương tối đa', 776, 100000));
        P.register({id: id, name: def.name, group: id === 'limited_quests' ? 'Nhận thưởng' : 'Sự kiện',
            desktop: desktop, options: options, timeoutMs: 1800000}, function (ctx) { return P.runWorker(ctx, id); });
    });
    P.register({id: 'vo_lam_truyen_ky', name: 'Võ lâm truyền kỳ: toàn bộ', group: 'Sự kiện',
        desktop: ['action_vo_lam_truyen_ky'], timeoutMs: 3600000}, function (ctx) { return P.sequence(ctx, ['vo_lam_forge', 'vo_lam_tower']); });
})(typeof window !== 'undefined' ? window : globalThis);
