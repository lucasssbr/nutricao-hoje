"""Marcos de peso e datas da previsão (objetivo.js: estadoMarcos / escolherMedida), rodando o JS real no Node.

Casos da revisão Codex #5:
- 88,9 (29/09) e 87,6 (30/09): média 88,25 — o marco de 88 NÃO pode ser confirmado só pelo último peso;
- histórico longo e poucas pesagens recentes: média usa só a janela de 7 dias e informa a quantidade;
- tela em 30/09, último peso 01/09, DEXA 15/08 e bioimpedância 30/09: a medida escolhida é a de dentro
  da janela (bioimpedância), e nenhuma previsão cai numa data já passada.
"""
import json
import shutil
import subprocess
import unittest

from base import RAIZ

NODE = shutil.which("node")

OBJ = {"inicio": "2026-09-29", "data_alvo": "2026-10-17", "peso_inicial_kg": 88.9, "meta_semanal_kg": 1.22,
       "meta_final": {"peso_kg": 80, "gordura_pct": 10, "gordura_inicial_pct": 19, "peso_inicial_kg": 88.9,
                      "ritmo": {"cenario": "agressivo", "pct_semana": [1.2, 1.0, 0.8], "faixas_gordura": [15, 12],
                                "fracao_forbes": 0.5, "pausa_semanas": [8, 1]}}}


def estado(reais, medidas, hoje, obj=OBJ):
    codigo = (
        "const vm=require('vm');const fs=require('fs');"
        "const ctx={window:{},Intl,Date,Math,Number,String,isFinite,JSON,console};vm.createContext(ctx);"
        f"vm.runInContext(fs.readFileSync({json.dumps(str(RAIZ / 'comum.js'))},'utf8'),ctx);"
        f"vm.runInContext(fs.readFileSync({json.dumps(str(RAIZ / 'objetivo.js'))},'utf8'),ctx);"
        f"const e=ctx.window.NutriObjetivo.estadoMarcos({json.dumps(obj)},{json.dumps(reais)},{json.dumps(medidas)},{json.dumps(hoje)});"
        "const prev={};if(e){e.marcos.forEach(function(m){prev[m.kg]=e.previsao(m.kg);});}"
        "console.log(JSON.stringify(e&&{ref:e.ref,n:e.n,ultData:e.ultData,desde:e.desde,confirma:e.confirma,"
        "marcos:e.marcos,prox:e.prox,prev:prev,medida:e.medida,simFim:e.sim&&e.sim.fim,bfHoje:e.sim&&e.sim.bfHoje,desatualizada:e.desatualizada,semPesar:e.semPesar,"
        "simAtingido:e.sim&&e.sim.atingido,simErro:e.sim&&e.sim.erro||null,simBfFim:e.sim&&e.sim.bfFim}));"
    )
    return json.loads(subprocess.check_output([NODE, "-e", codigo], text=True))


def p(data, kg):
    return {"data": data, "kg": kg}


