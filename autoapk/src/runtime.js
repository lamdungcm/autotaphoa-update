/* Runs inside the game's Cocos JavaScript engine, without a PC or a server. */
(function (root) {
    'use strict';
    if (root.AutoAPK && root.AutoAPK.version === '0.1.0') return;
    var listeners = [], generation = 0, active = null, pending = null, settingsOwner = '';
    var api = root.AutoAPK = {
        version: '0.1.0', tasks: [], settings: {selected: [], tasks: {}},
        state: {running: false, current: '', status: 'Sẵn sàng', logs: [],
            progress: {done: 0, total: 0}, lastResult: null}
    };
    function notify() {
        listeners.slice().forEach(function (listener) { try { listener(api.state); } catch (_) {} });
    }
    function friendly(text) {
        text = String(text || '').replace(/[\r\n\t]+/g, ' ').slice(0, 180);
        if (/(?:0x[\da-f]{3,}|\b\d{12,}\b|\b(?:password|token|session|userId|opcode|TypeError|ReferenceError)\b)/i.test(text))
            return 'Không xác nhận được kết quả. Hãy kiểm tra lại trong game.';
        return text;
    }
    function log(message, level) {
        api.state.logs.push({text: friendly(message), level: level || 'info', time: Date.now()});
        if (api.state.logs.length > 60) api.state.logs.shift();
        notify();
    }
    function requireGame(name) {
        if (typeof root.__require !== 'function') throw new Error('Game chưa sẵn sàng');
        return root.__require(name);
    }
    function identity() {
        try {
            var model = requireGame('PlayerMgr').PlayerMgr.inst.model;
            var base = model.playerBaseData || {};
            return {uid: String(model.userId || base.userId || ''),
                name: model.nickName || base.nickName || model.playerName || ''};
        } catch (_) { return {uid: '', name: ''}; }
    }
    function error(message, code) {
        var e = new Error(message); e.autoapkCode = code; return e;
    }
    function check(run) {
        if (!run || run.cancelled || active !== run || run.id !== generation)
            throw error('Đã dừng theo yêu cầu', 'stopped');
        if (identity().uid !== run.uid) throw error('Nhân vật đã thay đổi; auto đã dừng', 'identity');
        if (Date.now() >= run.deadline) throw error('Đã hết thời gian xử lý tác vụ', 'deadline');
    }
    function call(run, module, className, method, args, options) {
        check(run);
        if (pending) return Promise.reject(error('Đang chờ kết quả thao tác trước', 'pending'));
        var owner = requireGame(module);
        String(className).split('.').forEach(function (part) { owner = owner && owner[part]; });
        if (!owner || typeof owner[method] !== 'function')
            return Promise.reject(error('Phiên bản game chưa hỗ trợ tác vụ này', 'unsupported'));
        var timeout = Math.min(Number((options || {}).timeoutMs) || 12000, run.deadline - Date.now());
        var flight = {run: run.id, method: method}; pending = flight;
        return new Promise(function (resolve, reject) {
            var ended = false, timer = null;
            function settle(failed, value) {
                if (ended) return;
                ended = true;
                if (timer !== null) root.clearInterval(timer);
                if (failed) reject(value); else resolve(value);
            }
            var deadline = Date.now() + timeout;
            timer = root.setInterval(function () {
                try {
                    check(run);
                    if (Date.now() >= deadline) throw error('Máy chủ chưa trả kết quả; hãy kiểm tra lại trong game', 'timeout');
                } catch (e) { settle(true, e); }
            }, 100);
            // Keep the in-flight gate until the native promise really settles.
            // A timeout/Stop cannot turn an uncertain mutation into a retry.
            var response;
            try { response = owner[method].apply(owner, args || []); }
            catch (e) { if (pending === flight) pending = null; settle(true, e); return; }
            Promise.resolve(response).then(function (value) {
                if (pending === flight) pending = null;
                try { check(run); settle(false, value); } catch (e) { settle(true, e); }
            }, function () {
                if (pending === flight) pending = null;
                settle(true, error('Mất kết nối khi thực hiện tác vụ', 'network'));
            });
        });
    }
    function waitFor(run, predicate, options) {
        var deadline = Math.min(run.deadline, Date.now() + Math.min(Number((options || {}).timeoutMs) || 3000, 3600000));
        var message = (options || {}).message || 'Máy chủ chưa cập nhật kết quả';
        return new Promise(function (resolve, reject) {
            var timer = null;
            function poll() {
                try {
                    check(run);
                    if (predicate()) { if (timer !== null) root.clearInterval(timer); resolve(true); return true; }
                    if (Date.now() >= deadline) throw error(message, 'state_timeout');
                } catch (e) { if (timer !== null) root.clearInterval(timer); reject(e); return true; }
                return false;
            }
            if (!poll()) timer = root.setInterval(poll, 100);
        });
    }
    function activity(type) {
        var dict = requireGame('ActivityMgr').ActivityMgr.inst.model.activityDict || {};
        var matches = Object.keys(dict).map(function (id) { return dict[id]; }).filter(function (act) {
            var info = act.info || {};
            var kind = Number(act.type || act.activityType || info.activityType || 0);
            var state = act.state == null ? info.state : act.state;
            // Game EnumActivityState: NONE=0, PREVIEW=1, START=2.
            // A newer placeholder must not mask a currently running activity.
            return kind === Number(type) && state != null && Number(state) === 2;
        });
        matches.sort(function (a, b) { return Number(b.activityId) - Number(a.activityId); });
        return matches[0] || null;
    }
    function loadTaskSettings() {
        var owner = identity().uid;
        if (!owner || owner === '0') { settingsOwner = ''; api.settings.tasks = {}; return; }
        if (owner === settingsOwner) return;
        settingsOwner = owner; api.settings.tasks = {};
        try {
            var storage = root.cc && root.cc.sys && root.cc.sys.localStorage;
            var saved = storage && JSON.parse(storage.getItem('autoapk.tasks.v1.' + owner) || '{}');
            if (saved && typeof saved === 'object' && !Array.isArray(saved)) api.settings.tasks = saved;
        } catch (_) { /* A bad preference file must not affect game data. */ }
    }
    function taskOptions(task, values) {
        return api.port ? api.port.options(task.options || [], values || {}) : {};
    }
    api.getTaskOptions = function (id) {
        loadTaskSettings();
        var task = api.tasks.find(function (item) { return item.id === id; });
        if (!task) throw error('Không tìm thấy chức năng', 'unsupported');
        return taskOptions(task, api.settings.tasks[id]);
    };
    api.getConfigurationToken = function () { loadTaskSettings(); return settingsOwner; };
    api.configureTask = function (id, values, ownerToken) {
        if (active || pending) throw error('Dừng auto trước khi đổi cấu hình', 'pending');
        loadTaskSettings();
        if (!settingsOwner || settingsOwner !== identity().uid) throw error('Hãy đăng nhập nhân vật trước', 'identity');
        if (ownerToken != null && ownerToken !== settingsOwner) throw error('Nhân vật đã thay đổi; hãy mở lại cấu hình', 'identity');
        var task = api.tasks.find(function (item) { return item.id === id; });
        if (!task) throw error('Không tìm thấy chức năng', 'unsupported');
        var configured = taskOptions(task, values);
        var next = JSON.parse(JSON.stringify(api.settings.tasks)); next[id] = configured;
        try {
            var storage = root.cc && root.cc.sys && root.cc.sys.localStorage;
            if (!storage) throw new Error('storage');
            storage.setItem('autoapk.tasks.v1.' + settingsOwner, JSON.stringify(next));
        } catch (_) { throw error('Chưa lưu được cấu hình trên điện thoại', 'storage'); }
        api.settings.tasks = next;
        notify();
        return taskOptions(task, configured);
    };
    api.registerTask = function (task) {
        if (!task || !task.id || !task.name || typeof task.run !== 'function') throw new Error('Invalid task');
        var old = api.tasks.findIndex(function (item) { return item.id === task.id; });
        if (old >= 0) api.tasks[old] = task; else api.tasks.push(task);
        notify();
    };
    api.subscribe = function (listener) {
        listeners.push(listener);
        return function () { var i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); };
    };
    api.inspect = function () {
        var account = identity();
        return {ready: !!account.uid && account.uid !== '0', account: {name: account.name},
            status: api.state.status, pending: !!pending, version: api.version};
    };
    api.stop = function () {
        if (active) { active.cancelled = true; api.state.status = 'Đang dừng'; notify(); }
    };
    api.runSelected = async function (ids) {
        if (active || pending) {
            log('Thao tác trước chưa kết thúc; hãy kiểm tra lại trong game', 'warning');
            return {status: 'blocked'};
        }
        var account = identity();
        if (!account.uid || account.uid === '0') { log('Hãy đăng nhập nhân vật trước khi chạy auto', 'warning'); return {status:'blocked'}; }
        loadTaskSettings();
        var settingsSnapshot = JSON.parse(JSON.stringify(api.settings.tasks || {}));
        var selected = api.tasks.filter(function (task) { return Array.isArray(ids) && ids.indexOf(task.id) >= 0; });
        if (!selected.length) { log('Hãy chọn tác vụ cần thực hiện', 'warning'); return {status:'skipped'}; }
        var run = active = {id: ++generation, uid: account.uid, cancelled: false, deadline: 0, completed: {}, epoch: 0};
        var result = {status: 'success', tasks: [], startedAt: Date.now()};
        api.state.running = true; api.state.progress = {done: 0, total: selected.length};
        api.state.status = 'Đang thực hiện'; notify();
        try {
            for (var i = 0; i < selected.length; i++) {
                var task = selected[i];
                var taskTimeout = Math.max(1000, Math.min(Number(task.timeoutMs) || 90000, 3600000));
                run.deadline = Date.now() + taskTimeout;
                check(run); api.state.current = task.id; api.state.status = task.name; notify();
                var ctx = (function (rootId, epoch) {
                function guard() { check(run); if (run.epoch !== epoch) throw error('Tác vụ trước đã kết thúc', 'stopped'); }
                var ctx = {uid: run.uid, options: {}, require: requireGame, activity: activity,
                    check: guard, log: function (message, level) { guard(); log(message, level); },
                    waitFor: function (predicate, options) { guard(); return waitFor(run, function () { guard(); return predicate(); }, options); },
                    call: function (module, name, method, args, options) { guard(); return call(run, module, name, method, args, options); }};
                ctx.sleep = async function (duration) {
                    var remaining = Number(duration);
                    if (!isFinite(remaining) || remaining < 0 || remaining > 120000) throw error('Thời gian thao tác không hợp lệ', 'config');
                    while (remaining > 0) {
                        guard();
                        var portion = Math.min(remaining, 9000), finish = Date.now() + portion;
                        await ctx.waitFor(function () { return Date.now() >= finish; }, {timeoutMs: portion + 500});
                        remaining -= portion;
                    }
                };
                var stack = [rootId];
                ctx.runTask = async function (id, overrides, invocation) {
                    guard();
                    var child = api.tasks.find(function (item) { return item.id === id; });
                    if (!child || stack.indexOf(id) >= 0) throw error('Không thực hiện được nhóm chức năng này', 'unsupported');
                    var prior = ctx.options, childOptions = taskOptions(child, overrides || settingsSnapshot[id]);
                    var key = id + ':' + JSON.stringify(childOptions);
                    if (!(invocation && invocation.repeat) && !child.repeatWithinRun && run.completed[key])
                        return {status: 'already_done', message: 'Đã thực hiện trong cùng lượt chạy'};
                    stack.push(id);
                    ctx.options = childOptions;
                    try {
                        var outcome = await child.run(ctx); guard();
                        if (!outcome || ['success', 'already_done', 'skipped'].indexOf(outcome.status) < 0) throw error('Tác vụ con chưa xác nhận kết quả', 'unverified');
                        if (outcome.status === 'success') run.completed[key] = true;
                        log(child.name + ': ' + friendly(outcome.message), outcome.status === 'success' ? 'success' : 'info');
                        return outcome;
                    }
                    finally { stack.pop(); ctx.options = prior; }
                };
                return ctx;
                })(task.id, ++run.epoch);
                try {
                    ctx.options = taskOptions(task, settingsSnapshot[task.id]);
                    var taskKey = task.id + ':' + JSON.stringify(ctx.options);
                    var value = !task.repeatWithinRun && run.completed[taskKey] ?
                        {status: 'already_done', message: 'Đã thực hiện trong cùng lượt chạy'} : await task.run(ctx);
                    check(run);
                    if (pending) throw error('Tác vụ vẫn còn thao tác chưa có kết quả', 'pending');
                    if (!value || ['success', 'already_done', 'skipped'].indexOf(value.status) < 0)
                        throw error('Tác vụ chưa xác nhận được kết quả', 'unverified');
                    if (value.status === 'success') run.completed[taskKey] = true;
                    result.tasks.push({id: task.id, status: value.status, message: friendly(value.message)});
                    log(task.name + ': ' + friendly(value.message || 'Đã xác nhận kết quả'), value.status === 'skipped' ? 'info' : 'success');
                } catch (e) {
                    result.status = 'failed';
                    result.tasks.push({id: task.id, status: 'failed', message: friendly(e.message)});
                    log(task.name + ': ' + friendly(e.message), 'error');
                    if (run.cancelled || pending || ['identity','deadline','stopped'].indexOf(e.autoapkCode) >= 0) throw e;
                }
                api.state.progress.done++; notify();
            }
        } catch (e) { result.status = run.cancelled ? 'stopped' : 'failed'; }
        finally {
            result.finishedAt = Date.now();
            api.state.lastResult = result;
            api.state.running = false;
            api.state.status = result.status === 'success' ? 'Đã xử lý xong các tác vụ đã chọn' :
                result.status === 'stopped' ? 'Đã dừng' : 'Có tác vụ chưa hoàn thành';
            active = null; notify();
        }
        return result;
    };
})(typeof window !== 'undefined' ? window : globalThis);
