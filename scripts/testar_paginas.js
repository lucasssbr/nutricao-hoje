#!/usr/bin/env node
/* Teste das páginas num navegador de verdade (Chromium e, quando instalado, WebKit — o motor do Safari).
   Falha se houver erro de JavaScript, mensagem de erro na tela, conteúdo faltando, total diferente do
   calculado em Python ou planilha (CSV) inconsistente. Roda no GitHub antes de publicar (scripts/verificar.sh).
   Local:  python3 -m http.server 8765 &   node scripts/testar_paginas.js http://localhost:8765
   Variáveis: NAVEGADORES=chromium,webkit (padrão)   RAIZ=pasta servida (padrão: este repositório)
   Não substitui um teste no iPhone real (Safari/iOS pode diferir do WebKit do Playwright). */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pw = require('playwright');

const BASE = (process.argv[2] || 'http://localhost:8765').replace(/\/$/, '');
const ROOT = path.resolve(process.env.RAIZ || path.join(__dirname, '..'));
const hoje = (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/data-dia="([\d-]+)"/) || [])[1];
const dias = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados', 'dias.json'), 'utf8')).sort();
const somaDias = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
let futuro = somaDias(dias[dias.length - 1], 5);
const NAVEGADORES = (process.env.NAVEGADORES || 'chromium,webkit').split(',').map((s) => s.trim()).filter(Boolean);

// totais esperados, calculados pelo Python (mesma política de arredondamento das telas)
const esperado = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))})
from comum import ler_json, somar, arred, hoje_la
d = ${JSON.stringify(ROOT)} + '/dados/'
out = {}
for dia in ${JSON.stringify(dias)}:
    j = ler_json(d + dia + '.json')
    t = somar(j.get('lancado', []))
    out[dia] = {'kcal': arred(t['kcal']), 'p': arred(t['p']), 'c': arred(t['c']), 'g': arred(t['g']), 'k1': arred(t['kcal'], 1)}
