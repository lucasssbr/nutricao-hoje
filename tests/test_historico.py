"""Histórico: correção em dia recente aparece mesmo com plano futuro cadastrado (e resumo ainda velho)."""
import datetime
import json
import os
import shutil
import subprocess
import sys
import time
import unittest

from base import RAIZ, CopiaRepo, rodar_node
from comum import hoje_la

NODE = shutil.which("node")
TEM_PW = (RAIZ / "node_modules" / "playwright").exists()



@unittest.skipUnless((NODE and TEM_PW) or os.environ.get("TESTES_IMAGEM"), "node/playwright não instalados")
class HistoricoComPlanoFuturo(CopiaRepo):
    def test_correcao_recente_com_plano_futuro(self):
        sys.path.insert(0, str(self.tmp / "scripts"))
        from item import esperado
        hoje = hoje_la()
        ontem = (hoje - datetime.timedelta(days=1)).isoformat()
        futuro = (hoje + datetime.timedelta(days=17)).isoformat()
        base = self.ler(f"{self.dia_aberto()}.json")
        ali = self.ler("alimentos.json")

        def dia(d, fechado, lancado, sugestao=()):
            x = json.loads(json.dumps(base))
            x.update(data=d, fechado=fechado, lancado=list(lancado), sugestao=list(sugestao), atualizado="2026-09-30T08:00:00-07:00")
            x.pop("registro", None)
            return x

        banana = lambda q: {"nome": "Banana", "qtd": f"{q} un", "alimento": "banana", "quantidade": q, **esperado(ali["banana"], q)}
        self.gravar(f"{ontem}.json", dia(ontem, True, [{"refeicao": "Café", "itens": [banana(1)]}]))
        self.gravar(f"{futuro}.json", dia(futuro, False, [], [{"refeicao": "Plano", "itens": [banana(2)]}]))
        dias = sorted(set(self.ler("dias.json")) | {ontem, futuro})
        self.gravar("dias.json", dias)
        self.derivados()                                   # resumo em dia com 1 banana ontem
        # correção atrasada em ONTEM, sem regenerar o resumo (o servidor ainda não rodou)
        d = self.ler(f"{ontem}.json")
        d["lancado"].append({"refeicao": "Lanche (atrasado)", "itens": [banana(3)]})
        self.gravar(f"{ontem}.json", d)
        kcal_certo = round(sum(i["kcal"] for r in d["lancado"] for i in r["itens"]))

        pronto = self.tmp / ".pronto"
        serv = subprocess.Popen([sys.executable, str(self.tmp / "scripts" / "servidor_teste.py"), "--raiz", str(self.tmp),
                                 "--token", "hist", "--pronto", str(pronto)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):                      # espera o PRÓPRIO servidor ficar pronto (sem sleep fixo)
                if pronto.exists() and pronto.read_text():
                    break
                self.assertIsNone(serv.poll(), "servidor de teste não iniciou")
                time.sleep(0.05)
            porta = int(pronto.read_text())
            import urllib.request
            ident = urllib.request.urlopen(f"http://127.0.0.1:{porta}/__servidor_teste__", timeout=5).read().decode()
            self.assertEqual(ident, f"hist {self.tmp.resolve()}")
            js = f"""
const pw=require('playwright');(async()=>{{const b=await pw.chromium.launch();const p=await b.newPage();
await p.goto('http://127.0.0.1:{porta}/historico.html',{{waitUntil:'networkidle'}});await p.waitForTimeout(300);
const t=await p.locator('#histList a[href$="{ontem}"] .d').innerText();console.log(t);await b.close();}})();"""
            out = rodar_node(js)
        finally:
            serv.terminate()
        self.assertIn(f"{kcal_certo} kcal", out, f"Histórico mostrou {out!r}; esperado {kcal_certo} kcal (valor corrigido)")


if __name__ == "__main__":
    unittest.main()
