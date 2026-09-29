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

  function cardHoje(o, hoje, pesoHoje, estimado) {
    var c = calc(o, hoje);
    var h = '<section class="obj-card">';
    h += '<div class="obj-top"><span class="obj-nome">🎯 ' + esc(o.nome || 'Objetivo') + '</span><span class="obj-data">alvo ' + curta(o.data_alvo) + '</span></div>';
    if (c.faltam < 0) {
      h += '<div class="obj-big">🏁 Data alvo passou</div>';
      if (pesoHoje != null) {
        h += '<div class="obj-line">Resultado: ' + peso(o.peso_inicial_kg) + ' → ' + peso(pesoHoje) + ' · ' + sinal(pesoHoje - o.peso_inicial_kg) + ' kg · meta era ' + peso(c.esperadoAlvo) + '</div>';
      }
      h += '<div class="obj-line obj-muted">Pra começar outro, fale pro Grok: "novo objetivo: 15/11, perder 0,5 kg por semana" — e diga as metas (kcal/P/C/G) e o seu gasto.</div>';
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
      var gastoTxt = o.calculo.gasto_fonte === 'informado' ? 'seu gasto ' + mil(o.calculo.gasto_estimado) : 'gasto estimado ~' + mil(o.calculo.gasto_estimado);
      h += '<div class="obj-line obj-muted">Pelo déficit: ' + gastoTxt + ' − comendo ~' + mil(o.calculo.ingestao_media) +
        ' = ~' + mil(o.calculo.deficit_dia) + ' kcal/dia</div>';
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
    return h + '</section>';
  }

  function carregar() {
    return fetch('dados/objetivo.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (j) { return j && j.atual ? j.atual : null; })
      .catch(function () { return null; });
  }

  // Hoje: insere o card no #objetivo
  function montarHoje(pesoHoje, dia) {
    var el = document.getElementById('objetivo');
    if (!el) return;
    var peso = (pesoHoje == null || pesoHoje === '' || isNaN(Number(pesoHoje))) ? null : Number(pesoHoje);
    var d = dia || hojeISO();
    var ultimo = peso != null ? Promise.resolve(null) :
      fetch('dados/resumo.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (lista) {
          var reais = (lista || []).filter(function (x) { return x.peso != null && x.data < d; })
            .map(function (x) { return { data: x.data, kg: Number(x.peso) }; })
            .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
          return reais.length ? reais[reais.length - 1] : null;
        })
        .catch(function () { return null; });
    Promise.all([carregar(), ultimo]).then(function (r) {
      var o = r[0], u = r[1];
      if (!o) { el.innerHTML = ''; return; }
      el.innerHTML = u ? cardHoje(o, d, u.kg, 'repetindo o de ' + curta(u.data) + ' até você se pesar')
                       : cardHoje(o, d, peso);
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
