#!/usr/bin/env python3
"""Consulta e aciona o GitHub Pages para o workflow "Conferir e publicar" — sem mascarar erro.

  python3 scripts/pages.py modo          # imprime "legacy" (publica do branch) ou "workflow" (GitHub Actions)
  python3 scripts/pages.py pedir-build   # pede um build no modo legacy (push com GITHUB_TOKEN não dispara)

Qualquer outra resposta é ERRO (sai 1 com ::error::): HTTP 4xx, JSON inválido, build_type desconhecido.
HTTP 5xx e falha de rede são repetidos até TENTATIVAS vezes; persistindo, também é erro.
Nunca interpreta resposta desconhecida como modo branch.

Ambiente: GITHUB_REPOSITORY (owner/repo), GH_TOKEN, GITHUB_API_URL (padrão https://api.github.com),
PAGES_TENTATIVAS (padrão 3), PAGES_ESPERA (segundos entre tentativas, padrão 3).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

MODOS = {"legacy", "workflow"}


class ErroPages(Exception):
    pass


def chamar(metodo, caminho):
    """Faz a chamada com repetição só para 5xx/rede. Devolve (status, corpo)."""
    api = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GH_TOKEN", "")
    if not repo or not token:
        raise ErroPages("GITHUB_REPOSITORY e GH_TOKEN são obrigatórios")
    tentativas = int(os.environ.get("PAGES_TENTATIVAS", "3"))
    espera = float(os.environ.get("PAGES_ESPERA", "3"))
    url = f"{api}/repos/{repo}/{caminho}"
    ultimo = ""
    for t in range(1, tentativas + 1):
        req = urllib.request.Request(url, method=metodo, data=b"" if metodo == "POST" else None, headers={
            "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            corpo = e.read().decode("utf-8", "replace")[:300]
            if e.code < 500:  # 4xx: não adianta repetir (permissão, não encontrado…)
                raise ErroPages(f"{metodo} {caminho}: HTTP {e.code} — {corpo}")
            ultimo = f"HTTP {e.code} — {corpo}"
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            ultimo = f"falha de rede: {e}"
        if t < tentativas:
            print(f"::warning::{metodo} {caminho}: {ultimo} (tentativa {t}/{tentativas}); repetindo…", file=sys.stderr)
            time.sleep(espera * t)
    raise ErroPages(f"{metodo} {caminho}: {ultimo} depois de {tentativas} tentativas")


def modo():
    status, corpo = chamar("GET", "pages")
    try:
        dados = json.loads(corpo)
    except ValueError:
        raise ErroPages(f"GET pages: resposta não é JSON (HTTP {status}): {corpo[:120]!r}")
    tipo = dados.get("build_type") if isinstance(dados, dict) else None
    if tipo not in MODOS:
        raise ErroPages(f"GET pages: build_type desconhecido {tipo!r} (esperado legacy ou workflow)")
    return tipo


def pedir_build():
    status, corpo = chamar("POST", "pages/builds")
    if status not in (200, 201):
        raise ErroPages(f"POST pages/builds: HTTP {status} inesperado — {corpo[:120]}")
    return status


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    try:
        if cmd == "modo":
            print(modo())
        elif cmd == "pedir-build":
            pedir_build()
            print("build do Pages pedido")
        else:
            print(__doc__, file=sys.stderr)
            return 2
    except ErroPages as e:
        print(f"::error::Pages: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
