"""Build a scoped copy of current native manager/network methods.

The game keeps its original singletons and prototypes. AutoAPK invokes copies
with a per-run transport so every awaited request obeys Stop/account/deadline.
Only feature managers, network utilities and their utility dependencies enter
this bundle. Views/core services remain the original game objects.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

EXTERNAL = {
    'App', 'GameNetUtil', 'GameNetMgr', 'ProtobufMgr', 'PlayerMgr', 'BagMgr',
    'EventMgr', 'UIMgr', 'DBUtil', 'GameBaseMgr', 'CoreConfig', 'Utils', 'Logger',
    'SystemMgr', 'RedPointMgr', 'ResourceMgr', 'AudioMgr',
}

def extract(source: str, roots: set[str]) -> dict:
    headers = list(re.finditer(r'^(\w+): \[ function\([^)]*\) \{', source, re.M))
    modules = {}
    for index, match in enumerate(headers):
        text = source[match.end(): headers[index + 1].start() if index + 1 < len(headers) else len(source)]
        split = text.rfind('\n}, {')
        if split < 0:
            continue
        mapping = text[split + 4:text.rfind('} ],') + 1]
        try:
            deps = json.loads(mapping)
        except json.JSONDecodeError:
            continue
        modules[match.group(1)] = (text[:split], deps)
    selected = set()
    def visit(name):
        if name in selected or name in EXTERNAL or name not in modules:
            return
        if not name.endswith(('Mgr', 'NetUtil', 'Util')):
            return
        selected.add(name)
        for target in modules[name][1].values():
            visit(target)
    for name in roots:
        visit(name)
    return {name: modules[name] for name in sorted(selected)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--game-source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--roots', nargs='+', required=True)
    args = parser.parse_args()
    source = args.game_source.read_text(encoding='utf-8')
    modules = extract(source, set(args.roots))
    lines = ['/* Generated from current game source. Scoped methods; original game classes are untouched. */',
             '(function(root){ "use strict"; root.AutoAPK.port.nativeModules = {']
    for name, (body, deps) in modules.items():
        lines.append(json.dumps(name) + ':{deps:' + json.dumps(deps, ensure_ascii=False) + ',factory:function(t,e,i,cc,window,globalThis,setTimeout,clearTimeout,setInterval,clearInterval){' + body + '\n}},')
    lines.append('}; })(typeof window!=="undefined"?window:globalThis);\n')
    args.output.write_text('\n'.join(lines), encoding='utf-8')
    args.output.with_suffix('.provenance.json').write_text(json.dumps({
        'source': str(args.game_source), 'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
        'roots': args.roots, 'modules': list(modules), 'count': len(modules),
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'modules': len(modules), 'bytes': args.output.stat().st_size}))

if __name__ == '__main__':
    main()
