"""Small, fail-closed APK packaging helpers for the isolated AutoAPK prototype.

The fallback signer implements the AOSP v2 format (RSA/SHA-256). It does not
claim JAR/v1 support; Android 7 or newer is required when that signer is used.
Official apksigner verification should also be used whenever it is available.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import os
import re
from pathlib import Path, PurePosixPath
import struct
import subprocess
import zipfile


class ApkError(ValueError):
    """An input or output violates an APK build invariant."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hidden_run(argv, *, timeout=120, **kwargs):
    """Run argument vectors without opening a console window on Windows."""
    if os.name == "nt":
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
        kwargs.update(startupinfo=startup, creationflags=subprocess.CREATE_NO_WINDOW)
    return subprocess.run(list(map(str, argv)), timeout=timeout, capture_output=True,
                          text=True, encoding="utf-8", errors="replace", **kwargs)


def signature_entry(name: str) -> bool:
    """Remove prior JAR signatures, preserving unrelated META-INF resources."""
    upper = name.upper()
    if not upper.startswith("META-INF/"):
        return False
    tail = upper[9:]
    return "/" not in tail and (tail == "MANIFEST.MF" or
        tail.endswith((".SF", ".RSA", ".DSA", ".EC")) or tail.startswith("SIG-"))


def read_unique_zip(path: Path) -> dict[str, bytes]:
    """Read APK entries once; do not resolve duplicate names by last-write wins."""
    result = {}
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            name = item.filename
            parts = PurePosixPath(name).parts
            if name.startswith(("/", "\\")) or "\\" in name or ".." in parts:
                raise ApkError(f"Unsafe ZIP path: {name}")
            if name in result:
                raise ApkError(f"Duplicate ZIP entry: {name}")
            result[name] = archive.read(item)
    if "AndroidManifest.xml" not in result:
        raise ApkError("Input APK has no AndroidManifest.xml")
    return result


def _pool_length(blob: bytes, pos: int, utf8: bool):
    if utf8:
        first = blob[pos]
        return (((first & 0x7f) << 8) | blob[pos + 1], pos + 2) if first & 0x80 else (first, pos + 1)
    first = struct.unpack_from("<H", blob, pos)[0]
    return (((first & 0x7fff) << 16) | struct.unpack_from("<H", blob, pos + 2)[0], pos + 4) if first & 0x8000 else (first, pos + 2)


def _strings(chunk: bytes):
    _, header_size, _ = struct.unpack_from("<HHI", chunk)
    count, _, flags, start, _ = struct.unpack_from("<5I", chunk, 8)
    utf8 = bool(flags & 0x100)
    values = []
    for index in range(count):
        offset = struct.unpack_from("<I", chunk, header_size + index * 4)[0]
        pos = start + offset
        size, pos = _pool_length(chunk, pos, utf8)
        if utf8:
            size, pos = _pool_length(chunk, pos, True)
            values.append(chunk[pos:pos + size].decode("utf-8"))
        else:
            values.append(chunk[pos:pos + 2 * size].decode("utf-16-le"))
    return values


def axml_chunks(blob: bytes):
    if len(blob) < 8 or struct.unpack_from("<H", blob)[0] != 3:
        raise ApkError("AndroidManifest.xml must be compiled Android binary XML")
    _, header_size, size = struct.unpack_from("<HHI", blob)
    if size != len(blob) or header_size != 8:
        raise ApkError("Malformed binary XML container")
    pos, chunks = header_size, []
    while pos < size:
        if pos + 8 > size:
            raise ApkError("Truncated binary XML chunk")
        kind, header, length = struct.unpack_from("<HHI", blob, pos)
        if length < header or header < 8 or pos + length > size:
            raise ApkError("Invalid binary XML chunk length")
        chunks.append((kind, blob[pos:pos + length]))
        pos += length
    return chunks


