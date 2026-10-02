"""Precisão e calendário: o mesmo arredondamento em Python e JS; semana única; fuso de Los Angeles."""
import datetime
import json
import pathlib
import shutil
import subprocess
import unittest

from base import RAIZ, CopiaRepo
from comum import arred, hoje_la

NODE = shutil.which("node")


def js(expr_list):
    """Avalia expressões usando comum.js (window.Nutri) no Node."""
    codigo = (
        "const vm=require('vm');const fs=require('fs');const ctx={window:{},Intl,Date,Math,Number,String,isFinite};"
        f"vm.createContext(ctx);vm.runInContext(fs.readFileSync({json.dumps(str(RAIZ / 'comum.js'))},'utf8'),ctx);"
        f"const N=ctx.window.Nutri;const out=[{','.join(expr_list)}];console.log(JSON.stringify(out));"
    )
    return json.loads(subprocess.check_output([NODE, "-e", codigo], text=True))


@unittest.skipUnless(NODE, "node não instalado")
class Arredondamento(unittest.TestCase):
    CASOS = [(176.5, 0), (0.5, 0), (1.5, 0), (2.5, 0), (-0.5, 0), (-2.5, 0), (0.15, 1), (2.675, 2),
             (1.005, 2), (71.5 + 105, 0), (0.1 + 0.2, 1), (149.95, 1), (-1.25, 1), (1234.5, 0)]

    def test_python_e_js_iguais(self):
        py = [arred(x, c) for x, c in self.CASOS]
        j = js([f"N.arred({x!r},{c})" for x, c in self.CASOS])
        self.assertEqual(py, j)
        self.assertEqual(arred(176.5), 177)   # ovo 71,5 + banana 105 → 177 no CLI e na tela

    def test_item_py_total_igual_tela(self):
        r = subprocess.run(["python3", str(RAIZ / "scripts" / "item.py"), "ovo-inteiro", "1", "banana", "1"],
                           capture_output=True, text=True, check=True)
        linha = r.stdout.strip().splitlines()[-1]
        itens = json.loads(r.stdout[: r.stdout.rindex("]") + 1])
        soma = sum(i["kcal"] for i in itens)
        self.assertIn(f"TOTAL: {arred(soma)} kcal", linha)
        self.assertEqual(js([f"N.ri({soma!r})"])[0], arred(soma))


@unittest.skipUnless(NODE, "node não instalado")
class Semana(unittest.TestCase):
    def test_semana_unica(self):
        # objetivo 29/09 → 17/10: semana 1 = 29/09–05/10, pesagem 06/10; última semana curta termina no alvo
        r = js(["N.semana('2026-09-29','2026-10-17','2026-09-29')", "N.semana('2026-09-29','2026-10-17','2026-10-05')",
                "N.semana('2026-09-29','2026-10-17','2026-10-06')", "N.semana('2026-09-29','2026-10-17','2026-10-17')"])
        self.assertEqual((r[0]["n"], r[0]["ini"], r[0]["fim"], r[0]["pesagem"]), (1, "2026-09-29", "2026-10-05", "2026-10-06"))
        self.assertEqual(r[1]["n"], 1)
        self.assertEqual((r[2]["n"], r[2]["ini"], r[2]["fim"]), (2, "2026-10-06", "2026-10-12"))
        self.assertEqual((r[3]["n"], r[3]["fim"], r[3]["pesagem"]), (3, "2026-10-17", "2026-10-17"))

    def test_fuso_los_angeles(self):
        # 2026-10-01 06:30 UTC = 30/09 23:30 em LA; 2026-11-01 08:30 UTC (fim do horário de verão) = 01/11 00:30/01:30
        casos = ["2026-10-01T06:30:00Z", "2026-10-01T07:30:00Z", "2026-11-01T07:30:00Z", "2026-11-01T08:30:00Z",
                 "2026-11-02T07:59:00Z", "2026-11-02T08:01:00Z", "2026-03-08T09:59:00Z", "2026-03-08T10:01:00Z"]
        j = js([f"N.hojeLA(new Date({json.dumps(c)}))" for c in casos])
        py = [hoje_la(datetime.datetime.fromisoformat(c.replace("Z", "+00:00"))).isoformat() for c in casos]
        self.assertEqual(j, py)
        self.assertEqual(py[0], "2026-09-30")
        self.assertEqual(py[4], "2026-11-01")   # 23:59 PST ainda é dia 1
        self.assertEqual(py[5], "2026-11-02")


