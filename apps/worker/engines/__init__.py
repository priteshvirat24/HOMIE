"""HOMIE Worker — Reconstruction engines registry."""

from engines.base import ReconstructionEngine
from engines.image_blaster import ImageBlasterEngine

__all__ = ["ReconstructionEngine", "ImageBlasterEngine", "get_engine"]


def get_engine(engine_name: str = "image_blaster") -> ReconstructionEngine:
    """Factory function to get a reconstruction engine by name."""
    engines = {
        "image_blaster": ImageBlasterEngine,
    }

    engine_cls = engines.get(engine_name)
    if engine_cls is None:
        raise ValueError(f"Unknown reconstruction engine: {engine_name}. Available: {list(engines.keys())}")

    return engine_cls()
