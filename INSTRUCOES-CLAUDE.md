# Instruções para Claude e outros colaboradores de IA

## Objetivo do produto

**Nutrição Hoje** é um rastreador pessoal **simples** de calorias e macros. Não é um aplicativo completo: não adicionar backend, autenticação, banco de dados, PWA pesado, framework, bundler ou etapa de build. O site deve continuar sendo HTML estático servido pelo GitHub Pages, fácil de editar e revisar.

## Metas diárias

Ficam em **`dados/objetivo.json` → `atual.metas`** (único lugar; valem para o objetivo em andamento). Atual (corte até 17/10/2026):

- **1570 kcal**
- **P 180 g** (proteína)
- **C 100 g** (carboidratos)
- **G 50 g** (gorduras)

Cada dia guarda uma cópia em `meta` (o fechamento da meia-noite copia de `atual.metas` ao criar o dia), para o histórico continuar certo quando as metas mudarem.

**Lucas muda as metas** ("proteína 170", "kcal 1800") → editar `atual.metas` **e** o `meta` do dia aberto (e de dias futuros já criados); dias fechados não mudam. Conferir que 4×P + 4×C + 9×G ≈ kcal (o `validar.py` avisa se passar de 5%). `validar.py`, commit `dados: metas`.

## Biblioteca de alimentos (`dados/alimentos.json`)

Todos os valores nutricionais ficam em **`dados/alimentos.json`** — é a única fonte. Pesos **sempre crus** (carne, batata). Cada entrada tem `nome`, `apelidos`, `base` (100 g, 1 un, 1 lata…), `kcal`/`p`/`c`/`g`, `fonte` e `salvo_em`.

`fonte` pode ser: `rotulo` · `usda` · `openfoodfacts` · `lucas` (valor informado pelo Lucas) · `estimado`.

**Fibra (`fibra`, g por base):** registrar junto com os macros ao cadastrar alimento novo (rótulo: "Dietary Fiber"; USDA: "Fiber, total dietary"; sem dado → `0` só se for carne/ovo/laticínio, senão pesquisar). O `item.py` já inclui `fibra` nos itens e no TOTAL; o site mostra a fibra do dia com referência de ~14 g por 1000 kcal. Não é meta, é acompanhamento.

### Regra de busca (alimento citado no chat)

1. Procurar primeiro em `alimentos.json` (pelo nome ou apelido). Achou → **usar, sem pesquisar**.
2. Não achou → se o Lucas mandou foto da **tabela nutricional**, usar o rótulo. **Sem tabela** (só o nome, ou etiqueta sem tabela, como carne de açougue) → **pesquisar na internet e fazer revisão cruzada**:
   - Buscar em **pelo menos 2 fontes**: USDA FoodData Central (in natura) e/ou Open Food Facts / site da marca (industrializado). Usar o nome exato do produto/corte.
   - **Comparar** kcal, P, C, G por 100 g (ou por unidade):
     - fontes batem (diferença ≤ 10% em kcal e ≤ 3 g em cada macro) → usar a mais oficial (USDA > marca > Open Food Facts), `fonte` dessa base;
     - fontes **não** batem → usar o valor **mais alto de kcal/gordura** (conservador) e `fonte: "estimado"`.
   - Registrar em `obs` quais fontes foram consultadas e os valores de cada uma.
   - Avisar no chat, antes de logar, neste formato:
     ```
     🔎 Novo na biblioteca: <nome> (por 100 g)
     • USDA: 227 kcal | P19 | C0 | G17
     • <fonte 2>: 230 kcal | P20 | C0 | G17
     ✅ Batem → usando USDA   (ou ⚠️ Não batem → usando o mais alto; mande a tabela se tiver)
     ```
3. **Antes de logar**, salvar o alimento novo em `alimentos.json` com `fonte` e `salvo_em`, e avisar no chat: "novo na biblioteca: X (fonte)". Commit `dados: alimento <nome>`.
4. Alimento com `fonte: estimado` → perguntar ao Lucas se ele tem o rótulo; com o rótulo, atualizar a entrada e a fonte.
5. Nunca alterar uma entrada existente sem avisar no chat (valor antigo → novo). Dias já fechados não são recalculados quando a biblioteca muda (única exceção de mexer em dia fechado: refeição atrasada, ver "Fechar o dia").

Pendentes de rótulo: qualquer alimento com `fonte` `lucas` ou `estimado` (ver `python3 scripts/item.py --lista`). Nurri e iogurte grego já estão com `rotulo`.

### Lançar: SEMPRE com `scripts/registrar.py` (Grok)

Refeição, peso, correção e completude passam pelo CLI — ele calcula pela biblioteca, grava de forma atômica, regenera os derivados, valida e desfaz tudo se algo falhar:

