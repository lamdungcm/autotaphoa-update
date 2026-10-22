"""Read-only coverage audit; mapping coverage is not evidence of live execution."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def audit(source: Path, output: Path, strict: bool = False, runtime_source: Path | None = None):
    desktop_text = source.read_text(encoding='utf-8')
    actions = sorted(n.name for n in ast.walk(ast.parse(desktop_text)) if isinstance(n, ast.FunctionDef) and n.name.startswith('action_'))
    script = '''const fs=require('fs'),vm=require('vm'),path=require('path');
const base=process.argv[1],box=vm.createContext({window:{}});
for(const name of JSON.parse(fs.readFileSync(path.join(base,'bundle.json'),'utf8'))){
 if(name==='menu.js')continue;
 vm.runInContext(fs.readFileSync(path.join(base,name),'utf8'),box,{filename:name});
}
const api=box.window.AutoAPK;
process.stdout.write(JSON.stringify({version:api.version,mapping:api.port.desktop,tasks:api.tasks.map(t=>({id:t.id,name:t.name,group:t.group||'Nhận thưởng',options:t.options||[]}))}));'''
    options = {}
    if hasattr(subprocess, 'STARTUPINFO'):
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
        options = {'startupinfo': startup, 'creationflags': 0x08000000}
    completed = subprocess.run(['node', '-e', script, str(runtime_source or ROOT / 'src')], check=True, capture_output=True, encoding='utf-8', **options)
    data = json.loads(completed.stdout)
    missing = [name for name in actions if name not in data['mapping']]
    stale = [name for name in data['mapping'] if name not in actions]
    duplicated = len({row['id'] for row in data['tasks']}) != len(data['tasks'])
    result = {'source': str(source), 'source_sha256': hashlib.sha256(desktop_text.encode()).hexdigest(),
              'action_count': len(actions), 'mapped_count': len(actions)-len(missing), 'missing': missing,
              'stale_mappings': stale, 'duplicate_task_ids': duplicated, 'source_coverage_complete': not (missing or stale or duplicated),
              'live_verified': False, **data}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'actions': len(actions), 'mapped': result['mapped_count'], 'tasks': len(data['tasks']), 'missing': len(missing), 'source_coverage_complete': result['source_coverage_complete']}))
    if strict and not result['source_coverage_complete']:
        raise SystemExit('Full port is incomplete. See ' + str(output))
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT.parents[1] / 'capture' / 'action_request_engine.py')
    parser.add_argument('--output', type=Path, default=ROOT / 'FULL_PORT_COVERAGE.json')
    parser.add_argument('--strict', action='store_true')
    args = parser.parse_args()
    audit(args.source, args.output, args.strict)
