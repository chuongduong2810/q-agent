"""SQLAlchemy models for Q-Agent. Import order registers them on Base.metadata."""

from app.models.provider import Provider
from app.models.project import Project
from app.models.ticket import Ticket
from app.models.run import Run, RunTicket
from app.models.testcase import AutomationSpec, TestCase
from app.models.execution import Evidence, Execution, ExecutionResult
from app.models.report import Report
from app.models.comment import TicketComment

__all__ = [
    "Provider",
    "Project",
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
]
