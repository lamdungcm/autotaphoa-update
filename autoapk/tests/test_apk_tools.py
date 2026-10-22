"""Packaging integrity checks; these do not install or launch any game."""
from __future__ import annotations

import hashlib
import io
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import warnings
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apk_tools import (ApkError, content_digest, create_test_identity,
    axml_chunks, clone_manifest, _element, _strings,
    manifest_info, merge_apks, patch_manifest, read_unique_zip, sign_v2,
    signature_entry, verify_v2, verify_zip_layout, write_aligned_zip)


def compiled_manifest(*, package="test.game", split=None, required=False,
                      extract=False, uses_split=None, metadata=False, clone_components=False):
    # Minimal but structurally valid Android binary XML with UTF8 string pool.
    values = ["manifest", "package", package, "versionCode", "application",
              "isSplitRequired", "extractNativeLibs", "split", "uses-split",
              "name", "meta-data", "com.android.vending.splits.required", "value"]
    if clone_components:
        values += ["label", "Game", ".GameApplication", "activity", ".Entry",
                   "parentActivityName", ".Parent", "provider", "LocalProvider",
                   "authorities", package + ".provider;shared.provider", "permission",
                   package + ".CUSTOM", "uses-permission", "sdk.package.value"]
    for value in (split, uses_split):
        if value is not None and value not in values:
            values.append(value)
    offsets, string_data = [], bytearray()
    for value in values:
        raw = value.encode()
        offsets.append(len(string_data))
        string_data.extend(bytes((len(value), len(raw))) + raw + b"\0")
    string_data.extend(bytes((-len(string_data)) % 4))
    start = 28 + 4 * len(values)
    pool = struct.pack("<HHI5I", 1, 28, start + len(string_data), len(values), 0, 0x100, start, 0)
    pool += struct.pack("<" + "I" * len(values), *offsets) + string_data
    def idx(value):
        return values.index(value)
    def attr(name, value):
        if isinstance(value, bool):
            kind, data, raw = 0x12, 0xffffffff if value else 0, 0xffffffff
        elif isinstance(value, int):
            kind, data, raw = 0x10, value, 0xffffffff
        else:
            kind, data, raw = 3, idx(value), idx(value)
        return struct.pack("<IIIHBBI", 0xffffffff, idx(name), raw, 8, 0, kind, data)
    def begin(name, attributes):
        return struct.pack("<HHIII", 0x102, 16, 36 + 20 * len(attributes), 1, 0xffffffff) + struct.pack("<II6H", 0xffffffff, idx(name), 20, 20, len(attributes), 0, 0, 0) + b"".join(attr(*a) for a in attributes)
    def end(name):
        return struct.pack("<HHIIIII", 0x103, 16, 24, 1, 0xffffffff, 0xffffffff, idx(name))
    manifest_attrs = [("package", package), ("versionCode", 9)]
    if split:
        manifest_attrs.append(("split", split))
    chunks = [pool, begin("manifest", manifest_attrs)]
    if uses_split:
        chunks += [begin("uses-split", [("name", uses_split)]), end("uses-split")]
    if clone_components:
        chunks += [begin("permission", [("name", package + ".CUSTOM")]), end("permission"),
                   begin("uses-permission", [("name", package + ".CUSTOM")]), end("uses-permission")]
    attrs = [("isSplitRequired", required), ("extractNativeLibs", extract)]
    if clone_components:
        attrs += [("name", ".GameApplication"), ("label", "Game")]
    chunks += [begin("application", attrs)]
    if clone_components:
        chunks += [begin("activity", [("name", ".Entry"), ("parentActivityName", ".Parent"), ("label", "Game")]), end("activity"),
                   begin("provider", [("name", "LocalProvider"), ("authorities", package + ".provider;shared.provider"), ("permission", package + ".CUSTOM")]), end("provider"),
                   begin("meta-data", [("name", "sdk.package.value"), ("value", package)]), end("meta-data")]
    if metadata:
        chunks += [begin("meta-data", [("name", "com.android.vending.splits.required"), ("value", True)]), end("meta-data")]
    chunks += [end("application"), end("manifest")]
    body = b"".join(chunks)
    return struct.pack("<HHI", 3, 8, len(body) + 8) + body


