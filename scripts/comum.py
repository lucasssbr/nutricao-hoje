#!/usr/bin/env python3
"""Utilidades compartilhadas pelos scripts: JSON estrito, números, datas (fuso de Los Angeles),
arredondamento único e gravação segura. Sem dependências externas.

Política de precisão (vale para Python e para as páginas):
  - cada item guarda kcal/p/c/g/fibra com 1 casa decimal (biblioteca × proporção);
  - totais = soma dos valores guardados nos itens, arredondada só na hora de mostrar;
  - arredondamento "meio para longe do zero" (176,5 → 177; −0,5 → −1), igual em Python e JS.
"""
import datetime
import json
import math
import os
import pathlib
import re
import tempfile
import zoneinfo
from decimal import ROUND_HALF_UP, Decimal

TZ = zoneinfo.ZoneInfo("America/Los_Angeles")
ROOT = pathlib.Path(__file__).resolve().parent.parent
DADOS = ROOT / "dados"
MACROS = ("kcal", "p", "c", "g")
NUTRIENTES = MACROS + ("fibra",)
DATA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# carimbo com fuso obrigatório: 2026-09-30T08:27:44-07:00 (segundos opcionais)
CARIMBO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$")


class ErroJSON(ValueError):
    pass


# ---------- JSON estrito ----------

def _sem_constantes(nome):
    raise ErroJSON(f"valor não permitido em JSON: {nome}")


def _sem_duplicadas(pares):
    obj = {}
    for k, v in pares:
        if k in obj:
            raise ErroJSON(f"chave duplicada: {k!r}")
        obj[k] = v
    return obj


def ler_json(caminho):
    """Lê JSON recusando NaN/Infinity e chaves duplicadas."""
    texto = pathlib.Path(caminho).read_text(encoding="utf-8")
    return json.loads(texto, parse_constant=_sem_constantes, object_pairs_hook=_sem_duplicadas)


def texto_json(obj, compacto=False):
    if compacto:
        return json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, indent=2) + "\n"


def gravar_json(caminho, obj, compacto=False):
    """Grava de forma atômica (arquivo temporário + rename). Não grava se o conteúdo não mudou.
    Devolve True se mudou."""
    caminho = pathlib.Path(caminho)
    novo = texto_json(obj, compacto)
    if caminho.exists() and caminho.read_text(encoding="utf-8") == novo:
        return False
    fd, tmp = tempfile.mkstemp(dir=caminho.parent, prefix="." + caminho.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(novo)
        os.replace(tmp, caminho)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return True


# ---------- números ----------

def eh_numero(x):
    """Número finito (int/float), sem booleanos, NaN ou infinito."""
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def arred(x, casas=0):
    """Meio para longe do zero, sem o viés binário do float (176,5 → 177; 0,15 → 0,2)."""
    if not eh_numero(x):
        raise ValueError(f"não é número finito: {x!r}")
    q = Decimal(1).scaleb(-casas)
    d = Decimal(repr(round(float(x), 9))).quantize(q, rounding=ROUND_HALF_UP)
    return int(d) if casas == 0 else float(d)


def enxuto(x):
    """3.0 → 3 (JSON mais limpo); mantém 3.5."""
    return int(x) if float(x).is_integer() else x


# ---------- datas (sempre no fuso de Los Angeles) ----------

def data_valida(s):
    if not isinstance(s, str) or not DATA_RE.match(s):
        return False
    try:
        datetime.date.fromisoformat(s)
        return True
    except ValueError:
        return False


def carimbo_valido(s):
    if not isinstance(s, str) or not CARIMBO_RE.match(s):
        return False
    try:
        datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def agora_la(utc=None):
    """Agora no fuso de LA (utc: datetime com fuso, para testes)."""
    base = utc if utc is not None else datetime.datetime.now(datetime.timezone.utc)
    return base.astimezone(TZ).replace(microsecond=0)


def hoje_la(utc=None):
    return agora_la(utc).date()


def carimbo(utc=None):
    return agora_la(utc).isoformat()


def data_de_consumo(texto):
    """'2026-09-30T12:30' (hora de LA) ou com fuso → (date em LA, carimbo ISO com fuso)."""
    dt = datetime.datetime.fromisoformat(texto.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    dt = dt.astimezone(TZ)
    return dt.date(), dt.replace(microsecond=0).isoformat()


# ---------- somas ----------

def somar(refeicoes):
    """Soma dos valores guardados nos itens (sem arredondar). Fibra só se algum item tiver."""
    tot = {m: 0.0 for m in MACROS}
    fibra = None
    for r in refeicoes or []:
        for it in r.get("itens", []):
            for m in MACROS:
                tot[m] += float(it.get(m) or 0)
            if eh_numero(it.get("fibra")):
                fibra = (fibra or 0.0) + float(it["fibra"])
    if fibra is not None:
        tot["fibra"] = fibra
    return tot


def registro_do_dia(dia):
    """Completude do registro: 'completo' | 'parcial' | 'desconhecido' (sem confirmação)."""
    v = (dia.get("registro") or {}).get("status") if isinstance(dia.get("registro"), dict) else None
    return v if v in ("completo", "parcial") else "desconhecido"
