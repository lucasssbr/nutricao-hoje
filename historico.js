(function () {
  var MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  function ri(n) { return Math.round(Number(n) || 0); }

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
      });
    });
    return t;
  }

  function fmtPeso(kg) {
    if (kg == null || kg === '' || isNaN(Number(kg))) return '';
    var lb = (Math.round(Number(kg) * 2.20462 * 10) / 10).toFixed(1).replace('.', ',');
    return (Math.round(Number(kg) * 10) / 10).toFixed(1).replace('.', ',') + ' kg (' + lb + ' lb)';
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
    var ok = 0;
    last7.forEach(function (d) {
      kcals.push(d.cons.kcal);
      ps.push(d.cons.p);
      cs.push(d.cons.c);
      gs.push(d.cons.g);
      if (d.peso != null && !isNaN(Number(d.peso))) pesos.push(Number(d.peso));
      if (naMeta(d.cons, d.meta)) ok++;
    });
    var pesoLine = '';
    if (pesos.length) {
      pesoLine = '<div class="hist-summary-peso">Peso médio ' + esc(fmtPeso(Math.round(avg(pesos) * 10) / 10)) + '</div>';
    }
    // semana anterior (7 a 13 dias antes do dia fechado mais recente)
    var ref = days[0].data;
    var ant = days.filter(function (d) {
      var k = Math.round((Date.parse(ref) - Date.parse(d.data)) / 86400000);
      return k >= 7 && k < 14;
    });
    var compLine = '';
    if (ant.length) {
      var aK = avg(ant.map(function (d) { return d.cons.kcal; })), aP = avg(ant.map(function (d) { return d.cons.p; }));
      var nK = avg(kcals), nP = avg(ps);
      function dif(n, a) { var x = ri(n) - ri(a); return x === 0 ? '0' : (x > 0 ? '+' : '−') + Math.abs(x); }
      compLine = '<div class="hist-summary-comp">vs semana anterior: kcal ' + ri(aK) + ' → ' + ri(nK) + ' (' + dif(nK, aK) + ')' +
        ' · P ' + ri(aP) + ' → ' + ri(nP) + ' (' + dif(nP, aP) + ') · ' + ant.length + ' dia' + (ant.length > 1 ? 's' : '') + '</div>';
    }
    box.innerHTML =
      '<div class="hist-summary-title">Últimos 7 dias</div>' +
      '<div class="hist-summary-avgs">' +
        '<span><b>' + ri(avg(kcals)) + '</b> kcal</span>' +
        '<span><b>P' + ri(avg(ps)) + '</b></span>' +
        '<span><b>C' + ri(avg(cs)) + '</b></span>' +
        '<span><b>G' + ri(avg(gs)) + '</b></span>' +
      '</div>' +
      '<div class="hist-summary-meta">' + ok + ' de ' + last7.length + ' dias na meta</div>' +
      pesoLine + compLine;
  }

  function kgStr(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }
  function lbStr(n) { return (Math.round(n * 2.20462 * 10) / 10).toFixed(1).replace('.', ','); }
  function pesoStr(n) { return kgStr(n) + '\u00a0kg (' + lbStr(n) + '\u00a0lb)'; }
  function diasEntre(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

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

  function renderPeso(todos, obj) {
    var box = document.getElementById('pesoCard');
    if (!box) return;
    var pesos = todos.slice(-30);
    var titulo = '<div class="hist-summary-title">Peso · últimos 30 dias</div>';
    if (!pesos.length) {
      box.innerHTML = titulo + '<div class="hist-summary-empty">Mande o peso pro Grok ("peso 88,9") e ele aparece aqui.</div>';
      return;
    }
    var ult = pesos[pesos.length - 1];
    var semana = pesos.filter(function (p) { return diasEntre(p.data, ult.data) < 7; });
    var linha = '<div class="peso-now"><b>' + kgStr(ult.kg) + ' kg</b> <span>(' + lbStr(ult.kg) + ' lb) · ' + esc(labelDia(ult.data).replace(/ \d{4}$/, '')) + '</span></div>';
    if (semana.length >= 2) {
      var dlt = semana[semana.length - 1].kg - semana[0].kg;
      linha += '<div class="peso-delta">7 dias: ' + kgStr(semana[0].kg) + ' → ' + kgStr(ult.kg) + ' kg (' +
        (dlt > 0 ? '+' : dlt < 0 ? '−' : '') + kgStr(Math.abs(dlt)) + ' kg)</div>';
    }
    if (pesos.length < 2) {
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
      var tend = tendencia(pesos);
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
      return '<circle cx="' + x(p.data).toFixed(1) + '" cy="' + y(p.kg).toFixed(1) + '" r="4" class="pc-dot"/>' +
        '<circle cx="' + x(p.data).toFixed(1) + '" cy="' + y(p.kg).toFixed(1) + '" r="14" class="pc-hit" data-i="' + i + '"/>';
    }).join('');
    var metaSvg = metaPts ? '<line x1="' + x(metaPts[0].data).toFixed(1) + '" y1="' + y(metaPts[0].kg).toFixed(1) + '" x2="' + x(metaPts[1].data).toFixed(1) + '" y2="' + y(metaPts[1].kg).toFixed(1) + '" class="pc-meta"/>' : '';
    var ax = '<text x="' + L + '" y="' + (H - 4) + '" class="pc-ax">' + esc(labelDia(d0).replace(/ \d{4}$/, '')) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 4) + '" class="pc-ax" text-anchor="end">' + esc(labelDia(fimX).replace(/ \d{4}$/, '')) + '</text>';
    box.innerHTML = titulo + linha +
      '<div class="pc-legend"><span><i class="pc-k-dot"></i>Peso do dia</span><span><i class="pc-k-line"></i>Média 7 dias</span>' + (metaPts ? '<span><i class="pc-k-meta"></i>Meta</span>' : '') + '</div>' +
      '<div class="pc-tip" id="pcTip">Toque num ponto pra ver o valor</div>' +
      '<svg class="pc-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfico de peso">' +
        grid + metaSvg + '<path d="' + path + '" class="pc-line"/>' + dots + ax + '</svg>';
    var tip = document.getElementById('pcTip');
    box.querySelectorAll('.pc-hit').forEach(function (c) {
      c.addEventListener('click', function () {
        var i = Number(c.getAttribute('data-i'));
        var p = pesos[i];
        tip.textContent = labelDia(p.data).replace(/ \d{4}$/, '') + ': ' + kgStr(p.kg) + ' kg (' + lbStr(p.kg) + ' lb) · média 7d ' + pesoStr(med[i].kg);
      });
    });
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
    var corte = uniq.length ? somaDias(uniq[uniq.length - 1], -2) : '';
    fetch('dados/resumo.json', { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
      .catch(function () { return []; })
      .then(function (resumo) {
        var mapa = {};
        (Array.isArray(resumo) ? resumo : []).forEach(function (r) { if (r && r.data) mapa[r.data] = r; });
        carregarDias(uniq, mapa, corte);
      });
  }

  function somaDias(iso, n) {
    return new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
  }

  function carregarDias(uniq, mapa, corte) {
    Promise.all(uniq.map(function (iso) {
      var r = mapa[iso];
      if (r && iso < corte) {
        return Promise.resolve({ ok: true, iso: iso, data: { data: iso, fechado: r.fechado, meta: r.meta, peso_kg: r.peso, cons: r.cons } });
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
        if (r.ok && r.data && r.data.peso_kg != null && !isNaN(Number(r.data.peso_kg))) {
          pesos.push({ data: r.data.data || r.iso, kg: Number(r.data.peso_kg) });
        }
      });
      pesos.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
      var carregaObj = window.NutriObjetivo ? window.NutriObjetivo.carregar() : Promise.resolve(null);
      carregaObj.then(function (obj) { renderPeso(pesos, obj); });
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
          peso: data.peso_kg
        });
      });
      closed.sort(function (a, b) {
        return a.data < b.data ? 1 : (a.data > b.data ? -1 : 0);
      });
      renderSummary(closed);
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