```bash
# --evento = <id da mensagem do Lucas>:<tipo>:<n> — UM id por OPERAÇÃO (unidade explícita: g, un, lata)
python3 scripts/registrar.py refeicao --evento msg-812:refeicao:1 --nome Almoço --consumido-em 2026-09-30T12:40 \
    --item chuck-costco=200g --item batata-inglesa=150g [--remover-sugestao Almoço] --enviar
python3 scripts/registrar.py refeicao --evento msg-812:refeicao:2 --favorita cafe-padrao --consumido-em 2026-09-30T08:10 --enviar
python3 scripts/registrar.py peso     --evento msg-812:peso:1 --data 2026-09-30 --kg 88.4 --enviar
python3 scripts/registrar.py remover  --evento msg-813:remover:1 --data 2026-09-30 --alvo msg-812:refeicao:1 --justificativa "…" --enviar
python3 scripts/registrar.py completo --evento msg-814:completo:1 --data 2026-09-30 --status completo|parcial --enviar
```

- **`--evento` é obrigatório, estável e POR OPERAÇÃO**: `<id da mensagem>:<tipo>:<n>` (tipo = refeicao/peso/remover/completo; n = 1, 2… na ordem em que aparecem na mensagem). Mensagem com almoço + lanche + peso = `msg:refeicao:1`, `msg:refeicao:2`, `msg:peso:1`.
- **Retry idêntico** (mesmo id, mesmo conteúdo) responde "já registrado" e **não duplica**. **Mesmo id com outro tipo ou outro conteúdo é RECUSADO** — nunca é tratado como sucesso: se é outra operação, use outro `n`; se é correção, `remover` + novo lançamento. O sufixo do id tem que bater com o comando. Eventos antigos (sem assinatura) continuam idempotentes pelo tipo.
- **Troca de horário:** horário sem fuso que cai na hora repetida (1º domingo de novembro, 01:00–01:59) ou inexistente (2º domingo de março, 02:00–02:59) é recusado — passe com fuso (`2026-11-01T01:30-07:00` = antes da troca, `-08:00` = depois). A comparação com "agora" é por instante (UTC).
- **`--consumido-em`** = hora em que o Lucas comeu (fuso de LA); o script guarda também `registrado_em` (hora do lançamento). A data do consumo decide o dia (refeição das 23:50 mandada depois da meia-noite vai para o dia anterior).
- **Dia fechado** exige `--justificativa` (fica em `correcoes` do dia). Confirmar completude (`completo`) não exige.
- **`--dry-run`** mostra o diff e o recibo sem gravar. **`--enviar`** faz o ciclo git inteiro (sincroniza, aplica, valida, commit, push; se alguém enviou no meio, reaplica sobre o HEAD novo sem duplicar). Exige árvore limpa.
- O **recibo** traz: dia afetado, total da refeição, consumido/meta/restante, "Passou da meta" (se passou) e pendências. Copiar o recibo para o chat.
- Consumo acima da meta é registrado normalmente — não existe limite.

### Completude do registro (fechado = completo por padrão, desde 02/10)

- Cada dia tem `registro.status`: `completo` | `parcial`; sem o campo = **desconhecido**.
- **Decisão do Lucas (02/10): à meia-noite o dia fecha como `completo`** (`obs`: "automático no fechamento"), a não ser que ele tenha avisado parcial. Proteção: dia **sem refeição** ou com **menos de 50% da meta de kcal** fica desconhecido (provável esquecimento) — o recibo/site mostram "registro não confirmado".
- Lucas disse que faltou algo ("dia parcial", "esqueci de lançar e não lembro") → `registrar.py completo --status parcial` (vale antes ou depois de fechado, sem justificativa). Lembrou o que faltou → lançar a refeição no dia certo (`--consumido-em` com a data dele + `--justificativa "esqueceu de lançar"`); o dia continua completo.
- 28/09–01/10 marcados completos a pedido do Lucas (02/10).
- A meta automática e o gasto inferido usam **só dias fechados com registro completo**. O site mostra a cobertura (Histórico e check-in) e o status em cada dia.

### Calcular itens (consulta, planos e sugestões): com `scripts/item.py`

```bash
python3 scripts/item.py chuck-costco 200 batata-inglesa 300 ovo-inteiro 2
python3 scripts/item.py --lista      # ids e bases
```

Quantidade em **gramas** quando a base é "100 g"/"430 g", em **unidades** quando é "1 un"/"1 lata". O script imprime os itens prontos (com `alimento` e `quantidade`) e o total — é só colar em `lancado` ou `sugestao`. Alimento que não está na biblioteca: cadastrar primeiro, depois rodar o script.

### Refeições favoritas e plano padrão (`dados/refeicoes.json`)

- Combinações que o Lucas repete: `cafe-padrao`, `almoco-padrao`, `lanche-padrao`, `jantar-padrao` (com apelidos "café padrão", "café de sempre"…).
- Lucas diz "comi o café padrão" → `python3 scripts/item.py --refeicao cafe-padrao` e cola a refeição em `lancado`. Se ele disser uma variação ("café padrão sem banana", "com 3 ovos"), montar os itens com o script normal.
- `python3 scripts/item.py --refeicoes` lista as favoritas; `--plano` mostra o plano padrão inteiro.
- **`plano_padrao`** = sequência de favoritas usada como **sugestão automática** do dia novo à meia-noite. Lucas pede pra mudar o plano padrão ("no jantar padrão troca batata por banana", "cria um almoço com X") → editar `refeicoes.json` (itens = `[id, quantidade]`), rodar `validar.py`, commit `dados: favoritas`. Mudança vale a partir do próximo dia criado.
- Depois de lançar uma refeição, refazer `sugestao` só com o que falta; a página mostra a **primeira** refeição de `sugestao` como "Próxima refeição" no topo — manter `sugestao` na ordem do dia.