def _element(chunk: bytes, strings):
    if len(chunk) < 36:
        raise ApkError("Truncated XML start element")
    name_idx = struct.unpack_from("<I", chunk, 20)[0]
    attr_start, attr_size, count = struct.unpack_from("<HHH", chunk, 24)
    if attr_size < 20 or 16 + attr_start + attr_size * count > len(chunk):
        raise ApkError("Invalid XML attribute layout")
    attrs = []
    for index in range(count):
        offset = 16 + attr_start + index * attr_size
        ns, name, raw, value_size, zero, kind, value = struct.unpack_from("<IIIHBBI", chunk, offset)
        if value_size != 8 or zero:
            raise ApkError("Unsupported Android XML typed value")
        decoded = strings[raw] if raw != 0xffffffff else strings[value] if kind == 3 else bool(value) if kind == 0x12 else value
        attrs.append({"name": strings[name], "value": decoded, "type": kind,
                      "data": value, "offset": offset, "index": index})
    return strings[name_idx], attrs


def manifest_info(blob: bytes) -> dict:
    """Inspect identity and split restrictions without recompiling resources."""
    strings, info = None, {"uses_splits": [], "extract_native_libs": True,
                           "is_split_required": False, "min_sdk": 1}
    for kind, chunk in axml_chunks(blob):
        if kind == 1:
            strings = _strings(chunk)
        elif kind == 0x102:
            if strings is None:
                raise ApkError("Manifest has no string pool before its elements")
            name, attrs = _element(chunk, strings)
            values = {attr["name"]: attr["value"] for attr in attrs}
            if name == "manifest":
                info.update(package=values.get("package"), split=values.get("split"),
                            version_code=values.get("versionCode"), version_name=values.get("versionName"))
            elif name == "application":
                info["extract_native_libs"] = values.get("extractNativeLibs", True)
                info["is_split_required"] = values.get("isSplitRequired", False)
            elif name == "uses-split":
                info["uses_splits"].append(values.get("name"))
            elif name == "uses-sdk":
                info["min_sdk"] = values.get("minSdkVersion", 1)
    if not info.get("package"):
        raise ApkError("Manifest package identity is missing")
    return info


def patch_manifest(blob: bytes, merged_split_names=()) -> tuple[bytes, list[str]]:
    """Make an explicitly merged native-only split standalone; extract Gadget files.

    Android resource IDs, string pool indices, unknown elements and namespaces
    remain byte-for-byte intact. Dynamic-feature/resource split dependencies are
    rejected before this function is called and unmatched uses-split is fatal.
    """
    info = manifest_info(blob)
    if info.get("split"):
        raise ApkError("The supplied base APK is itself a split")
    available = set(merged_split_names)
    if set(info["uses_splits"]) - available:
        raise ApkError("Base requires unavailable/dynamic feature splits")
    if info["is_split_required"] and not available:
        raise ApkError("Base requires splits; supply its native ABI split")
    strings, output, depth, skip_at, changes = None, [], 0, None, []
    for kind, original in axml_chunks(blob):
        chunk = original
        if kind == 1:
            strings = _strings(chunk)
        if kind == 0x102:
            name, attrs = _element(chunk, strings)
            values = {attr["name"]: attr["value"] for attr in attrs}
            depth += 1
            drop = name == "uses-split" or (name == "meta-data" and values.get("name") in
                   {"com.android.vending.splits.required", "com.android.vending.splits"})
            if skip_at is None and drop:
                skip_at = depth
                changes.append("removed merged split metadata" if name == "meta-data" else "removed merged uses-split")
            if skip_at is None and name == "application":
                edited = bytearray(chunk)
                if values.get("extractNativeLibs") is False:
                    attr = next(a for a in attrs if a["name"] == "extractNativeLibs")
                    edited[attr["offset"] + 12:attr["offset"] + 20] = struct.pack("<HBBI", 8, 0, 0x12, 0xffffffff)
                    struct.pack_into("<I", edited, attr["offset"] + 8, 0xffffffff)
                    changes.append("extractNativeLibs=true for autonomous script/config extraction")
                removed = [a for a in attrs if a["name"] == "isSplitRequired"]
                if removed:
                    attr = removed[0]
                    attr_size = struct.unpack_from("<H", edited, 26)[0]
                    del edited[attr["offset"]:attr["offset"] + attr_size]
                    struct.pack_into("<H", edited, 28, len(attrs) - 1)
                    for offset in (30, 32, 34):
                        index = struct.unpack_from("<H", edited, offset)[0]
                        if index:
                            struct.pack_into("<H", edited, offset, 0 if index == attr["index"] + 1 else index - (index > attr["index"] + 1))
                    struct.pack_into("<I", edited, 4, len(edited))
                    changes.append("removed isSplitRequired after explicit native split merge")
                chunk = bytes(edited)
        if skip_at is None:
            output.append(chunk)
        if kind == 0x103:
            if skip_at == depth:
                skip_at = None
            depth -= 1
    if depth or skip_at is not None:
        raise ApkError("Unbalanced manifest elements")
    body = b"".join(output)
    result = struct.pack("<HHI", 3, 8, len(body) + 8) + body
    final = manifest_info(result)
    if final["is_split_required"] or final["uses_splits"] or not final["extract_native_libs"]:
        raise ApkError("Manifest patch did not satisfy standalone/Gadget requirements")
    return result, changes


