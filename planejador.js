/* Núcleo do planejador (só contas, sem tela) — window.NutriPlano. Carregar depois de comum.js.
   As contas e regras são as MESMAS do Python, com teste de paridade (tests/test_planejador.py):
   - esperado(): valores com 1 casa = scripts/item.py:esperado (arredondamento de comum.js = comum.py);
   - lerQuantidade(): = item.py:ler_quantidade (vírgula decimal, unidade opcional que precisa bater);
   - grade(), tetosDoDia(), consumo(), horario(), custoMacros(): = scripts/sugerir.py.
   Planejamento NUNCA vira consumo: nada aqui grava em dados/. */
(function () {
  var N = window.Nutri;
  var MACROS = ['kcal', 'p', 'c', 'g'];
  var HORARIOS = ['Café', 'Almoço', 'Lanche', 'Jantar'];

  function arred(x, casas) { return N.arred(x, casas); }

  // '100 g' → {unidade:'g', n:100, rotulo:'g'}; '1 lata (325 ml)' → {unidade:'un', n:1, rotulo:'lata'}
  function base(al) {
    var m = /^\s*(\d+(?:[.,]\d+)?)\s*(g|un|lata)\b/.exec(String((al && al.base) || ''));
    if (!m) throw new Error('base inválida: ' + (al && al.base));
    var n = parseFloat(m[1].replace(',', '.'));
    if (!(n > 0)) throw new Error('base precisa ser maior que zero');
    return { unidade: m[2] === 'g' ? 'g' : 'un', n: n, rotulo: m[2] };
  }

  // '200', '200g', '1,5', '2 un', '1lata' → número > 0; unidade escrita tem que bater com a base
  function lerQuantidade(texto, unidade) {
    var m = /^\s*(\d+(?:[.,]\d+)?)\s*(g|un|lata)?\s*$/.exec(String(texto == null ? '' : texto).toLowerCase());
    if (!m) throw new Error('Quantidade inválida: use um número maior que zero (ex.: 150 ou 1,5)');
    var q = parseFloat(m[1].replace(',', '.'));
    if (m[2] && (m[2] === 'g' ? 'g' : 'un') !== unidade) throw new Error('Unidade não bate: este alimento é medido em ' + (unidade === 'g' ? 'gramas' : 'unidades'));
    if (!(isFinite(q) && q > 0)) throw new Error('Quantidade precisa ser maior que zero');
    return q;
  }

  function enxuto(x) { return Number.isInteger(x) ? x : x; }

  // valores para a quantidade, 1 casa (mesma conta do Python)
  function esperado(al, q) {
    var b = base(al), f = q / b.n, v = {};
    MACROS.forEach(function (k) { v[k] = arred(al[k] * f, 1); });
    if (typeof al.fibra === 'number' && isFinite(al.fibra)) v.fibra = arred(al.fibra * f, 1);
    return v;
  }

  function textoQtd(al, q) {
    var b = base(al);
    var s = String(q).replace('.', ',');
    return s + (b.unidade === 'g' ? ' g' : (b.rotulo === 'lata' ? ' lata' : ' un'));
  }

  // item no formato do JSON do dia (como item.py:montar_item); qtd mostra vírgula
  function item(alimentos, aid, q) {
    var al = alimentos[aid];
    if (!al) throw new Error('alimento ' + aid + ' não está mais na biblioteca');
    var it = { nome: al.nome, qtd: textoQtd(al, q), alimento: aid, quantidade: q };
    var v = esperado(al, q);
    Object.keys(v).forEach(function (k) { it[k] = v[k]; });
    return it;
  }

  // soma dos valores GUARDADOS (nunca recalcula pela biblioteca)
  function somar(refeicoes) {
    var t = { kcal: 0, p: 0, c: 0, g: 0, fibra: 0, temFibra: false };
    (refeicoes || []).forEach(function (r) {
      (r.itens || []).forEach(function (i) {
        MACROS.forEach(function (k) { t[k] += Number(i[k]) || 0; });
        if (i.fibra != null) { t.fibra += Number(i.fibra) || 0; t.temFibra = true; }
      });
    });
    return t;
  }

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // horário-padrão de uma refeição: pelo nome; senão pela hora de consumo (= sugerir.py:horario)
  function horario(ref) {
    var n = norm(ref && ref.refeicao);
    var pares = [['cafe', 'Café'], ['almoc', 'Almoço'], ['jantar', 'Jantar'], ['ceia', 'Jantar'], ['lanche', 'Lanche'], ['doce', 'Lanche']];
    for (var i = 0; i < pares.length; i++) if (n.indexOf(pares[i][0]) >= 0) return pares[i][1];
    var c = String((ref && ref.consumido_em) || '');
    if (c.length >= 16 && c[13] === ':') {
      var hh = parseInt(c.slice(11, 13), 10);
      return hh < 11 ? 'Café' : hh < 15 ? 'Almoço' : hh < 19 ? 'Lanche' : 'Jantar';
    }
    return null;
  }

  function config(refs) {
    var cfg = { janela_dias: 14, min_dias: 2, incluir: {}, max_dia: {}, so_jantar: ['clara-100g', 'clara-un'] };
    var sa = (refs && refs.sugestao_auto) || {};
    Object.keys(sa).forEach(function (k) { cfg[k] = sa[k]; });
    return cfg;
  }

  // teto de PLANEJAMENTO por alimento no dia: max_dia; senão plano_ate_g (= sugerir.py:tetos_do_dia)
  function tetosDoDia(alimentos, cfg) {
    var t = {};
    Object.keys(cfg.max_dia || {}).forEach(function (a) { t[a] = Number(cfg.max_dia[a]); });
    Object.keys(alimentos).forEach(function (a) {
      if (alimentos[a] && alimentos[a].plano_ate_g && !(a in t)) t[a] = Number(alimentos[a].plano_ate_g);
    });
    return t;
  }

  function consumo(refeicoes) {
    var q = {};
    (refeicoes || []).forEach(function (r) {
      (r.itens || []).forEach(function (i) {
        if (i.alimento && typeof i.quantidade === 'number') q[i.alimento] = (q[i.alimento] || 0) + i.quantidade;
      });
    });
    return q;
  }

  // round() do Python 3: meio para o PAR (4,5 → 4; 5,5 → 6) — usado só onde o sugerir.py usa round()
  function roundPy(x) {
    var f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }

  // quantidades possíveis numa refeição (0 = não incluir) — = sugerir.py:grade
  function grade(al, tipico, teto) {
    var b = base(al);
    if (teto != null && teto <= 1e-9) return [0];
    var hi, lista = [], q;
    if (b.unidade === 'un') {
      hi = Math.max(1, roundPy(Math.max(tipico * 1.5, tipico + 1)));
      if (teto != null) hi = Math.min(hi, Math.floor(teto + 1e-9));
      for (q = 0; q <= hi; q++) lista.push(q);
      return lista;
    }
    var passo = tipico <= 300 ? 10 : 25;
    hi = Math.max(passo, Math.max(tipico * 1.5, tipico + 100));
    if (teto != null) hi = Math.min(hi, teto);
    hi = Math.floor(hi / passo) * passo;
    var lo = Math.max(passo, Math.floor(tipico * 0.5 / passo) * passo);
    if (hi < lo) return [0];
    lista.push(0);
    for (q = lo; q <= hi; q += passo) lista.push(q);
    return lista;
  }

  // distância do total do dia até a meta (= sugerir.py:custo_macros)
  function custoMacros(tot, meta) {
    var f = Math.pow((tot.kcal - meta.kcal) / 40, 2);
    f += 6 * Math.pow(Math.max(0, meta.p - tot.p) / 5, 2);
    f += 0.3 * Math.pow(Math.max(0, tot.p - meta.p - 15) / 10, 2);
    f += 6 * Math.pow(Math.max(0, tot.g - meta.g) / 5, 2);
    f += Math.pow((tot.c - meta.c) / 10, 2);
    return f;
  }

  window.NutriPlano = {
    MACROS: MACROS, HORARIOS: HORARIOS, base: base, lerQuantidade: lerQuantidade, esperado: esperado,
    textoQtd: textoQtd, item: item, somar: somar, norm: norm, horario: horario, config: config,
    tetosDoDia: tetosDoDia, consumo: consumo, grade: grade, custoMacros: custoMacros, enxuto: enxuto
  };
})();
