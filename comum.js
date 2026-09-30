/* Funções compartilhadas pelas páginas (carregar antes dos outros scripts).
   - arred: "meio para longe do zero", igual ao Python (scripts/comum.py): 176,5 → 177; −0,5 → −1.
   - hojeLA: a data de hoje no fuso de Los Angeles (não o do aparelho).
   - semana: definição única de semana do objetivo (semana 1 = 7 dias a partir do início). */
(function () {
  function arred(x, casas) {
    var n = Number(x);
    if (!isFinite(n)) return 0;
    var f = Math.pow(10, casas || 0);
    var v = Math.abs(n) * f;
    // corrige o erro binário (0,15 × 10 = 1,4999…) antes de arredondar
    v = Math.round(Number(v.toPrecision(12)));
    return (n < 0 ? -v : v) / f || 0;
  }
  function ri(x) { return arred(x, 0); }

  var fmtLA = null;
  try {
    fmtLA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) { fmtLA = null; }
  function hojeLA(agora) {
    var d = agora || new Date();
    if (fmtLA) {
      var p = {};
      fmtLA.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      if (p.year && p.month && p.day) return p.year + '-' + p.month + '-' + p.day;
    }
    // sem Intl: aproximação pelo aparelho
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // datas 'AAAA-MM-DD' tratadas como dias de calendário (UTC puro: sem horário de verão)
  function somaDias(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

  // semana do objetivo que contém o dia d: {n, ini, fim, pesagem} — fim = último dia da semana,
  // pesagem = manhã seguinte (a que mostra o efeito dos 7 dias)
  function semana(inicio, dataAlvo, d) {
    var tot = diasEntre(inicio, dataAlvo);
    var k = Math.max(0, Math.min(tot, diasEntre(inicio, d)));
    var n = Math.floor(k / 7) + 1;
    var ini = somaDias(inicio, 7 * (n - 1));
    var fim = somaDias(inicio, Math.min(7 * n - 1, tot));
    var pesagem = somaDias(inicio, Math.min(7 * n, tot));
    return { n: n, ini: ini, fim: fim, pesagem: pesagem, total: Math.max(1, Math.ceil((tot + 1) / 7)) };
  }

  window.Nutri = { arred: arred, ri: ri, hojeLA: hojeLA, somaDias: somaDias, diasEntre: diasEntre, semana: semana };
})();
