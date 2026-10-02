#!/usr/bin/env bash
# Verificação completa do repositório (o que o GitHub roda antes de publicar):
#   1. dados (validar.py)  2. testes Python (tests/)  3. páginas num navegador (Chromium e WebKit)
# Uso local:  bash scripts/verificar.sh   (SEM_PAGINAS=1 pula o navegador; SEM_TESTES=1 pula tests/;
#             PAGINAS_IMAGEM=mcr.microsoft.com/playwright:v1.56.1-noble roda as páginas na imagem do Playwright)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== dados"
python3 scripts/validar.py

if [ "${SEM_TESTES:-}" = "1" ]; then
  echo "== testes: pulados (SEM_TESTES=1)"
else
  echo "== testes"
  # os testes rodam publicar.sh/verificar.sh/fechar_dia.py como subprocessos: as variáveis de CONTROLE desta
  # execução (caminho rápido, fechamento, data simulada…) não podem vazar para eles (falhou no run 26)
  # TESTES_IMAGEM: testes que abrem navegador (test_historico) usam a mesma imagem do Playwright
  TESTES_IMAGEM="${PAGINAS_IMAGEM:-${TESTES_IMAGEM:-}}" env -u CODIGO_BASE -u PAGINAS_IMAGEM -u SEM_PAGINAS -u SEM_TESTES -u PREPARO -u EXIGIR_WEBKIT -u NAVEGADORES -u PORTA \
      -u HOJE -u AGORA_UTC -u GITHUB_OUTPUT -u REMOTO -u RAMO -u TENTATIVAS \
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
if [ -n "${PAGINAS_IMAGEM:-}" ]; then
  # imagem oficial do Playwright (navegadores + dependências do sistema já instalados): no GitHub, evita o
  # "playwright install --with-deps", que levava de 43 s a 23 min. Mesma rede (servidor acima), mesmos arquivos.
  echo "navegadores da imagem $PAGINAS_IMAGEM"
  EXTRA=()   # node_modules pode ser um link para fora do checkout (máquina local): monta o destino também
  NM="$(readlink -f node_modules 2>/dev/null || true)"
  if [ -n "$NM" ] && [ "$NM" != "$RAIZ_ABS/node_modules" ]; then EXTRA=(-v "$NM:$NM:ro"); fi
  docker run --rm "${EXTRA[@]}" --network host --user "$(id -u):$(id -g)" -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
    -e NAVEGADORES="${NAVEGADORES:-chromium,webkit}" -e EXIGIR_WEBKIT="${EXIGIR_WEBKIT:-}" \
    -v "$RAIZ_ABS:$RAIZ_ABS" -w "$RAIZ_ABS" "$PAGINAS_IMAGEM" \
    sh -c 'node scripts/testar_paginas.js "$1" && node scripts/testar_planejador.js "$1"' _ "http://127.0.0.1:$PORTA_USADA"
else
  NAVEGADORES="${NAVEGADORES:-chromium,webkit}" node scripts/testar_paginas.js "http://127.0.0.1:$PORTA_USADA"
  # fluxos do planejador (editar, trocar, desfazer, rascunho, base mudou, sem armazenamento/clipboard)
  NAVEGADORES="${NAVEGADORES:-chromium,webkit}" node scripts/testar_planejador.js "http://127.0.0.1:$PORTA_USADA"
fi
