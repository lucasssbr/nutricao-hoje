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

Pendentes de rótulo: **Nurri** (`lucas`), **iogurte grego** (marca usada).

### Calcular itens: SEMPRE com o script (não fazer conta à mão)

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

### Objetivo com data alvo (`dados/objetivo.json`)

- `atual` = objetivo em andamento: `nome`, `inicio`, `data_alvo`, `metas` (kcal/p/c/g do dia), `gasto_kcal` (opcional, informado pelo Lucas), `peso_inicial_kg`, `meta_semanal_kg` (kg a perder por semana). O site mostra no Hoje: dias que faltam, meta da semana, peso de hoje vs esperado; no Histórico: linha tracejada da meta no gráfico e projeção pelo ritmo.
- Lucas muda algo ("meta de 0,5 kg por semana", "adia a data pra 24/10", "muda o nome") → editar `atual`, `validar.py`, commit `dados: objetivo`.
- **Novo objetivo** ("novo objetivo: 15/11, perder 0,5 kg por semana") → mover o `atual` para o fim de `anteriores` acrescentando `"peso_final_kg"` (último peso registrado) e `"encerrado_em"` (hoje); criar novo `atual` com `inicio` = hoje, `peso_inicial_kg` = peso mais recente e as **novas `metas`** (perguntar ao Lucas as metas e o gasto calórico dele; sem resposta, manter as metas anteriores). Atualizar o `meta` do dia aberto. Confirmar no chat: data alvo, metas, meta semanal, peso esperado na data alvo.
- **Meta semanal automática (`meta_modo: "auto"`)**: `python3 scripts/meta.py` calcula pelo déficit — gasto − média de kcal lançadas nos dias fechados do objetivo — e grava `meta_semanal_kg` + `calculo`. Roda sozinho à meia-noite. **Grok roda `meta.py` depois de gravar um peso novo** (junto no mesmo commit).
- **Gasto calórico do objetivo (`gasto_kcal`)**: é o Lucas quem define. Ele diz "meu gasto é 2500" → gravar `"gasto_kcal": 2500` em `objetivo.atual`, rodar `meta.py`, `validar.py`, commit `dados: objetivo`. Com `gasto_kcal`, o `meta.py` usa esse número; sem ele, usa a estimativa (Mifflin-St Jeor com `dados/perfil.json` × fator de atividade), que é só uma noção. **Não** criar gasto adaptativo/calculado pelo peso: o Lucas faz essa análise. Em objetivo novo, perguntar o gasto dele.
- Lucas diz quantos treinos faz / nível de atividade → ajustar `atividade` em `dados/perfil.json` (1.2 sedentário · 1.375 leve · 1.55 moderado · 1.725 intenso), rodar `meta.py`, commit `dados: perfil`.
- Lucas quer uma meta fixa ("quero 0,5 kg por semana") → `meta_modo: "manual"` + `meta_semanal_kg`. Voltar pro cálculo: `meta_modo: "auto"` + `meta.py`.
- Meta acima de 1,2 kg/semana gera aviso na checagem: comentar com o Lucas antes de salvar.

**Antes de todo push** que mexa em `dados/`: `python3 scripts/validar.py` tem que dizer "Dados OK". O GitHub roda a mesma checagem a cada envio (workflow "Conferir dados") e avisa o Lucas por e-mail se falhar. O mesmo workflow também **abre as páginas num navegador** (`scripts/testar_paginas.js`: Hoje, dia, prévia, Histórico, Alimentos) e falha se alguma quebrar. Claude: ao mexer em HTML/JS/CSS, rodar local antes do push (`python3 -m http.server 8765 &` + `node scripts/testar_paginas.js http://localhost:8765`). A partir de 29/09, todo item de dia aberto precisa ter `alimento` + `quantidade`.

Escala proporcional: ex. chuck 200 g = 446 | P40 | C0 | G34; batata 300 g = 231 | P6 | C51 | G0; melancia 300 g = 90 | P3 | C24 | G0.

**kcal de cada item** = valor de `alimentos.json` × proporção. **Nunca** recalcular kcal por 4/4/9. Totais = soma dos itens, arredondados a inteiro **só no final**.