def merge_apks(base: Path, splits: list[Path]) -> tuple[dict[str, bytes], dict]:
    """Merge only base + ABI-native splits; refuse resources/assets/classes splits."""
    entries = read_unique_zip(base)
    info = manifest_info(entries["AndroidManifest.xml"])
    split_names = []
    sources = [{"path": str(base.resolve()), "sha256": sha256_file(base), "kind": "base"}]
    for path in splits:
        extra = read_unique_zip(path)
        split_info = manifest_info(extra["AndroidManifest.xml"])
        if split_info["package"] != info["package"] or split_info["version_code"] != info["version_code"]:
            raise ApkError(f"Split package/version does not match base: {path.name}")
        if not split_info.get("split") or split_info["uses_splits"]:
            raise ApkError(f"Not a standalone ABI configuration split: {path.name}")
        native = [name for name in extra if name.startswith("lib/") and name.endswith(".so")]
        unsupported = [name for name in extra if name != "AndroidManifest.xml" and
                       not signature_entry(name) and not name.endswith("/") and name not in native]
        if unsupported or not native:
            raise ApkError(f"Resource/dynamic splits require a real resource merge and are unsupported: {path.name} ({unsupported[:3]})")
        if split_info["split"] in split_names:
            raise ApkError("Duplicate split identity")
        split_names.append(split_info["split"])
        for name in native:
            if name in entries and entries[name] != extra[name]:
                raise ApkError(f"Conflicting library in base and split: {name}")
            entries[name] = extra[name]
        sources.append({"path": str(path.resolve()), "sha256": sha256_file(path),
                        "kind": "native_split", "split": split_info["split"]})
    entries = {name: data for name, data in entries.items() if not signature_entry(name)}
    entries["AndroidManifest.xml"], changes = patch_manifest(entries["AndroidManifest.xml"], split_names)
    return entries, {"identity": info, "sources": sources, "manifest_changes": changes}


