"""Compare all embedded ABI scripts to source; inspect registry from APK bytes.

This verifies packaging. It does not install or execute the APK on Android.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from build import make_bootstrap
from apk_tools import hidden_run, manifest_info, sha256_file, verify_v2, verify_zip_layout

def verify(apk: Path, output: Path, source: Path, previous: Path | None = None):
    report = json.loads(apk.with_suffix('.build.json').read_text(encoding='utf-8'))
    payload, sources = make_bootstrap(source)
    entries = []
    with zipfile.ZipFile(apk) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP CRC mismatch')
        identity = manifest_info(archive.read('AndroidManifest.xml'))
        if identity['package'] != report['package']:
            raise ValueError('Manifest package mismatch')
        for abi in report['abis']:
            actual = archive.read('lib/' + abi + '/libautoapk.so')
            if actual != payload:
                raise ValueError('Embedded source mismatch: ' + abi)
            entries.append({'abi': abi, 'bytes': len(actual), 'sha256': hashlib.sha256(actual).hexdigest()})
    for item in report['runtime_sources']:
        if sha256_file(item['path']) != item['sha256']:
            raise ValueError('Source changed since build: ' + item['path'])
    signature = verify_v2(apk)
    same = None
    if previous:
        earlier = json.loads(previous.read_text(encoding='utf-8'))
        same = signature['certificate_sha256'] == earlier['signature']['internal_verification']['certificate_sha256']
        if not same:
            raise ValueError('Test signing identity changed')
    verify_zip_layout(apk)
    runtime = json.JSONDecoder().raw_decode(actual.decode().split('const runtimeSource = ', 1)[1])[0]
    # Pipe only the extracted source to Node. No Android/device globals are invoked.
    script = """const fs=require('fs'),vm=require('vm');
const root={setInterval(){return 1},clearInterval(){}};
const box=vm.createContext({window:root});
vm.runInContext(fs.readFileSync(0,'utf8'),box);
const a=root.AutoAPK;
process.stdout.write(JSON.stringify({tasks:a.tasks.length,mapped:Object.keys(a.port.desktop).length,
 unique:new Set(a.tasks.map(t=>t.id)).size,menuPresent:!!root.__AutoAPKMenu}));"""
    completed = hidden_run(['node', '-e', script], input=runtime, timeout=60)
    if completed.returncode:
        raise ValueError(completed.stderr[-2000:])
    registry = json.loads(completed.stdout)
    if registry['unique'] != registry['tasks']:
        raise ValueError('Duplicate APK task IDs')
    coverage = report.get('desktop_source_coverage')
    if coverage and (registry['mapped'] != coverage['mapped_count'] or registry['tasks'] != coverage['apk_tasks']):
        raise ValueError('APK registry does not match source coverage gate')
    result = {'apk': str(apk), 'bytes': apk.stat().st_size, 'sha256': sha256_file(apk),
        'package': identity['package'], 'signature': signature, 'same_test_certificate_as_previous': same,
        'crc_verified': True, 'layout_verified': True, 'embedded_runtime': entries,
        'runtime_source_count': len(sources), 'all_sources_match_build_report': True,
        'registry_from_embedded_runtime': registry, 'physical_phone_verified': False,
        'current_build_runtime_tested': False}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--source', type=Path, default=ROOT / 'src')
    parser.add_argument('--previous-build-report', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    verify(args.apk.resolve(), args.output.resolve(), args.source.resolve(), args.previous_build_report)
