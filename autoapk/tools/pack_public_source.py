"""Export the user-approved public AutoAPK source whitelist with file hashes.

No APK, signing identity, .local files, account settings or raw evidence enters
the archive. This prepares an artifact; it never publishes to a repository.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def files(root: Path):
    fixed = ['build.py', 'apk_tools.py', 'requirements.txt', '.gitignore',
        'FULL_PORT_COVERAGE.json', 'FULL_PORT_STATUS.md', 'PUBLIC_SOURCE_POLICY.md',
        'CAPABILITIES.json', 'PHONE_TEST_FULL.md']
    result = {name: root / name for name in fixed}
    result['README.md'] = root / 'PUBLIC_SOURCE_README.md'
    for folder, patterns in [('src', ['*.js', '*.json']), ('tools', ['*.py', '*.json']), ('tests', ['test_*.py', 'test_*.js'])]:
        for pattern in patterns:
            for path in (root / folder).glob(pattern):
                result[path.relative_to(root).as_posix()] = path
    fixture = root / 'tests/fixtures/official_manifest.axml'
    if fixture.is_file(): result['tests/fixtures/official_manifest.axml'] = fixture
    for name, path in result.items():
        if not path.is_file() or path.is_symlink() or any(part.startswith('.') and part != '.gitignore' for part in Path(name).parts):
            raise ValueError('Invalid public source path: ' + name)
    return dict(sorted(result.items()))

def pack(root: Path, output: Path):
    selected = files(root)
    manifest = []
    for name, path in selected.items():
        blob = path.read_bytes()
        manifest.append({'path': 'autoapk/' + name, 'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest(),
            'git_blob_sha1': hashlib.sha1(b'blob ' + str(len(blob)).encode() + b'\0' + blob).hexdigest()})
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, path in selected.items(): archive.writestr('autoapk/' + name, path.read_bytes())
        archive.writestr('SOURCE_MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8'))
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None: raise ValueError('Source ZIP CRC mismatch')
        for row in manifest:
            if hashlib.sha256(archive.read(row['path'])).hexdigest() != row['sha256']: raise ValueError('Source ZIP hash mismatch')
    result = {'path': str(output), 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'source_files': len(manifest), 'files': manifest, 'published': False}
    output.with_suffix('.manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'files'}, ensure_ascii=False))
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, default=ROOT / 'output/AutoAPK_source_full_20261022.zip')
    args = parser.parse_args()
    pack(args.root.resolve(), args.output.resolve())
