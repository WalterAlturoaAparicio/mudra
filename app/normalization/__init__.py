"""Landmark normalization: the ``Normalizer`` interface and implementations.

Normalization is isolated behind an interface so strategies are swappable without
touching the recorder, dataset, or domain (constitution Principle I & III).
"""
