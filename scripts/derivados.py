#!/usr/bin/env python3
"""Regenera os arquivos DERIVADOS a partir dos dias (nunca editar à mão):

  - dados/resumo.json   → totais/meta/peso/registro de cada dia (o Histórico e o card Hoje leem)
  - dados/objetivo.json → atual.calculo e, no modo automático, atual.meta_semanal_kg (scripts/meta.py)
  - dados/previa.json   → prévia da sugestão automática de AMANHÃ (scripts/sugerir.py), para o botão Plano;
                          refeita a cada registro de hoje. Falhou? fica sem prévia (a página usa o plano padrão)

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


# tudo que gerar() pode escrever em dados/ (registrar.py desfaz exatamente estes, mais o dia, se a validação falhar)
ARQUIVOS = ("resumo.json", "objetivo.json", "previa.json")


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


def previa_texto(dados=DADOS, hoje=None):
    """Prévia da sugestão de amanhã (mesma conta da meia-noite, com o histórico de agora)."""
    import datetime
    from comum import hoje_la
    from sugerir import sugerir
    dados = pathlib.Path(dados)
    hoje = hoje or hoje_la()
    amanha = (hoje + datetime.timedelta(days=1)).isoformat()
    try:
        meta = {k: ler_json(dados / "objetivo.json")["atual"]["metas"][k] for k in MACROS}
    except Exception:  # noqa: BLE001 — sem objetivo: meta do último dia
        dias = sorted(ler_json(dados / "dias.json"))
        meta = ler_json(dados / f"{dias[-1]}.json").get("meta") if dias else None
    sug, nota = sugerir(amanha, {"meta": meta, "lancado": []}, dados=dados)
    return texto_json({"_sobre": "DERIVADO (scripts/derivados.py) — não editar. Prévia da sugestão de amanhã; "
                                 "a oficial é montada à meia-noite (fechar_dia.py).",
                       "para": amanha, "meta": meta, "sugestao_nota": nota, "sugestao": sug})


def gerar_previa(dados=DADOS, hoje=None):
    arq = pathlib.Path(dados) / "previa.json"
    try:
        novo = previa_texto(dados, hoje)
    except Exception as e:  # noqa: BLE001 — prévia nunca derruba a publicação
        print(f"aviso: prévia de amanhã não gerada ({e})", file=sys.stderr)
        return False
    if arq.exists() and arq.read_text(encoding="utf-8") == novo:
        return False
    tmp = arq.with_suffix(".json.tmp")
    tmp.write_text(novo, encoding="utf-8")
    tmp.replace(arq)
    return True


def gerar(dados=DADOS, hoje=None, silencioso=False):
    """Regenera resumo + cálculo do objetivo + prévia de amanhã. Devolve lista do que mudou."""
    import datetime
    import os
    if hoje is None and os.environ.get("HOJE"):   # testes simulam a data (mesma variável do fechar_dia.py)
        hoje = datetime.date.fromisoformat(os.environ["HOJE"])
    mudou = []
    if gerar_resumo(dados):
        mudou.append("resumo.json")
    import meta  # noqa: E402 — meta usa resumo/dias
    if meta.atualizar(dados=dados, hoje=hoje, silencioso=True):
        mudou.append("objetivo.json")
    if gerar_previa(dados, hoje):
        mudou.append("previa.json")
    if not silencioso:
        print("derivados: " + (", ".join(mudou) + " atualizado(s)" if mudou else "já estavam em dia"))
    return mudou


def main():
    if "--checar" in sys.argv:
        arq = DADOS / "resumo.json"
        ok = arq.exists() and arq.read_text(encoding="utf-8") == resumo_texto()
        print("resumo.json em dia" if ok else "resumo.json DESATUALIZADO — rode python3 scripts/derivados.py")
        sys.exit(0 if ok else 1)
    from comum import trava_escrita
    with trava_escrita():
        gerar()


if __name__ == "__main__":
    main()
