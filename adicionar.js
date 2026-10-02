/* Tela Hoje: "+ Adicionar do rótulo" (como o Quick Add / Create Food do MyFitnessPal).
   O Lucas digita o que leu no rótulo; a página faz a conta e monta a mensagem para o Grok, que lança com
   registrar.py --manual (o site só lê dados/: nada é gravado daqui, nenhuma chave no navegador). */
(function () {
  var N = window.Nutri;
  var box = document.getElementById('adicionar');
  if (!box || !document.body.hasAttribute('data-dia')) return;
  var dia = document.body.getAttribute('data-dia');
  var HOR = ['Café', 'Almoço', 'Lanche', 'Jantar'];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // número digitado: vírgula ou ponto; vazio = null; inválido/negativo = NaN
  function num(v) {
    var t = String(v == null ? '' : v).trim().replace(',', '.');
    if (!t) return null;
    var x = Number(t);
    return isFinite(x) && x >= 0 ? x : NaN;
  }
  function r1(x) { return N.arred(x, 1); }
  function txt(x) { return String(r1(x)).replace('.', ','); }
  function horaAgoraLA() {
    var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    return p.replace(/^24/, '00');
  }
  function refeicaoPelaHora(h) { var hh = parseInt(h, 10); return hh < 11 ? 'Café' : hh < 15 ? 'Almoço' : hh < 19 ? 'Lanche' : 'Jantar'; }

  function campo(id, rotulo, extra) {
    return '<label class="add-campo"><span>' + rotulo + '</span><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off"' + (extra || '') + '></label>';
  }

  var hora0 = horaAgoraLA();
  box.innerHTML = '<details class="add-card" id="addCard"><summary>+ Adicionar do rótulo <span>(como o Quick Add do MyFitnessPal)</span></summary>' +
    '<div class="add-corpo">' +
    '<div class="add-linha"><label class="add-campo"><span>Refeição</span><select id="addRef">' +
    HOR.map(function (h) { return '<option' + (h === refeicaoPelaHora(hora0) ? ' selected' : '') + '>' + h + '</option>'; }).join('') +
    '</select></label><label class="add-campo"><span>Comi às</span><input id="addHora" type="time" step="60" value="' + hora0 + '"></label></div>' +
    '<label class="add-campo add-nome"><span>Nome</span><input id="addNome" type="text" autocomplete="off" maxlength="60" placeholder="ex.: Barra Quest Cookies & Cream"></label>' +
    '<div class="add-modo" role="group" aria-label="Como ler o rótulo">' +
    '<button type="button" data-modo="total" aria-pressed="true">Totais que comi</button>' +
    '<button type="button" data-modo="porcao" aria-pressed="false">Por porção do rótulo</button></div>' +
    '<div id="addPorcao" hidden><div class="add-linha">' +
    '<label class="add-campo"><span>Porção do rótulo</span><input id="addBase" type="text" autocomplete="off" placeholder="ex.: 40 g ou 1 un"></label>' +
    campo('addQtd', 'Quanto comi', ' placeholder="ex.: 60 g ou 1,5"') + '</div>' +
    '<div class="add-dica">"Quanto comi": em gramas (60 g) se a porção tem gramas, ou nº de porções (1,5).</div></div>' +
    '<div class="add-dica" id="addTitulo">Valores <b>totais</b> do que você comeu:</div>' +
    '<div class="add-linha add-macros">' + campo('addKcal', 'kcal', ' placeholder="auto"') + campo('addP', 'Proteína g') +
    campo('addC', 'Carbo g') + campo('addG', 'Gordura g') + campo('addF', 'Fibra g', ' placeholder="opc."') + '</div>' +
    '<label class="add-check" id="addSalvarL" hidden><input id="addSalvar" type="checkbox"> Salvar na biblioteca (da próxima vez é só dizer "60 g de …")</label>' +
    '<div class="add-res" id="addRes" role="status"></div>' +
    '<button type="button" class="btn-csv" id="addEnviar" disabled>Enviar ao Grok</button>' +
    '<div id="addTexto" hidden></div>' +
    '</div></details>';

  var modo = 'total';
  var $ = function (id) { return document.getElementById(id); };

  // porção do rótulo: "40 g", "40g", "1 un", "1 lata", "2 fatias (56 g)"
  function lerBase(orig) {
    var t = String(orig || '').trim().toLowerCase().replace(',', '.');
    var mg = /(\d+(?:\.\d+)?)\s*g\b/.exec(t), mn = /^(\d+(?:\.\d+)?)/.exec(t);
    if (!mn && !mg) return null;
    return { n: mn ? Number(mn[1]) : 1, gramas: mg ? Number(mg[1]) : null, texto: String(orig).trim() };
  }
  // quanto comi: "60 g" (precisa porção com gramas) ou "1,5" porções
  function fator(base, qtdTxt) {
    var t = String(qtdTxt || '').trim().toLowerCase().replace(',', '.');
    if (!t) return { f: 1, desc: '1 porção' };
    var mg = /^(\d+(?:\.\d+)?)\s*g$/.exec(t);
    if (mg) {
      if (!base.gramas) return { erro: 'para "quanto comi" em gramas, a porção do rótulo precisa ter gramas (ex.: 40 g)' };
      return { f: Number(mg[1]) / base.gramas, desc: txt(Number(mg[1])) + ' g' };
    }
    var x = num(t);
    if (x == null || isNaN(x) || x <= 0) return { erro: '"quanto comi": use gramas (60 g) ou nº de porções (1,5)' };
    return { f: x, desc: txt(x) + ' porç' + (x === 1 ? 'ão' : 'ões') };
  }

  function calcular() {
    var v = { kcal: num($('addKcal').value), p: num($('addP').value), c: num($('addC').value), g: num($('addG').value), fibra: num($('addF').value) };
    var erros = [];
    ['kcal', 'p', 'c', 'g', 'fibra'].forEach(function (k) { if (isNaN(v[k])) erros.push('número inválido em ' + ({ kcal: 'kcal', p: 'proteína', c: 'carbo', g: 'gordura', fibra: 'fibra' })[k]); });
    if (erros.length) return { erros: erros };
    if (v.p == null || v.c == null || v.g == null) return { erros: ['preencha proteína, carbo e gordura (0 se não tiver)'] };
    var est = 4 * v.p + 4 * v.c + 9 * v.g, aviso = '';
    if (v.kcal == null) v.kcal = est;
    else if (Math.abs(v.kcal - est) > Math.max(40, 0.25 * Math.max(v.kcal, est))) {
      return { erros: [txt(v.kcal) + ' kcal não bate com os macros (4×P + 4×C + 9×G ≈ ' + Math.round(est) + '). Confira o rótulo — se for bebida alcoólica ou tiver polióis, avise o Grok.'] };
    }
    if (v.kcal <= 0) return { erros: ['tudo zero'] };
    var porPorcao = null, desc = '';
    if (modo === 'porcao') {
      var base = lerBase($('addBase').value);
      if (!base) return { erros: ['escreva a porção do rótulo (ex.: 40 g ou 1 un)'] };
      var fq = fator(base, $('addQtd').value);
      if (fq.erro) return { erros: [fq.erro] };
      porPorcao = { base: base, v: v };
      desc = fq.desc;
      v = { kcal: v.kcal * fq.f, p: v.p * fq.f, c: v.c * fq.f, g: v.g * fq.f, fibra: v.fibra == null ? null : v.fibra * fq.f };
    }
    if (v.kcal > 3000 || Math.max(v.p, v.c, v.g) > 300) return { erros: ['valores grandes demais para um item — confira'] };
    return { v: v, porPorcao: porPorcao, desc: desc, aviso: aviso };
  }

  function linhaMacros(v) {
    return Math.round(v.kcal) + ' kcal | P ' + txt(v.p) + ' | C ' + txt(v.c) + ' | G ' + txt(v.g) + (v.fibra != null ? ' | fibra ' + txt(v.fibra) : '');
  }
  function nomeLimpo() { return ($('addNome').value || '').replace(/[="\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Adição rápida'; }

  function textoGrok(r) {
    var nome = nomeLimpo(), hora = $('addHora').value || horaAgoraLA(), ref = $('addRef').value;
    var item = nome + (r.desc ? ' (' + r.desc + ')' : '');
    var v = r.v, nums = [r1(v.kcal), r1(v.p), r1(v.c), r1(v.g)].concat(v.fibra != null ? [r1(v.fibra)] : []).join(',');
    var p = dia.split('-');
    var l = ['LANÇAR — ADIÇÃO RÁPIDA (lido do rótulo pelo Lucas)',
             'Dia: ' + p[2] + '/' + p[1] + ' · Refeição: ' + ref + ' · comi às ' + hora,
             item + ': ' + linhaMacros(v),
             '',
             'Grok: python3 scripts/registrar.py refeicao --evento <id da mensagem>:refeicao:1 --nome ' + ref +
             ' --consumido-em ' + dia + 'T' + hora + ' --manual "' + item + '=' + nums + '" --enviar'];
    if (r.porPorcao && $('addSalvar').checked) {
      var pv = r.porPorcao.v;
      l.push('', 'SALVAR NA BIBLIOTECA (fonte: rótulo): ' + nome + ' · base ' + r.porPorcao.base.texto + ' · por porção: ' + linhaMacros(pv),
             'Grok: incluir em dados/alimentos.json com fonte "rotulo" (base em g se o rótulo tiver gramas).');
    }
    return l.join('\n');
  }

  function atualizar() {
    var r = calcular(), res = $('addRes');
    $('addTexto').hidden = true;
    if (r.erros) {
      var vazio = !['addKcal', 'addP', 'addC', 'addG'].some(function (id) { return $(id).value.trim(); });
      res.className = 'add-res' + (vazio ? '' : ' erro');
      res.textContent = vazio ? '' : r.erros[0];
      $('addEnviar').disabled = true;
      return;
    }
    res.className = 'add-res ok';
    res.textContent = 'Vai lançar: ' + linhaMacros(r.v) + (r.desc ? ' (' + r.desc + ')' : '') + (($('addKcal').value || '').trim() ? '' : ' · kcal calculada pelos macros');
    $('addEnviar').disabled = false;
  }

  function mostrarTexto() {
    var r = calcular();
    if (r.erros) return atualizar();
    var t = textoGrok(r), alvo = $('addTexto');
    var podeShare = typeof navigator.share === 'function', podeCopiar = !!(navigator.clipboard && navigator.clipboard.writeText);
    alvo.innerHTML = '<div class="add-dica">Nada foi lançado ainda: mande este texto ao Grok — ele lança e o Hoje atualiza.</div>' +
      '<textarea id="addMsg" class="resumo-texto" readonly>' + esc(t) + '</textarea><div class="resumo-acoes">' +
      (podeShare ? '<button type="button" class="btn-csv" data-a="share">Compartilhar…</button>' : '') +
      (podeCopiar ? '<button type="button" class="btn-csv" data-a="copiar">Copiar</button>' : '') +
      '<button type="button" class="btn-csv" data-a="sel">Selecionar texto</button></div><div class="resumo-status" id="addStatus" role="status"></div>';
    alvo.hidden = false;
    var ta = $('addMsg'), st = $('addStatus');
    ta.style.height = Math.min(320, ta.scrollHeight + 4) + 'px';
    function sel() { ta.focus(); ta.setSelectionRange(0, ta.value.length); try { ta.select(); } catch (e) { /* nada */ } }
    alvo.querySelectorAll('[data-a]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-a');
        if (a === 'share') navigator.share({ text: ta.value }).then(function () { st.textContent = 'Pronto.'; }).catch(function (e) { if (!e || e.name !== 'AbortError') st.textContent = 'Não deu para compartilhar: use Copiar.'; });
        else if (a === 'copiar') navigator.clipboard.writeText(ta.value).then(function () { st.textContent = 'Copiado. Cole no chat do Grok.'; }).catch(function () { sel(); st.textContent = 'O navegador bloqueou a cópia: o texto está selecionado — toque em Copiar.'; });
        else { sel(); st.textContent = 'Texto selecionado: toque em Copiar.'; }
      });
    });
  }

  box.addEventListener('input', atualizar);
  box.addEventListener('change', atualizar);
  box.querySelectorAll('[data-modo]').forEach(function (b) {
    b.addEventListener('click', function () {
      modo = b.getAttribute('data-modo');
      box.querySelectorAll('[data-modo]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      $('addPorcao').hidden = modo !== 'porcao';
      $('addSalvarL').hidden = modo !== 'porcao';
      $('addTitulo').innerHTML = modo === 'porcao' ? 'Valores <b>por porção</b> (como está no rótulo):' : 'Valores <b>totais</b> do que você comeu:';
      atualizar();
    });
  });
  $('addEnviar').addEventListener('click', mostrarTexto);

  window.NutriAdicionar = { lerBase: lerBase, fator: fator };   // para testes
})();
