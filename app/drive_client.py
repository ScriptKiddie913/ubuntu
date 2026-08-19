import os
import io
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

from app.crypto import decrypt

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
TOKEN_URI = "https://oauth2.googleapis.com/token"


def _service_for(account):
    """Build a Drive v3 service for a DB Account row, refreshing the access token."""
    creds = Credentials(
        token=None,
        refresh_token=decrypt(account.enc_refresh_token),
        token_uri=TOKEN_URI,
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/drive.file"],
    )
    creds.refresh(GoogleRequest())
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def get_quota(account):
    """Returns (used_bytes, total_bytes) for the account's whole Drive."""
    svc = _service_for(account)
    about = svc.about().get(fields="storageQuota").execute()
    q = about.get("storageQuota", {})
    used = int(q.get("usage", 0))
    total = int(q.get("limit", 16 * 1024 ** 3))  # some accounts omit limit; assume 15GB-ish
    return used, total


def upload_chunk(account, local_path: str, drive_filename: str) -> str:
    svc = _service_for(account)
    media = MediaFileUpload(local_path, resumable=True, chunksize=8 * 1024 * 1024)
    body = {"name": drive_filename, "parents": [account.folder_id]}
    request = svc.files().create(body=body, media_body=media, fields="id")
    response = None
    while response is None:
        _, response = request.next_chunk()
    return response["id"]


def download_chunk_to_file(account, drive_file_id: str, local_path: str):
    svc = _service_for(account)
    request = svc.files().get_media(fileId=drive_file_id)
    with io.FileIO(local_path, "wb") as fh:
        downloader = MediaIoBaseDownload(fh, request, chunksize=8 * 1024 * 1024)
        done = False
        while not done:
            _, done = downloader.next_chunk()


def delete_chunk(account, drive_file_id: str):
    svc = _service_for(account)
    try:
        svc.files().delete(fileId=drive_file_id).execute()
    except Exception:
        # already gone / permission revoked — don't block a delete request on this
        pass
