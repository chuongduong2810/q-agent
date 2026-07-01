"""Application configuration, loaded from environment / `.env`."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo/base directories. The backend keeps all local state under `workspace/`.
API_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = API_DIR.parent


class Settings(BaseSettings):
    """Runtime settings for the Q-Agent backend.

    Everything is local-first: the database, the encryption key, generated
    Playwright specs, and captured evidence all live under ``workspace_dir``.
    """

    model_config = SettingsConfigDict(
        env_file=str(API_DIR / ".env"),
        env_prefix="QAGENT_",
        extra="ignore",
    )

    # Server
    host: str = "127.0.0.1"
    port: int = 8787
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Storage
    workspace_dir: Path = API_DIR / "workspace"
    database_url: str = ""  # derived from workspace_dir if empty

    # Secret used to derive the Fernet key that encrypts provider credentials.
    # Override in production via QAGENT_SECRET_KEY.
    secret_key: str = "dev-only-insecure-change-me"

    # Claude CLI
    claude_bin: str = "claude"
    claude_model: str = "claude-sonnet-5"
    claude_timeout_s: int = 300

    # Dedicated Q-Agent skills (SKILL.md methodology injected per Claude action).
    skills_dir: Path = REPO_ROOT / "skills"

    # Playwright
    playwright_bin: str = "npx"  # invoked as: npx playwright test ...
    exec_timeout_s: int = 600

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.workspace_dir / 'q-agent.db').as_posix()}"

    @property
    def specs_dir(self) -> Path:
        return self.workspace_dir / "specs"

    @property
    def evidence_dir(self) -> Path:
        return self.workspace_dir / "evidence"

    @property
    def knowledge_dir(self) -> Path:
        return self.workspace_dir / "knowledge"

    def ensure_dirs(self) -> None:
        for d in (self.workspace_dir, self.specs_dir, self.evidence_dir, self.knowledge_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings


settings = get_settings()
