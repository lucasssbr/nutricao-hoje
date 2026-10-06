/* Tela Hoje: "Refeições frequentes" + aviso suave à noite.
   - Frequentes: pelos últimos 14 dias lançados, o que o Lucas mais repete — pares de alimentos que aparecem
     juntos numa refeição em 2+ dias (ex.: chuck + batata) e alimento comido SOZINHO em 2+ dias (ex.: Nurri).
     Quantidades da vez mais recente. Até 3. Tocar → mesmo painel do "↻ Repetir hoje" (repetir.js): mensagem
     pronta para o Grok. O site só lê dados/.
   - Aviso: depois das 21h (LA), se hoje ainda não tem nada lançado — só um lembrete neutro, sem cobrança. */
(function () {
  var N = window.Nutri, R = window.NutriRepetir;
  var box = document.getElementById('frequentes');
  if (!box || !R || !document.body.hasAttribute('data-dia')) return;
  var hoje = document.body.getAttribute('data-dia');

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function curto(nome) { return String(nome || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); }
  function get(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function horaLA() {
    return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false }).format(new Date()), 10) % 24;
  }

  // combos frequentes: [{ids, dias, itens (da vez mais recente), refeicao, data}]
  function frequentes(dias) {
    var combos = {};
    function anota(chave, ids, dia, itens, refeicao) {
      var c = combos[chave] || (combos[chave] = { ids: ids, dias: {}, ult: null });
      c.dias[dia] = 1;
      if (!c.ult || dia >= c.ult.data) c.ult = { data: dia, itens: itens, refeicao: refeicao };
    }
    dias.forEach(function (d) {
      (d.lancado || []).forEach(function (r) {
        var porId = {};
        (r.itens || []).forEach(function (it) { if (it.alimento && Number(it.quantidade) > 0) porId[it.alimento] = it; });
        var ids = Object.keys(porId).sort();
        if (ids.length === 1) anota('1:' + ids[0], ids, d.data, [porId[ids[0]]], r.refeicao);
        for (var i = 0; i < ids.length; i++) {
          for (var j = i + 1; j < ids.length; j++) anota('2:' + ids[i] + '+' + ids[j], [ids[i], ids[j]], d.data, [porId[ids[i]], porId[ids[j]]], r.refeicao);
        }
      });
    });
    var lista = Object.keys(combos).map(function (k) { var c = combos[k]; return { ids: c.ids, n: Object.keys(c.dias).length, ult: c.ult }; })
      .filter(function (c) { return c.n >= 2; })
      .sort(function (a, b) { return b.n - a.n || b.ids.length - a.ids.length || (a.ult.data < b.ult.data ? 1 : -1); });
    var out = [], usados = {};
    lista.forEach(function (c) {
      if (out.length >= 3) return;
      var chave = c.ids.join('+');
      if (usados[chave]) return;
      out.push(c);
      usados[chave] = 1;
    });
    return out;
  }

  function render(lista, avisar) {
    var h = '';
    if (avisar) {
      h += '<div class="freq-aviso">Nada lançado hoje ainda. Se já comeu, dá para mandar ao Grok por aqui: refeições frequentes, "↻ Repetir" num dia anterior ou "+ Adicionar do rótulo".</div>';
    }
    if (lista.length) {
      h += '<div class="freq-card"><div class="freq-tit">Refeições frequentes <span>· toque para lançar hoje (mensagem pro Grok)</span></div>';
      lista.forEach(function (c, i) {
        var kcal = c.ult.itens.reduce(function (t, it) { return t + (Number(it.kcal) || 0); }, 0);
        h += '<button type="button" class="freq-btn" data-freq="' + i + '"><span class="freq-nome">' +
          c.ult.itens.map(function (it) { return esc(curto(it.nome)) + ' <i>' + esc(it.qtd || '').replace(/ /g, '\u00a0') + '</i>'; }).join(' + ') +
          '</span><span class="freq-meta">' + Math.round(kcal) + ' kcal · em ' + c.n + ' dias</span></button><div class="rep-painel" id="freq-' + i + '" hidden></div>';
      });
      h += '</div>';
    }
    box.innerHTML = h;
    box.querySelectorAll('[data-freq]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = parseInt(b.getAttribute('data-freq'), 10), c = lista[i], painel = document.getElementById('freq-' + i);
        if (!painel.hidden) { painel.hidden = true; return; }
        R.montar(painel, { refeicao: c.ult.refeicao, itens: c.ult.itens }, c.ult.data, 'Refeição frequente (em ' + c.n + ' dias, quantidades de ' + c.ult.data.slice(8, 10) + '/' + c.ult.data.slice(5, 7) + ')');
      });
    });
  }

  get('dados/dias.json').then(function (todos) {
    var datas = (todos || []).filter(function (d) { return d <= hoje && N.diasEntre(d, hoje) < 14; });
    return Promise.all(datas.map(function (d) { return get('dados/' + d + '.json'); }));
  }).then(function (arqs) {
    var dias = (arqs || []).filter(Boolean);
    var deHoje = dias.filter(function (d) { return d.data === hoje; })[0];
    var avisar = !!deHoje && !deHoje.fechado && !(deHoje.lancado || []).length && horaLA() >= 21 && N.hojeLA() === hoje;
    render(frequentes(dias), avisar);
  });

  window.NutriFrequentes = { frequentes: frequentes };   // para testes
})();
