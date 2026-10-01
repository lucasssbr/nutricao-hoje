"""Sugestão automática (scripts/sugerir.py): histórico real de alimentos → sugestão perto da meta.

Histórico sintético (dados/ temporário): o Lucas almoça acém + batata, lancha Nurri (+ wafer às vezes) e
janta melancia + acém. Pedido de 01/10: recomendar também peito de frango cru (refeicoes.json → incluir).
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

from base import RAIZ, CopiaRepo

sys.path.insert(0, str(RAIZ / "scripts"))
from item import carregar_alimentos, montar_item  # noqa: E402
from sugerir import sugerir  # noqa: E402

META = {"kcal": 1570, "p": 180, "c": 100, "g": 50}
ALI = carregar_alimentos()


def ref(nome, hora, d, *itens):
    return {"refeicao": nome, "consumido_em": f"{d}T{hora}:00-07:00",
            "itens": [montar_item(ALI, a, str(q)) for a, q in itens]}


def dia_hist(d, extra=()):
    return {"data": d, "fechado": True, "meta": META, "lancado": [
        ref("Almoço", "13:00", d, ("chuck-costco", 250), ("batata-inglesa", 250)),
        ref("Lanche", "16:30", d, ("nurri-vanilla", 1), *extra),
        ref("Jantar", "20:30", d, ("melancia", 700), ("chuck-costco", 200)),
    ]}


class Sugerir(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="nutri-sug-"))
        for n in ("alimentos.json", "refeicoes.json"):
            shutil.copy2(RAIZ / "dados" / n, self.tmp / n)
        self.dias = ["2026-10-01", "2026-10-02", "2026-10-03"]
        for i, d in enumerate(self.dias):
            extra = [("bauducco-wafer-roll", 2)] if i == 0 else []
            (self.tmp / f"{d}.json").write_text(json.dumps(dia_hist(d, extra), ensure_ascii=False))
        self.alvo = "2026-10-04"
        self.salvar_dias(self.dias + [self.alvo])
        self.refs = json.loads((self.tmp / "refeicoes.json").read_text())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def salvar_dias(self, dias):
        (self.tmp / "dias.json").write_text(json.dumps(dias))

    def config(self, **kw):
        self.refs.setdefault("sugestao_auto", {}).update(kw)
        (self.tmp / "refeicoes.json").write_text(json.dumps(self.refs, ensure_ascii=False))

    def rodar(self, lancado=()):
        return sugerir(self.alvo, {"meta": META, "lancado": list(lancado)}, dados=self.tmp)

    @staticmethod
    def total(*listas):
        return {k: sum(i[k] for l in listas for r in l for i in r["itens"]) for k in ("kcal", "p", "c", "g")}

    def alimentos_em(self, sug):
        return {(r["refeicao"], i["alimento"]) for r in sug for i in r["itens"]}

    def test_perto_da_meta_com_os_alimentos_dele(self):
        sug, nota = self.rodar()
        t = self.total(sug)
        self.assertGreaterEqual(t["p"], META["p"] - 5, t)
        self.assertLessEqual(t["g"], META["g"] + 5, t)
        self.assertLess(abs(t["kcal"] - META["kcal"]), 100, t)
        self.assertLess(abs(t["c"] - META["c"]), 20, t)
        historico = {"chuck-costco", "batata-inglesa", "nurri-vanilla", "bauducco-wafer-roll", "melancia"}
        pedidos = set(self.refs["sugestao_auto"]["incluir"])
        self.assertTrue({a for _, a in self.alimentos_em(sug)} <= historico | pedidos, sug)
        self.assertEqual([r["refeicao"] for r in sug], ["Almoço", "Lanche", "Jantar"], "sem café no histórico")
        self.assertIn("Sugestão automática", nota)

    def test_frango_pedido_entra(self):
        sug, nota = self.rodar()
        self.assertIn("frango-peito-cru", {a for _, a in self.alimentos_em(sug)},
                      "frango é a proteína magra que fecha a meta sem estourar a gordura")
        self.assertIn("Peito de frango", nota)

    def test_tetos_de_planejamento(self):
        sug, _ = self.rodar()
        q = {}
        for r in sug:
            for i in r["itens"]:
                q[i["alimento"]] = q.get(i["alimento"], 0) + i["quantidade"]
        self.assertLessEqual(q.get("chuck-costco", 0), ALI["chuck-costco"]["plano_ate_g"])
        self.assertLessEqual(q.get("nurri-vanilla", 0), 3)
        # porções realistas: nada de "30 g de acém"
        for r in sug:
            for i in r["itens"]:
                if ALI[i["alimento"]]["base"].endswith(" g"):
                    self.assertGreaterEqual(i["quantidade"], 50, i)

    def test_claras_so_no_jantar(self):
        d = self.dias[0]
        dia = dia_hist(d)
        dia["lancado"][0]["itens"].append(montar_item(ALI, "clara-100g", "200"))   # comeu claras no almoço
        (self.tmp / f"{d}.json").write_text(json.dumps(dia, ensure_ascii=False))
        sug, _ = self.rodar()
        self.assertNotIn(("Almoço", "clara-100g"), self.alimentos_em(sug))

    def test_restante_do_dia_conta_o_que_ja_comeu(self):
        almoco = [ref("Almoço", "12:00", self.alvo, ("chuck-costco", 300), ("batata-inglesa", 300))]
        sug, nota = self.rodar(almoco)
        self.assertEqual([r["refeicao"] for r in sug], ["Lanche", "Jantar"])
        t = self.total(almoco, sug)
        self.assertGreaterEqual(t["p"], META["p"] - 10, t)
        self.assertIn("refaz o restante", nota)
        # almoço gordo → o resto evita acém e vai de proteína magra
        self.assertNotIn(("Jantar", "chuck-costco"), self.alimentos_em(sug))

    def test_depois_do_jantar_nao_sugere_nada(self):
        sug, nota = self.rodar([ref("Jantar", "21:00", self.alvo, ("melancia", 500))])
        self.assertEqual(sug, [])
        self.assertIn("Dia completo", nota)

    def test_deterministica(self):
        self.assertEqual(self.rodar(), self.rodar())

    def test_sem_historico_usa_plano_padrao(self):
        self.salvar_dias([self.alvo])
        sug, nota = self.rodar()
        self.assertEqual([r.get("favorita") for r in sug], self.refs["plano_padrao"])
        self.assertEqual(nota, self.refs["plano_padrao_nota"])

    def test_janela_ignora_dias_antigos(self):
        self.config(janela_dias=1)   # só 03/10 entra → menos de min_dias (2) → plano padrão
        sug, _ = self.rodar()
        self.assertEqual([r.get("favorita") for r in sug], self.refs["plano_padrao"])

    def test_nao_inventa_alimento_que_ele_nao_come(self):
        self.config(incluir={})
        sug, _ = self.rodar()
        self.assertTrue({a for _, a in self.alimentos_em(sug)} <=
                        {"chuck-costco", "batata-inglesa", "nurri-vanilla", "bauducco-wafer-roll", "melancia"})

    # ---- auditoria Codex #6
    def nurri(self, sug):
        return sum(i["quantidade"] for r in sug for i in r["itens"] if i["alimento"] == "nurri-vanilla")

    def test_teto_desconta_o_que_ja_foi_comido(self):
        """#1: comeu 3 Nurri no almoço (max_dia 3) → a sugestão não traz mais nenhuma; acém idem (plano_ate_g)."""
        self.config(max_dia={"nurri-vanilla": 3})
        almoco = [ref("Almoço", "12:00", self.alvo, ("nurri-vanilla", 3), ("chuck-costco", 200))]
        sug, _ = self.rodar(almoco)
        self.assertEqual(self.nurri(sug), 0, sug)
        self.assertNotIn("chuck-costco", {a for _, a in self.alimentos_em(sug)}, "acém já chegou nos 200 g planejados")
        # comer ACIMA do teto é registrado normalmente; a sugestão só não acrescenta mais
        sug, _ = self.rodar([ref("Almoço", "12:00", self.alvo, ("nurri-vanilla", 5))])
        self.assertEqual(self.nurri(sug), 0)
        # sobra parcial: 1 comida → no máximo 2 na sugestão
        sug, _ = self.rodar([ref("Almoço", "12:00", self.alvo, ("nurri-vanilla", 1))])
        self.assertLessEqual(self.nurri(sug), 2)

    def test_historico_sem_horario_usa_plano_padrao(self):
        """#2: "Refeição 1/2" sem consumido_em não identifica horário → plano padrão, não "Dia completo"."""
        for d in self.dias:
            dia = dia_hist(d)
            for i, r in enumerate(dia["lancado"], 1):
                r["refeicao"] = f"Refeição {i}"
                del r["consumido_em"]
            (self.tmp / f"{d}.json").write_text(json.dumps(dia, ensure_ascii=False))
        sug, nota = self.rodar()
        self.assertEqual([r.get("favorita") for r in sug], self.refs["plano_padrao"])
        self.assertNotIn("Dia completo", nota)
        sug, nota = self.rodar([ref("Almoço", "12:00", self.alvo, ("melancia", 300))])
        self.assertEqual(sug, [])
        self.assertIn("Sem histórico com horário", nota)

    def test_teto_decimal(self):
        """#4: max_dia 3.0 / 2.5 com porção típica de 2 latas não pode quebrar (range com float)."""
        for d in self.dias:
            dia = dia_hist(d)
            dia["lancado"][1] = ref("Lanche", "16:30", d, ("nurri-vanilla", 2))
            (self.tmp / f"{d}.json").write_text(json.dumps(dia, ensure_ascii=False))
        for teto, maximo in ((3.0, 3), (2.5, 2), (3, 3)):
            self.config(max_dia={"nurri-vanilla": teto})
            sug, _ = self.rodar()
            self.assertLessEqual(self.nurri(sug), maximo, teto)
            self.assertTrue(all(float(i["quantidade"]).is_integer() for r in sug for i in r["itens"]
                                if i["alimento"] == "nurri-vanilla"), "lata é sempre inteira")


