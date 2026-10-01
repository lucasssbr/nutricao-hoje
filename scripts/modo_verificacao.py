#!/usr/bin/env python3
"""Decide se a publicação pode ser RÁPIDA (sem navegadores) ou precisa da verificação COMPLETA.

  python3 scripts/modo_verificacao.py      # imprime e grava em $GITHUB_OUTPUT: modo=rapida|completa, base=<sha>

RÁPIDA só quando é um push e o CÓDIGO (tudo fora de dados/) do HEAD é idêntico ao do commit que está
no ar (publicado.json do site). Esse código já passou pela verificação completa (navegadores) quando foi
publicado; mudou só dado → validar.py + testes Python bastam (~1 min em vez de 2–20 min).
Qualquer dúvida (agendamento da meia-noite, dispatch, site sem publicado.json, sha desconhecido, rede
falhou, código diferente) → COMPLETA. Nunca escolhe "rápida" por engano: erro = completa.

Ambiente: GITHUB_EVENT_NAME, GITHUB_REPOSITORY, SITE_URL (padrão https://<dono>.github.io/<repo>),
REF (padrão origin/main), GITHUB_OUTPUT.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def publicado(url, tentativas=3):
    for t in range(tentativas):
        try:
            with urllib.request.urlopen(f"{url}?t={int(time.time())}", timeout=10) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001 — rede/JSON: tenta de novo e, persistindo, vira "completa"
            erro = e
            if t + 1 < tentativas:
                time.sleep(2)
    raise RuntimeError(f"não li {url}: {erro}")


def decidir(evento, site, ref):
    """(modo, base, motivo)"""
    if evento != "push":
        return "completa", "", f"evento '{evento}' (só push usa o caminho rápido)"
    try:
        sha = publicado(f"{site.rstrip('/')}/publicado.json").get("sha", "")
    except Exception as e:  # noqa: BLE001
        return "completa", "", str(e)
    if not re.fullmatch(r"[0-9a-f]{40}", str(sha)):
        return "completa", "", f"publicado.json sem sha válido ({sha!r})"
    if git("cat-file", "-e", f"{sha}^{{commit}}").returncode:
        return "completa", "", f"commit publicado {sha[:7]} não está no histórico"
    dif = git("diff", "--name-only", sha, ref, "--", ".", ":(exclude)dados")
    if dif.returncode:
        return "completa", "", f"git diff falhou: {dif.stderr.strip()}"
    if dif.stdout.strip():
        arquivos = dif.stdout.split()
        return "completa", "", f"código mudou desde o que está no ar ({', '.join(arquivos[:5])}{'…' if len(arquivos) > 5 else ''})"
    return "rapida", sha, f"só dados mudaram desde {sha[:7]} (código idêntico ao publicado)"


def main():
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    dono, _, nome = repo.partition("/")
    site = os.environ.get("SITE_URL") or f"https://{dono.lower()}.github.io/{nome}"
    modo, base, motivo = decidir(os.environ.get("GITHUB_EVENT_NAME", ""), site, os.environ.get("REF", "origin/main"))
    print(f"verificação {modo}: {motivo}")
    saida = os.environ.get("GITHUB_OUTPUT")
    if saida:
        with open(saida, "a") as f:
            f.write(f"modo={modo}\nbase={base}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
