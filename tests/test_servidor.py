"""Servidor dos testes de página (revisão Codex #5, item 8): porta exclusiva, identidade conferida, falha visível.

Um servidor ANTIGO ocupando a porta (de outro checkout) não pode ser aceito como se fosse o desta execução.
"""
import http.server
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request

from base import RAIZ, CopiaRepo


def servidor_intruso():
    """Um http.server qualquer (outro checkout) ocupando uma porta."""
    outro = tempfile.mkdtemp(prefix="outro-checkout-")
    pathlib.Path(outro, "index.html").write_text("<html>checkout antigo</html>")

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=outro, **k)

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class ServidorTeste(unittest.TestCase):
    def rodar_servidor(self, porta=0):
        pronto = tempfile.mktemp()
        p = subprocess.Popen([sys.executable, str(RAIZ / "scripts" / "servidor_teste.py"), "--raiz", str(RAIZ),
                              "--token", "tok123", "--pronto", pronto, "--porta", str(porta)],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return p, pronto

    def test_porta_livre_e_identidade(self):
        p, pronto = self.rodar_servidor()
        try:
            for _ in range(100):
                if os.path.exists(pronto) and pathlib.Path(pronto).read_text():
                    break
                p.poll()
                self.assertIsNone(p.returncode, p.stderr.read() if p.returncode is not None else "")
                import time
                time.sleep(0.05)
            porta = int(pathlib.Path(pronto).read_text())
            ident = urllib.request.urlopen(f"http://127.0.0.1:{porta}/__servidor_teste__", timeout=5).read().decode()
            self.assertEqual(ident, f"tok123 {RAIZ.resolve()}")
            html = urllib.request.urlopen(f"http://127.0.0.1:{porta}/index.html", timeout=5).read().decode()
            self.assertIn("data-dia", html)
        finally:
            p.terminate()
            p.wait(5)
            p.stdout.close()
            p.stderr.close()
            if os.path.exists(pronto):
                os.unlink(pronto)

    def test_porta_ocupada_falha(self):
        intruso = servidor_intruso()
        try:
            p, pronto = self.rodar_servidor(intruso.server_address[1])
            p.wait(10)
            self.assertEqual(p.returncode, 1)
            self.assertIn("não consegui abrir a porta", p.stderr.read())
            p.stdout.close()
            p.stderr.close()
        finally:
            intruso.shutdown()
            intruso.server_close()


class VerificarSh(CopiaRepo):
    def test_verificar_nao_testa_servidor_de_outro_checkout(self):
        """PORTA apontando para uma porta ocupada por outro servidor: verificar.sh FALHA antes das páginas."""
        intruso = servidor_intruso()
        try:
            env = dict(os.environ, SEM_TESTES="1", PORTA=str(intruso.server_address[1]), NAVEGADORES="chromium")
            r = subprocess.run(["bash", str(self.tmp / "scripts" / "verificar.sh")], cwd=self.tmp,
                               capture_output=True, text=True, env=env, timeout=120)
        finally:
            intruso.shutdown()
            intruso.server_close()
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("páginas NÃO testadas", r.stderr)
        self.assertNotIn("Páginas OK", r.stdout)


if __name__ == "__main__":
    unittest.main()
