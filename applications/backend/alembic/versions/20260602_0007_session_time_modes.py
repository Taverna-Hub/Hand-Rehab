"""restore session time modes revision

Revision ID: 20260602_0007
Revises: 20260602_0006
Create Date: 2026-06-18
"""

from __future__ import annotations

from collections.abc import Sequence


revision = "20260602_0007"
down_revision = "20260602_0006"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
