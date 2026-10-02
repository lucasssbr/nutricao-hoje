#!/usr/bin/env node
/* Fluxos do planejador (planejar.html) num navegador de verdade — Chromium e WebKit (o motor do Safari).
   Roda em scripts/verificar.sh depois de testar_paginas.js. Cobre: editar/adicionar/remover/trocar, vírgula
   decimal e quantidade inválida, desfazer/restaurar, rascunho que sobrevive ao recarregar, base que mudou
   (registro novo do Grok, sugestão oficial nova, alimento removido da biblioteca), armazenamento e
   área de transferência indisponíveis, foco/teclado, nada de rolagem horizontal e nenhuma escrita no servidor.
   Datas: relógio do navegador fixado na véspera do dia da prévia (dados/previa.json), em Los Angeles.
   Não substitui o teste no iPhone real. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pw = require('playwright');

const BASE = (process.argv[2] || 'http://localhost:8765').replace(/\/$/, '');
const ROOT = path.resolve(process.env.RAIZ || path.join(__dirname, '..'));
const NAVEGADORES = (process.env.NAVEGADORES || 'chromium,webkit').split(',').map((s) => s.trim()).filter(Boolean);
const previa = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados', 'previa.json'), 'utf8'));
const DIA = previa.para;
const VESPERA = new Date(Date.parse(DIA + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
const AGORA = new Date(VESPERA + 'T20:00:00Z');   // 13h (verão) / 12h (inverno) em LA, na véspera
const ali = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados', 'alimentos.json'), 'utf8'));

function hashDados() {
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(path.join(ROOT, 'dados')).sort()) h.update(f).update(fs.readFileSync(path.join(ROOT, 'dados', f)));
  return h.digest('hex');
}

function checar(cond, msg, erros) { if (!cond) erros.push(msg); }

async function abrir(ctx, url, opcoes = {}) {
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push('JS: ' + e.message));
  page.on('request', (r) => { if (r.method() !== 'GET') erros.push('escrita no servidor: ' + r.method() + ' ' + r.url()); });
  await page.clock.setFixedTime(AGORA);
  if (opcoes.init) await page.addInitScript(opcoes.init);
  if (opcoes.rotas) for (const [pad, fn] of opcoes.rotas) await page.route(pad, fn);
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#resumo', { timeout: 5000 });
  return { page, erros };
}

const num = async (page, linha, col) => Number((await page.locator(`#resumo tbody tr:nth-child(${linha}) td:nth-child(${col})`).innerText()).replace('+', ''));
const kcalRascunho = (page) => num(page, 2, 2);
const kcalProjetado = (page) => num(page, 3, 2);

async function fluxoEdicao(ctx) {
  const erros = [];
  const { page, erros: e } = await abrir(ctx, '/planejar.html?d=' + DIA);
  checar(await page.locator('.pl-faixa .badge').isVisible(), '"NÃO LANÇADO" não está visível', erros);
  checar(/amanhã/.test(await page.locator('#pageDate').innerText()), 'data não diz "amanhã"', erros);
  const k0 = await kcalRascunho(page);
  checar(k0 > 0, 'rascunho começou vazio', erros);
  // largura: nada de rolagem horizontal
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  checar(sw <= iw, `rolagem horizontal (${sw} > ${iw})`, erros);
  // toda caixa de quantidade tem nome acessível e teclado decimal
  const inputs = page.locator('.pl-qtd input');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const inp = inputs.nth(i);
    const id = await inp.getAttribute('id');
    checar((await page.locator(`label[for="${id}"]`).count()) === 1, `quantidade ${id} sem rótulo`, erros);
    checar((await inp.getAttribute('inputmode')) === 'decimal', `quantidade ${id} sem teclado decimal`, erros);
  }
  // quantidade com vírgula (item em gramas)
  const gIdx = await page.evaluate(() => [...document.querySelectorAll('.pl-qtd')].findIndex((l) => l.querySelector('.un').textContent === 'g'));
  const qg = inputs.nth(gIdx);
  const idg = await qg.getAttribute('id');
  await qg.fill('123,5');
  await qg.press('Enter');
  await page.waitForTimeout(100);
  checar((await page.locator('#' + idg).inputValue()) === '123,5', 'vírgula decimal não foi aceita', erros);
  const k1 = await kcalRascunho(page);
  checar(k1 !== k0, 'total não mudou depois de editar a quantidade', erros);
  // inválida: mostra erro e mantém o valor
  await page.locator('#' + idg).fill('abc');
  await page.locator('#' + idg).press('Enter');
  checar(/inválida/.test(await page.locator('#erro-' + idg).innerText()), 'quantidade inválida sem mensagem', erros);
  checar((await page.locator('#' + idg).getAttribute('aria-invalid')) === 'true', 'campo inválido sem aria-invalid', erros);
  checar((await kcalRascunho(page)) === k1, 'quantidade inválida mudou o total', erros);
  await page.locator('#' + idg).fill('0');
  await page.locator('#' + idg).press('Enter');
  checar((await kcalRascunho(page)) === k1, 'quantidade zero foi aceita', erros);
  // sequência vista no iPhone real (01/10): erro antigo + digitar valor válido → o aviso some ao digitar
  await page.locator('#' + idg).fill('');
  await page.locator('#' + idg).type('161');
  checar((await page.locator('#erro-' + idg).innerText()).trim() === '', 'aviso antigo continuou depois de digitar um valor válido', erros);
  // apagar tudo e sair da caixa: volta ao valor anterior, sem erro
  await page.locator('#' + idg).fill('');
  await page.locator('#' + idg).press('Tab');
  checar((await page.locator('#' + idg).inputValue()) === '123,5', 'caixa vazia não voltou ao valor anterior', erros);
  checar((await page.locator('#erro-' + idg).innerText()).trim() === '', 'caixa vazia mostrou erro', erros);
  // aplicar a quantidade NÃO recria as caixas (iPhone: teclado e foco continuam): mesmo elemento, foco no próximo
  await page.evaluate((id) => { document.getElementById(id).__marca = 1; }, idg);
  await page.locator('#' + idg).fill('140');
  await page.locator('#' + idg).press('Tab');
  checar(await page.evaluate((id) => document.getElementById(id).__marca === 1, idg), 'aplicar a quantidade recriou a caixa (fecha o teclado no iPhone)', erros);
  checar(await page.evaluate(() => document.activeElement && document.activeElement !== document.body), 'foco perdido depois de aplicar a quantidade', erros);
  checar((await kcalRascunho(page)) !== k1, 'total não atualizou depois de aplicar 140', erros);
  await page.locator('[data-acao="desfazer"]').click();
  checar((await kcalRascunho(page)) === k1, 'desfazer não voltou a quantidade anterior', erros);
  // remover + desfazer
  const itens0 = await page.locator('.pl-item').count();
  await page.locator('[data-acao="remover"]').first().click();
  checar((await page.locator('.pl-item').count()) === itens0 - 1, 'remover não tirou o item', erros);
  await page.locator('[data-acao="desfazer"]').click();
  checar((await page.locator('.pl-item').count()) === itens0, 'desfazer não devolveu o item', erros);
  // adicionar pela busca (apelido, sem acento)
  await page.locator('[data-acao="adicionar"]').first().click();
  checar(await page.locator('#busca').evaluate((el) => el === document.activeElement), 'busca não recebeu o foco', erros);
  await page.locator('#busca').fill('frang');
  const res = page.locator('#resultados [data-acao="escolher"]');
  checar((await res.count()) >= 1 && /frango/i.test(await res.first().innerText()), 'busca por "frang" não achou o frango', erros);
  await page.locator('#busca').fill('xyzw');
  checar(/Nada encontrado/.test(await page.locator('#resultados').innerText()), 'busca vazia sem explicação', erros);
  await page.locator('#busca').fill('nurri');
  await page.locator('#resultados [data-acao="escolher"]').first().click();
  checar((await page.locator('.pl-item').count()) === itens0 + 1, 'adicionar pela busca não funcionou', erros);
  // trocar: até 3 opções, efeito antes de aplicar, aplicar troca o item
  await page.locator('[data-acao="trocar"]').first().click();
  const ops = page.locator('.pl-op');
  const nops = await ops.count();
  checar(nops >= 1 && nops <= 3, `trocas: ${nops} opções (esperado 1–3)`, erros);
  checar(/Dia fica:/.test(await ops.first().innerText()), 'troca sem mostrar o efeito no dia', erros);
  const nomeAntes = await page.locator('.pl-item .nome').first().innerText();
  const tituloOp = (await ops.first().locator('.tit').innerText()).replace(/^1\. /, '');
  await page.keyboard.press('Escape');
  checar(await page.locator('#folha').isHidden(), 'Esc não fechou a folha', erros);
  checar(await page.locator('[data-acao="trocar"]').first().evaluate((el) => el === document.activeElement), 'foco não voltou ao botão', erros);
  await page.locator('[data-acao="trocar"]').first().click();
  await page.locator('.pl-op [data-acao="aplicarTroca"]').first().click();
  const nomeDepois = await page.locator('.pl-item .nome').first().innerText();
  checar(nomeDepois !== nomeAntes && tituloOp.indexOf(nomeDepois) === 0, `troca aplicada errado: ${nomeAntes} → ${nomeDepois} (opção ${tituloOp})`, erros);
  // excluir das trocas: some das opções seguintes
  await page.locator('[data-acao="trocar"]').nth(1).click();
  const alvo = await page.locator('[data-acao="excluir"]').getAttribute('data-a');
  await page.locator('[data-acao="excluir"]').click();
  checar(/Fora das trocas/.test(await page.locator('.pl-excl').innerText()), 'exclusão não aparece', erros);
  const blocos = await page.locator('[data-acao="trocar"]').count();
  for (let i = 0; i < blocos; i++) {
    await page.locator('[data-acao="trocar"]').nth(i).click();
    const usados = await page.locator('[data-acao="aplicarTroca"]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-a')));
    checar(usados.indexOf(alvo) < 0, `alimento excluído (${alvo}) voltou nas trocas`, erros);
    await page.keyboard.press('Escape');
  }
  // alternativas da refeição
  await page.locator('[data-acao="altRef"]').first().click();
  const nref = await page.locator('.pl-op').count();
  checar(nref >= 1 && nref <= 3, `alternativas da refeição: ${nref}`, erros);
  await page.locator('[data-acao="aplicarRef"]').first().click();
  // recarregar: o rascunho continua igual
  const antes = await page.locator('#plano').innerText();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#resumo');
  checar((await page.locator('#plano').innerText()).replace(/Desfazer/, '') === antes.replace(/Desfazer/, ''), 'rascunho mudou depois de recarregar', erros);
  // restaurar a sugestão original
  await page.locator('[data-acao="restaurar"]').click();
  checar((await kcalRascunho(page)) === k0, 'restaurar não voltou à sugestão original', erros);
  checar((await kcalProjetado(page)) === k0, 'dia projetado ≠ consumido + rascunho', erros);
  checar(await page.locator('.pl-faixa .badge').isVisible(), '"NÃO LANÇADO" sumiu depois das edições', erros);
  await page.close();
  return erros.concat(e);
}

async function fluxoGrok(ctx) {
  const erros = [];
  // 1) com área de transferência: o texto copiado começa com o cabeçalho e pede revisão
  const { page, erros: e1 } = await abrir(ctx, '/planejar.html?d=' + DIA, {
    init: () => { window.__copiado = null; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copiado = t; return Promise.resolve(); } }, configurable: true }); }
  });
  await page.locator('[data-acao="grok"]').click();
  await page.locator('[data-acao="copiar"]').click();
  await page.waitForTimeout(100);
  const txt = await page.evaluate(() => window.__copiado);
  checar(txt && txt.split('\n')[0] === 'PLANEJAMENTO — NÃO CONSUMIDO', 'texto não começa com "PLANEJAMENTO — NÃO CONSUMIDO"', erros);
  checar(/NÃO lance nada/.test(txt || ''), 'texto não pede para não lançar', erros);
  checar(/Copiado/.test(await page.locator('#statusGrok').innerText()), 'sem confirmação de cópia', erros);
  await page.close();
  // 2) sem share nem clipboard: avisa e seleciona o texto para copiar à mão
  const { page: p2, erros: e2 } = await abrir(ctx, '/planejar.html?d=' + DIA, {
    init: () => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); }
  });
  await p2.locator('[data-acao="grok"]').click();
  checar((await p2.locator('[data-acao="copiar"]').count()) === 0, 'botão Copiar sem área de transferência', erros);
  checar(/não permite copiar/.test(await p2.locator('#statusGrok').innerText()), 'sem aviso de cópia indisponível', erros);
  await p2.locator('[data-acao="selecionar"]').click();
  const sel = await p2.evaluate(() => { const t = document.getElementById('textoGrok'); return t.selectionEnd - t.selectionStart; });
  checar(sel > 50, 'texto não ficou selecionado', erros);
  await p2.close();
  // 3) cópia bloqueada pelo navegador: cai para seleção
  const { page: p3, erros: e3 } = await abrir(ctx, '/planejar.html?d=' + DIA, {
    init: () => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('negado')) }, configurable: true }); }
  });
  await p3.locator('[data-acao="grok"]').click();
  await p3.locator('[data-acao="copiar"]').click();
  await p3.waitForTimeout(100);
  checar(/bloqueou/.test(await p3.locator('#statusGrok').innerText()), 'cópia negada sem fallback', erros);
  await p3.close();
  return erros.concat(e1, e2, e3);
}

async function fluxoArmazenamento(ctx) {
  const erros = [];
  const { page, erros: e } = await abrir(ctx, '/planejar.html?d=' + DIA, {
    init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true }); }
  });
  checar(/temporário/.test(await page.locator('#avisos').innerText()), 'sem aviso de armazenamento indisponível', erros);
  const k0 = await kcalRascunho(page);
  await page.locator('[data-acao="remover"]').first().click();
  checar((await kcalRascunho(page)) < k0, 'edição não funciona sem armazenamento', erros);
  await page.close();
  return erros.concat(e);
}

function diaOficial(sugestao, lancado) {
  return { data: DIA, atualizado: DIA + 'T08:00:00-07:00', fechado: false, meta: previa.meta, peso_kg: null,
           lancado, sugestao, sugestao_nota: 'teste' };
}

async function fluxoBaseMudou(ctx) {
  const erros = [];
  // rascunho feito sobre a prévia; depois o dia passa a existir e o Grok registra o almoço
  const { page, erros: e1 } = await abrir(ctx, '/planejar.html?d=' + DIA);
  const kAntes = await kcalRascunho(page);
  await page.locator('.pl-qtd input').first().fill('7');
  await page.locator('.pl-qtd input').first().press('Enter');
  const kEditado = await kcalRascunho(page);
  const almocoPrevia = previa.sugestao.find((r) => /almo/i.test(r.refeicao)) || previa.sugestao[0];
  const registrado = { refeicao: almocoPrevia.refeicao, id_evento: 'teste:refeicao:1', consumido_em: DIA + 'T12:30:00-07:00', itens: almocoPrevia.itens };
  const resto = previa.sugestao.filter((r) => r !== almocoPrevia);
  await page.route('**/dados/' + DIA + '.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diaOficial(resto, [registrado])) }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#resumo');
  const aviso = await page.locator('#avisoBase').innerText();
  checar(/registrou/.test(aviso), 'não avisou do registro novo do Grok', erros);
  checar((await page.locator('.pl-ref.suspeita').count()) >= 1, 'refeição possivelmente registrada não foi marcada', erros);
  checar(await page.locator('[data-acao="revisado"]').isDisabled(), '"Manter" liberado antes de decidir as refeições marcadas', erros);
  const consumido = await num(page, 1, 2), plan = await kcalRascunho(page), proj = await kcalProjetado(page);
  checar(Math.abs(proj - (consumido + plan)) <= 1, 'projeção ≠ registrado + rascunho', erros);
  checar(plan < kEditado, 'refeição marcada continuou somando (contaria duas vezes)', erros);
  // edição do usuário preservada (não substituiu em silêncio)
  checar((await page.locator('.pl-qtd input').first().inputValue()) === '7', 'edição do usuário foi substituída', erros);
  await page.locator('.pl-ref.suspeita [data-acao="tirarRef"]').first().click();
  checar(!(await page.locator('[data-acao="revisado"]').isDisabled()), '"Manter" não liberou depois de decidir', erros);
  await page.locator('[data-acao="revisado"]').click();
  checar((await page.locator('#avisoBase').count()) === 0, 'aviso continuou depois de revisar', erros);
  // alimento removido da biblioteca: marcado, fora das contas, sem quebrar
  const semMelancia = Object.assign({}, ali);
  // um alimento que CONTINUA no rascunho (o almoço foi tirado acima)
  const algum = resto.flatMap((r) => r.itens).map((i) => i.alimento).find((a) => a !== 'nurri-vanilla');
  delete semMelancia[algum];
  await page.unroute('**/dados/' + DIA + '.json');
  await page.route('**/dados/alimentos.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(semMelancia) }));
  await page.locator('[data-acao="restaurar"]').click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#resumo');
  checar(/saíram da biblioteca/.test(await page.locator('#avisos').innerText()), 'não avisou do alimento removido', erros);
  checar((await page.locator('.pl-item .falta').count()) >= 1, 'item fora da biblioteca não marcado', erros);
  await page.close();
  return erros.concat(e1);
}

