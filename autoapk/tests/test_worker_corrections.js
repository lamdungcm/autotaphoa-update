'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup} = require('./test_full_runtime');
function fixture() {
    const h = setup(); h.load('desktop_workers'); h.load('ports_workers'); h.ctx.activity = () => ({activityId: 123});
    h.ctx.options = {limit: 10}; h.modules.Protocol.Protocol.S_PLUCK_CARROTS_PLUCK = 88;
    return h;
}
test('the actual carrot worker stops at zero plucks and never counts the echoed state as a success', async () => {
    const h = fixture(); let sent = 0;
    h.P.packet = async () => { sent++; return {ret: 0, activityId: 123, actuallyPluckTimes: 0, info: {level: 2}, reportList: []}; };
    assert.equal((await h.P.runWorker(h.ctx, 'nho_cu_cai')).status, 'already_done'); assert.equal(sent, 1);
});
