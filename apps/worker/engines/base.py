"""HOMIE Worker — Reconstruction engine abstraction."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


@dataclass
class ValidationResult:
    """Result of environment or input validation."""
    is_valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class PreparedInputs:
    """Preprocessed inputs ready for reconstruction."""
    job_id: str
    image_path: Path
    scene_description: dict | None = None
    prompt: str | None = None
    config: dict = field(default_factory=dict)


@dataclass
class ReconstructionOutput:
    """Raw output from reconstruction engine."""
    job_id: str
    success: bool
    artifacts: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


@dataclass
class MobileArtifacts:
    """Optimized artifacts for mobile viewing."""
    splat_path: Path | None = None
    collider_mesh_path: Path | None = None
    object_meshes: list[Path] = field(default_factory=list)
    panorama_path: Path | None = None
    thumbnail_path: Path | None = None
    sfx_paths: list[Path] = field(default_factory=list)
    manifest: dict = field(default_factory=dict)


ProgressCallback = Callable[[float, str], None]


class ReconstructionEngine(ABC):
    """Abstract base class for 3D reconstruction engines.

    All reconstruction engines must implement this interface.
    This allows swapping between Image Blaster, COLMAP, Nerfstudio, etc.
    """

    @property
    @abstractmethod
    def engine_name(self) -> str:
        """Unique identifier for this engine."""
        ...

    @abstractmethod
    async def validate_environment(self) -> ValidationResult:
        """Validate that all required services, API keys, and dependencies are available."""
        ...

    @abstractmethod
    async def validate_inputs(self, images: list[Path]) -> ValidationResult:
        """Validate that input images meet engine requirements."""
        ...

    @abstractmethod
    async def prepare_inputs(self, job_id: str, images: list[Path], config: dict) -> PreparedInputs:
        """Preprocess inputs (select best image, analyze scene, etc.)."""
        ...

    @abstractmethod
    async def run_reconstruction(
        self, inputs: PreparedInputs, progress_callback: ProgressCallback
    ) -> ReconstructionOutput:
        """Execute the reconstruction pipeline."""
        ...

    @abstractmethod
    async def postprocess_outputs(self, output: ReconstructionOutput, workspace: Path) -> MobileArtifacts:
        """Postprocess and optimize outputs for mobile delivery."""
        ...

    @abstractmethod
    async def cleanup(self, job_id: str, workspace: Path) -> None:
        """Clean up temporary files for a job."""
        ...
