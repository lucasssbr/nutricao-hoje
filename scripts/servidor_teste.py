#!/usr/bin/env python3
"""Servidor HTTP estático só para os testes de página — exclusivo desta execução.

  python3 scripts/servidor_teste.py --raiz . --token <aleatório> --pronto <arquivo> [--porta N]

- Sem --porta (padrão), o sistema escolhe uma porta LIVRE (nunca reaproveita um servidor antigo).
- Com --porta ocupada, falha na hora (exit 1) — quem chamou não pode seguir testando outro servidor.
- Quando estiver ouvindo, grava a porta em --pronto.
- GET /__servidor_teste__ responde "<token> <raiz absoluta>", para o chamador conferir que é o SEU
  servidor servindo o checkout certo.
"""
import argparse
import functools
import http.server
import pathlib
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    token = ""
    raiz = ""

    def do_GET(self):
        if self.path == "/__servidor_teste__":
            corpo = f"{self.token} {self.raiz}".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        super().do_GET()

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raiz", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--pronto", required=True)
    ap.add_argument("--porta", type=int, default=0)
    a = ap.parse_args()
    raiz = str(pathlib.Path(a.raiz).resolve())
    Handler.token, Handler.raiz = a.token, raiz
    try:
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.porta), functools.partial(Handler, directory=raiz))
    except OSError as e:
        print(f"servidor de teste: não consegui abrir a porta {a.porta} ({e})", file=sys.stderr)
        return 1
    pathlib.Path(a.pronto).write_text(str(srv.server_address[1]))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
