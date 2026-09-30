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
        self.assertNotIn("registro", self.ler(f"{d}.json"))   # fechar ≠ completo


if __name__ == "__main__":
    unittest.main()
