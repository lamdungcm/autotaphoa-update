'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./test_full_runtime');
function fixture() {
    const h = setup(); ['ports_maze', 'ports_banquets', 'ports_films', 'ports_square_singer'].forEach(n => h.load(n));
    h.P.vnClock = () => ({getUTCHours: () => 12});
    h.run = (id, values = {}) => { const task = h.api.tasks.find(t => t.id === id); h.ctx.options = h.P.options(task.options, values); return task.run(h.ctx); };
    return h;
}
test('hotel hosting preserves an ongoing banquet whose end time is in seconds', async () => {
    const h = fixture(); h.modules.TimeUtil = {TimeUtil: {getServerTime: () => 1000}};
    h.modules.RestaurantMgr = {RestaurantMgr: {inst: {}}};
    h.modules.RestaurantNetUtil = {RestaurantNetUtil: {checkBanquet: () => ({ret: 0, finishBanquets: [], startingBanquet: {state: 1, endAt: 1100}})}};
    assert.equal((await h.run('banquet_hotel_host', {wait: false})).status, 'already_done');
    assert.deepEqual(h.calls.map(c => c.method), ['checkBanquet']);
});
test('studio hosts with the actual unexpired good-news ID and banquet ID, and consumes only that ticket', async () => {
    const h = fixture(), removed = [];
    h.modules.TimeUtil = {TimeUtil: {getServerTime: () => 1000}};
    h.modules.RestaurantMgr = {RestaurantMgr: {inst: {getVaildGoodNews: () => [{id: '777', banquetId: 40001}], removeGoodNews: id => removed.push(id), synHostBanquetData() {}, synOpenHistory() {}}}};
    h.modules.RestaurantNetUtil = {RestaurantNetUtil: {checkBanquet: () => ({ret: 0, finishBanquets: []}), hostBanquet: (id, ticket) => {
        assert.equal(ticket, '777'); return {ret: 0, banquetSceneInfo: {baseInfo: {banquetId: id, hostId: '100'}}};
    }}};
    assert.equal((await h.run('banquet_studio_host')).status, 'success'); assert.deepEqual(removed, ['777']);
});
test('hotel JOIN ACK without a seated player and reward does not proceed to exit as success', async () => {
    const h = fixture();
    h.modules.DBUtil = {DBUtil: {getRestaurantBanquet: () => ({type: 101})}};
    h.modules.RestaurantNetUtil = {RestaurantNetUtil: {getBanquetList: () => ({ret: 0, banquets: [{uid: '9', hostId: '200', banquetId: 10001}]}), getBanquetData: () => ({ret: 0, baseInfo: {uid: '9'}}), seatBanquet: () => ({ret: 0})}};
    await assert.rejects(h.run('banquet_hotel_guest'), /Chưa xác nhận/);
    assert.ok(!h.calls.some(c => c.method === 'exitBanquet'));
});
test('film cooperation selects the nearest opposite genre and verifies the actual partner in fresh inventory', async () => {
    const h = fixture(); let partner = null;
    const own = () => ({id: '11', state: 1, ownerId: '100', applyingCooperationType: 0, baseInfo: {scriptId: 1, earnSpeed: 400000, name: 'A'}, cooperation: partner});
    const row = (id, scriptId, earnSpeed) => ({id, ownerId: '200', minEarnSpeed: 0, baseInfo: {scriptId, earnSpeed}});
    h.modules.DBUtil = {DBUtil: {getTvStudio: id => ({genre: id === 1 || id === 2 ? 1 : 2})}};
    h.modules.FilmNetUtil = {FilmNetUtil: {
        getMyArtwork: () => ({ret: 0, telecasts: [own()]}),
        getCooperationList: () => ({ret: 0, items: [row('22', 2, 400000), row('33', 3, 450000), row('44', 4, 401000)]}),
        requestForCooperate: (id, other) => { assert.equal(other, '44'); partner = {scriptId: 4}; return {ret: 0, telecast: own()}; }
    }};
    assert.equal((await h.run('film_cooperation', {pools: ['1']})).status, 'success'); assert.equal(h.calls.filter(c => c.method === 'requestForCooperate').length, 1);
});
test('film published receipt must survive a fresh read before claiming it was posted', async () => {
    const h = fixture(), own = {id: '11', state: 1, ownerId: '100', applyingCooperationType: 0, baseInfo: {scriptId: 1, earnSpeed: 400000}};
    h.modules.DBUtil = {DBUtil: {getTvStudio: () => ({genre: 1})}};
    h.modules.FilmNetUtil = {FilmNetUtil: {getMyArtwork: () => ({ret: 0, telecasts: [own]}), getCooperationList: () => ({ret: 0, items: []}), publishCooperation: () => ({ret: 0, telecast: {...own, applyingCooperationType: 1}})}};
    await assert.rejects(h.run('film_cooperation', {pools: ['1']}), /Kho phim chưa cập nhật/); assert.equal(h.calls.filter(c => c.method === 'publishCooperation').length, 1);
});
test('night merchant outside its time window sends no request', async () => {
    const h = fixture(); assert.equal((await h.run('thuong_nhan_phi_phap')).status, 'skipped'); assert.equal(h.calls.length, 0);
});
test('square day battle uses the real number of remaining hero attempts', async () => {
    const h = fixture(); let used = 1;
    h.modules.SquareMgr = {SquareMgr: {inst: {synSquareActivityInfo() {}, syncDayActionHeroList: r => { used = r.actionHeroList[0].fightNum; }, isDayActionHeroIdle: () => used < 2, syncDayActionHero: () => used++}}};
    h.modules.HeroMgr = {HeroMgr: {inst: {getOwnHeroIdList: () => [42], getFinalAbilityValue: () => 1000}}};
    h.modules.SquareNetUtil = {SquareNetUtil: {getActivityInfo: () => ({actionId: 1, noticeList: []}), enter: () => ({ret: 0}), getReady: () => ({actionHeroList: [{heroId: 42, fightNum: 1}]}), startDayBattle: heroId => ({ret: 0, heroId, enemyHp: 0}), leave: () => ({ret: 0})}};
    assert.equal((await h.run('da_ga')).status, 'success'); assert.equal(h.calls.filter(c => c.method === 'startDayBattle').length, 1);
});
