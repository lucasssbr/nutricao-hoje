# Instruções para Claude e outros colaboradores de IA

## Objetivo do produto

**Nutrição Hoje** é um rastreador pessoal **simples** de calorias e macros. Não é um aplicativo completo: não adicionar backend, autenticação, banco de dados, PWA pesado, framework, bundler ou etapa de build. O site deve continuar sendo HTML estático servido pelo GitHub Pages, fácil de editar e revisar.

## Metas diárias

- **1570 kcal**
- **P 180 g** (proteína)
- **C 100 g** (carboidratos)
- **G 50 g** (gorduras)

## Biblioteca de alimentos (`dados/alimentos.json`)

Todos os valores nutricionais ficam em **`dados/alimentos.json`** — é a única fonte. Pesos **sempre crus** (carne, batata). Cada entrada tem `nome`, `apelidos`, `base` (100 g, 1 un, 1 lata…), `kcal`/`p`/`c`/`g`, `fonte` e `salvo_em`.

`fonte` pode ser: `rotulo` · `usda` · `openfoodfacts` · `lucas` (valor informado pelo Lucas) · `estimado`.

### Regra de busca (alimento citado no chat)

1. Procurar primeiro em `alimentos.json` (pelo nome ou apelido). Achou → **usar, sem pesquisar**.
2. Não achou → buscar nesta ordem: **rótulo** (se o Lucas mandou foto) → **USDA FoodData Central** (alimento in natura) → **Open Food Facts** (industrializado / código de barras) → **estimativa** (último caso).
3. **Antes de logar**, salvar o alimento novo em `alimentos.json` com `fonte` e `salvo_em`, e avisar no chat: "novo na biblioteca: X (fonte)". Commit `dados: alimento <nome>`.
4. Alimento com `fonte: estimado` → perguntar ao Lucas se ele tem o rótulo; com o rótulo, atualizar a entrada e a fonte.
5. Nunca alterar uma entrada existente sem avisar no chat (valor antigo → novo). Dias já fechados não são recalculados.

