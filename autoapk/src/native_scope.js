/* The copied manager methods below use the game's live models but a private
 * transport. Never patch GameNetUtil, a native prototype, or global timers. */
(function (root) {
    'use strict';
    var P = root.AutoAPK.port;
    P.nativeScope = function (ctx, options) {
        options = options || {};
        var cache = {}, queue = Promise.resolve(), evidence = [], closed = false, fault = null, sent = 0, timers = [], removers = [];
        var shopSpent = 0, timeoutCounter = 0, timeouts = {}, mutations = 0;
        var window = Object.create(root), protocol = ctx.require('Protocol').Protocol, symbols = {};
        Object.keys(protocol).forEach(function (name) { if (/^S_/.test(name) && typeof protocol[name] === 'number') symbols[protocol[name]] = name; });
        function check() { ctx.check(); if (closed) throw new Error('Tác vụ đã kết thúc'); if (fault) throw fault; }
        function send(number, body) {
            var result = queue.then(async function () {
                check(); var symbol = symbols[number];
                if (!symbol) throw new Error('Không xác định được thao tác trong game');
                if (++sent > 5000) throw new Error('Đã đạt giới hạn thao tác của lượt chạy');
                body = body || {};
                if (!/(?:_INFO|_DATA|_LIST|_QUERY|_DETAIL|_RANK|_CONFIG)(?:_|$)/.test(symbol)) {
                    if (options.mutationLimit != null && mutations >= P.integer(options.mutationLimit, 1)) {
                        var limit = new Error('Đã đạt giới hạn lệnh thao tác đã đặt'); limit.autoapkCode = 'budget'; throw limit;
                    }
                    mutations++;
                }
                var cost = 0;
                if (symbol === 'S_SHOP_BUY_GOODS') {
                    var row = ctx.require('DBUtil').DBUtil.getShop(body.shopGoodsId);
                    if (!row || Number(row.rechargeId) !== 0 || row.price == null || Number(row.priceAdd) !== 0)
                        throw new Error('Chưa xác nhận giá gói vật phẩm trong sự kiện');
                    if (String(row.price) !== '0') {
                        if (!(Number(options.shopBudget) > 0)) throw new Error('Chưa bật ngân sách mua gói trong sự kiện');
                        var costs = ctx.require('GoodsUtil').GoodsUtil.createRewardsList(row.price);
                        var diamonds = P.integer(ctx.require('GoodsConfig').GoodsConfig.ITEM_INGOTS_ID, 1);
                        if (!Array.isArray(costs) || costs.length !== 1 || Number(costs[0].id) !== diamonds) throw new Error('Gói sự kiện dùng tài nguyên khác cấu hình');
                        cost = P.integer(costs[0].count) * P.integer(body.count, 1);
                        if (shopSpent + cost > options.shopBudget) throw new Error('Mua gói vượt ngân sách sự kiện đã đặt');
                    }
                }
                var response = await P.packet(ctx, symbol, body); check();
                if (response && response.ret === 0) {
                    if (symbol === 'S_ACTIVITY_GET_MULTI_REWARD') {
                        var ids = P.list(response.successConditionId);
                        if (!P.reward(response) || ids.length !== body.conditionId.length || ids.some(function (id, i) { return body.conditionId.indexOf(id) < 0 || ids.indexOf(id) !== i; }))
                            throw new Error('Máy chủ chưa xác nhận đủ mốc thưởng sự kiện');
                    } else if (symbol === 'S_ACTIVITY_GET_REWARD') {
                        if (Number(response.conditionId) !== Number(body.conditionId) || !P.reward(response)) throw new Error('Mốc thưởng sự kiện không khớp yêu cầu');
                    } else if (symbol === 'S_SHOP_BUY_GOODS') {
                        if (Number(response.shopGoodsId) !== Number(body.shopGoodsId) || Number(response.count) !== Number(body.count) || !P.reward(response, 'goodsDeatil'))
                            throw new Error('Kết quả mua gói sự kiện chưa đầy đủ');
                        shopSpent += cost;
                    }
                }
                evidence.push({symbol: symbol, body: body || {}, response: response});
                return response;
            });
            queue = result.catch(function (error) { fault = error; });
            return result;
        }
        function scopedInstance(proto, original) {
            var bound = {}, local = {}, proxy;
            proxy = new Proxy(original, {get: function (target, key) {
                check(); if (Object.prototype.hasOwnProperty.call(local, key)) return local[key];
                var descriptor = proto && Object.getOwnPropertyDescriptor(proto, key);
                if (descriptor && typeof descriptor.value === 'function')
                    return bound[key] || (bound[key] = descriptor.value.bind(proxy));
                var value = Reflect.get(target, key, proxy);
                return typeof value === 'function' ? bound[key] || (bound[key] = value.bind(proxy)) : value;
            }, set: function (target, key, value) { check(); local[key] = value; return true; }});
            return proxy;
        }
        function req(name) {
            check();
            if (name === 'GameNetUtil') return {GameNetUtil: {syncSeqSendMsg: send,
                sendMsg: function () { throw new Error('Thao tác này chưa có phản hồi xác nhận'); }}};
            if (cache[name]) return cache[name];
            var original = ctx.require(name), module = (P.nativeModules || {})[name];
            if (!module) {
                if (name === 'UIMgr') {
                    var ui = Object.create(original.UIMgr), liveUI = original.UIMgr.inst;
                    Object.defineProperty(ui, 'inst', {value: scopedInstance(null, liveUI)});
                    return cache[name] = Object.assign({}, original, {UIMgr: ui});
                }
                if (name === 'EventMgr') {
                    var events = Object.create(original.EventMgr), liveEvents = original.EventMgr.inst;
                    var facade = Object.create(liveEvents);
                    facade.on = function (event, callback, target) {
                        check(); var guarded = function () { try { check(); callback.apply(target, arguments); } catch (_) {} };
                        liveEvents.on(event, guarded, target); removers.push(function () { liveEvents.off(event, guarded, target); });
                    };
                    Object.defineProperty(events, 'inst', {value: facade});
                    return cache[name] = Object.assign({}, original, {EventMgr: events});
                }
                return original;
            }
            var exports = {}, holder = {exports: exports}; cache[name] = exports;
            var cc = Object.create(root.cc || {}); cc._RF = {push: function () {}, pop: function () {}};
            module.factory(function (path) { return req(module.deps[path] || path); }, holder, exports, cc, window, window,
                window.setTimeout, window.clearTimeout, window.setInterval, window.clearInterval);
            Object.keys(exports).forEach(function (key) {
                var copy = exports[key], live = original[key];
                if (!copy || !live) return;
                if (typeof copy === 'function' && copy.prototype) {
                    var owner = copy, descriptor;
                    while (owner && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(owner, 'inst'); owner = Object.getPrototypeOf(owner); }
                    if (descriptor && descriptor.configurable && live.inst) {
                        var instance = scopedInstance(copy.prototype, live.inst);
                        Object.defineProperty(copy, 'inst', {get: function () { check(); return instance; }, configurable: true});
                    }
                } else if (typeof copy === 'object' && typeof live === 'object') {
                    exports[key] = scopedInstance(Object.getPrototypeOf(copy), live);
                }
            });
            return holder.exports;
        }
        window.__require = req; window.require = req;
        Object.defineProperty(window, '__stop_requested', {get: function () { try { check(); return false; } catch (_) { return true; } }, set: function () {}});
        window.setTimeout = function (callback, duration) {
            check(); var id = ++timeoutCounter; timeouts[id] = true;
            ctx.sleep(duration || 0).then(function () { check(); if (timeouts[id]) { delete timeouts[id]; callback(); } }).catch(function () { delete timeouts[id]; });
            return id;
        };
        window.clearTimeout = function (id) { delete timeouts[id]; };
        window.setInterval = function (callback, duration) {
            check(); var id = root.setInterval(function () { try { check(); callback(); } catch (_) { root.clearInterval(id); } }, duration);
            timers.push(id); return id;
        };
        window.clearInterval = function (id) { root.clearInterval(id); };
        return {window: window, require: req, evidence: evidence, getFault: function () { return fault; }, drain: function () { return queue.then(check); },
            close: function () { closed = true; timeouts = {}; timers.forEach(function (id) { root.clearInterval(id); }); removers.forEach(function (fn) { fn(); }); }};
    };
})(typeof window !== 'undefined' ? window : globalThis);
