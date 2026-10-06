/* "↻ Repetir hoje" (Hoje e páginas de dia): monta a mensagem para o Grok lançar HOJE os mesmos itens de uma
   refeição já lançada. O site só lê dados/: nada é gravado daqui. Itens da biblioteca viram --item id=Q(unidade)
   (o Grok recalcula pela biblioteca atual); item sem alimento (adição rápida/antigo) vira --manual com os
   valores guardados. */
(function () {
  var N = window.Nutri;
  var HOR = ['Café', 'Almoço', 'Lanche', 'Jantar'];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function horaAgoraLA() {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date()).replace(/^24/, '00');
  }
  function ddmm(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1]; }
  function n1(x) { return N.arred(Number(x) || 0, 1); }

  // unidade do item pelo texto da quantidade ("200 g", "1,5 un", "1 lata")
  function argItem(it) {
    var u = /(g|un|lata)\b/.exec(String(it.qtd || '').toLowerCase());
    if (!it.alimento || !(Number(it.quantidade) > 0) || !u) return null;
    return '--item ' + it.alimento + '=' + String(Number(it.quantidade)) + u[1];
  }
  function argManual(it) {
    var nome = String(it.nome || 'Item').replace(/[="\\]/g, ' ').replace(/\s+/g, ' ').trim();
    var v = [n1(it.kcal), n1(it.p), n1(it.c), n1(it.g)];
    if (it.fibra != null) v.push(n1(it.fibra));
    return '--manual "' + nome + '=' + v.join(',') + '"';
  }

  // descricao (opcional): substitui a linha "Igual ao … de dd/mm" (ex.: refeição frequente)
  function texto(meal, origem, ref, hora, descricao) {
    var hoje = N.hojeLA(), itens = meal.itens || [];
    var t = { kcal: 0, p: 0, c: 0, g: 0 };
    itens.forEach(function (it) { ['kcal', 'p', 'c', 'g'].forEach(function (k) { t[k] += Number(it[k]) || 0; }); });
    var args = itens.map(function (it) { return argItem(it) || argManual(it); });
    var aceitar = itens.some(function (it) {   // item manual antigo com kcal fora de 4/4/9: o registrar pediria --aceitar-kcal
      if (argItem(it)) return false;
      var est = 4 * (+it.p || 0) + 4 * (+it.c || 0) + 9 * (+it.g || 0), k = +it.kcal || 0;
      return Math.abs(k - est) > Math.max(40, 0.25 * Math.max(k, est));
    });
    var lista = itens.map(function (it) { return String(it.nome || '').replace(/\s*\(.*?\)\s*/g, ' ').trim() + ' ' + (it.qtd || ''); }).join(' · ');
    return ['LANÇAR — REPETIR REFEIÇÃO (o Lucas comeu de novo)',
            'Dia: ' + ddmm(hoje) + ' · Refeição: ' + ref + ' · comi às ' + hora,
            (descricao || ('Igual ao ' + (meal.refeicao || 'refeição') + ' de ' + ddmm(origem))) + ': ' + lista,
            'Valores da vez anterior: ' + Math.round(t.kcal) + ' kcal | P ' + Math.round(t.p) + ' | C ' + Math.round(t.c) + ' | G ' + Math.round(t.g) +
              ' (o registrar recalcula pela biblioteca atual)',
            '',
            'Grok: python3 scripts/registrar.py refeicao --evento <id da mensagem>:refeicao:1 --nome ' + ref +
              ' --consumido-em ' + hoje + 'T' + hora + ' ' + args.join(' ') + (aceitar ? ' --aceitar-kcal' : '') + ' --enviar'].join('\n');
  }

  function horarioDe(nome, hora) {
    var n = String(nome || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/cafe/.test(n)) return 'Café';
    if (/almoc/.test(n)) return 'Almoço';
    if (/jantar|ceia/.test(n)) return 'Jantar';
    if (/lanche|doce/.test(n)) return 'Lanche';
    var hh = parseInt(hora, 10);
    return hh < 11 ? 'Café' : hh < 15 ? 'Almoço' : hh < 19 ? 'Lanche' : 'Jantar';
  }

  function abrir(iM) {
    var dia = window.NutriDiaAtual, meal = dia && dia.lancado[iM], painel = document.getElementById('rep-' + iM);
    if (!meal || !painel) return;
    if (!painel.hidden) { painel.hidden = true; return; }
    montar(painel, meal, dia.data);
  }

  // painel reaproveitável (frequentes.js): refeição de hoje + hora + mensagem pronta + compartilhar/copiar
  function montar(painel, meal, origem, descricao) {
    var hora = horaAgoraLA(), ref = horarioDe(meal.refeicao, hora);
    painel.innerHTML = '<div class="add-linha"><label class="add-campo"><span>Refeição de hoje</span><select class="rep-ref">' +
      HOR.map(function (h) { return '<option' + (h === ref ? ' selected' : '') + '>' + h + '</option>'; }).join('') +
      '</select></label><label class="add-campo"><span>Comi às</span><input class="rep-hora" type="time" step="60" value="' + hora + '"></label></div>' +
      '<div class="add-dica">Nada foi lançado ainda: mande ao Grok — ele lança hoje e o Hoje atualiza.</div>' +
      '<textarea class="resumo-texto rep-msg" readonly></textarea><div class="resumo-acoes">' +
      (typeof navigator.share === 'function' ? '<button type="button" class="btn-csv" data-r="share">Compartilhar…</button>' : '') +
      (navigator.clipboard && navigator.clipboard.writeText ? '<button type="button" class="btn-csv" data-r="copiar">Copiar</button>' : '') +
      '<button type="button" class="btn-csv" data-r="sel">Selecionar texto</button></div><div class="resumo-status" role="status"></div>';
    painel.hidden = false;
    var sel = painel.querySelector('.rep-ref'), hr = painel.querySelector('.rep-hora'), ta = painel.querySelector('.rep-msg'), st = painel.querySelector('.resumo-status');
    function atualizar() { ta.value = texto(meal, origem, sel.value, hr.value || horaAgoraLA(), descricao); ta.style.height = Math.min(300, ta.scrollHeight + 4) + 'px'; }
    function selecionar() { ta.focus(); ta.setSelectionRange(0, ta.value.length); try { ta.select(); } catch (e) { /* nada */ } }
    sel.addEventListener('change', atualizar);
    hr.addEventListener('change', atualizar);
    hr.addEventListener('input', atualizar);
    atualizar();
    painel.querySelectorAll('[data-r]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-r');
        if (a === 'share') navigator.share({ text: ta.value }).then(function () { st.textContent = 'Pronto.'; }).catch(function (e) { if (!e || e.name !== 'AbortError') st.textContent = 'Não deu para compartilhar: use Copiar.'; });
        else if (a === 'copiar') navigator.clipboard.writeText(ta.value).then(function () { st.textContent = 'Copiado. Cole no chat do Grok.'; }).catch(function () { selecionar(); st.textContent = 'O navegador bloqueou a cópia: o texto está selecionado — toque em Copiar.'; });
        else { selecionar(); st.textContent = 'Texto selecionado: toque em Copiar.'; }
      });
    });
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.rep-btn');
    if (b) abrir(parseInt(b.getAttribute('data-rep'), 10));
  });

  window.NutriRepetir = { montar: montar, horarioDe: horarioDe };
})();
