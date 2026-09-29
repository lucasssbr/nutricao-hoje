#!/usr/bin/env python3
"""Fecha o dia automaticamente (roda pelo GitHub Actions à meia-noite de Los Angeles).

Idempotente: pode rodar várias vezes sem estragar nada.
1. Todo dia em dados/dias.json anterior a hoje e ainda aberto -> "fechado": true.
2. Se não existe dados/<hoje>.json, cria o dia com o PLANO PADRÃO (dados/refeicoes.json) como sugestão.
3. index.html: data-dia -> hoje.
4. Botão "Plano" (index, dia, historico) -> dia.html?d=<amanhã>.
"""
import datetime
import json
import os
import pathlib
import re
import zoneinfo

TZ = zoneinfo.ZoneInfo("America/Los_Angeles")
ROOT = pathlib.Path(__file__).resolve().parent.parent
DADOS = ROOT / "dados"
META_PADRAO = {"kcal": 1570, "p": 180, "c": 100, "g": 50}


def carregar(p):
    return json.loads(p.read_text(encoding="utf-8"))


def salvar(p, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    agora = datetime.datetime.now(TZ).replace(microsecond=0)
    hoje = datetime.date.fromisoformat(os.environ["HOJE"]) if os.environ.get("HOJE") else agora.date()
    amanha = hoje + datetime.timedelta(days=1)
    carimbo = agora.isoformat()

    dias_path = DADOS / "dias.json"
    dias = carregar(dias_path)
    meta = META_PADRAO

    # 1. fechar dias passados
    for d in sorted(dias):
        p = DADOS / f"{d}.json"
        if not p.exists():
            continue
        dia = carregar(p)
        if dia.get("meta"):
            meta = dia["meta"]
        if datetime.date.fromisoformat(d) < hoje and not dia.get("fechado"):
            dia["fechado"] = True
            dia["atualizado"] = carimbo
            salvar(p, dia)
            print(f"fechado: {d}")

    # 2. garantir o JSON de hoje
    hoje_iso = hoje.isoformat()
    p_hoje = DADOS / f"{hoje_iso}.json"
    if not p_hoje.exists():
        sugestao, nota = [], "Sugestão do dia ainda não feita — peça ao Grok"
        try:
            import sys
            sys.path.insert(0, str(ROOT / "scripts"))
            from item import carregar_refeicoes, montar_plano
            refs = carregar_refeicoes()
            sugestao = montar_plano(refs=refs)
            nota = refs.get("plano_padrao_nota", "Plano padrão automático")
        except Exception as e:  # noqa: BLE001 — sem plano, o dia abre vazio
            print(f"aviso: plano padrão indisponível ({e})")
        salvar(p_hoje, {
            "data": hoje_iso,
            "atualizado": carimbo,
            "fechado": False,
            "meta": meta,
            "peso_kg": None,
            "lancado": [],
            "sugestao_nota": nota,
            "sugestao": sugestao,
        })
        print(f"criado: {hoje_iso} ({len(sugestao)} refeições no plano)")
    if hoje_iso not in dias:
        dias.append(hoje_iso)
        dias.sort()
        dias_path.write_text(json.dumps(dias) + "\n", encoding="utf-8")

    # 3 e 4. index e botão Plano
    for nome in ("index.html", "dia.html", "historico.html"):
        f = ROOT / nome
        s = f.read_text(encoding="utf-8")
        novo = re.sub(r'dia\.html\?d=\d{4}-\d{2}-\d{2}(">Plano<)', rf"dia.html?d={amanha.isoformat()}\1", s)
        if nome == "index.html":
            novo = re.sub(r'data-dia="\d{4}-\d{2}-\d{2}"', f'data-dia="{hoje_iso}"', novo)
        if novo != s:
            f.write_text(novo, encoding="utf-8")
            print(f"atualizado: {nome}")


if __name__ == "__main__":
    main()
