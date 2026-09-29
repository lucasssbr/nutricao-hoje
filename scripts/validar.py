#!/usr/bin/env python3
"""Confere os dados do site. Roda no GitHub a cada envio (e o Grok pode rodar antes do push).

  python3 scripts/validar.py

Erros (fazem a checagem falhar):
  - JSON inválido, campo faltando, número inválido
  - dias.json e arquivos de dia desencontrados; data-dia do index sem arquivo
  - item com "alimento" cujos valores não batem com alimentos.json (tolerância 1)
  - dia aberto a partir de 2026-09-30 com item sem "alimento"
Avisos (não falham): chuck acima de 200 g no dia.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from item import MACROS, base_de, carregar_alimentos, esperado  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DADOS = ROOT / "dados"
DATA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EXIGE_ID_DESDE = "2026-09-29"
FONTES = {"rotulo", "usda", "openfoodfacts", "lucas", "estimado"}
TOL = 1.0

erros, avisos = [], []


def ler(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        erros.append(f"{p.name}: JSON inválido ({e})")
        return None


def num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def checar_alimentos():
    try:
        alimentos = carregar_alimentos()
    except Exception as e:  # noqa: BLE001
        erros.append(f"alimentos.json: {e}")
        return {}
    for k, v in alimentos.items():
        for campo in ("nome", "base", "fonte"):
            if not isinstance(v.get(campo), str):
                erros.append(f"alimentos.json/{k}: falta '{campo}'")
        for m in MACROS:
            if not num(v.get(m)):
                erros.append(f"alimentos.json/{k}: '{m}' não é número")
        if v.get("fonte") not in FONTES:
            erros.append(f"alimentos.json/{k}: fonte '{v.get('fonte')}' inválida")
        try:
            base_de(v)
        except Exception as e:  # noqa: BLE001
            erros.append(f"alimentos.json/{k}: {e}")
    return alimentos


def checar_dia(nome, dia, alimentos):
    d = nome[:-5]
    if dia.get("data") != d:
        erros.append(f"{nome}: 'data' ({dia.get('data')}) diferente do nome do arquivo")
    if not isinstance(dia.get("fechado"), bool):
        erros.append(f"{nome}: 'fechado' deve ser true/false")
    meta = dia.get("meta")
    if not isinstance(meta, dict) or not all(num(meta.get(m)) for m in MACROS):
        erros.append(f"{nome}: 'meta' inválida")
    if dia.get("peso_kg") is not None and not num(dia.get("peso_kg")):
        erros.append(f"{nome}: 'peso_kg' deve ser número ou null")
    chuck_g = 0.0
    for lista in ("lancado", "sugestao"):
        refeicoes = dia.get(lista)
        if not isinstance(refeicoes, list):
            erros.append(f"{nome}: '{lista}' deve ser lista")
            continue
        for r in refeicoes:
            ref = r.get("refeicao", "?")
            if not isinstance(r.get("itens"), list):
                erros.append(f"{nome}/{lista}/{ref}: 'itens' deve ser lista")
                continue
            for it in r["itens"]:
                onde = f"{nome}/{lista}/{ref}/{it.get('nome', '?')}"
                if not all(num(it.get(m)) for m in MACROS):
                    erros.append(f"{onde}: kcal/p/c/g precisam ser números")
                    continue
                aid = it.get("alimento")
                if aid is None:
                    if not dia.get("fechado") and d >= EXIGE_ID_DESDE:
                        erros.append(f"{onde}: sem 'alimento' — gere o item com scripts/item.py")
                    continue
                if aid not in alimentos:
                    erros.append(f"{onde}: alimento '{aid}' não existe em alimentos.json")
                    continue
                if not num(it.get("quantidade")):
                    erros.append(f"{onde}: 'quantidade' faltando")
                    continue
                exp = esperado(alimentos[aid], it["quantidade"])
                ruins = [f"{m} {it[m]}≠{exp[m]}" for m in MACROS if abs(it[m] - exp[m]) > TOL]
                if ruins:
                    erros.append(f"{onde}: valores não batem com a biblioteca ({', '.join(ruins)})")
                if aid == "chuck-costco" and lista == "lancado":
                    chuck_g += float(it["quantidade"])
    if chuck_g > 200:
        avisos.append(f"{nome}: chuck lançado = {chuck_g:g} g (limite 200 g)")


def main():
    alimentos = checar_alimentos()
    dias = ler(DADOS / "dias.json")
    arquivos = sorted(p.name[:-5] for p in DADOS.glob("*.json") if DATA_RE.match(p.name[:-5]))
    if isinstance(dias, list):
        for d in dias:
            if not isinstance(d, str) or not DATA_RE.match(d):
                erros.append(f"dias.json: data inválida {d!r}")
            elif d not in arquivos:
                erros.append(f"dias.json lista {d}, mas dados/{d}.json não existe")
        for d in arquivos:
            if d not in dias:
                erros.append(f"dados/{d}.json existe, mas não está em dias.json")
    elif dias is not None:
        erros.append("dias.json deve ser uma lista")
    for d in arquivos:
        dia = ler(DADOS / f"{d}.json")
        if isinstance(dia, dict):
            checar_dia(f"{d}.json", dia, alimentos)
    m = re.search(r'data-dia="([^"]+)"', (ROOT / "index.html").read_text(encoding="utf-8"))
    if not m or m.group(1) not in arquivos:
        erros.append(f"index.html: data-dia {m.group(1) if m else '?'} sem arquivo em dados/")

    for a in avisos:
        print(f"::warning::{a}")
    for e in erros:
        print(f"::error::{e}")
    if erros:
        print(f"\n{len(erros)} erro(s).")
        sys.exit(1)
    print(f"Dados OK ({len(arquivos)} dias, {len(alimentos)} alimentos, {len(avisos)} aviso(s)).")


if __name__ == "__main__":
    main()
