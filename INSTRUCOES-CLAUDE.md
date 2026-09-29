# Instruções para Claude e outros colaboradores de IA

## Objetivo do produto

**Nutrição Hoje** é um rastreador pessoal **simples** de calorias e macros. Não é um aplicativo completo: não adicionar backend, autenticação, banco de dados, PWA pesado, framework, bundler ou etapa de build. O site deve continuar sendo HTML estático servido pelo GitHub Pages, fácil de editar e revisar.

## Metas diárias

- **1570 kcal**
- **P 180 g** (proteína)
- **C 100 g** (carboidratos)
- **G 50 g** (gorduras)

## Fluxo diário: chat + HTML

1. No início do dia, preparar uma **sugestão completa** para o dia.
2. Quando uma refeição for lançada/confirmada, recalcular o que já foi consumido e refazer a sugestão do **restante do dia**.
3. Uma sugestão **NUNCA conta como consumo** até que o usuário a confirme explicitamente. Não transformar alimentos apenas sugeridos em refeições lançadas.
4. Ao fechar o dia:
   - arquivar a página como `dia-YYYY-MM-DD.html`;
   - atualizar `historico.html` com o novo dia;
   - resetar `index.html` para o próximo dia, sem carregar refeições ou consumo do dia anterior.

O chat orienta as mudanças e o HTML é o registro visível. Manter datas, valores de consumo e valores sugeridos claramente separados.

## Mapa de arquivos

- `index.html` — página **Hoje**, o dia corrente e seu estado atual.
- `historico.html` — índice/lista dos dias arquivados.
- `dia-*.html` — páginas fechadas e arquivadas; são registros históricos e não devem ser quebradas.
- `sugestao-*.html` — sugestões completas de um dia, inclusive sugestões futuras ainda não lançadas.
- `.nojekyll` — mantém a publicação estática do GitHub Pages sem processamento Jekyll.

O assistente também mantém o espelho local `/workspace/nutricao-hoje.html` e o PNG correspondente quando esse fluxo for usado. A cópia deste repositório é a que deve ser publicada: depois de revisar, fazer commit na `main` e push para `origin/main` para o GitHub Pages atualizar.

## Regras de alimentação

- Usar **Nurri** como suplemento/bebida; **não usar whey**.
- Chuck: no máximo aproximadamente **200 g cru por dia**, por ser uma opção com bastante gordura.
- Dar preferência a batata, frutas, tomate, iogurte grego sem gordura e ovos inteiros.
- Claras de ovo ficam para a noite e somente se forem necessárias para fechar a proteína/macros.
- Frango é opcional e pode estar indisponível; não presumir que há frango.
- Ao sugerir refeições, respeitar as metas e essas restrições sem inventar ingredientes ou disponibilidade.

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
4. Revisar o diff e confirmar que nenhum `dia-*.html` foi alterado acidentalmente.
5. Fazer commit na branch `main` e publicar com `git push origin main`.
6. Não inventar complexidade. Para um redesign grande, mudança de arquitetura ou alteração do fluxo, perguntar antes ao usuário.

## Contexto atual — 2026-09-29

- O dia **28 set** está arquivado.
- O dia **29 set** é o **Hoje** (`index.html`) e tem uma sugestão de início do dia.
- `sugestao-2026-09-30.html` existe.

Essas informações são o estado conhecido em 2026-09-29; conferir os arquivos antes de assumir que o estado continua igual.
