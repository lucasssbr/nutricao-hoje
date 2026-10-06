/* Página Alimentos: biblioteca (dados/alimentos.json) com a fonte de cada item
   e as refeições favoritas (dados/refeicoes.json) com o total calculado. Só leitura. */
(function () {
  var FONTES = {
    rotulo: { txt: 'Rótulo', cls: 'ok' },
    usda: { txt: 'USDA', cls: 'ok' },
    openfoodfacts: { txt: 'Open Food Facts', cls: 'ok' },
    lucas: { txt: 'Informado', cls: 'mid' },
    estimado: { txt: 'Estimado', cls: 'warn' }
  };
  var MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function n1(v) { return String(window.Nutri.arred(Number(v), 1)).replace('.', ','); }
  var ri = window.Nutri.ri;
  function data(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? parseInt(p[2], 10) + ' ' + MESES[parseInt(p[1], 10) - 1] : '';
  }
  function get(u) {
    return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); });
  }
  // mesma conta do scripts/item.py: valor da base × quantidade / tamanho da base
  function item(a, q) {
    var m = /^\s*([\d.,]+)\s*(g|un|lata)\b/.exec(a.base);
    var f = q / parseFloat(m[1].replace(',', '.'));
    var und = m[2] === 'g' ? ' g' : (m[2] === 'lata' ? ' lata' : ' un');
    return { nome: a.nome, qtd: q + und, kcal: a.kcal * f, p: a.p * f, c: a.c * f, g: a.g * f };
  }
  function macros(t) {
    return ri(t.kcal) + ' kcal · P' + ri(t.p) + ' · C' + ri(t.c) + ' · G' + ri(t.g);
  }

  function renderFavoritas(ali, refs) {
    var el = document.getElementById('favoritas');
    var plano = refs.plano_padrao || [];
    var html = '';
    var tot = { kcal: 0, p: 0, c: 0, g: 0 };
    Object.keys(refs.refeicoes || {}).forEach(function (rid) {
      var r = refs.refeicoes[rid];
      var itens = (r.itens || []).map(function (par) { return ali[par[0]] ? item(ali[par[0]], par[1]) : null; }).filter(Boolean);
      var t = { kcal: 0, p: 0, c: 0, g: 0 };
      itens.forEach(function (i) { t.kcal += i.kcal; t.p += i.p; t.c += i.c; t.g += i.g; });
      if (plano.indexOf(rid) >= 0) { tot.kcal += t.kcal; tot.p += t.p; tot.c += t.c; tot.g += t.g; }
      html += '<details class="ali-card"><summary class="ali-head"><b>' + esc(r.nome) + '</b>' +
        (plano.indexOf(rid) >= 0 ? ' <span class="ali-tag">plano padrão</span>' : '') +
        '<span class="ali-mac">' + macros(t) + '</span></summary>' +
        '<div class="ali-itens">' + itens.map(function (i) { return esc(i.nome) + ' <span>' + esc(i.qtd) + '</span>'; }).join(' · ') + '</div>' +
        ((r.apelidos && r.apelidos.length) ? '<div class="ali-obs">Diga ao Grok: "' + esc(r.apelidos[0]) + '"</div>' : '') +
        '</details>';
    });
    if (plano.length) {
      html = '<div class="ali-plano">Plano padrão do dia: <b>' + macros(tot) + '</b></div>' + html;
    }
    el.innerHTML = html || '<div class="hist-empty">Nenhuma favorita ainda</div>';
  }

  // selo "novo": cadastrado nos últimos 7 dias (fuso de LA) — mostra o que o Grok acabou de incluir
  function seloNovo(a) {
    if (!a.salvo_em || !/^\d{4}-\d{2}-\d{2}$/.test(a.salvo_em)) return '';
    var dias = window.Nutri.diasEntre(a.salvo_em, window.Nutri.hojeLA());
    return dias >= 0 && dias < 7 ? '<span class="ali-fonte novo">novo</span>' : '';
  }

  // proteína por 100 kcal: quanto de proteína cada caloria traz (ajuda a escolher quando falta proteína)
  function densidade(a) { var k = Number(a.kcal), pr = Number(a.p); return k > 0 && isFinite(pr) ? pr / k * 100 : null; }
  var CHAVE_ORDEM = 'nutri-ali-ordem';
  function ordemSalva() { try { return window.localStorage.getItem(CHAVE_ORDEM) === 'proteina' ? 'proteina' : 'nome'; } catch (e) { return 'nome'; } }
  var ordem = ordemSalva(), ALI = null;

  function renderBiblioteca(ali) {
    ALI = ali;
    var el = document.getElementById('biblioteca');
    var ids = Object.keys(ali).filter(function (k) { return k.charAt(0) !== '_'; });
    ids.sort(function (a, b) {
      if (ordem === 'proteina') {
        var da = densidade(ali[a]), db = densidade(ali[b]);
        if (da !== db) return (db == null ? -1 : db) - (da == null ? -1 : da);
      }
      return ali[a].nome.localeCompare(ali[b].nome, 'pt');
    });
    var estimados = 0;
    var html = ids.map(function (id) {
      var a = ali[id];
      var f = FONTES[a.fonte] || { txt: a.fonte, cls: 'mid' };
      if (a.fonte === 'estimado') estimados++;
      var extra = [];
      if (a.plano_ate_g) extra.push('plano até ' + ri(a.plano_ate_g) + ' g/dia');
      if (a.salvo_em) extra.push('salvo ' + data(a.salvo_em));
      if (a.atualizado_em) extra.push('atualizado ' + data(a.atualizado_em));
      return '<details class="ali-card"><summary class="ali-head"><b>' + esc(a.nome) + '</b>' +
        '<span class="ali-fonte ' + f.cls + '">' + esc(f.txt) + '</span>' + seloNovo(a) +
        '<span class="ali-mac">' + esc(a.base) + ': ' + n1(a.kcal) + ' kcal · P' + n1(a.p) + ' · C' + n1(a.c) + ' · G' + n1(a.g) +
        (a.fibra != null ? ' · fibra ' + n1(a.fibra) : '') + '</span>' +
        (densidade(a) != null ? '<span class="ali-dens">Proteína: <span class="v">' + n1(densidade(a)) + '\u00a0g</span> por 100\u00a0kcal</span>' : '') + '</summary>' +
        (extra.length ? '<div class="ali-obs">' + esc(extra.join(' · ')) + '</div>' : '') +
        (a.apelidos && a.apelidos.length ? '<div class="ali-obs">Apelidos: ' + esc(a.apelidos.join(', ')) + '</div>' : '') +
        (a.obs ? '<div class="ali-obs">' + esc(a.obs) + '</div>' : '') +
        '</details>';
    }).join('');
    el.innerHTML = '<div class="ali-ordem" role="group" aria-label="Ordem da biblioteca">' +
      '<button type="button" data-ordem="nome" aria-pressed="' + (ordem === 'nome') + '">A–Z</button>' +
      '<button type="button" data-ordem="proteina" aria-pressed="' + (ordem === 'proteina') + '">Mais proteína por kcal</button></div>' + html;
    el.querySelectorAll('[data-ordem]').forEach(function (b) {
      b.addEventListener('click', function () {
        ordem = b.getAttribute('data-ordem');
        try { window.localStorage.setItem(CHAVE_ORDEM, ordem); } catch (e) { /* sem armazenamento: vale só agora */ }
        renderBiblioteca(ALI);
      });
    });
    document.getElementById('aliResumo').textContent = ids.length + ' alimentos' +
      (estimados ? ' · ' + estimados + ' estimado' + (estimados > 1 ? 's' : '') + ' (mande o rótulo)' : ' · todos com fonte');
  }

  Promise.all([get('dados/alimentos.json'), get('dados/refeicoes.json').catch(function () { return {}; })])
    .then(function (res) {
      renderFavoritas(res[0], res[1]);
      renderBiblioteca(res[0]);
    })
    .catch(function () {
      document.getElementById('biblioteca').innerHTML = '<div class="load-error">Não consegui carregar a biblioteca</div>';
    });
})();
