#!/usr/bin/env python3
"""Calcula a meta semanal de perda de peso pelo déficit calórico e grava em dados/objetivo.json.

  python3 scripts/meta.py            # recalcula e grava
  python3 scripts/meta.py --ver      # só mostra a conta

Conta:
  gasto (TDEE) = objetivo.atual.gasto_kcal, se o Lucas informou (vale sempre esse);
                 senão estimativa: Mifflin-St Jeor (peso mais recente, altura, idade, sexo) × fator de atividade
  ingestão     = média de kcal lançadas nos dias fechados do objetivo (dias com < 800 kcal
                 lançadas são ignorados por parecerem incompletos); sem dados → meta de kcal
  déficit/dia  = gasto − ingestão
  meta_semanal = déficit × 7 / 7700   (≈ 7700 kcal por kg de gordura)

Só roda se objetivo.atual.meta_modo for "auto" (padrão). Com "manual", respeita o número digitado.
Roda sozinho à meia-noite (depois do fechamento) e o Grok roda depois de gravar um peso novo.
"""
import datetime
import json
import pathlib
import sys
import zoneinfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
DADOS = ROOT / "dados"
KCAL_POR_KG = 7700


def ler(nome):
    return json.loads((DADOS / nome).read_text(encoding="utf-8"))


def idade(nasc_ano_mes, hoje):
    ano, mes = (int(x) for x in nasc_ano_mes.split("-")[:2])
    anos = hoje.year - ano
    # sem o dia exato: conta o aniversário como feito a partir do mês seguinte
    return anos - (1 if hoje.month <= mes else 0)


def calcular(hoje=None):
    hoje = hoje or datetime.datetime.now(zoneinfo.ZoneInfo("America/Los_Angeles")).date()
    perfil = ler("perfil.json")
    obj = ler("objetivo.json")
    atual = obj["atual"]
    dias = ler("dias.json")

    pesos, ingestao = [], []
    meta_kcal = atual.get("metas", {}).get("kcal", 1570)
    for d in sorted(dias):
        p = DADOS / f"{d}.json"
        if not p.exists():
            continue
        dia = json.loads(p.read_text(encoding="utf-8"))
        if dia.get("peso_kg") is not None:
            pesos.append((d, float(dia["peso_kg"])))
        if dia.get("fechado") and d >= atual["inicio"]:
            kcal = sum(i["kcal"] for r in dia.get("lancado", []) for i in r["itens"])
            if kcal >= 800:
                ingestao.append(kcal)

    peso = pesos[-1][1] if pesos else float(atual["peso_inicial_kg"])
    anos = idade(perfil["nascimento"], hoje)
    bmr = 10 * peso + 6.25 * perfil["altura_cm"] - 5 * anos + (5 if perfil.get("sexo", "M") == "M" else -161)
    informado = atual.get("gasto_kcal")
    if isinstance(informado, (int, float)) and not isinstance(informado, bool):
        tdee, gasto_fonte = float(informado), "informado"
    else:
        tdee, gasto_fonte = bmr * perfil["atividade"], "estimado"
    if ingestao:
        comendo, fonte = sum(ingestao) / len(ingestao), f"média de {len(ingestao)} dia(s) lançado(s)"
    else:
        comendo, fonte = float(meta_kcal), "meta de kcal (ainda sem dias fechados no objetivo)"
    deficit = tdee - comendo
    semanal = max(0.0, deficit * 7 / KCAL_POR_KG)
    return obj, {
        "meta_semanal_kg": round(semanal, 2),
        "calculo": {
            "peso_ref_kg": round(peso, 1),
            "idade": anos,
            "bmr": round(bmr),
            "atividade": perfil["atividade"],
            "gasto_estimado": round(tdee),
            "gasto_fonte": gasto_fonte,
            "ingestao_media": round(comendo),
            "ingestao_fonte": fonte,
            "deficit_dia": round(deficit),
            "atualizado": hoje.isoformat(),
        },
    }


def main():
    obj, novo = calcular()
    c = novo["calculo"]
    if c["gasto_fonte"] == "informado":
        print(f"Gasto informado pelo Lucas: {c['gasto_estimado']} kcal")
    else:
        print(f"Gasto estimado {c['gasto_estimado']} kcal (BMR {c['bmr']} × {c['atividade']}, {c['idade']} anos, {c['peso_ref_kg']} kg)")
    print(f"Comendo {c['ingestao_media']} kcal ({c['ingestao_fonte']}) → déficit {c['deficit_dia']} kcal/dia")
    print(f"Meta semanal: {novo['meta_semanal_kg']} kg")
    if "--ver" in sys.argv:
        return
    atual = obj["atual"]
    if atual.get("meta_modo", "auto") != "auto":
        print("meta_modo = manual → objetivo.json não alterado")
        return
    antes = (atual.get("meta_semanal_kg"), atual.get("calculo"))
    atual.update(novo)
    atual["meta_modo"] = "auto"
    if (atual["meta_semanal_kg"], atual["calculo"]) != antes:
        (DADOS / "objetivo.json").write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("objetivo.json atualizado")


if __name__ == "__main__":
    main()
