"""Regenerate the native command shapes from the supplied game, without network.

Inputs are current game JavaScript and the game's own resource APK. Do not run
against a historical backup. The generated file contains schemas, never sessions.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import zipfile


def decode_uuid(value):
    if len(value) != 22:
        return value
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    raw = value[:2] + "".join(f"{(alphabet.index(value[i]) << 6) | alphabet.index(value[i + 1]):03x}" for i in range(2, 22, 2))
    return "-".join((raw[:8], raw[8:12], raw[12:16], raw[16:20], raw[20:]))


def resource_text(value):
    if isinstance(value, str) and value.startswith("12345"):
        return bytes(b ^ 1 for b in value[5:].encode("utf-8")).decode("utf-8")
    if isinstance(value, list):
        for child in value:
            found = resource_text(child)
            if found is not None:
                return found
    return None


def extract(apk, game_source):
    with zipfile.ZipFile(apk) as archive:
        config = json.loads(archive.read("assets/assets/resources/config.json"))
        keys = [key for key, row in config["paths"].items() if row[0] == "protobuf/GameMsg"]
        if len(keys) != 1:
            raise ValueError("Ambiguous game protobuf resource")
        uuid = decode_uuid(config["uuids"][int(keys[0])])
        members = [name for name in archive.namelist() if uuid in name and name.endswith(".json")]
        if len(members) != 1:
            raise ValueError("Ambiguous game protobuf artifact")
        proto = resource_text(json.loads(archive.read(members[0])))
    if not proto:
        raise ValueError("No decoded game schema")
    proto = re.sub(r"/\*.*?\*/|//[^\n]*", "", proto, flags=re.S)
    messages = {}
    for match in re.finditer(r"\bmessage\s+(\w+)\s*\{", proto):
        index, depth = match.end(), 1
        while depth and index < len(proto):
            depth += (proto[index] == "{") - (proto[index] == "}")
            index += 1
        fields = re.findall(r"\b(required|optional|repeated)\s+([\w.]+)\s+(\w+)\s*=\s*(\d+)", proto[match.end():index - 1])
        messages[match.group(1)] = {name: {"rule": rule, "type": typ, "tag": int(tag)} for rule, typ, name, tag in fields}
    source = game_source.read_text(encoding="utf-8-sig")
    commands = {}
    for symbol, req, resp in re.findall(r'this\.addC2Scmd\(t\.(\w+),\s*"(\w+)"(?:,\s*"(\w+)")?', source):
        commands[symbol] = {"request": req, "response": resp, "requestFields": messages.get(req, {}), "responseFields": messages.get(resp, {})}
    return {"protocols": commands}, {"apk_sha256": hashlib.file_digest(apk.open("rb"), "sha256").hexdigest(), "javascript_sha256": hashlib.sha256(game_source.read_bytes()).hexdigest(), "protocol_count": len(commands)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--game-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    data, provenance = extract(args.apk, args.game_source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("/* Generated game protocol shapes. */\n(function(g){g.AutoAPK.gameSchema=" + json.dumps(data, separators=(",", ":")) + ';})(typeof window!=="undefined"?window:globalThis);\n', encoding="utf-8")
    args.output.with_suffix(".provenance.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")