### Peso: dia sem registro

- Pesar é **opcional**. Dia sem peso = `peso_kg: null` (nunca inventar nem copiar valor pro JSON).
- O site preenche só na tela: dia sem peso **entre** dois registros = média proporcional dos vizinhos; **depois** do último registro = repete o último. Aparece como "estimado" (bolinha vazada no gráfico, "~" no número).
- Lucas manda um peso atrasado ("ontem pesei 88,5") → `registrar.py peso --data <aquele dia>` (dia fechado pede `--justificativa`, ex.: "pesou e mandou depois"). O preenchimento e a meta se ajustam sozinhos.
- Médias, tendências, marcos e o gasto inferido usam **só pesagens reais**; a tela mostra quantas pesagens há e a data da última.

### Objetivo com data alvo (`dados/objetivo.json`)

- `atual` = objetivo em andamento: `nome`, `inicio`, `data_alvo`, `metas` (kcal/p/c/g do dia), `gasto_kcal` (opcional, informado pelo Lucas), `peso_inicial_kg`, `meta_semanal_kg` (kg a perder por semana). O site mostra no Hoje: dias que faltam, meta da semana, peso de hoje vs esperado; no Histórico: linha tracejada da meta no gráfico e projeção pelo ritmo.
- Lucas muda algo ("meta de 0,5 kg por semana", "adia a data pra 24/10", "muda o nome") → editar `atual`, `validar.py`, commit `dados: objetivo`.
- **Meta final (longo prazo, `meta_final` no topo do `objetivo.json`)**: **80 kg bem definido (~10% de gordura)** 🏁, depois dieta reversa. Base: ~19% de gordura em 88,9 kg (estimativa do Lucas) → 72,0 kg de massa magra ÷ 0,90 = 80 kg. **Não** muda quando um objetivo termina; só se o Lucas pedir. O card do Hoje mostra **marcos de 1 kg** até lá: média das **pesagens reais** dos 7 dias até a última pesagem (a tela diz quantas); marco só é confirmado com **2+ pesagens** na janela (senão aparece "…" pendente), e a data da conquista usa a mesma regra. Previsões e escolha da medida de gordura partem de **hoje (LA)**, não da data da última pesagem; última pesagem com mais de 7 dias gera aviso.
- **Novo objetivo** ("novo objetivo: 15/11, perder 0,5 kg por semana") → mover o `atual` para o fim de `anteriores` acrescentando `"peso_final_kg"` (último peso registrado) e `"encerrado_em"` (hoje); criar novo `atual` com `inicio` = hoje, `peso_inicial_kg` = peso mais recente e as **novas `metas`** (perguntar ao Lucas as metas e o gasto calórico dele; sem resposta, manter as metas anteriores). Atualizar o `meta` do dia aberto. Confirmar no chat: data alvo, metas, meta semanal, peso esperado na data alvo.
- **Meta semanal automática (`meta_modo: "auto"`)**: `scripts/meta.py` (chamado por `scripts/derivados.py`) calcula pelo déficit — gasto − média de kcal dos **dias fechados com registro completo** do objetivo (com menos de 3, usa a meta de kcal e diz por quê) — só com dados **até hoje** (fuso de LA). Grava `meta_semanal_kg` + `calculo`. Roda sozinho a cada envio e à meia-noite; o `registrar.py` também roda.
- **Modo manual** (`meta_modo: "manual"`): a meta semanal escolhida pelo Lucas fica; o `calculo` (diagnóstico, origem, data) continua sendo atualizado e mostra quanto seria pelo cálculo.
- **Gasto inferido pelos registros — só informativo (não é medido):** média de kcal dos dias completos **dentro do intervalo das pesagens** − tendência do peso × 7700 (janela até 21 dias, pula os 4 primeiros dias do objetivo; precisa de ≥6 pesagens reais em ≥10 dias e ≥80% de cobertura de dias completos). Fica em `calculo.gasto_inferido` (ou `gasto_inferido_falta` com o motivo e a cobertura). **Não** entra na meta (decisão do Lucas, 29/09: opção C). A meta usa `gasto_kcal` (se o Lucas informou) ou a estimativa.
- **Check-in semanal:** o Histórico mostra, por semana do objetivo, peso (média 7 dias) × esperado, média de kcal/proteína e dias na meta. Nada a fazer: sai dos dados.
- **Gasto calórico do objetivo (`gasto_kcal`)**: é o Lucas quem define. Ele diz "meu gasto é 2500" → gravar `"gasto_kcal": 2500` em `objetivo.atual`, rodar `meta.py`, `validar.py`, commit `dados: objetivo`. Com `gasto_kcal`, o `meta.py` usa esse número; sem ele, usa a estimativa (Mifflin-St Jeor com `dados/perfil.json` × fator de atividade), que é só uma noção. O gasto inferido pelos registros é **só informativo** (ver acima) — nunca substitui o `gasto_kcal` nem a estimativa na meta; o Lucas faz essa análise. Em objetivo novo, perguntar o gasto dele.
- Lucas diz quantos treinos faz / nível de atividade → ajustar `atividade` em `dados/perfil.json` (1.2 sedentário · 1.375 leve · 1.55 moderado · 1.725 intenso), rodar `meta.py`, commit `dados: perfil`.
- Lucas quer uma meta fixa ("quero 0,5 kg por semana") → `meta_modo: "manual"` + `meta_semanal_kg`. Voltar pro cálculo: `meta_modo: "auto"` + `meta.py`.
- Meta acima de 1,2 kg/semana gera aviso na checagem: comentar com o Lucas antes de salvar.

