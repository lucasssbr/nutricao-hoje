/* Relatório da semana (semana.html): 7 dias fechados numa página só, pronta para imprimir ou salvar em PDF
   (nutricionista, médico, arquivo). Só leitura de dados/: nada é gravado.
   - Janela: 7 dias corridos terminando em ?ate=AAAA-MM-DD; sem parâmetro, termina no dia fechado mais recente.
   - Médias, "dias na meta", onde foram as calorias e proteína por refeição: só dias com REGISTRO COMPLETO
     (mesma regra do Histórico); a tabela "Por dia" mostra todos, marcando os que ficaram fora.
   - Peso: só pesagens reais do período (estimativa não conta). */
(function () {
  var N = window.Nutri, ri = N.ri;
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var HORARIOS = ['Café', 'Almoço', 'Lanche', 'Jantar'];
  var box = document.getElementById('relatorio');
  if (!box) return;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function get(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function ddmm(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  function longa(iso) { var p = iso.split('-'); return parseInt(p[2], 10) + ' ' + MESES[parseInt(p[1], 10) - 1] + ' ' + p[0]; }
  function diaSem(iso) { return SEM[new Date(Date.parse(iso + 'T00:00:00Z')).getUTCDay()]; }
  function avg(a) { if (!a.length) return null; var s = 0; a.forEach(function (x) { s += x; }); return s / a.length; }
  function sinal(x) { return x > 0 ? '+' + x : x < 0 ? '−' + Math.abs(x) : '0'; }
  function kg(n) { return N.arred(n, 1).toFixed(1).replace('.', ','); }
  function curto(nome) { return String(nome || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); }

  function soma(lancado) {
    var t = { kcal: 0, p: 0, c: 0, g: 0, fibra: 0 };
    (lancado || []).forEach(function (r) { (r.itens || []).forEach(function (it) { ['kcal', 'p', 'c', 'g', 'fibra'].forEach(function (k) { t[k] += Number(it[k]) || 0; }); }); });
    return t;
  }
  // mesmas tolerâncias do Histórico/Hoje
  function fora(c, m) { return { kcal: Math.abs(c.kcal - m.kcal) > 75, p: c.p - m.p < -10, c: c.c - m.c > 10, g: c.g - m.g > 5 }; }
  function naMeta(c, m) { var o = fora(c, m); return !o.kcal && !o.p && !o.c && !o.g; }
  function regDe(arq) { return (arq.registro && arq.registro.status) || 'desconhecido'; }
  function conta(d) { return d.registro === 'completo' && d.refeicoes > 0; }
  function horarioDe(r) {
    var n = String(r.refeicao || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    var pares = [['cafe', 'Café'], ['almoc', 'Almoço'], ['jantar', 'Jantar'], ['ceia', 'Jantar'], ['lanche', 'Lanche'], ['doce', 'Lanche']];
    for (var i = 0; i < pares.length; i++) if (n.indexOf(pares[i][0]) >= 0) return pares[i][1];
    var c = String(r.consumido_em || '');
    if (c.length >= 16 && c[13] === ':') { var hh = parseInt(c.slice(11, 13), 10); return hh < 11 ? 'Café' : hh < 15 ? 'Almoço' : hh < 19 ? 'Lanche' : 'Jantar'; }
    return null;
  }

  // dia de arquivo → linha do relatório
  function linha(data, arq) {
    if (!arq) return { data: data, falta: true };
    var lanc = arq.lancado || [];
    return { data: data, fechado: !!arq.fechado, meta: arq.meta || { kcal: 1570, p: 180, c: 100, g: 50 }, cons: soma(lanc),
      registro: regDe(arq), refeicoes: lanc.length, peso: arq.peso_kg != null && !isNaN(Number(arq.peso_kg)) ? Number(arq.peso_kg) : null, lancado: lanc };
  }

  // ---------- gráfico de barras (7 dias, valor escrito em cima de cada barra: legível no papel) ----------
  function barras(dias, campo, cls, titulo, acima) {
    var W = 340, H = 132, L = 6, R = 6, T = 16, B = 30, slot = (W - L - R) / dias.length, bw = slot * 0.56;
    var vals = dias.map(function (d) { return d.fechado && d.refeicoes ? d.cons[campo] : null; });
    var metas = dias.filter(function (d) { return d.meta; }).map(function (d) { return d.meta[campo]; });
    var meta = metas.length ? metas[metas.length - 1] : null;
    var hi = Math.max.apply(null, vals.filter(function (v) { return v != null; }).concat(meta || 0)) * 1.15 || 1;
    function y(v) { return T + (H - T - B) * (1 - v / hi); }
    var base = y(0), s = '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + base.toFixed(1) + '" y2="' + base.toFixed(1) + '" class="sw-grid"/>';
    if (meta != null) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(meta).toFixed(1) + '" y2="' + y(meta).toFixed(1) + '" class="sw-meta"/>';
    dias.forEach(function (d, i) {
      var cx = L + slot * i + slot / 2, v = vals[i];
      if (v != null && v > 0) {
        var c = cls + (acima && acima(d) ? ' sw-over' : '') + (conta(d) ? '' : ' sw-inc');
        s += '<rect class="' + c + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (base - y(v)).toFixed(1) + '" rx="3"/>' +
          '<text x="' + cx.toFixed(1) + '" y="' + (y(v) - 4).toFixed(1) + '" class="sw-val" text-anchor="middle">' + ri(v) + '</text>';
      } else {
        s += '<text x="' + cx.toFixed(1) + '" y="' + (base - 4).toFixed(1) + '" class="sw-ax" text-anchor="middle">—</text>';
      }
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 16) + '" class="sw-ax" text-anchor="middle">' + diaSem(d.data) + '</text>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - 4) + '" class="sw-ax" text-anchor="middle">' + ddmm(d.data) + '</text>';
    });
    return '<div class="sw-rot">' + titulo + (meta != null ? ' · <i class="sw-k-meta"></i> meta ' + ri(meta) : '') + '</div>' +
      '<svg class="sw-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(titulo) + '">' + s + '</svg>';
  }

  // ---------- onde foram as calorias / proteína por refeição (dias completos) ----------
  function topAlimentos(base) {
    var por = {}, tot = 0, totG = 0;
    base.forEach(function (d) {
      d.lancado.forEach(function (r) {
        (r.itens || []).forEach(function (it) {
          var k = it.alimento || it.nome || '?';
          var x = por[k] || (por[k] = { nome: curto(it.nome || k), kcal: 0, g: 0, dias: {} });
          x.kcal += Number(it.kcal) || 0; x.g += Number(it.g) || 0; x.dias[d.data] = 1;
          tot += Number(it.kcal) || 0; totG += Number(it.g) || 0;
        });
      });
    });
    var lista = Object.keys(por).map(function (k) { return por[k]; });
    function top(campo, total, n) {
      return lista.slice().sort(function (a, b) { return b[campo] - a[campo]; }).slice(0, n).filter(function (x) { return ri(x[campo]) > 0; })
        .map(function (x) { return { nome: x.nome, v: x[campo], pct: Math.round(100 * x[campo] / total), dias: Object.keys(x.dias).length }; });
    }
    return { tot: tot, kcal: tot > 0 ? top('kcal', tot, 5) : [], g: totG > 0 ? top('g', totG, 3) : [] };
  }
  function protRefeicao(base) {
    var por = {};
    base.forEach(function (d) {
      var no = {};
      d.lancado.forEach(function (r) {
        var h = horarioDe(r);
        if (h) no[h] = (no[h] || 0) + (r.itens || []).reduce(function (t, it) { return t + (Number(it.p) || 0); }, 0);
      });
      Object.keys(no).forEach(function (h) { (por[h] = por[h] || []).push(no[h]); });
    });
    return HORARIOS.filter(function (h) { return por[h]; }).map(function (h) { return { h: h, g: avg(por[h]), dias: por[h].length }; });
  }

  function render(dias, ate, maxAte, obj) {
    var fechados = dias.filter(function (d) { return d.fechado; });
    var base = fechados.filter(conta), n = base.length;
    var total = dias.filter(function (d) { return !d.falta; }).length;   // dias com arquivo (antes do 1º registro não contam)
    var ini = dias[0].data;
    var h = '<div class="sw-cab"><div class="sw-tit">Relatório da semana</div><div class="sw-per">' + esc(longa(ini)) + ' a ' + esc(longa(ate)) +
      ' · ' + fechados.length + ' dia' + (fechados.length === 1 ? '' : 's') + ' fechado' + (fechados.length === 1 ? '' : 's') + '</div>';
    if (obj && obj.inicio && obj.data_alvo && ate >= obj.inicio) {
      var sw = N.semana(obj.inicio, obj.data_alvo, ate);
      h += '<div class="sw-per">' + esc(obj.nome || 'Objetivo') + ' · semana ' + sw.n + ' de ' + sw.total + ' (alvo ' + ddmm(obj.data_alvo) + ')</div>';
    }
    h += '</div>';

    // médias × meta
    h += '<section class="sw-card"><div class="sw-h">Médias por dia</div>';
    if (n) {
      var c = {}, m = {}, dif = {};
      ['kcal', 'p', 'c', 'g'].forEach(function (k) {
        c[k] = avg(base.map(function (d) { return d.cons[k]; }));
        m[k] = avg(base.map(function (d) { return d.meta[k]; }));
        dif[k] = ri(c[k]) - ri(m[k]);
      });
      var o = fora(c, m);
      var fib = avg(base.map(function (d) { return d.cons.fibra; }));
      function cel(k, rot, un) {
        var ruim = k === 'p' ? o.p : k === 'kcal' ? o.kcal : o[k] && dif[k] > 0;
        return '<div class="sw-m' + (ruim ? (k === 'p' ? ' sw-falta' : ' sw-acima') : '') + '"><span>' + rot + '</span><b>' + ri(c[k]) + un + '</b><i>meta ' + ri(m[k]) + ' · ' + sinal(dif[k]) + '</i></div>';
      }
      h += '<div class="sw-medias">' + cel('kcal', 'Calorias', '') + cel('p', 'Proteína', ' g') + cel('c', 'Carbo', ' g') + cel('g', 'Gordura', ' g') + '</div>';
      var ok = base.filter(function (d) { return naMeta(d.cons, d.meta); }).length;
      var pOk = base.filter(function (d) { return ri(d.cons.p) >= ri(d.meta.p); }).length;
      h += '<div class="sw-l">Dias na meta: <b>' + ok + ' de ' + n + '</b> · proteína batida: <b>' + pOk + ' de ' + n + '</b>' + (fib > 0 ? ' · fibra média ' + ri(fib) + ' g' : '') + '</div>';
    } else {
      h += '<div class="sw-l">Nenhum dia com registro completo nesta semana — sem médias.</div>';
    }
    var comp = fechados.filter(function (d) { return d.registro === 'completo' && d.refeicoes > 0; }).length;
    h += '<div class="sw-l sw-mut">Registro completo: ' + comp + ' de ' + total + ' dia' + (total === 1 ? '' : 's') + (n < total ? ' · as médias usam só esses ' + n : '') + '</div></section>';

    // gráficos
    h += '<section class="sw-card">' +
      barras(dias, 'kcal', 'sw-kcal', 'Calorias por dia', function (d) { return d.cons.kcal - d.meta.kcal > 75; }) +
      barras(dias, 'p', 'sw-p', 'Proteína (g) por dia') +
      '<div class="sw-leg"><span><i class="sw-k sw-kcal"></i>calorias</span><span><i class="sw-k sw-over"></i>acima da meta (+75)</span><span><i class="sw-k sw-p"></i>proteína</span>' +
      (dias.some(function (d) { return d.fechado && d.refeicoes && !conta(d); }) ? '<span><i class="sw-k sw-kcal sw-inc"></i>registro incompleto</span>' : '') + '</div></section>';

    // por dia
    h += '<section class="sw-card"><div class="sw-h">Por dia</div><table class="sw-tab"><thead><tr><th>Dia</th><th>kcal</th><th>P</th><th>C</th><th>G</th><th>Peso</th></tr></thead><tbody>';
    dias.forEach(function (d) {
      var rot = '<td>' + diaSem(d.data) + ' ' + ddmm(d.data) + '</td>';
      if (d.falta || !d.fechado) { h += '<tr class="sw-vazio">' + rot + '<td colspan="5">' + (d.falta ? 'sem dados' : 'dia em aberto') + '</td></tr>'; return; }
      var pes = d.peso != null ? kg(d.peso) : '—';
      if (!d.refeicoes) { h += '<tr class="sw-vazio">' + rot + '<td colspan="4">sem registro (fora das médias)</td><td>' + pes + '</td></tr>'; return; }
      var o2 = fora(d.cons, d.meta);
      h += '<tr' + (conta(d) ? '' : ' class="sw-incl"') + '>' + rot +
        '<td' + (o2.kcal ? ' class="sw-acima"' : '') + '>' + ri(d.cons.kcal) + ' <i>' + sinal(ri(d.cons.kcal) - ri(d.meta.kcal)) + '</i></td>' +
        '<td' + (o2.p ? ' class="sw-falta"' : '') + '>' + ri(d.cons.p) + '</td>' +
        '<td' + (o2.c ? ' class="sw-acima"' : '') + '>' + ri(d.cons.c) + '</td>' +
        '<td' + (o2.g ? ' class="sw-acima"' : '') + '>' + ri(d.cons.g) + '</td><td>' + pes + '</td></tr>';
      if (!conta(d)) h += '<tr class="sw-nota"><td></td><td colspan="5">registro ' + (d.registro === 'parcial' ? 'parcial' : 'não confirmado') + ' · fora das médias</td></tr>';
    });
    h += '</tbody></table></section>';

    // onde foram as calorias + proteína por refeição
    if (n) {
      var t = topAlimentos(base), pr = protRefeicao(base);
      if (t.kcal.length) {
        h += '<section class="sw-card"><div class="sw-h">Onde foram as calorias <span>· ' + ri(t.tot) + ' kcal em ' + n + ' dia' + (n > 1 ? 's' : '') + '</span></div><ol class="sw-top">' +
          t.kcal.map(function (x) { return '<li><span>' + esc(x.nome) + ' <i>' + x.dias + '/' + n + ' dias</i></span><b>' + ri(x.v) + ' kcal</b><em>' + x.pct + '%</em></li>'; }).join('') + '</ol>' +
          (t.g.length ? '<div class="sw-l sw-mut">Mais gordura: ' + t.g.map(function (x) { return esc(x.nome) + ' ' + ri(x.v) + ' g (' + x.pct + '%)'; }).join(' · ') + '</div>' : '') + '</section>';
      }
      if (pr.length) {
        var maior = Math.max.apply(null, pr.map(function (x) { return x.g; })) || 1;
        h += '<section class="sw-card"><div class="sw-h">Proteína por refeição <span>· média dos dias em que ela aconteceu</span></div>' +
          pr.map(function (x) {
            return '<div class="sw-pr"><span>' + x.h + '</span><span class="sw-trilho"><span style="width:' + (100 * x.g / maior).toFixed(1) + '%"></span></span><b>' + ri(x.g) + ' g <i>' + x.dias + '/' + n + '</i></b></div>';
          }).join('') + '</section>';
      }
    }

    // peso
    var ps = fechados.concat(dias.filter(function (d) { return !d.fechado && !d.falta; })).filter(function (d) { return d.peso != null; })
      .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    h += '<section class="sw-card"><div class="sw-h">Peso</div>';
    if (ps.length) {
      h += '<div class="sw-l">Média <b>' + kg(avg(ps.map(function (d) { return d.peso; }))) + ' kg</b> · ' + ps.length + ' pesage' + (ps.length > 1 ? 'ns' : 'm') + '</div>';
      if (ps.length >= 2) {
        var dl = ps[ps.length - 1].peso - ps[0].peso;
        h += '<div class="sw-l">' + kg(ps[0].peso) + ' (' + ddmm(ps[0].data) + ') → ' + kg(ps[ps.length - 1].peso) + ' kg (' + ddmm(ps[ps.length - 1].data) + '): <b>' +
          (N.arred(dl, 1) > 0 ? '+' : N.arred(dl, 1) < 0 ? '−' : '') + kg(Math.abs(dl)) + ' kg</b></div>';
      }
      if (obj && window.NutriObjetivo) {
        var O = window.NutriObjetivo, u = ps[ps.length - 1];
        var esp = O.calc(obj, u.data).esperado(u.data), st = O.status(u.peso, esp);
        h += '<div class="sw-l">Esperado pelo objetivo em ' + ddmm(u.data) + ': ' + kg(esp) + ' kg · <span class="obj-' + st.cls + '">' + esc(st.txt) + '</span></div>';
      }
    } else {
      h += '<div class="sw-l sw-mut">Sem pesagem no período.</div>';
    }
    h += '</section>';

    // pontos de atenção: só leitura dos números, sem prescrever dieta (= Resumo da semana do Histórico)
    if (n) {
      var at = [];
      if (o.kcal && dif.kcal > 0) at.push('Calorias acima da meta em média (' + sinal(dif.kcal) + ' kcal/dia).');
      if (o.kcal && dif.kcal < 0) at.push('Calorias bem abaixo da meta em média (' + sinal(dif.kcal) + ' kcal/dia).');
      if (o.p) at.push('Proteína abaixo da meta em média (' + sinal(dif.p) + ' g/dia).');
      if (o.c) at.push('Carboidrato acima da meta em média (' + sinal(dif.c) + ' g/dia).');
      if (o.g) at.push('Gordura acima da meta em média (' + sinal(dif.g) + ' g/dia).');
      if (n < total) at.push((total - n) + ' dia(s) sem registro completo ficaram fora das médias.');
      if (!at.length) at.push('Nenhum: médias dentro da meta.');
      h += '<section class="sw-card"><div class="sw-h">Pontos de atenção</div><ul class="sw-at">' + at.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></section>';
    }

    var agora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Los_Angeles', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
    h += '<div class="sw-rod">Nutrição Hoje · gerado em ' + esc(agora) + ' (horário de LA) · tolerâncias: kcal ±75, proteína −10 g, carbo +10 g, gordura +5 g</div>';
    box.innerHTML = h;

    // navegação entre semanas (fora da impressão)
    var nav = document.getElementById('swNav');
    var ant = N.somaDias(ate, -7), prox = N.somaDias(ate, 7);
    nav.innerHTML = '<a href="./semana.html?ate=' + ant + '">← 7 dias antes</a>' +
      (ate < maxAte ? '<a href="./semana.html' + (prox >= maxAte ? '' : '?ate=' + prox) + '">7 dias depois →</a>' : '<span></span>');
    nav.hidden = false;
    document.title = 'Semana ' + ddmm(ini) + ' a ' + ddmm(ate) + ' · Nutrição';
  }

  var btn = document.getElementById('swImprimir');
  if (btn) btn.addEventListener('click', function () { window.print(); });

  var pedido = (/[?&]ate=(\d{4}-\d{2}-\d{2})/.exec(location.search) || [])[1] || null;
  var hoje = N.hojeLA();
  Promise.all([get('dados/dias.json'), window.NutriObjetivo ? window.NutriObjetivo.carregar().catch(function () { return null; }) : Promise.resolve(null)]).then(function (r) {
    var todas = (Array.isArray(r[0]) ? r[0] : []).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= hoje; }).sort();
    var obj = r[1];
    if (!todas.length) { box.innerHTML = '<div class="hist-summary-empty">Nenhum dia registrado ainda.</div>'; return; }
    // dia fechado mais recente (normalmente ontem): procura nos últimos dias do índice
    var recentes = todas.slice(-4);
    Promise.all(recentes.map(function (d) { return get('dados/' + d + '.json'); })).then(function (arqs) {
      var maxAte = null;
      arqs.forEach(function (a, i) { if (a && a.fechado) maxAte = recentes[i]; });
      if (!maxAte) maxAte = N.somaDias(hoje, -1);
      var ate = pedido && pedido <= maxAte ? pedido : maxAte;
      var datas = [];
      for (var k = 6; k >= 0; k--) datas.push(N.somaDias(ate, -k));
      return Promise.all(datas.map(function (d) { return todas.indexOf(d) >= 0 ? get('dados/' + d + '.json') : Promise.resolve(null); })).then(function (dd) {
        render(datas.map(function (d, i) { return linha(d, dd[i]); }), ate, maxAte, obj);
      });
    });
  });
})();
