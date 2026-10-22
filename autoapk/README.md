# AutoTapHoa AutoAPK — development source

User-authorized public source branch: `lamdungcm/autotaphoa-update`, `autoapk-full-20261022`.
Permission to publish source was explicitly confirmed on 2026-10-22. Keep release manifests on the default branch unchanged.

## Current status

The source audit maps **93/93** current desktop `action_*` methods to **96 Android tasks** (including substeps, aliases and composites). No desktop action is unmapped. See `FULL_PORT_COVERAGE.json`. This is source coverage; **successful execution of every feature on a phone has not been established**. The APK is a private local test artifact, not a public release.

191 JavaScript checks and 22 Python packaging checks passed. Tests cover runtime/Stop/account isolation, settings/menu, event state transitions, resource receipts, mazes, team matching and packaging integrity. Several inherited desktop workers still need independent gameplay validation. No claim that unit tests prove game-server compatibility is made.

The preceding eight-task APK is preserved locally. The new test build is `AutoTapHoa_AutoAPK_full_chuc_nang_test.apk`, package `com.longca.taphoa.auto`, using the same local test signing identity and all four supported game ABIs. Build evidence is stored locally and contains exact source hashes. Its release state and phone-test limits are documented in `FULL_PORT_STATUS.md`.

## Structure

- `src/bundle.json`: explicit injection order.
- `src/runtime.js`: serialized native calls, Stop, identity checks, deadlines and per-character settings.
- `src/port_kernel.js`: live protobuf reflection with a verified static fallback; options and task registration.
- `src/native_scope.js`: copied native methods use a per-run transport; original game prototypes are untouched.
- `src/native_features.js`: generated scoped native methods. Regenerate only from the supplied current game source using the recorded SHA.
- `src/desktop_workers.js`: selected current desktop event algorithms with explicit substitutions and provenance.
- `src/ports_*.js`: task workflows and business postconditions.
- `src/menu.js`: floating game menu with a configuration editor and catalog selection.
- `src/ports_farming_rewards.js`: free gifts, task/contribution milestones and war-order rewards around the preserved entrust flow.
- `tools/audit_full_port.py`: fails with `--strict` while any desktop method is missing.
- `build.py`, `apk_tools.py`: repack an explicitly supplied game APK, include selected ABIs, align and sign the test copy.

## Local verification

Use Node with `--test --test-isolation=none` and the `tests/test_*.js` file list. Use Python's unittest discovery for `test_*.py`. Windows subprocesses must be hidden.

Build with `--require-full-coverage` and an explicit current desktop source; the gate audits the exact runtime source directory passed to the builder. The APK build independently checks its manifest, signatures and ZIP layout. Settings for game currency purchases are explicit; no SDK recharge flow is automated.

Known limits: source coverage is not all possible game behavior. Top Era automates desktop Stage 1; optional card-selection packs remain manual. The PigPig workflow requires its real physics view. Runtime-loaded Thirteen package book configuration is required before claiming collection books. Missing or newer protocol/configuration fields stop the task instead of generating a guessed request. Broad inherited workers have a request mutation budget and still require event-specific phone tests.

Build inputs, game accounts, captured network sessions, signing keys, `.local/`, output APKs and working evidence logs are excluded from this public source snapshot. Supply your own authorized game APK/current game JavaScript when reproducing a build. Keep the same local test signing key when installing later test updates over an earlier test copy.

The Android clone package is `com.longca.taphoa.auto`; the original game remains a separate installation. The user chose to test APKs on their own phone. No public APK release or update-manifest change is authorized by the source-publication permission.
