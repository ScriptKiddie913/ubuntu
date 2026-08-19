import os
import shutil
import tempfile

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.db import get_db, init_db
from app import models, storage_manager
from app.auth import router as auth_router

app = FastAPI(title="MultiDrive Pool")
app.include_router(auth_router)


@app.on_event("startup")
def _startup():
    init_db()


STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/accounts")
def api_accounts(db: Session = Depends(get_db)):
    info = storage_manager.list_accounts_with_free_space(db)
    return [
        {
            "id": d["account"].id,
            "label": d["account"].label,
            "email": d["account"].email,
            "used": d["used"],
            "total": d["total"],
            "free": d["free"],
            "error": d["error"],
        }
        for d in info
    ]


@app.get("/api/summary")
def api_summary(db: Session = Depends(get_db)):
    info = storage_manager.list_accounts_with_free_space(db)
    used = sum(d["used"] or 0 for d in info)
    total = sum(d["total"] or 0 for d in info)
    free = sum(d["free"] for d in info)
    return {"used": used, "total": total, "free": free, "accounts": len(info)}


@app.get("/api/files")
def api_files(db: Session = Depends(get_db)):
    files = db.query(models.FileEntry).order_by(models.FileEntry.created_at.desc()).all()
    return [
        {
            "id": f.id,
            "filename": f.filename,
            "size": f.size,
            "content_type": f.content_type,
            "status": f.status,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "chunk_count": len(f.chunks),
        }
        for f in files
    ]


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...), db: Session = Depends(get_db)):
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="mdupload_")
    total_size = 0
    try:
        with os.fdopen(tmp_fd, "wb") as out:
            while True:
                buf = await file.read(8 * 1024 * 1024)
                if not buf:
                    break
                out.write(buf)
                total_size += len(buf)

        entry = storage_manager.upload_file(
            db, file.filename, file.content_type, tmp_path, total_size
        )
        return {"id": entry.id, "filename": entry.filename, "size": entry.size, "status": entry.status}
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.get("/api/download/{file_id}")
def api_download(file_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.FileEntry).get(file_id)
    if not entry:
        raise HTTPException(404, "File not found")

    tmp_fd, tmp_path = tempfile.mkstemp(prefix="mddownload_")
    os.close(tmp_fd)
    storage_manager.download_file_to_path(db, entry, tmp_path)

    def iterfile():
        try:
            with open(tmp_path, "rb") as f:
                while True:
                    buf = f.read(8 * 1024 * 1024)
                    if not buf:
                        break
                    yield buf
        finally:
            os.remove(tmp_path)

    headers = {"Content-Disposition": f'attachment; filename="{entry.filename}"'}
    return StreamingResponse(
        iterfile(),
        media_type=entry.content_type or "application/octet-stream",
        headers=headers,
    )


@app.delete("/api/files/{file_id}")
def api_delete(file_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.FileEntry).get(file_id)
    if not entry:
        raise HTTPException(404, "File not found")
    storage_manager.delete_file(db, entry)
    return JSONResponse({"deleted": file_id})