out['_hoje_la'] = hoje_la().isoformat()
print(json.dumps(out))
`]).toString());
const hojeLA = esperado._hoje_la;

// [nome, url, seletor que precisa ter texto, regex, 404 aceito (dia futuro sem arquivo)]
const PAGINAS = [
  ['Hoje', '/', '#hero', /kcal/],
  ['Hoje · objetivo', '/', '#objetivo', /Meta da semana|Data alvo|É hoje/],
  ['Dia de hoje', '/dia.html?d=' + hoje, '#hero', /kcal/],
  ['Dia mais antigo', '/dia.html?d=' + dias[0], '#hero', /kcal/],
  ['Prévia de dia futuro', '/dia.html?d=' + futuro, '#meals', /Prévia do plano padrão/, 'dados/' + futuro + '.json'],
  ['Histórico', '/historico.html', '#histSummary', /./],
  ['Histórico · peso', '/historico.html', '#pesoCard', /peso/i],
  ['Histórico · calorias e proteína', '/historico.html', '#barrasCard', /Calorias e proteína · últimos 14 dias[\s\S]*Proteína \(g\) por dia/i],
  ['Histórico · proteína por refeição', '/historico.html', '#protRefCard', /Proteína por refeição[\s\S]*(Café|Almoço|Lanche|Jantar)[\s\S]*\d+\s?g/i],
  ['Histórico · onde foram as calorias (semana)', '/historico.html', '#semTopCard', /Onde foram as calorias[\s\S]*\d+%/i],
  ['Histórico · média vs meta', '/historico.html', '#histSummary', /Média vs meta: kcal [+−]?\d+ · P [+−]?\d+ · C [+−]?\d+ · G [+−]?\d+/],
  ['Alimentos', '/alimentos.html', '#biblioteca', /kcal/],
  ['Alimentos · favoritas', '/alimentos.html', '#favoritas', /kcal/],
  ['Hoje · horário da atualização', '/', '#updateStamp', /^Atualizado \d{2}\/\d{2} · \d{2}:\d{2}$/],
  ['Planejar', '/planejar.html', '#resumo', /Dia projetado/],
];
// "Proteína faltam X g" só existe com sugestão pendente e proteína abaixo da meta (à noite, depois do jantar
// lançado, não aparece — a checagem não pode travar a publicação dos registros)
{
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados', hoje + '.json'), 'utf8'));
  const pCons = (d.lancado || []).reduce((t, r) => t + (r.itens || []).reduce((u, i) => u + (Number(i.p) || 0), 0), 0);
  if (!d.fechado && (d.sugestao || []).length && Math.round(pCons) < Math.round((d.meta || {}).p || 180)) {
    PAGINAS.push(['Hoje · proteína que falta', '/', '#hero', /Proteína faltam \d+\s?g · (~\d+\s?g em cada uma das \d refeições que faltam|tudo na última refeição)/]);
  }
}
// "Onde foram as calorias": no dia fechado mais recente com 2+ alimentos diferentes (se não houver, não checa)
{
  const comAlimentos = dias.slice().reverse().find((d) => {
    const arq = path.join(ROOT, 'dados', d + '.json');
    if (!fs.existsSync(arq)) return false;
    const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
    const nomes = new Set((j.lancado || []).flatMap((r) => (r.itens || []).map((i) => i.alimento || i.nome)));
    return j.fechado && nomes.size >= 2;
  });
  if (comAlimentos) PAGINAS.push(['Dia · onde foram as calorias', '/dia.html?d=' + comAlimentos, '#meals', /Onde foram as calorias[\s\S]*Calorias[\s\S]*\d+%/i]);
}
// prévia de amanhã = sugestão automática (dados/previa.json, gerada pelo derivados.py)
const previaArq = path.join(ROOT, 'dados', 'previa.json');
if (fs.existsSync(previaArq)) {
  const para = JSON.parse(fs.readFileSync(previaArq, 'utf8')).para;
  if (para && !dias.includes(para)) {
    PAGINAS.push(['Prévia de amanhã (sugestão automática)', '/dia.html?d=' + para, '#meals', /Prévia da sugestão automática/, 'dados/' + para + '.json']);
  }
}

async function checarPagina(ctx, [nome, url, sel, texto, ok404]) {
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon|dados\/previa\.json$/.test(r.url()) && !(ok404 && r.url().endsWith(ok404))) erros.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`); });
  try {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const txt = (await page.locator(sel).innerText({ timeout: 4000 })).trim();
    if (!texto.test(txt)) erros.push(`${sel} sem o conteúdo esperado (${texto})`);
    const erroTela = await page.locator('.load-error').count();
    if (erroTela) erros.push('mensagem de erro na tela: ' + (await page.locator('.load-error').first().innerText()));
  } catch (e) {
    erros.push(e.message.split('\n')[0]);
  }
  await page.close();
  return erros;
}

// total do anel (kcal consumidas) de cada dia = o que o Python calcula
async function checarTotais(ctx) {
  const erros = [];
  for (const d of dias) {
    if (d > hojeLA) continue;
    const page = await ctx.newPage();
    await page.goto(BASE + '/dia.html?d=' + d, { waitUntil: 'networkidle' });
    const big = (await page.locator('#hero .ring .big').innerText({ timeout: 4000 })).trim();
    if (Number(big) !== esperado[d].kcal) erros.push(`${d}: anel mostra ${big}, Python calcula ${esperado[d].kcal}`);
    await page.close();
  }
  return erros;
}

