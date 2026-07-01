"""Loguru-based logging setup."""

from __future__ import annotations

import sys

from loguru import logger

_configured = False


def setup_logging(level: str = "INFO") -> None:
    global _configured
    if _configured:
        return
    logger.remove()
    logger.add(
        sys.stderr,
        level=level,
        format=(
            "<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>"
        ),
        colorize=True,
    )
    _configured = True


__all__ = ["logger", "setup_logging"]
