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
  ['Histórico · média vs meta', '/historico.html', '#histSummary', /Média vs meta: kcal [+−]?\d+ · P [+−]?\d+ · C [+−]?\d+ · G [+−]?\d+/],
  ['Alimentos', '/alimentos.html', '#biblioteca', /kcal/],
  ['Alimentos · favoritas', '/alimentos.html', '#favoritas', /kcal/],
  ['Hoje · horário da atualização', '/', '#updateStamp', /^Atualizado \d{2}\/\d{2} · \d{2}:\d{2}$/],
  ['Planejar', '/planejar.html', '#resumo', /Dia projetado/],
];
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
    for (const [nome, fn] of [['Totais = Python', checarTotais], ['Planilha CSV', checarCsv], ['Aviso de dia não fechado', checarAvisoFechamento], ['Hoje · detalhes do objetivo', checarDetalhesObjetivo]]) {
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
  console.log(`Páginas OK (${rodou} navegador(es), ${PAGINAS.length + 4} checagens cada).`);
})();