// auditoria Codex #12: página aberta enquanto o Grok registra; virada do dia; toque direto após digitar
async function fluxoPaginaAberta(ctx) {
  const erros = [];
  const almocoPrevia = previa.sugestao.find((r) => /almo/i.test(r.refeicao)) || previa.sugestao[0];
  const registrado = { refeicao: almocoPrevia.refeicao, id_evento: 'aberta:refeicao:1', consumido_em: DIA + 'T12:30:00-07:00', itens: almocoPrevia.itens };
  const resto = previa.sugestao.filter((r) => r !== almocoPrevia);
  const servir = (page, reg = registrado) => page.route('**/dados/' + DIA + '.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diaOficial(resto, [reg])) }));
  const depois = (min) => new Date(AGORA.getTime() + min * 60000);
  // 1) voltar para a página (visibilitychange) com registro novo no servidor: base revalidada sem recarregar
  const { page, erros: e1 } = await abrir(ctx, '/planejar.html?d=' + DIA);
  checar((await num(page, 1, 2)) === 0, 'começo: já registrado deveria ser 0', erros);
  await servir(page);
  await page.clock.setFixedTime(depois(2));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('.pl-ref.suspeita', { timeout: 3000 }).catch(() => erros.push('voltar à página não revalidou a base (registro novo não apareceu)'));
  checar((await num(page, 1, 2)) > 0, '"Já registrado" continuou 0 depois de voltar à página', erros);
  // "Não foi registrada, manter" vale só para o registro visto: chega OUTRO almoço → volta a ficar em dúvida
  await page.locator('.pl-ref.suspeita [data-acao="manterRef"]').first().click();
  checar((await page.locator('.pl-ref.suspeita').count()) === 0, '"manter" não tirou a refeição da dúvida', erros);
  const outro = Object.assign({}, registrado, { id_evento: 'aberta:refeicao:2', consumido_em: DIA + 'T13:10:00-07:00' });
  await page.unroute('**/dados/' + DIA + '.json');
  await page.route('**/dados/' + DIA + '.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diaOficial(resto, [registrado, outro])) }));
  await page.clock.setFixedTime(depois(4));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('.pl-ref.suspeita', { timeout: 3000 }).catch(() => erros.push('registro novo depois de "manter" não voltou a marcar a refeição'));
  // 2) virou o dia com a página aberta: só leitura + atalho para hoje
  const amanhaLA = new Date(Date.parse(DIA + 'T00:00:00Z') + 86400000 + 15 * 3600000);   // dia seguinte, 08h em LA
  await page.clock.setFixedTime(amanhaLA);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => /virou o dia/.test(document.getElementById('avisos').innerText), null, { timeout: 3000 })
    .catch(() => erros.push('virada do dia com a página aberta não foi percebida'));
  checar((await page.locator('.pl-qtd input').count()) === 0, 'depois da virada o rascunho continuou editável', erros);
  checar(await page.locator('#linkHoje').isVisible(), 'sem atalho para planejar o dia de hoje', erros);
  await page.close();
  // 3) "Levar ao Grok" confere a base ANTES de montar o texto (sem nenhum evento de foco)
  const { page: p2, erros: e2 } = await abrir(ctx, '/planejar.html?d=' + DIA, {
    init: () => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); }
  });
  // registro que este rascunho ainda não viu (o passo 1 decidiu "manter" só para os registros dele)
  await servir(p2, Object.assign({}, registrado, { id_evento: 'aberta:refeicao:3' }));
  await p2.locator('[data-acao="grok"]').click();
  await p2.waitForSelector('#textoGrok', { timeout: 3000 });
  const txt = await p2.locator('#textoGrok').inputValue();
  checar(/Já registrado hoje/.test(txt), 'texto ao Grok sem o registro novo (base não conferida antes de exportar)', erros);
  checar(!txt.includes('• ' + almocoPrevia.refeicao + ' —'), 'refeição possivelmente registrada continuou no texto ao Grok', erros);
  checar(/ficaram fora do texto/.test(await p2.locator('#folhaCorpo').innerText()), 'texto sem aviso das refeições deixadas de fora', erros);
  await p2.close();
  // 4) digitar uma quantidade e tocar DIRETO em "Levar ao Grok": o 1º toque não pode se perder
  const { page: p3, erros: e3 } = await abrir(ctx, '/planejar.html?d=' + DIA, {
    init: () => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); }
  });
  const inp = p3.locator('.pl-qtd input').first();
  const k0 = await kcalRascunho(p3);
  await inp.fill('3');
  await p3.locator('[data-acao="grok"]').click();
  await p3.waitForSelector('#folha:not([hidden]) #textoGrok', { timeout: 3000 }).catch(() => erros.push('1º toque em "Levar ao Grok" depois de digitar se perdeu'));
  checar((await kcalRascunho(p3)) !== k0, 'a quantidade digitada não foi aplicada', erros);
  await p3.close();
  return erros.concat(e1, e2, e3);
}

