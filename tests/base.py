"""Base dos testes: cada teste roda numa CÓPIA temporária do repositório (dados reais), nunca no original."""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))

COPIAR = ["dados", "scripts", "index.html", "dia.html", "historico.html", "alimentos.html"]


class CopiaRepo(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="nutri-teste-"))
        for nome in COPIAR:
            src = RAIZ / nome
            if src.is_dir():
                shutil.copytree(src, self.tmp / nome, ignore=shutil.ignore_patterns("__pycache__"))
            else:
                shutil.copy2(src, self.tmp / nome)
        self.dados = self.tmp / "dados"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # helpers
    def ler(self, nome):
        return json.loads((self.dados / nome).read_text(encoding="utf-8"))

    def gravar(self, nome, obj):
        (self.dados / nome).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def gravar_texto(self, nome, texto):
        (self.dados / nome).write_text(texto, encoding="utf-8")

    def rodar(self, script, *args, check=False, env=None):
        import os
        e = dict(os.environ)
        e.update(env or {})
        r = subprocess.run([sys.executable, str(self.tmp / "scripts" / script), *args],
                           cwd=self.tmp, capture_output=True, text=True, env=e)
        if check and r.returncode:
            self.fail(f"{script} {args} falhou:\n{r.stdout}\n{r.stderr}")
        return r

    def validar(self):
        from validar import validar
        return validar(self.tmp)

    def derivados(self):
        return self.rodar("derivados.py", check=True)

    def assertErro(self, trecho):
        c = self.validar()
        self.assertTrue(any(trecho in e for e in c.erros), f"esperava erro com {trecho!r}; erros: {c.erros}")

    def assertSemErros(self):
        c = self.validar()
        self.assertEqual(c.erros, [], "\n".join(c.erros))
        return c

    def dia_aberto(self):
        idx = (self.tmp / "index.html").read_text(encoding="utf-8")
        import re
        return re.search(r'data-dia="([\d-]+)"', idx).group(1)
