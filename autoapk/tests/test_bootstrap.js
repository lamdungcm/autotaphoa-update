'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
    let now = 10000, installed = 0, constructed = 0, destroyed = 0;
    let game, hook, detached = false;
    const timers = new Map();
    function reset(ready = true) {
        game = {window: ready ? {__require() {}} : {}, cc: {},
            installRuntime() { installed++; }};
        vm.createContext(game);
    }
    reset();
    const native = {
        _ZN2se12ScriptEngine11getInstanceEv() { return {}; },
        _ZN2se12ScriptEngine10evalStringEPKciPNS_5ValueES2_(engine, code, len, value) {
            value.bool = !!vm.runInContext(code.text, game);
            return true;
        },
        _ZN2se5ValueC1Ev(value) { constructed++; value.initialized = true; },
        _ZN2se5ValueD1Ev(value) { assert.equal(value.initialized, true); destroyed++; },
        _ZNK2se5Value9toBooleanEv(value) { return value.bool; },
        _ZN7cocos2d9Scheduler6updateEf() {}
    };
    const sandbox = {
        // Android may expose the dynamic function but no enumerated symbols.
        Process: {arch: 'ia32', findModuleByName() { return {}; }},
        Module: {findExportByName(module, name) {
            return module === 'libcocos2djs.so' && native[name] ? name : null;
        }},
        NativeFunction: function (name) { return native[name]; },
        Memory: {alloc() { return {}; }, allocUtf8String(text) { return {text}; }},
        Interceptor: {attach(address, callbacks) {
            hook = callbacks; return {detach() { detached = true; }};
        }},
        ptr(n) { return n; }, Date: {now() { return now; }},
        setInterval(fn) { timers.set(1, fn); return 1; },
        clearInterval(id) { timers.delete(id); },
        rpc: {exports: {}}, console: {log() {}, error() {}}
    };
    const source = fs.readFileSync(path.join(__dirname, '../src/bootstrap.js'), 'utf8')
        .replace('__GAME_RUNTIME_SOURCE__', JSON.stringify('installRuntime();'));
    vm.runInNewContext(source, sandbox);
    sandbox.rpc.exports.init();
    return {reset, exports: sandbox.rpc.exports,
        tick() { assert.equal(detached, false); now += 1001; hook.onEnter(); },
        get installed() { return installed; },
        get constructed() { return constructed; },
        get destroyed() { return destroyed; },
        get detached() { return detached; }};
}

test('bootstrap restores runtime after a game restart without duplicating a live context', () => {
    const h = harness();
    h.tick();
    assert.equal(h.installed, 1);
    h.tick(); h.tick();
    assert.equal(h.installed, 1);
    h.reset();
    h.tick();
    assert.equal(h.installed, 2);
    h.tick();
    assert.equal(h.installed, 2);
    assert.equal(h.exports.status().stage, 'installed');
    assert.equal(h.constructed, h.destroyed);
    h.exports.dispose();
    assert.equal(h.detached, true);
});

test('bootstrap waits for the game loader again when restart has not finished', () => {
    const h = harness(); h.tick();
    h.reset(false); h.tick(); h.tick();
    assert.equal(h.installed, 1);
    assert.equal(h.exports.status().stage, 'waiting_game');
    h.reset(true); h.tick();
    assert.equal(h.installed, 2);
    assert.equal(h.constructed, h.destroyed);
});