Pendentes de rótulo: **chuck Costco** (`estimado`), **Nurri** (`lucas`), **iogurte grego** (marca usada).

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
  "lancado": [ { "refeicao": "…", "itens": [ { "nome", "qtd", "kcal", "p", "c", "g" } ] } ],
  "sugestao": [ { "refeicao": "…", "itens": [ … ] } ],
  "sugestao_nota": "opcional — dica do card e sob o Dia projetado"
}
```

`sugestao_nota` é **opcional**. Se presente (string não vazia): vira o hint do card de sugestão **e** aparece debaixo de "Dia projetado". Se ausente: não mostra nenhum dos dois. **Sem** hint hardcoded no JS.

Título do card de sugestão: **"Sugestão do dia"** quando `lancado` está vazio; **"Pra fechar o dia"** quando `lancado` tem itens.

`atualizado` usa timezone America/Los_Angeles (`-07:00` / `-08:00`).

1. **Início do dia** — criar `dados/YYYY-MM-DD.json` com `lancado: []`, `fechado: false` e `sugestao` completa (macros só por `alimentos.json`). **Acrescentar a data em `dados/dias.json`**. Ajustar `index.html` `data-dia` para essa data (uma vez).
2. **Lançar refeição** — editar **somente** o JSON: acrescentar a refeição em `lancado` e atualizar `atualizado`. **Não** editar o HTML do index no dia a dia. Recalcular/refazer `sugestao` do restante se fizer sentido.
3. **Refazer sugestão** — reescrever o array `sugestao` no JSON (+ `atualizado`). Uma sugestão **NUNCA conta como consumo** até o usuário confirmar o lançamento em `lancado`.
4. Planos futuros: criar `dados/YYYY-MM-DD.json` e apontar o menu **Plano** para `dia.html?d=YYYY-MM-DD`. Arquivos `sugestao-*.html` antigos são só referência.
5. **Peso do dia** — no chat, mensagem tipo `peso 82,4` (vírgula ou ponto): gravar `peso_kg` (número) no JSON do **Hoje**, atualizar `atualizado`, commit `peso DD/MM` + push. O Hoje/`dia.html` mostram "Peso 82,4 kg" sob a data; o Histórico usa o valor nos cards quando o dia está fechado.
6. **Fechar o dia** (simplificado — **não** copiar mais `index` → `dia-*.html`):
   1. No JSON do dia: `fechado: true` e `atualizado` atual.
   2. Histórico atualiza **sozinho** (`historico.html` + `historico.js` lê `dados/dias.json` e só lista `fechado: true`) — **não** editar o HTML do histórico.
   3. Mudar `index.html` `data-dia` para o **próximo** dia; se o JSON desse dia já existir, ele vira o Hoje.
   4. Criar o JSON do próximo dia (plano/sugestão) se ainda não existir, **incluir a data em `dados/dias.json`**, e apontar o botão **Plano** do menu para `dia.html?d=YYYY-MM-DD` desse plano.
   5. Atualizar "Estado atual" neste arquivo.
   6. Commit `fechar DD/MM` + push.

Arquivos `dia-YYYY-MM-DD.html` antigos (ex.: `dia-2026-09-28.html`) ficam no repo como arquivo estático legado — **não** tocá-los e **não** criar cópias novas do index. Dias a partir da generic `dia.html` abrem via query string.

O chat orienta; o **JSON** é o registro editável do dia; o HTML renderiza. Manter datas, consumo (`lancado`) e sugestão claramente separados.

## Commits

Padronizar mensagens assim:

- `log DD/MM: <refeição>` — item(ns) em `lancado` + `atualizado` no JSON
- `sugestao DD/MM: refeita` — array `sugestao` reescrito no JSON
- `fechar DD/MM` — `fechado: true`, `data-dia` no próximo, JSON/plano do próximo (+ `dias.json`), push (sem copiar index→dia-*.html; histórico é automático)
- `peso DD/MM` — `peso_kg` no JSON do dia + `atualizado`
- `dados: DD/MM em JSON` — criar/ajustar arquivo do dia (+ entrada em `dias.json` se for novo)
- `docs: <assunto>` — só documentação (ex.: este arquivo)

## Mapa de arquivos

- `dados/dias.json` — índice ordenado de datas (`["YYYY-MM-DD", …]`); todo JSON novo entra aqui.
- `dados/YYYY-MM-DD.json` — **fonte da verdade** do dia (lançado, sugestão, `sugestao_nota`, meta, `peso_kg`, fechado, carimbo).
- `index.html` — shell **Hoje**; `body data-dia="YYYY-MM-DD"` + `estilo.css` + `render.js`. Não editar macros no HTML no dia a dia.
- `dia.html` — shell genérico de qualquer dia; **sem** `data-dia`. Lê `?d=YYYY-MM-DD` e busca `dados/{d}.json`. Título mostra a data (ex.: "30 set"), não "Hoje".
- `estilo.css` — CSS compartilhado (extraído do index).
- `render.js` — script compartilhado: se `body[data-dia]` → modo Hoje (index); senão → usa `?d=` (dia.html). Erro: "Não consegui carregar os dados de DD/MM".
- `historico.html` + `historico.js` — lista automática dos dias com `fechado: true` (via `dias.json`); card “Últimos 7 dias”; links para `dia.html?d=…`.
- `dia-*.html` — **legado** (ex.: `dia-2026-09-28.html`); não tocar; novos dias usam só `dia.html?d=`.
- `sugestao-*.html` — rascunhos antigos de referência (não são log; menu Plano aponta para `dia.html?d=`).
- `INSTRUCOES-CLAUDE.md` — estas regras (fluxo, busca de alimentos, commits).
- `.nojekyll` — mantém a publicação estática do GitHub Pages sem processamento Jekyll.

O repositório é a única fonte do site; não manter espelho local separado. Para gerar PNG para o chat, fazer screenshot do site publicado ou de um servidor local servindo esta pasta do repo e esperar o render terminar. Mac/iCloud é opcional: se necessário, copiar a pasta inteira, incluindo HTML, CSS, JS e `dados/`.

## Regras de alimentação

- Usar **Nurri** como suplemento/bebida; **não usar whey**.
- Chuck: **≤ 200 g CRU/dia**, tanto no **log** quanto na **sugestão**.
- Dar preferência a batata, frutas, tomate, iogurte grego desnatado e **ovos inteiros**.
- Claras de ovo: **só à noite** e somente se forem necessárias para fechar a proteína/macros.
- Frango é opcional e pode estar indisponível; não presumir que há frango.
- **Plano B sem frango** (ordem de prioridade para fechar proteína): ovo inteiro → iogurte grego desnatado → Nurri → claras (só à noite).
- Ao sugerir refeições, respeitar as metas e essas restrições sem inventar ingredientes ou disponibilidade; macros só por `dados/alimentos.json`.

## Regras de UX e conteúdo

- Mobile-first, escuro e direto; CSS em `estilo.css` (compartilhado). CSS inline só em páginas legadas.
- Manter a interface em português.
- Manter o badge **NÃO LANÇADO** quando uma refeição/plano ainda for apenas sugestão.
- Não apagar, reescrever ou quebrar dias arquivados ao editar o dia atual.
- Não mudar `lancado` / `sugestao` no JSON sem confirmação explícita do usuário; sugestões e consumo confirmado devem permanecer distinguíveis. No dia a dia, editar o JSON — não o HTML do index.

## Quem mexe em quê

Dois assistentes trabalham neste repo:

- **Grok** — uso diário: refeições, sugestões, peso, fechar o dia, alimentos novos. Mexe só em `dados/` (e em `index.html` apenas no `data-dia`, ao virar o dia).
- **Claude** — melhorias do site: `render.js`, `estilo.css`, `historico.js`, páginas HTML e este arquivo.

**Sempre** rodar `git pull --rebase origin main` antes de editar e antes do push. Se aparecer conflito, parar e avisar o Lucas.

## Como editar com segurança

1. Alterar os arquivos dentro deste repositório (`/workspace/nutricao-hoje-pages/`), nunca uma cópia solta como fonte final.
2. Antes de editar, conferir a data corrente, o status do Git e os arquivos arquivados.
3. Fazer mudanças pequenas e verificáveis; preservar links, datas, metas, badges e a estrutura HTML existente.
4. Revisar o diff e confirmar que nenhum `dia-*.html` legado foi alterado acidentalmente.
5. Fazer commit na branch `main` e publicar com `git push origin main`.
6. Não inventar complexidade. Para um redesign grande, mudança de arquitetura ou alteração do fluxo, perguntar antes ao usuário.
7. Toda alteração em `render.js` ou `estilo.css` deve incrementar o `?v=` nos dois HTML (`index.html` e `dia.html`).

## Estado atual

Atualizar **esta seção a cada fechamento de dia**.

- Data de referência: **2026-09-29**
- Índice: `dados/dias.json` → 28, 29 e 30 set 2026.
- Dia **28 set 2026**: `dados/2026-09-28.json` (`fechado: true`, ~1576 | P181 | C126 | G43) + HTML legado `dia-2026-09-28.html` (**não tocar**).
- Dia **29 set 2026** = **Hoje**: `index.html` (`data-dia="2026-09-29"`) + `dados/2026-09-29.json` — `lancado: []`, sugestão **não lançada** (~1549 | P180 | C100 | G50) + `sugestao_nota`, `fechado: false`, `peso_kg: null`.
- Plano **30 set 2026**: `dados/2026-09-30.json` (`fechado: false`, `lancado: []`, sugestão ~1568 | P185 | C104 | G50). Menu **Plano** → `dia.html?d=2026-09-30`.
- `sugestao-2026-09-30.html` permanece no repo (rascunho antigo); **fora** dos menus.
- Shells: `estilo.css` + `render.js`; `dia.html?d=` para qualquer dia; peso sob a data quando `peso_kg` está no JSON.
- Histórico automático (#07): `historico.html` + `historico.js` (só `fechado: true`).

Conferir os arquivos no repo antes de assumir que o estado continua igual.
