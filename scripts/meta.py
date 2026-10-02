#!/usr/bin/env python3
"""Meta semanal de perda de peso pelo déficit calórico + diagnóstico, em dados/objetivo.json.

  python3 scripts/meta.py            # recalcula e grava (também roda dentro de scripts/derivados.py)
  python3 scripts/meta.py --ver      # só mostra a conta

Conta (só com dados até HOJE, no fuso de Los Angeles — nada de datas futuras):
  gasto (TDEE)   = objetivo.atual.gasto_kcal, se o Lucas informou (vale sempre esse);
                   senão estimativa: Mifflin-St Jeor (peso mais recente, altura, idade, sexo) × atividade
  ingestão       = média de kcal dos dias FECHADOS do objetivo com registro "completo" (confirmado);
                   com menos de 3 dias assim → usa a meta de kcal e diz por quê
  déficit/dia    = gasto − ingestão
  meta semanal   = déficit × 7 / 7700 (≈ 7700 kcal por kg de gordura)

  gasto INFERIDO pelos registros (só informativo — decisão do Lucas, 29/09; nunca substitui o gasto
  informado nem a fórmula): média de kcal dos dias completos DENTRO do intervalo das pesagens −
  tendência do peso × 7700. Janela de até 21 dias, pulando os 4 primeiros dias do objetivo (água).
  Exige ≥ 6 pesagens reais em ≥ 10 dias e ≥ 80% dos dias do intervalo com registro completo.
  Pesos estimados/interpolados NUNCA entram (só pesagens reais).

Modo "manual" (objetivo.atual.meta_modo): a meta semanal escolhida é preservada; o diagnóstico
(calculo) continua sendo atualizado, com a origem e a data.
"""
import datetime
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from comum import DADOS, arred, eh_numero, gravar_json, hoje_la, ler_json, registro_do_dia, somar  # noqa: E402

KCAL_POR_KG = 7700
MIN_DIAS = 3
JANELA, PULA, MIN_SPAN, MIN_PESOS, MIN_DIAS_INF, MIN_COBERTURA = 21, 4, 10, 6, 7, 0.8
MESES = ("jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez")


def data_curta(d):
    """2026-10-03 → '3 out' (texto que aparece no site)."""
    return f"{d.day} {MESES[d.month - 1]}"


def idade(nasc_ano_mes, hoje):
    ano, mes = (int(x) for x in nasc_ano_mes.split("-")[:2])
    # sem o dia exato: conta o aniversário como feito a partir do mês seguinte
    return hoje.year - ano - (1 if hoje.month <= mes else 0)


def carregar_dias(dados, hoje):
    """{data: dia} só até hoje (inclusive)."""
    out = {}
    for d in sorted(ler_json(pathlib.Path(dados) / "dias.json")):
        if datetime.date.fromisoformat(d) > hoje:
            continue
        p = pathlib.Path(dados) / f"{d}.json"
        if p.exists():
            out[d] = ler_json(p)
    return out


def gasto_inferido(pesos, kcal_completos, inicio):
    """pesos: [(date, kg)] reais em ordem; kcal_completos: {date: kcal} de dias fechados completos.
    Devolve (resultado | None, motivo)."""
    if not pesos:
        return None, "sem pesagens"
    fim = pesos[-1][0]
    ini = max(fim - datetime.timedelta(days=JANELA - 1), inicio + datetime.timedelta(days=PULA))
    pts = [(d, kg) for d, kg in pesos if d >= ini]
    if not pts:
        return None, f"sem pesagens a partir de {data_curta(ini)} (os {PULA} primeiros dias do objetivo não contam: água e glicogênio)"
    a = pts[0][0]
    span = (fim - a).days
    # a variação de peso de a até fim reflete o que foi comido de a até o dia anterior a fim
    dias_intervalo = [a + datetime.timedelta(days=i) for i in range(span)]
    kcal = [kcal_completos[d] for d in dias_intervalo if d in kcal_completos]
    cobertura = len(kcal) / len(dias_intervalo) if dias_intervalo else 0.0
    falta = []
    if len(pts) < MIN_PESOS:
        falta.append(f"{MIN_PESOS - len(pts)} pesagem(ns)")
    if span < MIN_SPAN:
        falta.append(f"{MIN_SPAN - span} dia(s) de intervalo entre pesagens")
    if len(kcal) < MIN_DIAS_INF:
        falta.append(f"{MIN_DIAS_INF - len(kcal)} dia(s) fechados com registro completo")
    elif cobertura < MIN_COBERTURA:
        falta.append(f"cobertura de registro completo {round(100 * cobertura)}% (precisa {round(100 * MIN_COBERTURA)}%)")
    diag = {"pesagens": len(pts), "dias_completos": len(kcal), "dias_no_intervalo": len(dias_intervalo),
            "cobertura_pct": round(100 * cobertura), "de": a.isoformat(), "ate": fim.isoformat()}
    if falta:
        return None, {"falta": "faltam " + ", ".join(falta), **diag}
    xs = [(d - a).days for d, _ in pts]
    ys = [kg for _, kg in pts]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    inclinacao = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den  # kg/dia
    valor = sum(kcal) / len(kcal) - inclinacao * KCAL_POR_KG
    if not 1200 <= valor <= 5000:
        return None, {"falta": f"resultado fora do razoável ({arred(valor)} kcal) — dados inconsistentes", **diag}
    return {"kcal": arred(valor), "kg_semana": arred(inclinacao * 7, 2), **diag}, None