**Derivados** (`dados/resumo.json` e `objetivo.atual.calculo`) **nunca se editam à mão**: `python3 scripts/derivados.py` regenera (idempotente). O `validar.py` acusa resumo desatualizado.

**Antes de todo push** que mexa em `dados/` (se não usou `registrar.py --enviar`): `python3 scripts/derivados.py && python3 scripts/validar.py` → "Dados OK". Mensagens de erro dizem arquivo e campo.

**Publicação (`.github/workflows/publicar.yml`, "Conferir e publicar"):** a cada push na main, PR, e à meia-noite, o GitHub roda `scripts/publicar.sh`: sincroniza com o HEAD mais novo → fecha o dia (roda em **toda** execução na main; fora da virada não muda nada — se um push rodar no lugar do agendamento da meia-noite, ele mesmo fecha) → regenera derivados → `scripts/verificar.sh` (validação + `tests/` + páginas no Chromium **e** WebKit) → commit/push só se tudo passar. Se alguém enviar no meio, **não faz rebase de derivado**: descarta, busca de novo, regenera e reconfere. **Caminho rápido (01/10):** push que só muda `dados/` (código idêntico ao commit no ar, lido do `publicado.json`) pula testes e navegadores — `validar.py` + derivados, ~1 min até o site. Código novo, meia-noite, dispatch ou qualquer dúvida → verificação completa (testes + Chromium + WebKit), ~2–3 min: as páginas rodam na imagem oficial do Playwright (`PAGINAS_IMAGEM`, sem instalar nada pelo apt). Local com Docker: `PAGINAS_IMAGEM=mcr.microsoft.com/playwright:v1.56.1-noble bash scripts/verificar.sh` testa também o WebKit. Se código novo chegar no HEAD durante uma execução rápida, ela não publica (a do push do código publica). Em PR, só confere. Fila `concurrency` com `queue: max`: execuções pendentes esperam a vez (nenhuma substitui a outra; não usar `cancel-in-progress: true`). Falha = e-mail pro Lucas. Nos testes de página, `verificar.sh` sobe o próprio servidor (`scripts/servidor_teste.py`, porta livre + token de identidade); se ele não subir ou a porta for de outro servidor, falha com "páginas NÃO testadas" — nunca testa outro checkout. Com o Pages em **Settings → Pages → Source: GitHub Actions**, só o commit verificado vai ao ar (senão o workflow avisa que o modo branch publica antes da conferência).

**Claude, antes de push:** `bash scripts/verificar.sh` (tudo) — ou `SEM_PAGINAS=1` para pular o navegador. A partir de 29/09, todo item de dia aberto precisa ter `alimento` + `quantidade`.

Escala proporcional: ex. chuck 200 g = 446 | P40 | C0 | G34; batata 300 g = 231 | P6 | C51 | G0; melancia 300 g = 90 | P3 | C24 | G0.

**Precisão (Python, páginas e CSV iguais):** cada item guarda kcal/P/C/G/fibra com **1 casa decimal** (biblioteca × proporção); totais = **soma dos valores guardados**, arredondada só na hora de mostrar, sempre "meio para longe do zero" (176,5 → 177) — `scripts/comum.py:arred` e `comum.js:Nutri.arred`. **Nunca** recalcular kcal por 4/4/9 e **nunca** reescrever dias antigos para corrigir diferença de arredondamento.

**Calendário:** tudo decide "hoje" pelo fuso de **America/Los_Angeles** (scripts e páginas, mesmo com o iPhone em outro fuso). **Semana do objetivo:** semana 1 = 7 dias a partir do `inicio` (29/09–05/10); a "meta da semana" é o peso esperado na **pesagem da manhã seguinte** (06/10). Hoje e Histórico usam a mesma definição (`Nutri.semana`).


## Formato do log no chat

Ordem fixa:

1. Itens: `• Nome — quantidade — kcal | P x | C x | G x`
2. Total da refeição
3. Consumido / Meta / Restante do dia
4. Se ainda houver restante: bloco **Pra fechar o dia (sugestão · não lançado)** — não entra no consumido até confirmação

Exemplo curto:

```
🍽 Refeição 2
────────────────
• Nurri Vanilla Milk Shake — 1 lata — 150 kcal | P 30 | C 3 | G 3
────────────────
Total refeição: 150 kcal | P 30 | C 3 | G 3

📊 Hoje
Consumido: 1022 kcal | P 77 | C 105 | G 37
Meta:      1570 kcal | P 180 | C 100 | G 50
Restante:  548 kcal | P 103 | C -5 | G 13
Passou da meta: C +5 g
```

Passou da meta em algo (kcal ou macro) → linha extra `Passou da meta: …` com quanto passou. Sem sermão: só o número.