class Fechamento(CopiaRepo):
    def test_virada_nos_dois_horarios(self):
        """O fechamento decide o dia pelo calendário de LA — igual no verão (PDT) e no inverno (PST)."""
        import os
        d = self.dia_aberto()
        amanha = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat()
        r = self.rodar("fechar_dia.py", env={"HOJE": amanha}, check=True)
        self.assertIn(f"fechado: {d}", r.stdout)
        r2 = self.rodar("fechar_dia.py", env={"HOJE": amanha}, check=True)
        self.assertNotIn("fechado:", r2.stdout)          # repetido: nada muda
        self.assertNotIn("criado:", r2.stdout)
        self.assertSemErros()
        self.assertNotIn("registro", self.ler(f"{d}.json"))   # dia sem refeição: não vira completo sozinho

    def test_fechar_marca_completo_por_padrao(self):
        """Decisão do Lucas (02/10): à meia-noite o dia vira 'completo', salvo aviso de parcial ou dia quase vazio."""
        d = self.dia_aberto()
        amanha = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat()
        x = self.ler(f"{d}.json")
        meta = x["meta"]["kcal"]
        from item import esperado as valores
        banana = self.ler("alimentos.json")["banana"]

        def com_kcal(kcal, registro=None):
            y = json.loads(json.dumps(x))
            y["lancado"] = []
            if kcal is not None:
                q = round(kcal / banana["kcal"], 2)
                it = dict(nome="Banana", qtd=f"{q:g} un", alimento="banana", quantidade=q, **valores(banana, q))
                y["lancado"] = [{"refeicao": "Almoço", "itens": [it]}]
            y.pop("registro", None)
            if registro:
                y["registro"] = {"status": registro, "em": "2026-10-01T22:00:00-07:00"}
            return y

        casos = [(meta * 0.9, None, "completo"),          # dia lançado normal → completo automático
                 (meta * 0.5, None, "completo"),          # no limite (50%) → completo
                 (meta * 0.3, None, None),                # pouco lançado: provável esquecimento → desconhecido
                 (None, None, None),                      # nenhuma refeição → desconhecido
                 (meta * 0.9, "parcial", "parcial"),      # Lucas avisou parcial → respeita
                 (meta * 0.3, "completo", "completo")]    # Lucas confirmou completo → respeita
        for kcal, antes, esperado in casos:
            with self.subTest(kcal=kcal, antes=antes):
                self.gravar(f"{d}.json", com_kcal(kcal, antes))
                (self.dados / f"{amanha}.json").unlink(missing_ok=True)
                r = self.rodar("fechar_dia.py", env={"HOJE": amanha}, check=True)
                self.assertIn(f"fechado: {d}", r.stdout)
                reg = self.ler(f"{d}.json").get("registro")
                self.assertEqual(reg and reg["status"], esperado, r.stdout)
                if esperado and not antes:
                    self.assertIn("automático", reg["obs"])
                    self.assertIn("registro completo (automático)", r.stdout)
                if esperado is None:
                    self.assertIn("registro não confirmado", r.stdout)
                self.assertSemErros()

    def test_agendamentos_na_troca_de_horario(self):
        """Execuções reais do GitHub (07:05, 08:05 e 08:35 UTC) na noite em que acaba o horário de verão
        (1º/11/2026): às 07:05 UTC ainda é 23:05 de 1º/11 em LA — não pode abrir o dia 2."""
        seq = [("2026-11-02T07:05:00+00:00", "2026-11-01", True),   # 23:05 PST de 1º/11
               ("2026-11-02T08:05:00+00:00", "2026-11-02", True),   # 00:05 PST de 2/11: vira o dia
               ("2026-11-02T08:35:00+00:00", "2026-11-02", False)]  # segunda tentativa: nada a fazer
        for agora, esperado, muda in seq:
            r = self.rodar("fechar_dia.py", env={"AGORA_UTC": agora}, check=True)
            self.assertEqual(self.dia_aberto(), esperado, f"{agora}: {r.stdout}")
            self.assertEqual("criado:" in r.stdout, muda, f"{agora}: {r.stdout}")
        self.derivados()
        self.assertSemErros()
        # no inverno (PST) a execução das 07:05 UTC é 23:05 do dia anterior em LA: não vira o dia
        r = self.rodar("fechar_dia.py", env={"AGORA_UTC": "2026-11-03T07:05:00+00:00"}, check=True)
        self.assertEqual(self.dia_aberto(), "2026-11-02", "07:05 UTC de 3/11 ainda é 23:05 PST de 2/11")


if __name__ == "__main__":
    unittest.main()
