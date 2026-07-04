"""SQLAlchemy models for Q-Agent. Import order registers them on Base.metadata."""

from app.models.provider import Provider
from app.models.project import Project
from app.models.project_config import ProjectConfig
from app.models.ticket import Ticket
from app.models.run import Run, RunTicket
from app.models.testcase import AutomationSpec, TestCase
from app.models.execution import Evidence, Execution, ExecutionResult
from app.models.report import Report
from app.models.comment import TicketComment
from app.models.knowledge import ProjectKnowledge
from app.models.linked import LinkedTestCase
from app.models.audit import AuditLog

__all__ = [
    "AuditLog",
    "Provider",
    "Project",
    "ProjectConfig",
    "Ticket",
    "Run",
    "RunTicket",
    "TestCase",
    "AutomationSpec",
    "Execution",
    "ExecutionResult",
    "Evidence",
    "Report",
    "TicketComment",
    "ProjectKnowledge",
    "LinkedTestCase",
]
