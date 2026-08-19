import os
import uuid
import hashlib
import tempfile
from typing import List
from sqlalchemy.orm import Session

from app import models, drive_client

CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE_BYTES", 3 * 1024 ** 3))  # default 3GB/chunk
SAFETY_MARGIN = int(os.environ.get("SAFETY_MARGIN_BYTES", 200 * 1024 ** 2))  # leave 200MB headroom per account


def list_accounts_with_free_space(db: Session):
    """Live quota per account. Returns list of dicts, most-free first."""
    out = []
    for acc in db.query(models.Account).all():
        try:
            used, total = drive_client.get_quota(acc)
        except Exception as e:
            out.append({"account": acc, "used": None, "total": None, "free": 0, "error": str(e)})
            continue
        free = max(0, total - used - SAFETY_MARGIN)
        out.append({"account": acc, "used": used, "total": total, "free": free, "error": None})
    out.sort(key=lambda d: d["free"], reverse=True)
    return out


def combined_free_space(db: Session) -> int:
    return sum(d["free"] for d in list_accounts_with_free_space(db) if d["error"] is None)


def _split_sizes(total_size: int, chunk_size: int) -> List[int]:
    sizes = []
    remaining = total_size
    while remaining > 0:
        sizes.append(min(chunk_size, remaining))
        remaining -= sizes[-1]
    return sizes or [0]


def upload_file(db: Session, filename: str, content_type: str, tmp_source_path: str, total_size: int) -> models.FileEntry:
    free_accounts = [d for d in list_accounts_with_free_space(db) if d["error"] is None]
    if not free_accounts:
        raise RuntimeError("No usable Google accounts connected (or all quota checks failed).")

    if sum(d["free"] for d in free_accounts) < total_size:
        raise RuntimeError("Not enough combined free space across connected accounts.")

    file_entry = models.FileEntry(
        filename=filename, size=total_size, content_type=content_type, status="uploading"
    )
    db.add(file_entry)
    db.commit()
    db.refresh(file_entry)

    # simulate free space locally so a single multi-chunk upload distributes evenly
    sim_free = {d["account"].id: d["free"] for d in free_accounts}
    accounts_by_id = {d["account"].id: d["account"] for d in free_accounts}

    sizes = _split_sizes(total_size, CHUNK_SIZE)
    tmp_dir = tempfile.mkdtemp(prefix="mdchunk_")

    try:
        with open(tmp_source_path, "rb") as src:
            for idx, sz in enumerate(sizes):
                # pick account with most simulated free space that can fit this chunk
                candidates = sorted(sim_free.items(), key=lambda kv: kv[1], reverse=True)
                acc_id = None
                for cid, free in candidates:
                    if free >= sz:
                        acc_id = cid
                        break
                if acc_id is None:
                    acc_id = candidates[0][0]  # best effort, let Drive reject if truly full

                account = accounts_by_id[acc_id]

                chunk_path = os.path.join(tmp_dir, f"chunk_{idx}")
                sha256 = hashlib.sha256()
                with open(chunk_path, "wb") as out:
                    remaining = sz
                    while remaining > 0:
                        buf = src.read(min(8 * 1024 * 1024, remaining))
                        if not buf:
                            break
                        out.write(buf)
                        sha256.update(buf)
                        remaining -= len(buf)

                drive_filename = f"{file_entry.id}_{idx:04d}_{uuid.uuid4().hex[:8]}.bin"
                drive_file_id = drive_client.upload_chunk(account, chunk_path, drive_filename)

                chunk_entry = models.ChunkEntry(
                    file_id=file_entry.id,
                    account_id=account.id,
                    drive_file_id=drive_file_id,
                    chunk_index=idx,
                    size=sz,
                    sha256=sha256.hexdigest(),
                )
                db.add(chunk_entry)
                sim_free[acc_id] -= sz
                os.remove(chunk_path)

        file_entry.status = "ready"
        db.commit()
        db.refresh(file_entry)
        return file_entry

    except Exception:
        file_entry.status = "error"
        db.commit()
        raise
    finally:
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass


def download_file_to_path(db: Session, file_entry: models.FileEntry, dest_path: str):
    with open(dest_path, "wb") as out:
        for chunk in file_entry.chunks:  # ordered by chunk_index via relationship
            with tempfile.NamedTemporaryFile(delete=False) as tf:
                tmp_path = tf.name
            try:
                drive_client.download_chunk_to_file(chunk.account, chunk.drive_file_id, tmp_path)
                with open(tmp_path, "rb") as cf:
                    while True:
                        buf = cf.read(8 * 1024 * 1024)
                        if not buf:
                            break
                        out.write(buf)
            finally:
                os.remove(tmp_path)


def delete_file(db: Session, file_entry: models.FileEntry):
    for chunk in list(file_entry.chunks):
        drive_client.delete_chunk(chunk.account, chunk.drive_file_id)
        db.delete(chunk)
    db.delete(file_entry)
    db.commit()