// planilha: cabeçalho, uma linha por dia até hoje (sem planos futuros), kcal igual ao Python (1 casa)
async function checarCsv(ctx) {
  const erros = [];
  const page = await ctx.newPage();
  await page.goto(BASE + '/historico.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  if (!(await page.locator('#csvBtn').isVisible())) { await page.close(); return ['botão CSV não apareceu']; }
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#csvBtn')]);
  const txt = fs.readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
  const linhas = txt.trim().split('\n');
  const cab = linhas[0].split(',');
  for (const c of ['data', 'fechado', 'registro', 'kcal', 'peso_kg']) if (!cab.includes(c)) erros.push(`CSV sem coluna ${c}`);
  const idx = { data: cab.indexOf('data'), kcal: cab.indexOf('kcal') };
  const esperadosDias = dias.filter((d) => d <= hojeLA);
  const csvDias = linhas.slice(1).map((l) => l.split(',')[idx.data]);
  if (JSON.stringify(csvDias) !== JSON.stringify(esperadosDias)) erros.push(`CSV com dias ${csvDias} (esperado ${esperadosDias})`);
  linhas.slice(1).forEach((l) => {
    const col = l.split(','), d = col[idx.data];
    if (esperado[d] && Number(col[idx.kcal]) !== esperado[d].k1) erros.push(`CSV ${d}: kcal ${col[idx.kcal]} ≠ ${esperado[d].k1}`);
  });
  await page.close();
  return erros;
}

// aviso amarelo quando o dia aberto ficou para trás (fechamento da meia-noite atrasado): relógio simulado
// cartão do objetivo: explicações recolhidas em "Ver detalhes" (fechado por padrão; abre no toque; lembra)
async function checarDetalhesObjetivo(ctx) {
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#objetivo .obj-card', { timeout: 4000 });
    const det = page.locator('#objDetalhes');
    if (!(await det.count())) { erros.push('cartão do objetivo sem "Ver detalhes"'); }
    else {
      if (await det.evaluate((d) => d.open)) erros.push('"Ver detalhes" deveria começar fechado');
      const visivel = await page.locator('#objetivo').innerText();
      if (!/Meta da semana/.test(visivel)) erros.push('meta da semana não ficou à vista');
      if (/Pelo déficit/.test(visivel)) erros.push('explicação do cálculo à vista com os detalhes fechados');
      await page.locator('#objDetalhes > summary').click();
      if (!/Pelo déficit/.test(await page.locator('#objetivo').innerText())) erros.push('abrir "Ver detalhes" não mostrou o cálculo');
      // o evento "toggle" do <details> é assíncrono (chega depois do clique): espera gravar antes de recarregar
      await page.waitForFunction(() => { try { return localStorage.getItem('nutri-obj-detalhes') === '1'; } catch (e) { return false; } }, null, { timeout: 2000 })
        .catch(() => erros.push('"Ver detalhes" aberto não foi gravado'));
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#objDetalhes', { timeout: 4000 });
      if (!(await page.locator('#objDetalhes').evaluate((d) => d.open))) erros.push('"Ver detalhes" não lembrou que estava aberto');
    }
  } catch (e) {
    erros.push(e.message.split('\n')[0]);
  }
  await page.close();
  return erros;
}

async function checarAvisoFechamento(ctx) {
  const erros = [];
  for (const [quando, deveAparecer] of [[hoje + 'T20:00:00Z', false], [somaDias(hoje, 1) + 'T20:00:00Z', true]]) {
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(quando));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const visivel = await page.locator('#staleBanner').isVisible();
    const txt = visivel ? await page.locator('#staleBanner').innerText() : '';
    if (visivel !== deveAparecer) erros.push(`relógio em ${quando}: aviso ${visivel ? 'apareceu' : 'não apareceu'}`);
    if (deveAparecer && !/não fechado/.test(txt)) erros.push(`texto do aviso: ${txt}`);
    await page.close();
  }
  return erros;
}

// sugestão do dia acabou (jantar lançado): o Hoje oferece "Planejar amanhã" (link com a data de amanhã)
async function checarPlanejarAmanha(ctx) {
  const erros = [];
  const dia = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados', hoje + '.json'), 'utf8'));
  const item = { nome: 'Melancia', qtd: '300 g', alimento: 'melancia', quantidade: 300, kcal: 90, p: 1.8, c: 22.8, g: 0.6 };
  const comJantar = Object.assign({}, dia, { lancado: [{ refeicao: 'Jantar', consumido_em: hoje + 'T20:00:00-07:00', itens: [item] }], sugestao: [], sugestao_nota: 'Dia completo — sem refeições a sugerir' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erros.push(e.message));
  await page.clock.setFixedTime(new Date(hoje + 'T20:00:00Z'));
  await page.route('**/dados/' + hoje + '.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(comJantar) }));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const href = await page.locator('#planAmanha').getAttribute('href', { timeout: 3000 }).catch(() => null);
  if (href !== './planejar.html?d=' + somaDias(hoje, 1)) erros.push('sem "Planejar amanhã" depois da última refeição (href ' + href + ')');
  await page.unroute('**/dados/' + hoje + '.json');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });   // dia normal, com sugestão: não aparece
  await page.waitForTimeout(300);
  if (dia.sugestao && dia.sugestao.length && await page.locator('#planAmanha').count()) erros.push('"Planejar amanhã" apareceu com sugestão ainda pendente');
  await page.close();
  return erros;
}

