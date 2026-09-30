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
# Servidor EXCLUSIVO desta execução (scripts/servidor_teste.py): porta livre escolhida pelo sistema (ou $PORTA,
# que falha se estiver ocupada), confirmação de que é o nosso servidor servindo ESTE checkout, e no fim encerra
# só o processo criado aqui. Sem isso, um servidor antigo na porta poderia responder por outro checkout.
RAIZ_ABS="$(pwd -P)"
TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(12))')"
PRONTO="$(mktemp)"
: > "$PRONTO"
python3 scripts/servidor_teste.py --raiz "$RAIZ_ABS" --token "$TOKEN" --pronto "$PRONTO" --porta "${PORTA:-0}" &
SERV=$!
trap 'kill "$SERV" 2>/dev/null || true; rm -f "$PRONTO"' EXIT
for _ in $(seq 1 100); do
  [ -s "$PRONTO" ] && break
  if ! kill -0 "$SERV" 2>/dev/null; then
    echo "::error::servidor de teste não iniciou (porta ${PORTA:-livre} ocupada ou erro) — páginas NÃO testadas" >&2
    exit 1
  fi
  sleep 0.1
done
if [ ! -s "$PRONTO" ]; then
  echo "::error::servidor de teste não ficou pronto em 10 s — páginas NÃO testadas" >&2
  exit 1
fi
PORTA_USADA="$(cat "$PRONTO")"
IDENT="$(curl -fsS "http://127.0.0.1:$PORTA_USADA/__servidor_teste__" || true)"
if [ "$IDENT" != "$TOKEN $RAIZ_ABS" ]; then
  echo "::error::a porta $PORTA_USADA não é o servidor desta execução (respondeu: ${IDENT:-nada}) — páginas NÃO testadas" >&2
  exit 1
fi
echo "servidor de teste: porta $PORTA_USADA servindo $RAIZ_ABS"
NAVEGADORES="${NAVEGADORES:-chromium,webkit}" node scripts/testar_paginas.js "http://127.0.0.1:$PORTA_USADA"
