/* Shared native transport for the full desktop-to-APK port. Every protocol name
 * and field is checked against the schema extracted from the supplied game.
 * Task handlers still own their business postconditions; ACKs are not results.
 */
(function (root) {
    'use strict';
    var api = root.AutoAPK;
    var P = api.port = {desktop: {}, catalogs: {}, handlers: {}};
    function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
    P.list = function (value, message) {
        if (!Array.isArray(value)) throw new Error(message || 'Danh sách trong game chưa sẵn sàng');
        return value;
    };
    P.number = function (value, message) {
        if (value == null || value === '' || typeof value === 'boolean' || !isFinite(Number(value)))
            throw new Error(message || 'Dữ liệu trong game chưa đầy đủ');
        return Number(value);
    };
    P.integer = function (value, minimum) {
        var n = P.number(value);
        if (!Number.isSafeInteger(n) || n < (minimum == null ? 0 : minimum)) throw new Error('Giá trị trong game không hợp lệ');
        return n;
    };
    P.id = function (value) {
        var text = value == null ? '' : String(value);
        if (!/^[1-9]\d*$/.test(text)) throw new Error('Không xác nhận được nhân vật');
        return text;
    };
    P.instance = function (ctx, module, exportName) {
        var value = ctx.require(module), owner = value[exportName || module] || value.default;
        if (!owner || !owner.inst) throw new Error('Dữ liệu chức năng chưa sẵn sàng');
        return owner.inst;
    };
    P.model = function (ctx, module, exportName) {
        var mgr = P.instance(ctx, module, exportName), model = mgr.model || mgr._model;
        if (!model) throw new Error('Dữ liệu chức năng chưa sẵn sàng');
        return model;
    };
    P.ret = function (response, message) {
        if (!object(response) || response.ret !== 0) throw new Error(message || 'Máy chủ chưa xác nhận thao tác');
        return response;
    };
    P.fields = function (response, names, message) {
        if (!object(response) || names.some(function (key) { return response[key] == null; }))
            throw new Error(message || 'Kết quả máy chủ chưa đầy đủ');
        return response;
    };
    P.reward = function (response, key) {
        var value = response && response[key || 'reward'];
        if (typeof value !== 'string') throw new Error('Không đọc được thưởng từ máy chủ');
        return value.trim();
    };
    P.done = function (count, label, empty) {
        count = P.integer(count);
        return {status: count ? 'success' : 'already_done', message: count ? 'Đã ' + label + ' (' + count + ')' : (empty || 'Chưa có lượt đủ điều kiện')};
    };
    P.skip = function (message) { return {status: 'skipped', message: message}; };
    P.bag = function (ctx, id) {
        var dict = P.model(ctx, 'BagMgr').itemDict;
        if (!dict) throw new Error('Túi vật phẩm chưa sẵn sàng');
        var item = dict[id];
        return item ? P.integer(item.num == null ? item.count : item.num) : 0;
    };
    P.activity = function (ctx, type) { return ctx.activity(type); };
    P.activityId = function (act) { return P.integer(act.activityId, 1); };
    P.call = async function (ctx, module, method, args, exportName) {
        ctx.check();
        var reply = await ctx.call(module, exportName || module, method, args || [], {timeoutMs: 15000});
        ctx.check();
        return reply;
    };
    function validScalar(value, type) {
        if (/^(?:u?int(?:32|64)|sint(?:32|64)|fixed(?:32|64)|sfixed(?:32|64))$/.test(type))
            return typeof value !== 'boolean' && value != null && /^-?\d+$/.test(String(value)) &&
                (typeof value !== 'number' || Number.isSafeInteger(value));
        if (/^(?:double|float)$/.test(type)) return value != null && typeof value !== 'boolean' && isFinite(Number(value));
        if (type === 'bool') return typeof value === 'boolean';
        if (type === 'string') return typeof value === 'string';
        if (type === 'bytes') return value != null;
        // Nested messages/enums are encoded by the game's own protobuf runtime.
        return value != null;
    }
    function validate(shape, value, request) {
        if (!object(value)) throw new Error('Dữ liệu thao tác chưa hợp lệ');
        if (request && Object.keys(value).some(function (name) { return !shape[name]; }))
            throw new Error('Phiên bản game chưa hỗ trợ tham số này');
        Object.keys(shape).forEach(function (key) {
            var field = shape[key], member = value[key];
            if (member == null) {
                if (field.rule === 'required') throw new Error('Dữ liệu thao tác còn thiếu');
                return;
            }
            if (field.rule === 'repeated') {
                if (!Array.isArray(member) || member.some(function (item) { return !validScalar(item, field.type); }))
                    throw new Error('Danh sách thao tác không hợp lệ');
            } else if (!validScalar(member, field.type)) throw new Error('Dữ liệu thao tác không hợp lệ');
        });
    }
    function reflectedShape(ctor) {
        var type = ctor && (ctor.$type || (ctor.prototype && ctor.prototype.$type));
        if (!type) return null;
        var fields = type._fields || type.children;
        if (!Array.isArray(fields)) return null;
        var shape = {};
        fields.forEach(function (field) {
            if (field.className !== 'Message.Field' && field.id == null) return;
            shape[field.name] = {id: field.id, type: typeof field.type === 'string' ? field.type : field.type && field.type.name,
                rule: field.repeated ? 'repeated' : field.required ? 'required' : 'optional'};
        });
        return shape;
    }
    P.schema = function (ctx, symbol) {
        var protocol = ctx.require('Protocol').Protocol, opcode = protocol[symbol];
        if (!Number.isSafeInteger(opcode) || opcode <= 0) throw new Error('Phiên bản game chưa hỗ trợ thao tác này');
        var staticSpec = (api.gameSchema || {}).protocols && api.gameSchema.protocols[symbol];
        var live, mgr;
        try { mgr = P.instance(ctx, 'ProtobufMgr'); live = mgr.cmdList[opcode]; } catch (_) {}
        if (live) {
            var req = reflectedShape(mgr.getMsg(opcode, true, true));
            var res = reflectedShape(mgr.getMsg(live.smMsgId, false, true));
            if (req && res) return {number: opcode, requestFields: req, responseFields: res, response: live.smMethod};
        }
        if (!staticSpec || !staticSpec.request || !staticSpec.response || !Object.keys(staticSpec.responseFields).length)
            throw new Error('Game chưa nạp dữ liệu giao thức của chức năng này');
        return Object.assign({number: opcode}, staticSpec);
    };
    P.packet = async function (ctx, symbol, body) {
        ctx.check();
        var spec = P.schema(ctx, symbol);
        validate(spec.requestFields, body || {}, true);
        var reply = await P.call(ctx, 'GameNetUtil', 'syncSeqSendMsg', [spec.number, body || {}, false]);
        if (!spec.response) throw new Error('Thao tác chưa có phản hồi xác nhận');
        validate(spec.responseFields, reply, false);
        return reply;
    };
    P.accept = async function (ctx, symbol, body, message) { return P.ret(await P.packet(ctx, symbol, body), message); };
    P.options = function (schema, input) {
        input = input || {};
        var result = {};
        (schema || []).forEach(function (field) {
            var value = input[field.key] == null ? field.default : input[field.key];
            if (field.type === 'boolean') {
                if (typeof value !== 'boolean') throw new Error('Tùy chọn chưa hợp lệ');
            } else if (field.type === 'number') {
                value = P.integer(value, field.min == null ? 0 : field.min);
                if (field.max != null && value > field.max) throw new Error('Số lượng vượt giới hạn đã đặt');
            } else if (field.type === 'multi') {
                if (!Array.isArray(value) || value.some(function (v) { return typeof v !== 'string' && typeof v !== 'number'; }))
                    throw new Error('Danh sách đã chọn chưa hợp lệ');
                value = value.slice();
            } else if (field.type === 'orders') {
                if (!Array.isArray(value) || value.length > 100) throw new Error('Danh sách mua chưa hợp lệ');
                var seen = {};
                value = value.map(function (order) {
                    if (!object(order)) throw new Error('Dòng mua chưa hợp lệ');
                    var id = P.integer(order.id, 1), count = P.integer(order.count, 1);
                    if (count > 100000 || seen[id]) throw new Error('Số lượng hoặc vật phẩm trùng trong danh sách mua');
                    seen[id] = true; return {id: id, count: count};
                });
            } else if (field.type === 'choice') {
                if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Lựa chọn chưa hợp lệ');
                if (field.choices && !field.choices.some(function (item) { return String(item.id) === String(value); }))
                    throw new Error('Lựa chọn không còn được hỗ trợ');
            } else if (field.type === 'text') {
                if (typeof value !== 'string' || value.length > (field.maxLength || 2000)) throw new Error('Nội dung cấu hình chưa hợp lệ');
            }
            result[field.key] = value;
        });
        return result;
    };
    P.register = function (definition, handler) {
        if (typeof handler !== 'function' || !definition.id || !definition.name) throw new Error('Invalid full-port task');
        definition.run = handler;
        definition.timeoutMs = definition.timeoutMs || 900000;
        api.registerTask(definition);
        P.handlers[definition.id] = definition;
        (definition.desktop || []).forEach(function (name) {
            if (P.desktop[name] && P.desktop[name] !== definition.id) throw new Error('Duplicate desktop mapping');
            P.desktop[name] = definition.id;
        });
    };
    P.sequence = async function (ctx, ids, options) {
        var results = [], successes = 0, failures = 0;
        for (var i = 0; i < ids.length; i++) {
            ctx.check();
            var outcome;
            try { outcome = await ctx.runTask(ids[i], undefined, {repeat: !!(options && options.repeatDuplicates && ids.slice(0, i).indexOf(ids[i]) >= 0)}); }
            catch (error) {
                ctx.check(); if (api.inspect().pending) throw error;
                failures++; ctx.log((api.tasks.find(function (t) { return t.id === ids[i]; }) || {}).name + ': ' + error.message, 'error'); continue;
            }
            if (!outcome || ['success', 'already_done', 'skipped'].indexOf(outcome.status) < 0) throw new Error('Có tác vụ con chưa xác nhận kết quả');
            results.push(outcome);
            if (outcome.status === 'success') successes++;
        }
        if (failures) throw new Error('Có ' + failures + ' tác vụ con chưa hoàn thành; đã kiểm tra các mục còn lại');
        return successes ? P.done(successes, 'hoàn thành tác vụ con') :
            results.some(function (r) { return r.status === 'already_done'; }) ? P.done(0, '', 'Các tác vụ con đã được kiểm tra') : P.skip('Các chức năng chưa mở hoặc cần cấu hình');
    };
    P.validate = validate;
    P.values = function (dict) {
        if (!object(dict)) throw new Error('Danh sách trong game chưa sẵn sàng');
        return Object.keys(dict).map(function (key) { return dict[key]; });
    };
    P.filterSelected = function (rows, selected, key) {
        return selected.length ? rows.filter(function (row) { return selected.map(String).indexOf(String(row[key])) >= 0; }) : rows;
    };
    P.numOption = function (key, label, value, max, min) { return {key: key, label: label, type: 'number', default: value, min: min || 0, max: max}; };
    P.boolOption = function (key, label, value) { return {key: key, label: label, type: 'boolean', default: !!value}; };
    P.idsOption = function (key, label, catalog) { return {key: key, label: label, type: 'multi', default: [], catalog: catalog}; };
    P.name = function (ctx, value) {
        if (typeof value !== 'string') return '';
        try { return ctx.require('App').App.lang.get(value) || value; } catch (_) { return value; }
    };
    P.setCatalog = function (ctx, key, rows) {
        ctx.check();
        P.catalogs[key] = {owner: ctx.uid, rows: rows};
        return rows;
    };
    api.getCatalog = function (key) {
        var owner = api.getConfigurationToken();
        if (!owner || !api.inspect().ready || api.inspect().pending || api.state.running) throw new Error('Dừng auto và đăng nhập nhân vật trước');
        var loader = P.catalogs[key + 'Loader'];
        if (typeof loader !== 'function') throw new Error('Chưa đọc được danh sách của chức năng này');
        var ctx = {uid: owner, require: root.__require, check: function () {
            if (owner !== api.getConfigurationToken()) throw new Error('Nhân vật đã thay đổi');
        }};
        return loader(ctx);
    };
})(typeof window !== 'undefined' ? window : globalThis);
