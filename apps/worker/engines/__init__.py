"""HOMIE Worker — reconstruction engines registry."""

from engines.base import EngineError, JobCancelled, ReconstructionEngine, SceneFiles, TransientEngineError
from engines.image_blaster import ImageBlasterEngine

__all__ = [
    "EngineError",
    "ImageBlasterEngine",
    "JobCancelled",
    "ReconstructionEngine",
    "SceneFiles",
    "TransientEngineError",
    "get_engine",
]

ENGINES: dict[str, type[ReconstructionEngine]] = {"image_blaster": ImageBlasterEngine}


def get_engine(engine_name: str = "image_blaster") -> ReconstructionEngine:
    engine_cls = ENGINES.get(engine_name)
    if engine_cls is None:
        raise EngineError(f"Unknown reconstruction engine: {engine_name}. Available: {list(ENGINES)}", "bad_request")
    return engine_cls()