def clone_manifest(blob: bytes, application_id: str, label: str | None = None):
    """Give a test copy its own install identity without renaming DEX/JNI classes.

    Only selected attribute VALUES change. Existing string indices/resource IDs
    stay stable; package-dependent providers and declared permissions get unique
    identities so installing beside the original cannot take over its providers.
    """
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", application_id):
        raise ApkError("Invalid clone application ID")
    original = manifest_info(blob)["package"]
    if application_id == original:
        raise ApkError("Clone must use a different application ID")
    chunks = axml_chunks(blob)
    pool_index = next(i for i, (kind, _) in enumerate(chunks) if kind == 1)
    pool = chunks[pool_index][1]
    _, header_size, _ = struct.unpack_from("<HHI", pool)
    count, styles, flags, _, _ = struct.unpack_from("<5I", pool, 8)
    if styles:
        raise ApkError("Cloning styled manifest string pools is unsupported")
    strings = _strings(pool)
    indices = {value: i for i, value in enumerate(strings)}

    def index(value):
        if value not in indices:
            indices[value] = len(strings)
            strings.append(value)
        return indices[value]

    def owned(value):
        return application_id + value[len(original):] if value == original or value.startswith(original + ".") else value

    def class_name(value):
        return original + value if value.startswith(".") else original + "." + value if "." not in value else value

    permissions, authorities, app_label = {}, {}, None
    for kind, chunk in chunks:
        if kind != 0x102:
            continue
        name, attrs = _element(chunk, strings)
        values = {a["name"]: a["value"] for a in attrs}
        if name == "manifest" and values.get("sharedUserId"):
            raise ApkError("Clone refuses a sharedUserId manifest")
        if name in {"permission", "permission-tree", "permission-group"}:
            value = values.get("name")
            if isinstance(value, str):
                permissions[value] = owned(value) if owned(value) != value else application_id + ".permission." + value
        if name == "provider":
            for value in str(values.get("authorities") or "").split(";"):
                if value:
                    authorities[value] = owned(value) if owned(value) != value else value + "." + application_id
        if name == "application":
            attr = next((a for a in attrs if a["name"] == "label"), None)
            if attr:
                app_label = (attr["type"], attr["data"])
    if label is not None and app_label is None:
        raise ApkError("Clone app label requires an existing application label attribute")

    component_tags = {"application", "activity", "activity-alias", "service", "receiver", "provider", "instrumentation"}
    class_attrs = {"name", "targetActivity", "parentActivityName", "backupAgent", "manageSpaceActivity", "appComponentFactory", "zygotePreloadName"}
    output, edits = [], []
    for kind, chunk in chunks:
        if kind != 0x102:
            output.append((kind, chunk))
            continue
        name, attrs = _element(chunk, strings)
        edited = bytearray(chunk)
        for attr in attrs:
            key, value = attr["name"], attr["value"]
            replacement = None
            if name == "manifest" and key == "package":
                replacement = application_id
            elif label is not None and name in {"application", "activity", "activity-alias"} and key == "label" and (attr["type"], attr["data"]) == app_label:
                replacement = label
            elif isinstance(value, str):
                if name in component_tags and key in class_attrs:
                    replacement = class_name(value)
                elif name == "provider" and key == "authorities":
                    replacement = ";".join(authorities[v] for v in value.split(";") if v)
                elif key in {"name", "permission", "readPermission", "writePermission", "permissionGroup"} and value in permissions:
                    replacement = permissions[value]
                elif key in {"taskAffinity", "process", "targetPackage"}:
                    replacement = owned(value)
            if replacement is None or replacement == value:
                continue
            value_index = index(replacement)
            struct.pack_into("<I", edited, attr["offset"] + 8, value_index)
            struct.pack_into("<HBBI", edited, attr["offset"] + 12, 8, 0, 3, value_index)
            edits.append({"element": name, "attribute": key, "from": value, "to": replacement})
        output.append((kind, bytes(edited)))

    def length(value, utf8):
        if utf8:
            if value > 0x7fff:
                raise ApkError("Clone manifest string is too long")
            return bytes(((value >> 8) | 0x80, value & 255)) if value > 127 else bytes((value,))
        return struct.pack("<HH", (value >> 16) | 0x8000, value & 0xffff) if value > 0x7fff else struct.pack("<H", value)

    utf8, offsets, data = bool(flags & 0x100), [], bytearray()
    for value in strings:
        offsets.append(len(data))
        units = len(value.encode("utf-16-le")) // 2
        encoded = value.encode("utf-8" if utf8 else "utf-16-le")
        data.extend(length(units, utf8))
        if utf8:
            data.extend(length(len(encoded), True))
        data.extend(encoded + (b"\0" if utf8 else b"\0\0"))
    data.extend(bytes((-len(data)) % 4))
    start = header_size + 4 * len(strings)
    new_pool = bytearray(pool[:header_size])
    struct.pack_into("<I", new_pool, 4, start + len(data))
    struct.pack_into("<5I", new_pool, 8, len(strings), 0, flags & ~1, start, 0)
    new_pool.extend(struct.pack("<" + "I" * len(offsets), *offsets) + data)
    output[pool_index] = (1, bytes(new_pool))
    body = b"".join(chunk for _, chunk in output)
    result = struct.pack("<HHI", 3, 8, len(body) + 8) + body
    if manifest_info(result)["package"] != application_id:
        raise ApkError("Clone manifest identity verification failed")
    return result, {"original_package": original, "application_id": application_id,
                    "label": label, "providers": authorities, "permissions": permissions,
                    "changes": edits, "data_shared_with_original": False}


