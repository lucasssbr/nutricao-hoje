#!/usr/bin/env python3
"""Registro seguro para o Grok: refeição, peso, remoção/correção e completude do dia.

Cada OPERAÇÃO exige --evento com id estável e próprio: <id da mensagem>:<tipo>:<n>, ex.:
msg-123:refeicao:1, msg-123:peso:1 (uma mensagem com refeição e peso = dois eventos). Repetir o MESMO
evento com o mesmo conteúdo (retry, mensagem reenviada) não lança nada duas vezes ("já registrado").
Reusar o id com outro tipo ou outro conteúdo é RECUSADO (nunca vira sucesso silencioso).

  # refeição (unidade explícita em cada item: g, un ou lata)
  python3 scripts/registrar.py refeicao --evento msg-123 --nome Almoço --consumido-em 2026-09-30T12:40 \\
      --item chuck-costco=200g --item batata-inglesa=150g
  python3 scripts/registrar.py refeicao --evento msg-124 --favorita cafe-padrao --consumido-em 2026-09-30T08:10
  # peso (kg) de um dia
  python3 scripts/registrar.py peso --evento msg-125 --data 2026-09-30 --kg 88.4
  # tirar uma refeição lançada por engano (pelo id do evento que a lançou)
  python3 scripts/registrar.py remover --evento msg-126 --data 2026-09-30 --alvo msg-123 --justificativa "lançada 2x"
  # o Lucas confirmou que registrou tudo do dia (ou só parte)
  python3 scripts/registrar.py completo --evento msg-127 --data 2026-09-30 --status completo

Opções comuns:
  --dry-run        mostra o que mudaria (diff) e o recibo, sem gravar nada
  --justificativa  obrigatória para mexer em dia FECHADO (fica em "correcoes" do dia)
  --enviar         faz o ciclo git completo: sincroniza com o GitHub, aplica, gera derivados, valida,
                   commit e push; se alguém enviar no meio, busca de novo e reaplica (sem duplicar).

Sempre: grava de forma atômica, regenera os derivados (resumo/objetivo), roda a validação e, se algo
falhar, desfaz tudo. Horário do consumo (consumido_em) ≠ horário do registro (registrado_em). Sugestão
nunca vira consumo sozinha: só o que for passado aqui entra em "lancado".
"""
import argparse
import datetime
import difflib
import hashlib
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from comum import (DADOS, MACROS, ROOT, agora_la, arred, carimbo, data_de_consumo, data_valida,  # noqa: E402
                   eh_numero, gravar_json, ler_json, registro_do_dia, somar, texto_json)
from item import carregar_alimentos, carregar_refeicoes, montar_item, montar_refeicao  # noqa: E402
import re  # noqa: E402

TIPOS = ("refeicao", "peso", "remover", "completo")


class Recusa(Exception):
    """Pedido inválido: nada foi gravado."""


# ---------------- eventos ----------------

def eventos_de(dia):
    return {e.get("id_evento") for e in dia.get("eventos", []) if isinstance(e, dict)}


def achar_evento(ev, dados):
    """Procura o id em todos os dias (retry com data diferente também não duplica). Devolve (data, registro)."""
    for d in ler_json(dados / "dias.json"):
        p = dados / f"{d}.json"
        if not p.exists():
            continue
        for e in ler_json(p).get("eventos", []):
            if isinstance(e, dict) and e.get("id_evento") == ev:
                return d, e
    return None, None