## Fluxo diário: JSON + HTML

Fonte da verdade do dia corrente: `dados/YYYY-MM-DD.json`. O `index.html` só lê esse JSON (`fetch` com `cache: 'no-store'`) via `body data-dia` e **não** deve ser editado no dia a dia para lançar/sugerir.

Schema mínimo do JSON:

```json
{
  "data": "YYYY-MM-DD",
  "atualizado": "YYYY-MM-DDTHH:MM:SS-07:00",
  "fechado": false,
  "meta": { "kcal": 1570, "p": 180, "c": 100, "g": 50 },
  "peso_kg": null,
  "lancado": [ { "refeicao": "…", "itens": [ { "nome", "qtd", "alimento", "quantidade", "kcal", "p", "c", "g" } ] } ],
  "sugestao": [ { "refeicao": "…", "itens": [ … ] } ],
  "sugestao_nota": "opcional — dica do card e sob o Dia projetado"
}
```

`sugestao_nota` é **opcional**. Se presente (string não vazia): vira o hint do card de sugestão. Na página, cada refeição da sugestão aparece recolhida (nome + total); o toque abre os itens.

Título do card de sugestão: **"Sugestão do dia"** quando `lancado` está vazio; **"Pra fechar o dia"** quando `lancado` tem itens.

`atualizado` usa timezone America/Los_Angeles (`-07:00` / `-08:00`).

1. **Início do dia** — o JSON do dia, o `data-dia` e a **sugestão automática** já foram criados pelo fechamento da meia-noite. O Grok só faz `git pull`. **Não** mexer no `data-dia` do index.
   **Sugestão automática (`scripts/sugerir.py`, pedido do Lucas 01/10):** monta o dia com os alimentos que ele **realmente comeu** nos últimos 14 dias (em cada refeição: Café/Almoço/Lanche/Jantar, pelo nome ou pela hora) + os de `refeicoes.json → sugestao_auto.incluir`, com porções parecidas com as dele, aproximando o total da meta (P ≥ meta, G ≤ meta). Respeita `plano_ate_g`/`max_dia` (teto de planejamento, não limite) e claras só no jantar. Com menos de 2 dias de histórico, usa o plano padrão. Ver sem gravar: `python3 scripts/sugerir.py`. **Prévia de amanhã** (botão Plano): `dados/previa.json`, DERIVADO pelo `derivados.py` a cada registro — não editar.
   **Planejador (`planejar.html?d=AAAA-MM-DD`, aba Planejar e botão no cartão de sugestão — 02/10):** o Lucas experimenta trocas e quantidades num RASCUNHO da sugestão (hoje: o restante; amanhã: a prévia; outros dias: plano padrão). O rascunho fica só no navegador dele (`localStorage`, por data de LA), **nunca vira consumo** e não muda `dados/`. Contas e regras em `planejador.js`, com paridade testada contra o Python (`tests/test_planejador.py`); trocas usam os tetos/claras/exclusões e o `custo_macros` do `sugerir.py`. O botão "Levar ao Grok" gera um texto que começa com **PLANEJAMENTO — NÃO CONSUMIDO**: Grok, isso é pedido de **revisão**, nunca de lançamento — só registre quando o Lucas disser que comeu.
