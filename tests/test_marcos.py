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
        "marcos:e.marcos,prox:e.prox,prev:prev,medida:e.medida,simFim:e.sim&&e.sim.fim,bfHoje:e.sim&&e.sim.bfHoje}));"
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


if __name__ == "__main__":
    unittest.main()
