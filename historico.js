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
    return String(Number(kg)).replace('.', ',') + ' kg (' + lb + ' lb)';
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
    var last7 = days.slice(0, 7);
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
    box.innerHTML =
      '<div class="hist-summary-title">Últimos 7 dias</div>' +
      '<div class="hist-summary-avgs">' +
        '<span><b>' + ri(avg(kcals)) + '</b> kcal</span>' +
        '<span><b>P' + ri(avg(ps)) + '</b></span>' +
        '<span><b>C' + ri(avg(cs)) + '</b></span>' +
        '<span><b>G' + ri(avg(gs)) + '</b></span>' +
      '</div>' +
      '<div class="hist-summary-meta">' + ok + ' de ' + last7.length + ' dias na meta</div>' +
      pesoLine;
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
      var top = labelDia(d.data) + ' · ' + ri(d.cons.kcal) + ' kcal';
      if (peso) top += ' · ' + peso;
      html += '<a href="./dia.html?d=' + encodeURIComponent(d.data) + '">';
      html += '<div>';
      html += '<div class="d' + (o.kcal ? ' over' : '') + '">' + esc(top) + '</div>';
      html += '<div class="m">';
      html += '<span class="' + (o.p ? 'over' : '') + '">P' + ri(d.cons.p) + ' (' + deltaStr(d.cons.p, d.meta.p) + ')</span>';
      html += ' · ';
      html += '<span class="' + (o.c ? 'over' : '') + '">C' + ri(d.cons.c) + ' (' + deltaStr(d.cons.c, d.meta.c) + ')</span>';
      html += ' · ';
      html += '<span class="' + (o.g ? 'over' : '') + '">G' + ri(d.cons.g) + ' (' + deltaStr(d.cons.g, d.meta.g) + ')</span>';
      html += '</div></div></a>';
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
    Promise.all(uniq.map(function (iso) {
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
      results.forEach(function (r) {
        if (!r.ok) {
          showWarn('Não deu pra carregar ' + r.iso);
          return;
        }
        var data = r.data || {};
        if (!data.fechado) return;
        var meta = data.meta || { kcal: 1570, p: 180, c: 100, g: 50 };
        var cons = sumMeals(data.lancado || []);
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
