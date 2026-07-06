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
    # Root of the local Claude Code state (session transcripts live under
    # `<claude_home>/projects/`). Read by `claude_usage_reader` for real /ai/stats.
    claude_home: Path = Path.home() / ".claude"
    claude_timeout_s: int = 300
    # project-bootstrap traverses a whole repo, so it gets a longer budget than a
    # one-shot prompt. It runs in a background thread, so a long wait is harmless.
    claude_bootstrap_timeout_s: int = 1200

    # Dedicated Q-Agent skills (SKILL.md methodology injected per Claude action).
    skills_dir: Path = REPO_ROOT / "skills"

    # Playwright
    playwright_bin: str = "npx"  # fallback: npx playwright test ...
    exec_timeout_s: int = 600
    # Self-heal loop: max times to re-generate + re-run a single failing spec
    # (feeding the failure back to Claude) before giving up.
    heal_max_attempts: int = 3
    # Max seconds to wait for the operator to complete a manual login (headed
    # browser) before the capture is abandoned and the run fails cleanly.
    auth_capture_timeout_s: int = 300
    # Node modules dir that has @playwright/test + installed browsers. Generated
    # specs live under workspace/specs/<run> with no node_modules of their own, so
    # execution runs the binary here and sets NODE_PATH so the specs' and config's
    # `@playwright/test` imports resolve. Defaults to the frontend's install.
    playwright_node_modules: Path = REPO_ROOT / "app" / "node_modules"

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

    @property
    def repos_dir(self) -> Path:
        """Local checkouts of application repos, pulled for project-bootstrap traversal."""
        return self.workspace_dir / "repos"

    @property
    def auth_dir(self) -> Path:
        """Saved per-project Playwright ``storageState.json`` sessions (manual login)."""
        return self.workspace_dir / "auth"

    def ensure_dirs(self) -> None:
        for d in (
            self.workspace_dir,
            self.specs_dir,
            self.evidence_dir,
            self.knowledge_dir,
            self.repos_dir,
            self.auth_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings


settings = get_settings()