def write_aligned_zip(entries: dict[str, bytes], output: Path):
    """Store .so entries on 16 KB boundaries and resources.arsc on 4 bytes."""
    with zipfile.ZipFile(output, "w", allowZip64=False) as archive:
        for name, data in entries.items():
            item = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_STORED if name.endswith(".so") or name == "resources.arsc" else zipfile.ZIP_DEFLATED
            item.external_attr = (0o755 if name.endswith(".so") else 0o644) << 16
            alignment = 16384 if name.startswith("lib/") and name.endswith(".so") else 4 if item.compress_type == zipfile.ZIP_STORED else 1
            if alignment > 1:
                start = archive.fp.tell() + 30 + len(name.encode("utf-8"))
                padding = (-start) % alignment
                if padding:
                    if padding < 4:
                        padding += alignment
                    item.extra = struct.pack("<HH", 0xd935, padding - 4) + bytes(padding - 4)
            archive.writestr(item, data)
    return verify_zip_layout(output)


def verify_zip_layout(path: Path) -> dict:
    native = []
    with zipfile.ZipFile(path) as archive, Path(path).open("rb") as stream:
        names = [item.filename for item in archive.infolist()]
        if len(names) != len(set(names)):
            raise ApkError("Output contains duplicate ZIP entries")
        if archive.testzip() is not None:
            raise ApkError("Output ZIP CRC verification failed")
        for item in archive.infolist():
            stream.seek(item.header_offset)
            header = stream.read(30)
            if header[:4] != b"PK\x03\x04":
                raise ApkError("Invalid ZIP local header")
            name_size, extra_size = struct.unpack_from("<HH", header, 26)
            offset = item.header_offset + 30 + name_size + extra_size
            if item.filename.startswith("lib/") and item.filename.endswith(".so"):
                if item.compress_type != zipfile.ZIP_STORED or offset % 16384:
                    raise ApkError(f"Native file is compressed or not 16 KB aligned: {item.filename}")
                native.append({"name": item.filename, "offset": offset, "size": item.file_size})
            elif item.filename == "resources.arsc" and (item.compress_type != zipfile.ZIP_STORED or offset % 4):
                raise ApkError("resources.arsc must be stored and aligned")
    return {"entries": len(names), "native_entries": native, "zip_crc_verified": True}


