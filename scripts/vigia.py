#!/usr/bin/env python3
"""Vigia da publicação: destrava a fila de "Conferir e publicar" (roda de hora em hora pelo GitHub Actions).

Em 06/10 uma execução ficou 9 h em "waiting" no ambiente github-pages (sem revisor nem tempo de espera
configurados — falha do GitHub) e segurou a fila inteira: os registros do Grok não iam ao ar.
Esperar o ambiente leva segundos; passou de LIMITE_MIN, está presa. O vigia cancela as presas e dispara uma
execução nova (workflow_dispatch = verificação completa + fechamento idempotente), para nada se perder.
Não mexe em nada que esteja "queued"/"pending" (fila normal) ou rodando.

Ambiente: GH_TOKEN, GITHUB_REPOSITORY (dono/repo). --simular só mostra o que faria.
"""
import datetime
import json
import os
import sys
import urllib.request

WORKFLOW = "publicar.yml"
LIMITE_MIN = 30


def presas(runs, agora, limite_min=LIMITE_MIN):
    """Ids das execuções em "waiting" há mais de limite_min (pela última atualização)."""
    out = []
    for r in runs:
        if r.get("status") != "waiting":
            continue
        t = datetime.datetime.fromisoformat(str(r.get("updated_at") or r.get("created_at")).replace("Z", "+00:00"))
        if (agora - t).total_seconds() > limite_min * 60:
            out.append(r["id"])
    return out


def api(metodo, caminho, corpo=None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}{caminho}", method=metodo,
        data=json.dumps(corpo).encode() if corpo is not None else None,
        headers={"Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt.strip() else {}


def main(argv=None):
    simular = "--simular" in (argv if argv is not None else sys.argv[1:])
    runs = api("GET", f"/actions/workflows/{WORKFLOW}/runs?status=waiting&per_page=50").get("workflow_runs", [])
    ids = presas(runs, datetime.datetime.now(datetime.timezone.utc))
    if not ids:
        print(f"nada preso ({len(runs)} em waiting, todos com menos de {LIMITE_MIN} min)")
        return 0
    for i in ids:
        print(f"cancelando execução presa {i}" + (" (simulação)" if simular else ""))
        if not simular:
            api("POST", f"/actions/runs/{i}/cancel")
    print("disparando uma execução nova de publicar.yml na main" + (" (simulação)" if simular else ""))
    if not simular:
        api("POST", f"/actions/workflows/{WORKFLOW}/dispatches", {"ref": "main"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
