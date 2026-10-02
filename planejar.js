/* Página Planejar: rascunho interativo da sugestão (hoje: restante do dia; futuro: prévia/plano padrão).
   Planejamento NUNCA vira consumo: esta página só lê dados/ e grava o rascunho no navegador (localStorage).
   Contas e regras vêm de planejador.js (paridade com o Python testada). */
(function () {
  var N = window.Nutri, P = window.NutriPlano;
  var ri = N.ri;
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  var hoje = N.hojeLA();
  var params = new URLSearchParams(location.search);
  var dia = params.get('d') || hoje;
  var S = { base: null, ali: null, refs: null, cfg: null, rasc: null, rev: null, desfazer: [], arm: null, somenteLeitura: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(v) { return String(v).replace('.', ','); }
  function get(u, opcional) {
    return fetch(u, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) { if (opcional && r.status === 404) return null; throw new Error(u + ' (HTTP ' + r.status + ')'); }
      return r.json();
    });
  }
  function rotuloDia(iso) {
    var p = iso.split('-'), dow = DIAS[new Date(Date.parse(iso + 'T12:00:00Z')).getUTCDay()];
    return parseInt(p[2], 10) + ' ' + MESES[parseInt(p[1], 10) - 1] + ' (' + dow + ')' +
      (iso === hoje ? ' · hoje' : iso === N.somaDias(hoje, 1) ? ' · amanhã' : '');
  }
  function macros(t, cor) {
    return '<b>' + ri(t.kcal) + ' kcal</b> · P' + ri(t.p) + ' · C' + ri(t.c) + ' · G' + ri(t.g) +
      (t.fibra != null && (t.temFibra || t.fibra) ? ' · fibra ' + ri(t.fibra) + ' g' : '');
  }
  function sinal(v) { var x = ri(v); return (x > 0 ? '+' : '') + x; }

  // ---------------- estado ----------------
  function ctx() {
    return { base: S.base, rasc: S.rasc, alimentos: S.ali, cfg: S.cfg, refs: S.refs, suspeitas: S.rev ? S.rev.suspeitas : [] };
  }
  function salvar() {
    var ok = S.arm.gravar(P.chaveRascunho(dia), JSON.stringify(S.rasc));
    if (!ok && S.arm.disponivel) aviso('Não consegui salvar o rascunho neste navegador (armazenamento cheio ou bloqueado). Ele vale até fechar a página.');
  }
  function mudar(fn) {
    S.desfazer.push(JSON.stringify(S.rasc));
    if (S.desfazer.length > 50) S.desfazer.shift();
    fn(S.rasc);
    S.rev = P.revisar(S.rasc, S.base, S.ali);
    salvar();
    render();
  }
  function desfazer() {
    if (!S.desfazer.length) return;
    S.rasc = JSON.parse(S.desfazer.pop());
    S.rev = P.revisar(S.rasc, S.base, S.ali);
    salvar();
    render();
    anunciar('Desfeito.');
  }
  var avisoExtra = '';
  function aviso(t) { avisoExtra = t; renderAvisos(); }
  function anunciar(t) {
    var el = document.getElementById('anuncio');
    if (el) { el.textContent = ''; setTimeout(function () { el.textContent = t; }, 30); }
  }

  // ---------------- render ----------------
  function renderAvisos() {
    var h = '';
    if (!S.arm.disponivel) {
      h += '<div class="pl-aviso">Este navegador não deixa salvar dados (modo privado ou bloqueio): o rascunho é <b>temporário</b> e some ao fechar ou recarregar a página.</div>';
    }
    if (avisoExtra) h += '<div class="pl-aviso">' + esc(avisoExtra) + '</div>';
    if (S.somenteLeitura) h += '<div class="pl-aviso info">' + esc(S.somenteLeitura) + '</div>';
    var rv = S.rev;
    if (rv && !S.somenteLeitura && (rv.mudou || rv.suspeitas.length || rv.faltando.length)) {
      h += '<div class="pl-aviso" id="avisoBase"><b>A base deste rascunho mudou desde que você editou:</b><ul>';
      rv.motivos.forEach(function (m) { h += '<li>' + esc(m) + '</li>'; });
      if (rv.faltando.length) h += '<li>alimento(s) que saíram da biblioteca: ' + esc(rv.faltando.join(', ')) + ' — troque ou remova</li>';
      h += '</ul>';
      if (rv.suspeitas.length) {
        h += '<div style="margin-top:6px">Refeições marcadas abaixo podem já ter sido registradas pelo Grok: <b>ficam fora do total</b> até você decidir (para não contar duas vezes).</div>';
      }
      h += '<div class="pl-acoes"><button type="button" class="pl-btn peq" data-acao="revisado"' + (rv.suspeitas.length ? ' disabled' : '') +
        '>Manter meu rascunho</button><button type="button" class="pl-btn peq" data-acao="usarNova">Usar a sugestão atual</button></div></div>';
    }
    document.getElementById('avisos').innerHTML = h;
  }

  function linhaTab(rotulo, t, cls) {
    return '<tr class="' + (cls || '') + '"><td>' + rotulo + '</td><td>' + ri(t.kcal) + '</td><td>' + ri(t.p) + '</td><td>' + ri(t.c) +
      '</td><td>' + ri(t.g) + '</td><td>' + (t.fibra == null ? '—' : ri(t.fibra)) + '</td></tr>';
  }

  function render() {
    renderAvisos();
    var c = P.calcular(S.rasc, S.base, S.ali, S.rev ? S.rev.suspeitas : []);
    var ro = !!S.somenteLeitura;
    var h = '<section class="hero pl-resumo" aria-labelledby="resumoTit"><h2 id="resumoTit" class="sr">Resumo do dia</h2>' +
      '<table class="pl-tab" id="resumo"><thead><tr><th scope="col"></th><th scope="col">kcal</th><th scope="col">P</th><th scope="col">C</th><th scope="col">G</th><th scope="col">Fibra</th></tr></thead><tbody>';
    h += linhaTab('Já registrado', c.consumido);
    h += linhaTab('Rascunho <span class="badge pl-badge">NÃO LANÇADO</span>', c.planejado);
    h += linhaTab('Dia projetado', c.projetado, 'proj');
    var m = c.meta;
    h += linhaTab('Meta', { kcal: m.kcal, p: m.p, c: m.c, g: m.g, fibra: c.fibraRef }, 'meta');
    h += '<tr><td>Diferença</td>';
    ['kcal', 'p', 'c', 'g'].forEach(function (k) {
      // proteína acima da meta não é excesso (mesma regra do registro: "Passou da meta" ignora P)
      var d = ri(c.dif[k]), cls = d > 0 ? (k === 'p' ? '' : 'acima') : d < 0 ? 'abaixo' : '';
      h += '<td class="' + cls + '">' + (d > 0 ? '+' + d : d) + '</td>';
    });
    h += '<td>' + (c.projetado.temFibra ? sinal(c.projetado.fibra - c.fibraRef) : '—') + '</td></tr></tbody></table>';
    var acima = ['kcal', 'p', 'c', 'g'].filter(function (k) { return ri(c.dif[k]) > 0 && k !== 'p'; });
    h += '<div class="pl-nota">' + (acima.length ? 'Acima da meta: ' + acima.map(function (k) { return (k === 'kcal' ? 'kcal ' : k.toUpperCase() + ' ') + '+' + ri(c.dif[k]); }).join(' · ') + '. ' : '') +
      'Fibra: referência ~' + c.fibraRef + ' g (14 g por 1000 kcal). Já registrado usa os valores guardados nos registros; o rascunho usa a biblioteca atual.</div>';
    if (!ro) {
      h += '<div class="pl-acoes pl-barra"><button type="button" class="pl-btn" data-acao="desfazer"' + (S.desfazer.length ? '' : ' disabled') + '>Desfazer</button>' +
        '<button type="button" class="pl-btn" data-acao="restaurar">Restaurar sugestão</button>' +
        '<button type="button" class="pl-btn prim" data-acao="grok">Levar ao Grok</button></div>';
    }
    h += '</section>';

    c.refeicoes.forEach(function (r, iR) {
      h += '<section class="meal suggest pl-ref' + (r.suspeita ? ' suspeita' : '') + '" aria-label="' + esc(r.refeicao) + '">' +
        '<div class="meal-head"><h3>' + esc(r.refeicao) + '</h3><div class="tot">' + macros(r.total) + '</div></div>';
      if (r.suspeita) {
        h += '<div class="pl-aviso">Pode já ter sido registrada pelo Grok — <b>fora do total</b> por enquanto.' +
          (ro ? '' : '<div class="pl-acoes"><button type="button" class="pl-btn peq" data-acao="tirarRef" data-r="' + iR + '">Tirar do rascunho</button>' +
          '<button type="button" class="pl-btn peq" data-acao="manterRef" data-r="' + iR + '">Não foi registrada, manter</button></div>') + '</div>';
      }
      if (!r.itens.length) h += '<div class="hint">Sem alimentos nesta refeição.</div>';
      r.itens.forEach(function (it, iI) {
        var al = S.ali[it.alimento], b = al ? P.base(al) : null;
        var id = 'q-' + iR + '-' + iI;
        h += '<div class="pl-item"><div class="nome">' + esc(it.faltando ? it.alimento : it.nome) + '</div>';
        if (it.faltando) h += '<div class="falta">Fora da biblioteca — troque ou remova (não entra nas contas)</div>';
        h += '<div class="pl-linha">';
        if (al && !ro) {
          h += '<label class="pl-qtd" for="' + id + '"><span class="sr">Quantidade de ' + esc(it.nome) + ' em ' + (b.unidade === 'g' ? 'gramas' : b.rotulo === 'lata' ? 'latas' : 'unidades') + '</span>' +
            '<input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="' + num(it.quantidade) + '" data-r="' + iR + '" data-i="' + iI + '">' +
            '<span class="un" aria-hidden="true">' + (b.unidade === 'g' ? 'g' : b.rotulo) + '</span></label>';
        } else if (al) {
          h += '<span class="pl-mac">' + esc(it.qtd) + '</span>';
        }
        if (!ro) {
          if (al) h += '<button type="button" class="pl-btn peq" data-acao="trocar" data-r="' + iR + '" data-i="' + iI + '">Trocar</button>';
          h += '<button type="button" class="pl-btn peq" data-acao="remover" data-r="' + iR + '" data-i="' + iI + '" aria-label="Remover ' + esc(it.nome) + '">Remover</button>';
        }
        if (al) h += '<div class="pl-mac">' + macros(it) + '</div>';
        h += '<div class="pl-erro" id="erro-' + id + '" role="alert"></div></div></div>';
      });
      if (!ro) {
        h += '<div class="pl-acoes pl-fim"><button type="button" class="pl-btn peq" data-acao="adicionar" data-r="' + iR + '">+ Alimento</button>' +
          (r.itens.length ? '<button type="button" class="pl-btn peq" data-acao="altRef" data-r="' + iR + '">Alternativas da refeição</button>' : '') +
          '<button type="button" class="pl-btn peq" data-acao="tirarRef" data-r="' + iR + '">Tirar refeição</button></div>';
      }
      h += '</section>';
    });
    if (!ro) {
      var tem = S.rasc.refeicoes.map(function (r) { return r.refeicao; });
      var faltam = P.HORARIOS.filter(function (x) { return tem.indexOf(x) < 0; });
      if (faltam.length) {
        h += '<div class="pl-acoes" style="margin-bottom:12px">' + faltam.map(function (x) {
          return '<button type="button" class="pl-btn peq" data-acao="novaRef" data-nome="' + esc(x) + '">+ ' + esc(x) + '</button>';
        }).join('') + '</div>';
      }
      if ((S.rasc.excluidos || []).length) {
        h += '<div class="pl-excl">Fora das trocas neste rascunho: ' + S.rasc.excluidos.map(function (a) {
          return '<button type="button" class="pl-btn peq" data-acao="voltarExcl" data-a="' + esc(a) + '">' + esc(S.ali[a] ? S.ali[a].nome : a) + ' ↺</button>';
        }).join(' ') + '</div>';
      }
    }
    h += '<div id="anuncio" class="sr" aria-live="polite"></div>';
    document.getElementById('plano').innerHTML = h;
  }

  // ---------------- folha (diálogo) ----------------
  var focoAntes = null;
  function abrirFolha(titulo, html, depois) {
    focoAntes = document.activeElement;
    document.getElementById('folhaTitulo').textContent = titulo;
    document.getElementById('folhaCorpo').innerHTML = html;
    var f = document.getElementById('folha');
    f.hidden = false;
    document.body.style.overflow = 'hidden';
    if (depois) depois();
    var alvo = f.querySelector('[data-foco]') || f.querySelector('button, input, textarea');
    if (alvo) alvo.focus();
  }
  function fecharFolha() {
    var f = document.getElementById('folha');
    if (f.hidden) return;
    f.hidden = true;
    document.body.style.overflow = '';
    if (focoAntes && document.contains(focoAntes)) focoAntes.focus();
  }

  function efeitoHtml(o) {
    var e = o.efeito;
    function d(v, rot) { var x = ri(v); return '<span class="' + (x > 0 ? 'mais' : x < 0 ? 'menos' : '') + '">' + rot + ' ' + (x > 0 ? '+' : '') + x + '</span>'; }
    return d(e.kcal, 'kcal') + ' · ' + d(e.p, 'P') + ' · ' + d(e.c, 'C') + ' · ' + d(e.g, 'G') +
      '<br>Dia fica: ' + ri(o.total.kcal) + ' kcal · P' + ri(o.total.p) + ' · C' + ri(o.total.c) + ' · G' + ri(o.total.g) +
      (o.aproxima ? '' : ' <i>(não aproxima da meta)</i>');
  }

  function abrirTrocas(iR, iI) {
    var it = S.rasc.refeicoes[iR].itens[iI], al = S.ali[it.alimento];
    var a = P.alternativasItem(ctx(), iR, iI, 3);
    var h = '<div class="pl-nota">Hoje: <b>' + esc(al.nome + ' ' + P.textoQtd(al, it.quantidade)) + '</b>. Opções com alimentos da biblioteca, em porções habituais, ordenadas pela distância da meta do dia (mesma conta da sugestão automática). Nada é aplicado sem você tocar.</div>';
    if (!a.opcoes.length) h += '<div class="pl-aviso">Nenhuma alternativa compatível.</div>';
    a.opcoes.forEach(function (o, k) {
      h += '<div class="pl-op"><div class="tit">' + (k + 1) + '. ' + esc(o.texto) + '</div><div class="ef">' + efeitoHtml(o) + '</div>' +
        '<button type="button" class="pl-btn peq prim" data-acao="aplicarTroca" data-r="' + iR + '" data-i="' + iI + '" data-a="' + esc(o.alimento) + '" data-q="' + o.quantidade + '"' + (k ? '' : ' data-foco') + '>Aplicar no rascunho</button></div>';
    });
    if (a.conflitos.length) {
      h += '<div class="pl-nota"><b>Por que não há outras opções:</b><ul>' + a.conflitos.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }
    h += '<div class="pl-acoes pl-fim"><button type="button" class="pl-btn peq" data-acao="excluir" data-a="' + esc(it.alimento) + '">Não sugerir ' + esc(al.nome) + ' neste rascunho</button></div>';
    abrirFolha('Trocar ' + al.nome, h);
  }

  function abrirAltRef(iR) {
    var r = S.rasc.refeicoes[iR], a = P.alternativasRefeicao(ctx(), iR, 3);
    var h = '<div class="pl-nota">Versões de <b>' + esc(r.refeicao) + '</b> calculadas com a biblioteca e as mesmas regras da sugestão automática (tetos do dia, claras só no jantar, exclusões). Nada é aplicado sem você tocar.</div>';
    if (!a.opcoes.length) h += '<div class="pl-aviso">' + esc(a.conflitos.join(' ')) + '</div>';
    a.opcoes.forEach(function (o, k) {
      var desc = o.itens.map(function (x) { var al = S.ali[x.alimento]; return al ? al.nome + ' ' + P.textoQtd(al, x.quantidade) : x.alimento; }).join(' · ');
      h += '<div class="pl-op"><div class="tit">' + (k + 1) + '. ' + esc(o.rotulo) + '</div><div class="ef">' + esc(desc) + '<br>' + efeitoHtml(o) + '</div>' +
        '<button type="button" class="pl-btn peq prim" data-acao="aplicarRef" data-r="' + iR + '" data-k="' + k + '"' + (k ? '' : ' data-foco') + '>Aplicar no rascunho</button></div>';
    });
    S._altRef = a.opcoes;
    abrirFolha('Alternativas · ' + r.refeicao, h);
  }

  function abrirBusca(iR) {
    var h = '<label class="sr" for="busca">Buscar alimento</label><input id="busca" class="pl-busca" type="search" inputmode="search" autocomplete="off" placeholder="Buscar por nome ou apelido" data-foco>' +
      '<ul class="pl-lista" id="resultados"></ul>';
    abrirFolha('Adicionar em ' + S.rasc.refeicoes[iR].refeicao, h, function () {
      var inp = document.getElementById('busca');
      function filtrar() {
        var q = P.norm(inp.value).trim();
        var ids = Object.keys(S.ali).filter(function (aid) {
          var al = S.ali[aid];
          if (!q) return true;
          return [al.nome, aid].concat(al.apelidos || []).some(function (t) { return P.norm(t).indexOf(q) >= 0; });
        }).sort(function (a, b) { return P.norm(S.ali[a].nome) < P.norm(S.ali[b].nome) ? -1 : 1; });
        document.getElementById('resultados').innerHTML = ids.length ? ids.map(function (aid) {
          var al = S.ali[aid], b = P.base(al);
          return '<li><button type="button" data-acao="escolher" data-r="' + iR + '" data-a="' + esc(aid) + '">' + esc(al.nome) +
            '<span class="sub">base ' + esc(al.base) + ' · ' + ri(al.kcal) + ' kcal · P' + num(al.p) + ' · C' + num(al.c) + ' · G' + num(al.g) +
            ' · medido em ' + (b.unidade === 'g' ? 'gramas' : b.rotulo === 'lata' ? 'latas' : 'unidades') + '</span></button></li>';
        }).join('') : '<li class="pl-nota">Nada encontrado. Alimento novo precisa ser cadastrado pelo Grok antes.</li>';
      }
      inp.addEventListener('input', filtrar);
      filtrar();
    });
  }

  function abrirGrok() {
    var c = P.calcular(S.rasc, S.base, S.ali, S.rev ? S.rev.suspeitas : []);
    var txt = P.textoGrok(c, S.base);
    var podeShare = typeof navigator.share === 'function';
    var podeCopiar = !!(navigator.clipboard && navigator.clipboard.writeText);
    var h = '<div class="pl-nota">Só prepara o texto: nada é enviado sozinho e nada é lançado. Cole no chat do Grok para ele revisar.</div>' +
      '<label class="sr" for="textoGrok">Texto do plano</label><textarea id="textoGrok" class="pl-texto" readonly>' + esc(txt) + '</textarea>' +
      '<div class="pl-acoes pl-fim">' +
      (podeShare ? '<button type="button" class="pl-btn prim" data-acao="compartilhar" data-foco>Compartilhar…</button>' : '') +
      (podeCopiar ? '<button type="button" class="pl-btn' + (podeShare ? '' : ' prim') + '" data-acao="copiar"' + (podeShare ? '' : ' data-foco') + '>Copiar</button>' : '') +
      '<button type="button" class="pl-btn" data-acao="selecionar"' + (podeShare || podeCopiar ? '' : ' data-foco') + '>Selecionar texto</button></div>' +
      '<div class="pl-status" id="statusGrok" role="status"></div>';
    abrirFolha('Levar ao Grok', h);
    if (!podeShare && !podeCopiar) document.getElementById('statusGrok').textContent = 'Este navegador não permite copiar automaticamente: toque em "Selecionar texto" e depois em Copiar.';
  }
  function selecionarTexto() {
    var t = document.getElementById('textoGrok');
    t.focus();
    t.setSelectionRange(0, t.value.length);
    try { t.select(); } catch (e) { /* nada */ }
  }

  // ---------------- ações ----------------
  function acao(btn) {
    var a = btn.getAttribute('data-acao');
    var iR = parseInt(btn.getAttribute('data-r'), 10), iI = parseInt(btn.getAttribute('data-i'), 10);
    if (a === 'desfazer') return desfazer();
    if (a === 'restaurar') {
      mudar(function (r) { var n = P.novoRascunho(S.base, S.ali); r.refeicoes = n.refeicoes; r.manter = []; P.aceitarBase(r, S.base, S.ali); });
      return anunciar('Sugestão original restaurada (dá para desfazer).');
    }
    if (a === 'grok') return abrirGrok();
    if (a === 'remover') return mudar(function (r) { r.refeicoes[iR].itens.splice(iI, 1); });
    if (a === 'trocar') return abrirTrocas(iR, iI);
    if (a === 'adicionar') return abrirBusca(iR);
    if (a === 'altRef') return abrirAltRef(iR);
    if (a === 'tirarRef') { mudar(function (r) { r.refeicoes.splice(iR, 1); }); return anunciar('Refeição tirada do rascunho.'); }
    if (a === 'manterRef') return mudar(function (r) { var n = r.refeicoes[iR].refeicao; r.manter = (r.manter || []).concat([n]); });
    if (a === 'novaRef') {
      var nome = btn.getAttribute('data-nome');
      return mudar(function (r) {
        r.refeicoes.push({ refeicao: nome, itens: [] });
        r.refeicoes.sort(function (x, y) { return P.HORARIOS.indexOf(x.refeicao) - P.HORARIOS.indexOf(y.refeicao); });
      });
    }
    if (a === 'voltarExcl') { var ex = btn.getAttribute('data-a'); return mudar(function (r) { r.excluidos = r.excluidos.filter(function (x) { return x !== ex; }); }); }
    if (a === 'revisado') { mudar(function (r) { P.aceitarBase(r, S.base, S.ali); }); return anunciar('Rascunho mantido com a base atual.'); }
    if (a === 'usarNova') {
      mudar(function (r) { var n = P.novoRascunho(S.base, S.ali); Object.keys(n).forEach(function (k) { r[k] = n[k]; }); });
      return anunciar('Rascunho trocado pela sugestão atual (dá para desfazer).');
    }
    if (a === 'aplicarTroca') {
      var aid = btn.getAttribute('data-a'), q = parseFloat(btn.getAttribute('data-q'));
      fecharFolha();
      mudar(function (r) { r.refeicoes[iR].itens[iI] = { alimento: aid, quantidade: q }; });
      return anunciar('Troca aplicada no rascunho.');
    }
    if (a === 'aplicarRef') {
      var o = S._altRef[parseInt(btn.getAttribute('data-k'), 10)];
      fecharFolha();
      mudar(function (r) { r.refeicoes[iR].itens = o.itens.map(function (x) { return { alimento: x.alimento, quantidade: x.quantidade }; }); });
      return anunciar('Refeição alterada no rascunho.');
    }
    if (a === 'escolher') {
      var novo = btn.getAttribute('data-a');
      var qref = P.porcao ? P.porcao(ctx(), novo) : 1;
      fecharFolha();
      mudar(function (r) { r.refeicoes[iR].itens.push({ alimento: novo, quantidade: qref }); });
      return anunciar(S.ali[novo].nome + ' adicionado. Ajuste a quantidade.');
    }
    if (a === 'excluir') {
      var exa = btn.getAttribute('data-a');
      fecharFolha();
      mudar(function (r) { if (r.excluidos.indexOf(exa) < 0) r.excluidos.push(exa); });
      return anunciar(S.ali[exa].nome + ' não aparece mais nas trocas deste rascunho.');
    }
    if (a === 'compartilhar') {
      var txt = document.getElementById('textoGrok').value;
      navigator.share({ text: txt }).then(function () {
        document.getElementById('statusGrok').textContent = 'Pronto. Nada foi lançado.';
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        document.getElementById('statusGrok').textContent = 'Não deu para compartilhar: use Copiar ou Selecionar texto.';
      });
      return;
    }
    if (a === 'copiar') {
      navigator.clipboard.writeText(document.getElementById('textoGrok').value).then(function () {
        document.getElementById('statusGrok').textContent = 'Copiado. Cole no chat do Grok.';
      }).catch(function () {
        selecionarTexto();
        document.getElementById('statusGrok').textContent = 'O navegador bloqueou a cópia automática: o texto está selecionado — toque em Copiar.';
      });
      return;
    }
    if (a === 'selecionar') {
      selecionarTexto();
      document.getElementById('statusGrok').textContent = 'Texto selecionado: toque em Copiar.';
    }
  }

  function quantidade(inp) {
    var iR = parseInt(inp.getAttribute('data-r'), 10), iI = parseInt(inp.getAttribute('data-i'), 10);
    var it = S.rasc.refeicoes[iR] && S.rasc.refeicoes[iR].itens[iI];
    if (!it) return;
    var al = S.ali[it.alimento], erro = document.getElementById('erro-' + inp.id);
    try {
      var q = P.lerQuantidade(inp.value, P.base(al).unidade);
      if (q > 100000) throw new Error('Quantidade grande demais');
      inp.removeAttribute('aria-invalid');
      if (erro) erro.textContent = '';
      if (q === it.quantidade) return;
      var foco = inp.id;
      mudar(function (r) { r.refeicoes[iR].itens[iI].quantidade = q; });
      var el = document.getElementById(foco);
      if (el && document.activeElement === document.body) el.focus();
    } catch (e) {
      inp.setAttribute('aria-invalid', 'true');
      if (erro) erro.textContent = e.message + ' — mantive ' + num(it.quantidade) + '.';
    }
  }

  document.addEventListener('click', function (ev) {
    var f = ev.target.closest('[data-fechar]');
    if (f) return fecharFolha();
    var b = ev.target.closest('[data-acao]');
    if (b && !b.disabled) acao(b);
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.matches && ev.target.matches('.pl-qtd input')) quantidade(ev.target);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') fecharFolha();
    if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.pl-qtd input')) { ev.preventDefault(); quantidade(ev.target); }
  });

  // ---------------- carregar ----------------
  function erro(msg) { document.getElementById('plano').innerHTML = '<div class="load-error">' + esc(msg) + '</div>'; }

  function iniciar() {
    var storage = null;
    try { storage = window.localStorage; } catch (e) { storage = null; }
    S.arm = P.armazem(storage || { setItem: function () { throw new Error('sem armazenamento'); } });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return erro('Data inválida no endereço.');
    document.getElementById('pageDate').textContent = rotuloDia(dia);
    if (dia === N.somaDias(hoje, 1)) document.title = 'Planejar amanhã · Nutrição';

    Promise.all([get('dados/alimentos.json'), get('dados/refeicoes.json'), get('dados/' + dia + '.json', true),
                 get('dados/previa.json', true), get('dados/objetivo.json', true)]).then(function (res) {
      var ali = {};
      Object.keys(res[0]).forEach(function (k) { if (k.charAt(0) !== '_') ali[k] = res[0][k]; });
      S.ali = ali; S.refs = res[1]; S.cfg = P.config(res[1]);
      var metas = (res[4] && res[4].atual && res[4].atual.metas) || { kcal: 1570, p: 180, c: 100, g: 50 };
      metas = { kcal: metas.kcal, p: metas.p, c: metas.c, g: metas.g };
      var padrao = { meta: metas, sugestao: (S.refs.plano_padrao || []).map(function (rid) {
        var r = S.refs.refeicoes[rid];
        return { refeicao: r.nome, itens: r.itens.filter(function (par) { return ali[par[0]]; }).map(function (par) { return P.item(ali, par[0], par[1]); }) };
      }) };
      S.base = P.baseDoDia(dia, res[2], res[3], padrao);
      if (dia < hoje) S.somenteLeitura = 'Este dia já passou: o planejador mostra o rascunho só para consulta.';
      else if (S.base.fechado) S.somenteLeitura = 'Este dia está fechado: nada a planejar.';
      P.limparAntigos(S.arm, hoje);
      var salvo = S.arm.ler(P.chaveRascunho(dia)), r = null;
      if (salvo) { try { r = JSON.parse(salvo); } catch (e) { r = null; } }
      if (!r || r.v !== 1 || r.data !== dia || !Array.isArray(r.refeicoes)) r = P.novoRascunho(S.base, S.ali);
      S.rasc = r;
      S.rev = P.revisar(S.rasc, S.base, S.ali);
      if (!salvo) salvar();
      var nota = document.getElementById('footer');
      nota.textContent = (S.base.fonte === 'dia' ? (S.base.lancado.length ? 'Base: o que falta de hoje (sugestão oficial do dia).' : 'Base: sugestão oficial do dia.')
        : S.base.fonte === 'previa' ? 'Base: prévia da sugestão de amanhã (vira oficial à meia-noite).' : 'Base: plano padrão (ainda sem sugestão automática para este dia).') +
        ' O rascunho fica só neste navegador (não sincroniza entre aparelhos) e nunca conta como consumo.';
      render();
    }).catch(function (e) { erro('Não consegui carregar os dados: ' + e.message); });
  }

  iniciar();
})();
