(function () {
  var MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  var CIRC = 364.4;
  var body = document.body;
  var isHoje = body.hasAttribute('data-dia');
  var pageDia = body.getAttribute('data-dia');
  var invalidQueryDate = false;
  if (!pageDia) {
    var params = new URLSearchParams(window.location.search);
    pageDia = params.get('d') || '';
    invalidQueryDate = !/^\d{4}-\d{2}-\d{2}$/.test(pageDia);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function localISODate() {
    var now = new Date();
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  }

  function ddmm(iso) {
    var p = (iso || '').split('-');
    if (p.length !== 3) return iso || '—';
    return p[2] + '/' + p[1];
  }

  function labelDia(iso) {
    var p = (iso || '').split('-');
    if (p.length !== 3) return iso || '—';
    var mi = parseInt(p[1], 10) - 1;
    return parseInt(p[2], 10) + ' ' + (MESES[mi] || p[1]) + ' ' + p[0];
  }

  function sumItens(itens) {
    var t = { kcal: 0, p: 0, c: 0, g: 0 };
    (itens || []).forEach(function (i) {
      t.kcal += Number(i.kcal) || 0;
      t.p += Number(i.p) || 0;
      t.c += Number(i.c) || 0;
      t.g += Number(i.g) || 0;
    });
    return t;
  }

  function sumMeals(meals) {
    var t = { kcal: 0, p: 0, c: 0, g: 0 };
    (meals || []).forEach(function (m) {
      var s = sumItens(m.itens);
      t.kcal += s.kcal; t.p += s.p; t.c += s.c; t.g += s.g;
    });
    return t;
  }

  function ri(n) { return Math.round(Number(n) || 0); }

  function fmtStamp(iso) {
    if (!iso) return '';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return '';
    return 'Atualizado ' + m[3] + '/' + m[2] + ' · ' + m[4] + ':' + m[5];
  }

  function foodHtml(item) {
    return '<div class="food"><div class="left"><div class="name">' + esc(item.nome) +
      '</div><div class="qty">' + esc(item.qtd || '') + '</div></div><div class="right"><div class="cal">' +
      ri(item.kcal) + '</div><div class="chips"><span class="chip p">P' + ri(item.p) +
      '</span><span class="chip c">C' + ri(item.c) + '</span><span class="chip f">G' + ri(item.g) +
      '</span></div></div></div>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function totLabel(t) {
    return '<b>' + ri(t.kcal) + ' kcal</b> · P' + ri(t.p) + ' · C' + ri(t.c) + ' · G' + ri(t.g);
  }

  function barPct(val, meta) {
    if (!meta || meta <= 0) return 0;
    return Math.min(100, (val / meta) * 100);
  }

  function showError(msg) {
    var app = document.getElementById('app');
    if (app) app.innerHTML = '<div class="load-error">' + esc(msg) + '</div>';
    var stamp = document.getElementById('updateStamp');
    if (stamp) stamp.textContent = '';
  }

  function updateBanner(data) {
    var el = document.getElementById('staleBanner');
    if (!el) return;
    el.classList.remove('show');
    el.textContent = '';
    if (!isHoje) return;
    var dia = data.data || pageDia;
    var parts = dia.split('-');
    if (data.fechado) {
      // no yellow stale when closed
      return;
    }
    if (localISODate() !== dia && parts.length === 3) {
      el.textContent = 'Página de ' + parts[2] + '/' + parts[1] + ' — dia ainda não fechado (ou cache antigo)';
      el.classList.add('show');
    }
  }

  function render(data) {
    var meta = data.meta || { kcal: 1570, p: 180, c: 100, g: 50 };
    var lancado = data.lancado || [];
    var sugestao = data.sugestao || [];
    var cons = sumMeals(lancado);
    var sug = sumMeals(sugestao);
    var proj = {
      kcal: cons.kcal + sug.kcal,
      p: cons.p + sug.p,
      c: cons.c + sug.c,
      g: cons.g + sug.g
    };
    var rest = {
      kcal: meta.kcal - cons.kcal,
      p: meta.p - cons.p,
      c: meta.c - cons.c,
      g: meta.g - cons.g
    };
    var dia = data.data || pageDia;
    var hasCons = cons.kcal > 0 || cons.p > 0 || cons.c > 0 || cons.g > 0 || lancado.length > 0;

    var shortLabel = labelDia(dia).replace(/ \d{4}$/, '');
    if (isHoje && !data.fechado) {
      document.getElementById('pageTitle').textContent = 'Hoje';
    } else {
      document.getElementById('pageTitle').textContent = shortLabel;
    }
    document.getElementById('pageDate').textContent = labelDia(dia) + (data.fechado ? ' · fechado' : '');
    if (!isHoje) {
      document.title = shortLabel + ' · Nutrição';
    }

    var stamp = document.getElementById('updateStamp');
    if (stamp) stamp.textContent = fmtStamp(data.atualizado) || '';

    updateBanner(data);

    var pct = meta.kcal > 0 ? Math.min(1, cons.kcal / meta.kcal) : 0;
    var offset = CIRC * (1 - pct);
    var ringFilter = cons.kcal > 0
      ? ' style="filter: drop-shadow(0 0 8px rgba(255,69,58,0.45));"'
      : '';

    var remainK, remainV, remainSub;
    if (data.fechado) {
      remainK = 'Dia fechado';
      remainV = String(Math.abs(ri(rest.kcal)));
      remainSub = rest.kcal < 0 ? 'kcal acima da meta' : (rest.kcal > 0 ? 'kcal abaixo da meta' : 'na meta');
    } else if (!hasCons) {
      remainK = 'Meta do dia';
      remainV = String(ri(meta.kcal));
      remainSub = 'kcal · ainda sem refeições';
    } else {
      remainK = 'Restante';
      remainV = String(ri(rest.kcal));
      remainSub = 'kcal · P' + ri(rest.p) + ' · C' + ri(rest.c) + ' · G' + ri(rest.g);
    }

    function macroFill(val, m, cls) {
      var over = val > m;
      var w = barPct(val, m);
      var bg = over ? 'var(--over)' : (cls === 'p' ? 'var(--protein)' : cls === 'c' ? 'var(--carbs)' : 'var(--fat)');
      var overClass = over ? ' --over' : '';
      return '<div class="fill ' + cls + overClass + '" style="width:' + w.toFixed(1) + '%;background:' + bg + '"></div>';
    }

    var alertHtml;
    if (data.fechado) {
      alertHtml = '<div class="alert">Dia fechado</div>';
    } else if (!hasCons) {
      alertHtml = '<div class="alert" style="background:rgba(10,132,255,0.12);border-color:rgba(10,132,255,0.28);color:#64D2FF">' +
        labelDia(dia).replace(/ \d{4}$/, '') + ' limpo — sugestão abaixo não entra no consumo</div>';
    } else {
      alertHtml = '<div class="alert" style="background:rgba(10,132,255,0.12);border-color:rgba(10,132,255,0.28);color:#64D2FF">' +
        'Sugestão abaixo não entra no consumo até lançar</div>';
    }

    document.getElementById('hero').innerHTML =
      '<div class="ring-wrap">' +
        '<div class="ring">' +
          '<svg viewBox="0 0 148 148"><circle cx="74" cy="74" r="58" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12" />' +
          '<circle cx="74" cy="74" r="58" fill="none" stroke="#FF453A" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + offset.toFixed(1) + '"' + ringFilter + ' /></svg>' +
          '<div class="center"><div class="big">' + ri(cons.kcal) + '</div><div class="lbl">de ' + ri(meta.kcal) + ' kcal</div></div>' +
        '</div>' +
        '<div class="remain-box"><div class="k">' + remainK + '</div><div class="v">' + remainV + '</div><div class="sub">' + remainSub + '</div></div>' +
      '</div>' +
      '<div class="macros">' +
        '<div class="macro"><div class="name p">Proteína</div><div class="track">' + macroFill(cons.p, meta.p, 'p') + '</div><div class="nums">' + ri(cons.p) + ' <span>/ ' + ri(meta.p) + ' g</span></div></div>' +
        '<div class="macro"><div class="name c">Carbo</div><div class="track">' + macroFill(cons.c, meta.c, 'c') + '</div><div class="nums">' + ri(cons.c) + ' <span>/ ' + ri(meta.c) + ' g</span></div></div>' +
        '<div class="macro"><div class="name f">Gordura</div><div class="track">' + macroFill(cons.g, meta.g, 'f') + '</div><div class="nums">' + ri(cons.g) + ' <span>/ ' + ri(meta.g) + ' g</span></div></div>' +
      '</div>' +
      alertHtml;

    var mealsEl = document.getElementById('meals');
    var html = '';

    lancado.forEach(function (meal) {
      var t = sumItens(meal.itens);
      html += '<section class="meal">';
      html += '<div class="meal-head"><h3>' + esc(meal.refeicao || 'Refeição') + '</h3><div class="tot">' + totLabel(t) + '</div></div>';
      (meal.itens || []).forEach(function (it) { html += foodHtml(it); });
      html += '</section>';
    });

    if (sugestao.length) {
      var nota = (data.sugestao_nota && String(data.sugestao_nota).trim()) || '';
      var sugTitle = hasCons ? 'Pra fechar o dia' : 'Sugestão do dia';
      html += '<section class="meal suggest">';
      html += '<div class="badge">NÃO LANÇADO</div>';
      html += '<div class="meal-head"><h3>' + sugTitle + '</h3><div class="tot">' + totLabel(sug) + '</div></div>';
      if (nota) {
        html += '<div class="hint">' + esc(nota) + '</div>';
      }
      sugestao.forEach(function (meal) {
        var t = sumItens(meal.itens);
        html += '<div class="suggest-meal">';
        html += '<div class="meal-head"><h3>' + esc(meal.refeicao) + '</h3><div class="tot">' + totLabel(t) + '</div></div>';
        (meal.itens || []).forEach(function (it) { html += foodHtml(it); });
        html += '</div>';
      });
      html += '<div class="proj">Dia projetado: ' + ri(proj.kcal) + ' kcal · P' + ri(proj.p) + ' · C' + ri(proj.c) + ' · G' + ri(proj.g);
      if (nota) {
        html += '<div class="hint" style="margin:6px 0 0;color:#E9D5FF">' + esc(nota) + '</div>';
      }
      html += '</div>';
      html += '</section>';
    }

    mealsEl.innerHTML = html;

    var footer = document.getElementById('footer');
    if (data.fechado) {
      footer.textContent = 'Meta ' + ri(meta.kcal) + ' · ' + ri(meta.p) + 'P · ' + ri(meta.c) + 'C · ' + ri(meta.g) + 'G · dia fechado';
    } else {
      footer.textContent = 'Sugestão do dia preservada · não conta no consumo de ' + labelDia(dia).replace(/ \d{4}$/, '');
    }
  }

  if (!pageDia || invalidQueryDate) {
    showError('Não consegui carregar os dados de ' + ddmm(pageDia || '—'));
    return;
  }

  var url = 'dados/' + pageDia + '.json';
  fetch(url, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      render(data);
    })
    .catch(function () {
      showError('Não consegui carregar os dados de ' + ddmm(pageDia));
    });
})();