- Sugestão: calcular com valores de `alimentos.json` sem arredondar por item; arredondar só os totais exibidos


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
```

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

1. **Início do dia** — o JSON do dia e o `data-dia` já foram criados pelo fechamento automático da meia-noite. O Grok só faz `git pull` e, se `sugestao` estiver vazia, escreve a sugestão completa (macros só por `alimentos.json`). **Não** mexer no `data-dia` do index.
2. **Lançar refeição** — editar **somente** o JSON: acrescentar a refeição em `lancado` e atualizar `atualizado`. **Não** editar o HTML do index no dia a dia. Recalcular/refazer `sugestao` do restante se fizer sentido.
3. **Refazer sugestão** — reescrever o array `sugestao` no JSON (+ `atualizado`). Uma sugestão **NUNCA conta como consumo** até o usuário confirmar o lançamento em `lancado`.
4. Planos futuros: criar `dados/YYYY-MM-DD.json` e apontar o menu **Plano** para `dia.html?d=YYYY-MM-DD`. Arquivos `sugestao-*.html` antigos foram removidos; dia futuro sem arquivo mostra uma prévia do plano padrão em `dia.html?d=`.
5. **Peso do dia** — no chat, mensagem tipo `peso 82,4` (vírgula ou ponto): gravar `peso_kg` (número) no JSON do **Hoje**, atualizar `atualizado`, commit `peso DD/MM` + push. O Hoje/`dia.html` mostram "Peso 82,4 kg (181,7 lb)" sob a data; o Histórico usa o valor nos cards quando o dia está fechado.
6. **Fechar o dia — AUTOMÁTICO à meia-noite (Los Angeles)**. O GitHub Actions (`.github/workflows/fechar-dia.yml` → `scripts/fechar_dia.py`) faz sozinho:
   1. `fechado: true` em todo dia passado ainda aberto;
   2. cria o JSON do novo dia se não existir, **já com o plano padrão como sugestão** (`dados/refeicoes.json`), e inclui em `dados/dias.json`;
   3. muda `data-dia` do `index.html` para o novo dia;
   4. aponta o botão **Plano** para o dia seguinte.
   Commit `fechar DD/MM (automático)`. **Ninguém precisa fechar o dia na mão.** Se o Lucas pedir "fecha o dia" antes da meia-noite, basta `fechado: true` no JSON; o resto o script faz.
   **Refeição que atravessa a meia-noite — vale a hora em que o Lucas comeu.** Comeu às 23:50 e mandou depois da meia-noite → lançar no JSON do **dia anterior** (em `lancado`, mesmo com `fechado: true`; **não** mexer em `fechado`), atualizar `atualizado`, commit `log DD/MM: <refeição> (atrasado)`. Comeu depois da meia-noite → dia novo. Na dúvida sobre a hora, perguntar. O fechamento automático não reabre nada.
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

## Mapa de arquivos

- `dados/dias.json` — índice ordenado de datas (`["YYYY-MM-DD", …]`); todo JSON novo entra aqui.
- `dados/resumo.json` — **gerado automaticamente** à meia-noite (`scripts/resumo.py`): totais/meta/peso de cada dia, para o Histórico carregar rápido. Ninguém edita à mão; o Histórico busca os 3 dias mais recentes direto do JSON do dia.
- `dados/YYYY-MM-DD.json` — **fonte da verdade** do dia (lançado, sugestão, `sugestao_nota`, meta, `peso_kg`, fechado, carimbo).
- `index.html` — shell **Hoje**; `body data-dia="YYYY-MM-DD"` + `estilo.css` + `render.js`. Não editar macros no HTML no dia a dia.
- `dia.html` — shell genérico de qualquer dia; **sem** `data-dia`. Lê `?d=YYYY-MM-DD` e busca `dados/{d}.json`. Título mostra a data (ex.: "30 set"), não "Hoje".
- `estilo.css` — CSS compartilhado (extraído do index).
- `render.js` — script compartilhado: se `body[data-dia]` → modo Hoje (index); senão → usa `?d=` (dia.html). Erro: "Não consegui carregar os dados de DD/MM".
- `historico.html` + `historico.js` — lista automática dos dias com `fechado: true` (via `dias.json`); card “Últimos 7 dias”; links para `dia.html?d=…`.
- `dia-*.html` — **legado** (ex.: `dia-2026-09-28.html`); não tocar; novos dias usam só `dia.html?d=`.
- `dados/refeicoes.json` — refeições favoritas + plano padrão (sugestão automática).
- `alimentos.html` + `alimentos.js` — página **Alimentos** (só leitura): favoritas com total, plano padrão do dia e a biblioteca com a fonte de cada alimento.
- `dados/objetivo.json` — objetivo com data alvo e meta semanal; `objetivo.js` desenha o card e a meta no gráfico.
- `dados/perfil.json` — altura, mês/ano de nascimento, sexo, fator de atividade (repo público: só o necessário). `scripts/meta.py` — meta semanal pelo déficit.
- `apple-touch-icon.png` / `icone-512.png` — ícone da tela inicial.
- `scripts/item.py` — calculadora de itens e refeições (Grok usa pra lançar/sugerir). `scripts/validar.py` — checagem dos dados. `scripts/fechar_dia.py` — fechamento da meia-noite.
- `INSTRUCOES-CLAUDE.md` — estas regras (fluxo, busca de alimentos, commits).
- `.nojekyll` — mantém a publicação estática do GitHub Pages sem processamento Jekyll.

O repositório é a única fonte do site; não manter espelho local separado. Para gerar PNG para o chat, fazer screenshot do site publicado ou de um servidor local servindo esta pasta do repo e esperar o render terminar. Mac/iCloud é opcional: se necessário, copiar a pasta inteira, incluindo HTML, CSS, JS e `dados/`.

## Regras de alimentação

- Usar **Nurri** como suplemento/bebida; **não usar whey**.
- Chuck: **≤ 200 g CRU/dia**, tanto no **log** quanto na **sugestão**. O limite fica em `alimentos.json` → `chuck-costco.limite_dia_g` (o Hoje mostra "Acém 150 / 200 g cru" e a checagem avisa). Outro alimento com limite diário: acrescentar `limite_dia_g` nele.
- Dar preferência a batata, frutas, tomate, iogurte grego desnatado e **ovos inteiros**.
- Claras de ovo: **só à noite** e somente se forem necessárias para fechar a proteína/macros.
- Frango é opcional e pode estar indisponível; não presumir que há frango.
- **Plano B sem frango** (ordem de prioridade para fechar proteína): ovo inteiro → iogurte grego desnatado → Nurri → claras (só à noite).
- Ao sugerir refeições, respeitar as metas e essas restrições sem inventar ingredientes ou disponibilidade; macros só por `dados/alimentos.json`.
- **Proteína distribuída:** ~40–55 g por refeição (≈0,4–0,55 g/kg × 4 refeições). Evitar concentrar tudo numa refeição; o iogurte (pote de 430 g) pode ser dividido entre almoço, lanche e jantar.

## Regras de UX e conteúdo

- Mobile-first, escuro e direto; CSS em `estilo.css` (compartilhado). CSS inline só em páginas legadas.
- Manter a interface em português.
- Manter o badge **NÃO LANÇADO** quando uma refeição/plano ainda for apenas sugestão.
- Não apagar, reescrever ou quebrar dias arquivados ao editar o dia atual.
- Não mudar `lancado` / `sugestao` no JSON sem confirmação explícita do usuário; sugestões e consumo confirmado devem permanecer distinguíveis. No dia a dia, editar o JSON — não o HTML do index.

## Quem mexe em quê

Dois assistentes trabalham neste repo:

- **Grok** — uso diário: refeições, sugestões, peso, alimentos novos. Mexe só em `dados/`. Virar o dia é automático (não mexer no `data-dia`).
- **Claude** — melhorias do site: `render.js`, `estilo.css`, `historico.js`, páginas HTML, `scripts/`, `.github/` e este arquivo.

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
7. Toda alteração em `render.js`, `estilo.css` ou `historico.js` deve incrementar o `?v=` nos HTML que os carregam.

## Estado atual

Não é mais mantido à mão: o estado está nos arquivos. Hoje = `data-dia` do `index.html`; dias = `dados/dias.json`; cada dia em `dados/AAAA-MM-DD.json` (`fechado`). Dia 28 set também tem o HTML legado `dia-2026-09-28.html` (**não tocar**).

Conferir os arquivos no repo antes de assumir que o estado continua igual.
