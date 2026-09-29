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

  function cardHoje(o, hoje, pesoHoje) {
    var c = calc(o, hoje);
    var h = '<section class="obj-card">';
    h += '<div class="obj-top"><span class="obj-nome">🎯 ' + esc(o.nome || 'Objetivo') + '</span><span class="obj-data">alvo ' + curta(o.data_alvo) + '</span></div>';
    if (c.faltam < 0) {
      h += '<div class="obj-big">🏁 Data alvo passou</div>';
      if (pesoHoje != null) {
        h += '<div class="obj-line">Resultado: ' + kg(o.peso_inicial_kg) + ' → ' + kg(pesoHoje) + ' kg (' + sinal(pesoHoje - o.peso_inicial_kg) + ' kg) · meta era ' + kg(c.esperadoAlvo) + ' kg</div>';
      }
      h += '<div class="obj-line obj-muted">Pra começar outro, fale pro Grok: "novo objetivo: 15/11, perder 0,5 kg por semana".</div>';
      return h + '</section>';
    }
    h += '<div class="obj-big">' + (c.faltam === 0 ? 'É hoje!' : 'Faltam ' + c.faltam + ' dia' + (c.faltam > 1 ? 's' : '')) + '</div>';
    var pct = c.tot ? Math.round(100 * c.passados / c.tot) : 100;
    h += '<div class="obj-bar"><div style="width:' + pct + '%"></div></div>';
    h += '<div class="obj-line obj-muted">Dia ' + (c.passados + 1) + ' de ' + (c.tot + 1) + ' · semana ' + c.semana + '</div>';
    function mil(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
    h += '<div class="obj-line"><b>Meta da semana:</b> −' + kg(o.meta_semanal_kg) + ' kg (−' + lb(o.meta_semanal_kg) + ' lb) → ~' + kg(c.esperadoFimSemana) + ' kg até ' + curta(c.fimSemana) + '</div>';
    if (o.calculo) {
      h += '<div class="obj-line obj-muted">Pelo déficit: gasto ~' + mil(o.calculo.gasto_estimado) + ' − comendo ~' + mil(o.calculo.ingestao_media) +
        ' = ~' + mil(o.calculo.deficit_dia) + ' kcal/dia</div>';
    }
    if (c.passados < 7) {
      h += '<div class="obj-line obj-muted">1ª semana: a balança costuma cair mais (água e glicogênio), não é tudo gordura.</div>';
    }
    if (pesoHoje != null) {
      var st = status(pesoHoje, c.esperadoHoje);
      h += '<div class="obj-line">Hoje ' + kg(pesoHoje) + ' kg · esperado ' + kg(c.esperadoHoje) + ' kg · <span class="obj-' + st.cls + '">' + st.txt + '</span></div>';
    } else {
      h += '<div class="obj-line obj-muted">Mande o peso de hoje pro Grok pra comparar com o esperado (' + kg(c.esperadoHoje) + ' kg).</div>';
    }
    h += '<div class="obj-line obj-muted">Esperado em ' + curta(o.data_alvo) + ': ' + kg(c.esperadoAlvo) + ' kg (' + lb(c.esperadoAlvo) + ' lb) · total ' + sinal(c.esperadoAlvo - o.peso_inicial_kg) + ' kg</div>';
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
    carregar().then(function (o) {
      el.innerHTML = o ? cardHoje(o, dia || hojeISO(), peso) : '';
    });
  }

  window.NutriObjetivo = { calc: calc, carregar: carregar, montarHoje: montarHoje, status: status, curta: curta, hojeISO: hojeISO };
})();