async function fluxoSomenteLeitura(ctx) {
  const erros = [];
  const { page, erros: e } = await abrir(ctx, '/planejar.html?d=' + new Date(Date.parse(VESPERA + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10));
  checar(/já passou/.test(await page.locator('#avisos').innerText()), 'dia passado sem aviso de só consulta', erros);
  checar((await page.locator('.pl-qtd input').count()) === 0, 'dia passado editável', erros);
  await page.close();
  // e o caminho até o planejador: link no cartão de sugestão da prévia
  const p2 = await ctx.newPage();
  await p2.clock.setFixedTime(AGORA);
  await p2.goto(BASE + '/dia.html?d=' + DIA, { waitUntil: 'networkidle' });
  checar((await p2.locator('a.plan-link[href="./planejar.html?d=' + DIA + '"]').count()) === 1, 'sem link do Plano para o planejador', erros);
  await p2.close();
  return erros.concat(e);
}

(async () => {
  const antes = hashDados();
  const falhas = [];
  let rodou = 0;
  for (const nav of NAVEGADORES) {
    let browser;
    try {
      browser = await pw[nav].launch(nav === 'chromium' && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    } catch (e) {
      if (nav === 'webkit' && !process.env.EXIGIR_WEBKIT) { console.log(`– webkit não instalado aqui: pulado (${e.message.split('\n')[0]})`); continue; }
      throw e;
    }
    rodou++;
    for (const [nome, fn] of [['Planejador · editar/trocar/desfazer/recarregar', fluxoEdicao], ['Planejador · levar ao Grok', fluxoGrok],
                              ['Planejador · sem armazenamento', fluxoArmazenamento], ['Planejador · base mudou', fluxoBaseMudou],
                              ['Planejador · dia passado e acesso', fluxoSomenteLeitura], ['Planejador · página aberta', fluxoPaginaAberta]]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      let erros;
      try { erros = await fn(ctx); } catch (e) { erros = [e.message.split('\n')[0]]; }
      await ctx.close();
      console.log((erros.length ? '✗ ' : '✓ ') + `[${nav}] ${nome}` + (erros.length ? ' — ' + erros.join('; ') : ''));
      if (erros.length) falhas.push(`${nav}: ${nome}`);
    }
    await browser.close();
  }
  if (hashDados() !== antes) falhas.push('dados/ mudou durante os testes do planejador');
  if (!rodou) { console.log('::error::nenhum navegador disponível'); process.exit(1); }
  if (falhas.length) { console.log(`::error::Planejador com problema: ${falhas.join(', ')}`); process.exit(1); }
  console.log(`Planejador OK (${rodou} navegador(es), 6 fluxos cada; dia ${DIA}).`);
})();
