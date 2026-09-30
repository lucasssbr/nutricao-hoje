"""Publicação: idempotência, corrida entre dois envios e fechamento repetido — com um remoto git local."""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent.parent


def git(cwd, *args, check=True):
    r = subprocess.run(["git", "-c", "user.name=teste", "-c", "user.email=t@t", *args], cwd=cwd,
                       capture_output=True, text=True)
    if check and r.returncode:
        raise AssertionError(f"git {args}: {r.stdout}{r.stderr}")
    return r.stdout.strip()


def dia_aberto(clone):
    import re
    return re.search(r'data-dia="([\d-]+)"', (pathlib.Path(clone) / "index.html").read_text()).group(1)


def editar_dia_cru(clone, kcal_extra, msg):
    """Simula um envio 'cru' (sem regenerar derivados): acrescenta uma refeição válida ao dia aberto."""
    clone = pathlib.Path(clone)
    sys.path.insert(0, str(clone / "scripts"))
    from item import esperado
    d = dia_aberto(clone)
    p = clone / "dados" / f"{d}.json"
    dia = json.loads(p.read_text())
    ali = json.loads((clone / "dados" / "alimentos.json").read_text())
    q = kcal_extra / ali["banana"]["kcal"]
    dia["lancado"].append({"refeicao": msg, "itens": [dict(nome="Banana", qtd=f"{q:g} un", alimento="banana",
                                                            quantidade=q, **esperado(ali["banana"], q))]})
    p.write_text(json.dumps(dia, ensure_ascii=False, indent=2) + "\n")
    git(clone, "add", "-A")
    git(clone, "commit", "-q", "-m", msg)
    git(clone, "push", "-q", "origin", "HEAD:main")
    return d


class Publicacao(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="nutri-pub-"))
        fonte = self.tmp / "fonte"
        arquivos = git(RAIZ, "ls-files").splitlines()
        # inclui arquivos novos ainda não commitados desta rodada (scripts/tests)
        extra = [str(p.relative_to(RAIZ)) for p in list((RAIZ / "scripts").glob("*")) + list((RAIZ / "tests").glob("*.py"))]
        for rel in set(arquivos + extra):
            src = RAIZ / rel
            if src.is_file():
                (fonte / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, fonte / rel)
        git(fonte, "init", "-q", "-b", "main")
        git(fonte, "add", "-A")
        git(fonte, "commit", "-q", "-m", "base")
        self.remoto = self.tmp / "remoto.git"
        git(self.tmp, "clone", "-q", "--bare", str(fonte), str(self.remoto))
        self.a = self.tmp / "a"
        self.b = self.tmp / "b"
        git(self.tmp, "clone", "-q", str(self.remoto), str(self.a))
        git(self.tmp, "clone", "-q", str(self.remoto), str(self.b))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def publicar(self, clone, preparo="", **env):
        saida = self.tmp / f"saida-{os.getpid()}-{len(list(self.tmp.iterdir()))}"
        e = dict(os.environ, SEM_PAGINAS="1", SEM_TESTES="1", GITHUB_OUTPUT=str(saida), PREPARO=preparo,
                 TENTATIVAS="4", **env)
        r = subprocess.run(["bash", "scripts/publicar.sh"], cwd=clone, capture_output=True, text=True, env=e)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        out = dict(l.split("=", 1) for l in saida.read_text().split() if "=" in l)
        return out, r.stdout

    def dia_aberto(self, clone):
        return dia_aberto(clone)

    def editar_dia_cru(self, clone, kcal_extra, msg):
        return editar_dia_cru(clone, kcal_extra, msg)

    def conferir_remoto(self):
        """Clona o remoto e confere: dados válidos e resumo igual ao que os dias geram."""
        c = self.tmp / f"conf-{len(list(self.tmp.iterdir()))}"
        git(self.tmp, "clone", "-q", str(self.remoto), str(c))
        r = subprocess.run([sys.executable, "scripts/validar.py"], cwd=c, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)
        return c

    def test_idempotente(self):
        self.publicar(self.a)
        n1 = git(self.a, "rev-list", "--count", "origin/main")
        out, _ = self.publicar(self.a)
        self.assertEqual(out["mudou"], "nao")
        git(self.a, "fetch", "-q")
        self.assertEqual(git(self.a, "rev-list", "--count", "origin/main"), n1)

    def test_corrida_regenera_sobre_head_novo(self):
        # 1) alguém manda um dia sem regenerar o resumo (derivado fica velho no remoto)
        self.editar_dia_cru(self.b, 105, "Lanche 1")
        # 2) A publica; no meio (depois de sincronizar), B manda outra refeição → push de A é recusado
        gatilho = self.tmp / "gatilho"
        py = sys.executable
        preparo = (f"if [ ! -f {gatilho} ]; then touch {gatilho}; cd {self.b} && git pull -q && "
                   f"{py} -c \"import sys; sys.path.insert(0, 'tests'); import test_publicacao as t; "
                   f"import pathlib; t.editar_dia_cru('{self.b}', 210, 'Lanche 2')\"; fi")
        out, log = self.publicar(self.a, preparo=preparo)
        self.assertIn("push recusado", log)
        c = self.conferir_remoto()
        resumo = json.loads((c / "dados" / "resumo.json").read_text())
        d = self.dia_aberto(c)
        dia = json.loads((c / "dados" / f"{d}.json").read_text())
        nomes = [r["refeicao"] for r in dia["lancado"]]
        self.assertIn("Lanche 1", nomes)
        self.assertIn("Lanche 2", nomes)
        kcal_dia = round(sum(i["kcal"] for r in dia["lancado"] for i in r["itens"]), 1)
        self.assertEqual(next(x for x in resumo if x["data"] == d)["cons"]["kcal"], kcal_dia)

    def test_fechamento_repetido(self):
        d = self.dia_aberto(self.a)
        import datetime
        amanha = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat()
        out1, _ = self.publicar(self.a, preparo="python3 scripts/fechar_dia.py", HOJE=amanha)
        self.assertEqual(out1["mudou"], "sim")
        msg = git(self.a, "log", "-1", "--format=%s", "origin/main")
        self.assertTrue(msg.startswith("fechar "), msg)
        out2, _ = self.publicar(self.a, preparo="python3 scripts/fechar_dia.py", HOJE=amanha)
        self.assertEqual(out2["mudou"], "nao")
        c = self.conferir_remoto()
        self.assertTrue(json.loads((c / "dados" / f"{d}.json").read_text())["fechado"])
        self.assertIn(f'data-dia="{amanha}"', (c / "index.html").read_text())
        # fechar não marca o registro como completo
        self.assertNotIn("registro", json.loads((c / "dados" / f"{d}.json").read_text()))


if __name__ == "__main__":
    unittest.main()
