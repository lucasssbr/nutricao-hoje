#!/usr/bin/env python3
"""Sugestão automática do dia a partir do que o Lucas REALMENTE comeu nos últimos dias.

  python3 scripts/sugerir.py                    # mostra a sugestão do dia aberto (sem gravar)
  python3 scripts/sugerir.py --dia 2026-10-02   # mostra para outro dia
  python3 scripts/sugerir.py --gravar           # grava em dados/<dia>.json (sugestao + sugestao_nota)

Como funciona (determinístico, sem dependências):
1. Histórico: refeições LANÇADAS nos últimos `janela_dias` antes do dia (dados/<dia>.json → lancado).
   Cada refeição vira um horário-padrão (Café / Almoço / Lanche / Jantar) pelo nome ou pela hora.
2. Refeições do dia: os horários que aparecem em pelo menos ~1/3 dos dias do histórico.
   Se o dia já tem lançamentos, só planeja os horários DEPOIS do último lançado ("Pra fechar o dia").
3. Alimentos de cada horário: os que ele comeu naquele horário + `incluir` de dados/refeicoes.json
   (alimento novo que ele pediu para recomendar, ex.: peito de frango).
4. Quantidades: busca local que aproxima o TOTAL DO DIA (lançado + sugerido) da meta — proteína no
   mínimo a meta, gordura no máximo a meta, kcal e carboidrato perto — preferindo porções parecidas
   com as que ele costuma comer. Respeita `plano_ate_g` (ex.: acém 200 g) e `max_dia` como teto de
   PLANEJAMENTO (nunca limite do que ele come) e claras só no jantar.
5. Sem histórico suficiente → plano padrão (dados/refeicoes.json), como antes.
Macros sempre pela biblioteca (item.montar_item). Sugestão nunca conta como consumo.
"""
import argparse
import datetime
import math
import statistics
import sys
import unicodedata

from comum import DADOS, MACROS, arred, hoje_la, ler_json
from item import montar_item, montar_plano, base_de

HORARIOS = ["Café", "Almoço", "Lanche", "Jantar"]
PADRAO = {"janela_dias": 14, "min_dias": 2, "incluir": {}, "max_dia": {}, "so_jantar": ["clara-100g", "clara-un"]}


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return s


def horario(ref):
    """Horário-padrão de uma refeição lançada: pelo nome; senão pela hora de consumo; senão None."""
    n = _norm(ref.get("refeicao"))
    for chave, h in (("cafe", "Café"), ("almoc", "Almoço"), ("jantar", "Jantar"), ("ceia", "Jantar"),
                     ("lanche", "Lanche"), ("doce", "Lanche")):
        if chave in n:
            return h
    c = ref.get("consumido_em") or ""
    if len(c) >= 16 and c[13] == ":":
        hh = int(c[11:13])
        return "Café" if hh < 11 else "Almoço" if hh < 15 else "Lanche" if hh < 19 else "Jantar"
    return None


def config(refs):
    cfg = dict(PADRAO)
    cfg.update(refs.get("sugestao_auto") or {})
    return cfg


def historico(dia, janela, dados=DADOS):
    """[(data, [refeições lançadas])] dos `janela` dias antes de `dia` que têm itens com alimento."""
    dias = ler_json(dados / "dias.json")
    ini = (datetime.date.fromisoformat(dia) - datetime.timedelta(days=janela)).isoformat()
    out = []
    for d in sorted(dias):
        if not (ini <= d < dia):
            continue
        p = dados / f"{d}.json"
        if not p.exists():
            continue
        lanc = [r for r in ler_json(p).get("lancado", []) if any(i.get("alimento") for i in r.get("itens", []))]
        if lanc:
            out.append((d, lanc))
    return out


