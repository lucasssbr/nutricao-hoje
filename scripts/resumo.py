#!/usr/bin/env python3
"""Compatibilidade: o resumo agora é gerado por scripts/derivados.py (resumo + cálculo do objetivo)."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from derivados import gerar_resumo  # noqa: E402


def gerar():
    if gerar_resumo():
        print("resumo.json atualizado")


if __name__ == "__main__":
    gerar()
