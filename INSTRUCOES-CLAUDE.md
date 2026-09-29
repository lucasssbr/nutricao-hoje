# Instruções para Claude e outros colaboradores de IA

## Objetivo do produto

**Nutrição Hoje** é um rastreador pessoal **simples** de calorias e macros. Não é um aplicativo completo: não adicionar backend, autenticação, banco de dados, PWA pesado, framework, bundler ou etapa de build. O site deve continuar sendo HTML estático servido pelo GitHub Pages, fácil de editar e revisar.

## Metas diárias

- **1570 kcal**
- **P 180 g** (proteína)
- **C 100 g** (carboidratos)
- **G 50 g** (gorduras)

## Tabela de alimentos (valores fixos)

Pesos **sempre crus** (carne, batata). Assistentes usam **somente** esta tabela e **não reestimam**. Alimento novo entra nesta tabela **antes** de ir para o log.

| Alimento | Porção | kcal | P | C | G |
|---|---|---:|---:|---:|---:|
| Nurri Vanilla Milk Shake | 1 lata (325 ml) | 150 | 30 | 3 | 3 |
| Chuck steak Costco CRU | 100 g | 223 | 20 | 0 | 17 |
| Ovo inteiro grande | 1 un | 72 | 7 | 1 | 5 |
| Clara de ovo | 1 un (~34 g) | 18 | 4 | 0 | 0 |
| Clara de ovo | 100 g | 52 | 11 | 1 | 0 |
| Iogurte grego desnatado | 430 g (porção típica do Lucas) | 254 | 43 | 15 | 0 |
| Iogurte grego desnatado | 100 g | 59 | 10 | 3 | 0 |
| Batata inglesa crua | 100 g | 77 | 2 | 17 | 0 |
| Banana média | 1 un | 105 | 1 | 27 | 0 |
| Melancia | 100 g | 30 | 1 | 8 | 0 |
| Tomate | 100 g | 18 | 1 | 4 | 0 |

Notas da tabela:

- Chuck, Nurri, banana, batata e iogurte (430 g) batem com o log do **dia 28** / sugestão do **dia 29**.
- Melancia usa o padrão do **dia 29** (USDA): 100 g = 30 | P1 | C8 | G0. O `dia-2026-09-28.html` permanece com o valor antigo (arquivo fechado).
- Ovo inteiro, clara (por unidade) e tomate (100 g) são referência genérica arredondada a partir dos valores já usados no HTML → marcados **(ref)**: ovo, clara/un, tomate.
- Escala proporcional: ex. chuck 200 g = 446 | P40 | C0 | G34; batata 300 g = 231 | P6 | C52 | G0; melancia 300 g = 90 | P3 | C24 | G0.

**kcal de cada item** = valor da tabela × proporção. **Nunca** recalcular kcal por 4/4/9. Totais = soma dos itens, arredondados a inteiro **só no final**.

