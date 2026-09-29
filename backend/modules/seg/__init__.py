"""Segmentation refinement (SAM) for water/ice masks."""

from modules.seg.sam import BEST_MODEL, device, refine

__all__ = ["BEST_MODEL", "device", "refine"]