2. **Lançar refeição** — `scripts/registrar.py refeicao … --enviar` (ver "Lançar"). Depois, `python3 scripts/esperar_site.py` (espera até 5 min o site conter o commit): só diga **"pode atualizar"** quando ele responder `pode atualizar`; se estourar o tempo, diga que está publicando. Não editar `lancado` à mão. **Não** editar o HTML do index no dia a dia. O `registrar.py` **refaz sozinho a sugestão do restante do dia** ("Pra fechar o dia") a cada refeição lançada ou removida, contando o que já foi comido; `--sem-replanejar` desliga. Se a sugestão falhar, o lançamento vale assim mesmo (fica a sugestão anterior). Escritores de `dados/` no mesmo checkout (registrar, fechar_dia, derivados, sugerir --gravar) passam por uma trava (`.escrita-dados.lock`): um espera o outro; falha de validação desfaz só os arquivos da própria operação.
3. **Refazer sugestão** — reescrever o array `sugestao` no JSON (+ `atualizado`). Uma sugestão **NUNCA conta como consumo** até o usuário confirmar o lançamento em `lancado`.
4. Planos futuros: criar `dados/YYYY-MM-DD.json` e apontar o menu **Plano** para `dia.html?d=YYYY-MM-DD`. Arquivos `sugestao-*.html` antigos foram removidos; dia futuro sem arquivo mostra uma prévia do plano padrão em `dia.html?d=`.
5. **Peso do dia** — no chat, mensagem tipo `peso 82,4` (vírgula ou ponto): `registrar.py peso --data <hoje> --kg 82.4 --enviar`. O Hoje/`dia.html` mostram "Peso 82,4 kg (181,7 lb)" sob a data; o Histórico usa o valor nos cards quando o dia está fechado.
5b. **Gordura corporal** — o Lucas manda foto (frente/lado, luz boa, de manhã) ou o número ("gordura 18", "DEXA deu 17,5"). Foto → estimar a % com faixa (ex.: "~18% (16–20%)") e gravar o número do meio. Gravar no JSON do **dia** (mesmo lugar do peso): `"gordura_pct": 18` + `"gordura_fonte"`: `foto` · `fita` · `dexa` · `bioimpedancia` · `lucas`. `atualizado`, `validar.py`, commit `gordura DD/MM`. O card do Hoje usa a **medida mais confiável** (decisão do Lucas, 30/09): DEXA > fita > foto/informado > bioimpedância, entre as medidas dos últimos 30 dias; da fonte escolhida, média das leituras de 2 semanas. Bioimpedância só manda se não houver outra medida recente. Não sobrescrever uma medida de outra fonte no mesmo dia sem avisar (um campo por dia). Claude também pode estimar por foto se o Lucas mandar pra ele. Frequência sugerida: a cada 2–4 semanas (foto) ou quando fizer DEXA. **Foto é opcional (Lucas, 01/10): nunca cobrar nem listar como pendência.** Sem medida nova, o app segue com a última (e só marca "antiga" depois de 30 dias).
6. **Fechar o dia — AUTOMÁTICO à meia-noite (Los Angeles)**. O GitHub Actions (`.github/workflows/publicar.yml` → `scripts/publicar.sh` com `scripts/fechar_dia.py`) faz sozinho — e marca o registro como **completo** (salvo aviso de parcial ou dia quase vazio; ver "Completude do registro"):
   1. `fechado: true` em todo dia passado ainda aberto;
   2. cria o JSON do novo dia se não existir, **já com o plano padrão como sugestão** (`dados/refeicoes.json`), e inclui em `dados/dias.json`;
   3. muda `data-dia` do `index.html` para o novo dia;
   4. aponta o botão **Plano** para o dia seguinte.
   Commit `fechar DD/MM (automático)`. **Ninguém precisa fechar o dia na mão.** Se o Lucas pedir "fecha o dia" antes da meia-noite, basta `fechado: true` no JSON; o resto o script faz.
   **Refeição que atravessa a meia-noite — vale a hora em que o Lucas comeu.** `--consumido-em` com a hora real: 23:50 → dia anterior (fechado: passar `--justificativa "comeu 23:50, mandou depois"`); depois da meia-noite → dia novo. Na dúvida sobre a hora, perguntar. O fechamento automático não reabre nada.
   **Grok, de manhã:** `git pull`. O dia já vem com o plano padrão; só refazer a sugestão se o Lucas pedir algo diferente. Plano de amanhã pode ser criado antes (`dados/<amanhã>.json` + `dias.json`); o script usa o que existir.

Arquivos `dia-YYYY-MM-DD.html` antigos (ex.: `dia-2026-09-28.html`) ficam no repo como arquivo estático legado — **não** tocá-los e **não** criar cópias novas do index. Dias a partir da generic `dia.html` abrem via query string.

O chat orienta; o **JSON** é o registro editável do dia; o HTML renderiza. Manter datas, consumo (`lancado`) e sugestão claramente separados.

## Commits

Padronizar mensagens assim:

- `log DD/MM: <refeição>` — item(ns) em `lancado` + `atualizado` no JSON
- `sugestao DD/MM: refeita` — array `sugestao` reescrito no JSON
- `fechar DD/MM (automático)` — feito pelo GitHub Actions à meia-noite; manual só `fechado: true` se o Lucas pedir antes
- `peso DD/MM` — `peso_kg` no JSON do dia + `atualizado`
- `dados: DD/MM em JSON` — criar/ajustar arquivo do dia (+ entrada em `dias.json` se for novo)
- `docs: <assunto>` — só documentação (ex.: este arquivo)
- `registrar.py --enviar` faz os commits sozinho: `log DD/MM: <refeição>`, `peso DD/MM`, `correcao DD/MM: <id>`, `registro DD/MM: completo`.
- `auto: derivados atualizados` / `fechar DD/MM (automático)` — feitos pelo GitHub (publicar.sh).

## Mapa de arquivos

