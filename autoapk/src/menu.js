/* AutoAPK floating menu for Cocos Creator 2.x. No Android overlay permission. */
(function (global) {
    'use strict';

    if (global.__AutoAPKMenu && global.__AutoAPKMenu.destroy) {
        global.__AutoAPKMenu.destroy();
    }

    var VERSION = '0.1.0';
    var SELECTION_KEY = 'autotaphoa.autoapk.selected.v1';
    var cc = null;
    var core = null;
    var unsubscribe = null;
    var timer = null;
    var root = null;
    var host = null;
    var scene = null;
    var panel = null;
    var bubble = null;
    var refs = {};
    var opened = false;
    var destroyed = false;
    var selected = {};
    var selectionLoaded = false;
    var taskSignature = '';
    var accountName = '';
    var localStatus = '';
    var localError = false;
    var checking = false;
    var viewport = null;
    var listContent = null;
    var listOffset = 0;
    var listHeight = 0;
    var rowHeight = 0;
    var rows = [];
    var editor = null;
    var dimensions = { width: 540, height: 960, scale: 1 };
    var bubblePosition = { x: 0.88, y: 0.7 };

    var colors = {
        panel: [21, 29, 44, 249],
        border: [72, 90, 117, 255],
        row: [34, 45, 65, 255],
        muted: [163, 180, 204, 255],
        text: [241, 246, 255, 255],
        green: [45, 153, 108, 255],
        red: [178, 67, 76, 255],
        blue: [57, 110, 176, 255],
        yellow: [246, 197, 100, 255],
        disabled: [57, 67, 83, 255]
    };

    function valid(node) {
        try { return !!node && (!cc.isValid || cc.isValid(node)); }
        catch (_) { return false; }
    }

    function color(value) {
        value = typeof value === 'string' ? colors[value] : value;
        return new cc.Color(value[0], value[1], value[2], value[3]);
    }

    function safeText(value, limit) {
        var text = typeof value === 'string' ? value : '';
        // Technical errors belong in the diagnostic file, never in the game menu.
        if (/(?:0x[0-9a-f]{3,}|\b\d{12,}\b|\b(?:userId|opcode|frida|stacktrace|TypeError|ReferenceError)\b)/i.test(text)) {
            return 'Có thông tin cần kiểm tra lại.';
        }
        text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
    }

    function tasks() {
        return core && Array.isArray(core.tasks) ? core.tasks.filter(function (task) {
            return task && typeof task.id === 'string' && task.id &&
                typeof task.name === 'string' && task.name && typeof task.run === 'function';
        }) : [];
    }

    function getState() {
        return core && core.state ? core.state : {};
    }

    function running() { return getState().running === true; }

    function selectedIds() {
        return tasks().filter(function (task) { return !!selected[task.id]; })
            .map(function (task) { return task.id; });
    }

    function loadSelection() {
        if (selectionLoaded || !core || !cc) { return; }
        selectionLoaded = true;
        var saved = core.settings && Array.isArray(core.settings.selected) ? core.settings.selected : [];
        try {
            var raw = cc.sys.localStorage.getItem(SELECTION_KEY);
            if (raw !== null && raw !== undefined) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) { saved = parsed; }
            }
        } catch (_) { /* Storage may be unavailable before the game is ready. */ }
        selected = {};
        saved.forEach(function (id) { if (typeof id === 'string') { selected[id] = true; } });
        persistSelection();
    }

    function persistSelection() {
        var ids = selectedIds();
        if (core) {
            core.settings = core.settings || {};
            core.settings.selected = ids.slice();
        }
        try { cc.sys.localStorage.setItem(SELECTION_KEY, JSON.stringify(ids)); }
        catch (_) { /* Run remains usable if Android storage is full. */ }
    }

    function node(name, parent, width, height, x, y) {
        var result = new cc.Node(name);
        result.setContentSize(width, height);
        result.setPosition(x || 0, y || 0);
        parent.addChild(result);
        return result;
    }

    function paint(target, width, height, fill, radius, stroke) {
        var g = target.getComponent(cc.Graphics) || target.addComponent(cc.Graphics);
        g.clear();
        g.fillColor = color(fill);
        if (g.roundRect && radius > 0) {
            g.roundRect(-width / 2, -height / 2, width, height, radius);
        } else { g.rect(-width / 2, -height / 2, width, height); }
        g.fill();
        if (stroke) {
            g.strokeColor = color(stroke);
            g.lineWidth = Math.max(1, dimensions.scale);
            if (g.roundRect && radius > 0) {
                g.roundRect(-width / 2, -height / 2, width, height, radius);
            } else { g.rect(-width / 2, -height / 2, width, height); }
            g.stroke();
        }
        return g;
    }

    function label(parent, name, text, width, height, x, y, size, tint, align) {
        var target = node(name, parent, width, height, x, y);
        var component = target.addComponent(cc.Label);
        // A newly enabled native Label can resize its node before CLAMP is set.
        // Configure it first, then restore the intended bounds and assign text.
        if (cc.Label.Overflow) { component.overflow = cc.Label.Overflow.CLAMP; }
        component.fontSize = size;
        component.lineHeight = Math.ceil(size * 1.24);
        component.enableWrapText = true;
        if (cc.Label.HorizontalAlign) {
            component.horizontalAlign = align === 'left' ? cc.Label.HorizontalAlign.LEFT : cc.Label.HorizontalAlign.CENTER;
        }
        if (cc.Label.VerticalAlign) { component.verticalAlign = cc.Label.VerticalAlign.CENTER; }
        target.color = color(tint || 'text');
        target.setContentSize(width, height);
        component.string = text;
        return component;
    }

    function swallow(event) {
        if (event && event.stopPropagation) { event.stopPropagation(); }
    }

    function point(event, reference) {
        var location = event.getLocation ? event.getLocation() : event.touch.getLocation();
        return reference.convertToNodeSpaceAR(location);
    }

    function bindTouch(target, handlers) {
        var kinds = cc.Node.EventType || {};
        var names = { start: kinds.TOUCH_START || 'touchstart', move: kinds.TOUCH_MOVE || 'touchmove',
            end: kinds.TOUCH_END || 'touchend', cancel: kinds.TOUCH_CANCEL || 'touchcancel' };
        Object.keys(names).forEach(function (name) {
            target.on(names[name], function (event) {
                if (handlers[name]) { handlers[name](event); }
                swallow(event);
            });
        });
    }

    function button(parent, name, text, width, height, x, y, fill, onPress) {
        var target = node(name, parent, width, height, x, y);
        var title = label(target, 'Title', text, width - 8, height, 0, 0, 16 * dimensions.scale);
        var enabled = true;
        var start = null;
        var moved = false;
        var currentFill = '';
        function redraw() {
            var next = enabled ? fill : 'disabled';
            if (next !== currentFill) {
                currentFill = next;
                paint(target, width, height, next, 9 * dimensions.scale);
                title.node.opacity = enabled ? 255 : 155;
            }
        }
        bindTouch(target, {
            start: function (event) { start = point(event, root); moved = false; },
            move: function (event) {
                if (!start) { return; }
                var current = point(event, root);
                if (Math.abs(current.x - start.x) + Math.abs(current.y - start.y) > 9 * dimensions.scale) { moved = true; }
            },
            end: function () {
                var activate = enabled && start && !moved;
                start = null;
                if (activate) { onPress(); }
            },
            cancel: function () { start = null; }
        });
        redraw();
        return { node: target, label: title, setEnabled: function (value) { enabled = !!value; redraw(); } };
    }

    function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

    function updateScroll(offset) {
        listOffset = clamp(offset, 0, Math.max(0, rows.length * rowHeight - listHeight));
        if (valid(listContent)) { listContent.y = listOffset; }
        if (refs.scrollHint) {
            refs.scrollHint.string = rows.length * rowHeight > listHeight ? 'Vuốt để xem thêm' : '';
        }
    }

    function updateRows() {
        rows.forEach(function (row) {
            var checked = !!selected[row.id];
            paint(row.box, 24 * dimensions.scale, 24 * dimensions.scale,
                checked ? 'green' : 'panel', 5 * dimensions.scale, checked ? null : 'border');
            row.tick.string = checked ? '✓' : '';
            row.title.node.opacity = running() ? 170 : 255;
        });
    }

    function buildRows() {
        if (!valid(listContent)) { return; }
        listContent.removeAllChildren();
        rows = [];
        var s = dimensions.scale;
        var available = tasks();
        var width = viewport.width;
        available.forEach(function (task, index) {
            var row = node('TaskRow', listContent, width - 2 * s, rowHeight - 5 * s,
                0, listHeight / 2 - rowHeight * (index + 0.5));
            paint(row, width - 2 * s, rowHeight - 5 * s, 'row', 7 * s);
            var box = node('Check', row, 24 * s, 24 * s, -width / 2 + 23 * s, 0);
            var tick = label(box, 'Tick', '', 24 * s, 26 * s, 0, 0, 20 * s);
            var configurable = Array.isArray(task.options) && task.options.length > 0 && core.configureTask;
            var title = label(row, 'TaskName', safeText(task.name, 60), width - (configurable ? 125 : 70) * s,
                rowHeight - 6 * s, (configurable ? -9 : 19) * s, 0, 17 * s, 'text', 'left');
            if (configurable) label(row, 'Configure', '⚙', 48 * s, 36 * s, width / 2 - 30 * s, 0, 21 * s, 'yellow');
            rows.push({ id: task.id, box: box, tick: tick, title: title, task: task, configurable: configurable });
        });
        if (!available.length) {
            label(listContent, 'NoTasks', 'Chưa có tác vụ sẵn sàng.', width - 20 * s,
                60 * s, 0, listHeight / 2 - 34 * s, 17 * s, 'muted');
        }
        updateScroll(listOffset);
        updateRows();
    }

    function editInput(parent, name, value, width, height, x, y, numeric, onChange) {
        var target = node(name, parent, width, height, x, y);
        paint(target, width, height, 'row', 5 * dimensions.scale, 'border');
        if (!cc.EditBox) {
            label(target, 'Value', String(value), width, height, 0, 0, 16 * dimensions.scale);
            return;
        }
        var input = target.addComponent(cc.EditBox);
        input.fontSize = 17 * dimensions.scale;
        input.fontColor = color('text');
        input.placeholderFontSize = input.fontSize;
        if (cc.EditBox.InputMode) input.inputMode = numeric ? cc.EditBox.InputMode.NUMERIC : cc.EditBox.InputMode.ANY;
        input.maxLength = numeric ? 8 : 2000;
        input.string = String(value);
        var kind = cc.EditBox.EventType && cc.EditBox.EventType.TEXT_CHANGED || 'text-changed';
        target.on(kind, function () { if (editor && !running()) onChange(input.string); });
    }

    function closeEditor() {
        if (editor && valid(editor.node)) editor.node.destroy();
        editor = null; update();
    }

    function openEditor(task) {
        if (running() || !core.getTaskOptions || !core.configureTask) return;
        try {
            closeEditor();
            editor = {task: task, draft: core.getTaskOptions(task.id), owner: core.getConfigurationToken(), page: 0, mode: 'fields', error: ''};
            drawEditor();
        } catch (_) { localStatus = 'Hãy đăng nhập nhân vật để cấu hình.'; localError = true; update(); }
    }

    function drawEditor() {
        if (!editor || !valid(panel)) return;
        if (valid(editor.node)) editor.node.destroy();
        var s = dimensions.scale, pw = panel.width, ph = panel.height;
        var box = editor.node = node('Configuration', panel, pw - 4 * s, ph - 4 * s, 0, 0);
        box.zIndex = 100; paint(box, box.width, box.height, 'panel', 13 * s, 'border'); bindTouch(box, {});
        label(box, 'ConfigHeading', safeText(editor.task.name, 60), pw - 40 * s, 55 * s, 0, ph / 2 - 40 * s, 19 * s);
        var status = label(box, 'ConfigStatus', safeText(editor.error, 120), pw - 36 * s, 52 * s, 0, -ph / 2 + 100 * s, 14 * s, 'yellow');
        if (editor.mode === 'catalog') {
            var field = editor.field, perPage = Math.max(1, Math.min(7, Math.floor((ph / s - 355) / 62)));
            editInput(box, 'SearchCatalog', editor.filter || '', pw - 40 * s, 38 * s, 0, ph / 2 - 92 * s, false, function (value) {
                editor.filter = value; editor.catalogPage = 0;
                // Defer rebuilding until input focus is released, keeping native keyboard usable.
            });
            button(box, 'FilterCatalog', 'Tìm / Lọc', 105 * s, 32 * s, pw / 2 - 73 * s, ph / 2 - 135 * s, 'blue', drawEditor);
            var query = String(editor.filter || '').toLowerCase();
            var data = editor.catalogRows.filter(function (row) { return (row.group + ' ' + row.name + ' ' + row.id).toLowerCase().indexOf(query) >= 0; });
            var pages = Math.max(1, Math.ceil(data.length / perPage));
            editor.catalogPage = clamp(editor.catalogPage || 0, 0, pages - 1);
            data.slice(editor.catalogPage * perPage, (editor.catalogPage + 1) * perPage).forEach(function (item, index) {
                var y = ph / 2 - 182 * s - index * 62 * s;
                var value = editor.draft[field.key], order = field.type === 'orders' && value.filter(function (v) { return String(v.id) === String(item.id); })[0];
                var checked = field.type === 'orders' ? !!order : value.map(String).indexOf(String(item.id)) >= 0;
                var title = (checked ? '✓ ' : '□ ') + (item.group ? item.group + ' · ' : '') + item.name;
                button(box, 'CatalogItem', safeText(title, 90), pw - (field.type === 'orders' ? 156 : 40) * s, 52 * s,
                    field.type === 'orders' ? -58 * s : 0, y, checked ? 'green' : 'row', function () {
                        if (field.type === 'orders') {
                            editor.draft[field.key] = value.filter(function (v) { return String(v.id) !== String(item.id); });
                            if (!checked) editor.draft[field.key].push({id: Number(item.id), count: 1});
                        } else {
                            editor.draft[field.key] = value.filter(function (v) { return String(v) !== String(item.id); });
                            if (!checked) editor.draft[field.key].push(String(item.id));
                        }
                        drawEditor();
                    });
                if (field.type === 'orders' && order) editInput(box, 'OrderCount', order.count, 96 * s, 44 * s, pw / 2 - 68 * s, y, true, function (text) { order.count = Number(text); });
            });
            label(box, 'CatalogPage', (editor.catalogPage + 1) + '/' + pages + ' · ' + data.length + ' mục', pw - 150 * s, 28 * s, 0, -ph / 2 + 170 * s, 13 * s, 'muted');
            button(box, 'CatalogPrevious', '‹', 46 * s, 36 * s, -pw / 2 + 47 * s, -ph / 2 + 170 * s, 'row', function () { editor.catalogPage = Math.max(0, editor.catalogPage - 1); drawEditor(); });
            button(box, 'CatalogNext', '›', 46 * s, 36 * s, pw / 2 - 47 * s, -ph / 2 + 170 * s, 'row', function () { editor.catalogPage = Math.min(pages - 1, editor.catalogPage + 1); drawEditor(); });
            button(box, 'CatalogBack', 'Xong lựa chọn', pw - 40 * s, 42 * s, 0, -ph / 2 + 38 * s, 'blue', function () { editor.mode = 'fields'; editor.error = ''; drawEditor(); });
            return;
        }
        var fields = editor.task.options, pageSize = Math.max(1, Math.min(5, Math.floor((ph / s - 300) / 103))), pages = Math.max(1, Math.ceil(fields.length / pageSize));
        editor.page = clamp(editor.page, 0, pages - 1);
        fields.slice(editor.page * pageSize, (editor.page + 1) * pageSize).forEach(function (field, index) {
            var y = ph / 2 - 110 * s - index * 103 * s, value = editor.draft[field.key];
            label(box, 'OptionLabel', field.label, pw - 40 * s, 37 * s, 0, y, 16 * s, 'text', 'left');
            y -= 36 * s;
            if (field.type === 'number') {
                editInput(box, 'OptionNumber', value, pw - 148 * s, 40 * s, 0, y, true, function (text) { editor.draft[field.key] = Number(text); });
                [-1, 1].forEach(function (direction) { button(box, 'StepNumber', direction < 0 ? '−' : '+', 44 * s, 40 * s,
                    direction * (pw / 2 - 45 * s), y, 'row', function () {
                        editor.draft[field.key] = clamp((Number(editor.draft[field.key]) || 0) + direction * (field.step || 1), field.min || 0, field.max == null ? 100000 : field.max); drawEditor();
                    }); });
            } else if (field.type === 'text') {
                editInput(box, 'OptionText', value, pw - 40 * s, 42 * s, 0, y, false, function (text) { editor.draft[field.key] = text; });
            } else if (field.type === 'boolean') {
                button(box, 'OptionBoolean', value ? 'BẬT' : 'TẮT', pw - 40 * s, 40 * s, 0, y, value ? 'green' : 'row', function () { editor.draft[field.key] = !value; drawEditor(); });
            } else if (field.type === 'choice') {
                var choices = field.choices || [], chosen = choices.findIndex(function (item) { return String(item.id) === String(value); });
                button(box, 'OptionChoice', chosen >= 0 ? choices[chosen].name : String(value), pw - 40 * s, 40 * s, 0, y, 'blue', function () {
                    if (choices.length) editor.draft[field.key] = choices[(chosen + 1) % choices.length].id; drawEditor();
                });
            } else if (field.type === 'multi' || field.type === 'orders') {
                button(box, 'OptionList', 'Chọn / sửa (' + value.length + ' mục)', pw - 40 * s, 40 * s, 0, y, 'blue', function () {
                    try {
                        editor.catalogRows = core.getCatalog(field.catalog); editor.field = field;
                        editor.mode = 'catalog'; editor.filter = ''; editor.catalogPage = 0; editor.error = ''; drawEditor();
                    } catch (_) { editor.error = 'Chưa đọc được danh sách. Anh kiểm tra chức năng đã mở trong game.'; drawEditor(); }
                });
            }
        });
        if (pages > 1) {
            button(box, 'PreviousOptions', '‹', 45 * s, 30 * s, -100 * s, -ph / 2 + 170 * s, 'row', function () { editor.page = Math.max(0, editor.page - 1); drawEditor(); });
            label(box, 'OptionsPage', (editor.page + 1) + '/' + pages, 80 * s, 30 * s, 0, -ph / 2 + 170 * s, 14 * s);
            button(box, 'NextOptions', '›', 45 * s, 30 * s, 100 * s, -ph / 2 + 170 * s, 'row', function () { editor.page = Math.min(pages - 1, editor.page + 1); drawEditor(); });
        }
        button(box, 'CancelConfig', 'Hủy', (pw - 50 * s) / 2, 43 * s, -(pw - 30 * s) / 4, -ph / 2 + 38 * s, 'row', closeEditor);
        button(box, 'SaveConfig', 'Lưu cấu hình', (pw - 50 * s) / 2, 43 * s, (pw - 30 * s) / 4, -ph / 2 + 38 * s, 'green', function () {
            try { core.configureTask(editor.task.id, editor.draft, editor.owner); closeEditor(); }
            catch (error) { editor.error = safeText(error.message, 120) || 'Chưa lưu được cấu hình'; drawEditor(); }
        });
    }

    function logText(entry) {
        if (typeof entry === 'string') { return safeText(entry, 100); }
        return safeText(entry && (entry.text || entry.message || entry.msg), 100);
    }

    function update() {
        if (!valid(root) || !core) { return; }
        var available = tasks();
        var signature = available.map(function (task) { return task.id + ':' + task.name; }).join('|');
        if (signature !== taskSignature) {
            taskSignature = signature;
            buildRows();
        }
        var state = getState();
        var progress = state.progress || {};
        var done = Math.max(0, Number(progress.done) || 0);
        var total = Math.max(0, Number(progress.total) || 0);
        var isRunning = running();
        var current = available.filter(function (task) { return task.id === state.current; })[0];
        var currentName = current ? current.name : safeText(state.current, 70);
        refs.account.string = accountName ? 'Nhân vật: ' + accountName : 'Chưa nhận diện nhân vật';
        refs.status.string = safeText(localStatus || state.status, 110) || (isRunning ? 'Đang thực hiện' : 'Sẵn sàng');
        refs.status.node.color = color(localError ? 'red' : (isRunning ? 'yellow' : 'text'));
        refs.progress.string = isRunning && currentName ? safeText(currentName, 55) + '  •  ' + done + '/' + total :
            (total ? 'Tiến trình: ' + done + '/' + total : 'Đã chọn ' + selectedIds().length + ' tác vụ');
        refs.start.setEnabled(!isRunning && selectedIds().length > 0);
        refs.stop.setEnabled(isRunning);
        refs.selectAll.setEnabled(!isRunning && available.length > 0);
        refs.check.setEnabled(!checking);
        refs.selectAll.label.string = available.length && selectedIds().length === available.length ? 'Bỏ chọn' : 'Chọn tất cả';
        var logs = Array.isArray(state.logs) ? state.logs.map(logText).filter(Boolean).slice(-3) : [];
        refs.logs.string = logs.length ? logs.join('\n') : 'Kết quả từng tác vụ sẽ xuất hiện ở đây.';
        refs.bubbleLabel.string = isRunning ? 'Auto\n' + done + '/' + total : 'Auto';
        var bubbleFill = isRunning ? 'green' : 'blue';
        if (refs.bubbleFill !== bubbleFill) {
            refs.bubbleFill = bubbleFill;
            paint(bubble, bubble.width, bubble.height, bubbleFill, 19 * dimensions.scale, 'border');
        }
        updateRows();
    }

    function inspectAccount() {
        if (!core || typeof core.inspect !== 'function' || checking) { return; }
        checking = true;
        update();
        try {
            Promise.resolve(core.inspect()).then(function (result) {
                if (destroyed) { return; }
                accountName = safeText(result && result.account && result.account.name, 40);
                if (result && result.ready === false) {
                    localStatus = safeText(result.status, 100) || 'Anh đăng nhập vào game để sử dụng auto.';
                    localError = false;
                } else if (!running()) { localStatus = ''; localError = false; }
            }, function () {
                if (!destroyed) { localStatus = 'Chưa đọc được thông tin nhân vật.'; localError = true; }
            }).then(function () { checking = false; update(); });
        } catch (_) {
            checking = false;
            localStatus = 'Chưa đọc được thông tin nhân vật.';
            localError = true;
            update();
        }
    }

    function startSelected() {
        if (!core || running() || typeof core.runSelected !== 'function') { return; }
        var ids = selectedIds();
        if (!ids.length) { return; }
        localStatus = '';
        localError = false;
        persistSelection();
        try {
            Promise.resolve(core.runSelected(ids)).then(function () { update(); }, function () {
                localStatus = 'Phiên auto chưa hoàn tất. Anh xem kết quả tác vụ bên dưới.';
                localError = true;
                update();
            });
        } catch (_) {
            localStatus = 'Chưa thể bắt đầu auto. Anh kiểm tra đăng nhập game.';
            localError = true;
        }
        update();
    }

    function setOpen(value) {
        opened = !!value;
        if (valid(panel)) { panel.active = opened; }
        if (valid(bubble)) { bubble.active = !opened; }
        if (opened) { inspectAccount(); update(); }
    }

    function createMenu(parent, currentScene, width, height) {
        if (valid(root)) { root.destroy(); }
        host = parent;
        scene = currentScene;
        taskSignature = '';
        dimensions = { width: width, height: height, scale: Math.max(0.45, Math.min(width / 540, height / 960)) };
        var s = dimensions.scale;
        var pw = Math.min(width - 24 * s, 510 * s);
        var ph = Math.min(height - 24 * s, 810 * s);
        root = node('__AutoAPKMenu', parent, width, height,
            (0.5 - (parent.anchorX === undefined ? 0.5 : parent.anchorX)) * width,
            (0.5 - (parent.anchorY === undefined ? 0.5 : parent.anchorY)) * height);
        root.zIndex = 2147480000;
        refs = {};
        panel = node('Panel', root, pw, ph, 0, 0);
        paint(panel, pw, ph, 'panel', 15 * s, 'border');
        // No full-screen listener: when collapsed, only the small Auto button owns touch input.
        bindTouch(panel, {});
        label(panel, 'Heading', 'TẠP HÓA • AUTO', pw - 96 * s, 34 * s,
            -19 * s, ph / 2 - 29 * s, 22 * s);
        label(panel, 'Subtitle', 'Bản thử nghiệm Android', pw - 32 * s, 20 * s,
            0, ph / 2 - 56 * s, 13 * s, 'muted');
        button(panel, 'Close', '×', 36 * s, 36 * s, pw / 2 - 29 * s,
            ph / 2 - 29 * s, 'row', function () { setOpen(false); });
        refs.account = label(panel, 'Account', '', pw - 36 * s, 30 * s,
            0, ph / 2 - 85 * s, 16 * s);
        label(panel, 'TaskHeading', 'Chọn tác vụ', pw - 160 * s, 28 * s,
            -62 * s, ph / 2 - 124 * s, 17 * s, 'text', 'left');
        refs.selectAll = button(panel, 'SelectAll', 'Chọn tất cả', 114 * s, 30 * s,
            pw / 2 - 76 * s, ph / 2 - 124 * s, 'row', function () {
                if (running()) { return; }
                var all = tasks();
                var deselect = selectedIds().length === all.length;
                all.forEach(function (task) { selected[task.id] = !deselect; });
                persistSelection(); update();
            });

        var top = ph / 2 - 150 * s;
        var bottom = -ph / 2 + 239 * s;
        listHeight = Math.max(74 * s, top - bottom);
        rowHeight = 48 * s;
        viewport = node('TaskViewport', panel, pw - 36 * s, listHeight, 0, top - listHeight / 2);
        if (cc.Mask) {
            var mask = viewport.addComponent(cc.Mask);
            if (cc.Mask.Type) { mask.type = cc.Mask.Type.RECT; }
        }
        listContent = node('TaskContent', viewport, viewport.width, listHeight, 0, 0);
        var drag = null;
        bindTouch(viewport, {
            start: function (event) { drag = { point: point(event, viewport), offset: listOffset, moved: false }; },
            move: function (event) {
                if (!drag) { return; }
                var p = point(event, viewport);
                var delta = p.y - drag.point.y;
                if (Math.abs(delta) > 7 * s || Math.abs(p.x - drag.point.x) > 9 * s) { drag.moved = true; }
                updateScroll(drag.offset + delta);
            },
            end: function (event) {
                if (drag && !drag.moved && !running()) {
                    var p = point(event, viewport);
                    var index = Math.floor((listHeight / 2 + listOffset - p.y) / rowHeight);
                    if (p.y >= -listHeight / 2 && p.y <= listHeight / 2 && rows[index]) {
                        if (rows[index].configurable && p.x > viewport.width / 2 - 60 * s) openEditor(rows[index].task);
                        else {
                            selected[rows[index].id] = !selected[rows[index].id];
                            persistSelection(); update();
                        }
                    }
                }
                drag = null;
            },
            cancel: function () { drag = null; }
        });
        refs.scrollHint = label(panel, 'ScrollHint', '', pw - 36 * s, 18 * s,
            0, bottom - 12 * s, 11 * s, 'muted');
        label(panel, 'StatusHeading', 'TRẠNG THÁI', pw - 40 * s, 20 * s,
            0, -ph / 2 + 199 * s, 12 * s, 'muted', 'left');
        refs.status = label(panel, 'Status', '', pw - 40 * s, 36 * s,
            0, -ph / 2 + 172 * s, 16 * s, 'text', 'left');
        refs.progress = label(panel, 'Progress', '', pw - 40 * s, 24 * s,
            0, -ph / 2 + 143 * s, 13 * s, 'muted', 'left');
        refs.logs = label(panel, 'Logs', '', pw - 40 * s, 74 * s,
            0, -ph / 2 + 94 * s, 13 * s, 'muted', 'left');
        var buttonGap = 8 * s;
        var actionWidth = (pw - 40 * s - buttonGap * 2) / 3;
        var actionY = -ph / 2 + 30 * s;
        refs.start = button(panel, 'Start', 'Chạy đã chọn', actionWidth, 42 * s,
            -actionWidth - buttonGap, actionY, 'green', startSelected);
        refs.stop = button(panel, 'Stop', 'Dừng', actionWidth, 42 * s, 0, actionY, 'red', function () {
            if (core && typeof core.stop === 'function') {
                try { core.stop(); localStatus = ''; localError = false; }
                catch (_) { localStatus = 'Chưa dừng được tác vụ. Anh thử lại.'; localError = true; }
                update();
            }
        });
        refs.check = button(panel, 'Check', 'Kiểm tra', actionWidth, 42 * s,
            actionWidth + buttonGap, actionY, 'blue', inspectAccount);

        bubble = node('AutoButton', root, 65 * s, 56 * s,
            (bubblePosition.x - 0.5) * width, (bubblePosition.y - 0.5) * height);
        refs.bubbleLabel = label(bubble, 'AutoTitle', 'Auto', 63 * s, 50 * s, 0, 0, 17 * s);
        var bubbleDrag = null;
        bindTouch(bubble, {
            start: function (event) {
                bubbleDrag = { point: point(event, root), x: bubble.x, y: bubble.y, moved: false };
            },
            move: function (event) {
                if (!bubbleDrag) { return; }
                var p = point(event, root);
                var dx = p.x - bubbleDrag.point.x;
                var dy = p.y - bubbleDrag.point.y;
                if (Math.abs(dx) + Math.abs(dy) > 8 * s) { bubbleDrag.moved = true; }
                bubble.x = clamp(bubbleDrag.x + dx, -width / 2 + 37 * s, width / 2 - 37 * s);
                bubble.y = clamp(bubbleDrag.y + dy, -height / 2 + 34 * s, height / 2 - 34 * s);
            },
            end: function () {
                if (!bubbleDrag) { return; }
                if (!bubbleDrag.moved) { setOpen(true); }
                bubblePosition = { x: bubble.x / width + 0.5, y: bubble.y / height + 0.5 };
                bubbleDrag = null;
            },
            cancel: function () { bubbleDrag = null; }
        });
        setOpen(opened);
        update();
        if (editor) drawEditor();
    }

    function findHost(currentScene) {
        var canvas = null;
        try { canvas = cc.find('Canvas', currentScene); } catch (_) { /* Wait for scene entry. */ }
        if (valid(canvas)) { return canvas; }
        try {
            var require = global.__require;
            var ui = global.fgui || (require && require('fairygui'));
            var groot = ui && (ui.GRoot || (ui.fgui && ui.fgui.GRoot));
            var uiRoot = groot && groot.inst && groot.inst.node;
            if (valid(uiRoot) && valid(uiRoot.parent)) { return uiRoot.parent; }
        } catch (_) { /* The game may not load FairyGUI until login. */ }
        return null;
    }

    function tick() {
        if (destroyed) { return; }
        try {
            cc = global.cc;
            if (!cc || !cc.director || !cc.Node || !cc.Label || !cc.Graphics) { return; }
            if (core !== global.AutoAPK) {
                if (unsubscribe) { try { unsubscribe(); } catch (_) {} }
                core = global.AutoAPK;
                unsubscribe = null;
                selectionLoaded = false;
                if (!core) { return; }
                core.menu = api;
                loadSelection();
                if (typeof core.subscribe === 'function') {
                    unsubscribe = core.subscribe(function () {
                        localStatus = '';
                        localError = false;
                        try { update(); } catch (_) { /* Next scene tick rebuilds if needed. */ }
                    });
                }
                inspectAccount();
            }
            if (!core) { return; }
            var currentScene = cc.director.getScene();
            if (!valid(currentScene)) { return; }
            var parent = findHost(currentScene);
            if (!valid(parent)) { return; }
            var size = parent.getContentSize();
            if (!size || !(size.width > 0) || !(size.height > 0)) {
                size = cc.view && cc.view.getVisibleSize ? cc.view.getVisibleSize() : null;
            }
            if (!size || !(size.width > 0) || !(size.height > 0)) { return; }
            if (!valid(root) || parent !== host || currentScene !== scene ||
                    Math.abs(size.width - dimensions.width) > 1 || Math.abs(size.height - dimensions.height) > 1) {
                createMenu(parent, currentScene, size.width, size.height);
            } else { update(); }
        } catch (_) {
            // Keep failures local to the optional menu. Never interrupt the game loop.
            if (valid(root)) { try { root.destroy(); } catch (_) {} }
            root = null;
        }
    }

    var api = {
        version: VERSION,
        open: function () { setOpen(true); tick(); },
        close: function () { setOpen(false); },
        refresh: function () { inspectAccount(); tick(); },
        isInstalled: function () { return valid(root); },
        inspect: function () {
            return { installed: valid(root), opened: opened, selected: selectedIds(),
                taskCount: tasks().length, account: accountName, size: dimensions };
        },
        destroy: function () {
            destroyed = true;
            if (timer !== null) { global.clearInterval(timer); timer = null; }
            if (unsubscribe) { try { unsubscribe(); } catch (_) {} unsubscribe = null; }
            if (valid(root)) { try { root.destroy(); } catch (_) {} }
            if (core && core.menu === api) { delete core.menu; }
            root = null;
        }
    };
    global.__AutoAPKMenu = api;
    tick();
    timer = global.setInterval(tick, 1000);
})(typeof window !== 'undefined' ? window : globalThis);
