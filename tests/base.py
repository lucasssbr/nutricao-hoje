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

# tudo que o site e os scripts usam (páginas, JS, CSS, dados, scripts)
COPIAR = ["dados", "scripts"] + sorted(p.name for p in RAIZ.iterdir()
                                       if p.suffix in (".html", ".js", ".css", ".webmanifest", ".png"))


def rodar_node(js, montar=(), timeout=60):
    """Roda `node -e js` com o Playwright. Com TESTES_IMAGEM (o GitHub: verificar.sh repassa a imagem oficial do
    Playwright), roda dentro da imagem — a máquina não tem navegadores instalados; senão, no node local."""
    import os
    nm = os.path.realpath(RAIZ / "node_modules")
    imagem = os.environ.get("TESTES_IMAGEM")
    if imagem:
        vols = []
        for d in {nm, *map(str, montar)}:
            vols += ["-v", f"{d}:{d}"]
        cmd = ["docker", "run", "--rm", "--network", "host", "--user", f"{os.getuid()}:{os.getgid()}",
               "-e", "HOME=/tmp", "-e", f"NODE_PATH={nm}", *vols, imagem, "node", "-e", js]
        return subprocess.check_output(cmd, text=True, timeout=timeout + 60).strip()
    return subprocess.check_output(["node", "-e", js], text=True, timeout=timeout,
                                   env=dict(os.environ, NODE_PATH=nm)).strip()


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