- `dados/dias.json` — índice ordenado de datas (`["YYYY-MM-DD", …]`); todo JSON novo entra aqui.
- `dados/resumo.json` — **derivado** (`scripts/derivados.py`, regenerado a cada envio e à meia-noite): totais/meta/peso/registro de cada dia. Ninguém edita à mão. O Histórico busca direto do arquivo do dia os dias desde anteontem (fuso de LA) e os que não estão fechados; planos futuros não mexem nessa janela.
- `dados/YYYY-MM-DD.json` — **fonte da verdade** do dia (lançado, sugestão, `sugestao_nota`, meta, `peso_kg`, fechado, carimbo).
- `index.html` — shell **Hoje**; `body data-dia="YYYY-MM-DD"` + `estilo.css` + `render.js`. Não editar macros no HTML no dia a dia.
- `dia.html` — shell genérico de qualquer dia; **sem** `data-dia`. Lê `?d=YYYY-MM-DD` e busca `dados/{d}.json`. Título mostra a data (ex.: "30 set"), não "Hoje".
- `estilo.css` — CSS compartilhado (extraído do index).
- `render.js` — script compartilhado: se `body[data-dia]` → modo Hoje (index); senão → usa `?d=` (dia.html). Erro: "Não consegui carregar os dados de DD/MM".
- `historico.html` + `historico.js` — lista automática dos dias com `fechado: true` (via `dias.json`); card “Últimos 7 dias”; links para `dia.html?d=…`; botão **Baixar planilha (CSV)** com todos os dias (kcal, macros, fibra, peso, metas) — no iPhone abre o menu de compartilhar.
- `dia-*.html` — **legado** (ex.: `dia-2026-09-28.html`); não tocar; novos dias usam só `dia.html?d=`.
- `dados/refeicoes.json` — refeições favoritas + plano padrão (sugestão automática).
- `alimentos.html` + `alimentos.js` — página **Alimentos** (só leitura): favoritas com total, plano padrão do dia e a biblioteca com a fonte de cada alimento.
- `dados/objetivo.json` — objetivo com data alvo e meta semanal; `objetivo.js` desenha o card e a meta no gráfico.
- `dados/perfil.json` — altura, mês/ano de nascimento, sexo, fator de atividade (repo público: só o necessário). `scripts/meta.py` — meta semanal pelo déficit.
- `apple-touch-icon.png` / `icone-512.png` — ícone da tela inicial. `manifest.webmanifest` + metas `apple-mobile-web-app-capable` — abre em tela cheia pelo ícone (sem service worker/offline: continua site estático).
- `scripts/registrar.py` — **lançamento** (refeição, peso, remover, completo) com evento idempotente. `scripts/item.py` — calculadora (planos/sugestões). `scripts/sugerir.py` — sugestão automática pelo histórico. `scripts/modo_verificacao.py` — decide publicação rápida/completa. `scripts/esperar_site.py` — espera o log aparecer no site. `planejar.html` + `planejar.js` (tela) + `planejador.js` (contas, paridade com o Python) — planejador; `scripts/testar_planejador.js` — fluxos dele no Chromium/WebKit. `scripts/validar.py` — checagem estrita. `scripts/derivados.py` — resumo + cálculo do objetivo (`resumo.py` e `meta.py` por baixo). `scripts/fechar_dia.py` — fechamento. `scripts/publicar.sh` / `scripts/verificar.sh` — publicação e verificação usadas pelo GitHub. `scripts/comum.py` / `comum.js` — JSON estrito, arredondamento, fuso e semana, compartilhados.
- `scripts/pages.py` — consulta o modo do GitHub Pages (`legacy`/`workflow`) e pede build; erro HTTP/JSON/tipo desconhecido **falha** o workflow (nunca vira "modo branch" por engano).
- `tests/` — testes de regressão (`python3 -m unittest discover -s tests`), incluindo dias fechados nunca reescritos e o fechamento nos horários reais do agendamento na troca de horário (`AGORA_UTC` simula o relógio só em teste); `scripts/testar_paginas.js` — páginas no Chromium/WebKit, totais iguais ao Python e CSV.
- `INSTRUCOES-CLAUDE.md` — estas regras (fluxo, busca de alimentos, commits).
- `.nojekyll` — mantém a publicação estática do GitHub Pages sem processamento Jekyll.

O repositório é a única fonte do site; não manter espelho local separado. Para gerar PNG para o chat, fazer screenshot do site publicado ou de um servidor local servindo esta pasta do repo e esperar o render terminar. **Não copiar mais nada pro Mac/iCloud** (`Documents/Grok-Bot` e `iCloud Drive/Grok-Bot` foram aposentadas pelo Lucas em 29/09): o backup é o próprio GitHub, com todo o histórico.

## Regras de alimentação

- Usar **Nurri** como suplemento/bebida; **não usar whey**.
- **Não existe limite do que o Lucas come.** Existe a **meta** do dia. Comeu mais que o plano ou passou da meta → **registrar normalmente** e avisar no chat quanto passou (ex.: `Passou da meta: +120 kcal · C +15 g`). Nunca recusar, cortar ou "corrigir" o que ele comeu.
- Chuck: nas **sugestões**, planejar até 200 g cru/dia (`alimentos.json` → `chuck-costco.plano_ate_g`). É referência de planejamento, não limite: o Hoje só mostra quanto já foi ("Acém 250 g cru hoje").
- Dar preferência a batata, frutas, tomate, iogurte grego desnatado e **ovos inteiros**.
- Claras de ovo: **só à noite** e somente se forem necessárias para fechar a proteína/macros.
- **Peito de frango cru: liberado (Lucas, 01/10 — comprou e quer que seja recomendado).** Está em `sugestao_auto.incluir` (almoço e jantar).
- **Plano B sem frango** (ordem de prioridade para fechar proteína): ovo inteiro → iogurte grego desnatado → Nurri → claras (só à noite).
- Ao sugerir refeições, respeitar as metas e essas restrições sem inventar ingredientes ou disponibilidade; macros só por `dados/alimentos.json`.
- **Proteína distribuída:** ~40–55 g por refeição (≈0,4–0,55 g/kg × 4 refeições). Evitar concentrar tudo numa refeição; o iogurte (pote de 430 g) pode ser dividido entre almoço, lanche e jantar.

## Regras de UX e conteúdo