def assinatura(conteudo):
    """Impressão digital do conteúdo normalizado da operação (tipo + dados que definem o efeito)."""
    return hashlib.sha256(json.dumps(conteudo, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


SUFIXO = re.compile(r".+:(refeicao|peso|remover|completo):\d+")


def conferir_reuso(ev, tipo, assin, achado):
    """Mesmo id: retry idêntico → ok (repetido); outro tipo/conteúdo → Recusa. Eventos antigos sem assinatura
    (anteriores a esta regra) valem pelo tipo, por compatibilidade."""
    d, reg = achado
    if reg.get("tipo") != tipo:
        raise Recusa(f"o evento {ev!r} já foi usado para '{reg.get('tipo')}' em {d}; cada operação precisa de id "
                     f"próprio (ex.: <mensagem>:{tipo}:1)")
    if reg.get("assinatura") and reg["assinatura"] != assin:
        raise Recusa(f"o evento {ev!r} já foi registrado em {d} com conteúdo DIFERENTE; se é outra operação, use "
                     f"outro id (ex.: <mensagem>:{tipo}:2); se é correção, use 'remover' + novo lançamento")
    return f"Evento {ev} já registrado em {d} — nada foi lançado de novo." + \
        ("" if reg.get("assinatura") else " (evento antigo, sem assinatura: conteúdo não conferido)")


def anotar(dia, ev, tipo, agora, resumo, justificativa=None, assin=None):
    dia.setdefault("eventos", []).append({"id_evento": ev, "tipo": tipo, "em": agora, "resumo": resumo,
                                          **({"assinatura": assin} if assin else {})})
    # confirmar completude não altera dados; os outros tipos em dia fechado são correções
    if dia.get("fechado") and tipo != "completo":
        if not (justificativa and justificativa.strip()):
            raise Recusa(f"o dia {dia['data']} está FECHADO: para mexer nele, passe --justificativa \"motivo\"")
        dia.setdefault("correcoes", []).append({"id_evento": ev, "tipo": tipo, "em": agora,
                                                "justificativa": justificativa.strip()})
    dia["atualizado"] = agora


# ---------------- comandos ----------------

def instante(carimbo_iso):
    return datetime.datetime.fromisoformat(carimbo_iso.replace("Z", "+00:00")).astimezone(datetime.timezone.utc)


def no_futuro(consumido, agora):
    return instante(consumido) > instante(agora)


def horario_ambiguo(texto):
    """Horário SEM fuso que cai na hora repetida (fim do horário de verão) ou inexistente (início) em LA."""
    try:
        dt = datetime.datetime.fromisoformat(texto)
    except (TypeError, ValueError):
        return False
    if dt.tzinfo is not None:
        return False
    from comum import TZ
    return dt.replace(tzinfo=TZ, fold=0).utcoffset() != dt.replace(tzinfo=TZ, fold=1).utcoffset()


def item_explicito(alimentos, texto):
    m = re.fullmatch(r"\s*([^=\s]+)\s*=\s*(\d+(?:[.,]\d+)?)\s*(g|un|lata)\s*", texto)
    if not m:
        raise Recusa(f"item {texto!r}: use id=quantidade com unidade explícita (ex.: chuck-costco=200g, ovo-inteiro=2un, nurri-vanilla=1lata)")
    try:
        return montar_item(alimentos, m.group(1), m.group(2) + m.group(3))
    except SystemExit as e:
        raise Recusa(str(e))


def cmd_refeicao(a, dados, agora):
    if not a.consumido_em:
        raise Recusa("--consumido-em é obrigatório (hora em que o Lucas comeu, fuso de Los Angeles)")
    if horario_ambiguo(a.consumido_em):
        raise Recusa(f"--consumido-em {a.consumido_em!r} cai na troca de horário de Los Angeles (hora repetida ou "
                     f"inexistente): passe com o fuso, ex.: {a.consumido_em}-07:00 (antes da troca) ou -08:00 (depois)")
    try:
        data, consumido = data_de_consumo(a.consumido_em)
    except ValueError:
        raise Recusa(f"--consumido-em inválido: {a.consumido_em!r} (use AAAA-MM-DDTHH:MM)")
    if no_futuro(consumido, agora):   # compara INSTANTES (UTC), não texto — hora repetida do fim do horário de verão
        raise Recusa(f"--consumido-em {consumido} está no futuro (agora é {agora})")
    alimentos = carregar_alimentos()
    if a.favorita:
        try:
            ref = montar_refeicao(alimentos, carregar_refeicoes(), a.favorita)
        except SystemExit as e:
            raise Recusa(str(e))
        itens, nome = ref["itens"], a.nome or ref["refeicao"]
    else:
        if not a.item:
            raise Recusa("passe --item id=quantidade (um ou mais) ou --favorita")
        itens, nome = [item_explicito(alimentos, t) for t in a.item], a.nome
        if not nome:
            raise Recusa("--nome é obrigatório (ex.: Almoço)")
    refeicao = {"refeicao": nome, "id_evento": a.evento, "consumido_em": consumido, "registrado_em": agora,
                "itens": itens}
    if a.favorita:
        refeicao["favorita"] = a.favorita

    def aplicar(dia):
        dia.setdefault("lancado", []).append(refeicao)
        if a.remover_sugestao:
            sug = dia.get("sugestao", [])
            for i, r in enumerate(sug):
                if r.get("refeicao", "").lower() == a.remover_sugestao.lower():
                    del sug[i]
                    break
        t = somar([refeicao])
        return (f"{nome}: {arred(t['kcal'])} kcal | P {arred(t['p'])} | C {arred(t['c'])} | G {arred(t['g'])}"
                f" ({len(itens)} item(ns))")
    conteudo = {"tipo": "refeicao", "nome": nome.strip().lower(), "favorita": a.favorita,
                "itens": [[it.get("alimento"), it.get("quantidade")] for it in itens],
                "consumido_utc": instante(consumido).isoformat(),
                "remover_sugestao": (a.remover_sugestao or "").strip().lower() or None}
    return data.isoformat(), aplicar, conteudo


def cmd_peso(a, dados, agora):
    if not (a.data and data_valida(a.data)):
        raise Recusa("--data AAAA-MM-DD obrigatória (e precisa existir)")
    if a.data > agora[:10]:
        raise Recusa(f"--data {a.data} está no futuro")
    try:
        kg = float(str(a.kg).replace(",", "."))
    except (TypeError, ValueError):
        raise Recusa(f"--kg inválido: {a.kg!r}")
    if not (eh_numero(kg) and 20 <= kg <= 400):
        raise Recusa(f"--kg precisa ser número entre 20 e 400 (veio {a.kg!r})")

    def aplicar(dia):
        antes = dia.get("peso_kg")
        dia["peso_kg"] = arred(kg, 1)
        return f"peso {arred(kg, 1)} kg" + (f" (antes {antes} kg)" if antes is not None else "")
    return a.data, aplicar, {"tipo": "peso", "data": a.data, "kg": arred(kg, 1)}


def cmd_remover(a, dados, agora):
    if not (a.data and data_valida(a.data)):
        raise Recusa("--data AAAA-MM-DD obrigatória")
    if not a.alvo:
        raise Recusa("--alvo <id_evento da refeição a remover> obrigatório")
    if not (a.justificativa and a.justificativa.strip()):
        raise Recusa("--justificativa obrigatória para remover uma refeição")

    def aplicar(dia):
        lanc = dia.get("lancado", [])
        idx = [i for i, r in enumerate(lanc) if r.get("id_evento") == a.alvo]
        if not idx:
            raise Recusa(f"nenhuma refeição com id_evento {a.alvo!r} em {a.data}")
        r = lanc.pop(idx[0])
        t = somar([r])
        dia.setdefault("correcoes", [])
        if not dia.get("fechado"):   # em dia aberto a remoção também fica rastreada
            dia["correcoes"].append({"id_evento": a.evento, "tipo": "remover", "em": agora,
                                     "justificativa": a.justificativa.strip()})
        return f"removida '{r.get('refeicao')}' ({arred(t['kcal'])} kcal) lançada por {a.alvo}"
    return a.data, aplicar, {"tipo": "remover", "data": a.data, "alvo": a.alvo}


def cmd_completo(a, dados, agora):
    if not (a.data and data_valida(a.data)):
        raise Recusa("--data AAAA-MM-DD obrigatória")
    if a.data > agora[:10]:
        raise Recusa(f"--data {a.data} está no futuro")
    if a.status not in ("completo", "parcial"):
        raise Recusa("--status completo|parcial")

    def aplicar(dia):
        dia["registro"] = {"status": a.status, "em": agora, **({"obs": a.obs} if a.obs else {})}
        return f"registro do dia: {a.status}"
    return a.data, aplicar, {"tipo": "completo", "data": a.data, "status": a.status}


COMANDOS = {"refeicao": cmd_refeicao, "peso": cmd_peso, "remover": cmd_remover, "completo": cmd_completo}


# ---------------- aplicar + validar + recibo ----------------

def recibo(dia, resumo_evento, agora):
    t = somar(dia.get("lancado", []))
    m = dia.get("meta", {})
    linhas = [f"📅 {dia['data']}" + (" (FECHADO — correção registrada)" if dia.get("fechado") else ""),
              f"✔ {resumo_evento}",
              f"Consumido: {arred(t['kcal'])} kcal | P {arred(t['p'])} | C {arred(t['c'])} | G {arred(t['g'])}",
              f"Meta:      {m.get('kcal')} kcal | P {m.get('p')} | C {m.get('c')} | G {m.get('g')}"]
    rest = {k: (m.get(k) or 0) - t[k] for k in MACROS}
    linhas.append("Restante:  " + " | ".join(f"{k.upper() if k != 'kcal' else 'kcal'} {arred(v)}" for k, v in rest.items()))
    passou = [f"{'kcal' if k == 'kcal' else k.upper()} +{arred(-v)}" for k, v in rest.items() if k != "p" and arred(v) < 0]
    if passou:
        linhas.append("Passou da meta: " + " · ".join(passou))
    pend = []
    reg = registro_do_dia(dia)
    if reg != "completo":
        pend.append(f"registro do dia: {reg} — quando o Lucas confirmar que lançou tudo: registrar.py completo")
    if dia.get("peso_kg") is None:
        pend.append("sem pesagem neste dia (opcional)")
    linhas.append("Pendências: " + ("; ".join(pend) if pend else "nenhuma"))
    return "\n".join(linhas)


def aplicar_evento(a, dados=DADOS, raiz=ROOT, agora=None):
    """Aplica 1 evento. Devolve (status, texto, data). status: 'ok' | 'repetido' | 'dry-run'."""
    agora = agora or carimbo()
    if not a.evento or not re.fullmatch(r"[A-Za-z0-9._:\-]{3,80}", a.evento):
        raise Recusa("--evento obrigatório: id estável de 3–80 caracteres (letras, números, . _ : -)")
    m = SUFIXO.fullmatch(a.evento)
    if m and m.group(1) != a.cmd:
        raise Recusa(f"o id {a.evento!r} diz '{m.group(1)}', mas o comando é '{a.cmd}'")
    data, aplicar, conteudo = COMANDOS[a.cmd](a, dados, agora)
    assin = assinatura(conteudo)
    achado = achar_evento(a.evento, dados)
    if achado[0]:
        return "repetido", conferir_reuso(a.evento, a.cmd, assin, achado), achado[0]
    p = dados / f"{data}.json"
    if not p.exists() or data not in ler_json(dados / "dias.json"):
        raise Recusa(f"não existe o dia {data} em dados/ (dias só são criados pelo fechamento automático)")
    original = p.read_text(encoding="utf-8")
    dia = ler_json(p)
    resumo_evento = aplicar(dia)
    anotar(dia, a.evento, a.cmd, agora, resumo_evento, a.justificativa, assin)
    novo = texto_json(dia)
    txt = recibo(dia, resumo_evento, agora)
    if a.dry_run:
        diff = "".join(difflib.unified_diff(original.splitlines(True), novo.splitlines(True),
                                            f"dados/{data}.json (antes)", f"dados/{data}.json (depois)"))
        return "dry-run", f"{diff}\n--dry-run: nada foi gravado.\n{txt}", data
    # grava tudo e confere; se a validação falhar, desfaz (dia + derivados)
    guardados = {q: q.read_text(encoding="utf-8") for q in (p, dados / "resumo.json", dados / "objetivo.json") if q.exists()}
    try:
        gravar_json(p, dia)
        import derivados
        derivados.gerar(dados=dados, silencioso=True)
        from validar import validar
        c = validar(raiz)
        if c.erros:
            raise Recusa("validação falhou, nada foi gravado:\n  " + "\n  ".join(c.erros))
    except BaseException:
        for q, t in guardados.items():
            q.write_text(t, encoding="utf-8")
        raise
    return "ok", txt, data


# ---------------- git (--enviar) ----------------

def git(*args, check=True):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if check and r.returncode:
        raise Recusa(f"git {' '.join(args)} falhou: {r.stderr.strip() or r.stdout.strip()}")
    return r


def enviar(a):
    if git("status", "--porcelain").stdout.strip():
        raise Recusa("há alterações locais não enviadas no repositório: resolva (commit/push ou descarte) antes de usar --enviar")
    for tentativa in range(1, 5):
        git("fetch", "--quiet", "origin", "main")
        if tentativa == 1:   # nas próximas, o commit local é o nosso (recusado) e pode ser descartado
            locais = git("rev-list", "--count", "origin/main..HEAD").stdout.strip()
            if locais != "0":
                raise Recusa(f"há {locais} commit(s) locais não enviados: envie-os antes (git push) ou descarte")
        git("reset", "--quiet", "--hard", "origin/main")   # sempre sobre o HEAD mais novo (nada local a perder)
        status, txt, dia = aplicar_evento(a)
        if status == "repetido":
            return status, txt, dia
        git("add", "-A")
        rotulo = {"refeicao": "log", "peso": "peso", "remover": "correcao", "completo": "registro"}[a.cmd]
        msg = f"{rotulo} {dia[8:10]}/{dia[5:7]}: {a.nome or a.favorita or a.status or a.alvo or ''}".rstrip(": ")
        git("-c", "user.name=Grok", "-c", "user.email=grok@users.noreply.github.com",
            "commit", "--quiet", "-m", msg, "-m", f"evento {a.evento}")
        if git("push", "--quiet", "origin", "HEAD:main", check=False).returncode == 0:
            return "ok", txt + f"\nEnviado: {git('rev-parse', '--short', 'HEAD').stdout.strip()} ({msg})", dia
        print(f"push recusado (tentativa {tentativa}): alguém enviou no meio; reaplicando sobre o HEAD novo…", file=sys.stderr)
    raise Recusa("não consegui enviar depois de 4 tentativas; nada foi publicado")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=TIPOS)
    ap.add_argument("--evento", required=True)
    ap.add_argument("--nome")
    ap.add_argument("--item", action="append")
    ap.add_argument("--favorita")
    ap.add_argument("--consumido-em")
    ap.add_argument("--remover-sugestao", metavar="NOME", help="tira da sugestão a refeição com esse nome")
    ap.add_argument("--data")
    ap.add_argument("--kg")
    ap.add_argument("--alvo")
    ap.add_argument("--status")
    ap.add_argument("--obs")
    ap.add_argument("--justificativa")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--enviar", action="store_true")
    a = ap.parse_args(argv)
    try:
        status, txt, _ = enviar(a) if a.enviar and not a.dry_run else aplicar_evento(a)
    except Recusa as e:
        print(f"RECUSADO: {e}")
        return 2
    print(txt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