def apk(path, entries):
    with zipfile.ZipFile(path, "w") as archive:
        for key, value in entries.items():
            archive.writestr(key, value)


class ManifestTests(unittest.TestCase):
    def test_patch_preserves_identity_and_extracts_config(self):
        blob = compiled_manifest(required=True, extract=False, uses_split="config.arm64_v8a", metadata=True)
        patched, changes = patch_manifest(blob, ["config.arm64_v8a"])
        info = manifest_info(patched)
        self.assertEqual(info["package"], "test.game")
        self.assertEqual(info["version_code"], 9)
        self.assertTrue(info["extract_native_libs"])
        self.assertFalse(info["is_split_required"])
        self.assertEqual(info["uses_splits"], [])
        self.assertEqual(len(changes), 4)

    def test_required_split_cannot_be_forgotten(self):
        with self.assertRaisesRegex(ApkError, "requires splits"):
            patch_manifest(compiled_manifest(required=True))

    def test_dynamic_feature_not_removed_to_fake_installability(self):
        with self.assertRaisesRegex(ApkError, "unavailable/dynamic"):
            patch_manifest(compiled_manifest(uses_split="feature.payments"), ["config.arm64_v8a"])

    def test_split_is_not_base(self):
        with self.assertRaisesRegex(ApkError, "itself a split"):
            patch_manifest(compiled_manifest(split="config.arm64_v8a"))

    def test_corrupt_manifest_size_rejected(self):
        blob = bytearray(compiled_manifest())
        struct.pack_into("<I", blob, 4, len(blob) - 1)
        with self.assertRaises(ApkError):
            manifest_info(blob)


