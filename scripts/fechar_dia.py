#!/usr/bin/env python3
"""Fecha o dia automaticamente (roda pelo GitHub Actions à meia-noite de Los Angeles).

Idempotente: pode rodar várias vezes sem estragar nada.
1. Todo dia em dados/dias.json anterior a hoje e ainda aberto -> "fechado": true.
2. Se não existe dados/<hoje>.json, cria o dia com a SUGESTÃO AUTOMÁTICA (scripts/sugerir.py: o que o Lucas
   comeu nos últimos dias; sem histórico, o PLANO PADRÃO de dados/refeicoes.json)
   e a meta do objetivo atual (dados/objetivo.json → atual.metas).
3. index.html: data-dia -> hoje.
4. Botão "Plano" (index, dia, historico, alimentos) -> dia.html?d=<amanhã>.
5. Derivados (scripts/derivados.py): dados/resumo.json e o cálculo do objetivo.

Registro completo por padrão (decisão do Lucas, 02/10): ao fechar, o dia sem confirmação vira
"completo" (obs "automático no fechamento") — a não ser que o Lucas tenha avisado "dia parcial"
(registrar.py completo --status parcial, que também vale depois de fechado). Proteção: dia sem refeição
ou com menos de COMPLETO_MIN_PCT da meta de kcal fica "desconhecido" (provável esquecimento de lançar).
"""
import datetime
import os
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from comum import DADOS, ROOT, agora_la, gravar_json, ler_json, registro_do_dia, somar  # noqa: E402

META_PADRAO = {"kcal": 1570, "p": 180, "c": 100, "g": 50}
COMPLETO_MIN_PCT = 50   # abaixo disso (ou sem refeição) o fechamento não marca "completo" sozinho


def completo_automatico(dia, meta, carimbo):
    """Marca o registro como completo ao fechar, se o Lucas não confirmou nada e o dia parece lançado.
    Devolve o texto do log (ou None se não mexeu)."""
    if registro_do_dia(dia) != "desconhecido":
        return None                                   # completo/parcial já informado: respeita
    kcal = somar(dia.get("lancado")).get("kcal", 0)
    alvo = float((dia.get("meta") or meta).get("kcal") or 0)
    if not dia.get("lancado") or (alvo > 0 and kcal < alvo * COMPLETO_MIN_PCT / 100):
        return f"registro não confirmado ({round(kcal)} kcal lançadas — menos de {COMPLETO_MIN_PCT}% da meta)"
    dia["registro"] = {"status": "completo", "em": carimbo,
                       "obs": "automático no fechamento (sem aviso de dia parcial)"}
    return "registro completo (automático)"


def carregar(p):
    return ler_json(p)


def salvar(p, obj):
    gravar_json(p, obj)


def metas_do_objetivo():
    """Metas diárias do objetivo atual, ou None se não houver."""
    try:
        m = carregar(DADOS / "objetivo.json")["atual"]["metas"]
        return {k: m[k] for k in ("kcal", "p", "c", "g")}
    except Exception:  # noqa: BLE001 — sem objetivo/metas: usa a meta do último dia
        return None


def main():
    # AGORA_UTC (ISO com fuso) só para testes: simula o instante em que o GitHub rodou o agendamento
    agora = agora_la(datetime.datetime.fromisoformat(os.environ["AGORA_UTC"])) if os.environ.get("AGORA_UTC") else agora_la()
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
            reg = completo_automatico(dia, meta, carimbo)
            salvar(p, dia)
            print(f"fechado: {d}" + (f" · {reg}" if reg else ""))

    # 2. garantir o JSON de hoje
    hoje_iso = hoje.isoformat()
    p_hoje = DADOS / f"{hoje_iso}.json"
    if not p_hoje.exists():
        meta = metas_do_objetivo() or meta
        sugestao, nota = [], "Sugestão do dia ainda não feita — peça ao Grok"
        try:
            # sugestão pelo que o Lucas comeu nos últimos dias (sem histórico suficiente: plano padrão)
            from sugerir import sugerir
            sugestao, nota = sugerir(hoje_iso, {"meta": meta, "lancado": []})
        except Exception as e:  # noqa: BLE001 — falhou a automática: plano padrão; sem plano, o dia abre vazio
            print(f"aviso: sugestão automática indisponível ({e}); usando o plano padrão")
            try:
                from item import carregar_refeicoes, montar_plano
                refs = carregar_refeicoes()
                sugestao = montar_plano(refs=refs)
                nota = refs.get("plano_padrao_nota", "Plano padrão automático")
            except Exception as e2:  # noqa: BLE001
                print(f"aviso: plano padrão indisponível ({e2})")
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
        gravar_json(dias_path, dias, compacto=True)

    # 3 e 4. index e botão Plano
    for nome in ("index.html", "dia.html", "historico.html", "alimentos.html", "planejar.html", "semana.html"):
        f = ROOT / nome
        s = f.read_text(encoding="utf-8")
        novo = re.sub(r'dia\.html\?d=\d{4}-\d{2}-\d{2}(">Plano<)', rf"dia.html?d={amanha.isoformat()}\1", s)
        if nome == "index.html":
            novo = re.sub(r'data-dia="\d{4}-\d{2}-\d{2}"', f'data-dia="{hoje_iso}"', novo)
        if novo != s:
            f.write_text(novo, encoding="utf-8")
            print(f"atualizado: {nome}")


    # 5. derivados (resumo + cálculo do objetivo), sobre os dias como ficaram
    from derivados import gerar
    gerar(hoje=hoje)


if __name__ == "__main__":
    from comum import trava_escrita
    with trava_escrita():   # exclusão com registrar.py/derivados.py no mesmo checkout
        main()
