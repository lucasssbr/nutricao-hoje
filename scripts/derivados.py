#!/usr/bin/env python3
"""Regenera os arquivos DERIVADOS a partir dos dias (nunca editar à mão):

  - dados/resumo.json   → totais/meta/peso/registro de cada dia (o Histórico e o card Hoje leem)
  - dados/objetivo.json → atual.calculo e, no modo automático, atual.meta_semanal_kg (scripts/meta.py)

  python3 scripts/derivados.py          # regenera (idempotente: sem mudança nos dias, nada muda)
  python3 scripts/derivados.py --checar # só diz se está desatualizado (sai 1 se estiver)

Roda sozinho: no fechamento da meia-noite, a cada envio para o GitHub (workflow "Conferir e publicar")
e no scripts/registrar.py. Os totais históricos saem dos valores GUARDADOS nos itens de cada dia —
nunca da biblioteca atual — então mudar a biblioteca não reescreve o passado.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from comum import DADOS, MACROS, arred, eh_numero, ler_json, registro_do_dia, somar, texto_json  # noqa: E402


def resumo_lista(dados=DADOS):
    dados = pathlib.Path(dados)
    dias = ler_json(dados / "dias.json")
    saida = []
    for d in sorted(dias):
        p = dados / f"{d}.json"
        if not p.exists():
            continue
        dia = ler_json(p)
        tot = somar(dia.get("lancado", []))
        cons = {m: arred(tot[m], 1) for m in MACROS}
        if "fibra" in tot:
            cons["fibra"] = arred(tot["fibra"], 1)
        saida.append({
            "data": d,
            "fechado": bool(dia.get("fechado")),
            "registro": registro_do_dia(dia),
            "refeicoes": len(dia.get("lancado", [])),
            "meta": dia.get("meta"),
            "cons": cons,
            "peso": dia.get("peso_kg") if eh_numero(dia.get("peso_kg")) else None,
            "gordura": dia.get("gordura_pct"),
            "gordura_fonte": dia.get("gordura_fonte"),
            "atualizado": dia.get("atualizado"),
        })
    return saida


def resumo_texto(dados=DADOS):
    return texto_json(resumo_lista(dados), compacto=True)


def gerar_resumo(dados=DADOS):
    arq = pathlib.Path(dados) / "resumo.json"
    novo = resumo_texto(dados)
    if arq.exists() and arq.read_text(encoding="utf-8") == novo:
        return False
    tmp = arq.with_suffix(".json.tmp")
    tmp.write_text(novo, encoding="utf-8")
    tmp.replace(arq)
    return True


def gerar(dados=DADOS, hoje=None, silencioso=False):
    """Regenera resumo + cálculo do objetivo. Devolve lista do que mudou."""
    mudou = []
    if gerar_resumo(dados):
        mudou.append("resumo.json")
    import meta  # noqa: E402 — meta usa resumo/dias
    if meta.atualizar(dados=dados, hoje=hoje, silencioso=True):
        mudou.append("objetivo.json")
    if not silencioso:
        print("derivados: " + (", ".join(mudou) + " atualizado(s)" if mudou else "já estavam em dia"))
    return mudou


def main():
    if "--checar" in sys.argv:
        arq = DADOS / "resumo.json"
        ok = arq.exists() and arq.read_text(encoding="utf-8") == resumo_texto()
        print("resumo.json em dia" if ok else "resumo.json DESATUALIZADO — rode python3 scripts/derivados.py")
        sys.exit(0 if ok else 1)
    gerar()


if __name__ == "__main__":
    main()