def perfil(hist, alimentos):
    """Por horário: dias em que apareceu, e por alimento as porções (somadas por refeição)."""
    dias_h = {h: set() for h in HORARIOS}
    porcoes = {}      # (horario, alimento) -> [qtd]
    dias_ha = {}      # (horario, alimento) -> set(dias)
    globais = {}      # alimento -> [qtd]
    vistos = {}       # alimento -> set(dias)
    sem_horario = {}  # alimento -> [qtd] de refeições sem horário reconhecível
    for d, lanc in hist:
        for r in lanc:
            h = horario(r)
            soma = {}
            for i in r.get("itens", []):
                aid = i.get("alimento")
                if aid in alimentos and isinstance(i.get("quantidade"), (int, float)):
                    soma[aid] = soma.get(aid, 0) + i["quantidade"]
            for aid, q in soma.items():
                globais.setdefault(aid, []).append(q)
                vistos.setdefault(aid, set()).add(d)
                if h:
                    porcoes.setdefault((h, aid), []).append(q)
                    dias_ha.setdefault((h, aid), set()).add(d)
                else:
                    sem_horario.setdefault(aid, []).append(q)
            if h and soma:
                dias_h[h].add(d)
    return dias_h, porcoes, globais, dias_ha


def grade(al, tipico, teto):
    """Quantidades possíveis de um alimento numa refeição (0 = não incluir).

    teto = quanto ainda cabe no PLANEJAMENTO do dia (None = sem teto). Pode ser fracionário (3.0, 2.5): em
    unidades (lata/un) a sugestão é sempre inteira e fica no máximo no inteiro abaixo do teto (2.5 → 2)."""
    unidade, _ = base_de(al)
    if teto is not None and teto <= 1e-9:
        return [0]
    if unidade == "un":
        hi = max(1, int(round(max(tipico * 1.5, tipico + 1))))
        if teto is not None:
            hi = min(hi, int(math.floor(teto + 1e-9)))
        return list(range(0, hi + 1))
    passo = 10 if tipico <= 300 else 25
    hi = max(passo, max(tipico * 1.5, tipico + 100))
    if teto is not None:
        hi = min(hi, teto)
    hi = int(hi // passo * passo)
    lo = max(passo, int(tipico * 0.5 // passo * passo))   # nada de "30 g de acém": no mínimo ~metade da porção
    if hi < lo:
        return [0]
    return [0] + list(range(lo, hi + 1, passo))


def macros(al, q):
    unidade, n = base_de(al)
    f = q / n
    return [al[k] * f for k in MACROS]


def custo(tot, meta, por_horario, escolha, tipicos, freq):
    kcal, p, c, g = tot
    f = ((kcal - meta["kcal"]) / 40) ** 2
    f += 6 * (max(0.0, meta["p"] - p) / 5) ** 2          # proteína abaixo pesa muito
    f += 0.3 * (max(0.0, p - meta["p"] - 15) / 10) ** 2   # muito acima: leve
    f += 6 * (max(0.0, g - meta["g"]) / 5) ** 2           # gordura acima pesa muito
    f += ((c - meta["c"]) / 10) ** 2
    for h, ph in por_horario.items():                      # proteína distribuída
        if h != "Lanche":
            f += 0.5 * (max(0.0, 30 - ph) / 10) ** 2
        f += 0.5 * (max(0.0, ph - 70) / 10) ** 2          # nem tudo numa refeição só (regra: ~40–55 g)
    for chave, q in escolha.items():
        fr = freq[chave]       # em quantos dos dias daquela refeição ele comeu isso
        if q:
            t = tipicos[chave]
            f += 0.4 * ((q - t) / t) ** 2 + 0.8 * (1 - fr)   # porção habitual; alimento pouco habitual custa
        else:
            f += 0.8 * fr                                      # deixar de fora o que ele sempre come custa
    return f


def tetos_do_dia(alimentos, cfg):
    """Teto de PLANEJAMENTO por alimento no dia (max_dia; senão plano_ate_g). Nunca limita o que é registrado."""
    tetos = {a: float(v) for a, v in (cfg.get("max_dia") or {}).items()}
    for aid, al in alimentos.items():
        if al.get("plano_ate_g") and aid not in tetos:
            tetos[aid] = float(al["plano_ate_g"])
    return tetos


def consumo_por_alimento(lancado):
    q = {}
    for r in lancado:
        for i in r.get("itens", []):
            if i.get("alimento") and isinstance(i.get("quantidade"), (int, float)):
                q[i["alimento"]] = q.get(i["alimento"], 0) + i["quantidade"]
    return q


def otimizar(variaveis, alimentos, meta, base_tot, tetos):
    """Busca local determinística. variaveis: [(horario, alimento, tipico, grade, freq)].
    tetos = o que AINDA cabe na sugestão por alimento (teto do dia menos o já consumido)."""
    tipicos = {(h, a): t for h, a, t, _, _ in variaveis}
    freq = {(h, a): fr for h, a, _, _, fr in variaveis}

    def avaliar(esc):
        tot = list(base_tot)
        ph = {}
        por_alimento = {}
        for (h, aid), q in esc.items():
            if not q:
                continue
            m = macros(alimentos[aid], q)
            tot = [x + y for x, y in zip(tot, m)]
            ph[h] = ph.get(h, 0) + m[1]
            por_alimento[aid] = por_alimento.get(aid, 0) + q
        for h, _, _, _, _ in variaveis:
            ph.setdefault(h, 0)
        if any(q > tetos[a] + 1e-9 for a, q in por_alimento.items() if a in tetos):
            return float("inf"), tot
        return custo(tot, meta, ph, esc, tipicos, freq), tot

    def descer(esc):
        melhor, _ = avaliar(esc)
        for _ in range(30):
            mudou = False
            for h, aid, _, gr, _ in variaveis:
                atual = esc[(h, aid)]
                for q in gr:
                    if q == atual:
                        continue
                    esc[(h, aid)] = q
                    v, _ = avaliar(esc)
                    if v < melhor - 1e-9:
                        melhor, atual, mudou = v, q, True
                    else:
                        esc[(h, aid)] = atual
                esc[(h, aid)] = atual
            if not mudou:
                break
        return melhor, esc

    def mais_perto(gr, t):
        return min(gr, key=lambda q: (abs(q - t), q))

    partidas = [
        {(h, a): mais_perto(gr, t) for h, a, t, gr, _ in variaveis},
        {(h, a): (mais_perto(gr, t) if fr >= 0.5 else 0) for h, a, t, gr, fr in variaveis},
        {(h, a): 0 for h, a, _, _, _ in variaveis},
    ]
    resultados = [descer(dict(p)) for p in partidas]
    return min(resultados, key=lambda r: r[0])[1]


def sugerir(dia, dados_dia=None, dados=DADOS):
    """Devolve (sugestao, nota). sugestao = lista de refeições no formato do JSON do dia."""
    alimentos = {k: v for k, v in ler_json(dados / "alimentos.json").items() if not k.startswith("_")}
    refs = ler_json(dados / "refeicoes.json")
    cfg = config(refs)
    dados_dia = dados_dia if dados_dia is not None else (
        ler_json(dados / f"{dia}.json") if (dados / f"{dia}.json").exists() else {})
    meta = dados_dia.get("meta") or {"kcal": 1570, "p": 180, "c": 100, "g": 50}
    lancado = dados_dia.get("lancado", [])

    hist = historico(dia, int(cfg["janela_dias"]), dados)
    if len(hist) < int(cfg["min_dias"]):
        if lancado:
            return [], "Sem histórico suficiente para sugerir o restante"
        return montar_plano(alimentos, refs), refs.get("plano_padrao_nota", "Plano padrão automático")

    dias_h, porcoes, globais, dias_ha = perfil(hist, alimentos)
    # só conta como histórico UTILIZÁVEL o dia com ao menos uma refeição de horário identificável (nome ou
    # hora). Ex.: "Refeição 1/2" sem consumido_em não diz quando ele come → mesmo caminho de "sem histórico"
    # (plano padrão), em vez de confundir com "dia completo". Registros antigos não são alterados.
    uteis = set().union(*dias_h.values())
    if len(uteis) < int(cfg["min_dias"]):
        if lancado:
            return [], "Sem histórico com horário das refeições para sugerir o restante"
        return montar_plano(alimentos, refs), refs.get("plano_padrao_nota", "Plano padrão automático")
    n_dias = len(uteis)
    horarios = [h for h in HORARIOS if len(dias_h[h]) >= max(1, n_dias / 3)]
    # histórico disperso (ex.: só Café num dia, só Almoço no outro…): nenhum horário frequente o bastante.
    # É histórico insuficiente — decidido ANTES de tirar os horários já comidos, para não virar "Dia completo"
    if not horarios:
        if lancado:
            return [], "Histórico sem horários frequentes para sugerir o restante"
        return montar_plano(alimentos, refs), refs.get("plano_padrao_nota", "Plano padrão automático")
    # já lançado hoje: planeja só os horários depois do último lançado
    if lancado:
        feitos = [HORARIOS.index(h) for h in (horario(r) for r in lancado) if h]
        ultimo = max(feitos) if feitos else -1
        horarios = [h for h in horarios if HORARIOS.index(h) > ultimo]
    if not horarios:
        return [], "Dia completo — sem refeições a sugerir"

    # teto de planejamento MENOS o que já foi comido hoje (comeu 3 Nurri no almoço → nenhuma a mais na sugestão)
    comido = consumo_por_alimento(lancado)
    restante = {a: max(0.0, t - comido.get(a, 0)) for a, t in tetos_do_dia(alimentos, cfg).items()}
    variaveis = []
    so_jantar = set(cfg.get("so_jantar") or [])
    for h in horarios:
        cands = sorted({a for (hh, a) in porcoes if hh == h})
        for aid, hs in sorted((cfg.get("incluir") or {}).items()):
            if aid in alimentos and h in hs and aid not in cands:
                cands.append(aid)
        for aid in cands:
            if aid in so_jantar and h != "Jantar":
                continue
            qs = porcoes.get((h, aid)) or globais.get(aid)
            if qs:
                tipico = statistics.median(qs)
            else:   # alimento novo (incluir): porção de ~1 base ou 150 g
                unidade, n = base_de(alimentos[aid])
                tipico = 1 if unidade == "un" else 150
            teto = restante.get(aid)
            # frequência NAQUELA refeição; alimento pedido (incluir) sem histórico ali: neutro
            freq = len(dias_ha[(h, aid)]) / len(dias_h[h]) if (h, aid) in dias_ha else 0.5
            variaveis.append((h, aid, tipico, grade(alimentos[aid], tipico, teto), freq))

    base_tot = [sum(i.get(k, 0) for r in lancado for i in r.get("itens", [])) for k in MACROS]
    esc = otimizar(variaveis, alimentos, meta, base_tot, restante)

    sugestao = []
    for h in horarios:
        itens = [montar_item(alimentos, aid, str(esc[(hh, aid)])) for hh, aid, _, _, _ in variaveis
                 if hh == h and esc[(hh, aid)]]
        if itens:
            sugestao.append({"refeicao": h, "itens": itens})
    nota = (f"Sugestão automática · alimentos que você comeu nos últimos {n_dias} dias"
            + (f" + {', '.join(alimentos[a]['nome'] for a in sorted(cfg.get('incluir') or {}) if a in alimentos)}"
               if cfg.get("incluir") else "")
            + (" · refaz o restante do dia a cada refeição lançada" if lancado else ""))
    return sugestao, nota


def total_txt(dados_dia, sugestao):
    t = [sum(i.get(k, 0) for r in (dados_dia.get("lancado", []) + sugestao) for i in r["itens"]) for k in MACROS]
    return f"Dia (lançado + sugestão): {arred(t[0])} kcal | P {arred(t[1])} | C {arred(t[2])} | G {arred(t[3])}"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dia", help="YYYY-MM-DD (padrão: hoje em Los Angeles)")
    ap.add_argument("--gravar", action="store_true", help="grava sugestao/sugestao_nota no JSON do dia")
    a = ap.parse_args(argv)
    if a.gravar:
        from comum import trava_escrita
        with trava_escrita():   # ler → gravar o dia sem outro escritor no meio
            return _main(a)
    return _main(a)


def _main(a):
    dia = a.dia or hoje_la().isoformat()
    p = DADOS / f"{dia}.json"
    dados_dia = ler_json(p) if p.exists() else {}
    if dados_dia.get("fechado"):
        print(f"RECUSADO: {dia} está fechado — sugestão não muda dia fechado", file=sys.stderr)
        return 2
    sugestao, nota = sugerir(dia, dados_dia)
    for r in sugestao:
        print(f"{r['refeicao']}: " + ", ".join(f"{i['nome']} {i['qtd']}" for i in r["itens"]))
    print(total_txt(dados_dia, sugestao))
    print(f"nota: {nota}")
    if a.gravar:
        if not p.exists():
            print(f"RECUSADO: não existe dados/{dia}.json (dias só são criados pelo fechamento)", file=sys.stderr)
            return 2
        from comum import agora_la, gravar_json
        dados_dia["sugestao"] = sugestao
        dados_dia["sugestao_nota"] = nota
        dados_dia["atualizado"] = agora_la().isoformat(timespec="seconds")
        gravar_json(p, dados_dia)
        print(f"gravado: dados/{dia}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
