"""HOMIE Worker — reconstruction engine interface.

An engine turns a room's photos into downloadable scene files. Engines are
synchronous: the Celery task runs them in a worker process.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol


class EngineError(Exception):
    """A failure that will not go away by retrying (bad input, bad key, generation failed)."""

    category = "engine_error"

    def __init__(self, message: str, category: str | None = None):
        super().__init__(message)
        if category:
            self.category = category


class TransientEngineError(Exception):
    """A failure worth retrying (network error, provider 5xx, rate limit)."""


class JobCancelled(Exception):
    pass


class JobContext(Protocol):
    """What an engine can ask of the running job."""

    def progress(self, fraction: float, message: str) -> None: ...

    def check_cancelled(self) -> None:
        """Raise JobCancelled if the user cancelled the job."""
        ...

    def get_state(self, key: str) -> Any: ...

    def set_state(self, key: str, value: Any) -> None:
        """Persist a small value on the job (survives Celery retries), e.g. a provider operation id."""
        ...


@dataclass
class SceneFiles:
    """Downloaded scene files, keyed by artifact name (splat, splat_mobile, collider, panorama, thumbnail)."""

    files: dict[str, Path] = field(default_factory=dict)
    manifest: dict[str, Any] = field(default_factory=dict)


class ReconstructionEngine(ABC):
    @property
    @abstractmethod
    def engine_name(self) -> str: ...

    @abstractmethod
    def validate_environment(self) -> None:
        """Raise EngineError if API keys or dependencies are missing."""

    @abstractmethod
    def reconstruct(self, images: list[Path], workspace: Path, config: dict, ctx: JobContext) -> SceneFiles:
        """Build a scene from local image files, writing outputs under `workspace`."""