def calcular(dados=DADOS, hoje=None):
    hoje = hoje or hoje_la()
    dados = pathlib.Path(dados)
    perfil = ler_json(dados / "perfil.json")
    obj = ler_json(dados / "objetivo.json")
    atual = obj["atual"]
    inicio = datetime.date.fromisoformat(atual["inicio"])
    dias = carregar_dias(dados, hoje)

    pesos, completos, fechados_obj = [], {}, 0
    for d, dia in dias.items():
        dd = datetime.date.fromisoformat(d)
        if eh_numero(dia.get("peso_kg")):
            pesos.append((dd, float(dia["peso_kg"])))
        if dia.get("fechado") and dd < hoje:
            if dd >= inicio:
                fechados_obj += 1
            if registro_do_dia(dia) == "completo":
                completos[dd] = somar(dia.get("lancado", []))["kcal"]
    meta_kcal = (atual.get("metas") or {}).get("kcal", 1570)

    peso = pesos[-1][1] if pesos else float(atual["peso_inicial_kg"])
    anos = idade(perfil["nascimento"], hoje)
    bmr = 10 * peso + 6.25 * perfil["altura_cm"] - 5 * anos + (5 if perfil.get("sexo", "M") == "M" else -161)
    formula = bmr * perfil["atividade"]
    informado = atual.get("gasto_kcal")
    if eh_numero(informado):
        tdee, gasto_fonte = float(informado), "informado"
    else:
        tdee, gasto_fonte = formula, "estimado"

    ingestao = [k for d, k in completos.items() if d >= inicio]
    if len(ingestao) >= MIN_DIAS:
        comendo = sum(ingestao) / len(ingestao)
        fonte = f"média de {len(ingestao)} dia(s) fechados com registro completo"
    else:
        comendo = float(meta_kcal)
        fonte = (f"meta de kcal — só {len(ingestao)} de {fechados_obj} dia(s) fechados do objetivo têm registro "
                 f"completo confirmado (precisa {MIN_DIAS})")
    deficit = tdee - comendo
    semanal = max(0.0, deficit * 7 / KCAL_POR_KG)
    inf, motivo = gasto_inferido(pesos, completos, inicio)
    return obj, {
        "meta_calculada_kg": arred(semanal, 2),
        "calculo": {
            "peso_ref_kg": arred(peso, 1),
            "pesagens_total": len(pesos),
            "ultima_pesagem": pesos[-1][0].isoformat() if pesos else None,
            "idade": anos,
            "bmr": arred(bmr),
            "atividade": perfil["atividade"],
            "gasto_estimado": arred(tdee),
            "gasto_fonte": gasto_fonte,
            "gasto_formula": arred(formula),
            "gasto_inferido": inf,
            "gasto_inferido_falta": motivo,
            "ingestao_media": arred(comendo),
            "ingestao_fonte": fonte,
            "dias_completos": len(ingestao),
            "dias_fechados": fechados_obj,
            "deficit_dia": arred(deficit),
            "atualizado": hoje.isoformat(),
        },
    }


def atualizar(dados=DADOS, hoje=None, silencioso=False):
    """Grava o cálculo. No modo manual, preserva meta_semanal_kg. Devolve True se mudou."""
    dados = pathlib.Path(dados)
    obj, novo = calcular(dados, hoje)
    atual = obj["atual"]
    modo = atual.get("meta_modo", "auto")
    calculo = novo["calculo"]
    calculo["meta_calculada_kg"] = novo["meta_calculada_kg"]
    if modo == "auto":
        atual["meta_semanal_kg"] = novo["meta_calculada_kg"]
        calculo["meta_origem"] = "automática (déficit)"
    else:
        calculo["meta_origem"] = "manual (escolhida pelo Lucas; o cálculo acima é só diagnóstico)"
    atual.pop("calculo", None)
    atual["calculo"] = calculo
    atual["meta_modo"] = modo
    mudou = gravar_json(dados / "objetivo.json", obj)
    if not silencioso:
        imprimir(calculo, atual["meta_semanal_kg"], modo)
        print("objetivo.json atualizado" if mudou else "objetivo.json já estava em dia")
    return mudou


def imprimir(c, meta_semanal, modo):
    inf = c["gasto_inferido"]
    if inf:
        print(f"Gasto inferido pelos registros (só informativo): {inf['kcal']} kcal "
              f"({inf['dias_completos']} dias completos, {inf['pesagens']} pesagens, {inf['de']}→{inf['ate']}, "
              f"cobertura {inf['cobertura_pct']}%, peso {inf['kg_semana']:+} kg/sem)")
    else:
        m = c["gasto_inferido_falta"]
        print(f"Gasto inferido: ainda não ({m['falta'] if isinstance(m, dict) else m})")
    if c["gasto_fonte"] == "informado":
        print(f"Gasto informado pelo Lucas: {c['gasto_estimado']} kcal")
    else:
        print(f"Gasto estimado {c['gasto_estimado']} kcal (BMR {c['bmr']} × {c['atividade']}, {c['idade']} anos, {c['peso_ref_kg']} kg)")
    print(f"Comendo {c['ingestao_media']} kcal ({c['ingestao_fonte']}) → déficit {c['deficit_dia']} kcal/dia")
    print(f"Meta semanal: {meta_semanal} kg ({'manual' if modo != 'auto' else 'automática'}; calculada {c['meta_calculada_kg']} kg)")


def main():
    if "--ver" in sys.argv:
        obj, novo = calcular()
        imprimir({**novo["calculo"], "meta_calculada_kg": novo["meta_calculada_kg"]},
                 obj["atual"].get("meta_semanal_kg"), obj["atual"].get("meta_modo", "auto"))
        return
    atualizar()


if __name__ == "__main__":
    main()