@unittest.skipUnless(NODE, "node não instalado")
class Marcos(unittest.TestCase):
    def test_duas_pesagens_so_a_ultima_cruza(self):
        e = estado([p("2026-09-29", 88.9), p("2026-09-30", 87.6)], [], "2026-09-30")
        self.assertAlmostEqual(e["ref"], 88.25)
        self.assertEqual(e["n"], 2)
        m88 = next(m for m in e["marcos"] if m["kg"] == 88)
        self.assertFalse(m88["ok"], "88 kg confirmado só porque o último peso cruzou")
        self.assertEqual(e["prox"], 88)

    def test_confirmacao_e_data_coerentes(self):
        reais = [p("2026-10-0%d" % d, kg) for d, kg in [(1, 88.4), (2, 87.9), (3, 87.7), (4, 87.5)]]
        e = estado(reais, [], "2026-10-04")
        m88 = next(m for m in e["marcos"] if m["kg"] == 88)
        self.assertTrue(m88["ok"])
        # a data da conquista é o 1º dia em que a MESMA regra (média da janela com 2+ pesagens) ficou ≤ 88
        # 01/10 → 1 pesagem (não confirma); 02/10 → (88,4+87,9)/2 = 88,15 (> 88); 03/10 → 88,0 (≤ 88)
        self.assertEqual(m88["data"], "2026-10-03")

    def test_historico_longo_poucas_pesagens_recentes(self):
        reais = [p("2026-08-%02d" % d, 90.0) for d in range(1, 32)] + [p("2026-09-01", 90.0), p("2026-09-30", 86.5)]
        e = estado(reais, [], "2026-09-30")
        self.assertEqual(e["n"], 1, "a média tem que usar só a janela de 7 dias")
        self.assertAlmostEqual(e["ref"], 86.5)
        self.assertFalse(e["confirma"])
        self.assertTrue(all(not m["ok"] for m in e["marcos"]), "1 pesagem não confirma marco")
        self.assertTrue(any(m["pendente"] for m in e["marcos"]))

    def test_datas_de_referencia_e_medida(self):
        reais = [p("2026-08-%02d" % d, 89.5 - d * 0.02) for d in range(20, 32)] + [p("2026-09-01", 88.9)]
        medidas = [{"data": "2026-08-15", "pct": 17.0, "fonte": "dexa"},
                   {"data": "2026-09-30", "pct": 22.6, "fonte": "bioimpedancia"}]
        e = estado(reais, medidas, "2026-09-30")
        self.assertEqual(e["ultData"], "2026-09-01")
        self.assertEqual(e["desde"], "2026-09-30", "a previsão tem que partir de hoje, não da última pesagem")
        self.assertEqual(e["medida"]["data"], "2026-09-30", "DEXA de 15/08 está fora dos 30 dias contados de HOJE")
        for kg, d in e["prev"].items():
            if d:
                self.assertGreaterEqual(d, "2026-09-30", f"previsão do marco {kg} numa data passada: {d}")
        self.assertGreaterEqual(e["simFim"], "2026-09-30")

    def test_medida_de_hoje_bate_com_a_gordura_de_hoje(self):
        # 19% informado em 30/09 com média 88,25 → "gordura hoje" tem que ser 19%, não 20%
        e = estado([p("2026-09-29", 88.9), p("2026-09-30", 87.6)],
                   [{"data": "2026-09-30", "pct": 19.0, "fonte": "lucas"}], "2026-09-30")
        self.assertAlmostEqual(e["bfHoje"], 0.19, places=3)

    def test_medida_futura_e_peso_futuro_ignorados(self):
        e = estado([p("2026-09-29", 88.9), p("2026-09-30", 88.5), p("2026-10-05", 80.0)],
                   [{"data": "2026-10-05", "pct": 12.0, "fonte": "dexa"}], "2026-09-30")
        self.assertEqual(e["ultData"], "2026-09-30")
        self.assertIsNone(e["medida"])


    # ---- item 3: datas e recência
    def test_previsao_desatualizada_e_medida_antiga(self):
        reais = [p("2026-08-%02d" % d, 90.0 - d * 0.05) for d in range(25, 32)]
        e = estado(reais, [{"data": "2026-07-01", "pct": 18.0, "fonte": "dexa"}], "2026-09-30")
        self.assertTrue(e["desatualizada"])
        self.assertEqual(e["semPesar"], 30)
        self.assertTrue(e["medida"]["antiga"], "DEXA de julho não pode passar por medida recente")
        self.assertEqual(e["desde"], "2026-09-30")

    # ---- item 4: média só da fonte escolhida
    def test_mesma_prioridade_fontes_distintas_nao_misturam(self):
        med = [{"data": "2026-09-20", "pct": 30.0, "fonte": "lucas"}, {"data": "2026-09-30", "pct": 18.0, "fonte": "foto"}]
        e = estado([p("2026-09-29", 88.9), p("2026-09-30", 87.6)], med, "2026-09-30")
        self.assertEqual(e["medida"]["fonteId"], "foto")
        self.assertAlmostEqual(e["medida"]["pct"], 18.0)
        self.assertEqual(e["medida"]["n"], 1)
        self.assertNotIn("média", e["medida"]["fonte"])

    def test_varias_leituras_da_mesma_fonte(self):
        med = [{"data": "2026-09-15", "pct": 20.0, "fonte": "foto"},   # 15 dias antes da última foto: fora
               {"data": "2026-09-22", "pct": 19.0, "fonte": "foto"},
               {"data": "2026-09-30", "pct": 17.0, "fonte": "foto"},
               {"data": "2026-09-29", "pct": 25.0, "fonte": "bioimpedancia"}]
        e = estado([p("2026-09-29", 88.9), p("2026-09-30", 87.6)], med, "2026-09-30")
        self.assertEqual(e["medida"]["fonteId"], "foto")
        self.assertAlmostEqual(e["medida"]["pct"], 18.0)   # (19 + 17) / 2
        self.assertEqual(e["medida"]["n"], 2)
        self.assertIn("média de 2", e["medida"]["fonte"])

    # ---- item 5: parâmetros inválidos e alvo não alcançado (JS não pode quebrar nem mentir)
    def ritmo(self, **kw):
        o = json.loads(json.dumps(OBJ))
        o["meta_final"]["ritmo"].update(kw)
        return o

    def test_parametros_invalidos_nao_quebram(self):
        for pct in ("oops", [0, 0, 0], [1.2, 1.0], [1.2, None, 0.8]):
            e = estado([p("2026-09-29", 88.9), p("2026-09-30", 87.6)], [], "2026-09-30", self.ritmo(pct_semana=pct))
            self.assertTrue(e["simErro"], f"pct_semana={pct!r} deveria dar erro de parâmetro")
            self.assertIsNone(e.get("simFim"))

    def test_horizonte_esgotado_nao_anuncia_alvo(self):
        e = estado([p("2026-09-29", 88.9), p("2026-09-30", 87.6)], [], "2026-09-30", self.ritmo(pct_semana=[0.02, 0.02, 0.02]))
        self.assertFalse(e["simAtingido"])
        self.assertIsNone(e["simFim"], "não pode anunciar data dos 10% se não chegou lá")
        self.assertGreater(e["simBfFim"], 0.10)

    def test_parametros_atuais_atingem_alvo(self):
        e = estado([p("2026-09-29", 88.9), p("2026-09-30", 87.6)], [], "2026-09-30")
        self.assertTrue(e["simAtingido"])
        self.assertIsNotNone(e["simFim"])

    # ---- item 10: meta final decimal
    def test_meta_decimal_nao_da_todos_cedo(self):
        o = json.loads(json.dumps(OBJ))
        o["meta_final"]["peso_kg"] = 80.5
        e = estado([p("2026-09-29", 81.0), p("2026-09-30", 81.0)], [], "2026-09-30", o)
        kgs = [m["kg"] for m in e["marcos"]]
        self.assertEqual(kgs[-1], 80.5, "a meta decimal tem que ser o último marco")
        self.assertEqual(e["prox"], 80.5, "com 81 kg ainda falta a meta de 80,5 — não pode ser 'todos'")
        self.assertIsNotNone(e["prev"]["80.5"], "a meta decimal também precisa de data prevista")

    def test_meta_inteira_igual_antes(self):
        e = estado([p("2026-09-29", 88.9), p("2026-09-30", 87.6)], [], "2026-09-30")
        self.assertEqual([m["kg"] for m in e["marcos"]], list(range(88, 79, -1)))


if __name__ == "__main__":
    unittest.main()
