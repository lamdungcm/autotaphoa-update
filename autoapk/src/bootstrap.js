/* Frida Gadget entry point. Its only job is to install the Cocos runtime safely
 * on the game's own scheduler thread. No listening socket, PC or Java bridge. */
'use strict';
const runtimeSource = __GAME_RUNTIME_SOURCE__;
const bootSource = '(function(){if(typeof window==="undefined"||typeof cc==="undefined"||' +
    'typeof window.__require!=="function")return false;' +
    'if(window.__autoapkBootComplete)return true;\n' + runtimeSource +
    '\nwindow.__autoapkBootComplete=true;return true;})()';
let listener = null, poll = null, codePointer = null, probePointer = null;
let stage = 'waiting_library', lastError = '', attempts = 0;
let androidLog = null;
function diagnostic(message) {
    try {
        if (!androidLog) {
            const address = Module.findExportByName(null, '__android_log_write');
            if (!address) return;
            androidLog = new NativeFunction(address, 'int', ['int', 'pointer', 'pointer']);
        }
        androidLog(4, Memory.allocUtf8String('AutoAPK'), Memory.allocUtf8String(message));
    } catch (_) { /* Diagnostics must never prevent the game from starting. */ }
}

function install() {
    const module = Process.findModuleByName('libcocos2djs.so');
    if (!module || listener || stage === 'installed') return;
    diagnostic('Cocos found; architecture=' + Process.arch);
    // Resolve dynamic exports directly. On Android an available export may be
    // absent from enumerateSymbols() when the ELF has a separate symbol table.
    function symbol(name) {
        const value = Module.findExportByName('libcocos2djs.so', name);
        if (!value) throw new Error('Missing Cocos export: ' + name);
        return value;
    }
    const evalName = ['_ZN2se12ScriptEngine10evalStringEPKciPNS_5ValueES2_',
        '_ZN2se12ScriptEngine10evalStringEPKclPNS_5ValueES2_'].find(name =>
            Module.findExportByName('libcocos2djs.so', name));
    if (!evalName) throw new Error('Missing Cocos evalString export');
    const getInstance = new NativeFunction(symbol('_ZN2se12ScriptEngine11getInstanceEv'), 'pointer', []);
    const evaluate = new NativeFunction(symbol(evalName), 'bool',
        ['pointer','pointer',evalName.indexOf('EPKci') >= 0 ? 'int' : 'long','pointer','pointer']);
    const construct = new NativeFunction(symbol('_ZN2se5ValueC1Ev'), 'void', ['pointer']);
    const destruct = new NativeFunction(symbol('_ZN2se5ValueD1Ev'), 'void', ['pointer']);
    const toBoolean = new NativeFunction(symbol('_ZNK2se5Value9toBooleanEv'), 'bool', ['pointer']);
    codePointer = Memory.allocUtf8String(bootSource);
    probePointer = Memory.allocUtf8String('typeof window!=="undefined" && window.__autoapkBootComplete===true');
    let busy = false, next = 0;
    stage = 'waiting_game';
    listener = Interceptor.attach(symbol('_ZN7cocos2d9Scheduler6updateEf'), {
        onEnter() {
            if (busy || Date.now() < next) return;
            next = Date.now() + 1000; busy = true;
            const value = Memory.alloc(64);
            let initialized = false;
            try {
                construct(value); initialized = true;
                if (stage === 'installed') {
                    const valid = evaluate(getInstance(), probePointer, -1, value, ptr(0));
                    if (valid && toBoolean(value)) return;
                    stage = 'waiting_game';
                    diagnostic('Game context changed; restoring embedded runtime');
                }
                attempts++;
                const ok = evaluate(getInstance(), codePointer, -1, value, ptr(0));
                if (attempts === 1 || attempts === 10 || attempts === 30)
                    diagnostic('Runtime attempt=' + attempts + '; eval=' + ok + '; ready=' + (ok && toBoolean(value)));
                if (ok && toBoolean(value)) {
                    stage = 'installed';
                    diagnostic('Embedded runtime installed');
                    // Hot updates call cc.game.restart(), replacing the JS context.
                    // Keep the scheduler probe so the optional menu returns afterward.
                    if (poll !== null) { clearInterval(poll); poll = null; }
                    console.log('[AutoAPK] Embedded runtime installed');
                }
            } catch (e) { lastError = String(e); diagnostic('Runtime error: ' + lastError); }
            finally { if (initialized) { try { destruct(value); } catch (_) {} } busy = false; }
        }
    });
}
function start() {
    if (poll !== null || stage === 'installed') return;
    diagnostic('Bootstrap started; architecture=' + Process.arch);
    poll = setInterval(function () {
        try { install(); }
        catch (e) { lastError = String(e); stage = 'unsupported_engine';
            diagnostic('Engine error: ' + lastError);
            if (poll !== null) { clearInterval(poll); poll = null; }
            console.error('[AutoAPK] Game engine incompatible with this test build'); }
    }, 250);
    try { install(); } catch (e) { lastError = String(e); diagnostic('Initial error: ' + lastError); }
}
rpc.exports = {
    init() { start(); },
    status() { return {stage: stage, architecture: Process.arch, attempts: attempts, error: lastError}; },
    dispose() { if (poll !== null) clearInterval(poll); if (listener) listener.detach(); poll = null; listener = null; }
};
