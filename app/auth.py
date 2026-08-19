import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

from app.db import get_db
from app import models
from app.crypto import encrypt

router = APIRouter()

SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid",
          "https://www.googleapis.com/auth/userinfo.email"]

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("REDIRECT_URI", "http://localhost:8000/oauth/callback")
APP_FOLDER_NAME = "MultiDriveStore"


def _flow(state=None):
    client_config = {
        "web": {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [REDIRECT_URI],
        }
    }
    return Flow.from_client_config(
        client_config, scopes=SCOPES, redirect_uri=REDIRECT_URI, state=state
    )


@router.get("/oauth/start")
def oauth_start(label: str = Query(...)):
    if not CLIENT_ID or not CLIENT_SECRET:
        raise HTTPException(500, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured on server")
    flow = _flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",          # forces refresh_token on every add, even re-adds
        include_granted_scopes="true",
        state=label,
    )
    return RedirectResponse(auth_url)


@router.get("/oauth/callback")
def oauth_callback(code: str, state: str, db: Session = Depends(get_db)):
    label = state
    flow = _flow(state=state)
    flow.fetch_token(code=code)
    creds: Credentials = flow.credentials

    if not creds.refresh_token:
        raise HTTPException(
            400,
            "Google did not return a refresh token. Revoke app access at "
            "https://myaccount.google.com/permissions and try adding this account again."
        )

    drive = build("drive", "v3", credentials=creds)
    profile = build("oauth2", "v2", credentials=creds).userinfo().get().execute()
    email = profile.get("email")

    # find-or-create app folder in this drive
    q = f"name='{APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    existing = drive.files().list(q=q, fields="files(id)").execute().get("files", [])
    if existing:
        folder_id = existing[0]["id"]
    else:
        folder = drive.files().create(
            body={"name": APP_FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"},
            fields="id",
        ).execute()
        folder_id = folder["id"]

    account = db.query(models.Account).filter_by(label=label).first()
    if account is None:
        account = models.Account(label=label)
        db.add(account)

    account.email = email
    account.folder_id = folder_id
    account.enc_refresh_token = encrypt(creds.refresh_token)
    db.commit()

    return RedirectResponse(f"/?added={label}")
