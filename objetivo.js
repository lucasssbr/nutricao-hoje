/* Objetivo com data alvo: contagem regressiva, meta da semana e peso esperado.
   Usado pelo Hoje (render.js chama NutriObjetivo.montarHoje) e pelo Histórico. */
(function () {
  var MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  var LB = 2.20462;

  function dias(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
  function somaDias(iso, n) {
    var d = new Date(Date.parse(iso) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  function curta(iso) { var p = iso.split('-'); return parseInt(p[2], 10) + ' ' + MESES[parseInt(p[1], 10) - 1]; }
  function kg(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }
  function lb(n) { return (Math.round(n * LB * 10) / 10).toFixed(1).replace('.', ','); }
  function peso(n) { return kg(n) + '\u00a0kg (' + lb(n) + '\u00a0lb)'; }
  function sinal(n) { var r = Math.round(n * 10) / 10; return (r > 0 ? '+' : r < 0 ? '−' : '') + kg(Math.abs(r)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hojeISO() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }

  // números do objetivo para um dia qualquer
  function calc(o, hoje) {
    var tot = dias(o.inicio, o.data_alvo);
    var passados = Math.max(0, Math.min(tot, dias(o.inicio, hoje)));
    var semana = Math.min(Math.floor(passados / 7) + 1, Math.ceil(tot / 7));
    var fimSemana = somaDias(o.inicio, Math.min(tot, semana * 7));
    function esperado(iso) {
      var d = Math.max(0, Math.min(tot, dias(o.inicio, iso)));
      return o.peso_inicial_kg - o.meta_semanal_kg * d / 7;
    }
    return {
      tot: tot, passados: passados, faltam: dias(hoje, o.data_alvo), semana: semana,
      fimSemana: fimSemana, esperadoHoje: esperado(hoje), esperadoFimSemana: esperado(fimSemana),
      esperadoAlvo: esperado(o.data_alvo), esperado: esperado
    };
  }

  function status(real, esperado) {
    var d = real - esperado;
    if (d <= -0.3) return { cls: 'ok', txt: 'adiantado ' + kg(-d) + ' kg' };
    if (d < 0.3) return { cls: 'ok', txt: 'no ritmo' };
    return { cls: 'warn', txt: 'atrás ' + kg(d) + ' kg' };
  }

  // Marcos de 1 kg até a meta final (estilo Happy Scale). Referência = média dos últimos 7 dias de peso
  // (uma pesagem com água a mais não "desmarca" um marco). Previsão no ritmo atual (tendência de 14 dias)
  // ou, sem dados suficientes, na meta semanal do objetivo.
  function media7(reais, ate) {
    var win = reais.filter(function (r) { var k = dias(r.data, ate); return k >= 0 && k < 7; });
    if (!win.length) return null;
    return win.reduce(function (s, r) { return s + r.kg; }, 0) / win.length;
  }
  function ritmoKgDia(reais, o) {
    if (reais.length >= 5) {
      var ult = reais[reais.length - 1].data;
      var pts = reais.filter(function (r) { return dias(r.data, ult) < 14; });
      if (pts.length >= 5 && dias(pts[0].data, ult) >= 7) {
        var xs = pts.map(function (r) { return dias(pts[0].data, r.data); }), ys = pts.map(function (r) { return r.kg; });
        var mx = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length, my = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
        var num = 0, den = 0;
        xs.forEach(function (x, i) { num += (x - mx) * (ys[i] - my); den += (x - mx) * (x - mx); });
        if (den && num / den < 0) return { kgDia: -num / den, fonte: 'ritmo atual' };
      }
    }
    return o.meta_semanal_kg > 0 ? { kgDia: o.meta_semanal_kg / 7, fonte: 'ritmo da meta semanal' } : null;
  }
  function marcosHtml(o, reais) {
    var mf = o.meta_final;
    if (!mf || !(mf.peso_kg > 0) || !reais.length) return '';
    var ultData = reais[reais.length - 1].data;
    var ref = reais.length >= 3 ? media7(reais, ultData) : reais[reais.length - 1].kg;
    var inicio = mf.peso_inicial_kg || o.peso_inicial_kg || reais[0].kg;
    var marcos = [];
    for (var m = Math.ceil(inicio) - 1; m >= mf.peso_kg; m--) marcos.push(m);
    if (!marcos.length) return '';
    function quando(m) {  // 1º dia em que a média de 7 dias ficou ≤ marco
      for (var i = 0; i < reais.length; i++) {
        var md = i >= 2 ? media7(reais, reais[i].data) : null;
        if (md != null && md <= m) return reais[i].data;
      }
      return null;
    }
    var feitos = marcos.filter(function (m) { return ref <= m; });
    var prox = marcos.filter(function (m) { return ref > m; })[0];
    var rit = ritmoKgDia(reais, o);
    function previsao(alvo) {
      if (!rit || ref <= alvo) return '';
      return ' · ~' + curta(somaDias(ultData, Math.ceil((ref - alvo) / rit.kgDia)));
    }
    var h = '<div class="obj-marcos">';
    h += '<div class="obj-line"><b>🏔 Marcos</b> · ' + feitos.length + ' de ' + marcos.length +
      (prox != null ? ' · próximo <b>' + prox + '\u00a0kg</b> (falta ' + kg(ref - prox) + '\u00a0kg' + previsao(prox) + ')' : ' · todos!') + '</div>';
    h += '<div class="marcos-chips">' + marcos.map(function (m) {
      var ok = ref <= m, q = ok ? quando(m) : null;
      var tag = m === mf.peso_kg ? ' 🏁' : (m === mf.satisfeito_kg ? ' ⭐' : '');
      return '<span class="marco' + (ok ? ' ok' : '') + (m === prox ? ' prox' : '') + '"' + (q ? ' title="' + curta(q) + '"' : '') + '>' +
        (ok ? '✓ ' : '') + m + tag + '</span>';
    }).join('') + '</div>';
    var total = inicio - mf.peso_kg, feito = Math.max(0, Math.min(total, inicio - ref));
    h += '<div class="obj-bar marcos-bar"><div style="width:' + Math.round(100 * feito / total) + '%"></div></div>';
    h += '<div class="obj-line obj-muted">Meta final <b>' + mf.peso_kg + '\u00a0kg</b>' + (mf.gordura_pct ? ' (~' + mf.gordura_pct + '% de gordura)' : '') +
      (mf.satisfeito_kg ? ' · ⭐ ' + mf.satisfeito_kg + '\u00a0kg satisfeito' : '') + ' · faltam ' + kg(Math.max(0, ref - mf.peso_kg)) + '\u00a0kg' +
      (rit ? previsao(mf.peso_kg) + ' no ' + rit.fonte + ' (−' + kg(rit.kgDia * 7) + '\u00a0kg/sem)' : '') +
      ' · média 7 dias ' + kg(ref) + '\u00a0kg' + (mf.depois ? ' · depois: ' + esc(mf.depois) : '') + '</div>';
    return h + '</div>';
  }

  function cardHoje(o, hoje, pesoHoje, estimado, reais) {
    var c = calc(o, hoje);
    var h = '<section class="obj-card">';
    h += '<div class="obj-top"><span class="obj-nome">🎯 ' + esc(o.nome || 'Objetivo') + '</span><span class="obj-data">alvo ' + curta(o.data_alvo) + '</span></div>';
    if (c.faltam < 0) {
      h += '<div class="obj-big">🏁 Data alvo passou</div>';
      if (pesoHoje != null) {
        h += '<div class="obj-line">Resultado: ' + peso(o.peso_inicial_kg) + ' → ' + peso(pesoHoje) + ' · ' + sinal(pesoHoje - o.peso_inicial_kg) + ' kg · meta era ' + peso(c.esperadoAlvo) + '</div>';
      }
      h += '<div class="obj-line obj-muted">Pra começar outro, fale pro Grok: "novo objetivo: 15/11, perder 0,5 kg por semana" — e diga as metas (kcal/P/C/G) e o seu gasto.</div>';
      h += marcosHtml(o, reais || []);
      return h + '</section>';
    }
    h += '<div class="obj-big">' + (c.faltam === 0 ? 'É hoje!' : 'Faltam ' + c.faltam + ' dia' + (c.faltam > 1 ? 's' : '')) + '</div>';
    if (c.faltam <= 3) {
      h += '<div class="obj-line obj-warn">Reta final: combine o próximo objetivo com o Grok — data alvo, metas (kcal/P/C/G) e gasto calórico.</div>';
    }
    var pct = c.tot ? Math.round(100 * c.passados / c.tot) : 100;
    h += '<div class="obj-bar"><div style="width:' + pct + '%"></div></div>';
    h += '<div class="obj-line obj-muted">Dia ' + (c.passados + 1) + ' de ' + (c.tot + 1) + ' · semana ' + c.semana + '</div>';
    function mil(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
    h += '<div class="obj-line"><b>Meta da semana:</b> −' + kg(o.meta_semanal_kg) + ' kg (−' + lb(o.meta_semanal_kg) + ' lb) → ~' + peso(c.esperadoFimSemana) + ' até ' + curta(c.fimSemana) + '</div>';
    if (o.calculo) {
      var fonte = o.calculo.gasto_fonte;
      var gastoTxt = fonte === 'informado' ? 'seu gasto ' + mil(o.calculo.gasto_estimado)
        : 'gasto estimado ~' + mil(o.calculo.gasto_estimado);
      h += '<div class="obj-line obj-muted">Pelo déficit: ' + gastoTxt + ' − comendo ~' + mil(o.calculo.ingestao_media) +
        ' = ~' + mil(o.calculo.deficit_dia) + ' kcal/dia</div>';
      var gr = o.calculo.gasto_real;
      // gasto real pelos dados: só informativo (não entra na meta) — o Lucas compara com o dele
      if (gr) {
        h += '<div class="obj-line obj-muted">Pelos seus dados (' + gr.dias + ' dias, ' + gr.pesos + ' pesos), o gasto real está em ~' + mil(gr.kcal) + ' kcal/dia — só pra comparar, não muda a meta.</div>';
      } else if (o.calculo.gasto_real_falta) {
        h += '<div class="obj-line obj-muted">Gasto real (pelos seus dados) ainda não: ' + esc(o.calculo.gasto_real_falta) + '.</div>';
      }
    }
    if (c.passados < 7) {
      h += '<div class="obj-line obj-muted">1ª semana: a balança costuma cair mais (água e glicogênio), não é tudo gordura.</div>';
    }
    if (pesoHoje != null && estimado) {
      var st2 = status(pesoHoje, c.esperadoHoje);
      h += '<div class="obj-line">Hoje ~' + peso(pesoHoje) + ' <span class="obj-muted">(estimado: ' + esc(estimado) + ')</span> · esperado ' + peso(c.esperadoHoje) + ' · <span class="obj-' + st2.cls + '">' + st2.txt + '</span></div>';
    } else if (pesoHoje != null) {
      var st = status(pesoHoje, c.esperadoHoje);
      h += '<div class="obj-line">Hoje ' + peso(pesoHoje) + ' · esperado ' + peso(c.esperadoHoje) + ' · <span class="obj-' + st.cls + '">' + st.txt + '</span></div>';
    } else {
      h += '<div class="obj-line obj-muted">Mande o peso de hoje pro Grok pra comparar com o esperado (' + peso(c.esperadoHoje) + ').</div>';
    }
    h += '<div class="obj-line obj-muted">Esperado em ' + curta(o.data_alvo) + ': ' + peso(c.esperadoAlvo) + ' · total ' + sinal(c.esperadoAlvo - o.peso_inicial_kg) + ' kg</div>';
    h += marcosHtml(o, reais || []);
    return h + '</section>';
  }

  function carregar() {
    return fetch('dados/objetivo.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (j) {
        if (!j || !j.atual) return null;
        if (j.meta_final) j.atual.meta_final = j.meta_final;
        return j.atual;
      })
      .catch(function () { return null; });
  }

  // Hoje: insere o card no #objetivo
  function montarHoje(pesoHoje, dia) {
    var el = document.getElementById('objetivo');
    if (!el) return;
    var peso = (pesoHoje == null || pesoHoje === '' || isNaN(Number(pesoHoje))) ? null : Number(pesoHoje);
    var d = dia || hojeISO();
    // pesos reais anteriores a hoje (resumo.json) + o de hoje: base dos marcos e do "repetindo o último"
    var historico = fetch('dados/resumo.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (lista) {
        return (lista || []).filter(function (x) { return x.peso != null && x.data < d; })
          .map(function (x) { return { data: x.data, kg: Number(x.peso) }; })
          .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
      })
      .catch(function () { return []; });
    Promise.all([carregar(), historico]).then(function (r) {
      var o = r[0], reais = r[1];
      if (!o) { el.innerHTML = ''; return; }
      var u = peso == null && reais.length ? reais[reais.length - 1] : null;
      var todos = peso != null ? reais.concat([{ data: d, kg: peso }]) : reais;
      el.innerHTML = u ? cardHoje(o, d, u.kg, 'repetindo o de ' + curta(u.data) + ' até você se pesar', todos)
                       : cardHoje(o, d, peso, null, todos);
    });
  }

  // Série diária de peso sem buracos: dia sem registro entre dois pesos = média proporcional
  // (interpolação); depois do último peso = repete o último. Nada disso é gravado nos dados.
  function serieDiaria(reais, ate) {
    if (!reais.length) return [];
    var mapa = {};
    reais.forEach(function (r) { mapa[r.data] = r.kg; });
    var fim = ate && ate > reais[reais.length - 1].data ? ate : reais[reais.length - 1].data;
    var out = [];
    for (var dd = reais[0].data; dd <= fim; dd = somaDias(dd, 1)) {
      if (mapa[dd] != null) { out.push({ data: dd, kg: mapa[dd], estimado: false }); continue; }
      var prev = null, next = null;
      reais.forEach(function (r) { if (r.data < dd) prev = r; if (r.data > dd && !next) next = r; });
      var v = next ? prev.kg + (next.kg - prev.kg) * dias(prev.data, dd) / dias(prev.data, next.data) : prev.kg;
      out.push({ data: dd, kg: Math.round(v * 10) / 10, estimado: next ? 'média entre os dias vizinhos' : 'repetindo o último peso' });
    }
    return out;
  }

  window.NutriObjetivo = { serieDiaria: serieDiaria, calc: calc, peso: peso, carregar: carregar, montarHoje: montarHoje, status: status, curta: curta, hojeISO: hojeISO };
})();
