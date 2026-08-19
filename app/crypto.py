import os
from cryptography.fernet import Fernet

_KEY = os.environ.get("SECRET_KEY", "").strip()
if not _KEY:
    raise RuntimeError(
        "SECRET_KEY env var is not set. Generate one with:\n"
        "  python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
    )

_fernet = Fernet(_KEY.encode())


def encrypt(text: str) -> str:
    return _fernet.encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet.decrypt(token.encode()).decode()
