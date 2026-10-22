'use strict';

// A deterministic Cocos stub verifies menu behavior without starting a game.
// Real Android rendering and touch coordinates still need a device smoke test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'menu.js'), 'utf8');

class Node {
    constructor(name) {
        this.name = name;
        this.children = [];
        this.components = [];
        this.listeners = {};
        this.anchorX = 0.5;
        this.anchorY = 0.5;
        this.active = true;
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
    }

    setContentSize(width, height) { this.width = width; this.height = height; }
    getContentSize() { return { width: this.width, height: this.height }; }
    setPosition(x, y) { this.x = x; this.y = y; }
    addChild(child) { child.parent = this; this.children.push(child); }
    getComponent(Component) { return this.components.find(item => item instanceof Component) || null; }
    addComponent(Component) {
        const component = new Component();
        component.node = this;
        this.components.push(component);
        // Native Label activation may initially apply its automatic text bounds.
        if (Component === Label) { this.setContentSize(0, 0); }
        return component;
    }

    on(kind, listener) { (this.listeners[kind] || (this.listeners[kind] = [])).push(listener); }
    destroy() {
        this.destroyed = true;
        this.children.forEach(child => child.destroy());
        if (this.parent) {
            this.parent.children = this.parent.children.filter(child => child !== this);
        }
    }

    removeAllChildren() { this.children.slice().forEach(child => child.destroy()); }
    convertToNodeSpaceAR(point) { return point; }
    emit(kind, point = { x: 0, y: 0 }) {
        for (const listener of this.listeners[kind] || []) {
            listener({ getLocation: () => point, stopPropagation() {} });
        }
    }
}

Node.EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' };

class Label {}
Label.Overflow = { CLAMP: 1 };
Label.HorizontalAlign = { LEFT: 0, CENTER: 1 };
Label.VerticalAlign = { CENTER: 1 };

class Graphics {
    clear() {}
    roundRect() {}
    rect() {}
    fill() {}
    stroke() {}
}

class Mask {}
Mask.Type = { RECT: 0 };

test('Cocos menu preserves selection, run controls, scrolling and scene lifecycle', async () => {
    const storage = {};
    let scene = new Node('Scene');
    let canvas = new Node('Canvas');
    canvas.setContentSize(540, 960);
    scene.addChild(canvas);

    let nextTimer = 0;
    const timers = new Map();
    let subscriptions = 0;
    let notify;
    let runIds;
    let stops = 0;

    const core = {
        tasks: Array.from({ length: 20 }, (_, index) => ({
            id: 'task' + index,
            name: 'Tác vụ ' + index,
            run() {}
        })),
        settings: { selected: [] },
        state: { running: false, status: 'Sẵn sàng', logs: [], progress: { done: 0, total: 0 } },
        subscribe(listener) {
            subscriptions++;
            notify = listener;
            return () => { subscriptions--; };
        },
        inspect() { return { ready: true, account: { name: 'Nhân Vật' } }; },
        runSelected(ids) {
            runIds = ids;
            this.state.running = true;
            this.state.progress = { done: 0, total: ids.length };
            notify();
            return Promise.resolve();
        },
        stop() { stops++; this.state.running = false; notify(); }
    };

    const win = {
        AutoAPK: core,
        cc: {
            Node, Label, Graphics, Mask,
            Color: class { constructor(...args) { this.rgba = args; } },
            isValid: item => item && !item.destroyed,
            find: (name, parent) => parent.children.find(child => child.name === name),
            director: { getScene: () => scene },
            sys: { localStorage: {
                getItem: key => Object.hasOwn(storage, key) ? storage[key] : null,
                setItem: (key, value) => { storage[key] = value; }
            } }
        },
        setInterval(listener) { const id = ++nextTimer; timers.set(id, listener); return id; },
        clearInterval(id) { timers.delete(id); }
    };

    const context = vm.createContext({ window: win });
    const find = (name, parent = canvas) => parent.name === name ? parent :
        parent.children.map(child => find(name, child)).find(Boolean);
    const press = target => { target.emit('start'); target.emit('end'); };
    vm.runInContext(source, context);

    assert(core.menu.isInstalled());
    assert.equal(subscriptions, 1);
    assert.equal(timers.size, 1);
    assert.equal(find('Panel').active, false);
    assert.equal(find('AutoButton').active, true);
    assert.equal(find('AutoTitle').width, 63);
    assert.equal(find('AutoTitle').height, 50);
    assert.equal(find('Heading').height, 34);
    assert(find('Start').children.find(child => child.name === 'Title').width > 100);

    press(find('AutoButton'));
    assert.equal(find('Panel').active, true);
    press(find('SelectAll'));
    assert.equal(core.settings.selected.length, 20);
    assert.equal(JSON.parse(storage['autotaphoa.autoapk.selected.v1']).length, 20);

    press(find('Start'));
    assert.equal(runIds.length, 20);
    assert(core.state.running);
    press(find('Close'));
    assert.equal(find('Panel').active, false);
    assert(core.state.running, 'Collapsing the menu must preserve the active task.');
    press(find('AutoButton'));
    press(find('Stop'));
    assert.equal(stops, 1);
    assert.equal(core.state.running, false);

    press(find('SelectAll'));
    assert.equal(core.settings.selected.length, 0);
    const viewport = find('TaskViewport');
    const content = find('TaskContent');
    viewport.emit('start', { x: 0, y: 0 });
    viewport.emit('move', { x: 0, y: 220 });
    viewport.emit('end', { x: 0, y: 220 });
    assert.equal(content.y, 220);
    assert.equal(core.settings.selected.length, 0, 'A swipe must not toggle a task.');
    viewport.emit('start', { x: 0, y: 0 });
    viewport.emit('end', { x: 0, y: 0 });
    assert.equal(core.settings.selected.length, 1);

    core.state.logs = ['0x6D08 userId 12345678901234'];
    notify();
    assert(!find('Logs').getComponent(Label).string.includes('12345678901234'));

    press(find('Close'));
    const bubble = find('AutoButton');
    const initialX = bubble.x;
    bubble.emit('start', { x: 0, y: 0 });
    bubble.emit('move', { x: -80, y: 20 });
    bubble.emit('end', { x: -80, y: 20 });
    assert(bubble.x < initialX);
    assert.equal(find('Panel').active, false, 'Dragging must not open the panel.');

    const oldRoot = find('__AutoAPKMenu');
    scene = new Node('Scene2');
    canvas = new Node('Canvas');
    canvas.setContentSize(540, 960);
    scene.addChild(canvas);
    [...timers.values()][0]();
    assert(oldRoot.destroyed);
    assert(core.menu.isInstalled());
    assert.equal(subscriptions, 1);
    assert.equal(find('Panel').active, false);

    const replacement = find('__AutoAPKMenu');
    canvas.setContentSize(650, 1200);
    [...timers.values()][0]();
    assert(replacement.destroyed);
    assert.equal(core.menu.inspect().size.width, 650);

    vm.runInContext(source, context);
    assert.equal(subscriptions, 1, 'Reinjection must unsubscribe the previous menu.');
    assert.equal(timers.size, 1, 'Reinjection must clear the previous interval.');
    assert.equal(canvas.children.filter(child => child.name === '__AutoAPKMenu').length, 1);
    core.menu.destroy();
    assert.equal(subscriptions, 0);
    assert.equal(timers.size, 0);
    assert.equal(canvas.children.filter(child => child.name === '__AutoAPKMenu').length, 0);
});
