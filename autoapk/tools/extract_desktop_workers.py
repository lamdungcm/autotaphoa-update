"""Port the current, supplied desktop Cocos algorithms without a Python runtime.

Only explicitly selected AST assignments enter the APK. Substitutions are named
configuration values, never text from the network. The generated functions use
the per-run native scope and keep worker globals private to that run.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
from pathlib import Path

PARAMS = {
    'act_id': 'params.activityId', 'ACTIVITY_ID': 'params.activityId', 'activity_id': 'params.activityId',
    'rem_turns': 'params.limit', 'max_moves': 'params.limit', 'max_turns': 'params.limit',
    'max_steps': 'params.limit', 'max_battles': 'params.limit', 'max_games': 'params.limit',
    'cand_json': '[]',
}

def render(value):
    if isinstance(value, ast.Constant) and isinstance(value.value, str):
        return value.value
    if isinstance(value, ast.JoinedStr):
        result = ''
        for part in value.values:
            if isinstance(part, ast.Constant):
                result += part.value
            else:
                expression = ast.unparse(part.value)
                if expression not in PARAMS:
                    raise ValueError('Unreviewed worker placeholder: ' + expression)
                result += PARAMS[expression]
        return result
    raise ValueError('Worker must be a literal or explicit f-string')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--definitions', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    text = args.source.read_text(encoding='utf-8')
    actions = {n.name: n for n in ast.walk(ast.parse(text)) if isinstance(n, ast.FunctionDef) and n.name.startswith('action_')}
    definitions = json.loads(args.definitions.read_text(encoding='utf-8'))
    lines = ['/* Generated from current desktop source. See adjacent provenance JSON. */',
             '(function(root){ "use strict"; var P=root.AutoAPK.port; P.workers={};']
    provenance = []
    for definition in definitions:
        nodes = [n for n in ast.walk(actions[definition['action']]) if isinstance(n, ast.Assign) and
                 any(isinstance(target, ast.Name) and target.id == definition['var'] for target in n.targets)]
        if len(nodes) != 1:
            raise ValueError('Ambiguous worker: ' + definition['id'])
        node = nodes[0]
        source = render(node.value)
        provenance.append({'id': definition['id'], 'action': definition['action'], 'line': node.lineno,
                           'js_sha256': hashlib.sha256(source.encode()).hexdigest()})
        lines.append('P.workers[' + json.dumps(definition['id']) + ']={definition:' + json.dumps(definition, ensure_ascii=False) +
                     ',launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,'
                     'setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;\n'
                     'return ' + source.strip().rstrip(';') + ';\n}};')
    lines.append('})(typeof window!=="undefined"?window:globalThis);\n')
    args.output.write_text('\n'.join(lines), encoding='utf-8')
    args.output.with_suffix('.provenance.json').write_text(json.dumps({
        'source': str(args.source), 'source_sha256': hashlib.sha256(text.encode()).hexdigest(), 'workers': provenance,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'workers': len(definitions), 'bytes': args.output.stat().st_size}))

if __name__ == '__main__':
    main()
