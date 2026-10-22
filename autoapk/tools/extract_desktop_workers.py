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

# Exact, auditable corrections to the current PC code. Never modify PC source.
PATCHES = {
    'vo_hau_khai_quoc': [
        ("let qRes = await wztMgr.reqChallengeCheckQuickBattle(actId);", "let quick = await wztMgr.reqChallengeCheckQuickBattle(actId);\n                                if (!quick || !quick.resp) throw new Error('Chưa có kết quả vượt nhanh');\n                                let qRes = quick.resp;"),
    ],
    'nho_cu_cai': [
        ("if (res.ret !== 0 && res.ret !== undefined)", "if (res.ret !== 0)"),
        ("summary.turnsDone += (res.actuallyPluckTimes || 1);", "if (!Number.isSafeInteger(res.actuallyPluckTimes) || res.actuallyPluckTimes < 0) throw new Error('Chưa có số lượt nhổ thực tế');\n                                    if (!res.actuallyPluckTimes) break;\n                                    summary.turnsDone += res.actuallyPluckTimes;"),
        ("await gnu.syncSeqSendMsg(proto.S_PLUCK_CARROTS_NEXT_LEVEL, { activityId: actId });\n                                        summary.levelsCleared++;", "let next = await gnu.syncSeqSendMsg(proto.S_PLUCK_CARROTS_NEXT_LEVEL, { activityId: actId });\n                                        if (!next || next.ret !== 0) throw new Error('Chưa xác nhận chuyển ải củ cải');\n                                        let current = await gnu.syncSeqSendMsg(proto.S_PLUCK_CARROTS_INFO, { activityId: actId });\n                                        if (!current || current.ret !== 0 || !current.info || !res.info || Number(current.info.level) <= Number(res.info.level)) throw new Error('Ải củ cải chưa tăng');\n                                        summary.levelsCleared++;"),
    ],
    'van_quoc_thong_thuong': [
        ("let costOneKey = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_COST_ENERGY, { activityId: actId, oneKey: true });", "let costOneKey = null; // Only individual, budgeted trades; never consume all energy in one request."),
        ("curEnergy = (c.energy !== undefined) ? c.energy : (curEnergy - 1);", "if (!Number.isSafeInteger(c.energy) || c.energy >= curEnergy) throw new Error('Chưa xác nhận thể lực giao thương giảm');\n                                            curEnergy = c.energy;"),
        ("curEnergy = (c2.energy !== undefined) ? c2.energy : (curEnergy - 1);", "if (!Number.isSafeInteger(c2.energy) || c2.energy >= curEnergy) throw new Error('Chưa xác nhận thể lực giao thương giảm');\n                                                curEnergy = c2.energy;"),
        ("// g. Nhận thưởng sổ tay đồ giám (bookId 1..15)", "// g. No guessed book IDs. Use actual native eligibility from the loaded package."),
        ("let gained = (info2 && info2.gainedBookId) || [];\n                            for (let bId = 1; bId <= 15; bId++) {", "let gained = (info2 && info2.gainedBookId) || [];\n                            let pkg = await req('ScriptPkgExport').ActivityThirteenHongs.asyncDone();\n                            let main = pkg.ActivityThirteenHongsMgr.inst.model.getMainData(actId);\n                            let bookConfigs = main.bookConfig;\n                            if (!Array.isArray(bookConfigs)) throw new Error('Chưa đọc được cấu hình sổ tay giao thương');\n                            for (let bookConfig of bookConfigs) {\n                                let bId = bookConfig.id;\n                                if (!Number.isSafeInteger(bId) || bId <= 0) throw new Error('Sổ tay giao thương chưa có mã thực tế');"),
    ],
}

def corrected(worker_id, source):
    for old, new in PATCHES.get(worker_id, []):
        if source.count(old) != 1:
            raise ValueError('Desktop correction no longer matches: ' + worker_id)
        source = source.replace(old, new)
    return source

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
        original = render(node.value)
        source = corrected(definition['id'], original)
        provenance.append({'id': definition['id'], 'action': definition['action'], 'line': node.lineno,
                           'original_js_sha256': hashlib.sha256(original.encode()).hexdigest(),
                           'corrections': len(PATCHES.get(definition['id'], [])), 'js_sha256': hashlib.sha256(source.encode()).hexdigest()})
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
