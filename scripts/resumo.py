#!/usr/bin/env python3
"""Gera dados/resumo.json: um resumo por dia (totais, meta, peso, fechado) para o Histórico
carregar tudo com um só arquivo. Roda sozinho à meia-noite (fechar_dia.py).

  python3 scripts/resumo.py

O Histórico lê este resumo e busca direto só os dias mais recentes (que ainda podem mudar).
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DADOS = ROOT / "dados"
MACROS = ("kcal", "p", "c", "g")


def gerar():
    dias = json.loads((DADOS / "dias.json").read_text(encoding="utf-8"))
    saida = []
    for d in sorted(dias):
        p = DADOS / f"{d}.json"
        if not p.exists():
            continue
        dia = json.loads(p.read_text(encoding="utf-8"))
        cons = {m: 0.0 for m in MACROS}
        fibra = None
        for r in dia.get("lancado", []):
            for it in r.get("itens", []):
                for m in MACROS:
                    cons[m] += float(it.get(m) or 0)
                if it.get("fibra") is not None:
                    fibra = (fibra or 0.0) + float(it["fibra"])
        cons = {m: round(v, 1) for m, v in cons.items()}
        if fibra is not None:
            cons["fibra"] = round(fibra, 1)
        saida.append({
            "data": d,
            "fechado": bool(dia.get("fechado")),
            "meta": dia.get("meta"),
            "cons": cons,
            "peso": dia.get("peso_kg"),
        })
    novo = json.dumps(saida, ensure_ascii=False, separators=(",", ":")) + "\n"
    arq = DADOS / "resumo.json"
    if not arq.exists() or arq.read_text(encoding="utf-8") != novo:
        arq.write_text(novo, encoding="utf-8")
        print(f"resumo.json: {len(saida)} dias")


if __name__ == "__main__":
    gerar()
