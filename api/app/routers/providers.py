"""Providers + Settings router.

Endpoints to implement (see docs/API-CONTRACT.md):
  GET    /providers                       -> list[ProviderOut]
  GET    /providers/{kind}                -> ProviderOut
  PUT    /providers/{kind}                -> ProviderOut          (save config + secrets, encrypted)
  POST   /providers/{kind}/test           -> TestConnectionResult (live adapter check)
  GET    /settings                        -> SettingsOut
  PUT    /settings                        -> SettingsOut
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/providers", tags=["providers"])
