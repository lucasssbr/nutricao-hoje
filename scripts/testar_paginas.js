#!/usr/bin/env node
/* Teste das páginas: abre cada página num navegador de verdade (Chromium) e falha se
   houver erro de JavaScript, mensagem de erro na tela ou conteúdo faltando.
   Roda no GitHub a cada envio (workflow "Conferir dados"). Local:
     python3 -m http.server 8765 &   node scripts/testar_paginas.js http://localhost:8765
*/
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = (process.argv[2] || 'http://localhost:8765').replace(/\/$/, '');
const ROOT = path.resolve(__dirname, '..');
const hoje = (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/data-dia="([\d-]+)"/) || [])[1];
const dias = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados', 'dias.json'), 'utf8')).sort();
const futuro = new Date(Date.parse(dias[dias.length - 1]) + 5 * 86400000).toISOString().slice(0, 10);

// [nome, url, seletor que precisa ter texto, texto que precisa aparecer, 404 esperado (dia futuro ainda sem arquivo)]
const PAGINAS = [
  ['Hoje', '/', '#hero', /kcal/],
  ['Hoje · objetivo', '/', '#objetivo', /./],
  ['Dia de hoje', '/dia.html?d=' + hoje, '#hero', /kcal/],
  ['Dia mais antigo', '/dia.html?d=' + dias[0], '#hero', /kcal/],
  ['Prévia de dia futuro', '/dia.html?d=' + futuro, '#meals', /Prévia do plano padrão/, 'dados/' + futuro + '.json'],
  ['Histórico', '/historico.html', '#histSummary', /./],
  ['Histórico · peso', '/historico.html', '#pesoCard', /peso/i],
  ['Alimentos', '/alimentos.html', '#biblioteca', /kcal/],
  ['Alimentos · favoritas', '/alimentos.html', '#favoritas', /kcal/],
];

(async () => {
  const opcoes = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(opcoes);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const falhas = [];
  for (const [nome, url, sel, texto, ok404] of PAGINAS) {
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url()) && !(ok404 && r.url().endsWith(ok404))) erros.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`); });
    try {
      await page.goto(BASE + url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const txt = (await page.locator(sel).innerText({ timeout: 3000 })).trim();
      if (!texto.test(txt)) erros.push(`${sel} sem o conteúdo esperado (${texto})`);
      const erroTela = await page.locator('.load-error').count();
      if (erroTela) erros.push('mensagem de erro na tela: ' + (await page.locator('.load-error').first().innerText()));
    } catch (e) {
      erros.push(e.message.split('\n')[0]);
    }
    console.log((erros.length ? '✗ ' : '✓ ') + nome + (erros.length ? ' — ' + erros.join('; ') : ''));
    if (erros.length) falhas.push(nome);
    await page.close();
  }
  await browser.close();
  if (falhas.length) {
    console.log(`::error::Páginas com problema: ${falhas.join(', ')}`);
    process.exit(1);
  }
  console.log(`Páginas OK (${PAGINAS.length} checagens).`);
})();
