import datetime
from sqlalchemy import (
    Column, Integer, String, BigInteger, ForeignKey, DateTime, Text
)
from sqlalchemy.orm import relationship
from app.db import Base


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True)
    label = Column(String, unique=True, nullable=False)   # user-chosen name, e.g. "acc1"
    email = Column(String, nullable=True)
    folder_id = Column(String, nullable=True)              # Drive app-folder id
    enc_refresh_token = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    chunks = relationship("ChunkEntry", back_populates="account", cascade="all,delete")


class FileEntry(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True)
    filename = Column(String, nullable=False)
    size = Column(BigInteger, nullable=False)
    content_type = Column(String, nullable=True)
    status = Column(String, default="ready")  # uploading | ready | error
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    chunks = relationship(
        "ChunkEntry", back_populates="file", cascade="all,delete",
        order_by="ChunkEntry.chunk_index"
    )


class ChunkEntry(Base):
    __tablename__ = "chunks"

    id = Column(Integer, primary_key=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    drive_file_id = Column(String, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    size = Column(BigInteger, nullable=False)
    sha256 = Column(String, nullable=True)

    file = relationship("FileEntry", back_populates="chunks")
    account = relationship("Account", back_populates="chunks")
