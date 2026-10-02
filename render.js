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

  // "hoje" sempre no fuso de Los Angeles (mesmo com o iPhone em outro fuso)
  function localISODate() { return window.Nutri.hojeLA(); }

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

  var ri = window.Nutri.ri;  // meio para longe do zero, igual ao Python

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

  // fibra: só aparece quando os itens têm o campo (dias a partir de 29/09); referência ~14 g por 1000 kcal
  function fibraHtml(lancado, sugestao, meta, data) {
    var tem = false, comido = 0, plano = 0;
    function soma(meals) {
      var t = 0;
      (meals || []).forEach(function (m) {
        (m.itens || []).forEach(function (it) { if (it.fibra != null) { tem = true; t += Number(it.fibra) || 0; } });
      });
      return t;
    }
    comido = soma(lancado);
    plano = data.fechado ? 0 : soma(sugestao);
    if (!tem) return '';
    var ref = Math.round((meta.kcal || 1570) * 14 / 1000);
    return '<div class="fibra-linha"><b>Fibra</b> ' + ri(comido) + '\u00a0g' +
      (plano ? ' · dia projetado ' + ri(comido + plano) + '\u00a0g' : '') +
      ' · ref. ~' + ref + '\u00a0g</div>';
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
      el.textContent = 'Dia ' + parts[2] + '/' + parts[1] + ' ainda não fechado — o fechamento da meia-noite atrasou (ou a página está em cache). Avise o Grok/Claude.';
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
    var dateEl = document.getElementById('pageDate');
    // fechar à meia-noite não prova que tudo foi registrado: mostra a completude confirmada
    var reg = (data.registro && data.registro.status) || '';
    var regTxt = reg === 'completo' ? 'registro completo' : reg === 'parcial' ? 'registro parcial' : 'registro não confirmado';
    var passado = dia < localISODate();
    dateEl.textContent = labelDia(dia) + (data.fechado ? ' · fechado' : '') +
      ((data.fechado || passado || reg) && !data.previa ? ' · ' + regTxt : '');
    var pesoEl = document.getElementById('pagePeso');
    if (!pesoEl) {
      pesoEl = document.createElement('div');
      pesoEl.id = 'pagePeso';
      pesoEl.className = 'peso';
      dateEl.insertAdjacentElement('afterend', pesoEl);
    }
    if (data.peso_kg != null && data.peso_kg !== '' && !isNaN(Number(data.peso_kg))) {
      var pesoStr = Number(data.peso_kg).toFixed(1).replace('.', ',');
      var lbStr = window.Nutri.arred(Number(data.peso_kg) * 2.20462, 1).toFixed(1).replace('.', ',');
      pesoEl.textContent = 'Peso ' + pesoStr + ' kg (' + lbStr + ' lb)';
      pesoEl.hidden = false;
    } else {
      pesoEl.textContent = '';
      pesoEl.hidden = true;
    }
    if (!isHoje) {
      document.title = shortLabel + ' · Nutrição';
    }

    var stamp = document.getElementById('updateStamp');
    if (stamp) stamp.textContent = fmtStamp(data.atualizado) || '';

    updateBanner(data);

    var pct = meta.kcal > 0 ? Math.min(1, cons.kcal / meta.kcal) : 0;
    var offset = CIRC * (1 - pct);
    // cor neutra dentro da meta; laranja só se passar (sem vermelho de "erro")
    var ringOver = cons.kcal > meta.kcal;
    var ringCor = ringOver ? 'var(--over)' : 'var(--kcal)';
    var ringStyle = ' style="stroke:' + ringCor + (cons.kcal > 0 ? ';filter: drop-shadow(0 0 8px ' + (ringOver ? 'rgba(255,159,10,0.45)' : 'rgba(64,200,224,0.40)') + ')' : '') + '"';

    var remainK, remainV, remainSub;
    if (data.fechado) {
      remainK = 'Dia fechado';
      remainV = String(Math.abs(ri(rest.kcal)));
      remainSub = rest.kcal < 0 ? 'kcal acima da meta' : (rest.kcal > 0 ? 'kcal abaixo da meta' : 'na meta');
    } else if (!hasCons) {
      remainK = 'Meta do dia';
      remainV = String(ri(meta.kcal));
      remainSub = 'kcal · ainda sem refeições';
    } else if (ri(rest.kcal) < 0) {
      remainK = 'Acima da meta';
      remainV = String(-ri(rest.kcal));
      remainSub = 'kcal · P' + ri(rest.p) + ' · C' + ri(rest.c) + ' · G' + ri(rest.g) + ' restantes';
    } else {
      function faltaOuPassou(letra, v) { return v < 0 ? letra + ' +' + ri(-v) + ' acima' : letra + ri(v); }
      if (rest.kcal < 0) {
        remainK = 'Acima da meta';
        remainV = '+' + ri(-rest.kcal);
      } else {
        remainK = 'Restante';
        remainV = String(ri(rest.kcal));
      }
      remainSub = 'kcal · ' + faltaOuPassou('P', rest.p) + ' · ' + faltaOuPassou('C', rest.c) + ' · ' + faltaOuPassou('G', rest.g);
    }

    // proteína é piso: passar da meta é bom; carbo/gordura acima da meta = listrado + "+N" (o carbo já é laranja)
    function acima(val, m, cls) { return cls !== 'p' && ri(val) > ri(m); }
    function macroNums(val, m, cls) {
      // dia fechado: proteína abaixo do piso mostra quanto faltou (no dia aberto isso já está no "restante")
      var faltou = data.fechado && cls === 'p' && ri(val) < ri(m) ? ' <em class="faltou">−' + (ri(m) - ri(val)) + '</em>' : '';
      return ri(val) + ' <span>/ ' + ri(m) + ' g</span>' + (acima(val, m, cls) ? ' <em class="excesso">+' + (ri(val) - ri(m)) + '</em>' : '') + faltou;
    }
    function macroFill(val, m, cls) {
      var over = acima(val, m, cls);
      var w = barPct(val, m);
      var bg = over ? 'repeating-linear-gradient(135deg, var(--over) 0 6px, rgba(255,255,255,0.55) 6px 9px)' : (cls === 'p' ? 'var(--protein)' : cls === 'c' ? 'var(--carbs)' : 'var(--fat)');
      var overClass = over ? ' --over' : '';
      return '<div class="fill ' + cls + overClass + '" style="width:' + w.toFixed(1) + '%;background:' + bg + '"></div>';
    }

    var alertHtml;
    if (data.fechado) {
      alertHtml = '<div class="alert">Dia fechado</div>';
    } else if ((isHoje && sugestao.length) || data.previa) {
      alertHtml = '';
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
          '<circle cx="74" cy="74" r="58" fill="none" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + offset.toFixed(1) + '"' + ringStyle + ' /></svg>' +
          '<div class="center"><div class="big">' + ri(cons.kcal) + '</div><div class="lbl">de ' + ri(meta.kcal) + ' kcal</div></div>' +
        '</div>' +
        '<div class="remain-box"><div class="k">' + remainK + '</div><div class="v">' + remainV + '</div><div class="sub">' + remainSub + '</div></div>' +
      '</div>' +
      '<div class="macros">' +
        '<div class="macro"><div class="name p">Proteína</div><div class="track">' + macroFill(cons.p, meta.p, 'p') + '</div><div class="nums">' + macroNums(cons.p, meta.p, 'p') + '</div></div>' +
        '<div class="macro"><div class="name c">Carbo</div><div class="track">' + macroFill(cons.c, meta.c, 'c') + '</div><div class="nums">' + macroNums(cons.c, meta.c, 'c') + '</div></div>' +
        '<div class="macro"><div class="name f">Gordura</div><div class="track">' + macroFill(cons.g, meta.g, 'f') + '</div><div class="nums">' + macroNums(cons.g, meta.g, 'f') + '</div></div>' +
      '</div>' +
      fibraHtml(lancado, sugestao, meta, data) +
      alertHtml;

    if (isHoje && !data.fechado && sugestao.length) {
      var prox = sugestao[0];
      var tp = sumItens(prox.itens);
      var lista = (prox.itens || []).map(function (it) {
        return esc(String(it.nome || '').replace(/\s*\(.*?\)\s*/g, ' ').trim()) + ' <span>' + esc(it.qtd || '') + '</span>';
      }).join(' · ');
      document.getElementById('hero').insertAdjacentHTML('beforeend',
        '<div class="next-meal">' +
          '<div class="next-label">Próxima refeição · não lançada</div>' +
          '<div class="next-head"><b>' + esc(prox.refeicao || 'Refeição') + '</b><span>' + ri(tp.kcal) + ' kcal · P' + ri(tp.p) + ' · C' + ri(tp.c) + ' · G' + ri(tp.g) + '</span></div>' +
          '<div class="next-items">' + lista + '</div>' +
        '</div>');
    }

    var mealsEl = document.getElementById('meals');
    var html = '';

    lancado.forEach(function (meal) {
      var t = sumItens(meal.itens);
      html += '<section class="meal">';
      html += '<div class="meal-head"><h3>' + esc(meal.refeicao || 'Refeição') + '</h3><div class="tot">' + totLabel(t) + '</div></div>';
      (meal.itens || []).forEach(function (it) { html += foodHtml(it); });
      html += '</section>';
    });

    var notaSolta = (data.sugestao_nota && String(data.sugestao_nota).trim()) || '';
    if (!sugestao.length && notaSolta && !data.fechado) {
      html += '<section class="meal suggest"><div class="badge">NÃO LANÇADO</div><div class="hint" style="margin:0">' + esc(notaSolta) + '</div></section>';
    }

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
        html += '<details class="suggest-meal">';
        html += '<summary class="meal-head"><h3>' + esc(meal.refeicao) + '</h3><div class="tot">' + totLabel(t) + '</div></summary>';
        html += '<div class="suggest-items">';
        (meal.itens || []).forEach(function (it) { html += foodHtml(it); });
        html += '</div></details>';
      });
      html += '<div class="proj">Dia projetado: ' + ri(proj.kcal) + ' kcal · P' + ri(proj.p) + ' · C' + ri(proj.c) + ' · G' + ri(proj.g);
      html += '</div>';
      if (!data.fechado && dia >= localISODate()) {
        // planejador: experimentar trocas e quantidades num rascunho (não lança nada)
        html += '<a class="plan-link" href="./planejar.html?d=' + esc(dia) + '">Planejar / trocar alimentos →</a>';
      }
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
      mostrarLimites(data);
      if (isHoje && window.NutriObjetivo) window.NutriObjetivo.montarHoje(data.peso_kg, data.data, data);
    })
    .catch(function () {
      if (!isHoje && pageDia > localISODate()) {
        previaPlano();
      } else {
        showError('Não consegui carregar os dados de ' + ddmm(pageDia));
      }
    });

  // Contador informativo de alimentos com plano_ate_g (ex.: acém) — não é limite, só mostra quanto já foi
  function mostrarLimites(data) {
    fetch('dados/alimentos.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (ali) {
        function soma(meals, id) {
          var g = 0;
          (meals || []).forEach(function (m) {
            (m.itens || []).forEach(function (it) { if (it.alimento === id) g += Number(it.quantidade) || 0; });
          });
          return g;
        }
        var linhas = [];
        Object.keys(ali).forEach(function (id) {
          var a = ali[id], lim = a && Number(a.plano_ate_g);
          if (!lim) return;
          var comido = soma(data.lancado, id), plano = data.fechado ? 0 : soma(data.sugestao, id);
          if (!comido && !plano) return;
          var nome = (a.apelidos && a.apelidos[0]) || a.nome;
          nome = nome.charAt(0).toUpperCase() + nome.slice(1);
          var txt = '<b>' + esc(nome) + '</b> ' + ri(comido) + ' g cru hoje';
          if (plano) txt += ' · +' + ri(plano) + ' g na sugestão';
          linhas.push('<div class="limite">' + txt + '</div>');
        });
        var hero = document.getElementById('hero');
        var old = document.getElementById('limites');
        if (old) old.remove();
        if (linhas.length && hero) {
          var macros = hero.querySelector('.macros');
          var html = '<div id="limites" class="limites">' + linhas.join('') + '</div>';
          if (macros) macros.insertAdjacentHTML('afterend', html); else hero.insertAdjacentHTML('beforeend', html);
        }
      })
      .catch(function () { /* sem biblioteca: não mostra o contador */ });
  }

  // Dia futuro sem arquivo. Amanhã: prévia da SUGESTÃO AUTOMÁTICA (dados/previa.json, gerada pelo
  // scripts/derivados.py a cada registro). Outros dias (ou sem prévia): plano padrão calculado aqui mesmo
  // (mesma conta do scripts/item.py).
  function previaPlano() {
    function get(u) {
      return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); });
    }
    get('dados/previa.json').then(function (pv) {
      if (!pv || pv.para !== pageDia || !pv.sugestao || !pv.sugestao.length) throw new Error('sem prévia');
      var previa = {
        data: pageDia, fechado: false, previa: true, lancado: [], sugestao: pv.sugestao,
        meta: pv.meta || { kcal: 1570, p: 180, c: 100, g: 50 },
        sugestao_nota: 'Prévia da sugestão automática · refeita a cada refeição de hoje; vira a oficial à meia-noite'
      };
      render(previa);
      mostrarLimites(previa);
      var stamp = document.getElementById('updateStamp');
      if (stamp) stamp.textContent = 'Prévia · ainda não é um dia salvo';
    }).catch(previaPlanoPadrao);
  }

  function previaPlanoPadrao() {
    function get(u) {
      return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); });
    }
    var objetivo = get('dados/objetivo.json').catch(function () { return null; });
    Promise.all([get('dados/alimentos.json'), get('dados/refeicoes.json'), objetivo]).then(function (res) {
      var ali = res[0], refs = res[1];
      var metas = res[2] && res[2].atual && res[2].atual.metas;
      function item(id, q) {
        var a = ali[id];
        var m = /^\s*([\d.,]+)\s*(g|un|lata)\b/.exec(a.base);
        var n = parseFloat(m[1].replace(',', '.')), f = q / n;
        var und = m[2] === 'g' ? ' g' : (m[2] === 'lata' ? ' lata' : ' un');
        function r1(v) { return window.Nutri.arred(v * f, 1); }
        var it = { nome: a.nome, qtd: q + und, alimento: id, quantidade: q, kcal: r1(a.kcal), p: r1(a.p), c: r1(a.c), g: r1(a.g) };
        if (a.fibra != null) it.fibra = r1(a.fibra);
        return it;
      }
      var sugestao = (refs.plano_padrao || []).map(function (rid) {
        var r = refs.refeicoes[rid];
        return { refeicao: r.nome, itens: r.itens.map(function (par) { return item(par[0], par[1]); }) };
      });
      var previa = {
        data: pageDia, fechado: false, previa: true, lancado: [], sugestao: sugestao,
        meta: metas || { kcal: 1570, p: 180, c: 100, g: 50 },
        sugestao_nota: 'Prévia do plano padrão · à meia-noite a sugestão de verdade é montada com o que você comeu nos últimos dias'
      };
      render(previa);
      mostrarLimites(previa);
      var stamp = document.getElementById('updateStamp');
      if (stamp) stamp.textContent = 'Prévia · ainda não é um dia salvo';
    }).catch(function () {
      showError('O plano de ' + ddmm(pageDia) + ' aparece sozinho à meia-noite. Pra mudar antes, peça ao Grok.');
    });
  }
})();

// Recarrega ao voltar pro app depois de 1 min (dados sempre frescos)
(function () {
  var t0 = Date.now();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - t0 > 60000) location.reload();
  });
})();
