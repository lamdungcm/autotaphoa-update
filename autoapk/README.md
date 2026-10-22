# AutoTapHoa AutoAPK — development source

User-authorized public source branch: `lamdungcm/autotaphoa-update`, `autoapk-full-20261022`.
Permission to publish source was explicitly confirmed on 2026-10-22. Keep release manifests on the default branch unchanged.

## Current status

Work in progress. This checkpoint is **not a full-function release** and has no new APK attached.
The source coverage audit currently maps 80 of the 93 current desktop `action_*` methods to 84 Android tasks (some tasks are substeps/composites). 13 methods remain unmapped. See `FULL_PORT_COVERAGE.json`; mapping coverage is not proof of live game execution.

133 JavaScript checks passed at this checkpoint. The existing APK packaging suite and real-phone testing must be repeated after all remaining ports are implemented. Most new task families still need their own fixture tests. No claim that all game features have run successfully is made.

The preceding eight-task APK is preserved locally. Do not replace it with an incomplete file named “full”.

## Structure

- `src/bundle.json`: explicit injection order.
- `src/runtime.js`: serialized native calls, Stop, identity checks, deadlines and per-character settings.
- `src/port_kernel.js`: live protobuf reflection with a verified static fallback; options and task registration.
- `src/native_scope.js`: copied native methods use a per-run transport; original game prototypes are untouched.
- `src/native_features.js`: generated scoped native methods. Regenerate only from the supplied current game source using the recorded SHA.
- `src/desktop_workers.js`: selected current desktop event algorithms with explicit substitutions and provenance.
- `src/ports_*.js`: task workflows and business postconditions.
- `src/menu.js`: floating game menu with a configuration editor and catalog selection.
- `tools/audit_full_port.py`: fails with `--strict` while any desktop method is missing.
- `build.py`, `apk_tools.py`: repack an explicitly supplied game APK, include selected ABIs, align and sign the test copy.

## Local verification

Use Node with `--test --test-isolation=none` and the `tests/test_*.js` file list. Use Python's unittest discovery for `test_*.py`. Windows subprocesses must be hidden.

Build inputs, game accounts, captured network sessions, signing keys, `.local/`, output APKs and working evidence logs are excluded from this public source snapshot. Supply your own authorized game APK/current game JavaScript when reproducing a build. Keep the same local test signing key when installing later test updates over an earlier test copy.

The Android clone package is `com.longca.taphoa.auto`; the original game remains a separate installation. The user chose to test APKs on their own phone. No public APK release or update-manifest change is authorized by the source-publication permission.
