/* Current native Telecast fields and cooperative/publish receipts. */
(function (root) {
    'use strict';
    var api = root.AutoAPK, P = api.port;
    function speed(film) { return P.integer(P.fields(film, ['baseInfo']).baseInfo.earnSpeed); }
    function genre(ctx, film) {
        var cfg = ctx.require('DBUtil').DBUtil.getTvStudio(P.integer(film.baseInfo.scriptId, 1));
        if (!cfg || [1, 2].indexOf(Number(cfg.genre)) < 0) throw new Error('Chưa đọc được thể loại phim thực tế');
        return Number(cfg.genre);
    }
    function available(film) { return Number(film.state) === 1 && !film.cooperation && !Number(film.applyingCooperationType); }
    async function artworks(ctx) {
        var data = P.ret(await P.call(ctx, 'FilmNetUtil', 'getMyArtwork', [false, false]));
        return P.list(data.telecasts);
    }
    P.register({id: 'film_cooperation', name: 'Hợp tác phim', group: 'Phim', desktop: ['action_hop_tac_phim'],
        options: [P.numOption('count', 'Số phim tối đa', 3, 100, 1), P.numOption('maxValueK', 'Doanh thu tối đa (nghìn/giây, 0 = tất cả)', 600, 1000000),
            P.numOption('deltaK', 'Chênh lệch doanh thu tối đa (nghìn/giây)', 100, 1000000),
            {key: 'pools', label: 'Tìm đối tác', type: 'multi', choices: [{id: '1', name: 'Cùng server'}, {id: '2', name: 'Liên server'}, {id: '3', name: 'Công hội'}], default: ['1', '3']},
            P.boolOption('publish', 'Đăng tìm đối tác khi chưa ghép được', true)], timeoutMs: 600000}, async function (ctx) {
        var films = (await artworks(ctx)).filter(function (f) { return available(f) && (!ctx.options.maxValueK || speed(f) <= ctx.options.maxValueK * 1000); });
        films.sort(function (a, b) { return speed(a) - speed(b); });
        var paired = 0, published = 0, pools = ctx.options.pools.map(function (n) { return P.integer(n, 1); });
        if (!pools.length) throw new Error('Chưa chọn nơi tìm đối tác');
        for (var i = 0; i < films.length && paired + published < ctx.options.count; i++) {
            var film = films[i], id = P.id(film.id), myGenre = genre(ctx, film), earn = speed(film), candidates = [];
            for (var p = 0; p < pools.length; p++) {
                var reply = P.ret(await P.call(ctx, 'FilmNetUtil', 'getCooperationList', [pools[p], id, false]));
                P.list(reply.items).forEach(function (other) {
                    if (String(other.ownerId) === ctx.uid || String(other.id) === id || other.cooperation || genre(ctx, other) === myGenre) return;
                    var diff = Math.abs(speed(other) - earn);
                    if (diff <= ctx.options.deltaK * 1000 && earn >= P.integer(other.minEarnSpeed)) candidates.push({film: other, pool: pools[p], diff: diff});
                });
            }
            candidates.sort(function (a, b) { return a.diff - b.diff || speed(a.film) - speed(b.film); });
            if (candidates.length) {
                var candidate = candidates[0];
                var joined = P.ret(await P.call(ctx, 'FilmNetUtil', 'requestForCooperate', [id, P.id(candidate.film.id), candidate.pool, false]));
                if (!joined.telecast || String(joined.telecast.id) !== id || !joined.telecast.cooperation) throw new Error('Chưa có phim đối tác trong kết quả hợp tác');
                var fresh = (await artworks(ctx)).find(function (f) { return String(f.id) === id; });
                if (!fresh || !fresh.cooperation || Number(fresh.cooperation.scriptId) !== Number(candidate.film.baseInfo.scriptId)) throw new Error('Kho phim chưa xác nhận đúng đối tác vừa ghép');
                paired++; ctx.log('Hợp tác phim: đã ghép ' + (film.baseInfo.name || id));
            } else if (ctx.options.publish) {
                var pool = pools[0], minimum = pool === 2 ? Math.max(0, earn - ctx.options.deltaK * 1000) : 0;
                var sent = P.ret(await P.call(ctx, 'FilmNetUtil', 'publishCooperation', [id, minimum, pool, false]));
                if (!sent.telecast || String(sent.telecast.id) !== id || Number(sent.telecast.applyingCooperationType) !== pool) throw new Error('Máy chủ chưa xác nhận phim đã đăng tìm đối tác');
                var current = (await artworks(ctx)).find(function (f) { return String(f.id) === id; });
                if (!current || Number(current.applyingCooperationType) !== pool) throw new Error('Kho phim chưa cập nhật yêu cầu tìm đối tác');
                published++; ctx.log('Hợp tác phim: đã đăng chờ đối tác cho ' + (film.baseInfo.name || id));
            }
        }
        var result = P.done(paired + published, 'xử lý phim', 'Không có phim chưa hợp tác phù hợp');
        if (paired + published) result.message = 'Đã ghép ' + paired + ' phim · Đăng chờ đối tác ' + published + ' phim';
        return result;
    });
})(typeof window !== 'undefined' ? window : globalThis);