class Integracao(CopiaRepo):
    def test_fechamento_cria_dia_com_sugestao_automatica(self):
        import datetime
        d = self.dia_aberto()
        amanha = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat()
        self.rodar("fechar_dia.py", check=True, env={"HOJE": amanha})
        novo = self.ler(f"{amanha}.json")
        self.assertTrue(novo["sugestao"], "dia novo sem sugestão")
        hist = [x for x in self.ler("dias.json") if x < amanha]
        if len(hist) >= 2:
            self.assertIn("Sugestão automática", novo["sugestao_nota"])
        self.assertSemErros()

    def test_fechamento_com_sugestao_quebrada_cai_no_plano_padrao(self):
        import datetime
        (self.tmp / "scripts" / "sugerir.py").write_text("def sugerir(*a, **k):\n    raise RuntimeError('quebrado')\n")
        d = self.dia_aberto()
        amanha = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat()
        r = self.rodar("fechar_dia.py", check=True, env={"HOJE": amanha})
        self.assertIn("usando o plano padrão", r.stdout)
        self.assertEqual(self.ler(f"{amanha}.json")["sugestao_nota"], self.ler("refeicoes.json")["plano_padrao_nota"])

    def _lancar(self, nome, *extra):
        d = self.dia_aberto()
        from comum import hoje_la
        if d > hoje_la().isoformat():
            self.skipTest("dia aberto no futuro")
        return d, self.rodar("registrar.py", "refeicao", "--evento", "msg-sug:refeicao:1", "--nome", nome,
                             "--consumido-em", f"{d}T00:01", "--item", "nurri-vanilla=1lata", *extra)

    def test_lancar_refaz_o_restante(self):
        d, r = self._lancar("Jantar")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.ler(f"{d}.json")["sugestao"], [], "depois do jantar não há restante a sugerir")

    def test_sem_replanejar_mantem_a_sugestao(self):
        d = self.dia_aberto()
        antes = self.ler(f"{d}.json")["sugestao"]
        _, r = self._lancar("Jantar", "--sem-replanejar")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.ler(f"{d}.json")["sugestao"], antes)

    def test_sugestao_quebrada_nao_impede_lancamento(self):
        (self.tmp / "scripts" / "sugerir.py").write_text("def sugerir(*a, **k):\n    raise RuntimeError('quebrado')\n")
        d, r = self._lancar("Jantar")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("não refiz a sugestão", r.stderr)
        self.assertEqual(len([x for x in self.ler(f"{d}.json")["lancado"] if x.get("id_evento") == "msg-sug:refeicao:1"]), 1)

    def test_previa_de_amanha(self):
        import datetime
        d = self.dia_aberto()
        self.rodar("derivados.py", check=True, env={"HOJE": d})
        pv = self.ler("previa.json")
        self.assertEqual(pv["para"], (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat())
        self.assertTrue(pv["sugestao"])
        self.assertEqual(pv["meta"], {k: self.ler("objetivo.json")["atual"]["metas"][k] for k in ("kcal", "p", "c", "g")})
        r = self.rodar("derivados.py", check=True, env={"HOJE": d})
        self.assertIn("já estavam em dia", r.stdout, "prévia tem que ser determinística (sem commit à toa)")
        self.assertSemErros()

    def test_previa_quebrada_nao_derruba_derivados(self):
        (self.tmp / "scripts" / "sugerir.py").write_text("def sugerir(*a, **k):\n    raise RuntimeError('quebrado')\n")
        r = self.rodar("derivados.py", check=True)
        self.assertIn("prévia de amanhã não gerada", r.stderr)

    def test_previa_com_formato_errado_e_erro(self):
        self.gravar("previa.json", {"para": "2026-13-40", "sugestao": [{"itens": 3}]})
        self.assertErro("previa.json.para")
        self.assertErro("previa.json.sugestao[0]")

    def test_rollback_restaura_todos_os_derivados(self):
        """#3: falha de validação depois dos derivados → dados/ inteiro volta ao estado anterior (inclui previa.json;
        arquivo que não existia antes não pode ficar)."""
        refs = self.ler("refeicoes.json")
        refs["sugestao_auto"]["chave_errada"] = 1           # validar recusa só DEPOIS de gerar derivados
        self.gravar("refeicoes.json", refs)
        for previa_existia in (True, False):
            if not previa_existia:
                (self.dados / "previa.json").unlink(missing_ok=True)
            antes = {q.name: q.read_bytes() for q in self.dados.iterdir() if q.is_file()}
            d, r = self._lancar("Café", "--item", "nurri-vanilla=2lata")
            self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
            self.assertIn("validação falhou", r.stdout)
            depois = {q.name: q.read_bytes() for q in self.dados.iterdir() if q.is_file()}
            self.assertEqual(sorted(depois), sorted(antes), "arquivo criado na tentativa ficou para trás")
            for nome in antes:
                self.assertEqual(depois[nome], antes[nome], f"{nome} não foi restaurado")

    def test_validacao_da_configuracao(self):
        refs = self.ler("refeicoes.json")
        refs["sugestao_auto"] = {"janela_dias": "14", "incluir": {"frango-peito-cru": ["Brunch"], "nao-existe": ["Jantar"]},
                                 "max_dia": {"nurri-vanilla": -1}, "outra": 1}
        self.gravar("refeicoes.json", refs)
        for trecho in ("janela_dias", "incluir.frango-peito-cru", "'nao-existe'", "max_dia.nurri-vanilla", "chave desconhecida"):
            self.assertErro(trecho)


if __name__ == "__main__":
    unittest.main()