- Sugestão: calcular com valores da tabela sem arredondar por item; arredondar só os totais exibidos


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
  "sugestao": [ { "refeicao": "…", "itens": [ … ] } ]
}
```

`atualizado` usa timezone America/Los_Angeles (`-07:00` / `-08:00`).

1. **Início do dia** — criar `dados/YYYY-MM-DD.json` com `lancado: []`, `fechado: false` e `sugestao` completa (macros só pela tabela). Ajustar `index.html` `data-dia` para essa data (uma vez).
2. **Lançar refeição** — editar **somente** o JSON: acrescentar a refeição em `lancado` e atualizar `atualizado`. **Não** editar o HTML do index no dia a dia. Recalcular/refazer `sugestao` do restante se fizer sentido.
3. **Refazer sugestão** — reescrever o array `sugestao` no JSON (+ `atualizado`). Uma sugestão **NUNCA conta como consumo** até o usuário confirmar o lançamento em `lancado`.
4. `sugestao-*.html` de dia futuro continua como rascunho de referência. No início desse dia, montar o JSON do dia com a tabela antes de usar.
5. **Fechar o dia**:
   1. No JSON do dia: `fechado: true` e `atualizado` atual.
   2. Copiar o `index.html` atual → `dia-YYYY-MM-DD.html` (manter `data-dia` fixo nesse arquivo arquivado; ele continua lendo o JSON daquele dia).
   3. Criar o JSON do **próximo** dia com `lancado: []`, meta, sugestão inicial.
   4. Mudar `index.html` `data-dia` para o novo dia.
   5. Histórico: ainda **manual** por enquanto (ver #06) — novo dia no topo com 4 macros + desvio.
   6. Menu "Plano": aponta pro próximo `sugestao-*.html`, ou some.
   7. Atualizar "Estado atual" neste arquivo.
   8. Commit `fechar DD/MM` + push.
   9. Conferir no diff que só o dia recém-arquivado (e o JSON novo) são arquivos novos esperados.

O chat orienta; o **JSON** é o registro editável do dia; o HTML renderiza. Manter datas, consumo (`lancado`) e sugestão claramente separados.

## Commits

Padronizar mensagens assim:

- `log DD/MM: <refeição>` — item(ns) em `lancado` + `atualizado` no JSON
- `sugestao DD/MM: refeita` — array `sugestao` reescrito no JSON
- `fechar DD/MM` — `fechado: true`, arquivar dia-*.html, JSON do próximo dia, `data-dia` no index
- `dados: DD/MM em JSON` — criar/ajustar arquivo do dia
- `docs: <assunto>` — só documentação (ex.: este arquivo)

## Mapa de arquivos

- `dados/YYYY-MM-DD.json` — **fonte da verdade** do dia (lançado, sugestão, meta, fechado, carimbo).
- `index.html` — shell **Hoje**; lê `dados/` + `data-dia`. Não editar macros no HTML no dia a dia.
- `historico.html` — índice/lista dos dias arquivados (ainda manual; automação em #06).
- `dia-*.html` — cópias arquivadas do index no fechamento; `data-dia` fixo; não quebrar.
- `sugestao-*.html` — rascunhos/planos de referência (não são log).
- `INSTRUCOES-CLAUDE.md` — estas regras (tabela, fluxo, commits).
- `.nojekyll` — mantém a publicação estática do GitHub Pages sem processamento Jekyll.

O assistente também mantém o espelho local `/workspace/nutricao-hoje.html` e o PNG correspondente quando esse fluxo for usado. A cópia deste repositório é a que deve ser publicada: depois de revisar, fazer commit na `main` e push para `origin/main` para o GitHub Pages atualizar.

## Regras de alimentação

- Usar **Nurri** como suplemento/bebida; **não usar whey**.
- Chuck: **≤ 200 g CRU/dia**, tanto no **log** quanto na **sugestão**.
- Dar preferência a batata, frutas, tomate, iogurte grego desnatado e **ovos inteiros**.
- Claras de ovo: **só à noite** e somente se forem necessárias para fechar a proteína/macros.
- Frango é opcional e pode estar indisponível; não presumir que há frango.
- **Plano B sem frango** (ordem de prioridade para fechar proteína): ovo inteiro → iogurte grego desnatado → Nurri → claras (só à noite).
- Ao sugerir refeições, respeitar as metas e essas restrições sem inventar ingredientes ou disponibilidade; macros só pela tabela acima.

## Regras de UX e conteúdo

- Mobile-first, escuro e direto; CSS inline é aceitável.
- Manter a interface em português.
- Manter o badge **NÃO LANÇADO** quando uma refeição/plano ainda for apenas sugestão.
- Não apagar, reescrever ou quebrar dias arquivados ao editar o dia atual.
- Não mudar `lancado` / `sugestao` no JSON sem confirmação explícita do usuário; sugestões e consumo confirmado devem permanecer distinguíveis. No dia a dia, editar o JSON — não o HTML do index.

## Como editar com segurança

1. Alterar os arquivos dentro deste repositório (`/workspace/nutricao-hoje-pages/`), nunca uma cópia solta como fonte final.
2. Antes de editar, conferir a data corrente, o status do Git e os arquivos arquivados.
3. Fazer mudanças pequenas e verificáveis; preservar links, datas, metas, badges e a estrutura HTML existente.
4. Revisar o diff e confirmar que nenhum `dia-*.html` foi alterado acidentalmente (salvo fechamento de dia intencional).
5. Fazer commit na branch `main` e publicar com `git push origin main`.
6. Não inventar complexidade. Para um redesign grande, mudança de arquitetura ou alteração do fluxo, perguntar antes ao usuário.

## Estado atual

Atualizar **esta seção a cada fechamento de dia**.

- Data de referência: **2026-09-29**
- Dia **28 set 2026** arquivado em `dia-2026-09-28.html` (total 1576 | P180 | C126 | G43) — HTML estático pré-JSON.
- Dia **29 set 2026** = **Hoje**: `index.html` (`data-dia="2026-09-29"`) + `dados/2026-09-29.json` — `lancado: []`, sugestão **não lançada** (1549 | P180 | C100 | G50), `fechado: false`.
- `sugestao-2026-09-30.html` existe (plano de referência, não é log).
- Histórico ainda manual (#06).

Conferir os arquivos no repo antes de assumir que o estado continua igual.
