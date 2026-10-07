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

  // ---------------- base do dia e rascunho ----------------

  function hash(str) {   // FNV-1a 32 bits — só para detectar mudança, não é segurança
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function chaveLancado(r, i) { return r.id_evento || ('#' + i + ':' + (r.refeicao || '') + ':' + (r.consumido_em || '')); }

  // de onde vem o plano de um dia: arquivo do dia (hoje/criado) > prévia de amanhã > plano padrão
  function baseDoDia(dia, arqDia, previa, padrao) {
    if (arqDia) {
      return { data: dia, fonte: 'dia', fechado: !!arqDia.fechado, meta: arqDia.meta, lancado: arqDia.lancado || [],
               sugestao: arqDia.sugestao || [], nota: arqDia.sugestao_nota || '' };
    }
    if (previa && previa.para === dia && (previa.sugestao || []).length) {
      return { data: dia, fonte: 'previa', fechado: false, meta: previa.meta, lancado: [], sugestao: previa.sugestao,
               nota: previa.sugestao_nota || '' };
    }
    return { data: dia, fonte: 'padrao', fechado: false, meta: padrao.meta, lancado: [], sugestao: padrao.sugestao,
             nota: 'Plano padrão (a sugestão automática deste dia ainda não existe)' };
  }

  // impressões digitais da base, por parte, para explicar O QUE mudou
  function partesDaBase(base, alimentos) {
    var usados = {};
    (base.sugestao || []).forEach(function (r) { (r.itens || []).forEach(function (i) { usados[i.alimento] = 1; }); });
    var bib = Object.keys(alimentos).sort().map(function (a) {
      var x = alimentos[a];
      return [a, x.base, x.kcal, x.p, x.c, x.g, x.fibra];
    });
    return {
      lancado: hash(JSON.stringify((base.lancado || []).map(function (r, i) {
        return [chaveLancado(r, i), (r.itens || []).map(function (it) { return [it.alimento, it.quantidade, it.kcal]; })];
      }))),
      meta: hash(JSON.stringify(base.meta || {})),
      sugestao: hash(JSON.stringify((base.sugestao || []).map(function (r) {
        return [r.refeicao, (r.itens || []).map(function (it) { return [it.alimento, it.quantidade]; })];
      }))),
      biblioteca: hash(JSON.stringify(bib))
    };
  }

  function rascunhoDaSugestao(base) {
    return (base.sugestao || []).map(function (r) {
      return { refeicao: r.refeicao, itens: (r.itens || []).filter(function (i) { return i.alimento; })
        .map(function (i) { return { alimento: i.alimento, quantidade: i.quantidade }; }) };
    });
  }

  function novoRascunho(base, alimentos) {
    return { v: 1, data: base.data, refeicoes: rascunhoDaSugestao(base), excluidos: [], manter: [],
             base: partesDaBase(base, alimentos),
             lancados: (base.lancado || []).map(chaveLancado) };
  }

  // valores do rascunho (biblioteca atual) + consumido (valores GUARDADOS) + projeção
  function calcular(rasc, base, alimentos, suspeitas) {
    suspeitas = suspeitas || [];
    var refeicoes = rasc.refeicoes.map(function (r, iR) {
      var itens = r.itens.map(function (it) {
        try { return item(alimentos, it.alimento, it.quantidade); }
        catch (e) { return { alimento: it.alimento, quantidade: it.quantidade, nome: it.alimento, faltando: true, erro: e.message,
                             kcal: 0, p: 0, c: 0, g: 0 }; }
      });
      var t = somar([{ itens: itens }]);
      return { refeicao: r.refeicao, itens: itens, total: t, suspeita: suspeitas.indexOf(iR) >= 0 };
    });
    var consumido = somar(base.lancado);
    var contam = refeicoes.filter(function (r) { return !r.suspeita; });
    var planejado = somar(contam.map(function (r) { return { itens: r.itens }; }));
    var projetado = { temFibra: consumido.temFibra || planejado.temFibra };
    ['kcal', 'p', 'c', 'g', 'fibra'].forEach(function (k) { projetado[k] = consumido[k] + planejado[k]; });
    var meta = base.meta || { kcal: 1570, p: 180, c: 100, g: 50 };
    var dif = {};
    MACROS.forEach(function (k) { dif[k] = projetado[k] - meta[k]; });
    return { refeicoes: refeicoes, consumido: consumido, planejado: planejado, projetado: projetado, meta: meta, dif: dif,
             fibraRef: Math.round((meta.kcal || 1570) * 14 / 1000) };
  }

  // a base mudou desde o rascunho? O que mudou, e quais refeições do rascunho podem já ter sido registradas
  function revisar(rasc, base, alimentos) {
    var agora = partesDaBase(base, alimentos), motivos = [];
    var nomes = { lancado: 'o Grok registrou ou corrigiu refeições', meta: 'a meta do dia mudou',
                  sugestao: 'a sugestão oficial mudou', biblioteca: 'a biblioteca de alimentos mudou' };
    Object.keys(nomes).forEach(function (k) { if (rasc.base[k] !== agora[k]) motivos.push(nomes[k]); });
    var antes = {};
    (rasc.lancados || []).forEach(function (c) { antes[c] = 1; });
    var novos = [], chaves = [];
    (base.lancado || []).forEach(function (r, i) {
      var k = chaveLancado(r, i);
      if (!antes[k]) { novos.push(r); chaves.push(k); }
    });
    var ultimo = -1, semHora = false;
    novos.forEach(function (r) { var h = horario(r); if (h) ultimo = Math.max(ultimo, HORARIOS.indexOf(h)); else semHora = true; });
    var suspeitas = [];
    if (novos.length) {
      rasc.refeicoes.forEach(function (r, i) {
        var h = horario(r), ih = h ? HORARIOS.indexOf(h) : -1;
        // QUALQUER registro novo sem horário reconhecível: qualquer refeição do rascunho pode ser a mesma
        var pode = semHora ? true : (ih >= 0 && ih <= ultimo);
        if (pode && r.itens.length && !mantida(rasc, r.refeicao, chaves)) suspeitas.push(i);
      });
    }
    var faltando = [];
    rasc.refeicoes.forEach(function (r) { r.itens.forEach(function (it) { if (!alimentos[it.alimento]) faltando.push(it.alimento); }); });
    return { mudou: motivos.length > 0, motivos: motivos, novos: novos, chaves: chaves, suspeitas: suspeitas, faltando: faltando, partes: agora };
  }

  // "Não foi registrada, manter" vale só para os registros que a pessoa viu ao decidir: chegou outro
  // registro depois → a refeição volta a ficar em dúvida. (Formato antigo — só o nome — não vale mais.)
  function mantida(rasc, refeicao, chaves) {
    return (rasc.manter || []).some(function (m) {
      return m && typeof m === 'object' && m.refeicao === refeicao && Array.isArray(m.vistos) &&
        chaves.every(function (k) { return m.vistos.indexOf(k) >= 0; });
    });
  }
  function manterRefeicao(rasc, refeicao, chaves) {
    rasc.manter = (rasc.manter || []).filter(function (m) { return !(m && m.refeicao === refeicao); })
      .concat([{ refeicao: refeicao, vistos: chaves.slice() }]);
    return rasc;
  }

  // o usuário revisou: a base atual passa a ser a referência do rascunho (suas edições continuam)
  function aceitarBase(rasc, base, alimentos) {
    rasc.base = partesDaBase(base, alimentos);
    rasc.lancados = (base.lancado || []).map(chaveLancado);
    rasc.manter = [];
    return rasc;
  }

  // ---------------- trocas ----------------

  // gramas de uma quantidade: base em g, ou base em unidade com peso anotado ("1 un (~34 g)"); senão null
  function gramas(al, q) {
    var b = base(al);
    if (b.unidade === 'g') return q;
    var m = /\(\s*~?\s*(\d+(?:[.,]\d+)?)\s*g\s*\)/.exec(String(al.base || ''));
    return m ? q / b.n * parseFloat(m[1].replace(',', '.')) : null;
  }

  // o MESMO alimento cadastrado em formas diferentes (clara por 100 g e por unidade; iogurte por 100 g e
  // por pote): mesmos valores por grama (±2%). Essas formas dividem um teto só, em gramas.
  function equivalentes(alimentos) {
    var ids = Object.keys(alimentos).sort(), perfil = {}, grupo = {};
    ids.forEach(function (a) {
      var al = alimentos[a], g1;
      try { g1 = gramas(al, base(al).n); } catch (e) { g1 = null; }
      if (g1 > 0) perfil[a] = MACROS.map(function (k) { return (Number(al[k]) || 0) / g1; });
    });
    function igual(x, y) {
      return x.every(function (v, k) { return Math.abs(v - y[k]) <= Math.max(0.02 * Math.max(Math.abs(v), Math.abs(y[k])), 0.002); });
    }
    var lista = ids.filter(function (a) { return perfil[a]; });
    lista.forEach(function (a, i) {
      for (var j = 0; j < i; j++) {
        var b = lista[j];
        if (igual(perfil[a], perfil[b])) { grupo[a] = grupo[b] || b; grupo[grupo[a]] = grupo[a]; break; }
      }
    });
    var out = {};
    Object.keys(grupo).forEach(function (a) { (out[grupo[a]] = out[grupo[a]] || []).push(a); });
    Object.keys(out).forEach(function (k) { out[k] = out[k].filter(function (a, i, v) { return v.indexOf(a) === i; }).sort(); });
    return out;   // {chave: [ids...]} só com 2+ formas
  }

  // quanto ainda cabe no PLANEJAMENTO de cada alimento: teto − consumido − planejado nas outras posições.
  // Formas equivalentes (equivalentes()) dividem um teto em gramas: o MAIOR teto entre elas (180 g de clara
  // ou 5 un ≈ 170 g → 180 g no total, somando as duas formas).
  function restantes(ctx, ignorar) {
    var tetos = tetosDoDia(ctx.alimentos, ctx.cfg), ja = consumo(ctx.base.lancado), r = {}, grupos = {};
    ctx.rasc.refeicoes.forEach(function (ref, iR) {
      ref.itens.forEach(function (it, iI) {
        if (ignorar && ignorar(iR, iI)) return;
        ja[it.alimento] = (ja[it.alimento] || 0) + it.quantidade;
      });
    });
    Object.keys(tetos).forEach(function (a) { r[a] = Math.max(0, tetos[a] - (ja[a] || 0)); });
    var eq = ctx._equiv || (ctx._equiv = equivalentes(ctx.alimentos));
    Object.keys(eq).forEach(function (k) {
      var membros = eq[k], tetoG = null, usadoG = 0;
      membros.forEach(function (a) {
        var al = ctx.alimentos[a];
        if (a in tetos) { var tg = gramas(al, tetos[a]); if (tg != null) tetoG = Math.max(tetoG == null ? 0 : tetoG, tg); }
        usadoG += gramas(al, ja[a] || 0) || 0;
      });
      if (tetoG == null) return;
      var sobraG = Math.max(0, tetoG - usadoG);
      membros.forEach(function (a) {
        var al = ctx.alimentos[a], porQ = gramas(al, 1);
        var cabe = porQ > 0 ? sobraG / porQ : 0;
        r[a] = a in r ? Math.min(r[a], cabe) : cabe;
        grupos[a] = { membros: membros, teto_g: tetoG, usado_g: usadoG };
      });
    });
    return { resto: r, tetos: tetos, usado: ja, grupos: grupos };
  }

  // a refeição candidata inteira respeita as regras da sugestão? (tetos do dia somando consumido + outras
  // refeições do rascunho + esta; claras só no jantar; exclusões). Só filtra OFERTAS — edição manual e
  // consumo real continuam livres. Devolve a lista de problemas (vazia = ok).
  function problemasRefeicao(ctx, iR, itens) {
    var ref = ctx.rasc.refeicoes[iR], h = horario(ref), out = [];
    var soJantar = ctx.cfg.so_jantar || [], excl = ctx.rasc.excluidos || [];
    var lim = restantes(ctx, function (a) { return a === iR; }), aqui = {};
    itens.forEach(function (it) {
      if (!(it.quantidade > 0)) return;
      if (!ctx.alimentos[it.alimento]) { out.push(it.alimento + ': fora da biblioteca'); return; }
      if (excl.indexOf(it.alimento) >= 0) out.push(it.alimento + ': excluído neste rascunho');
      if (soJantar.indexOf(it.alimento) >= 0 && h !== 'Jantar') out.push(it.alimento + ': só no jantar');
      aqui[it.alimento] = (aqui[it.alimento] || 0) + it.quantidade;
    });
    Object.keys(aqui).forEach(function (a) {
      if (a in lim.resto && aqui[a] > lim.resto[a] + 1e-9) out.push(a + ': passa do teto de planejamento do dia');
    });
    var porGrupo = {};
    Object.keys(aqui).forEach(function (a) {
      var g = lim.grupos[a];
      if (!g) return;
      var k = g.membros.join('+');
      porGrupo[k] = porGrupo[k] || { g: g, q: 0 };
      porGrupo[k].q += gramas(ctx.alimentos[a], aqui[a]) || 0;
    });
    Object.keys(porGrupo).forEach(function (k) {
      var x = porGrupo[k];
      if (x.g.usado_g + x.q > x.g.teto_g + 1e-6) out.push(k + ': passa do teto do dia somando as formas equivalentes');
    });
    return out;
  }

  function totalDoDia(ctx, trocarRef, novosItens) {
    var t = somar(ctx.base.lancado);
    ctx.rasc.refeicoes.forEach(function (ref, iR) {
      if ((ctx.suspeitas || []).indexOf(iR) >= 0) return;
      var itens = iR === trocarRef ? novosItens : ref.itens;
      itens.forEach(function (it) {
        var al = ctx.alimentos[it.alimento];
        if (!al || !(it.quantidade > 0)) return;
        var v = esperado(al, it.quantidade);
        MACROS.forEach(function (k) { t[k] += v[k]; });
        if (v.fibra != null) { t.fibra += v.fibra; t.temFibra = true; }
      });
    });
    return t;
  }

  function efeito(antes, depois) {
    var d = {};
    MACROS.concat(['fibra']).forEach(function (k) { d[k] = (depois[k] || 0) - (antes[k] || 0); });
    return d;
  }

  function nomeQtd(al, q) { return al.nome + ' ' + textoQtd(al, q); }

  // porção de REFERÊNCIA de cada alimento: mediana do que aparece na sugestão do dia, no que já foi comido e
  // nas refeições favoritas; sem nada, 1 unidade ou 100 g. As trocas variam em volta dela (mesma faixa do
  // sugerir.py: grade), nunca "a quantidade que iguala as calorias" — isso dava 1,2 kg de tomate.
  function porcoesReferencia(ctx) {
    var q = {};
    function add(aid, x) { if (aid && typeof x === 'number' && x > 0) (q[aid] = q[aid] || []).push(x); }
    (ctx.base.sugestao || []).concat(ctx.base.lancado || []).forEach(function (r) {
      (r.itens || []).forEach(function (i) { add(i.alimento, i.quantidade); });
    });
    var favs = (ctx.refs && ctx.refs.refeicoes) || {};
    Object.keys(favs).forEach(function (k) { (favs[k].itens || []).forEach(function (par) { add(par[0], Number(par[1])); }); });
    var med = {};
    Object.keys(q).forEach(function (aid) {
      var v = q[aid].slice().sort(function (a, b) { return a - b; }), n = v.length;
      med[aid] = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
    });
    return med;
  }

  function porcao(ctx, aid) {
    var ref = ctx._porcoes || (ctx._porcoes = porcoesReferencia(ctx));
    if (ref[aid]) return ref[aid];
    var b = base(ctx.alimentos[aid]);
    return b.unidade === 'un' ? 1 : 100;
  }

  // até `limite` alternativas para o item iI da refeição iR, ordenadas pela distância da meta do dia
  // (mesma conta do sugerir.py). Devolve {opcoes, conflitos}: conflitos explica o que ficou de fora.
  function alternativasItem(ctx, iR, iI, limite) {
    limite = limite || 3;
    var ref = ctx.rasc.refeicoes[iR], atual = ref.itens[iI];
    var meta = ctx.base.meta, alAtual = ctx.alimentos[atual.alimento];
    var antes = totalDoDia(ctx);
    var custoAntes = custoMacros(antes, meta);
    var lim = restantes(ctx, function (a, b) { return a === iR && b === iI; });
    var soJantar = ctx.cfg.so_jantar || [], h = horario(ref);
    var excl = ctx.rasc.excluidos || [], conflitos = [], semEspaco = [], opcoes = [];
    var noPrato = {};
    ref.itens.forEach(function (it, k) { if (k !== iI) noPrato[it.alimento] = 1; });
    Object.keys(ctx.alimentos).sort().forEach(function (aid) {
      var al = ctx.alimentos[aid];
      if (aid === atual.alimento || noPrato[aid]) return;
      if (excl.indexOf(aid) >= 0) return;
      if (soJantar.indexOf(aid) >= 0 && h !== 'Jantar') return;
      try { base(al); } catch (e) { return; }
      var tipico = porcao(ctx, aid);
      var teto = aid in lim.resto ? lim.resto[aid] : null;
      var gr = grade(al, tipico, teto).filter(function (q) { return q > 0; });
      if (!gr.length) { semEspaco.push(aid); return; }
      var melhor = null;
      gr.forEach(function (q) {
        var novos = ref.itens.map(function (it, k) { return k === iI ? { alimento: aid, quantidade: q } : it; });
        var t = totalDoDia(ctx, iR, novos), c = custoMacros(t, meta);
        if (!melhor || c < melhor.custo - 1e-9) melhor = { alimento: aid, quantidade: q, custo: c, total: t };
      });
      opcoes.push(melhor);
    });
    opcoes.sort(function (a, b) { return a.custo - b.custo || (a.alimento < b.alimento ? -1 : 1); });
    var nomes = {};   // mesmo alimento cadastrado duas vezes (ex.: iogurte por 100 g e por pote): uma opção só
    opcoes = opcoes.filter(function (o) {
      var n = norm(ctx.alimentos[o.alimento].nome);
      if (nomes[n]) return false;
      nomes[n] = 1;
      return true;
    });
    opcoes = opcoes.slice(0, limite).map(function (o) {
      var al = ctx.alimentos[o.alimento];
      return { alimento: o.alimento, quantidade: o.quantidade, texto: nomeQtd(al, o.quantidade),
               item: item(ctx.alimentos, o.alimento, o.quantidade), total: o.total, efeito: efeito(antes, o.total),
               aproxima: o.custo < custoAntes - 1e-9 };
    });
    if (excl.length) conflitos.push(excl.length + ' alimento(s) excluído(s) por você neste rascunho');
    semEspaco.forEach(function (aid) {
      var al = ctx.alimentos[aid], g = lim.grupos[aid];
      if (g && !(aid in lim.tetos && (lim.usado[aid] || 0) >= lim.tetos[aid])) {
        conflitos.push(al.nome + ': teto do dia já usado somando as formas equivalentes (' + N.ri(g.usado_g) + ' de ' + N.ri(g.teto_g) + ' g entre consumido e outras refeições)');
      } else {
        conflitos.push(al.nome + ': teto de planejamento do dia já usado (' + textoQtd(al, lim.tetos[aid]) + ' — ' +
                       textoQtd(al, lim.usado[aid] || 0) + ' entre consumido e outras refeições)');
      }
    });
    if (h !== 'Jantar') soJantar.forEach(function (aid) { if (ctx.alimentos[aid]) conflitos.push(ctx.alimentos[aid].nome + ': só no jantar'); });
    if (!opcoes.length && !conflitos.length) conflitos.push('não há outro alimento na biblioteca para esta posição');
    return { opcoes: opcoes, conflitos: conflitos, antes: antes };
  }

  // ajusta só as QUANTIDADES dos itens de uma refeição (busca local limitada, determinística)
  function ajustarRefeicao(ctx, iR) {
    var ref = ctx.rasc.refeicoes[iR], meta = ctx.base.meta, h = horario(ref);
    var soJantar = ctx.cfg.so_jantar || [], excl = ctx.rasc.excluidos || [];
    var itens = ref.itens.map(function (it) { return { alimento: it.alimento, quantidade: it.quantidade }; });
    var lim = restantes(ctx, function (a) { return a === iR; }), tetos = [];
    var grades = itens.map(function (it, k) {
      var al = ctx.alimentos[it.alimento];
      if (!al) return [it.quantidade];
      // fora das regras nesta refeição (excluído / só no jantar): a versão ajustada tira o item
      if (excl.indexOf(it.alimento) >= 0 || (soJantar.indexOf(it.alimento) >= 0 && h !== 'Jantar')) return [0];
      // teto deste alimento nesta refeição = resto do dia − o que os OUTROS itens desta refeição já usam
      var outros = 0;
      itens.forEach(function (o, j) { if (j !== k && o.alimento === it.alimento) outros += o.quantidade; });
      var teto = it.alimento in lim.resto ? Math.max(0, lim.resto[it.alimento] - outros) : null;
      tetos[k] = teto;
      var g = grade(al, it.quantidade, teto).filter(function (q) { return q > 0; });
      return g.length ? g : [0];          // não cabe nada: tira (antes mantinha a quantidade original)
    });
    // ponto de partida: a quantidade atual, a não ser que ela já quebre a regra (acima do teto / item a tirar)
    itens.forEach(function (it, k) {
      var quebra = (grades[k].length === 1 && grades[k][0] === 0) || (tetos[k] != null && it.quantidade > tetos[k] + 1e-9);
      if (!quebra || grades[k].indexOf(it.quantidade) >= 0) return;
      it.quantidade = grades[k].reduce(function (m, q) { return Math.abs(q - it.quantidade) < Math.abs(m - it.quantidade) ? q : m; }, grades[k][0]);
    });
    var melhor = custoMacros(totalDoDia(ctx, iR, itens), meta);
    for (var volta = 0; volta < 20; volta++) {
      var mudou = false;
      for (var k = 0; k < itens.length; k++) {
        var atual = itens[k].quantidade;
        for (var j = 0; j < grades[k].length; j++) {
          var q = grades[k][j];
          if (q === atual) continue;
          itens[k].quantidade = q;
          var c = custoMacros(totalDoDia(ctx, iR, itens), meta);
          if (c < melhor - 1e-9) { melhor = c; atual = q; mudou = true; } else itens[k].quantidade = atual;
        }
        itens[k].quantidade = atual;
      }
      if (!mudou) break;
    }
    return itens.filter(function (it) { return it.quantidade > 0; });
  }

  // até `limite` versões da refeição: quantidades ajustadas e a melhor troca de cada item
  function alternativasRefeicao(ctx, iR, limite) {
    limite = limite || 3;
    var ref = ctx.rasc.refeicoes[iR], meta = ctx.base.meta;
    var antes = totalDoDia(ctx), custoAntes = custoMacros(antes, meta), cand = [], vistos = {};
    var barradas = 0;
    function add(rotulo, itens) {
      var chave = JSON.stringify(itens);
      if (!itens.length || vistos[chave] || chave === JSON.stringify(ref.itens.map(function (i) { return { alimento: i.alimento, quantidade: i.quantidade }; }))) return;
      vistos[chave] = 1;
      if (problemasRefeicao(ctx, iR, itens).length) { barradas++; return; }
      var t = totalDoDia(ctx, iR, itens), c = custoMacros(t, meta);
      cand.push({ rotulo: rotulo, itens: itens, total: t, custo: c, efeito: efeito(antes, t), aproxima: c < custoAntes - 1e-9 });
    }
    if (ref.itens.length) add('Ajustar as quantidades', ajustarRefeicao(ctx, iR));
    ref.itens.forEach(function (it, iI) {
      var alt = alternativasItem(ctx, iR, iI, 1).opcoes[0];
      if (!alt) return;
      var al = ctx.alimentos[it.alimento];
      add('Trocar ' + (al ? al.nome : it.alimento) + ' por ' + alt.texto,
          ref.itens.map(function (x, k) { return k === iI ? { alimento: alt.alimento, quantidade: alt.quantidade } : { alimento: x.alimento, quantidade: x.quantidade }; }));
    });
    cand.sort(function (a, b) { return a.custo - b.custo; });
    return { opcoes: cand.slice(0, limite), antes: antes,
             conflitos: cand.length ? [] : ['nenhuma versão diferente desta refeição cabe nas regras (tetos, exclusões, claras só no jantar)' +
               (barradas ? ' — ' + barradas + ' versão(ões) descartada(s) por passar delas' : '')] };
  }

  // refeição pronta (ex.: uma das refeições frequentes do Lucas) no lugar da refeição iR: efeito no dia e se cabe
  // nas MESMAS regras das alternativas (tetos, exclusões, claras só no jantar). Não ajusta nada sozinho.
  function avaliarRefeicao(ctx, iR, itens) {
    var antes = totalDoDia(ctx), t = totalDoDia(ctx, iR, itens), meta = ctx.base.meta;
    return { itens: itens, total: t, efeito: efeito(antes, t), aproxima: custoMacros(t, meta) < custoMacros(antes, meta) - 1e-9,
             problemas: problemasRefeicao(ctx, iR, itens) };
  }

  // ---------------- armazenamento local (por navegador; não sincroniza) ----------------

  function armazem(storage) {
    var ok = false, memoria = {};
    try { var k = '__nutri_teste__'; storage.setItem(k, '1'); storage.removeItem(k); ok = true; } catch (e) { ok = false; }
    return {
      disponivel: ok,
      ler: function (chave) {
        if (!ok) return memoria[chave] || null;
        try { return storage.getItem(chave); } catch (e) { return memoria[chave] || null; }
      },
      gravar: function (chave, valor) {
        memoria[chave] = valor;
        if (!ok) return false;
        try { storage.setItem(chave, valor); return true; } catch (e) { return false; }
      },
      apagar: function (chave) {
        delete memoria[chave];
        if (ok) { try { storage.removeItem(chave); } catch (e) { /* nada */ } }
      },
      chaves: function () {
        if (!ok) return Object.keys(memoria);
        var out = [];
        try { for (var i = 0; i < storage.length; i++) out.push(storage.key(i)); } catch (e) { /* nada */ }
        return out;
      }
    };
  }

  var PREFIXO = 'nutri-plano:';
  function chaveRascunho(dia) { return PREFIXO + dia; }
  // rascunhos de dias que já passaram há mais de 7 dias são apagados (nunca o de hoje/futuro)
  function limparAntigos(arm, hoje) {
    var limite = N.somaDias(hoje, -7);
    arm.chaves().forEach(function (k) {
      if (k && k.indexOf(PREFIXO) === 0 && k.slice(PREFIXO.length) < limite) arm.apagar(k);
    });
  }

  // ---------------- texto para o Grok ----------------

  var DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function linhaMacros(t) {
    return N.ri(t.kcal) + ' kcal | P ' + N.ri(t.p) + ' | C ' + N.ri(t.c) + ' | G ' + N.ri(t.g) +
      (t.temFibra || t.fibra ? ' | fibra ' + N.ri(t.fibra) + ' g' : '');
  }
  function textoGrok(calc, base) {
    var p = base.data.split('-');
    var dow = DIAS_SEMANA[new Date(Date.parse(base.data + 'T12:00:00Z')).getUTCDay()];
    var l = ['PLANEJAMENTO — NÃO CONSUMIDO',
             'Data: ' + p[2] + '/' + p[1] + '/' + p[0] + ' (' + dow + ')',
             'Pedido: revise este plano. NÃO lance nada — só registre quando eu disser que comi.', ''];
    if ((base.lancado || []).length) l.push('Já registrado hoje: ' + linhaMacros(calc.consumido), '');
    l.push('Planejado (não consumido):');
    var algum = false;
    calc.refeicoes.forEach(function (r) {
      if (r.suspeita || !r.itens.length) return;
      algum = true;
      l.push('• ' + r.refeicao + ' — ' + linhaMacros(r.total));
      r.itens.forEach(function (i) {
        l.push('   - ' + (i.faltando ? i.alimento + ' (fora da biblioteca)' : i.nome + ' — ' + i.qtd + ' — ' + N.ri(i.kcal) + ' kcal | P ' + N.ri(i.p) + ' | C ' + N.ri(i.c) + ' | G ' + N.ri(i.g)));
      });
    });
    if (!algum) l.push('• (nenhuma refeição planejada)');
    var m = calc.meta;
    l.push('', 'Total planejado: ' + linhaMacros(calc.planejado),
           'Dia projetado (registrado + planejado): ' + linhaMacros(calc.projetado),
           'Meta: ' + m.kcal + ' kcal | P ' + m.p + ' | C ' + m.c + ' | G ' + m.g,
           'Diferença: ' + MACROS.map(function (k) { var d = N.ri(calc.dif[k]); return (k === 'kcal' ? 'kcal ' : k.toUpperCase() + ' ') + (d > 0 ? '+' : '') + d; }).join(' | '));
    return l.join('\n');
  }

  window.NutriPlano = {
    MACROS: MACROS, HORARIOS: HORARIOS, base: base, lerQuantidade: lerQuantidade, esperado: esperado,
    textoQtd: textoQtd, item: item, somar: somar, norm: norm, horario: horario, config: config,
    tetosDoDia: tetosDoDia, consumo: consumo, grade: grade, custoMacros: custoMacros,
    hash: hash, baseDoDia: baseDoDia, partesDaBase: partesDaBase, rascunhoDaSugestao: rascunhoDaSugestao,
    novoRascunho: novoRascunho, calcular: calcular, revisar: revisar, aceitarBase: aceitarBase,
    restantes: restantes, totalDoDia: totalDoDia, gramas: gramas, equivalentes: equivalentes,
    problemasRefeicao: problemasRefeicao, mantida: mantida, manterRefeicao: manterRefeicao, alternativasItem: alternativasItem, porcao: porcao,
    ajustarRefeicao: ajustarRefeicao, alternativasRefeicao: alternativasRefeicao, avaliarRefeicao: avaliarRefeicao,
    armazem: armazem, chaveRascunho: chaveRascunho, limparAntigos: limparAntigos, textoGrok: textoGrok
  };
})();
