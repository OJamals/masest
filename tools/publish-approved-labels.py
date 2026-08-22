#!/usr/bin/env python3
"""Publish owner-approved label artwork as controlled, hash-stable PDFs."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

from pypdf import PdfReader, PdfWriter


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "data" / "approved-label-release.json"
SOURCE_ROOT = Path(
    os.environ.get("MASEST_UPDATE_SOURCE_ROOT", Path.home() / "Desktop" / "masest" / "updates")
).expanduser().resolve()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def controlled_marker(document: dict, control: dict) -> bytes:
    marker = " ".join(
        [
            "% MASEST-CONTROL",
            f"ID={document['document_id']}",
            f"REV={control['revision']}",
            f"EFFECTIVE={control['effective_date']}",
            "STATUS=CURRENT",
            "APPROVAL=CUSTOMER-REVIEW",
            "OWNER=MASEST-CONSULTING-LLC",
        ]
    )
    return f"\n{marker}\n".encode("ascii")


def checked_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if root != path and root not in path.parents:
        raise ValueError(f"path escapes root: {relative}")
    return path


def write_label(document: dict, control: dict) -> dict:
    source = checked_path(SOURCE_ROOT, document["source_path"])
    output = checked_path(ROOT, document["output_path"])
    if not source.is_file() or source.is_symlink():
        raise FileNotFoundError(f"approved label source missing or unsafe: {document['source_path']}")
    if sha256(source) != document["source_sha256"]:
        raise ValueError(f"approved label source changed: {document['source_path']}")
    if not document["output_path"].startswith("docs/labels/"):
        raise ValueError(f"label output outside docs/labels: {document['output_path']}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".pdf", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        source_page = document.get("source_page")
        if source_page is None:
            reader = PdfReader(str(source))
            expected = document.get("expected_page_count")
            if expected is not None and len(reader.pages) != expected:
                raise ValueError(
                    f"{document['source_path']}: expected {expected} pages, found {len(reader.pages)}"
                )
            shutil.copyfile(source, temporary)
        else:
            reader = PdfReader(str(source))
            if not isinstance(source_page, int) or source_page < 1 or source_page > len(reader.pages):
                raise ValueError(f"invalid source page for {document['document_id']}: {source_page}")
            writer = PdfWriter()
            writer.add_page(reader.pages[source_page - 1])
            with temporary.open("wb") as stream:
                writer.write(stream)

        with temporary.open("ab") as stream:
            stream.write(controlled_marker(document, control))
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)

    pages = len(PdfReader(str(output)).pages)
    return {
        "document_id": document["document_id"],
        "path": document["output_path"],
        "sha256": sha256(output),
        "pages": pages,
    }


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    control = manifest["release_control"]
    labels = manifest["labels"]
    if control.get("owner") != "MASEST Consulting LLC":
        raise ValueError("approved label owner mismatch")
    if control.get("approval_status") != "approved_for_public_distribution":
        raise ValueError("label release is not approved")
    if len(labels) != 19:
        raise ValueError(f"expected 19 approved label outputs, found {len(labels)}")

    results = [write_label(document, control) for document in labels]
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"publish-approved-labels: {error}", file=sys.stderr)
        raise
