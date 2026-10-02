/* Objetivo com data alvo: contagem regressiva, meta da semana e peso esperado.
   Usado pelo Hoje (render.js chama NutriObjetivo.montarHoje) e pelo Histórico. */
(function () {
  var MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  var LB = 2.20462;

  var N = window.Nutri;
  function dias(a, b) { return N.diasEntre(a, b); }
  function somaDias(iso, n) { return N.somaDias(iso, n); }
  function curta(iso) { var p = iso.split('-'); return parseInt(p[2], 10) + ' ' + MESES[parseInt(p[1], 10) - 1]; }
  function kg(n) { return N.arred(n, 1).toFixed(1).replace('.', ','); }
  function lb(n) { return N.arred(n * LB, 1).toFixed(1).replace('.', ','); }
  function peso(n) { return kg(n) + '\u00a0kg (' + lb(n) + '\u00a0lb)'; }
  function sinal(n) { var r = N.arred(n, 1); return (r > 0 ? '+' : r < 0 ? '−' : '') + kg(Math.abs(r)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hojeISO() { return N.hojeLA(); }  // fuso de Los Angeles

  // números do objetivo para um dia qualquer
  function calc(o, hoje) {
    var tot = dias(o.inicio, o.data_alvo);
    var passados = Math.max(0, Math.min(tot, dias(o.inicio, hoje)));
    var sem = N.semana(o.inicio, o.data_alvo, hoje);   // mesma definição do Histórico
    var semana = sem.n;
    var fimSemana = sem.pesagem;
    function esperado(iso) {
      var d = Math.max(0, Math.min(tot, dias(o.inicio, iso)));
      return o.peso_inicial_kg - o.meta_semanal_kg * d / 7;
    }
    return {
      tot: tot, passados: passados, faltam: dias(hoje, o.data_alvo), semana: semana, sem: sem,
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
  // Simulação semana a semana até a gordura alvo (cenário em meta_final.ritmo, ex.: agressivo):
  // ritmo = % do peso por semana que cai conforme a gordura baixa; parte da perda vem de massa magra
  // (fração × Forbes: 10,4/(10,4+gordura)); pausa de manutenção a cada N semanas de déficit.
  // Parte do peso atual (média 7 dias), reconstruindo a composição desde o peso/gordura iniciais.
  function simular(mf, refKg, desde, medida, reais) {
    var r = mf.ritmo || {}, pct = r.pct_semana || [1.2, 1.0, 0.8], faixas = r.faixas_gordura || [15, 12];
    var fr = r.fracao_forbes != null ? r.fracao_forbes : 0.5, pausa = r.pausa_semanas || null, C = 10.4;
    // parâmetros inválidos (o validar.py já recusa; aqui só não quebra a tela)
    function num(x, lo, hi) { return typeof x === 'number' && isFinite(x) && x >= lo && x <= hi; }
    if (!Array.isArray(pct) || pct.length !== 3 || !pct.every(function (x) { return num(x, 0.01, 5); }) ||
        !Array.isArray(faixas) || faixas.length !== 2 || !faixas.every(function (x) { return num(x, 1, 80); }) ||
        !num(fr, 0, 1) || (pausa && !(Array.isArray(pausa) && pausa.length === 2 && num(pausa[0], 1, 52) && num(pausa[1], 0, 12)))) {
      return { erro: 'parâmetros do cenário inválidos (meta_final.ritmo)' };
    }
    var W0 = mf.peso_inicial_kg, bf0 = (mf.gordura_inicial_pct || 19) / 100, alvo = (mf.gordura_pct || 10) / 100;
    var base = { pct: bf0 * 100, txt: 'estimativa inicial ' + Math.round(bf0 * 100) + '%' };
    if (medida) {  // medida mais recente (foto/fita/DEXA): composição a partir do peso daquele dia
      // peso-base da medida = mesma média de 7 dias (pesagens reais) usada como peso atual, na data da medida
      var jm = janela7(reais || [], medida.data);
      W0 = jm ? jm.kg : refKg;
      bf0 = medida.pct / 100;
      base = { pct: medida.pct, txt: kg(medida.pct).replace(',0', '') + '% por ' + (medida.fonte || 'medida') + ' em ' + curta(medida.data) +
               (medida.antiga ? ' — medida antiga, sem nenhuma nos últimos 30 dias' : '') };
    }
    if (!(W0 > 0)) return null;
    var FM = W0 * bf0, FFM = W0 - FM;
    if (refKg >= W0) FM += refKg - W0;
    else for (var perda = W0 - refKg; perda > 1e-9; perda -= 0.1) {
      var passo = Math.min(0.1, perda), l = fr * C / (C + FM);
      FM -= passo * (1 - l); FFM -= passo * l;
    }
    var bfHoje = FM / (FM + FFM), magraHoje = FFM, sem = 0, ds = 0, cruza = {}, HORIZONTE = 260;
    while (FM / (FM + FFM) > alvo && sem < HORIZONTE) {
      if (pausa && ds && ds % pausa[0] === 0) sem += pausa[1];
      var W = FM + FFM, bf = W ? FM / W : 0;
      var t = bf * 100 > faixas[0] ? pct[0] : bf * 100 > faixas[1] ? pct[1] : pct[2];
      var dW = W * t / 100, lean = fr * C / (C + FM);
      for (var m = Math.floor(W - 1e-9); m >= W - dW; m--) {
        if (cruza[m] == null) cruza[m] = somaDias(desde, Math.round((sem + (W - m) / dW) * 7));
      }
      var mk = mf.peso_kg;   // meta final decimal (ex.: 80,5) também ganha data
      if (cruza[mk] == null && W > mk && mk >= W - dW) cruza[mk] = somaDias(desde, Math.round((sem + (W - mk) / dW) * 7));
      FM -= dW * (1 - lean); FFM -= dW * lean; sem++; ds++;
    }
    var atingido = FM / (FM + FFM) <= alvo;   // senão: horizonte de 5 anos esgotado sem chegar ao alvo
    return { atingido: atingido, bfHoje: bfHoje, bfFim: FM / (FM + FFM), fim: atingido ? somaDias(desde, sem * 7) : null,
             semanas: sem, pesoFim: FM + FFM, magraPerdida: magraHoje - FFM, cruza: cruza,
             cenario: r.cenario || 'cenário', base: base };
  }

  // Qual medida de gordura manda na previsão (decisão do Lucas, 30/09: a mais CONFIÁVEL, não a mais recente).
  // Prioridade dexa > fita > foto/lucas > bioimpedância, só entre medidas dos últimos 30 dias (senão, a mais
  // recente de qualquer tipo). Da fonte escolhida: média das leituras das 2 semanas até a última dela.
  var PRIORIDADE = { dexa: 4, fita: 3, foto: 2, lucas: 2, bioimpedancia: 1 };
  var NOME_FONTE = { dexa: 'DEXA', fita: 'fita', foto: 'foto', lucas: 'informado', bioimpedancia: 'bioimpedância' };
  function escolherMedida(medidas, hoje) {
    var validas = (medidas || []).filter(function (m) {
      return m && m.data <= hoje && typeof m.pct === 'number' && isFinite(m.pct);   // nada do futuro
    }).sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
    if (!validas.length) return null;
    var recentes = validas.filter(function (m) { return dias(m.data, hoje) <= 30; });   // recência contada de HOJE
    var antiga = !recentes.length;
    var pool = antiga ? [validas[validas.length - 1]] : recentes;
    var melhor = pool.reduce(function (a, m) {
      var pa = PRIORIDADE[a.fonte] || 0, pm = PRIORIDADE[m.fonte] || 0;
      return pm > pa || (pm === pa && m.data > a.data) ? m : a;
    });
    // média só das leituras DA MESMA FONTE (identidade, não prioridade) nas 2 semanas até a última dela
    var mesmas = pool.filter(function (m) { var k = dias(m.data, melhor.data); return m.fonte === melhor.fonte && k >= 0 && k < 14; });
    var media = mesmas.reduce(function (s, m) { return s + m.pct; }, 0) / mesmas.length;
    return { data: melhor.data, pct: media, n: mesmas.length, antiga: antiga, idadeDias: dias(melhor.data, hoje), fonteId: melhor.fonte,
             fonte: (NOME_FONTE[melhor.fonte] || melhor.fonte || 'medida') + (mesmas.length > 1 ? ', média de ' + mesmas.length : '') };
  }


  // Estado dos marcos (função pura, testada em tests/test_marcos.py):
  // - média = pesagens REAIS dos 7 dias até a última pesagem (informa quantas); nada de "último peso" como média;
  // - marco confirmado só com MIN_CONFIRMAR+ pesagens na janela; a data da conquista usa a mesma regra;
  // - previsões partem de HOJE (fuso de LA), não da data da última pesagem; medidas de gordura idem.
  var MIN_CONFIRMAR = 2;
  function janela7(reais, ate) {
    var win = reais.filter(function (r) { var k = dias(r.data, ate); return k >= 0 && k < 7; });
    if (!win.length) return null;
    return { kg: win.reduce(function (s, r) { return s + r.kg; }, 0) / win.length, n: win.length };
  }
  function estadoMarcos(o, reais, medidas, hoje) {
    var mf = o.meta_final;
    reais = (reais || []).filter(function (r) { return r.data <= hoje; });
    if (!mf || !(mf.peso_kg > 0) || !reais.length) return null;
    var ultData = reais[reais.length - 1].data;
    var jan = janela7(reais, ultData);
    var ref = jan.kg, confirma = jan.n >= MIN_CONFIRMAR;
    var inicio = mf.peso_inicial_kg || o.peso_inicial_kg || reais[0].kg;
    var marcos = [];
    // marcos inteiros acima da meta + a própria meta (mesmo decimal, ex.: 80,5) como último marco
    for (var m = Math.ceil(inicio) - 1; m > mf.peso_kg; m--) marcos.push(m);
    marcos.push(mf.peso_kg);
    function quando(m) {  // 1º dia em que a média de 7 dias (com amostras suficientes) ficou ≤ marco
      for (var i = 0; i < reais.length; i++) {
        var w = janela7(reais, reais[i].data);
        if (w.n >= MIN_CONFIRMAR && w.kg <= m) return reais[i].data;
      }
      return null;
    }
    var lista = marcos.map(function (m) {
      var abaixo = ref <= m;
      return { kg: m, ok: abaixo && confirma, pendente: abaixo && !confirma, data: abaixo && confirma ? quando(m) : null };
    });
    var prox = marcos.filter(function (m) { return ref > m; })[0];
    var desde = hoje > ultData ? hoje : ultData;       // referência da previsão = hoje
    var med = escolherMedida((medidas || []).filter(function (x) { return x.data <= hoje; }), hoje);
    var sim = simular(mf, ref, desde, med, reais);
    var rit = ritmoKgDia(reais, o);
    function previsao(alvo) {
      if (ref <= alvo) return null;
      if (sim && sim.cruza && sim.cruza[alvo]) return sim.cruza[alvo];
      return rit ? somaDias(desde, Math.ceil((ref - alvo) / rit.kgDia)) : null;
    }
    var semPesar = dias(ultData, hoje);
    return { mf: mf, ref: ref, n: jan.n, ultData: ultData, desde: desde, semPesar: semPesar, desatualizada: semPesar > 7,
             confirma: confirma, inicio: inicio, marcos: lista, prox: prox, previsao: previsao,
             medida: med, sim: sim, rit: rit };
  }

  // det (opcional): lista onde vão as linhas EXPLICATIVAS (o cartão do Hoje mostra em "Ver detalhes");
  // sem det, tudo fica à vista. Avisos (obj-warn) ficam sempre à vista.
  function marcosHtml(o, reais, medidas, hoje, det) {
    var e = estadoMarcos(o, reais, medidas, hoje);
    if (!e || !e.marcos.length) return '';
    var mf = e.mf, ref = e.ref, sim = e.sim, rit = e.rit;
    function prev(alvo) {
      var d = e.previsao(alvo);
      return d ? ' · ~' + curta(d) + (e.desatualizada ? ' (previsão desatualizada)' : '') : '';
    }
    var feitos = e.marcos.filter(function (x) { return x.ok; }).length;
    var h = '<div class="obj-marcos">';
    function mais(linha) { if (det) det.push(linha); else h += linha; }
    h += '<div class="obj-line"><b>🏔 Marcos</b> · ' + feitos + ' de ' + e.marcos.length +
      (e.prox != null ? ' · próximo <b>' + kg(e.prox).replace(',0', '') + ' kg</b> (falta ' + kg(ref - e.prox) + ' kg' + prev(e.prox) + ')' : ' · todos!') + '</div>';
    h += '<div class="marcos-chips">' + e.marcos.map(function (x) {
      var tag = x.kg === mf.peso_kg ? ' 🏁' : (x.kg === mf.satisfeito_kg ? ' ⭐' : '');
      return '<span class="marco' + (x.ok ? ' ok' : '') + (x.kg === e.prox ? ' prox' : '') + '"' +
        (x.data ? ' title="' + curta(x.data) + '"' : (x.pendente ? ' title="falta pesagem para confirmar"' : '')) + '>' +
        (x.ok ? '✓ ' : (x.pendente ? '… ' : '')) + kg(x.kg).replace(',0', '') + tag + '</span>';
    }).join('') + '</div>';
    var total = e.inicio - mf.peso_kg, feito = Math.max(0, Math.min(total, e.inicio - ref));
    h += '<div class="obj-bar marcos-bar"><div style="width:' + Math.round(100 * feito / total) + '%"></div></div>';
    var media = '<div class="obj-line obj-muted">Média 7 dias <b>' + kg(ref) + ' kg</b> (' + e.n + ' pesage' + (e.n > 1 ? 'ns' : 'm') +
      ' até ' + curta(e.ultData) + ')' + (e.confirma ? '' : ' — marcos só se confirmam com ' + MIN_CONFIRMAR + '+ pesagens na semana') +
      (e.semPesar > 7 ? ' · <span class="obj-warn">última pesagem há ' + e.semPesar + ' dias; a previsão parte dela</span>' : '') + '</div>';
    if (e.semPesar > 7) h += media; else mais(media);
    h += '<div class="obj-line obj-muted">Meta final <b>' + mf.peso_kg + ' kg</b>' + (mf.gordura_pct ? ' (~' + mf.gordura_pct + '% de gordura' + (mf.gordura_inicial_pct ? ', saindo de ~' + mf.gordura_inicial_pct + '%' : '') + ')' : '') +
      (mf.satisfeito_kg ? ' · ⭐ ' + mf.satisfeito_kg + ' kg satisfeito' : '') + ' · faltam ' + kg(Math.max(0, ref - mf.peso_kg)) + ' kg' +
      prev(mf.peso_kg) + (mf.depois ? ' · depois: ' + esc(mf.depois) : '') + '</div>';
    if (sim && sim.erro) {
      h += '<div class="obj-line obj-warn">📉 Previsão indisponível: ' + esc(sim.erro) + '.</div>';
    } else if (sim && !sim.atingido) {
      h += '<div class="obj-line obj-warn">📉 Com estes parâmetros o cenário não chega a ' + (mf.gordura_pct || 10) + '% em ' + Math.round(sim.semanas / 52) +
        ' anos (pararia em ~' + Math.round(sim.bfFim * 100) + '%). Previsão dos 10% indisponível.</div>';
    } else if (sim) {
      var r = mf.ritmo || {}, pct = r.pct_semana || [1.2, 1.0, 0.8];
      mais('<div class="obj-line obj-muted">📉 Cenário ' + esc(sim.cenario) + ' (' + pct.map(function (x) { return kg(x).replace(',0', ''); }).join(' → ') +
        '% do peso/sem, desacelerando' + (r.pausa_semanas ? '; 1 sem de manutenção a cada ' + r.pausa_semanas[0] : '') + '): gordura hoje ~' +
        Math.round(sim.bfHoje * 100) + '% (base: ' + esc(sim.base.txt) + ') · <b>' + (mf.gordura_pct || 10) + '% ≈ ' + curta(sim.fim) + ' ' + sim.fim.slice(0, 4) + '</b> com ~' + kg(sim.pesoFim) +
        ' kg (~' + kg(sim.magraPerdida) + ' kg de massa magra perdida até lá)' + (e.desatualizada ? ' — previsão desatualizada (última pesagem há ' + e.semPesar + ' dias)' : '') +
        '. Estimativa: fica mais certa a cada medida de gordura (foto, fita ou DEXA).</div>');
    }
    if (rit && rit.fonte === 'ritmo atual') {
      mais('<div class="obj-line obj-muted">Ritmo real das últimas 2 semanas: −' + kg(rit.kgDia * 7) + ' kg/sem.</div>');
    }
    return h + '</div>';
  }

  // "Ver detalhes" aberto/fechado: lembrado só neste navegador (conveniência; sem armazenamento, começa fechado)
  var CHAVE_DET = 'nutri-obj-detalhes';
  function lembrarDetalhes() { try { return window.localStorage.getItem(CHAVE_DET) === '1'; } catch (e) { return false; } }
  if (typeof document !== 'undefined') document.addEventListener('toggle', function (ev) {
    if (!ev.target || ev.target.id !== 'objDetalhes') return;
    try { window.localStorage.setItem(CHAVE_DET, ev.target.open ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
  }, true);

  function cardHoje(o, hoje, pesoHoje, estimado, reais, medidas) {
    var c = calc(o, hoje);
    var h = '<section class="obj-card">';
    h += '<div class="obj-top"><span class="obj-nome">🎯 ' + esc(o.nome || 'Objetivo') + '</span><span class="obj-data">alvo ' + curta(o.data_alvo) + '</span></div>';
    if (c.faltam < 0) {
      h += '<div class="obj-big">🏁 Data alvo passou</div>';
      if (pesoHoje != null) {
        h += '<div class="obj-line">Resultado: ' + peso(o.peso_inicial_kg) + ' → ' + peso(pesoHoje) + ' · ' + sinal(pesoHoje - o.peso_inicial_kg) + ' kg · meta era ' + peso(c.esperadoAlvo) + '</div>';
      }
      h += '<div class="obj-line obj-muted">Pra começar outro, fale pro Grok: "novo objetivo: 15/11, perder 0,5 kg por semana" — e diga as metas (kcal/P/C/G) e o seu gasto.</div>';
      h += marcosHtml(o, reais || [], medidas, hoje);
      return h + '</section>';
    }
    h += '<div class="obj-big">' + (c.faltam === 0 ? 'É hoje!' : 'Faltam ' + c.faltam + ' dia' + (c.faltam > 1 ? 's' : '')) + '</div>';
    if (c.faltam <= 3) {
      h += '<div class="obj-line obj-warn">Reta final: combine o próximo objetivo com o Grok — data alvo, metas (kcal/P/C/G) e gasto calórico.</div>';
    }
    var pct = c.tot ? Math.round(100 * c.passados / c.tot) : 100;
    h += '<div class="obj-bar"><div style="width:' + pct + '%"></div></div>';
    h += '<div class="obj-line obj-muted">Dia ' + (c.passados + 1) + ' de ' + (c.tot + 1) + ' · semana ' + c.semana + '</div>';
    function mil(n) { return String(N.ri(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
    var det = [];   // explicações do cálculo: ficam em "Ver detalhes" (os números principais continuam à vista)
    h += '<div class="obj-line"><b>Meta da semana ' + c.sem.n + '</b> (' + curta(c.sem.ini) + '–' + curta(c.sem.fim) + '): −' + kg(o.meta_semanal_kg) + ' kg (−' + lb(o.meta_semanal_kg) + ' lb) → ~' + peso(c.esperadoFimSemana) + ' na pesagem de ' + curta(c.sem.pesagem) + '</div>';
    if (o.calculo) {
      var fonte = o.calculo.gasto_fonte;
      var gastoTxt = fonte === 'informado' ? 'seu gasto ' + mil(o.calculo.gasto_estimado)
        : 'gasto estimado ~' + mil(o.calculo.gasto_estimado);
      det.push('<div class="obj-line obj-muted">Pelo déficit: ' + gastoTxt + ' − comendo ~' + mil(o.calculo.ingestao_media) +
        ' = ~' + mil(o.calculo.deficit_dia) + ' kcal/dia</div>');
      // gasto INFERIDO pelos registros (não é medido): só informativo, não entra na meta
      var gi = o.calculo.gasto_inferido, gf = o.calculo.gasto_inferido_falta;
      if (gi) {
        det.push('<div class="obj-line obj-muted">Estimado pelos seus registros (' + gi.dias_completos + ' dias completos, ' + gi.pesagens + ' pesagens, cobertura ' + gi.cobertura_pct + '%): gasto ~' + mil(gi.kcal) + ' kcal/dia — só pra comparar, não muda a meta.</div>');
      } else if (gf) {
        det.push('<div class="obj-line obj-muted">Gasto estimado pelos registros ainda não: ' + esc(typeof gf === 'string' ? gf : gf.falta) + '.</div>');
      }
      if (o.calculo.ingestao_fonte && o.calculo.dias_completos != null) {
        det.push('<div class="obj-line obj-muted">Ingestão usada: ' + esc(o.calculo.ingestao_fonte) + '.</div>');
      }
      if (o.meta_modo === 'manual') {
        det.push('<div class="obj-line obj-muted">Meta semanal manual (escolhida por você); pelo cálculo seria −' + kg(o.calculo.meta_calculada_kg || 0) + ' kg/sem.</div>');
      }
    }
    if (c.passados < 7) {
      det.push('<div class="obj-line obj-muted">1ª semana: a balança costuma cair mais (água e glicogênio), não é tudo gordura.</div>');
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
    var nReais = (reais || []).length;
    det.push('<div class="obj-line obj-muted">Pesagens: ' + nReais + (nReais ? ' · última em ' + curta(reais[nReais - 1].data) : '') + ' (dias sem pesagem aparecem como estimativa e não contam como medida)</div>');
    h += '<div class="obj-line obj-muted">Esperado em ' + curta(o.data_alvo) + ': ' + peso(c.esperadoAlvo) + ' · total ' + sinal(c.esperadoAlvo - o.peso_inicial_kg) + ' kg</div>';
    h += marcosHtml(o, reais || [], medidas, hoje, det);
    if (det.length) {
      h += '<details class="obj-mais" id="objDetalhes"' + (lembrarDetalhes() ? ' open' : '') + '><summary>Ver detalhes do cálculo</summary>' + det.join('') + '</details>';
    }
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
  function montarHoje(pesoHoje, dia, diaDados) {
    var el = document.getElementById('objetivo');
    if (!el) return;
    var peso = (pesoHoje == null || pesoHoje === '' || isNaN(Number(pesoHoje))) ? null : Number(pesoHoje);
    var d = dia || hojeISO();
    // pesos reais anteriores a hoje (resumo.json) + o de hoje: base dos marcos e do "repetindo o último"
    var historico = fetch('dados/resumo.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (lista) { return (lista || []).filter(function (x) { return x.data < d; }); })
      .catch(function () { return []; });
    Promise.all([carregar(), historico]).then(function (r) {
      var o = r[0], lista = r[1].slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; });
      var reais = lista.filter(function (x) { return x.peso != null; }).map(function (x) { return { data: x.data, kg: Number(x.peso) }; });
      var medidas = lista.filter(function (x) { return x.gordura != null; })
        .map(function (x) { return { data: x.data, pct: Number(x.gordura), fonte: x.gordura_fonte }; });
      if (diaDados && diaDados.gordura_pct != null && !isNaN(Number(diaDados.gordura_pct))) {
        medidas.push({ data: d, pct: Number(diaDados.gordura_pct), fonte: diaDados.gordura_fonte });
      }
      if (!o) { el.innerHTML = ''; return; }
      var u = peso == null && reais.length ? reais[reais.length - 1] : null;
      var todos = peso != null ? reais.concat([{ data: d, kg: peso }]) : reais;
      el.innerHTML = u ? cardHoje(o, d, u.kg, 'repetindo o de ' + curta(u.data) + ' até você se pesar', todos, medidas)
                       : cardHoje(o, d, peso, null, todos, medidas);
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

  window.NutriObjetivo = { estadoMarcos: estadoMarcos, escolherMedida: escolherMedida, serieDiaria: serieDiaria, calc: calc, peso: peso, carregar: carregar, montarHoje: montarHoje, status: status, curta: curta, hojeISO: hojeISO };
})();
