"""Caminho rápido da publicação (scripts/modo_verificacao.py + CODIGO_BASE no publicar.sh).

Rápido (sem navegadores) só quando o código fora de dados/ é idêntico ao commit que está no ar. Qualquer
dúvida → completa. E se aparecer código novo no HEAD durante a fila, a execução rápida não publica.
"""
import http.server
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest

from test_publicacao import BasePublicacao, git, editar_dia_cru

RAIZ = pathlib.Path(__file__).resolve().parent.parent


class Site:
    """Servidor local fazendo o papel do GitHub Pages (só publicado.json)."""

    def __init__(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="site-"))
        d = str(self.dir)

        class H(http.server.SimpleHTTPRequestHandler):
            def __init__(s, *a, **k):
                super().__init__(*a, directory=d, **k)

            def log_message(s, *a):
                pass
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"

    def publicar(self, sha):
        (self.dir / "publicado.json").write_text(json.dumps({"sha": sha}))

    def fechar(self):
        self.srv.shutdown()
        self.srv.server_close()


class Modo(BasePublicacao):
    def setUp(self):
        super().setUp()
        self.site = Site()

    def tearDown(self):
        self.site.fechar()
        super().tearDown()

    def decidir(self, evento="push"):
        saida = self.tmp / "modo.out"
        saida.write_text("")
        git(self.a, "fetch", "-q", "origin")
        r = subprocess.run([sys.executable, "scripts/modo_verificacao.py"], cwd=self.a, capture_output=True, text=True,
                           env=dict(os.environ, GITHUB_EVENT_NAME=evento, SITE_URL=self.site.url,
                                    GITHUB_OUTPUT=str(saida), GITHUB_REPOSITORY="dono/repo"))
        self.assertEqual(r.returncode, 0, r.stderr)
        return dict(l.split("=", 1) for l in saida.read_text().split("\n") if "=" in l), r.stdout

    def mudar_codigo(self, clone):
        f = pathlib.Path(clone) / "render.js"
        f.write_text(f.read_text() + "\n// mudança de código\n")
        git(clone, "add", "-A")
        git(clone, "commit", "-q", "-m", "código")
        git(clone, "push", "-q", "origin", "HEAD:main")

    def test_so_dados_mudaram_e_rapida(self):
        no_ar = git(self.a, "rev-parse", "HEAD")
        self.site.publicar(no_ar)
        editar_dia_cru(self.b, 105, "Lanche")           # log do Grok
        out, txt = self.decidir()
        self.assertEqual(out["modo"], "rapida", txt)
        self.assertEqual(out["base"], no_ar)

    def test_codigo_mudou_e_completa(self):
        self.site.publicar(git(self.a, "rev-parse", "HEAD"))
        self.mudar_codigo(self.b)
        out, txt = self.decidir()
        self.assertEqual(out["modo"], "completa")
        self.assertIn("render.js", txt)

    def test_duvida_vira_completa(self):
        sha = git(self.a, "rev-parse", "HEAD")
        self.site.publicar(sha)
        self.assertEqual(self.decidir("schedule")[0]["modo"], "completa", "meia-noite sempre completa")
        self.assertEqual(self.decidir("workflow_dispatch")[0]["modo"], "completa")
        (self.site.dir / "publicado.json").unlink()      # site sem publicado.json (ex.: modo branch)
        self.assertEqual(self.decidir()[0]["modo"], "completa")
        self.site.publicar("f" * 40)                     # sha que não existe no histórico
        self.assertEqual(self.decidir()[0]["modo"], "completa")
        (self.site.dir / "publicado.json").write_text("<html>")   # resposta que não é JSON
        self.assertEqual(self.decidir()[0]["modo"], "completa")
        self.site.fechar()                               # site fora do ar
        out, txt = self.decidir()
        self.assertEqual(out["modo"], "completa", txt)
        self.site = Site()

    def test_rapida_publica_dados(self):
        self.publicar(self.a)                            # derivados em dia
        no_ar = git(self.a, "rev-parse", "HEAD")
        editar_dia_cru(self.b, 105, "Lanche")
        out, _ = self.publicar(self.a, CODIGO_BASE=no_ar)
        self.assertEqual(out["pular"], "nao")
        self.assertEqual(out["mudou"], "sim")           # resumo regenerado e enviado
        c = self.conferir_remoto()
        self.assertIn("Lanche", (c / "dados").joinpath(f"{self.dia_aberto(c)}.json").read_text())

    def test_codigo_novo_na_fila_nao_e_publicado_pelo_caminho_rapido(self):
        no_ar = git(self.a, "rev-parse", "HEAD")
        self.mudar_codigo(self.b)                        # chegou código depois da decisão "rápida"
        antes = git(self.b, "rev-parse", "HEAD")
        out, txt = self.publicar(self.a, CODIGO_BASE=no_ar)
        self.assertEqual(out["pular"], "sim", txt)
        self.assertEqual(out["mudou"], "nao")
        self.assertEqual(git(self.a, "ls-remote", "origin", "main").split()[0], antes, "não pode ter enviado nada")

    def test_workflow_usa_o_caminho_rapido_com_seguranca(self):
        wf = (RAIZ / ".github" / "workflows" / "publicar.yml").read_text(encoding="utf-8")
        self.assertIn("python3 scripts/modo_verificacao.py", wf)
        self.assertIn("if: steps.tipo.outputs.modo != 'rapida'", wf)          # navegadores só na completa
        self.assertIn("SEM_PAGINAS: ${{ steps.tipo.outputs.modo == 'rapida' && '1' || '' }}", wf)
        self.assertIn("CODIGO_BASE: ${{ steps.tipo.outputs.base }}", wf)
        for passo in ("upload-pages-artifact", "deploy-pages"):
            i = wf.index(passo)
            self.assertIn("steps.pub.outputs.pular != 'sim'", wf[i:i + 200], passo)


class Esperar(BasePublicacao):
    """scripts/esperar_site.py: só diz 'pode atualizar' quando o site contém o commit."""

    def setUp(self):
        super().setUp()
        self.site = Site()

    def tearDown(self):
        self.site.fechar()
        super().tearDown()

    def esperar(self, sha, maximo="1"):
        return subprocess.run([sys.executable, "scripts/esperar_site.py", "--sha", sha, "--max", maximo,
                               "--intervalo", "0.2"], cwd=self.a, capture_output=True, text=True,
                              env=dict(os.environ, SITE_URL=self.site.url))

    def test_no_ar_igual_ou_descendente(self):
        meu = git(self.a, "rev-parse", "HEAD")
        self.site.publicar(meu)
        r = self.esperar(meu)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("pode atualizar", r.stdout)
        editar_dia_cru(self.b, 105, "Lanche")            # publicação pôs um commit por cima
        self.site.publicar(git(self.b, "rev-parse", "HEAD"))
        r = self.esperar(meu)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_ainda_nao_esta_no_ar(self):
        antigo = git(self.a, "rev-parse", "HEAD")
        self.site.publicar(antigo)
        editar_dia_cru(self.a, 105, "Lanche")            # log novo ainda não publicado
        r = self.esperar(git(self.a, "rev-parse", "HEAD"))
        self.assertEqual(r.returncode, 1)
        self.assertNotIn("pode atualizar", r.stdout)
        self.assertIn("está publicando", r.stderr)


if __name__ == "__main__":
    unittest.main()
