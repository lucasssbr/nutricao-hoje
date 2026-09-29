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
| Melancia | 100 g | 24 | 0 | 6 | 0 |
| Tomate | 100 g | 18 | 1 | 4 | 0 |

Notas da tabela:

- Chuck, Nurri, banana, batata, melancia e iogurte (430 g) batem com o log do **dia 28** / sugestão do **dia 29**.
- Ovo inteiro, clara (por unidade) e tomate (100 g) são referência genérica arredondada a partir dos valores já usados no HTML → marcados **(ref)** no sentido de Claude: ovo, clara/un, tomate.
- Escala proporcional: ex. chuck 200 g = 446 | P40 | C0 | G34; batata 300 g = 231 | P6 | C52 | G0; melancia 300 g = 72 | P1 | C18 | G0.

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

## Fluxo diário: chat + HTML

1. No início do dia, preparar uma **sugestão completa** para o dia.
2. Quando uma refeição for lançada/confirmada, recalcular o que já foi consumido e refazer a sugestão do **restante do dia**.
3. Uma sugestão **NUNCA conta como consumo** até que o usuário a confirme explicitamente. Não transformar alimentos apenas sugeridos em refeições lançadas.
4. Ao fechar o dia:
   - arquivar a página como `dia-YYYY-MM-DD.html`;
   - atualizar `historico.html` com o novo dia;
   - resetar `index.html` para o próximo dia, sem carregar refeições ou consumo do dia anterior;
   - **atualizar a seção Estado atual** neste arquivo.

O chat orienta as mudanças e o HTML é o registro visível. Manter datas, valores de consumo e valores sugeridos claramente separados.

## Commits

Padronizar mensagens assim:

- `log DD/MM: <refeição>` — refeição lançada/confirmada
- `sugestao DD/MM: refeita` — sugestão do dia ou do restante refeita
- `fechar DD/MM` — arquivar o dia e resetar o index
- `docs: <assunto>` — só documentação (ex.: este arquivo)

## Mapa de arquivos

- `index.html` — página **Hoje**, o dia corrente e seu estado atual.
- `historico.html` — índice/lista dos dias arquivados.
- `dia-*.html` — páginas fechadas e arquivadas; são registros históricos e não devem ser quebradas.
- `sugestao-*.html` — sugestões completas de um dia, inclusive sugestões futuras ainda não lançadas.
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
- Não mudar o conteúdo das refeições do `index.html` sem uma confirmação explícita do usuário; sugestões e consumo confirmado devem permanecer distinguíveis.

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
- Dia **28 set 2026** arquivado em `dia-2026-09-28.html` (total 1576 | P180 | C126 | G43).
- Dia **29 set 2026** = **Hoje** (`index.html`): consumido **0**, com sugestão completa **não lançada** (~1549 | P180 | C100 | G50).
- `sugestao-2026-09-30.html` existe (plano de referência, não é log).

Conferir os arquivos no repo antes de assumir que o estado continua igual.
