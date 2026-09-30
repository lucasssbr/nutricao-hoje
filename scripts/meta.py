#!/usr/bin/env python3
"""Calcula a meta semanal de perda de peso pelo déficit calórico e grava em dados/objetivo.json.

  python3 scripts/meta.py            # recalcula e grava
  python3 scripts/meta.py --ver      # só mostra a conta

Conta:
  gasto (TDEE) = objetivo.atual.gasto_kcal, se o Lucas informou (vale sempre esse);
                 senão estimativa: Mifflin-St Jeor (peso, altura, idade, sexo) × fator de atividade
  gasto real   = só INFORMATIVO (decisão do Lucas, 29/09): média de kcal lançadas − tendência do
                 peso × 7700. Vai para calculo.gasto_real e aparece no card, mas NÃO entra na meta.
  ingestão     = média de kcal lançadas nos dias fechados do objetivo (dias com < 800 kcal
                 lançadas são ignorados por parecerem incompletos); com menos de 3 dias → meta de kcal
                 (um dia só distorce muito a média)
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
MIN_DIAS = 3  # dias fechados mínimos para usar a média real de ingestão
# gasto real: janela de até 21 dias, pulando os 4 primeiros dias do objetivo (água/glicogênio)
REAL_JANELA, REAL_PULA, REAL_MIN_SPAN, REAL_MIN_PESOS, REAL_MIN_DIAS = 21, 4, 10, 6, 7


def gasto_real(pesos, ingestao_por_dia, inicio):
    """Gasto calórico real (kcal/dia) pelos dados, ou (None, motivo)."""
    if not pesos:
        return None, "sem pesos"
    fim = datetime.date.fromisoformat(pesos[-1][0])
    ini = max(fim - datetime.timedelta(days=REAL_JANELA - 1),
              datetime.date.fromisoformat(inicio) + datetime.timedelta(days=REAL_PULA))
    pts = [(datetime.date.fromisoformat(d), kg) for d, kg in pesos if datetime.date.fromisoformat(d) >= ini]
    kcal = [k for d, k in ingestao_por_dia.items() if ini <= datetime.date.fromisoformat(d) <= fim]
    span = (pts[-1][0] - pts[0][0]).days if len(pts) > 1 else 0
    if len(pts) < REAL_MIN_PESOS or span < REAL_MIN_SPAN or len(kcal) < REAL_MIN_DIAS:
        falta = []
        if len(pts) < REAL_MIN_PESOS:
            falta.append(f"{REAL_MIN_PESOS - len(pts)} peso(s)")
        if span < REAL_MIN_SPAN:
            falta.append(f"{REAL_MIN_SPAN - span} dia(s) de intervalo")
        if len(kcal) < REAL_MIN_DIAS:
            falta.append(f"{REAL_MIN_DIAS - len(kcal)} dia(s) lançados")
        return None, "faltam " + ", ".join(falta)
    xs = [(d - pts[0][0]).days for d, _ in pts]
    ys = [kg for _, kg in pts]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    inclinacao = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den  # kg/dia
    real = sum(kcal) / len(kcal) - inclinacao * KCAL_POR_KG
    if not 1200 <= real <= 5000:
        return None, f"resultado fora do razoável ({round(real)} kcal) — dados inconsistentes"
    return {"kcal": round(real), "dias": len(kcal), "pesos": len(pts),
            "de": ini.isoformat(), "ate": fim.isoformat(), "kg_semana": round(inclinacao * 7, 2)}, None


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

    pesos, ingestao, por_dia = [], [], {}
    meta_kcal = atual.get("metas", {}).get("kcal", 1570)
    for d in sorted(dias):
        p = DADOS / f"{d}.json"
        if not p.exists():
            continue
        dia = json.loads(p.read_text(encoding="utf-8"))
        if dia.get("peso_kg") is not None:
            pesos.append((d, float(dia["peso_kg"])))
        if dia.get("fechado"):
            kcal = sum(i["kcal"] for r in dia.get("lancado", []) for i in r["itens"])
            if kcal >= 800:
                por_dia[d] = kcal
                if d >= atual["inicio"]:
                    ingestao.append(kcal)

    peso = pesos[-1][1] if pesos else float(atual["peso_inicial_kg"])
    anos = idade(perfil["nascimento"], hoje)
    bmr = 10 * peso + 6.25 * perfil["altura_cm"] - 5 * anos + (5 if perfil.get("sexo", "M") == "M" else -161)
    informado = atual.get("gasto_kcal")
    real, sem_real = gasto_real(pesos, por_dia, atual["inicio"])
    formula = bmr * perfil["atividade"]
    if isinstance(informado, (int, float)) and not isinstance(informado, bool):
        tdee, gasto_fonte = float(informado), "informado"
    else:
        tdee, gasto_fonte = formula, "estimado"
    if len(ingestao) >= MIN_DIAS:
        comendo, fonte = sum(ingestao) / len(ingestao), f"média de {len(ingestao)} dias lançados"
    else:
        comendo, fonte = float(meta_kcal), f"meta de kcal (menos de {MIN_DIAS} dias fechados no objetivo)"
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
            "gasto_formula": round(formula),
            "gasto_real": real,
            "gasto_real_falta": sem_real,
            "ingestao_media": round(comendo),
            "ingestao_fonte": fonte,
            "deficit_dia": round(deficit),
            "atualizado": hoje.isoformat(),
        },
    }


def main():
    obj, novo = calcular()
    c = novo["calculo"]
    if c["gasto_real"]:
        r = c["gasto_real"]
        print(f"Gasto real pelos dados: {r['kcal']} kcal ({r['dias']} dias lançados, {r['pesos']} pesos, {r['de']}→{r['ate']}, peso {r['kg_semana']:+} kg/sem)")
    else:
        print(f"Gasto real: ainda não ({c['gasto_real_falta']})")
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