def _eocd(blob: bytes):
    pos = len(blob)
    while True:
        pos = blob.rfind(b"PK\x05\x06", max(0, len(blob) - 65557), pos)
        if pos < 0:
            raise ApkError("ZIP EOCD not found")
        if pos + 22 <= len(blob) and pos + 22 + struct.unpack_from("<H", blob, pos + 20)[0] == len(blob):
            break
    disk, cd_disk, count_disk, count, cd_size, cd_offset = struct.unpack_from("<4H2I", blob, pos + 4)
    if disk or cd_disk or count_disk != count or count == 0xffff or cd_offset + cd_size != pos:
        raise ApkError("Multi-disk, ZIP64 or malformed central directory is unsupported")
    return pos, cd_offset, cd_size


def content_digest(sections) -> bytes:
    """AOSP v2 SHA-256: independently chunk EACH section into <=1 MiB pieces."""
    chunks = []
    for section in sections:
        for offset in range(0, len(section), 1024 * 1024):
            piece = section[offset:offset + 1024 * 1024]
            chunks.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(piece)) + piece).digest())
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(chunks)) + b"".join(chunks)).digest()


def _lp(blob):
    return struct.pack("<I", len(blob)) + blob


def _take_lp(blob, pos=0):
    if pos + 4 > len(blob):
        raise ApkError("Truncated v2 length prefix")
    size = struct.unpack_from("<I", blob, pos)[0]
    end = pos + 4 + size
    if end > len(blob):
        raise ApkError("V2 length exceeds containing field")
    return blob[pos + 4:end], end


def _sequence(blob):
    pos = 0
    while pos < len(blob):
        value, pos = _take_lp(blob, pos)
        yield value


def create_test_identity(key_dir: Path) -> tuple[Path, Path]:
    """Create/reuse ONLY this prototype's new key; never inspect legacy keys."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key_dir.mkdir(parents=True, exist_ok=True)
    key_path, cert_path = key_dir / "autoapk-test.pk8", key_dir / "autoapk-test.x509.der"
    if key_path.exists() != cert_path.exists():
        raise ApkError("Incomplete AutoAPK test identity; refusing silent key rotation")
    if not key_path.exists():
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "AutoTapHoa isolated AutoAPK test")])
        now = dt.datetime.now(dt.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=3650))
                .sign(key, hashes.SHA256()))
        key_path.write_bytes(key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        os.chmod(key_path, 0o600)
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.DER))
    return key_path, cert_path


def sign_v2(unsigned: Path, output: Path, key_path: Path, cert_path: Path) -> dict:
    """Sign APK using one RSA/PKCS1-SHA256 signer; Android >=24 fallback."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography import x509
    data = unsigned.read_bytes()
    eocd, cd, _ = _eocd(data)
    if data[max(0, cd - 16):cd] == b"APK Sig Block 42":
        raise ApkError("Unsigned input still contains an APK signing block")
    key = serialization.load_der_private_key(key_path.read_bytes(), password=None)
    cert_der = cert_path.read_bytes()
    cert = x509.load_der_x509_certificate(cert_der)
    public_key = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    if public_key != cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo):
        raise ApkError("Signing certificate does not match private key")
    algorithm = struct.pack("<I", 0x103)
    digest = content_digest((data[:cd], data[cd:eocd], data[eocd:]))
    # Current official apksig adds a fourth empty length-prefixed field. It is
    # signed too; older Android verifiers ignore that authenticated extension.
    signed_data = _lp(_lp(algorithm + _lp(digest))) + _lp(_lp(cert_der)) + _lp(b"") + _lp(b"")
    signature = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    signer = _lp(signed_data) + _lp(_lp(algorithm + _lp(signature))) + _lp(public_key)
    v2 = _lp(_lp(signer))
    pair = struct.pack("<Q", len(v2) + 4) + struct.pack("<I", 0x7109871a) + v2
    size = len(pair) + 24
    block = struct.pack("<Q", size) + pair + struct.pack("<Q", size) + b"APK Sig Block 42"
    end = bytearray(data[eocd:])
    struct.pack_into("<I", end, 16, cd + len(block))
    output.write_bytes(data[:cd] + block + data[cd:eocd] + end)
    return verify_v2(output)


