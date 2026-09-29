#!/usr/bin/env python3
"""Calculadora de itens a partir de dados/alimentos.json — o Grok NÃO faz conta à mão.

Uso:
  python3 scripts/item.py chuck-costco 200 batata-inglesa 300 ovo-inteiro 2
  python3 scripts/item.py chuck 150            # aceita apelido, se não for ambíguo
  python3 scripts/item.py --lista              # mostra ids e bases

Quantidade: em gramas quando a base do alimento é em gramas (ex. "100 g"),
em unidades quando a base é "1 un" / "1 lata". Imprime os itens em JSON
(prontos para colar em "lancado" ou "sugestao") e o total.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MACROS = ("kcal", "p", "c", "g")


def carregar_alimentos():
    a = json.loads((ROOT / "dados" / "alimentos.json").read_text(encoding="utf-8"))
    return {k: v for k, v in a.items() if not k.startswith("_")}


def base_de(alimento):
    """'100 g' -> ('g', 100); '1 un (~34 g)' -> ('un', 1); '1 lata (325 ml)' -> ('un', 1)."""
    m = re.match(r"\s*([\d.,]+)\s*(g|un|lata)\b", alimento["base"])
    if not m:
        raise ValueError(f"base inválida: {alimento['base']!r}")
    n = float(m.group(1).replace(",", "."))
    return ("g" if m.group(2) == "g" else "un"), n


def esperado(alimento, quantidade):
    unidade, n = base_de(alimento)
    f = float(quantidade) / n
    return {k: round(alimento[k] * f, 1) for k in MACROS}


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
    return int(x) if float(x).is_integer() else x


def montar_item(alimentos, chave, qtd):
    aid = resolver(alimentos, chave)
    al = alimentos[aid]
    unidade, _ = base_de(al)
    q = float(str(qtd).lower().replace("g", "").replace("un", "").replace(",", "."))
    vals = esperado(al, q)
    qtd_txt = f"{fmt(q)} g" if unidade == "g" else (f"{fmt(q)} lata" if "lata" in al["base"] else f"{fmt(q)} un")
    item = {"nome": al["nome"], "qtd": qtd_txt, "alimento": aid, "quantidade": fmt(q)}
    item.update({k: fmt(v) for k, v in vals.items()})
    return item


def main(args):
    alimentos = carregar_alimentos()
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    if args[0] == "--lista":
        for k, v in alimentos.items():
            print(f"{k:22} base {v['base']:18} {v['kcal']} kcal | P{v['p']} C{v['c']} G{v['g']}  ({v['fonte']})")
        return
    if len(args) % 2:
        raise SystemExit("Passe pares: <alimento> <quantidade> ...")
    itens = [montar_item(alimentos, args[i], args[i + 1]) for i in range(0, len(args), 2)]
    tot = {k: round(sum(i[k] for i in itens), 1) for k in MACROS}
    print(json.dumps(itens, ensure_ascii=False, indent=2))
    print(f"TOTAL: {round(tot['kcal'])} kcal | P {round(tot['p'])} | C {round(tot['c'])} | G {round(tot['g'])}")


if __name__ == "__main__":
    main(sys.argv[1:])
