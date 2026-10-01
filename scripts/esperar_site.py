#!/usr/bin/env python3
"""Espera o site no ar conter um commit — para o Grok só dizer "pode atualizar" quando for verdade.

  python3 scripts/esperar_site.py                 # espera o HEAD local (depois de registrar.py --enviar)
  python3 scripts/esperar_site.py --sha abc1234 --max 600

Lê publicado.json do site (sha do commit verificado que está no ar) a cada --intervalo segundos e
termina quando o commit pedido for ele ou um ANCESTRAL dele (a publicação automática pode ter
acrescentado um commit de derivados por cima). Sai 0 = no ar; 1 = estourou o tempo (não dizer "pode
atualizar"; dizer que está publicando).

Ambiente: SITE_URL (padrão https://lucasssbr.github.io/nutricao-hoje).
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

SITE = "https://lucasssbr.github.io/nutricao-hoje"


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def no_ar(site):
    with urllib.request.urlopen(f"{site.rstrip('/')}/publicado.json?t={time.time():.0f}", timeout=10) as r:
        return json.loads(r.read().decode()).get("sha", "")


def contem(publicado, alvo):
    """O site publicado contém `alvo`? (igual ou descendente; busca o commit publicado se faltar)."""
    if not publicado:
        return False
    if publicado.startswith(alvo) or alvo.startswith(publicado):
        return True
    if git("cat-file", "-e", f"{publicado}^{{commit}}").returncode:
        git("fetch", "-q", "origin")
    return git("merge-base", "--is-ancestor", alvo, publicado).returncode == 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sha", help="commit esperado (padrão: HEAD)")
    ap.add_argument("--max", type=float, default=300, help="segundos (padrão 300)")
    ap.add_argument("--intervalo", type=float, default=10)
    a = ap.parse_args(argv)
    site = os.environ.get("SITE_URL", SITE)
    alvo = git("rev-parse", a.sha or "HEAD").stdout.strip()
    if not alvo:
        print(f"commit {a.sha!r} não encontrado", file=sys.stderr)
        return 2
    ini = time.time()
    ultimo = ""
    while True:
        try:
            ultimo = no_ar(site)
            if contem(ultimo, alvo):
                print(f"no ar em {time.time() - ini:.0f}s (site em {ultimo[:7]}, contém {alvo[:7]}) — pode atualizar")
                return 0
        except Exception as e:  # noqa: BLE001 — rede: tenta de novo até o limite
            ultimo = f"erro: {e}"
        if time.time() - ini + a.intervalo > a.max:
            print(f"ainda não está no ar depois de {a.max:.0f}s (site em {ultimo[:40]}); a publicação segue — "
                  f"avise que está publicando", file=sys.stderr)
            return 1
        time.sleep(a.intervalo)


if __name__ == "__main__":
    sys.exit(main())
