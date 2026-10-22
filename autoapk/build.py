#!/usr/bin/env python3
"""Build a locally signed game APK with an autonomous, embedded AutoAPK menu.

This never installs an APK, replaces a game, signs with a legacy key, publishes
an artifact, or claims that a successful package build proves runtime behavior.
Base and ABI-native splits are supplied explicitly. Resource splits are refused.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import lzma
import os
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request

from apk_tools import (ApkError, clone_manifest, create_test_identity, hidden_run, manifest_info,
                       merge_apks, sha256_file, sign_v2, verify_v2,
                       verify_zip_layout, write_aligned_zip)


ROOT = Path(__file__).resolve().parent
GADGET_VERSION = "16.6.6"  # Java bridge is bundled; bootstrap uses Frida 16 APIs.
ABI_TO_FRIDA = {"arm64-v8a": "arm64", "armeabi-v7a": "arm", "x86": "x86", "x86_64": "x86_64"}
GADGET_LIBRARY = "libfrida-gadget.so"


def find_android_tool(name: str, explicit: str | None = None) -> Path | None:
    if explicit:
        path = Path(explicit).resolve()
        if not path.is_file():
            raise ApkError(f"Android tool not found: {path}")
        return path
    candidate = shutil.which(name)
    if candidate:
        return Path(candidate)
    roots = [os.environ.get("ANDROID_SDK_ROOT"), os.environ.get("ANDROID_HOME"),
             str(Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk")]
    for value in filter(None, roots):
        folder = Path(value) / "build-tools"
        if not folder.is_dir():
            continue
        def version(path):
            return tuple(int(part) if part.isdigit() else 0 for part in path.name.replace("-", ".").split("."))
        for release in sorted(folder.iterdir(), key=version, reverse=True):
            for suffix in (".bat", ".exe", "") if os.name == "nt" else ("",):
                path = release / (name + suffix)
                if path.is_file():
                    return path
    return None


def run_tool(path: Path, arguments: list[str], *, java: str | None = None):
    env = os.environ.copy()
    if java:
        java_path = Path(java).resolve()
        if not java_path.is_file():
            raise ApkError("Explicit Java executable not found")
        env["JAVA_HOME"] = str(java_path.parent.parent)
        env["PATH"] = str(java_path.parent) + os.pathsep + env.get("PATH", "")
    # Android's Windows apksigner is a batch wrapper around its adjacent JAR.
    if path.suffix.lower() == ".bat":
        jar = path.parent / "lib" / "apksigner.jar"
        executable = java or shutil.which("java")
        if not executable:
            home = env.get("JAVA_HOME")
            guessed = Path(home) / "bin" / "java.exe" if home else None
            executable = str(guessed) if guessed and guessed.is_file() else None
        if not jar.is_file() or not executable:
            raise ApkError("apksigner requires its lib/apksigner.jar and a Java runtime (--java)")
        command = [executable, "-jar", str(jar)] + arguments
    else:
        command = [str(path)] + arguments
    result = hidden_run(command, timeout=300, env=env)
    if result.returncode:
        raise ApkError(f"{path.name} failed: {(result.stderr or result.stdout)[-2400:]}")
    return result.stdout.strip()


def ensure_gadget(abi: str, folder: Path, *, download: bool) -> tuple[Path, dict]:
    """Acquire only the pinned upstream Gadget when explicitly requested."""
    if abi not in ABI_TO_FRIDA:
        raise ApkError(f"Unsupported ABI for Gadget: {abi}")
    filename = f"frida-gadget-{GADGET_VERSION}-android-{ABI_TO_FRIDA[abi]}.so"
    path = folder / filename
    supplied = folder / abi / GADGET_LIBRARY
    if not path.is_file() and supplied.is_file():
        path = supplied
    url = f"https://github.com/frida/frida/releases/download/{GADGET_VERSION}/{filename}.xz"
    if not path.is_file():
        if not download:
            raise ApkError(f"Gadget missing for {abi}: {path}. Supply it or use --download-gadget")
        folder.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={"User-Agent": "AutoAPK-local-builder/1"})
        with urllib.request.urlopen(request, timeout=120) as response:
            compressed = response.read(128 * 1024 * 1024 + 1)
        if len(compressed) > 128 * 1024 * 1024:
            raise ApkError("Gadget download exceeds size limit")
        data = lzma.decompress(compressed, memlimit=512 * 1024 * 1024)
        if not data.startswith(b"\x7fELF"):
            raise ApkError("Downloaded Gadget is not ELF")
        temporary = path.with_suffix(".so.download")
        temporary.write_bytes(data)
        temporary.replace(path)
    return path, {"version": GADGET_VERSION, "abi": abi, "path": str(path),
                  "source_url": url, "sha256": sha256_file(path)}


def elf_identity(blob: bytes) -> dict:
    if len(blob) < 20 or blob[:4] != b"\x7fELF" or blob[5] != 1:
        raise ApkError("Expected a little-endian ELF shared library")
    import struct
    machine = struct.unpack_from("<H", blob, 18)[0]
    return {"class": blob[4], "machine": machine}


def validate_elf_abi(blob: bytes, abi: str):
    identity = elf_identity(blob)
    expected = {"arm64-v8a": (2, 183), "armeabi-v7a": (1, 40), "x86": (1, 3), "x86_64": (2, 62)}
    if (identity["class"], identity["machine"]) != expected[abi]:
        raise ApkError(f"ELF architecture does not match {abi}")


def patch_cocos(blob: bytes) -> bytes:
    import lief
    binary = lief.ELF.parse(blob)
    if binary is None:
        raise ApkError("LIEF could not parse libcocos2djs.so")
    if GADGET_LIBRARY not in binary.libraries:
        binary.add_library(GADGET_LIBRARY)
    builder = lief.ELF.Builder(binary)
    builder.build()
    patched = bytes(builder.get_build())
    verify = lief.ELF.parse(patched)
    if verify is None or list(verify.libraries).count(GADGET_LIBRARY) != 1:
        raise ApkError("Patched Cocos has no unique Gadget DT_NEEDED")
    return patched


def make_bootstrap(source: Path) -> tuple[bytes, list[dict]]:
    manifest = source / "bundle.json"
    names = json.loads(manifest.read_text(encoding="utf-8")) if manifest.is_file() else ["runtime.js", "tasks.js", "daily.js", "menu.js"]
    if not isinstance(names, list) or len(names) != len(set(names)) or any(not isinstance(name, str) or Path(name).name != name or not name.endswith('.js') for name in names):
        raise ApkError("Invalid runtime bundle manifest")
    all_paths = [source / "bootstrap.js"] + [source / name for name in names]
    for path in all_paths:
        if not path.is_file():
            raise ApkError(f"Runtime source missing: {path}")
    host = all_paths[0].read_text(encoding="utf-8-sig")
    placeholder = "__GAME_RUNTIME_SOURCE__"
    if host.count(placeholder) != 1:
        raise ApkError("bootstrap.js must contain exactly one __GAME_RUNTIME_SOURCE__ token")
    runtime = "\n;\n".join((source / name).read_text(encoding="utf-8-sig") for name in names)
    result = host.replace(placeholder, json.dumps(runtime, ensure_ascii=True)).encode("utf-8")
    return result, [{"path": str(path.resolve()), "sha256": sha256_file(path)} for path in all_paths + ([manifest] if manifest.is_file() else [])]


def build(args):
    base = Path(args.base).resolve()
    splits = [Path(path).resolve() for path in args.split]
    output = Path(args.output).resolve()
    if not base.is_file() or any(not path.is_file() for path in splits):
        raise ApkError("One or more explicitly supplied APK inputs do not exist")
    if output in {base, *splits}:
        raise ApkError("Output must not overwrite any APK input")
    entries, report = merge_apks(base, splits)
    if args.application_id:
        entries["AndroidManifest.xml"], report["clone"] = clone_manifest(
            entries["AndroidManifest.xml"], args.application_id, args.app_label)
    elif args.app_label:
        raise ApkError("--app-label requires an explicit --application-id")
    print(f"Read {len(entries)} game entries; preparing runtime", flush=True)
    actual = sorted({name.split("/")[1] for name in entries if name.startswith("lib/") and name.endswith("/libcocos2djs.so") and len(name.split("/")) == 3})
    selected = sorted(set(args.abi or actual))
    if not selected or set(selected) - set(actual):
        raise ApkError(f"Selected ABIs need a real libcocos2djs.so. Actual: {actual}")
    if set(actual) - set(selected):
        # APK may not expose a higher-precedence unpatched native ABI.
        entries = {name: data for name, data in entries.items() if not name.startswith("lib/") or name.split("/")[1] in selected}
    unsupported_abis = {name.split("/")[1] for name in entries if name.startswith("lib/") and len(name.split("/")) >= 3} - set(selected)
    if unsupported_abis:
        raise ApkError(f"Native directories without Cocos could bypass instrumentation: {sorted(unsupported_abis)}")
    bootstrap, source_manifest = make_bootstrap(Path(args.source).resolve())
    report.update({"format": 1, "package": manifest_info(entries["AndroidManifest.xml"])["package"],
                   "abis": selected, "runtime_sources": source_manifest,
                   "gadget": [], "cocos": [], "test_only": True,
                   "runtime_tested": False, "installs_performed": False,
                   "limitations": ["Re-signed APK has a different signing identity from the original game; it cannot update that installed game.",
                                   "Installation, login and native menu/task behavior require a separate runtime test.",
                                   "No claim of feature parity with the desktop auto.",
                                   "ZIP 16KB alignment does not establish ELF segment compatibility with every 16KB-page Android device."]})
    if args.application_id:
        report["limitations"].append("Separate application ID has separate data and may require new resource downloads/login; SDK and third-party sign-in compatibility require runtime testing.")
    for abi in selected:
        print(f"Prepare native runtime: {abi}", flush=True)
        path, evidence = ensure_gadget(abi, Path(args.gadget_dir).resolve(), download=args.download_gadget)
        gadget = path.read_bytes()
        validate_elf_abi(gadget, abi)
        cocos_path = f"lib/{abi}/libcocos2djs.so"
        original = entries[cocos_path]
        validate_elf_abi(original, abi)
        patched = patch_cocos(original)
        validate_elf_abi(patched, abi)
        entries[cocos_path] = patched
        entries[f"lib/{abi}/{GADGET_LIBRARY}"] = gadget
        entries[f"lib/{abi}/libfrida-gadget.config.so"] = json.dumps({
            "interaction": {"type": "script", "path": "libautoapk.so", "on_change": "ignore"},
            "runtime": "qjs", "teardown": "full"}, separators=(",", ":")).encode()
        entries[f"lib/{abi}/libautoapk.so"] = bootstrap
        report["gadget"].append(evidence)
        report["cocos"].append({"path": cocos_path, "original_sha256": hashlib.sha256(original).hexdigest(),
                                "patched_sha256": hashlib.sha256(patched).hexdigest(), "needed_added": GADGET_LIBRARY})
    output.parent.mkdir(parents=True, exist_ok=True)
    apksigner = find_android_tool("apksigner", args.apksigner)
    zipalign = find_android_tool("zipalign", args.zipalign)
    key_path, cert_path = create_test_identity(ROOT / ".local" / "keys")
    with tempfile.TemporaryDirectory(prefix="build-", dir=ROOT / ".local") as temporary:
        work = Path(temporary)
        unsigned, aligned, signed = work / "unsigned.apk", work / "aligned.apk", work / "signed.apk"
        write_aligned_zip(entries, unsigned)
        print("Game archive written; align and sign", flush=True)
        if zipalign:
            run_tool(zipalign, ["-P", "16", "-f", "4", str(unsigned), str(aligned)])
            report["zipalign"] = {"tool": str(zipalign), "verification": run_tool(zipalign, ["-c", "-P", "16", "4", str(aligned)])}
        else:
            shutil.copyfile(unsigned, aligned)
            report["zipalign"] = {"tool": "internal ZIP local-header padding", "verification": "16KB native + 4-byte resource offsets checked"}
        report["pre_sign_layout"] = verify_zip_layout(aligned)
        if apksigner:
            sign_help = run_tool(apksigner, ["sign", "--help"], java=args.java)
            alignment_options = ["--alignment-preserved", "true"] if "--alignment-preserved" in sign_help else []
            run_tool(apksigner, ["sign", "--key", str(key_path), "--cert", str(cert_path),
                     "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
                     "--v3-signing-enabled", "false", "--v4-signing-enabled", "false",
                     *alignment_options, "--out", str(signed), str(aligned)], java=args.java)
            verification = run_tool(apksigner, ["verify", "--verbose", "--print-certs", str(signed)], java=args.java)
            report["signature"] = {"tool": str(apksigner), "official_verification": verification,
                                   "internal_verification": verify_v2(signed)}
        else:
            if not args.allow_internal_signer:
                raise ApkError("Official apksigner not found. Supply --apksigner/--java or explicitly allow the Android7+ fallback with --allow-internal-signer")
            report["signature"] = sign_v2(aligned, signed, key_path, cert_path)
            report["signature"]["minimum_android_api_for_signature"] = 24
            report["limitations"].append("Fallback signature is v2-only: Android 7/API24 or newer, regardless of the original manifest minimum.")
        report["zip"] = verify_zip_layout(signed)
        final_info = manifest_info(entries["AndroidManifest.xml"])
        report["final_manifest"] = final_info
        # Include generated META-INF v1 files too: this is the actual signed APK.
        import zipfile
        with zipfile.ZipFile(signed) as archive:
            report["contents"] = [{"name": item.filename, "size": item.file_size,
                "compressed_size": item.compress_size, "sha256": hashlib.sha256(archive.read(item)).hexdigest()}
                for item in sorted(archive.infolist(), key=lambda item: item.filename)]
        report["output"] = {"path": str(output), "bytes": signed.stat().st_size, "sha256": sha256_file(signed)}
        # Do not publish an output before every required verification succeeds.
        staging = output.with_suffix(".apk.building")
        shutil.copyfile(signed, staging)
        staging.replace(output)
    report_path = output.with_suffix(".build.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Built and signature-verified TEST APK: {output}")
    print(f"ABIs: {', '.join(selected)}; package: {report['package']}")
    print(f"SHA256: {report['output']['sha256']}")
    print(f"Build evidence: {report_path}")
    print("No APK installed. Runtime behavior is not established by this build.")
    return output


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--base", required=True, help="Original base or universal game APK")
    cli.add_argument("--split", action="append", default=[], help="ABI-native split APK, repeat as needed; no resource splits")
    cli.add_argument("--abi", action="append", choices=sorted(ABI_TO_FRIDA), help="Limit output to supplied game ABIs")
    cli.add_argument("--source", default=str(ROOT / "src"))
    cli.add_argument("--application-id", help="Explicit separate package for installation beside the original game")
    cli.add_argument("--app-label", help="Label for a separate-package test copy; requires --application-id")
    cli.add_argument("--output", default=str(ROOT / "output" / "AutoTapHoa_AutoAPK_test.apk"))
    cli.add_argument("--gadget-dir", default=str(ROOT / ".local" / "gadget"))
    cli.add_argument("--download-gadget", action="store_true", help="Download pinned Gadget from official GitHub release if absent")
    cli.add_argument("--apksigner", help="Official Android build-tools apksigner")
    cli.add_argument("--zipalign", help="Official Android build-tools zipalign")
    cli.add_argument("--java", help="Java executable for apksigner on Windows")
    cli.add_argument("--allow-internal-signer", action="store_true", help="Explicit fallback v2-only signing, Android7+")
    return cli


if __name__ == "__main__":
    try:
        build(parser().parse_args())
    except Exception as error:
        print(f"BUILD FAILED: {error}", file=sys.stderr)
        raise SystemExit(1)
