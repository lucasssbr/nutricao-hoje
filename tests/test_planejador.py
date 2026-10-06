"""Planejador (planejador.js): mesmas contas e regras do Python — paridade rodando o JS real no Node.

Se divergir, o planejador mostraria números diferentes do registro/sugestão oficiais (proibido)."""
import json
import random
import shutil
import subprocess
import sys
import unittest

from base import RAIZ, CopiaRepo

sys.path.insert(0, str(RAIZ / "scripts"))
import sugerir  # noqa: E402
from comum import ler_json  # noqa: E402
from item import base_de, esperado, ler_quantidade  # noqa: E402

NODE = shutil.which("node")


def js(expr_por_caso, casos):
    """Roda planejador.js no Node e devolve [resultado por caso]; erro do JS vira {"erro": msg}."""
    codigo = (
        "const vm=require('vm'),fs=require('fs');"
        "const ctx={window:{},Intl,Date,Math,Number,String,isFinite,JSON,console,Object,Array,parseFloat,parseInt,Error};"
        "vm.createContext(ctx);"
        f"for(const f of ['comum.js','planejador.js'])vm.runInContext(fs.readFileSync({json.dumps(str(RAIZ))}+'/'+f,'utf8'),ctx);"
        f"const P=ctx.window.NutriPlano;const casos={json.dumps(casos)};"
        f"console.log(JSON.stringify(casos.map(c=>{{try{{return {expr_por_caso};}}catch(e){{return {{erro:String(e.message)}};}}}})));"
    )
    return json.loads(subprocess.check_output([NODE, "-"], input=codigo, text=True))   # stdin: sem limite de argv