- Mobile-first, escuro e direto; CSS em `estilo.css` (compartilhado). CSS inline só em páginas legadas.
- Manter a interface em português.
- Manter o badge **NÃO LANÇADO** quando uma refeição/plano ainda for apenas sugestão.
- Não apagar, reescrever ou quebrar dias arquivados ao editar o dia atual.
- Não mudar `lancado` no JSON sem confirmação explícita do usuário (a `sugestao` é refeita automaticamente — pedido do Lucas 01/10); sugestões e consumo confirmado devem permanecer distinguíveis. No dia a dia, editar o JSON — não o HTML do index.

## Comunicação Claude ↔ Grok (via Lucas)

O Lucas copia e cola mensagens entre os dois assistentes. Pra ficar claro de quem é cada pedido:

- Mensagem que começa com **`[CLAUDE → GROK] #N`** foi escrita pelo **Claude** e só repassada pelo Lucas. Tratar como pedido técnico do Claude (mudança de regra, arquivo, script) — não como algo que o Lucas comeu ou pediu no dia a dia.
- Mensagem **sem** esse cabeçalho é do **Lucas** (refeições, peso, pedidos dele).
- Ao responder algo que vai de volta pro Claude, começar com **`[GROK → CLAUDE] #N`** (mesmo número).
- Se o Lucas e o Claude pedirem coisas diferentes, vale o que o Lucas pedir; avise no chat.

## Quem mexe em quê

Dois assistentes trabalham neste repo:

- **Grok** — uso diário: refeições, sugestões, peso, alimentos novos. Mexe só em `dados/`. Virar o dia é automático (não mexer no `data-dia`).
- **Claude** — melhorias do site: `render.js`, `estilo.css`, `historico.js`, `comum.js`, páginas HTML, `scripts/`, `tests/`, `.github/` e este arquivo.
- **Codex** — auditoria/revisão técnica (mensagens `[CODEX → CLAUDE] #N`); mudanças passam pelo mesmo fluxo de verificação.

**Sempre** rodar `git pull --rebase origin main` antes de editar e antes do push. Se aparecer conflito, parar e avisar o Lucas.

## Como o Claude trabalha e responde ao Lucas

**Autonomia:** o Lucas autorizou o Claude a fazer as melhorias do site sem pedir aprovação do plano: fazer uma coisa por vez, testar, commit e push. Continua precisando perguntar antes: redesign grande, mudança de arquitetura ou do fluxo com o Grok, apagar algo, mexer em `dados/` (área do Grok) ou em metas/dieta, e qualquer coisa fora deste repo.

**Formato das respostas** (em português), sempre nesta ordem e só com as seções que tiverem conteúdo:

1. **⚠️ Importante — leia** — o que o Lucas precisa saber ou fazer (ex.: algo quebrou, conferir no iPhone, risco).
2. **❓ Preciso da sua decisão** — perguntas ou pedidos de permissão, numerados, cada um com a recomendação do Claude. Se não houver, omitir.
3. **✅ Feito e testado** — o que mudou, como foi testado, commit.
4. **🔜 Próximo** — **sempre presente ao terminar uma tarefa**: próximos passos, decisões pendentes do Lucas e se o Claude **já pode começar** (ex.: "Posso começar pelo X?").

Curto e direto; detalhe técnico só se ajudar a decidir.

## Como editar com segurança

1. Alterar os arquivos dentro deste repositório (`/workspace/nutricao-hoje-pages/`), nunca uma cópia solta como fonte final.
2. Antes de editar, conferir a data corrente, o status do Git e os arquivos arquivados.
3. Fazer mudanças pequenas e verificáveis; preservar links, datas, metas, badges e a estrutura HTML existente.
4. Revisar o diff e confirmar que nenhum `dia-*.html` legado foi alterado acidentalmente.
5. Fazer commit na branch `main` e publicar com `git push origin main`.
6. Não inventar complexidade. Para um redesign grande, mudança de arquitetura ou alteração do fluxo, perguntar antes ao usuário (ver "Como o Claude trabalha e responde ao Lucas").
7. Toda alteração em `render.js`, `estilo.css`, `historico.js`, `objetivo.js`, `alimentos.js` ou `comum.js` deve incrementar o `?v=` nos HTML que os carregam.
8. Rodar `bash scripts/verificar.sh` antes do push (o GitHub roda de novo e só publica se passar).

## Pendências conhecidas (não resolvidas nesta rodada)

- **Modelo de gordura corporal/Forbes** (`objetivo.js: simular`) — revisar premissas separadamente (fração de Forbes, pausas, faixas).
- **Teste no iPhone real**: os testes usam Chromium e WebKit do Playwright; Safari/iOS real (tela cheia pelo ícone, compartilhar CSV) não é testado automaticamente.

Resolvido: Pages publica por **GitHub Actions** desde 01/10 (Lucas trocou; 1º deploy verificado 52dffe8, caminho rápido provado no run 33 / 0b03c5b) — só vai ao ar o commit verificado; `publicado.json` traz o sha e o tipo de verificação.

## Estado atual

Não é mais mantido à mão: o estado está nos arquivos. Hoje = `data-dia` do `index.html`; dias = `dados/dias.json`; cada dia em `dados/AAAA-MM-DD.json` (`fechado`). Dia 28 set também tem o HTML legado `dia-2026-09-28.html` (**não tocar**).

Conferir os arquivos no repo antes de assumir que o estado continua igual.