class CloneManifestTests(unittest.TestCase):
    @staticmethod
    def elements(blob):
        result, strings = [], None
        for kind, chunk in axml_chunks(blob):
            if kind == 1:
                strings = _strings(chunk)
            elif kind == 0x102:
                name, attrs = _element(chunk, strings)
                result.append((name, {a["name"]: a["value"] for a in attrs}))
        return result

    def test_separate_package_preserves_version_and_source(self):
        source = compiled_manifest()
        clone, report = clone_manifest(source, "com.longca.taphoa.auto")
        self.assertEqual(manifest_info(clone)["package"], "com.longca.taphoa.auto")
        self.assertEqual(manifest_info(clone)["version_code"], 9)
        self.assertEqual(manifest_info(source)["package"], "test.game")
        self.assertFalse(report["data_shared_with_original"])

    def test_relative_classes_and_provider_permission_collisions(self):
        source = compiled_manifest(clone_components=True)
        label = "Auto Việt 🌾"
        cloned, report = clone_manifest(source, "com.longca.taphoa.auto", label)
        elements = self.elements(cloned)
        app = next(v for k, v in elements if k == "application")
        activity = next(v for k, v in elements if k == "activity")
        provider = next(v for k, v in elements if k == "provider")
        self.assertEqual(app["name"], "test.game.GameApplication")
        self.assertEqual(activity["name"], "test.game.Entry")
        self.assertEqual(activity["parentActivityName"], "test.game.Parent")
        self.assertEqual(provider["name"], "test.game.LocalProvider")
        self.assertEqual(app["label"], label)
        self.assertEqual(activity["label"], label)
        self.assertEqual(set(provider["authorities"].split(";")), set(report["providers"].values()))
        self.assertFalse(set(report["providers"]) & set(report["providers"].values()))
        self.assertEqual(provider["permission"], "com.longca.taphoa.auto.CUSTOM")
        self.assertEqual(next(v["name"] for k, v in elements if k == "uses-permission"), provider["permission"])
        self.assertEqual(next(v["value"] for k, v in elements if k == "meta-data"), "test.game")

    def test_real_utf16_manifest_preserves_android_resource_map_and_classes(self):
        source = (Path(__file__).parent / "fixtures" / "official_manifest.axml").read_bytes()
        cloned, report = clone_manifest(source, "com.longca.taphoa.auto", "Tiệm Tạp Hóa Auto")
        before, after = self.elements(source), self.elements(cloned)
        components = {"application", "activity", "activity-alias", "provider", "service", "receiver"}
        self.assertEqual([(k, v.get("name")) for k, v in before if k in components],
                         [(k, v.get("name")) for k, v in after if k in components])
        self.assertEqual([c for k, c in axml_chunks(source) if k == 0x180],
                         [c for k, c in axml_chunks(cloned) if k == 0x180])
        self.assertEqual(manifest_info(cloned)["version_code"], manifest_info(source)["version_code"])
        self.assertEqual(len(report["providers"]), 7)
        old = [v["authorities"] for k, v in before if k == "provider"]
        new = [v["authorities"] for k, v in after if k == "provider"]
        self.assertFalse(set(old) & set(new))
        pool_before = next(c for k, c in axml_chunks(source) if k == 1)
        pool_after = next(c for k, c in axml_chunks(cloned) if k == 1)
        self.assertEqual(_strings(pool_after)[:len(_strings(pool_before))], _strings(pool_before))

    def test_original_and_invalid_identity_are_rejected(self):
        for target in ("test.game", "onepart", "com.bad-name.app", "com.1bad.app"):
            with self.subTest(target=target), self.assertRaises(ApkError):
                clone_manifest(compiled_manifest(), target)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def test_native_split_merge_has_unique_entries(self):
        base, split = self.root / "base.apk", self.root / "arm64.apk"
        apk(base, {"AndroidManifest.xml": compiled_manifest(required=True), "classes.dex": b"dex", "META-INF/ORIGINAL.RSA": b"old", "META-INF/services/foo": b"needed"})
        apk(split, {"AndroidManifest.xml": compiled_manifest(split="config.arm64_v8a"), "lib/arm64-v8a/libcocos2djs.so": b"native"})
        entries, report = merge_apks(base, [split])
        self.assertEqual(entries["lib/arm64-v8a/libcocos2djs.so"], b"native")
        self.assertNotIn("META-INF/ORIGINAL.RSA", entries)
        self.assertIn("META-INF/services/foo", entries)
        self.assertEqual(len(report["sources"]), 2)

    def test_resource_split_rejected(self):
        base, split = self.root / "base.apk", self.root / "resources.apk"
        apk(base, {"AndroidManifest.xml": compiled_manifest()})
        apk(split, {"AndroidManifest.xml": compiled_manifest(split="config.en"), "resources.arsc": b"resource"})
        with self.assertRaisesRegex(ApkError, "Resource/dynamic"):
            merge_apks(base, [split])

    def test_conflicting_native_duplicate_rejected(self):
        base, split = self.root / "base.apk", self.root / "arm64.apk"
        lib = "lib/arm64-v8a/libcocos2djs.so"
        apk(base, {"AndroidManifest.xml": compiled_manifest(), lib: b"new"})
        apk(split, {"AndroidManifest.xml": compiled_manifest(split="config.arm64_v8a"), lib: b"old"})
        with self.assertRaisesRegex(ApkError, "Conflicting"):
            merge_apks(base, [split])

    def test_duplicate_zip_entry_rejected(self):
        path = self.root / "duplicate.apk"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("AndroidManifest.xml", compiled_manifest())
                archive.writestr("classes.dex", b"old")
                archive.writestr("classes.dex", b"new")
        with self.assertRaisesRegex(ApkError, "Duplicate"):
            read_unique_zip(path)

    def test_alignment_native_and_resources(self):
        path = self.root / "aligned.apk"
        entries = {"AndroidManifest.xml": compiled_manifest(), "resources.arsc": b"x" * 39,
                   "lib/arm64-v8a/libcocos2djs.so": bytes(range(100)),
                   "lib/arm64-v8a/libfrida-gadget.so": b"x" * 200,
                   "lib/arm64-v8a/libautoapk.so": b"print('script')"}
        report = write_aligned_zip(entries, path)
        self.assertEqual(len(report["native_entries"]), 3)
        self.assertTrue(all(item["offset"] % 16384 == 0 for item in report["native_entries"]))
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(set(archive.namelist()), set(entries))

    def test_plain_unaligned_so_fails_verification(self):
        path = self.root / "bad.apk"
        apk(path, {"lib/arm64-v8a/libautoapk.so": b"bad"})
        with self.assertRaisesRegex(ApkError, "not 16 KB aligned"):
            verify_zip_layout(path)

    def test_signature_filter_preserves_non_signature_metadata(self):
        for name in ("META-INF/CERT.RSA", "META-INF/CERT.SF", "META-INF/MANIFEST.MF"):
            self.assertTrue(signature_entry(name))
        for name in ("META-INF/services/auth", "META-INF/notice.txt", "assets/test.rsa"):
            self.assertFalse(signature_entry(name))


class SigningTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.key, self.cert = create_test_identity(self.root / "keys")
        self.unsigned, self.signed = self.root / "unsigned.apk", self.root / "signed.apk"
        # Forces an independent >1MiB section boundary and protects native offsets.
        write_aligned_zip({"AndroidManifest.xml": compiled_manifest(),
                           "lib/arm64-v8a/libcocos2djs.so": bytes(range(256)) * 4500,
                           "assets/marker": b"do not alter"}, self.unsigned)

    def test_sign_round_trip_and_key_reused(self):
        report = sign_v2(self.unsigned, self.signed, self.key, self.cert)
        self.assertTrue(report["scheme_v2_verified"])
        self.assertEqual(report, verify_v2(self.signed))
        self.assertEqual(verify_zip_layout(self.signed)["native_entries"][0]["offset"], 16384)
        old = self.key.read_bytes()
        create_test_identity(self.root / "keys")
        self.assertEqual(old, self.key.read_bytes())

    def test_protected_payload_tamper_detected(self):
        sign_v2(self.unsigned, self.signed, self.key, self.cert)
        blob = bytearray(self.signed.read_bytes())
        blob[16384 + 567] ^= 1
        self.signed.write_bytes(blob)
        with self.assertRaisesRegex(ApkError, "digest mismatch"):
            verify_v2(self.signed)

    def test_eocd_comment_tamper_detected(self):
        sign_v2(self.unsigned, self.signed, self.key, self.cert)
        blob = bytearray(self.signed.read_bytes())
        struct.pack_into("<H", blob, len(blob) - 2, 1)
        blob.extend(b"x")
        self.signed.write_bytes(blob)
        with self.assertRaisesRegex(ApkError, "digest mismatch"):
            verify_v2(self.signed)

    def test_signing_block_length_tamper_detected(self):
        sign_v2(self.unsigned, self.signed, self.key, self.cert)
        blob = bytearray(self.signed.read_bytes())
        magic = blob.index(b"APK Sig Block 42")
        blob[magic - 8] ^= 1
        self.signed.write_bytes(blob)
        with self.assertRaisesRegex(ApkError, "sizes disagree"):
            verify_v2(self.signed)

    def test_digest_restarts_chunks_at_section_boundary(self):
        sections = [b"a" * (1024 * 1024 + 2), b"bc", b"d"]
        pieces = [sections[0][:1024 * 1024], b"aa", b"bc", b"d"]
        expected = hashlib.sha256(b"\x5a" + struct.pack("<I", 4) + b"".join(
            hashlib.sha256(b"\xa5" + struct.pack("<I", len(piece)) + piece).digest() for piece in pieces)).digest()
        self.assertEqual(content_digest(sections), expected)
        self.assertNotEqual(content_digest(sections), content_digest([b"".join(sections)]))

    def test_missing_identity_half_not_silently_rotated(self):
        self.cert.unlink()
        with self.assertRaisesRegex(ApkError, "Incomplete"):
            create_test_identity(self.root / "keys")


if __name__ == "__main__":
    unittest.main()
