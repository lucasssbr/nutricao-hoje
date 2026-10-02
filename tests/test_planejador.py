"""Planejador (planejador.js): mesmas contas e regras do Python — paridade rodando o JS real no Node.

Se divergir, o planejador mostraria números diferentes do registro/sugestão oficiais (proibido)."""
import json
import random
import shutil
import subprocess
import sys
import unittest

from base import RAIZ

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

    def test_alimento_fora_da_biblioteca(self):
        v = js("P.item(c.ali, 'nao-existe', 100)", [{"ali": self.ali}])[0]
        self.assertIn("não está mais na biblioteca", v["erro"])


if __name__ == "__main__":
    unittest.main()
