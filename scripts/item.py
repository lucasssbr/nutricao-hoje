#!/usr/bin/env python3
"""Calculadora de itens a partir de dados/alimentos.json — o Grok NÃO faz conta à mão.

Uso:
  python3 scripts/item.py chuck-costco 200 batata-inglesa 300 ovo-inteiro 2
  python3 scripts/item.py chuck 150            # aceita apelido, se não for ambíguo
  python3 scripts/item.py --lista              # mostra ids e bases
  python3 scripts/item.py --refeicao cafe-padrao   # refeição favorita pronta
  python3 scripts/item.py --refeicoes          # lista as favoritas
  python3 scripts/item.py --plano              # plano padrão do dia inteiro

Quantidade: em gramas quando a base do alimento é em gramas (ex. "100 g"),
em unidades quando a base é "1 un" / "1 lata". Pode escrever a unidade junto ("200g", "2un",
"1lata"); se escrever, ela precisa bater com a base. Quantidade tem que ser número > 0.
Imprime os itens em JSON (prontos para colar em "lancado" ou "sugestao") e o total.
"""
import math
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from comum import DADOS, MACROS, ROOT, arred, eh_numero, enxuto, ler_json, texto_json  # noqa: E402,F401


def carregar_alimentos():
    a = ler_json(DADOS / "alimentos.json")
    return {k: v for k, v in a.items() if not k.startswith("_")}


def base_de(alimento):
    """'100 g' -> ('g', 100); '1 un (~34 g)' -> ('un', 1); '1 lata (325 ml)' -> ('un', 1)."""
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)\s*(g|un|lata)\b", str(alimento.get("base", "")))
    if not m:
        raise ValueError(f"base inválida: {alimento.get('base')!r}")
    n = float(m.group(1).replace(",", "."))
    if not n > 0:
        raise ValueError(f"base precisa ser maior que zero: {alimento.get('base')!r}")
    return ("g" if m.group(2) == "g" else "un"), n


def esperado(alimento, quantidade):
    """Macros (e fibra, se o alimento tiver) para a quantidade, com 1 casa decimal."""
    if not (eh_numero(quantidade) and quantidade > 0):
        raise ValueError(f"quantidade precisa ser número > 0: {quantidade!r}")
    unidade, n = base_de(alimento)
    f = float(quantidade) / n
    vals = {k: arred(alimento[k] * f, 1) for k in MACROS}
    if eh_numero(alimento.get("fibra")):
        vals["fibra"] = arred(alimento["fibra"] * f, 1)
    return vals


def ler_quantidade(texto, unidade_base):
    """'200', '200g', '2un', '1lata', '1,5' → número > 0 (unidade, se escrita, tem que bater)."""
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(g|un|lata)?\s*", str(texto).lower())
    if not m:
        raise ValueError(f"quantidade inválida: {texto!r} (use número > 0, ex.: 200g, 2un, 1lata)")
    q = float(m.group(1).replace(",", "."))
    un = m.group(2)
    if un and ("g" if un == "g" else "un") != unidade_base:
        raise ValueError(f"unidade '{un}' não bate com a base do alimento ({unidade_base})")
    if not (math.isfinite(q) and q > 0):
        raise ValueError(f"quantidade precisa ser maior que zero: {texto!r}")
    return q


def resolver(alimentos, chave):
    chave_l = chave.lower().strip()
    if chave_l in alimentos:
        return chave_l
    achados = [k for k, v in alimentos.items()
               if chave_l == v["nome"].lower() or chave_l in [x.lower() for x in v.get("apelidos", [])]]
    if len(achados) == 1:
        return achados[0]
    if not achados:
        raise SystemExit(f"'{chave}' não está em alimentos.json — cadastre antes de logar.")
    raise SystemExit(f"'{chave}' é ambíguo: {', '.join(achados)} — use o id.")


def fmt(x):
    return enxuto(x)


def montar_item(alimentos, chave, qtd):
    aid = resolver(alimentos, chave)
    al = alimentos[aid]
    unidade, _ = base_de(al)
    try:
        q = ler_quantidade(qtd, unidade)
        vals = esperado(al, q)
    except ValueError as e:
        raise SystemExit(f"{aid}: {e}")
    qtd_txt = f"{fmt(q)} g" if unidade == "g" else (f"{fmt(q)} lata" if "lata" in al["base"] else f"{fmt(q)} un")
    item = {"nome": al["nome"], "qtd": qtd_txt, "alimento": aid, "quantidade": fmt(q)}
    item.update({k: fmt(v) for k, v in vals.items()})
    return item


def carregar_refeicoes():
    return ler_json(DADOS / "refeicoes.json")


def resolver_refeicao(refs, chave):
    chave_l = chave.lower().strip()
    todas = refs["refeicoes"]
    if chave_l in todas:
        return chave_l
    achados = [k for k, v in todas.items() if chave_l in [x.lower() for x in v.get("apelidos", [])]]
    if len(achados) == 1:
        return achados[0]
    raise SystemExit(f"Refeição '{chave}' não encontrada/ambígua. Opções: {', '.join(todas)}")


def montar_refeicao(alimentos, refs, chave):
    rid = resolver_refeicao(refs, chave)
    r = refs["refeicoes"][rid]
    return {"refeicao": r["nome"], "favorita": rid,
            "itens": [montar_item(alimentos, a, q) for a, q in r["itens"]]}


def montar_plano(alimentos=None, refs=None):
    alimentos = alimentos or carregar_alimentos()
    refs = refs or carregar_refeicoes()
    return [montar_refeicao(alimentos, refs, rid) for rid in refs["plano_padrao"]]


def total(refeicoes):
    return {k: arred(sum(i[k] for r in refeicoes for i in r["itens"]), 1) for k in MACROS}


def linha_total(itens):
    t = {k: sum(i[k] for i in itens) for k in MACROS}
    fib = sum(i.get("fibra", 0) for i in itens)
    return (f"TOTAL: {arred(t['kcal'])} kcal | P {arred(t['p'])} | C {arred(t['c'])} | "
            f"G {arred(t['g'])} | fibra {arred(fib)} g")


def imprimir(refeicoes):
    print(texto_json(refeicoes), end="")
    print(linha_total([i for r in refeicoes for i in r["itens"]]))


def main(args):
    alimentos = carregar_alimentos()
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    if args[0] == "--lista":
        for k, v in alimentos.items():
            print(f"{k:22} base {v['base']:18} {v['kcal']} kcal | P{v['p']} C{v['c']} G{v['g']}  ({v['fonte']})")
        return
    if args[0] == "--refeicoes":
        refs = carregar_refeicoes()
        for k, v in refs["refeicoes"].items():
            t = total([montar_refeicao(alimentos, refs, k)])
            print(f"{k:16} {v['nome']:10} {arred(t['kcal'])} kcal | P{arred(t['p'])} C{arred(t['c'])} G{arred(t['g'])}  apelidos: {', '.join(v.get('apelidos', []))}")
        print("plano_padrao:", " → ".join(refs["plano_padrao"]))
        return
    if args[0] == "--refeicao":
        refs = carregar_refeicoes()
        imprimir([montar_refeicao(alimentos, refs, k) for k in args[1:]])
        return
    if args[0] == "--plano":
        imprimir(montar_plano(alimentos))
        return
    if len(args) % 2:
        raise SystemExit("Passe pares: <alimento> <quantidade> ...")
    itens = [montar_item(alimentos, args[i], args[i + 1]) for i in range(0, len(args), 2)]
    print(texto_json(itens), end="")
    print(linha_total(itens))


if __name__ == "__main__":
    main(sys.argv[1:])
