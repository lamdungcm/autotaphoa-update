/* Investing uses native curTurn (week) and curRound (day), real holdings and
 * receipts. The news weights preserve the current desktop strategy; they are
 * a heuristic, not a promise about the next price. No real-money operation. */
(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    var positive = [3, 5, 7, 23, 25, 27, 28, 30], negative = [2, 10, 11, 12, 22];
    P.investPick = function (data, strategy) {
        var game = data.gameInfo, news = P.list(game.news), candidates = P.list(game.stocks).filter(function (stock) { return Number(stock.price) > 0; });
        var scores = {};
        candidates.forEach(function (stock) {
            var cfg = data.getStockConfig(stock.stockId); if (!cfg) throw new Error('Chưa đọc được cấu hình cổ phiếu');
            var score = 0;
            if (strategy === 'news') news.forEach(function (item) {
                var rule = data.getNewsConfig(item.newsId); if (!rule) throw new Error('Chưa đọc được cấu hình tin thị trường');
                var direction = positive.indexOf(Number(item.newsId)) >= 0 ? 1 : negative.indexOf(Number(item.newsId)) >= 0 ? -1 : 0;
                var type = Number(rule.type), applies = [1, 2].indexOf(type) >= 0 ? Number(item.effectId) === Number(cfg.sectors) : [3, 4].indexOf(type) >= 0 ? Number(item.effectId) === Number(stock.stockId) : Number(item.effectId) === 0;
                if (applies) score += direction > 0 ? 50 : direction < 0 ? -100 : 0;
            });
            scores[stock.stockId] = score;
        });
        candidates.sort(function (a, b) { return scores[b.stockId] - scores[a.stockId] || Number(a.price) - Number(b.price); });
        return candidates[0] || null;
    };
    function stamp(game) { return P.integer(game.curTurn, 1) + ':' + P.integer(game.curRound, 1); }
    function worth(game) {
        if (game.totalAssets != null) return P.integer(game.totalAssets);
        return P.integer(game.funds) + P.list(game.stocks).concat(game.industry || []).reduce(function (n, row) { return n + P.integer(row.heldNum) * P.integer(row.price); }, 0);
    }
    P.register({id: 'con_bao_dau_tu', name: 'Cơn bão đầu tư', group: 'Sự kiện', desktop: ['action_con_bao_dau_tu'], options: [
        P.numOption('weeks', 'Số tuần giao dịch tối đa', 30, 200, 1), P.boolOption('autoTeam', 'Tìm hoặc tạo đội', true),
        {key: 'strategy', label: 'Chọn cổ phiếu', type: 'choice', default: 'news', choices: [{id: 'news', name: 'Theo tin tức và luật bản PC'}, {id: 'cheapest', name: 'Ưu tiên giá thấp'}]}], timeoutMs: 3600000}, async function (ctx) {
        var act = P.findActivity(ctx, [1076], ['cơn bão đầu tư', 'chứng khoán']); if (!act) return P.skip('Cơn bão đầu tư chưa mở');
        var id = P.activityId(act), data = P.instance(ctx, 'ActivityStockMarketMgr').model.getInvestData(id), trades = 0, days = 0, weeks = 0, rewards = 0;
        if (ctx.options.autoTeam) await P.ensureTeam(ctx, id);
        var config = P.ret(await P.call(ctx, 'ActivityStockMarketNetUtil', 'getConfig', [id])); data.syncConfig(config);
        var summary = P.ret(await P.call(ctx, 'ActivityStockMarketNetUtil', 'getData', [id])); data.syncData(summary);
        rewards += await P.claimActivity(ctx, act);
        if (!summary.continue && P.integer(summary.freeTimes) === 0) {
            rewards += await P.claimWarOrder(ctx, act); return P.done(rewards, 'nhận thưởng đầu tư', 'Không còn lượt đầu tư miễn phí');
        }
        async function read() {
            var r = P.ret(await P.call(ctx, 'ActivityStockMarketNetUtil', 'getStartGame', [id]));
            if (!r.gameInfo) throw new Error('Máy chủ chưa trả phiên đầu tư thực tế');
            P.list(r.gameInfo.stocks); P.list(r.gameInfo.news); stamp(r.gameInfo); P.integer(r.gameInfo.funds);
            data.syncStartGame(r); return r;
        }
        var state = await read(), initial = worth(state.gameInfo), final = initial;
        var daysPerWeek = P.integer(data.investParam.investStockTurnRoundNum, 1);
        ctx.log('Cơn bão đầu tư: vốn hiện tại ' + initial);
        while (weeks < ctx.options.weeks && days < ctx.options.weeks * daysPerWeek) {
            ctx.check();
            if (state.quickResult) break;
            if (state.roundResult || state.turnResult) {
                if (state.turnResult) {
                    if (P.integer(state.gameInfo.freeTimes) === 0) break;
                    if (weeks >= ctx.options.weeks) break;
                }
                var oldStamp = stamp(state.gameInfo), next = P.ret(await P.call(ctx, 'ActivityStockMarketNetUtil', 'getNextRound', [id]));
                if (!next.gameInfo || stamp(next.gameInfo) === oldStamp) throw new Error('Phiên đầu tư chưa chuyển sang ngày/tuần tiếp theo');
                data.syncNextRound(next); state = next;
                if (next.brokeResult && next.brokeResult.broke) break;
            }
            var currentStamp = stamp(state.gameInfo), owned = state.gameInfo.stocks.filter(function (stock) { return P.integer(stock.heldNum) > 0; });
            for (var i = 0; i < owned.length; i++) {
                var stock = owned[i], sid = P.integer(stock.stockId, 1), qty = P.integer(stock.heldNum, 1);
                var sold = P.ret(await P.call(ctx, 'ActivityStockMarketNetUtil', 'getSellStock', [id, sid, qty]));
                if (!sold.stock || Number(sold.stock.stockId) !== sid || Number(sold.stock.heldNum) !== 0 || !(Number(sold.funds) > Number(state.gameInfo.funds))) throw new Error('Kết quả bán cổ phiếu chưa xác nhận đúng số lượng');
                data.syncSellStock(sold); state = await read();
                var fresh = state.gameInfo.stocks.find(function (row) { return Number(row.stockId) === sid; });
                if (stamp(state.gameInfo) !== currentStamp || !fresh || Number(fresh.heldNum) !== 0 || Number(state.gameInfo.funds) !== Number(sold.funds)) throw new Error('Sổ giao dịch chưa lưu kết quả bán; dừng để tránh bán lặp');
                trades++;
            }
            var chosen = P.investPick(data, ctx.options.strategy);
            if (chosen) {
                var cash = P.integer(state.gameInfo.funds), price = P.integer(chosen.price, 1), maximum = P.integer(data.investParam.investStockHoldingMaxNum, 1);
                var num = Math.min(Math.floor(cash / price), maximum - P.integer(chosen.heldNum));
                if (num > 0) {
                    var chosenId = P.integer(chosen.stockId, 1), held = P.integer(chosen.heldNum);
                    var bought = P.ret(await P.call(ctx, 'ActivityStockMarketNetUtil', 'getBuyStock', [id, chosenId, num]));
                    if (!bought.stock || Number(bought.stock.stockId) !== chosenId || Number(bought.stock.heldNum) !== held + num || Number(bought.funds) !== cash - num * price) throw new Error('Kết quả mua cổ phiếu không khớp số lượng/tiền');
                    data.syncBuyStock(bought); state = await read();
                    var actual = state.gameInfo.stocks.find(function (row) { return Number(row.stockId) === chosenId; });
                    if (stamp(state.gameInfo) !== currentStamp || !actual || Number(actual.heldNum) !== held + num || Number(state.gameInfo.funds) !== Number(bought.funds)) throw new Error('Sổ giao dịch chưa xác nhận lượng cổ phiếu vừa mua');
                    trades++;
                }
            }
            var result = P.ret(await P.call(ctx, 'ActivityStockMarketNetUtil', 'getInvestResultRound', [id]));
            if (!result.gameInfo || (!result.roundResult && !result.turnResult)) throw new Error('Ngày đầu tư chưa có kết quả kết toán');
            if (stamp(result.gameInfo) !== currentStamp) throw new Error('Kết toán trả về sai phiên giao dịch');
            data.syncInvestResultRound(result); state = result; days++; final = worth(result.gameInfo);
            if (result.turnResult) weeks++;
        }
        rewards += await P.claimActivity(ctx, act); rewards += await P.claimWarOrder(ctx, act);
        var result = P.done(days + trades + rewards, 'giao dịch và nhận thưởng đầu tư', 'Chưa có phiên giao dịch đủ điều kiện');
        if (days || trades) result.message = 'Đã kết toán ' + days + ' ngày · Vốn cuối ' + final + ' · Chênh lệch ' + (final - initial);
        return result;
    });
})(typeof window !== 'undefined' ? window : globalThis);
