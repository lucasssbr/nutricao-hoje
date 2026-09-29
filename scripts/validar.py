#!/usr/bin/env python3
"""Confere os dados do site. Roda no GitHub a cada envio (e o Grok pode rodar antes do push).

  python3 scripts/validar.py

Erros (fazem a checagem falhar):
  - JSON inválido, campo faltando, número inválido
  - dias.json e arquivos de dia desencontrados; data-dia do index sem arquivo
  - item com "alimento" cujos valores não batem com alimentos.json (tolerância 1) — só em dia aberto;
    dia fechado guarda os valores da época e não é recalculado quando a biblioteca muda
  - dia aberto a partir de 2026-09-29 com item sem "alimento"
Avisos (não falham): alimento acima do limite_dia_g no dia (ex.: acém 200 g).
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
        if "fibra" in v and not (num(v["fibra"]) and v["fibra"] >= 0):
            erros.append(f"alimentos.json/{k}: 'fibra' deve ser número ≥ 0")
        if "limite_dia_g" in v and not (num(v["limite_dia_g"]) and v["limite_dia_g"] > 0):
            erros.append(f"alimentos.json/{k}: 'limite_dia_g' deve ser número > 0")
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
    gramas = {}
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
                if num(it.get("fibra")) and "fibra" in exp and abs(it["fibra"] - exp["fibra"]) > TOL:
                    ruins.append(f"fibra {it['fibra']}≠{exp['fibra']}")
                if ruins and not dia.get("fechado"):
                    erros.append(f"{onde}: valores não batem com a biblioteca ({', '.join(ruins)})")
                if lista == "lancado" and "limite_dia_g" in alimentos[aid]:
                    gramas[aid] = gramas.get(aid, 0.0) + float(it["quantidade"])
    for aid, g in gramas.items():
        lim = alimentos[aid]["limite_dia_g"]
        if g > lim:
            avisos.append(f"{nome}: {aid} lançado = {g:g} g (limite {lim:g} g)")


def checar_refeicoes(alimentos):
    p = DADOS / "refeicoes.json"
    if not p.exists():
        return
    refs = ler(p)
    if not isinstance(refs, dict):
        return
    todas = refs.get("refeicoes", {})
    for rid, r in todas.items():
        for par in r.get("itens", []):
            if not (isinstance(par, list) and len(par) == 2 and par[0] in alimentos and num(par[1])):
                erros.append(f"refeicoes.json/{rid}: item inválido {par!r} (precisa [id existente, quantidade])")
    for rid in refs.get("plano_padrao", []):
        if rid not in todas:
            erros.append(f"refeicoes.json: plano_padrao cita '{rid}', que não existe")


def checar_objetivo():
    p = DADOS / "objetivo.json"
    if not p.exists():
        return
    o = ler(p)
    if not isinstance(o, dict):
        return
    for nome, obj in [("atual", o.get("atual"))] + [(f"anteriores[{i}]", x) for i, x in enumerate(o.get("anteriores", []))]:
        if obj is None and nome == "atual":
            continue
        if not isinstance(obj, dict):
            erros.append(f"objetivo.json/{nome}: deve ser objeto")
            continue
        for campo in ("inicio", "data_alvo"):
            if not DATA_RE.match(str(obj.get(campo, ""))):
                erros.append(f"objetivo.json/{nome}: '{campo}' deve ser AAAA-MM-DD")
        if str(obj.get("data_alvo", "")) <= str(obj.get("inicio", "")):
            erros.append(f"objetivo.json/{nome}: data_alvo precisa ser depois do início")
        for campo in ("peso_inicial_kg", "meta_semanal_kg"):
            if not num(obj.get(campo)):
                erros.append(f"objetivo.json/{nome}: '{campo}' deve ser número")
        metas = obj.get("metas")
        if metas is not None:
            if not (isinstance(metas, dict) and all(num(metas.get(m)) for m in MACROS)):
                erros.append(f"objetivo.json/{nome}: 'metas' precisa de kcal, p, c, g numéricos")
            else:
                soma = 4 * metas["p"] + 4 * metas["c"] + 9 * metas["g"]
                if abs(soma - metas["kcal"]) > 0.05 * metas["kcal"]:
                    avisos.append(f"objetivo.json/{nome}: metas somam {soma:g} kcal pelos macros (4/4/9), mas kcal = {metas['kcal']:g}")
        g = obj.get("gasto_kcal")
        if g is not None and not (num(g) and 1200 <= g <= 5000):
            erros.append(f"objetivo.json/{nome}: 'gasto_kcal' deve ser número entre 1200 e 5000 (ou não existir)")
        if num(obj.get("meta_semanal_kg")) and obj["meta_semanal_kg"] > 1.2:
            avisos.append(f"objetivo.json/{nome}: meta de {obj['meta_semanal_kg']} kg/semana é bem agressiva")


def main():
    alimentos = checar_alimentos()
    checar_objetivo()
    checar_refeicoes(alimentos)
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
    metas_obj = None
    o = ler(DADOS / "objetivo.json") if (DADOS / "objetivo.json").exists() else None
    if isinstance(o, dict) and isinstance((o.get("atual") or {}).get("metas"), dict):
        metas_obj = {m: o["atual"]["metas"].get(m) for m in MACROS}
    for d in arquivos:
        dia = ler(DADOS / f"{d}.json")
        if isinstance(dia, dict):
            checar_dia(f"{d}.json", dia, alimentos)
            if metas_obj and not dia.get("fechado") and isinstance(dia.get("meta"), dict) \
                    and {m: dia["meta"].get(m) for m in MACROS} != metas_obj:
                avisos.append(f"{d}.json: meta do dia diferente das metas do objetivo — atualizar 'meta' do dia aberto")
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
