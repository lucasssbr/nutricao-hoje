(function () {
  var MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  var N = window.Nutri;
  var ri = N.ri;  // meio para longe do zero, igual ao Python

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function labelDia(iso) {
    var p = (iso || '').split('-');
    if (p.length !== 3) return iso || '—';
    var mi = parseInt(p[1], 10) - 1;
    return parseInt(p[2], 10) + ' ' + (MESES[mi] || p[1]) + ' ' + p[0];
  }

  function sumMeals(meals) {
    var t = { kcal: 0, p: 0, c: 0, g: 0 };
    (meals || []).forEach(function (m) {
      (m.itens || []).forEach(function (i) {
        t.kcal += Number(i.kcal) || 0;
        t.p += Number(i.p) || 0;
        t.c += Number(i.c) || 0;
        t.g += Number(i.g) || 0;
        if (i.fibra != null) t.fibra = (t.fibra || 0) + (Number(i.fibra) || 0);
      });
    });
    return t;
  }

  // Planilha (CSV) com todos os dias: pra fazer as contas por fora (Numbers, Excel, Google Sheets)
  function csvDias(dias) {
    // 1 casa decimal, mesmo arredondamento das telas; vazio = sem dado (≠ zero)
    function n(v) { return v == null || v === '' || isNaN(Number(v)) ? '' : String(N.arred(Number(v), 1)); }
    var linhas = ['data,fechado,registro,refeicoes,kcal,proteina_g,carbo_g,gordura_g,fibra_g,peso_kg,gordura_corporal_pct,gordura_fonte,meta_kcal,meta_p,meta_c,meta_g'];
    dias.forEach(function (d) {
      var m = d.meta || {};
      linhas.push([d.data, d.fechado ? 'sim' : 'nao', d.registro || 'desconhecido', d.refeicoes == null ? '' : d.refeicoes,
        n(d.cons.kcal), n(d.cons.p), n(d.cons.c), n(d.cons.g),
        n(d.cons.fibra), n(d.peso), n(d.gordura), d.gordura_fonte || '', n(m.kcal), n(m.p), n(m.c), n(m.g)].join(','));
    });
    return '\ufeff' + linhas.join('\n') + '\n';
  }

  function ligarBotaoCsv(dias) {
    var btn = document.getElementById('csvBtn');
    if (!btn || !dias.length) return;
    btn.hidden = false;
    btn.onclick = function () {
      var nome = 'nutricao-' + dias[0].data + '-a-' + dias[dias.length - 1].data + '.csv';
      var blob = new Blob([csvDias(dias)], { type: 'text/csv;charset=utf-8' });
      var arq = typeof File === 'function' ? new File([blob], nome, { type: 'text/csv' }) : null;
      // iPhone: menu de compartilhar (salvar em Arquivos, abrir no Numbers, mandar); senão, download
      if (arq && navigator.canShare && navigator.canShare({ files: [arq] })) {
        navigator.share({ files: [arq], title: nome }).catch(function () {});
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
  }

  function fmtPeso(kg) {
    if (kg == null || kg === '' || isNaN(Number(kg))) return '';
    var lb = N.arred(Number(kg) * 2.20462, 1).toFixed(1).replace('.', ',');
    return N.arred(Number(kg), 1).toFixed(1).replace('.', ',') + ' kg (' + lb + ' lb)';
  }

  function deltaStr(val, meta) {
    var d = ri(val) - ri(meta);
    if (d === 0) return '0';
    return (d > 0 ? '+' : '−') + Math.abs(d);
  }

  function isOrange(cons, meta) {
    return {
      kcal: Math.abs(cons.kcal - meta.kcal) > 75,
      p: (cons.p - meta.p) < -10,
      c: (cons.c - meta.c) > 10,
      g: (cons.g - meta.g) > 5
    };
  }

  // médias e "dias na meta" só com dias de REGISTRO COMPLETO (mesma regra do objetivo/previsão): dia sem nada
  // lançado (04/10) ou parcial não é "comi 0" — puxava a média de 2072 para 1281 kcal (06/10)
  function contaMedia(d) { return d.registro === 'completo' && d.refeicoes !== 0; }
  function foraLinha(dias) {
    var fora = dias.filter(function (d) { return !contaMedia(d); });
    if (!fora.length) return '';
    return '<div class="hist-summary-comp">Fora das médias: ' + fora.map(function (d) {
      return labelDia(d.data).replace(/ \d{4}$/, '') + ' (' + (d.refeicoes === 0 ? 'sem registro' : d.registro === 'parcial' ? 'parcial' : 'não confirmado') + ')';
    }).join(' · ') + '</div>';
  }

  function naMeta(cons, meta) {
    var o = isOrange(cons, meta);
    return !o.kcal && !o.p && !o.c && !o.g;
  }

  function avg(nums) {
    if (!nums.length) return null;
    var s = 0;
    nums.forEach(function (n) { s += n; });
    return s / nums.length;
  }

  function showWarn(msg) {
    var el = document.getElementById('histWarn');
    if (!el) return;
    var line = document.createElement('div');
    line.textContent = msg;
    el.appendChild(line);
    el.hidden = false;
  }

  function renderSummary(days) {
    var box = document.getElementById('histSummary');
    if (!box) return;
    var last7 = days.length ? days.filter(function (d) {
      return Math.round((Date.parse(days[0].data) - Date.parse(d.data)) / 86400000) < 7;
    }) : [];
    if (!last7.length) {
      box.innerHTML = '<div class="hist-summary-title">Últimos 7 dias</div>' +
        '<div class="hist-summary-empty">Nenhum dia fechado ainda</div>';
      return;
    }
    var kcals = [], ps = [], cs = [], gs = [], pesos = [];
    var ok = 0, base = last7.filter(contaMedia);
    last7.forEach(function (d) { if (d.peso != null && !isNaN(Number(d.peso))) pesos.push(Number(d.peso)); });
    base.forEach(function (d) {
      kcals.push(d.cons.kcal);
      ps.push(d.cons.p);
      cs.push(d.cons.c);
      gs.push(d.cons.g);
      if (naMeta(d.cons, d.meta)) ok++;
    });
    var pesoLine = '';
    if (pesos.length) {
      pesoLine = '<div class="hist-summary-peso">Peso médio ' + esc(fmtPeso(N.arred(avg(pesos), 1))) + '</div>';
    }
    // semana anterior (7 a 13 dias antes do dia fechado mais recente)
    var ref = days[0].data;
    var ant = days.filter(function (d) {
      var k = Math.round((Date.parse(ref) - Date.parse(d.data)) / 86400000);
      return k >= 7 && k < 14;
    }).filter(contaMedia);
    var compLine = '';
    if (ant.length && base.length) {
      var aK = avg(ant.map(function (d) { return d.cons.kcal; })), aP = avg(ant.map(function (d) { return d.cons.p; }));
      var nK = avg(kcals), nP = avg(ps);
      function dif(n, a) { var x = ri(n) - ri(a); return x === 0 ? '0' : (x > 0 ? '+' : '−') + Math.abs(x); }
      compLine = '<div class="hist-summary-comp">vs semana anterior: kcal ' + ri(aK) + ' → ' + ri(nK) + ' (' + dif(nK, aK) + ')' +
        ' · P ' + ri(aP) + ' → ' + ri(nP) + ' (' + dif(nP, aP) + ') · ' + ant.length + ' dia' + (ant.length > 1 ? 's' : '') + '</div>';
    }
    box.innerHTML =
      '<div class="hist-summary-title">Últimos 7 dias</div>' +
      (base.length ? '<div class="hist-summary-avgs">' +
        '<span><b>' + ri(avg(kcals)) + '</b> kcal</span>' +
        '<span><b>P' + ri(avg(ps)) + '</b></span>' +
        '<span><b>C' + ri(avg(cs)) + '</b></span>' +
        '<span><b>G' + ri(avg(gs)) + '</b></span>' +
      '</div>' +
      vsMetaLinha(base) +
      '<div class="hist-summary-meta">' + ok + ' de ' + base.length + ' dia' + (base.length > 1 ? 's' : '') + ' na meta</div>'
        : '<div class="hist-summary-empty">Nenhum dia com registro completo nestes 7 dias — sem médias.</div>') +
      (base.length < last7.length ? '<div class="hist-summary-comp">Médias de ' + base.length + ' dia' + (base.length > 1 ? 's' : '') + ' com registro completo</div>' + foraLinha(last7) : '') +
      coberturaLinha(last7) + pesoLine + compLine +
      '<button type="button" class="btn-csv btn-resumo" id="resumoBtn">Resumo da semana · copiar / compartilhar</button>' +
      '<div id="resumoPainel" hidden></div>';
    RES.dias = last7;
    document.getElementById('resumoBtn').addEventListener('click', abrirResumo);
  }

  // ---------- resumo da semana (texto pronto para o Grok, o Codex ou um nutricionista) ----------
  var RES = { dias: [], pesos: [], obj: null, top: null };
  function ddmm(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  function sinalN(x) { return x > 0 ? '+' + x : x < 0 ? '−' + Math.abs(x) : '0'; }

  function textoResumo() {
    var todos = RES.dias.slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var dias = todos.filter(contaMedia);   // médias só com registro completo; "Por dia" lista todos
    var n = dias.length, l = [];
    if (!todos.length) return 'RESUMO DA SEMANA — Nutrição Hoje\nNenhum dia fechado ainda.';
    if (!n) return 'RESUMO DA SEMANA — Nutrição Hoje\nNenhum dia com registro completo nestes 7 dias — sem médias.';
    var c = {}, m = {};
    ['kcal', 'p', 'c', 'g'].forEach(function (k) {
      c[k] = avg(dias.map(function (d) { return d.cons[k]; }));
      m[k] = avg(dias.map(function (d) { return d.meta[k]; }));
    });
    var dif = {};
    ['kcal', 'p', 'c', 'g'].forEach(function (k) { dif[k] = ri(c[k]) - ri(m[k]); });
    var ok = dias.filter(function (d) { return naMeta(d.cons, d.meta); }).length;
    var pOk = dias.filter(function (d) { return ri(d.cons.p) >= ri(d.meta.p); }).length;
    var compl = n, total = todos.length;
    l.push('RESUMO DA SEMANA — Nutrição Hoje');
    l.push('Período: ' + ddmm(todos[0].data) + ' a ' + ddmm(todos[total - 1].data) + ' · ' + total + ' dia' + (total > 1 ? 's' : '') + ' fechado' + (total > 1 ? 's' : '') +
      (n < total ? ' · médias de ' + n + ' com registro completo' : ''));
    l.push('');
    l.push('Média por dia: ' + ri(c.kcal) + ' kcal | P ' + ri(c.p) + ' | C ' + ri(c.c) + ' | G ' + ri(c.g));
    l.push('Meta: ' + ri(m.kcal) + ' kcal | P ' + ri(m.p) + ' | C ' + ri(m.c) + ' | G ' + ri(m.g));
    l.push('Diferença: kcal ' + sinalN(dif.kcal) + ' | P ' + sinalN(dif.p) + ' | C ' + sinalN(dif.c) + ' | G ' + sinalN(dif.g));
    l.push('Dias na meta: ' + ok + ' de ' + n + ' · proteína batida: ' + pOk + ' de ' + n + ' · registro completo: ' + compl + ' de ' + total);
    // peso: só pesagens REAIS do período (estimativas não contam)
    var ini = todos[0].data, fim = todos[total - 1].data;
    var ps = (RES.pesos || []).filter(function (p) { return p.data >= ini && p.data <= fim && p.kg != null && !isNaN(Number(p.kg)); })
      .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    l.push('');
    if (ps.length) {
      var med = avg(ps.map(function (p) { return Number(p.kg); }));
      var linha = 'Peso: média ' + kgStr(med) + ' kg (' + ps.length + ' pesage' + (ps.length > 1 ? 'ns' : 'm') + ')';
      if (ps.length >= 2) {
        var d = Number(ps[ps.length - 1].kg) - Number(ps[0].kg);
        linha += ' · ' + kgStr(ps[0].kg) + ' (' + ddmm(ps[0].data) + ') → ' + kgStr(ps[ps.length - 1].kg) + ' kg (' + ddmm(ps[ps.length - 1].data) + '), ' +
          (N.arred(d, 1) > 0 ? '+' : N.arred(d, 1) < 0 ? '−' : '') + kgStr(Math.abs(d)) + ' kg';
      }
      l.push(linha);
      if (RES.obj && window.NutriObjetivo) {
        var O = window.NutriObjetivo, ult = ps[ps.length - 1];
        var esp = O.calc(RES.obj, ult.data).esperado(ult.data), st = O.status(Number(ult.kg), esp);
        l.push('Objetivo (alvo ' + ddmm(RES.obj.data_alvo) + '): esperado em ' + ddmm(ult.data) + ' ' + kgStr(esp) + ' kg · ' + st.txt.replace('\u00a0', ' '));
      }
    } else {
      l.push('Peso: sem pesagem no período.');
    }
    l.push('');
    l.push('Por dia:');
    todos.forEach(function (d) {
      if (d.refeicoes === 0) { l.push('- ' + ddmm(d.data) + ': sem registro' + (d.peso != null ? ' | peso ' + kgStr(Number(d.peso)) + ' kg' : '') + ' (fora das médias)'); return; }
      l.push('- ' + ddmm(d.data) + ': ' + ri(d.cons.kcal) + ' kcal (' + sinalN(ri(d.cons.kcal) - ri(d.meta.kcal)) + ') | P ' + ri(d.cons.p) + ' | C ' + ri(d.cons.c) + ' | G ' + ri(d.cons.g) +
        (d.peso != null ? ' | peso ' + kgStr(Number(d.peso)) + ' kg' : '') + (d.registro !== 'completo' ? ' | registro ' + (d.registro === 'parcial' ? 'parcial' : 'não confirmado') + ' (fora das médias)' : ''));
    });
    if (RES.top && RES.top.kcal.length) {
      l.push('');
      l.push('Onde foram as calorias (' + RES.top.n + ' dias):');
      RES.top.kcal.forEach(function (x) { l.push('- ' + x.nome + ': ' + ri(x.v) + ' kcal (' + x.pct + '%) · em ' + x.dias + ' dia' + (x.dias > 1 ? 's' : '')); });
      if (RES.top.g.length) l.push('Mais gordura: ' + RES.top.g.map(function (x) { return x.nome + ' ' + ri(x.v) + ' g (' + x.pct + '%)'; }).join(' · '));
    }
    // pontos de atenção: só leitura dos números (mesmos limites do "dias na meta"), sem prescrever dieta
    var o = isOrange(c, m), at = [];
    if (o.kcal && dif.kcal > 0) at.push('Calorias acima da meta em média (' + sinalN(dif.kcal) + ' kcal/dia).');
    if (o.kcal && dif.kcal < 0) at.push('Calorias bem abaixo da meta em média (' + sinalN(dif.kcal) + ' kcal/dia).');
    if (o.p) at.push('Proteína abaixo da meta em média (' + sinalN(dif.p) + ' g/dia); batida em ' + pOk + ' de ' + n + ' dias.');
    if (o.c) at.push('Carboidrato acima da meta em média (' + sinalN(dif.c) + ' g/dia).');
    if (o.g) at.push('Gordura acima da meta em média (' + sinalN(dif.g) + ' g/dia).');
    if (n < total) at.push((total - n) + ' dia(s) sem registro completo ficaram fora das médias.');
    l.push('');
    l.push('Pontos de atenção:');
    if (!at.length) at.push('Nenhum: médias dentro da meta.');
    at.forEach(function (x) { l.push('- ' + x); });
    return l.join('\n');
  }

  function abrirResumo() {
    var painel = document.getElementById('resumoPainel');
    if (!painel) return;
    var podeShare = typeof navigator.share === 'function';
    var podeCopiar = !!(navigator.clipboard && navigator.clipboard.writeText);
    painel.innerHTML = '<label class="sr" for="resumoTexto">Resumo da semana</label>' +
      '<textarea id="resumoTexto" class="resumo-texto" readonly>' + esc(textoResumo()) + '</textarea>' +
      '<div class="resumo-acoes">' +
      (podeShare ? '<button type="button" class="btn-csv" data-r="share">Compartilhar…</button>' : '') +
      (podeCopiar ? '<button type="button" class="btn-csv" data-r="copiar">Copiar</button>' : '') +
      '<button type="button" class="btn-csv" data-r="sel">Selecionar texto</button></div>' +
      '<div class="resumo-status" id="resumoStatus" role="status">' + (podeShare || podeCopiar ? '' : 'Este navegador não copia sozinho: toque em "Selecionar texto" e depois em Copiar.') + '</div>';
    painel.hidden = false;
    var t = document.getElementById('resumoTexto'), st = document.getElementById('resumoStatus');
    function selecionar() { t.focus(); t.setSelectionRange(0, t.value.length); try { t.select(); } catch (e) { /* nada */ } }
    painel.querySelectorAll('[data-r]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-r');
        if (a === 'share') {
          navigator.share({ text: t.value }).then(function () { st.textContent = 'Pronto.'; })
            .catch(function (e) { if (!e || e.name !== 'AbortError') st.textContent = 'Não deu para compartilhar: use Copiar ou Selecionar texto.'; });
        } else if (a === 'copiar') {
          navigator.clipboard.writeText(t.value).then(function () { st.textContent = 'Copiado. É só colar.'; })
            .catch(function () { selecionar(); st.textContent = 'O navegador bloqueou a cópia: o texto está selecionado — toque em Copiar.'; });
        } else {
          selecionar(); st.textContent = 'Texto selecionado: toque em Copiar.';
        }
      });
    });
    t.style.height = Math.min(420, t.scrollHeight + 4) + 'px';
  }

  // média dos dias × média das metas desses dias, com as mesmas cores do dia: carbo/gordura/kcal acima em
  // laranja, proteína abaixo (piso) em azul; proteína acima da meta não é excesso
  function vsMetaLinha(dias) {
    var m = {}, c = {};
    ['kcal', 'p', 'c', 'g'].forEach(function (k) {
      c[k] = avg(dias.map(function (d) { return d.cons[k]; }));
      m[k] = avg(dias.map(function (d) { return d.meta[k]; }));
    });
    var o = isOrange(c, m);
    function parte(k, rot) {
      var x = ri(c[k]) - ri(m[k]), txt = rot + ' ' + (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x);
      var cls = k === 'p' ? (o.p ? 'hm-falta' : '') : (o[k] && x > 0 ? 'hm-acima' : '');
      return cls ? '<span class="' + cls + '">' + txt + '</span>' : txt;
    }
    return '<div class="hist-summary-vsmeta">Média vs meta: ' + parte('kcal', 'kcal') + ' · ' + parte('p', 'P') + ' · ' +
      parte('c', 'C') + ' · ' + parte('g', 'G') + '</div>';
  }

  // cobertura: completo = confirmado pelo Lucas ou automático no fechamento (dia com refeições, sem aviso de parcial)
  function coberturaLinha(dias) {
    var c = dias.filter(function (d) { return d.registro === 'completo'; }).length;
    var p = dias.filter(function (d) { return d.registro === 'parcial'; }).length;
    return '<div class="hist-summary-comp">Registro completo: ' + c + ' de ' + dias.length + ' dia' + (dias.length > 1 ? 's' : '') +
      (p ? ' · ' + p + ' parcial' + (p > 1 ? 'is' : '') : '') + (dias.length - c - p ? ' · ' + (dias.length - c - p) + ' sem confirmação' : '') + '</div>';
  }

  function kgStr(n) { return N.arred(n, 1).toFixed(1).replace('.', ','); }
  function lbStr(n) { return N.arred(n * 2.20462, 1).toFixed(1).replace('.', ','); }
  function pesoStr(n) { return kgStr(n) + '\u00a0kg (' + lbStr(n) + '\u00a0lb)'; }
  function diasEntre(a, b) { return N.diasEntre(a, b); }

  // média dos pesos dos 7 dias corridos terminando em cada data
  function media7(pesos) {
    return pesos.map(function (p) {
      var win = pesos.filter(function (q) { var d = diasEntre(q.data, p.data); return d >= 0 && d < 7; });
      return { data: p.data, kg: avg(win.map(function (q) { return q.kg; })) };
    });
  }

  // inclinação (kg/dia) por regressão linear nos pesos dos últimos 14 dias
  function tendencia(pesos) {
    if (!pesos.length) return null;
    var ult = pesos[pesos.length - 1].data;
    var pts = pesos.filter(function (p) { return diasEntre(p.data, ult) < 14; });
    if (pts.length < 4 || diasEntre(pts[0].data, ult) < 4) return null;
    var xs = pts.map(function (p) { return diasEntre(pts[0].data, p.data); }), ys = pts.map(function (p) { return p.kg; });
    var mx = avg(xs), my = avg(ys), num = 0, den = 0;
    xs.forEach(function (x, i) { num += (x - mx) * (ys[i] - my); den += (x - mx) * (x - mx); });
    if (!den) return null;
    var b = num / den;
    return { porDia: b, base: pts[0].data, a: my - b * mx };
  }

  // Calorias e proteína dos últimos 14 dias fechados (dias corridos até o fechado mais recente): uma barra
  // por dia, linha tracejada = meta. Dois gráficos (escalas diferentes, nunca dois eixos no mesmo).
  // Laranja = kcal acima da meta (mesma regra do "dias na meta"). Toque numa barra: valores do dia.
  function renderBarras(days) {
    var box = document.getElementById('barrasCard');
    if (!box) return;
    if (!days.length) { box.hidden = true; return; }
    box.hidden = false;
    var ref = days[0].data, porData = {};
    days.forEach(function (d) { porData[d.data] = d; });
    var datas = [];
    for (var k = 13; k >= 0; k--) datas.push(somaDias(ref, -k));
    var W = 340, H = 104, L = 8, R = 8, T = 10, B = 18, slot = (W - L - R) / datas.length, bw = Math.max(6, slot * 0.62);
    function grafico(campo, metaDe, classe, rotulo) {
      var vals = datas.map(function (dt) { return porData[dt] ? porData[dt].cons[campo] : null; });
      var metas = datas.map(function (dt) { return porData[dt] ? porData[dt].meta[campo] : null; }).filter(function (v) { return v != null; });
      var meta = metas.length ? metas[metas.length - 1] : null;
      var hi = Math.max.apply(null, vals.filter(function (v) { return v != null; }).concat(meta || 0)) * 1.12 || 1;
      function y(v) { return T + (H - T - B) * (1 - v / hi); }
      var base = y(0), svg = '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + base.toFixed(1) + '" y2="' + base.toFixed(1) + '" class="pc-grid"/>';
      vals.forEach(function (v, i) {
        var x0 = L + slot * i + (slot - bw) / 2;
        if (v != null && v > 0) {
          var yt = y(v), r = Math.min(4, (base - yt) / 2), cls = classe + (metaDe(porData[datas[i]]) ? ' bc-over' : '') + (contaMedia(porData[datas[i]]) ? '' : ' bc-inc');
          svg += '<path class="' + cls + '" d="M' + x0.toFixed(1) + ',' + base.toFixed(1) + 'V' + (yt + r).toFixed(1) + 'Q' + x0.toFixed(1) + ',' + yt.toFixed(1) + ' ' + (x0 + r).toFixed(1) + ',' + yt.toFixed(1) +
            'H' + (x0 + bw - r).toFixed(1) + 'Q' + (x0 + bw).toFixed(1) + ',' + yt.toFixed(1) + ' ' + (x0 + bw).toFixed(1) + ',' + (yt + r).toFixed(1) + 'V' + base.toFixed(1) + 'Z"/>';
        }
        svg += '<rect class="pc-hit" x="' + (L + slot * i).toFixed(1) + '" y="0" width="' + slot.toFixed(1) + '" height="' + H + '" data-i="' + i + '"/>';
      });
      if (meta != null) {
        svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(meta).toFixed(1) + '" y2="' + y(meta).toFixed(1) + '" class="pc-meta"/>';
      }
      svg += '<text x="' + L + '" y="' + (H - 4) + '" class="pc-ax">' + esc(labelDia(datas[0]).replace(/ \d{4}$/, '')) + '</text>' +
        '<text x="' + (W - R) + '" y="' + (H - 4) + '" class="pc-ax" text-anchor="end">' + esc(labelDia(ref).replace(/ \d{4}$/, '')) + '</text>';
      rotulo = rotulo.replace('{meta}', meta != null ? '<span class="bc-k-meta"></span> meta ' + ri(meta) : '');
      if (datas.some(function (dt) { var d = porData[dt]; return d && d.refeicoes !== 0 && !contaMedia(d); })) rotulo += ' · apagada = registro incompleto';
      return '<div class="bc-rot">' + rotulo + '</div><svg class="pc-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(rotulo) + ' nos últimos 14 dias">' + svg + '</svg>';
    }
    function difTxt(v, m) { var x = ri(v) - ri(m); return x === 0 ? 'na meta' : (x > 0 ? '+' : '−') + Math.abs(x); }
    box.innerHTML = '<div class="hist-summary-title">Calorias e proteína · últimos 14 dias</div>' +
      '<div class="pc-tip" id="bcTip">Toque numa barra pra ver o dia</div>' +
      grafico('kcal', function (d) { return d.cons.kcal - d.meta.kcal > 75; }, 'bc-kcal', 'Calorias por dia · {meta} · <span class="bc-k-over"></span> acima') +
      grafico('p', function () { return false; }, 'bc-p', 'Proteína (g) por dia · {meta}') +
      '<div id="protRefCard" class="pr-card" hidden></div>' +
      '<div id="semTopCard" class="pr-card" hidden></div>';
    var tip = document.getElementById('bcTip');
    box.querySelectorAll('.pc-hit').forEach(function (h) {
      h.addEventListener('click', function () {
        var dt = datas[Number(h.getAttribute('data-i'))], d = porData[dt];
        tip.textContent = labelDia(dt).replace(/ \d{4}$/, '') + ': ' + (d && d.refeicoes === 0 ? 'sem registro' : d ? ri(d.cons.kcal) + ' kcal (' + difTxt(d.cons.kcal, d.meta.kcal) + ') · P' + ri(d.cons.p) + ' (' +
          difTxt(d.cons.p, d.meta.p) + ') · C' + ri(d.cons.c) + ' · G' + ri(d.cons.g) + (contaMedia(d) ? '' : ' · registro ' + (d.registro === 'parcial' ? 'parcial' : 'não confirmado')) : 'sem dia fechado');
      });
    });
  }

  // proteína média de cada refeição (Café/Almoço/Lanche/Jantar) nos últimos 7 dias fechados: mostra o padrão
  // (qual refeição costuma ficar fraca). Horário pelo nome; senão pela hora de consumo (= sugerir.py:horario).
  var HORARIOS = ['Café', 'Almoço', 'Lanche', 'Jantar'];
  function horarioDe(r) {
    var n = String(r.refeicao || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    var pares = [['cafe', 'Café'], ['almoc', 'Almoço'], ['jantar', 'Jantar'], ['ceia', 'Jantar'], ['lanche', 'Lanche'], ['doce', 'Lanche']];
    for (var i = 0; i < pares.length; i++) if (n.indexOf(pares[i][0]) >= 0) return pares[i][1];
    var c = String(r.consumido_em || '');
    if (c.length >= 16 && c[13] === ':') { var hh = parseInt(c.slice(11, 13), 10); return hh < 11 ? 'Café' : hh < 15 ? 'Almoço' : hh < 19 ? 'Lanche' : 'Jantar'; }
    return null;
  }
  function completo(dia) { return !!(dia && dia.fechado && dia.registro && dia.registro.status === 'completo' && (dia.lancado || []).length); }
  function renderProtRefeicao(days) {
    var box = document.getElementById('protRefCard');
    if (!box || !days.length) return;
    var ref = days[0].data;
    var ult = days.filter(function (d) { return diasEntre(d.data, ref) < 7; });
    Promise.all(ult.map(function (d) {
      return fetch('dados/' + d.data + '.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    })).then(function (arqs) {
      var porH = {}, n = 0;
      arqs.forEach(function (dia) {
        if (!completo(dia)) return;
        n++;
        var noDia = {};
        (dia.lancado || []).forEach(function (r) {
          var h = horarioDe(r);
          if (!h) return;
          noDia[h] = (noDia[h] || 0) + (r.itens || []).reduce(function (t, it) { return t + (Number(it.p) || 0); }, 0);
        });
        Object.keys(noDia).forEach(function (h) { (porH[h] = porH[h] || []).push(noDia[h]); });
      });
      renderTopSemana(arqs);
      if (!n || !Object.keys(porH).length) return;
      var meds = HORARIOS.filter(function (h) { return porH[h]; }).map(function (h) { return { h: h, g: avg(porH[h]), dias: porH[h].length }; });
      var maior = Math.max.apply(null, meds.map(function (m) { return m.g; })) || 1;
      box.innerHTML = '<div class="bc-rot">Proteína por refeição · média dos dias em que ela aconteceu (' + n + ' dia' + (n > 1 ? 's' : '') + ' com registro completo)</div>' +
        meds.map(function (m) {
          return '<div class="pr-linha"><span class="pr-nome">' + m.h + '</span><span class="pr-trilho"><span class="pr-barra" style="width:' + (100 * m.g / maior).toFixed(1) + '%"></span></span>' +
            '<span class="pr-val">' + ri(m.g) + '\u00a0g <i>' + m.dias + '/' + n + ' dias</i></span></div>';
        }).join('');
      box.hidden = false;
    });
  }

  // "Onde foram as calorias" da semana: alimentos que mais pesaram em kcal e em gordura nos dias fechados
  // (soma do mesmo alimento em refeições/dias diferentes). Também entra no "Resumo da semana".
  function renderTopSemana(arqs) {
    var box = document.getElementById('semTopCard');
    var porAli = {}, tot = 0, totG = 0, n = 0;
    arqs.forEach(function (dia) {
      if (!completo(dia)) return;
      n++;
      (dia.lancado || []).forEach(function (r) {
        (r.itens || []).forEach(function (it) {
          var k = it.alimento || it.nome || '?';
          var x = porAli[k] || (porAli[k] = { nome: String(it.nome || k).replace(/\s*\(.*?\)\s*/g, ' ').trim(), kcal: 0, g: 0, dias: {} });
          x.kcal += Number(it.kcal) || 0; x.g += Number(it.g) || 0; x.dias[dia.data] = 1;
          tot += Number(it.kcal) || 0; totG += Number(it.g) || 0;
        });
      });
    });
    var lista = Object.keys(porAli).map(function (k) { return porAli[k]; });
    if (!n || lista.length < 2 || tot <= 0) return;
    function top(campo, total, quantos) {
      return lista.slice().sort(function (a, b) { return b[campo] - a[campo]; }).slice(0, quantos)
        .filter(function (x) { return ri(x[campo]) > 0; })
        .map(function (x) { return { nome: x.nome, v: x[campo], pct: Math.round(100 * x[campo] / total), dias: Object.keys(x.dias).length }; });
    }
    RES.top = { kcal: top('kcal', tot, 5), g: totG > 0 ? top('g', totG, 3) : [], n: n };
    if (!box) return;
    function li(x, un) {
      return '<li><span>' + esc(x.nome) + ' <i class="st-dias">' + x.dias + '/' + n + ' dias</i></span><b>' + ri(x.v) + '\u00a0' + un + '</b><i>' + x.pct + '%</i></li>';
    }
    box.innerHTML = '<div class="bc-rot">Onde foram as calorias · ' + n + ' dia' + (n > 1 ? 's' : '') + ' com registro completo</div>' +
      '<div class="onde"><div class="onde-col"><div class="onde-t">Calorias (' + ri(tot) + ' kcal no total)</div><ol>' +
      RES.top.kcal.map(function (x) { return li(x, 'kcal'); }).join('') + '</ol></div>' +
      (RES.top.g.length ? '<div class="onde-col"><div class="onde-t">Gordura</div><ol>' + RES.top.g.map(function (x) { return li(x, 'g'); }).join('') + '</ol></div>' : '') + '</div>';
    box.hidden = false;
  }

  function renderPeso(todos, obj) {
    RES.pesos = todos || []; RES.obj = obj || null;
    var box = document.getElementById('pesoCard');
    if (!box) return;
    // preenche dias sem peso (média entre vizinhos / repete o último) — só na tela, nunca nos dados
    var reais = todos.slice();
    var pesos = window.NutriObjetivo ? window.NutriObjetivo.serieDiaria(reais, window.NutriObjetivo.hojeISO()).slice(-30) : todos.slice(-30);
    var soReais = pesos.filter(function (p) { return !p.estimado; });
    var titulo = '<div class="hist-summary-title">Peso · últimos 30 dias</div>';
    if (!pesos.length) {
      box.innerHTML = titulo + '<div class="hist-summary-empty">Mande o peso pro Grok ("peso 88,9") e ele aparece aqui.</div>';
      return;
    }
    var ult = pesos[pesos.length - 1];
    var linha = '<div class="peso-now"><b>' + (ult.estimado ? '~' : '') + kgStr(ult.kg) + ' kg</b> <span>(' + lbStr(ult.kg) + ' lb) · ' + esc(labelDia(ult.data).replace(/ \d{4}$/, '')) + (ult.estimado ? ' · estimado' : '') + '</span></div>';
    var todasReais = reais.filter(function (p) { return p.data <= N.hojeLA(); });
    if (todasReais.length) {
      var uR = todasReais[todasReais.length - 1];
      linha += '<div class="peso-delta">' + todasReais.length + ' pesage' + (todasReais.length > 1 ? 'ns' : 'm') + ' · última em ' + esc(labelDia(uR.data).replace(/ \d{4}$/, '')) + ' (pontos vazados = estimativa, não contam como medida)</div>';
      // variação só entre pesagens reais dos últimos 7 dias
      var semanaR = todasReais.filter(function (p) { return diasEntre(p.data, uR.data) < 7; });
      if (semanaR.length >= 2) {
        var dlt = semanaR[semanaR.length - 1].kg - semanaR[0].kg;
        linha += '<div class="peso-delta">7 dias (pesagens reais): ' + kgStr(semanaR[0].kg) + ' → ' + kgStr(uR.kg) + ' kg (' +
          (N.arred(dlt, 1) > 0 ? '+' : N.arred(dlt, 1) < 0 ? '−' : '') + kgStr(Math.abs(dlt)) + ' kg)</div>';
      }
    }
    if (soReais.length < 2) {
      box.innerHTML = titulo + linha + '<div class="hist-summary-empty">O gráfico aparece a partir de 2 dias com peso.</div>';
      return;
    }
    var med = media7(pesos);
    var W = 340, H = 150, L = 34, R = 10, T = 12, B = 22;
    var vals = pesos.map(function (p) { return p.kg; }).concat(med.map(function (m) { return m.kg; }));
    var metaPts = null, fimX = ult.data;
    if (obj && window.NutriObjetivo) {
      var cObj = window.NutriObjetivo.calc(obj, ult.data);
      var iniM = obj.inicio < pesos[0].data ? pesos[0].data : obj.inicio;
      metaPts = [{ data: iniM, kg: cObj.esperado(iniM) }, { data: obj.data_alvo, kg: cObj.esperadoAlvo }];
      if (obj.data_alvo > fimX) fimX = obj.data_alvo;
      vals.push(metaPts[0].kg, metaPts[1].kg);
      var tend = tendencia(soReais);
      linha += '<div class="peso-delta">Meta: ' + pesoStr(cObj.esperadoAlvo) + ' em ' + window.NutriObjetivo.curta(obj.data_alvo) +
        ' · esperado hoje ' + pesoStr(cObj.esperado(ult.data)) + '</div>';
      if (tend) {
        var proj = tend.a + tend.porDia * diasEntre(tend.base, obj.data_alvo);
        var st = window.NutriObjetivo.status(proj, cObj.esperadoAlvo);
        linha += '<div class="peso-delta">Ritmo atual: ' + (tend.porDia * 7 > 0 ? '+' : '−') + kgStr(Math.abs(tend.porDia * 7)) + ' kg/semana (meta −' + kgStr(obj.meta_semanal_kg) + ') · ' +
          'projeção em ' + window.NutriObjetivo.curta(obj.data_alvo) + ': ~' + pesoStr(proj) + ' <span class="obj-' + st.cls + '">' + st.txt + '</span></div>';
      } else {
        linha += '<div class="peso-delta">A projeção pelo ritmo aparece com ~5 dias de peso.</div>';
      }
    }
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max(0.3, (hi - lo) * 0.15); lo -= pad; hi += pad;
    var d0 = pesos[0].data, span = Math.max(1, diasEntre(d0, fimX));
    function x(d) { return L + (W - L - R) * diasEntre(d0, d) / span; }
    function y(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); }
    var grid = '';
    [hi - pad, lo + pad].forEach(function (v) {
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="pc-grid"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" class="pc-ax" text-anchor="end">' + kgStr(v) + '</text>';
    });
    var path = med.map(function (m, i) { return (i ? 'L' : 'M') + x(m.data).toFixed(1) + ',' + y(m.kg).toFixed(1); }).join('');
    var dots = pesos.map(function (p, i) {
      return '<circle cx="' + x(p.data).toFixed(1) + '" cy="' + y(p.kg).toFixed(1) + '" r="4" class="' + (p.estimado ? 'pc-dot pc-est' : 'pc-dot') + '"/>' +
        '<circle cx="' + x(p.data).toFixed(1) + '" cy="' + y(p.kg).toFixed(1) + '" r="14" class="pc-hit" data-i="' + i + '"/>';
    }).join('');
    var metaSvg = metaPts ? '<line x1="' + x(metaPts[0].data).toFixed(1) + '" y1="' + y(metaPts[0].kg).toFixed(1) + '" x2="' + x(metaPts[1].data).toFixed(1) + '" y2="' + y(metaPts[1].kg).toFixed(1) + '" class="pc-meta"/>' : '';
    var ax = '<text x="' + L + '" y="' + (H - 4) + '" class="pc-ax">' + esc(labelDia(d0).replace(/ \d{4}$/, '')) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 4) + '" class="pc-ax" text-anchor="end">' + esc(labelDia(fimX).replace(/ \d{4}$/, '')) + '</text>';
    box.innerHTML = titulo + linha +
      '<div class="pc-legend"><span><i class="pc-k-dot"></i>Peso do dia</span><span><i class="pc-k-line"></i>Média 7 dias</span>' + (pesos.some(function (p) { return p.estimado; }) ? '<span><i class="pc-k-est"></i>Estimado</span>' : '') + (metaPts ? '<span><i class="pc-k-meta"></i>Meta</span>' : '') + '</div>' +
      '<div class="pc-tip" id="pcTip">Toque num ponto pra ver o valor</div>' +
      '<svg class="pc-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfico de peso">' +
        grid + metaSvg + '<path d="' + path + '" class="pc-line"/>' + dots + ax + '</svg>';
    var tip = document.getElementById('pcTip');
    box.querySelectorAll('.pc-hit').forEach(function (c) {
      c.addEventListener('click', function () {
        var i = Number(c.getAttribute('data-i'));
        var p = pesos[i];
        tip.textContent = labelDia(p.data).replace(/ \d{4}$/, '') + ': ' + (p.estimado ? '~' : '') + kgStr(p.kg) + ' kg (' + lbStr(p.kg) + ' lb)' +
          (p.estimado ? ' · estimado (' + p.estimado + ')' : '') + ' · média 7d ' + pesoStr(med[i].kg);
      });
    });
  }

  // Check-in semanal do objetivo: uma linha por semana (esperado × real, média kcal/P, dias na meta)
  function renderCheckin(closed, reais, obj) {
    var box = document.getElementById('checkinCard');
    if (!box) return;
    var N = window.NutriObjetivo;
    if (!obj || !N) { box.hidden = true; return; }
    var hoje = N.hojeISO();
    var c = N.calc(obj, hoje);
    function mediaPeso(ate) {  // média das PESAGENS REAIS dos 7 dias terminando em 'ate' (estimativas não entram)
      var win = reais.filter(function (p) { var d = diasEntre(p.data, ate); return d >= 0 && d < 7; });
      return win.length ? { kg: avg(win.map(function (p) { return p.kg; })), n: win.length } : null;
    }
    var semanas = Nutri.semana(obj.inicio, obj.data_alvo, obj.data_alvo).n;
    var linhas = '';
    for (var w = 1; w <= semanas; w++) {
      var sw = Nutri.semana(obj.inicio, obj.data_alvo, somaDias(obj.inicio, 7 * (w - 1)));
      var ini = sw.ini;
      if (ini > hoje) break;
      var fim = sw.fim;
      var andamento = hoje < fim;
      var ate = andamento ? hoje : fim;
      var dsTodos = closed.filter(function (d) { return d.data >= ini && d.data <= fim; });
      var ds = dsTodos.filter(contaMedia);   // médias só com registro completo
      var ok = ds.filter(function (d) { return naMeta(d.cons, d.meta); }).length;
      var h = '<div class="ck-sem"><div class="ck-head"><b>Semana ' + w + '</b> <span>' + esc(N.curta(ini)) + ' → ' + esc(N.curta(fim)) +
        (andamento ? ' · em andamento (dia ' + (diasEntre(ini, hoje) + 1) + '/' + (diasEntre(ini, fim) + 1) + ')' : '') + '</span></div>';
      var pReal = mediaPeso(ate), pEsp = c.esperado(ate);
      if (pReal != null) {
        var st = N.status(pReal.kg, pEsp);
        h += '<div class="ck-l">Peso (média de ' + pReal.n + ' pesage' + (pReal.n > 1 ? 'ns' : 'm') + ') ' + kgStr(pReal.kg) + ' kg · esperado ' + kgStr(pEsp) + ' kg · <span class="obj-' + st.cls + '">' + st.txt + '</span></div>';
      } else {
        h += '<div class="ck-l ck-m">Sem peso nesta semana ainda.</div>';
      }
      if (ds.length) {
        h += '<div class="ck-l">Média ' + ri(avg(ds.map(function (d) { return d.cons.kcal; }))) + ' kcal · P' +
          ri(avg(ds.map(function (d) { return d.cons.p; }))) + ' · ' + ok + ' de ' + ds.length + ' dia' + (ds.length > 1 ? 's' : '') + ' na meta' +
          (ds.length < dsTodos.length ? ' <span class="ck-m">(só dias com registro completo)</span>' : '') + '</div>';
        h += coberturaLinha(dsTodos).replace('hist-summary-comp', 'ck-l ck-m');
      } else if (dsTodos.length) {
        h += '<div class="ck-l ck-m">Sem dia com registro completo nesta semana — sem médias.</div>' + coberturaLinha(dsTodos).replace('hist-summary-comp', 'ck-l ck-m');
      } else {
        h += '<div class="ck-l ck-m">Nenhum dia fechado ainda nesta semana.</div>';
      }
      if (w === 1) h += '<div class="ck-l ck-m">1ª semana: parte da queda é água e glicogênio.</div>';
      linhas = h + '</div>' + linhas;  // semana mais recente em cima
    }
    box.hidden = false;
    box.innerHTML = '<div class="hist-summary-title">Check-in semanal · ' + esc(obj.nome || 'objetivo') + '</div>' + linhas;
  }

  function renderList(days) {
    var list = document.getElementById('histList');
    if (!list) return;
    if (!days.length) {
      list.innerHTML = '<div class="hist-empty">Nenhum dia fechado no índice</div>';
      return;
    }
    var html = '';
    days.forEach(function (d) {
      var o = isOrange(d.cons, d.meta);
      var peso = fmtPeso(d.peso);
      if (d.refeicoes === 0) {   // nada lançado: não é "0 kcal (−1570)"
        html += '<a href="./dia.html?d=' + encodeURIComponent(d.data) + '"><div><div class="d">' + esc(labelDia(d.data).replace(/ \d{4}$/, '')) +
          ' · <span class="sem-reg">sem registro</span></div>' + (peso ? '<div class="m">Peso ' + esc(peso) + '</div>' : '') +
          '<div class="m">' + (d.registro === 'parcial' ? 'Registro parcial · ' : '') + 'fora das médias</div></div></a>';
        return;
      }
      html += '<a href="./dia.html?d=' + encodeURIComponent(d.data) + '">';
      html += '<div>';
      html += '<div class="d">' + esc(labelDia(d.data).replace(/ \d{4}$/, '')) + ' · <span class="' + (o.kcal ? 'over' : '') + '">' +
        ri(d.cons.kcal) + ' kcal (' + deltaStr(d.cons.kcal, d.meta.kcal) + ')</span></div>';
      html += '<div class="m">';
      html += '<span class="' + (o.p ? 'over' : '') + '">P' + ri(d.cons.p) + ' (' + deltaStr(d.cons.p, d.meta.p) + ')</span>';
      html += ' · ';
      html += '<span class="' + (o.c ? 'over' : '') + '">C' + ri(d.cons.c) + ' (' + deltaStr(d.cons.c, d.meta.c) + ')</span>';
      html += ' · ';
      html += '<span class="' + (o.g ? 'over' : '') + '">G' + ri(d.cons.g) + ' (' + deltaStr(d.cons.g, d.meta.g) + ')</span>';
      html += '</div>';
      if (peso) html += '<div class="m">Peso ' + esc(peso) + '</div>';
      html += '<div class="m">' + (d.registro === 'completo' ? 'Registro completo' : d.registro === 'parcial' ? 'Registro parcial' : 'Registro não confirmado') + '</div>';
      html += '</div></a>';
    });
    list.innerHTML = html;
  }

  function boot(dates) {
    if (!Array.isArray(dates) || !dates.length) {
      showWarn('Índice de dias vazio ou indisponível');
      renderSummary([]);
      renderList([]);
      return;
    }
    var uniq = [];
    dates.forEach(function (d) {
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && uniq.indexOf(d) < 0) uniq.push(d);
    });
    // resumo.json (gerado à meia-noite) cobre os dias antigos num arquivo só;
    // os 3 dias mais recentes e os que faltam no resumo vêm direto do JSON do dia
    uniq.sort();
    // dias recentes (desde anteontem, pelo fuso de LA) vêm sempre direto do arquivo do dia;
    // os antigos, do resumo (regenerado a cada envio). Planos futuros não mexem nessa janela.
    var corte = somaDias(N.hojeLA(), -2);
    fetch('dados/resumo.json', { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
      .catch(function () { return []; })
      .then(function (resumo) {
        var mapa = {};
        (Array.isArray(resumo) ? resumo : []).forEach(function (r) { if (r && r.data) mapa[r.data] = r; });
        carregarDias(uniq, mapa, corte);
      });
  }

  function somaDias(iso, n) { return N.somaDias(iso, n); }

  function carregarDias(uniq, mapa, corte) {
    Promise.all(uniq.map(function (iso) {
      var r = mapa[iso];
      if (r && iso < corte && r.fechado) {
        return Promise.resolve({ ok: true, iso: iso, data: { data: iso, fechado: r.fechado, meta: r.meta, peso_kg: r.peso, gordura_pct: r.gordura, gordura_fonte: r.gordura_fonte, cons: r.cons, registro: { status: r.registro }, refeicoes: r.refeicoes } });
      }
      return fetch('dados/' + iso + '.json', { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          return { ok: true, iso: iso, data: data };
        })
        .catch(function () {
          return { ok: false, iso: iso };
        });
    })).then(function (results) {
      var closed = [];
      var pesos = [];
      results.forEach(function (r) {
        if (r.ok && r.data && r.data.peso_kg != null && !isNaN(Number(r.data.peso_kg)) && (r.data.data || r.iso) <= N.hojeLA()) {
          pesos.push({ data: r.data.data || r.iso, kg: Number(r.data.peso_kg) });
        }
      });
      pesos.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
      var carregaObj = window.NutriObjetivo ? window.NutriObjetivo.carregar() : Promise.resolve(null);
      carregaObj.then(function (obj) { renderPeso(pesos, obj); renderCheckin(closedAsc(), pesos, obj); });
      function closedAsc() { return closed.slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; }); }
      results.forEach(function (r) {
        if (!r.ok) {
          showWarn('Não deu pra carregar ' + r.iso);
          return;
        }
        var data = r.data || {};
        if (!data.fechado) return;
        var meta = data.meta || { kcal: 1570, p: 180, c: 100, g: 50 };
        var cons = data.cons || sumMeals(data.lancado || []);
        closed.push({
          data: data.data || r.iso,
          meta: meta,
          cons: cons,
          peso: data.peso_kg,
          registro: (data.registro && data.registro.status) || 'desconhecido',
          refeicoes: data.refeicoes != null ? data.refeicoes : (data.lancado || []).length
        });
      });
      closed.sort(function (a, b) {
        return a.data < b.data ? 1 : (a.data > b.data ? -1 : 0);
      });
      var todos = [], hojeLA = N.hojeLA();
      results.forEach(function (r) {
        if (!r.ok) return;
        var dd = r.data || {};
        if ((dd.data || r.iso) > hojeLA) return;  // plano futuro não é registro
        todos.push({ data: dd.data || r.iso, fechado: !!dd.fechado, meta: dd.meta, cons: dd.cons || sumMeals(dd.lancado || []), peso: dd.peso_kg, gordura: dd.gordura_pct, gordura_fonte: dd.gordura_fonte,
          registro: (dd.registro && dd.registro.status) || 'desconhecido', refeicoes: dd.refeicoes != null ? dd.refeicoes : (dd.lancado || []).length });
      });
      todos.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
      ligarBotaoCsv(todos);
      renderSummary(closed);
      renderBarras(closed);
      renderProtRefeicao(closed);
      renderList(closed);
    });
  }

  fetch('dados/dias.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(boot)
    .catch(function () {
      showWarn('Não deu pra carregar o índice de dias');
      renderSummary([]);
      renderList([]);
    });
})();

// Recarrega ao voltar pro app depois de 1 min (dados sempre frescos)
(function () {
  var t0 = Date.now();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - t0 > 60000) location.reload();
  });
})();
