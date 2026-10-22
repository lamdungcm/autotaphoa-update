# Source destination and publication scope

Confirmed 2026-10-22 in this conversation:

1. User requested the full game feature port to Android.
2. User allowed a separate branch.
3. After being told that branches in a public repo remain public, user explicitly answered: “Đồng ý công khai source ở autotaphoa-update”.

Source destination: `lamdungcm/autotaphoa-update`, branch `autoapk-full-20261022`, folder `autoapk/`.

Public snapshots use a file whitelist: build helpers, runtime/task/menu source, generation/audit tools, unit tests and a manifest fixture, coverage report and this public project documentation. No signing keys, credentials, account configuration, raw network traffic, emulator data, APKs or `.local/` files.

`lamdungcm/user-context` remains a context/pointer repository. Update its handoff with the source branch and progress; do not use it as the implementation archive.

Source permission does not authorize publishing an APK release, changing the production updater, merging into the default branch, or claiming untested features work in the real game.
