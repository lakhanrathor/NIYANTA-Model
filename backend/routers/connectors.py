from __future__ import annotations

from fastapi import APIRouter, HTTPException

from modules import connector

router = APIRouter(prefix="/connectors", tags=["connectors"])


@router.get("")
def list_connectors() -> list[dict]:
    return connector.list()


@router.post("/{name}/sync")
def sync_connector(name: str) -> dict:
    try:
        return connector.sync(name)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
