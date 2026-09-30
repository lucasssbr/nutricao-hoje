"""scripts/pages.py: o workflow não pode "passar verde" quando a consulta/publicação do Pages falha.

Servidor HTTP falso local responde como a API do GitHub: legacy, workflow, 403, 500 (transitório e persistente),
JSON inválido e build_type desconhecido.
"""
import http.server
import json
import os
import subprocess
import sys
import threading
import unittest

from base import RAIZ


class Falso(http.server.BaseHTTPRequestHandler):
    respostas = []   # fila de (status, corpo) por chamada
    chamadas = []

    def _responder(self):
        Falso.chamadas.append((self.command, self.path, self.headers.get("Authorization")))
        status, corpo = Falso.respostas.pop(0) if Falso.respostas else (599, "sem resposta configurada")
        dados = corpo.encode() if isinstance(corpo, str) else json.dumps(corpo).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    do_GET = _responder
    do_POST = _responder

    def log_message(self, *a):
        pass


class Pages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Falso)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.api = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def rodar(self, cmd, respostas):
        Falso.respostas = list(respostas)
        Falso.chamadas = []
        env = dict(os.environ, GITHUB_API_URL=self.api, GITHUB_REPOSITORY="dono/repo", GH_TOKEN="tok",
                   PAGES_TENTATIVAS="3", PAGES_ESPERA="0")
        return subprocess.run([sys.executable, str(RAIZ / "scripts" / "pages.py"), cmd],
                              capture_output=True, text=True, env=env)

    def test_modos_validos(self):
        for tipo in ("legacy", "workflow"):
            r = self.rodar("modo", [(200, {"build_type": tipo, "source": {"branch": "main"}})])
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(r.stdout.strip(), tipo)
        self.assertEqual(Falso.chamadas[0][:2], ("GET", "/repos/dono/repo/pages"))
        self.assertEqual(Falso.chamadas[0][2], "Bearer tok")

    def test_403_falha_sem_repetir(self):
        r = self.rodar("modo", [(403, {"message": "Resource not accessible by integration"})])
        self.assertEqual(r.returncode, 1)
        self.assertIn("HTTP 403", r.stderr)
        self.assertEqual(len(Falso.chamadas), 1, "4xx não deve ser repetido")
        self.assertEqual(r.stdout.strip(), "", "erro não pode virar um modo")

    def test_500_transitorio_repete_e_passa(self):
        r = self.rodar("modo", [(500, "erro"), (502, "erro"), (200, {"build_type": "workflow"})])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "workflow")
        self.assertEqual(len(Falso.chamadas), 3)

    def test_500_persistente_falha(self):
        r = self.rodar("modo", [(500, "erro")] * 3)
        self.assertEqual(r.returncode, 1)
        self.assertIn("depois de 3 tentativas", r.stderr)
        self.assertEqual(r.stdout.strip(), "")

    def test_json_invalido_e_tipo_desconhecido(self):
        r = self.rodar("modo", [(200, "<html>oops</html>")])
        self.assertEqual(r.returncode, 1)
        self.assertIn("não é JSON", r.stderr)
        for corpo in ({"build_type": None}, {"build_type": "branch"}, {}, [1, 2]):
            r = self.rodar("modo", [(200, corpo)])
            self.assertEqual(r.returncode, 1, f"{corpo} deveria falhar")
            self.assertEqual(r.stdout.strip(), "")

    def test_pedir_build(self):
        r = self.rodar("pedir-build", [(201, {"status": "queued"})])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(Falso.chamadas[0][:2], ("POST", "/repos/dono/repo/pages/builds"))
        r = self.rodar("pedir-build", [(403, {"message": "no"})])
        self.assertEqual(r.returncode, 1)
        r = self.rodar("pedir-build", [(503, "x")] * 3)
        self.assertEqual(r.returncode, 1)

    def test_workflow_nao_mascara_erro(self):
        wf = (RAIZ / ".github" / "workflows" / "publicar.yml").read_text(encoding="utf-8")
        self.assertIn("python3 scripts/pages.py modo", wf)
        self.assertIn("python3 scripts/pages.py pedir-build", wf)
        self.assertNotIn("|| true", wf)
        self.assertNotIn("Não consegui pedir a publicação", wf)
        self.assertIn("steps.modo.outputs.tipo == 'legacy'", wf)


if __name__ == "__main__":
    unittest.main()
