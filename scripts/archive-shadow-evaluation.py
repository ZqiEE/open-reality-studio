#!/usr/bin/env python3
"""Package host-independent JS with the checksum-verified Linux Node binary.

No target executable is run. All archive permissions are set explicitly so a
Windows packaging host cannot silently produce a non-executable Linux bundle.
"""
import hashlib
import io
from pathlib import Path
import sys
import tarfile

stage, node_archive, expected_sha, output = sys.argv[1:]
stage = Path(stage)
data = Path(node_archive).read_bytes()
if hashlib.sha256(data).hexdigest() != expected_sha:
    raise SystemExit("node_archive_checksum_mismatch")
node_root = "node-v22.22.0-linux-x64"
with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
    for source, target in [(f"{node_root}/bin/node", stage / "bin/node"),
                           (f"{node_root}/LICENSE", stage / "NODE-LICENSE")]:
        member = archive.getmember(source)
        if not member.isfile():
            raise SystemExit("node_archive_member_not_regular")
        with archive.extractfile(member) as content:
            target.write_bytes(content.read())

with tarfile.open(output, "w:gz", format=tarfile.PAX_FORMAT) as archive:
    for path in [stage, *sorted(stage.rglob("*"))]:
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise SystemExit(f"unexpected_bundle_member:{path}")
        name = Path(stage.name) / path.relative_to(stage)
        member = archive.gettarinfo(str(path), str(name).replace("\\", "/"))
        member.uid = member.gid = 0
        member.uname = member.gname = "root"
        member.mode = 0o755 if path.is_dir() or path.parent == stage / "bin" else 0o644
        if path.is_file():
            with path.open("rb") as content:
                archive.addfile(member, content)
        else:
            archive.addfile(member)
