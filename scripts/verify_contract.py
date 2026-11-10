#!/usr/bin/env python3
"""Offline review checks for the shared draft OpenAPI document.

Dependency: PyYAML. Does not call production endpoints or require credentials.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import sys
import urllib.request

import yaml

EXPECTED = {
    "/v1/auth/email/send-code": "post",
    "/v1/auth/register": "post",
    "/v1/auth/login": "post",
    "/v1/me/entitlements": "get",
    "/v1/licenses/redeem": "post",
    "/v1/workspaces": "get",
    "/v1/me/storage": "get",
}

class UniqueKeysLoader(yaml.SafeLoader):
    pass

def construct_mapping(loader: yaml.SafeLoader, node: yaml.MappingNode) -> dict:
    result: dict = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        if key in result:
            raise ValueError(f"Duplicate YAML key: {key}")
        result[key] = loader.construct_object(value_node, deep=True)
    return result

UniqueKeysLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_mapping)

def check_spec(raw: bytes) -> None:
    spec = yaml.load(raw, Loader=UniqueKeysLoader)
    assert isinstance(spec, dict), "OpenAPI root must be an object"
    assert str(spec.get("openapi", "")).startswith("3.1."), "Expected OpenAPI 3.1"
    assert spec.get("info", {}).get("version") == "0.1.0-draft", "Review contract version first"
    assert spec.get("x-contract-status") == "DRAFT_NOT_IMPLEMENTED", "Draft status required until integration accepted"
    assert not spec.get("servers"), "Do not publish a real or unverified production URL"
    paths = spec.get("paths")
    assert isinstance(paths, dict), "Missing API paths"
    for path, method in EXPECTED.items():
        assert method in paths.get(path, {}), f"Missing {method.upper()} {path}"
    assert len(paths) == len(EXPECTED), "Unexpected endpoints require COORD-001 review"
    assert "bearerAuth" in spec.get("components", {}).get("securitySchemes", {})

    def walk(obj: object) -> None:
        if isinstance(obj, dict):
            ref = obj.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/"):
                target: object = spec
                for part in ref[2:].split("/"):
                    part = part.replace("~1", "/").replace("~0", "~")
                    assert isinstance(target, dict) and part in target, f"Broken $ref {ref}"
                    target = target[part]
            for val in obj.values():
                walk(val)
        elif isinstance(obj, list):
            for val in obj:
                walk(val)
    walk(spec)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="contracts/openapi.yaml")
    parser.add_argument("--compare-url", default=None, help="Optional canonical public URL for mirror SHA check")
    args = parser.parse_args()
    raw = Path(args.file).read_bytes()
    check_spec(raw)
    digest = hashlib.sha256(raw).hexdigest()
    print(f"OpenAPI draft valid; SHA256={digest}; {len(EXPECTED)} endpoints")
    if args.compare_url:
        with urllib.request.urlopen(args.compare_url, timeout=20) as response:
            upstream = response.read()
        assert raw == upstream, "OpenAPI mirror drift: sync upstream contract before merging"
        print("Mirror matches canonical upstream contract")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, ValueError, yaml.YAMLError, OSError) as exc:
        print(f"Contract check FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