// Histórico: "Resumo da semana" gera o texto (médias = cartão, por dia, pontos de atenção) e copia
async function checarResumoSemana(ctx) {
  const erros = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => {
    window.__copiado = null;
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copiado = t; return Promise.resolve(); } }, configurable: true });
  });
  await page.goto(BASE + '/historico.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.locator('#resumoBtn').click();
  await page.locator('#resumoPainel [data-r="copiar"]').click();
  await page.waitForTimeout(100);
  const txt = await page.evaluate(() => window.__copiado) || '';
  if (!/^RESUMO DA SEMANA/.test(txt)) erros.push('texto não começa com "RESUMO DA SEMANA"');
  for (const trecho of ['Média por dia:', 'Diferença:', 'Por dia:', 'Onde foram as calorias', 'Pontos de atenção:']) if (!txt.includes(trecho)) erros.push('resumo sem "' + trecho + '"');
  const media = (await page.locator('.hist-summary-avgs').innerText()).match(/\d+/);
  if (media && !txt.includes('Média por dia: ' + media[0] + ' kcal')) erros.push('média do resumo ≠ cartão (' + media[0] + ' kcal)');
  if (!/Copiado/.test(await page.locator('#resumoStatus').innerText())) erros.push('sem confirmação de cópia');
  await page.close();
  return erros;
}

