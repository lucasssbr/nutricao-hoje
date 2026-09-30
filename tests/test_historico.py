"""Histórico: correção em dia recente aparece mesmo com plano futuro cadastrado (e resumo ainda velho)."""
import datetime
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import unittest

from base import RAIZ, CopiaRepo
from comum import hoje_la

NODE = shutil.which("node")
TEM_PW = (RAIZ / "node_modules" / "playwright").exists()


def porta_livre():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@unittest.skipUnless(NODE and TEM_PW, "node/playwright não instalados")
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

        porta = porta_livre()
        serv = subprocess.Popen([sys.executable, "-m", "http.server", str(porta)], cwd=self.tmp,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(0.8)
            js = f"""
const pw=require('playwright');(async()=>{{const b=await pw.chromium.launch();const p=await b.newPage();
await p.goto('http://localhost:{porta}/historico.html',{{waitUntil:'networkidle'}});await p.waitForTimeout(300);
const t=await p.locator('#histList a[href$="{ontem}"] .d').innerText();console.log(t);await b.close();}})();"""
            env = dict(os.environ, NODE_PATH=str(RAIZ / "node_modules"))
            out = subprocess.check_output([NODE, "-e", js], text=True, env=env, timeout=60).strip()
        finally:
            serv.terminate()
        self.assertIn(f"{kcal_certo} kcal", out, f"Histórico mostrou {out!r}; esperado {kcal_certo} kcal (valor corrigido)")


if __name__ == "__main__":
    unittest.main()
