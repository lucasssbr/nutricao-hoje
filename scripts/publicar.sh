#!/usr/bin/env bash
# Publicação segura (usada pelo GitHub Actions; também roda local para testes):
#   sempre sobre o HEAD MAIS NOVO da main → (preparo opcional, ex. fechamento) → derivados →
#   verificação completa → commit → push. Se o push for recusado porque alguém enviou no meio
#   (corrida), NÃO faz rebase de arquivo derivado: descarta o commit local, busca o HEAD novo e
#   regenera/verifica tudo de novo. Sem mudança nenhuma, não cria commit (idempotente).
#
# Variáveis:
#   PREPARO   comando a rodar antes dos derivados (ex.: "python3 scripts/fechar_dia.py")
#   REMOTO    remoto git (padrão origin)          RAMO   ramo (padrão main)
#   TENTATIVAS número de tentativas (padrão 4)    SEM_PAGINAS=1 pula o navegador (testes)
#   GITHUB_OUTPUT  se existir, recebe sha=<commit publicado e verificado> e mudou=sim|nao
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTO="${REMOTO:-origin}"
RAMO="${RAMO:-main}"
TENTATIVAS="${TENTATIVAS:-4}"
SAIDA="${GITHUB_OUTPUT:-/dev/null}"

for tentativa in $(seq 1 "$TENTATIVAS"); do
  echo "::group::tentativa $tentativa — sincronizar com $REMOTO/$RAMO"
  git fetch --quiet "$REMOTO" "$RAMO"
  git checkout --quiet -B "$RAMO" "$REMOTO/$RAMO"
  git reset --quiet --hard "$REMOTO/$RAMO"
  git clean -fdq   # não apaga ignorados (node_modules)
  base=$(git rev-parse HEAD)
  echo "base: $base"
  echo "::endgroup::"

  if [ -n "${PREPARO:-}" ]; then
    echo "== preparo: $PREPARO"
    bash -c "$PREPARO"
  fi
  python3 scripts/derivados.py
  bash scripts/verificar.sh

  if [ -z "$(git status --porcelain)" ]; then
    echo "Nada a publicar: $base já está verificado e com derivados em dia."
    echo "sha=$base" >> "$SAIDA"; echo "mudou=nao" >> "$SAIDA"
    exit 0
  fi
  git add -A
  if [ -n "${PREPARO:-}" ] && git diff --cached --name-only | grep -qE '^dados/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$'; then
    # "ontem" no fuso de LA (HOJE simula a data nos testes) — Python/ZoneInfo: funciona em Linux e macOS
    ontem=$(python3 -c 'import os, datetime, zoneinfo
h = os.environ.get("HOJE")
d = datetime.date.fromisoformat(h) if h else datetime.datetime.now(zoneinfo.ZoneInfo("America/Los_Angeles")).date()
print((d - datetime.timedelta(days=1)).strftime("%d/%m"))')
    msg="fechar $ontem (automático)"
  else
    msg="auto: derivados atualizados (resumo/objetivo)"
  fi
  git -c user.name="${GIT_NOME:-publicacao-automatica}" -c user.email="${GIT_EMAIL:-publicacao-automatica@users.noreply.github.com}" \
    commit --quiet -m "$msg" -m "Verificado sobre $base (validar + testes + páginas)."
  if git push --quiet "$REMOTO" "HEAD:$RAMO"; then
    sha=$(git rev-parse HEAD)
    echo "Publicado $sha ($msg)"
    echo "sha=$sha" >> "$SAIDA"; echo "mudou=sim" >> "$SAIDA"
    exit 0
  fi
  echo "::warning::push recusado (alguém enviou no meio). Regenerando sobre o HEAD novo…"
  sleep $((tentativa * 3))
done
echo "::error::não consegui publicar depois de $TENTATIVAS tentativas; nada foi publicado."
exit 1
