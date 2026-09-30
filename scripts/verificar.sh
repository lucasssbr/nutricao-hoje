#!/usr/bin/env bash
# Verificação completa do repositório (o que o GitHub roda antes de publicar):
#   1. dados (validar.py)  2. testes Python (tests/)  3. páginas num navegador (Chromium e WebKit)
# Uso local:  bash scripts/verificar.sh   (SEM_PAGINAS=1 pula o navegador; SEM_TESTES=1 pula tests/)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== dados"
python3 scripts/validar.py

if [ "${SEM_TESTES:-}" = "1" ]; then
  echo "== testes: pulados (SEM_TESTES=1)"
else
  echo "== testes"
  python3 -m unittest discover -s tests -q
fi

if [ "${SEM_PAGINAS:-}" = "1" ]; then
  echo "== páginas: puladas (SEM_PAGINAS=1)"
  exit 0
fi
echo "== páginas (${NAVEGADORES:-chromium,webkit})"
PORTA="${PORTA:-8765}"
python3 -m http.server "$PORTA" >/dev/null 2>&1 &
SERV=$!
trap 'kill $SERV 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -s -o /dev/null "http://localhost:$PORTA/" && break; sleep 0.2; done
NAVEGADORES="${NAVEGADORES:-chromium,webkit}" node scripts/testar_paginas.js "http://localhost:$PORTA"