// Alimentos: ordenar por proteína por 100 kcal (o 1º é o de maior densidade; a escolha é lembrada)
async function checarOrdemProteina(ctx) {
  const erros = [];
  const ali = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados', 'alimentos.json'), 'utf8'));
  const ids = Object.keys(ali).filter((k) => k[0] !== '_' && ali[k].kcal > 0);
  const melhor = ids.reduce((m, k) => (ali[k].p / ali[k].kcal > ali[m].p / ali[m].kcal ? k : m), ids[0]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto(BASE + '/alimentos.html', { waitUntil: 'networkidle' });
  await page.locator('[data-ordem="proteina"]').click();
  const primeiro = (await page.locator('#biblioteca .ali-card b').first().innerText()).trim();
  if (primeiro !== ali[melhor].nome) erros.push('1º por proteína/kcal deveria ser ' + ali[melhor].nome + ' (veio ' + primeiro + ')');
  if (!/por 100\s?kcal/.test(await page.locator('#biblioteca .ali-dens').first().innerText())) erros.push('sem "proteína por 100 kcal"');
  await page.reload({ waitUntil: 'networkidle' });
  if ((await page.locator('[data-ordem="proteina"]').getAttribute('aria-pressed')) !== 'true') erros.push('ordem por proteína não foi lembrada');
  await page.locator('[data-ordem="nome"]').click();   // volta ao normal para as outras checagens
  await page.close();
  return erros;
}

// Hoje: "+ Adicionar do rótulo" — conta (totais e por porção), recusa kcal incoerente e monta o comando do Grok
async function checarAdicionarRotulo(ctx) {
  const erros = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('request', (r) => { if (r.method() !== 'GET') erros.push('escrita no servidor: ' + r.method()); });
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.locator('#addCard > summary').click();
  const preencher = async (vals) => { for (const [id, v] of Object.entries(vals)) await page.locator('#' + id).fill(v); };
  // 1) totais, kcal em branco → 4/4/9
  await preencher({ addNome: 'Barra Teste', addKcal: '', addP: '20', addC: '22', addG: '8', addF: '' });
  const r1 = await page.locator('#addRes').innerText();
  if (!/Vai lançar: 240 kcal \| P 20 \| C 22 \| G 8/.test(r1)) erros.push('totais: conta errada (' + r1 + ')');
  // 2) kcal que não bate → aviso e botão desligado
  await preencher({ addKcal: '500' });
  if (!(await page.locator('#addEnviar').isDisabled())) erros.push('kcal incoerente não desligou "Enviar"');
  if (!/não bate/.test(await page.locator('#addRes').innerText())) erros.push('kcal incoerente sem aviso');
  // 3) por porção: 40 g = 200 kcal P20 C22 G8 fibra 14; comi 60 g → 1,5×
  await page.locator('[data-modo="porcao"]').click();
  await preencher({ addBase: '40 g', addQtd: '60 g', addKcal: '200', addP: '20', addC: '22', addG: '8', addF: '14' });
  const r3 = await page.locator('#addRes').innerText();
  if (!/Vai lançar: 300 kcal \| P 30 \| C 33 \| G 12 \| fibra 21 \(60 g\)/.test(r3)) erros.push('por porção: conta errada (' + r3 + ')');
  await page.locator('#addSalvar').check();
  await page.locator('#addEnviar').click();
  const msg = await page.locator('#addMsg').inputValue();
  if (!/^LANÇAR — ADIÇÃO RÁPIDA/.test(msg)) erros.push('mensagem sem cabeçalho');
  if (!/--manual "Barra Teste \(60 g\)=300,30,33,12,21"/.test(msg)) erros.push('comando --manual errado: ' + (msg.match(/--manual "[^"]*"/) || ['?'])[0]);
  if (!/--consumido-em \d{4}-\d{2}-\d{2}T\d{2}:\d{2} /.test(msg)) erros.push('sem --consumido-em');
  if (!/SALVAR NA BIBLIOTECA.*base 40 g.*200 kcal \| P 20 \| C 22 \| G 8 \| fibra 14/.test(msg)) erros.push('sem pedido de salvar na biblioteca');
  await page.close();
  return erros;
}

(async () => {
  const falhas = [];
  let rodou = 0;
  for (const nav of NAVEGADORES) {
    let browser;
    try {
      const opcoes = nav === 'chromium' && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
      browser = await pw[nav].launch(opcoes);
    } catch (e) {
      if (nav === 'webkit' && !process.env.EXIGIR_WEBKIT) { console.log(`– webkit não instalado aqui: pulado (${e.message.split('\n')[0]})`); continue; }
      throw e;
    }
    rodou++;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    for (const p of PAGINAS) {
      const erros = await checarPagina(ctx, p);
      console.log((erros.length ? '✗ ' : '✓ ') + `[${nav}] ${p[0]}` + (erros.length ? ' — ' + erros.join('; ') : ''));
      if (erros.length) falhas.push(`${nav}: ${p[0]}`);
    }
    for (const [nome, fn] of [['Totais = Python', checarTotais], ['Planilha CSV', checarCsv], ['Aviso de dia não fechado', checarAvisoFechamento], ['Hoje · detalhes do objetivo', checarDetalhesObjetivo], ['Hoje · planejar amanhã', checarPlanejarAmanha], ['Histórico · resumo da semana', checarResumoSemana], ['Alimentos · ordem por proteína', checarOrdemProteina], ['Hoje · adicionar do rótulo', checarAdicionarRotulo]]) {
      let erros;
      try { erros = await fn(ctx); } catch (e) { erros = [e.message.split('\n')[0]]; }
      console.log((erros.length ? '✗ ' : '✓ ') + `[${nav}] ${nome}` + (erros.length ? ' — ' + erros.join('; ') : ''));
      if (erros.length) falhas.push(`${nav}: ${nome}`);
    }
    await browser.close();
  }
  if (!rodou) { console.log('::error::nenhum navegador disponível'); process.exit(1); }
  if (falhas.length) {
    console.log(`::error::Páginas com problema: ${falhas.join(', ')}`);
    process.exit(1);
  }
  console.log(`Páginas OK (${rodou} navegador(es), ${PAGINAS.length + 8} checagens cada).`);
})();