def verify_v2(path: Path) -> dict:
    """Verify framing, signed data, certificate key and all protected APK bytes.

    This deliberately supports only the RSA/SHA256 algorithm emitted here and
    by this project's official apksigner options, rejecting unrecognized sets.
    """
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    blob = path.read_bytes()
    eocd, cd, _ = _eocd(blob)
    if cd < 32 or blob[cd - 16:cd] != b"APK Sig Block 42":
        raise ApkError("No APK signing block")
    size = struct.unpack_from("<Q", blob, cd - 24)[0]
    start = cd - size - 8
    if size < 24 or start < 0 or struct.unpack_from("<Q", blob, start)[0] != size:
        raise ApkError("APK signing-block sizes disagree")
    pos, end, v2 = start + 8, cd - 24, None
    while pos < end:
        if pos + 8 > end:
            raise ApkError("Truncated APK signing pair")
        length = struct.unpack_from("<Q", blob, pos)[0]
        if length < 4 or pos + 8 + length > end:
            raise ApkError("Invalid APK signing pair")
        kind = struct.unpack_from("<I", blob, pos + 8)[0]
        if kind == 0x7109871a:
            if v2 is not None:
                raise ApkError("Duplicate v2 signing block")
            v2 = blob[pos + 12:pos + 8 + length]
        pos += 8 + length
    if pos != end or v2 is None:
        raise ApkError("Missing or malformed v2 signing block")
    signers, consumed = _take_lp(v2)
    if consumed != len(v2):
        raise ApkError("Trailing v2 bytes")
    end_record = bytearray(blob[eocd:])
    struct.pack_into("<I", end_record, 16, start)
    actual_digest = content_digest((blob[:start], blob[cd:eocd], end_record))
    fingerprints = []
    for signer in _sequence(signers):
        signed, pos = _take_lp(signer)
        signatures, pos = _take_lp(signer, pos)
        public, pos = _take_lp(signer, pos)
        if pos != len(signer):
            raise ApkError("Trailing signer bytes")
        signature_records = list(_sequence(signatures))
        if len(signature_records) != 1 or struct.unpack_from("<I", signature_records[0])[0] != 0x103:
            raise ApkError("Unsupported v2 signature algorithm set")
        signature, consumed = _take_lp(signature_records[0], 4)
        if consumed != len(signature_records[0]):
            raise ApkError("Trailing signature bytes")
        key = serialization.load_der_public_key(public)
        key.verify(signature, signed, padding.PKCS1v15(), hashes.SHA256())
        digests, pos = _take_lp(signed)
        certificates, pos = _take_lp(signed, pos)
        attributes, pos = _take_lp(signed, pos)
        if pos != len(signed):
            # SDK 36's official V2SchemeSigner emits this empty extension.
            # Refuse arbitrary trailing payload rather than hiding a parse bug.
            extension, pos = _take_lp(signed, pos)
            if extension or pos != len(signed):
                raise ApkError("Unexpected trailing signed data")
        for _ in _sequence(attributes):
            pass
        records = list(_sequence(digests))
        if len(records) != 1 or struct.unpack_from("<I", records[0])[0] != 0x103:
            raise ApkError("Digest/signature algorithm mismatch")
        expected, consumed = _take_lp(records[0], 4)
        if consumed != len(records[0]) or expected != actual_digest:
            raise ApkError("APK content digest mismatch")
        chain = list(_sequence(certificates))
        if not chain:
            raise ApkError("Missing signer certificate")
        cert = x509.load_der_x509_certificate(chain[0])
        if cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo) != public:
            raise ApkError("Signer certificate/public key mismatch")
        fingerprints.append(hashlib.sha256(chain[0]).hexdigest())
    if not fingerprints:
        raise ApkError("No v2 signer")
    return {"scheme_v2_verified": True, "certificate_sha256": fingerprints,
            "verifier": "internal_aosp_v2_rsa_sha256"}