@unittest.skipUnless(NODE, "node não instalado")
class Paridade(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ali = {k: v for k, v in ler_json(RAIZ / "dados" / "alimentos.json").items() if not k.startswith("_")}
        cls.refs = ler_json(RAIZ / "dados" / "refeicoes.json")

    def test_valores_de_cada_alimento_iguais_ao_python(self):
        rnd = random.Random(7)
        casos = []
        for aid, al in self.ali.items():
            un, n = base_de(al)
            qs = [1, 2, 3, 0.5, 1.5, 7, 13] if un == "un" else [1, 5, 10, 33, 50, 99.5, 100, 125, 150, 175, 199, 250, 333, 1000]
            qs += [round(rnd.uniform(0.1, 600), rnd.choice([0, 1, 2])) for _ in range(25)]
            for q in qs:
                if q > 0:
                    casos.append({"al": al, "q": q, "aid": aid})
        saida = js("P.esperado(c.al, c.q)", casos)
        for c, v in zip(casos, saida):
            self.assertEqual(v, esperado(c["al"], c["q"]), f"{c['aid']} × {c['q']}")

    def test_leitura_de_quantidade(self):
        textos = ["200", "200g", "200 g", "1,5", "1.5", "2un", "1lata", "0", "-3", "abc", "", "1,5g", " 7 ", "2 lata", "3g"]
        for un in ("g", "un"):
            saida = js("P.lerQuantidade(c.t, c.u)", [{"t": t, "u": un} for t in textos])
            for t, v in zip(textos, saida):
                try:
                    py = ler_quantidade(t, un)
                except ValueError:
                    py = None
                if py is None:
                    self.assertIn("erro", v, f"{t!r}/{un}: o JS aceitou, o Python recusa")
                else:
                    self.assertEqual(v, py, f"{t!r}/{un}")

    def test_regras_iguais_ao_sugerir(self):
        cfg = sugerir.config(self.refs)
        # tetos do dia
        self.assertEqual(js("P.tetosDoDia(c.ali, P.config(c.refs))", [{"ali": self.ali, "refs": self.refs}])[0],
                         sugerir.tetos_do_dia(self.ali, cfg))
        # grade (inclui teto decimal, teto zero e porções variadas)
        casos = []
        for aid, al in self.ali.items():
            for tip in (1, 2, 3, 50, 100, 150, 200, 280, 300, 450, 750):
                for teto in (None, 0, 1, 2.5, 3.0, 120, 200.0, 75):
                    casos.append({"al": al, "t": tip, "teto": teto, "aid": aid})
        for c, v in zip(casos, js("P.grade(c.al, c.t, c.teto)", casos)):
            self.assertEqual(v, sugerir.grade(c["al"], c["t"], c["teto"]), f"{c['aid']} tip={c['t']} teto={c['teto']}")
        # horário pelo nome / hora
        refs = [{"refeicao": n, "consumido_em": h} for n in ("Café", "Almoço", "Lanche (atrasado)", "Jantar", "Ceia",
                                                              "Doce", "Refeição 1", "1ª refeição", "")
                for h in ("", "2026-10-01T08:00:00-07:00", "2026-10-01T13:10:00-07:00", "2026-10-01T17:00:00-07:00",
                          "2026-10-01T21:30:00-07:00")]
        for r, v in zip(refs, js("P.horario(c)", refs)):
            self.assertEqual(v, sugerir.horario(r), r)
        # custo de macros
        rnd = random.Random(3)
        meta = {"kcal": 1570, "p": 180, "c": 100, "g": 50}
        tots = [[rnd.uniform(800, 2500), rnd.uniform(60, 260), rnd.uniform(20, 250), rnd.uniform(10, 120)] for _ in range(200)]
        casos = [{"t": dict(zip(("kcal", "p", "c", "g"), t)), "m": meta} for t in tots]
        for t, v in zip(tots, js("P.custoMacros(c.t, c.m)", casos)):
            self.assertAlmostEqual(v, sugerir.custo_macros(t, meta), places=9)

    def test_formas_equivalentes_iguais_ao_python(self):
        """equivalentes()/gramas() do planejador = sugerir.py (o mesmo teto de claras nos dois lugares)."""
        r = js("[P.equivalentes(c.ali), Object.keys(c.ali).sort().map(a=>{try{return P.gramas(c.ali[a], 3)}catch(e){return 'erro'}})]",
               [{"ali": self.ali}])[0]
        py = []
        for a in sorted(self.ali):
            try:
                py.append(sugerir.gramas(self.ali[a], 3))
            except ValueError:
                py.append("erro")
        self.assertEqual(r[0], sugerir.equivalentes(self.ali))
        self.assertEqual(r[1], py)
        self.assertIn(["clara-100g", "clara-un"], list(r[0].values()))

    def test_alimento_fora_da_biblioteca(self):
        v = js("P.item(c.ali, 'nao-existe', 100)", [{"ali": self.ali}])[0]
        self.assertIn("não está mais na biblioteca", v["erro"])


def rodar(corpo, dados):
    """Executa `corpo` (JS que termina com `return …`) com P=NutriPlano e D=dados; devolve o JSON."""
    codigo = (
        "const vm=require('vm'),fs=require('fs');"
        "const ctx={window:{},Intl,Date,Math,Number,String,isFinite,JSON,console,Object,Array,parseFloat,parseInt,Error};"
        "vm.createContext(ctx);"
        f"for(const f of ['comum.js','planejador.js'])vm.runInContext(fs.readFileSync({json.dumps(str(RAIZ))}+'/'+f,'utf8'),ctx);"
        f"const P=ctx.window.NutriPlano;const D={json.dumps(dados)};"
        f"const r=(function(){{{corpo}}})();console.log(JSON.stringify(r));"
    )
    return json.loads(subprocess.check_output([NODE, "-"], input=codigo, text=True))


META = {"kcal": 1570, "p": 180, "c": 100, "g": 50}


@unittest.skipUnless(NODE, "node não instalado")
class Logica(unittest.TestCase):
    """Rascunho, revisão da base e trocas — cenários de dia vazio, parcial e acima da meta."""

    @classmethod
    def setUpClass(cls):
        cls.ali = {k: v for k, v in ler_json(RAIZ / "dados" / "alimentos.json").items() if not k.startswith("_")}
        cls.refs = ler_json(RAIZ / "dados" / "refeicoes.json")

    def it(self, aid, q):
        from item import montar_item
        return montar_item(self.ali, aid, str(q))

    def dia(self, lancado=(), sugestao=None):
        sug = sugestao if sugestao is not None else [
            {"refeicao": "Almoço", "itens": [self.it("frango-peito-cru", 200), self.it("batata-inglesa", 200)]},
            {"refeicao": "Lanche", "itens": [self.it("nurri-vanilla", 1)]},
            {"refeicao": "Jantar", "itens": [self.it("chuck-costco", 150), self.it("melancia", 400)]}]
        return {"data": "2026-10-02", "fechado": False, "meta": META, "lancado": list(lancado), "sugestao": sug}

    def dados(self, **kw):
        d = {"ali": self.ali, "refs": self.refs, "dia": self.dia()}
        d.update(kw)
        return d

    PREP = ("const base=P.baseDoDia('2026-10-02', D.dia, D.previa||null, {meta:D.dia&&D.dia.meta, sugestao:[]});"
            "const rasc=P.novoRascunho(base, D.ali);const cfg=P.config(D.refs);")

    def test_base_dia_previa_padrao(self):
        r = rodar("return [P.baseDoDia('2026-10-03', null, {para:'2026-10-03', meta:D.m, sugestao:[{refeicao:'Almoço',itens:[]}]}, {meta:D.m, sugestao:[]}).fonte,"
                  " P.baseDoDia('2026-10-04', null, {para:'2026-10-03', meta:D.m, sugestao:[{refeicao:'Almoço',itens:[]}]}, {meta:D.m, sugestao:[]}).fonte,"
                  " P.baseDoDia('2026-10-02', {meta:D.m, lancado:[], sugestao:[]}, null, null).fonte]", {"m": META})
        self.assertEqual(r, ["previa", "padrao", "dia"])

    def test_dia_vazio_totais_e_consumido_guardado(self):
        r = rodar(self.PREP + "const c=P.calcular(rasc, base, D.ali); return [c.consumido.kcal, c.planejado, c.projetado.kcal];", self.dados())
        sug = self.dia()["sugestao"]
        self.assertEqual(r[0], 0)
        self.assertAlmostEqual(r[2], sum(i["kcal"] for m in sug for i in m["itens"]), places=6)
        # consumido vem dos valores GUARDADOS: mudar a biblioteca não muda o que já foi comido
        almoco = {"refeicao": "Almoço", "id_evento": "e1:refeicao:1", "consumido_em": "2026-10-02T12:00:00-07:00",
                  "itens": [self.it("chuck-costco", 200)]}
        ali2 = json.loads(json.dumps(self.ali)); ali2["chuck-costco"]["kcal"] = 999
        r = rodar(self.PREP + "return P.calcular(rasc, base, D.ali).consumido.kcal;", self.dados(dia=self.dia([almoco]), ali=ali2))
        self.assertEqual(r, almoco["itens"][0]["kcal"])

    def test_acima_da_meta_mostra_diferenca_positiva(self):
        muito = [{"refeicao": "Almoço", "id_evento": "e:refeicao:1", "consumido_em": "2026-10-02T12:00:00-07:00",
                  "itens": [self.it("chuck-costco", 600)]}]
        r = rodar(self.PREP + "return P.calcular(rasc, base, D.ali).dif;", self.dados(dia=self.dia(muito)))
        self.assertGreater(r["kcal"], 0)
        self.assertGreater(r["g"], 0)

    def test_registro_novo_marca_refeicao_e_nao_soma_duas_vezes(self):
        r = rodar(self.PREP + "const d2=JSON.parse(JSON.stringify(D.dia)); d2.lancado.push(D.novo);"
                  "const b2=P.baseDoDia('2026-10-02', d2, null, null); const rv=P.revisar(rasc, b2, D.ali);"
                  "const c=P.calcular(rasc, b2, D.ali, rv.suspeitas);"
                  "const ok=P.revisar(P.aceitarBase(rasc, b2, D.ali), b2, D.ali);"
                  "return {mudou:rv.mudou, motivos:rv.motivos, susp:rv.suspeitas, proj:c.projetado.kcal, plan:c.planejado.kcal,"
                  " cons:c.consumido.kcal, depois:ok.mudou, susp2:ok.suspeitas};",
                  self.dados(novo={"refeicao": "Almoço", "id_evento": "g:refeicao:1", "consumido_em": "2026-10-02T12:30:00-07:00",
                                   "itens": [self.it("frango-peito-cru", 200), self.it("batata-inglesa", 200)]}))
        self.assertTrue(r["mudou"])
        self.assertIn("o Grok registrou ou corrigiu refeições", r["motivos"])
        self.assertEqual(r["susp"], [0], "o Almoço do rascunho pode ser o que o Grok registrou")
        self.assertAlmostEqual(r["proj"], r["cons"] + r["plan"], places=6)
        sug = self.dia()["sugestao"]
        self.assertAlmostEqual(r["plan"], sum(i["kcal"] for m in sug[1:] for i in m["itens"]), places=6,
                               msg="o almoço suspeito não pode entrar na projeção (contaria duas vezes)")
        self.assertFalse(r["depois"])
        self.assertEqual(r["susp2"], [])

    def test_meta_e_biblioteca_mudaram(self):
        ali2 = json.loads(json.dumps(self.ali)); ali2["melancia"]["kcal"] = 31
        r = rodar(self.PREP + "const d2=JSON.parse(JSON.stringify(D.dia)); d2.meta={kcal:1600,p:180,c:100,g:50};"
                  "return P.revisar(rasc, P.baseDoDia('2026-10-02', d2, null, null), D.ali2).motivos;", self.dados(ali2=ali2))
        self.assertEqual(r, ["a meta do dia mudou", "a biblioteca de alimentos mudou"])

    def test_alimento_removido_da_biblioteca(self):
        ali2 = {k: v for k, v in self.ali.items() if k != "melancia"}
        r = rodar(self.PREP + "const c=P.calcular(rasc, base, D.ali2); const rv=P.revisar(rasc, base, D.ali2);"
                  "const it=c.refeicoes[2].itens.find(i=>i.alimento==='melancia');"
                  "return {faltando:rv.faltando, marcado:!!it.faltando, kcal:it.kcal, texto:P.textoGrok(c, base)};",
                  self.dados(ali2=ali2))
        self.assertEqual(r["faltando"], ["melancia"])
        self.assertTrue(r["marcado"])
        self.assertEqual(r["kcal"], 0)
        self.assertIn("melancia (fora da biblioteca)", r["texto"])

    def test_trocas_respeitam_tetos_exclusoes_e_claras(self):
        # já comeu 3 Nurri (max_dia 3): nenhuma troca pode sugerir Nurri; frango excluído pelo usuário
        tres = [{"refeicao": "Café", "id_evento": "c:refeicao:1", "consumido_em": "2026-10-02T08:00:00-07:00",
                 "itens": [self.it("nurri-vanilla", 3)]}]
        sug = [{"refeicao": "Almoço", "itens": [self.it("chuck-costco", 150), self.it("batata-inglesa", 200)]},
               {"refeicao": "Jantar", "itens": [self.it("melancia", 400)]}]
        r = rodar(self.PREP + "rasc.excluidos=['frango-peito-cru'];"
                  "const ctx={base, rasc, alimentos:D.ali, cfg};"
                  "const a=P.alternativasItem(ctx,0,0); const j=P.alternativasItem(ctx,1,0,50);"
                  "const a2=P.alternativasItem(ctx,0,0);"
                  "return {almoco:a.opcoes.map(o=>o.alimento), n:a.opcoes.length, conflitos:a.conflitos,"
                  " jantar:j.opcoes.map(o=>o.alimento), igual:JSON.stringify(a)===JSON.stringify(a2),"
                  " efeito:a.opcoes.map(o=>[o.efeito.kcal, o.total.kcal-a.antes.kcal])};",
                  self.dados(dia=self.dia(tres, sug)))
        self.assertLessEqual(r["n"], 3)
        self.assertNotIn("nurri-vanilla", r["almoco"] + r["jantar"])
        self.assertNotIn("frango-peito-cru", r["almoco"] + r["jantar"])
        for cl in ("clara-100g", "clara-un"):
            self.assertNotIn(cl, r["almoco"], "claras só no jantar")
        self.assertTrue(any("Nurri" in c and "teto" in c for c in r["conflitos"]), r["conflitos"])
        self.assertTrue(any("excluído" in c for c in r["conflitos"]))
        self.assertTrue(r["igual"], "determinístico")
        for e, d in r["efeito"]:
            self.assertAlmostEqual(e, d, places=6)

    def test_teto_conta_o_planejado_nas_outras_refeicoes(self):
        # 2 Nurri no café do rascunho + 1 no lanche: trocar o item do almoço não pode trazer Nurri (3/3)
        sug = [{"refeicao": "Café", "itens": [self.it("nurri-vanilla", 2)]},
               {"refeicao": "Almoço", "itens": [self.it("chuck-costco", 150)]},
               {"refeicao": "Lanche", "itens": [self.it("nurri-vanilla", 1)]}]
        r = rodar(self.PREP + "const ctx={base, rasc, alimentos:D.ali, cfg};"
                  "return P.alternativasItem(ctx,1,0,50).opcoes.map(o=>o.alimento);", self.dados(dia=self.dia([], sug)))
        self.assertNotIn("nurri-vanilla", r)

    def test_sem_alternativa_viavel_explica(self):
        ali1 = {"nurri-vanilla": self.ali["nurri-vanilla"]}
        sug = [{"refeicao": "Lanche", "itens": [self.it("nurri-vanilla", 1)]}]
        r = rodar(self.PREP + "const ctx={base, rasc, alimentos:D.ali, cfg};"
                  "const a=P.alternativasItem(ctx,0,0); const m=P.alternativasRefeicao(ctx,0);"
                  "return {n:a.opcoes.length, c:a.conflitos, m:m.opcoes.map(o=>o.rotulo), mc:m.conflitos};",
                  self.dados(ali=ali1, dia=self.dia([], sug)))
        self.assertEqual(r["n"], 0)
        self.assertTrue(r["c"], "sem opção precisa explicar por quê")

    def test_ajuste_da_refeicao_respeita_teto(self):
        comeu = [{"refeicao": "Almoço", "id_evento": "a:refeicao:1", "consumido_em": "2026-10-02T12:00:00-07:00",
                  "itens": [self.it("chuck-costco", 150)]}]
        sug = [{"refeicao": "Jantar", "itens": [self.it("chuck-costco", 50), self.it("melancia", 300)]}]
        r = rodar(self.PREP + "const ctx={base, rasc, alimentos:D.ali, cfg};"
                  "const m=P.alternativasRefeicao(ctx,0); return m.opcoes.map(o=>o.itens);", self.dados(dia=self.dia(comeu, sug)))
        self.assertLessEqual(len(r), 3)
        for itens in r:
            chuck = sum(i["quantidade"] for i in itens if i["alimento"] == "chuck-costco")
            self.assertLessEqual(chuck, 50, "teto 200 g − 150 g consumidos")

    # ---- auditoria Codex #12 ----
    def test_manter_vale_so_para_os_registros_vistos(self):
        """Achado 2: 'Não foi registrada, manter' no 1º Almoço registrado não libera um 2º Almoço que chega depois."""
        a1 = {"refeicao": "Almoço", "id_evento": "g1:refeicao:1", "consumido_em": "2026-10-02T12:30:00-07:00",
              "itens": [self.it("frango-peito-cru", 200)]}
        a2 = {"refeicao": "Almoço", "id_evento": "g2:refeicao:1", "consumido_em": "2026-10-02T13:10:00-07:00",
              "itens": [self.it("batata-inglesa", 200)]}
        r = rodar(self.PREP +
                  "const d1=JSON.parse(JSON.stringify(D.dia)); d1.lancado.push(D.a1); const b1=P.baseDoDia('2026-10-02', d1, null, null);"
                  "const rv1=P.revisar(rasc, b1, D.ali); P.manterRefeicao(rasc, 'Almoço', rv1.chaves);"
                  "const rv1b=P.revisar(rasc, b1, D.ali);"
                  "const salvo=JSON.parse(JSON.stringify(rasc));"          # recarregar = rascunho do armazenamento
                  "const d2=JSON.parse(JSON.stringify(d1)); d2.lancado.push(D.a2); const b2=P.baseDoDia('2026-10-02', d2, null, null);"
                  "const rv2=P.revisar(salvo, b2, D.ali);"
                  "const velho=JSON.parse(JSON.stringify(salvo)); velho.manter=['Almoço'];"   # formato antigo (só o nome)
                  "return {antes:rv1.suspeitas, mantido:rv1b.suspeitas, depois:rv2.suspeitas, velho:P.revisar(velho, b2, D.ali).suspeitas};",
                  self.dados(a1=a1, a2=a2))
        self.assertEqual(r["antes"], [0])
        self.assertEqual(r["mantido"], [], "decidiu manter: sai da dúvida")
        self.assertEqual(r["depois"], [0], "registro NOVO de Almoço depois da decisão: volta a ficar em dúvida")
        self.assertEqual(r["velho"], [0], "manter no formato antigo não libera nada")

    def test_qualquer_registro_sem_horario_marca_todas(self):
        """Achado 3: 'Almoço' + 'Refeição 2' (sem consumido_em) → TODAS as refeições do rascunho ficam em dúvida."""
        novos = [{"refeicao": "Almoço", "id_evento": "x:refeicao:1", "consumido_em": "2026-10-02T12:30:00-07:00",
                  "itens": [self.it("frango-peito-cru", 200)]},
                 {"refeicao": "Refeição 2", "id_evento": "x:refeicao:2", "itens": [self.it("clara-100g", 180)]}]
        r = rodar(self.PREP + "const d2=JSON.parse(JSON.stringify(D.dia)); d2.lancado=D.novos;"
                  "return P.revisar(rasc, P.baseDoDia('2026-10-02', d2, null, null), D.ali).suspeitas;",
                  self.dados(novos=novos))
        self.assertEqual(r, [0, 1, 2])

    def _claras_jantar(self, comeu_claras=180):
        comeu = [{"refeicao": "Almoço", "id_evento": "c:refeicao:1", "consumido_em": "2026-10-02T12:00:00-07:00",
                  "itens": [self.it("clara-100g", comeu_claras)]}]
        sug = [{"refeicao": "Almoço", "itens": [self.it("clara-100g", 100), self.it("batata-inglesa", 200)]},
               {"refeicao": "Jantar", "itens": [self.it("clara-100g", 180), self.it("batata-inglesa", 200)]}]
        return self.dia(comeu, sug)

    def test_alternativas_da_refeicao_validam_a_refeicao_inteira(self):
        """Achado 4: com 180 g de clara já consumidos, nenhuma versão do Jantar pode manter claras; nenhuma
        versão do Almoço pode ter claras (só no jantar) nem alimento excluído."""
        r = rodar(self.PREP + "rasc.excluidos=['batata-inglesa'];"
                  "const ctx={base, rasc, alimentos:D.ali, cfg};"
                  "const j=P.alternativasRefeicao(ctx,1,3), a=P.alternativasRefeicao(ctx,0,3);"
                  "return {j:j.opcoes.map(o=>o.itens), a:a.opcoes.map(o=>o.itens), jc:j.conflitos, ac:a.conflitos};",
                  self.dados(dia=self._claras_jantar()))
        for itens in r["j"] + r["a"]:
            nomes = [i["alimento"] for i in itens]
            self.assertNotIn("clara-100g", nomes, itens)
            self.assertNotIn("clara-un", nomes, itens)
            self.assertNotIn("batata-inglesa", nomes, f"excluída pelo usuário: {itens}")
        if not r["j"]:
            self.assertTrue(r["jc"], "sem versão precisa explicar")

    def test_ajuste_tira_o_que_nao_cabe_em_vez_de_manter(self):
        """Achado 4 (causa): grade vazia devolvia a quantidade original — 'Ajustar as quantidades' mantinha 180 g."""
        r = rodar(self.PREP + "const ctx={base, rasc, alimentos:D.ali, cfg};"
                  "return P.ajustarRefeicao(ctx,1);", self.dados(dia=self._claras_jantar()))
        self.assertNotIn("clara-100g", [i["alimento"] for i in r])

    def test_ajuste_parte_da_quantidade_atual_quando_cabe(self):
        """Ajustar só sai da quantidade atual se melhorar a conta: 275 g dentro das regras não vira 270/280 à toa."""
        sug = [{"refeicao": "Jantar", "itens": [self.it("melancia", 275)]}]
        r = rodar(self.PREP + "const ctx={base, rasc, alimentos:D.ali, cfg};"
                  "const m={kcal:1570,p:180,c:100,g:50}; const antes=P.custoMacros(P.totalDoDia(ctx), m);"
                  "const it=P.ajustarRefeicao(ctx,0); const depois=P.custoMacros(P.totalDoDia(ctx,0,it), m);"
                  "return {it, antes, depois};", self.dados(dia=self.dia([], sug)))
        self.assertLessEqual(r["depois"], r["antes"] + 1e-9, "o ajuste nunca pode piorar uma refeição que já cabe")

    def test_formas_equivalentes_dividem_o_teto(self):
        """Achado 5: 180 g de clara-100g consumidos → clara-un não pode aparecer (mesmo alimento, outro cadastro)."""
        comeu = [{"refeicao": "Almoço", "id_evento": "c:refeicao:1", "consumido_em": "2026-10-02T12:00:00-07:00",
                  "itens": [self.it("clara-100g", 180), self.it("chuck-costco", 200), self.it("nurri-vanilla", 3),
                            self.it("batata-inglesa", 700)]}]
        sug = [{"refeicao": "Jantar", "itens": [self.it("melancia", 400)]}]
        r = rodar(self.PREP + "rasc.excluidos=['frango-peito-cru','iogurte-grego-100g','iogurte-grego-430g'];"
                  "const ctx={base, rasc, alimentos:D.ali, cfg};"
                  "const a=P.alternativasItem(ctx,0,0,3); const eq=P.equivalentes(D.ali);"
                  "const ctx2={base:P.baseDoDia('2026-10-02', D.d100, null, null), rasc, alimentos:D.ali, cfg};"
                  "const b=P.alternativasItem(ctx2,0,0,50);"
                  "return {op:a.opcoes.map(o=>o.alimento), c:a.conflitos, eq:eq, b:b.opcoes.map(o=>[o.alimento,o.quantidade])};",
                  self.dados(dia=self.dia(comeu, sug),
                             d100=self.dia([dict(comeu[0], itens=[self.it("clara-100g", 100)])], sug)))
        self.assertIn(["clara-100g", "clara-un"], list(r["eq"].values()))
        self.assertNotIn("clara-un", r["op"])
        self.assertNotIn("clara-100g", r["op"])
        self.assertTrue(any("formas equivalentes" in c for c in r["c"]), r["c"])
        # com 100 g consumidos sobram 80 g: no máximo 2 claras (68 g) ou 80 g
        for aid, q in r["b"]:
            if aid == "clara-un":
                self.assertLessEqual(q * 34, 80)
            if aid == "clara-100g":
                self.assertLessEqual(q, 80)

    def test_texto_para_o_grok(self):
        r = rodar(self.PREP + "return P.textoGrok(P.calcular(rasc, base, D.ali), base);", self.dados())
        linhas = r.split("\n")
        self.assertEqual(linhas[0], "PLANEJAMENTO — NÃO CONSUMIDO")
        self.assertIn("Data: 02/10/2026 (sexta)", r)
        self.assertIn("NÃO lance nada", r)
        self.assertIn("Peito de frango", r)
        self.assertIn("Dia projetado", r)

    def test_armazenamento_indisponivel_e_limpeza(self):
        r = rodar("const quebrado={setItem(){throw new Error('quota')},getItem(){throw new Error('x')},removeItem(){},length:0,key(){}};"
                  "const a=P.armazem(quebrado); a.gravar('k','v');"
                  "const mem={}; const st={setItem(k,v){mem[k]=String(v)},getItem(k){return k in mem?mem[k]:null},"
                  " removeItem(k){delete mem[k]},get length(){return Object.keys(mem).length},key(i){return Object.keys(mem)[i]}};"
                  "const b=P.armazem(st); b.gravar(P.chaveRascunho('2026-09-20'),'x'); b.gravar(P.chaveRascunho('2026-10-01'),'y');"
                  "b.gravar(P.chaveRascunho('2026-10-03'),'z'); b.gravar('outra-coisa','w'); P.limparAntigos(b,'2026-10-02');"
                  "return {disp:a.disponivel, leu:a.ler('k'), disp2:b.disponivel, chaves:Object.keys(mem).sort()};", {})
        self.assertFalse(r["disp"])
        self.assertEqual(r["leu"], "v", "sem armazenamento: funciona em memória (temporário)")
        self.assertTrue(r["disp2"])
        self.assertEqual(r["chaves"], ["nutri-plano:2026-10-01", "nutri-plano:2026-10-03", "outra-coisa"])


class Fechamento(CopiaRepo):
    def test_fechamento_atualiza_o_link_plano_do_planejador(self):
        import datetime
        import re
        d = self.dia_aberto()
        amanha = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat()
        depois = (datetime.date.fromisoformat(amanha) + datetime.timedelta(days=1)).isoformat()
        self.rodar("fechar_dia.py", check=True, env={"HOJE": amanha})
        html = (self.tmp / "planejar.html").read_text(encoding="utf-8")
        self.assertEqual(re.findall(r'dia\.html\?d=([\d-]+)">Plano<', html), [depois])
        self.assertIn('href="./planejar.html">Planejar</a>', (self.tmp / "index.html").read_text(encoding="utf-8"))
        semana = (self.tmp / "semana.html").read_text(encoding="utf-8")
        self.assertEqual(re.findall(r'dia\.html\?d=([\d-]+)">Plano<', semana), [depois])


if __name__ == "__main__":
    unittest.main()
