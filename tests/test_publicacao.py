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


class BasePublicacao(unittest.TestCase):
    """Remoto git local + dois clones (a, b) — sem testes, para outras suítes reaproveitarem."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="nutri-pub-"))
        fonte = self.tmp / "fonte"
        # o estado ATUAL do checkout, inclusive arquivos novos ainda não commitados (não ignorados): no CI, o
        # fechamento da meia-noite cria dados/<dia novo>.json antes dos testes — copiar só os rastreados
        # deixava dias.json/index.html apontando para um dia sem arquivo (falhou na virada 30/09 → 01/10)
        arquivos = git(RAIZ, "ls-files", "--cached", "--others", "--exclude-standard").splitlines()
        for rel in set(arquivos):
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



class Publicacao(BasePublicacao):
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
        self.assertEqual(msg, f"fechar {d[8:10]}/{d[5:7]} (automático)")   # data certa, sem GNU date
        out2, _ = self.publicar(self.a, preparo="python3 scripts/fechar_dia.py", HOJE=amanha)
        self.assertEqual(out2["mudou"], "nao")
        c = self.conferir_remoto()
        self.assertTrue(json.loads((c / "dados" / f"{d}.json").read_text())["fechado"])
        self.assertIn(f'data-dia="{amanha}"', (c / "index.html").read_text())
        # fechar não marca o registro como completo
        self.assertNotIn("registro", json.loads((c / "dados" / f"{d}.json").read_text()))

    def test_push_durante_o_dia_com_fechamento_nao_muda_nada(self):
        """Item 9: toda execução na main roda o fechamento; num push comum (dia já aberto) ele não faz nada."""
        self.publicar(self.a)                                  # derivados em dia
        d = self.dia_aberto(self.a)
        out, _ = self.publicar(self.a, preparo="python3 scripts/fechar_dia.py", HOJE=d)
        self.assertEqual(out["mudou"], "nao")

    def test_push_que_substitui_o_agendamento_fecha_o_dia(self):
        """Se o agendamento da meia-noite se perder, o próximo push (mesmo fluxo, com fechamento) fecha o dia."""
        d = self.dia_aberto(self.a)
        import datetime
        amanha = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat()
        self.editar_dia_cru(self.b, 105, "Lanche da manhã seguinte")   # push "normal" de outra pessoa
        out, _ = self.publicar(self.a, preparo="python3 scripts/fechar_dia.py", HOJE=amanha)
        self.assertEqual(out["mudou"], "sim")
        c = self.conferir_remoto()
        self.assertTrue(json.loads((c / "dados" / f"{d}.json").read_text())["fechado"])
        self.assertIn(f'data-dia="{amanha}"', (c / "index.html").read_text())

    def test_testes_rodam_no_meio_da_virada(self):
        """Regressão 01/10: no CI, fechar_dia cria o dia novo (ainda não commitado) e SÓ DEPOIS os testes rodam.
        A suíte copiava só arquivos rastreados → dia novo sumia da cópia → 3 agendamentos da meia-noite falharam."""
        import datetime
        d = self.dia_aberto(self.a)
        amanha = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat()
        r = subprocess.run([sys.executable, "scripts/fechar_dia.py"], cwd=self.a, capture_output=True, text=True,
                           env=dict(os.environ, HOJE=amanha))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(f"dados/{amanha}.json", git(self.a, "status", "--porcelain", "--untracked-files=all"))
        # a suíte de publicação, rodando a partir do checkout "no meio da virada", tem que ver o dia novo
        r = subprocess.run([sys.executable, "-m", "unittest", "test_publicacao.Publicacao.test_idempotente"],
                           cwd=self.a / "tests", capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class Workflow(unittest.TestCase):
    """Item 9: a fila preserva pendentes e todo run da main fecha o dia (checagem do arquivo, sem PyYAML)."""

    def test_fila_e_fechamento(self):
        wf = (RAIZ / ".github" / "workflows" / "publicar.yml").read_text(encoding="utf-8")
        self.assertRegex(wf, r"(?m)^concurrency:\n(?:  .*\n)*?  queue: max$")
        self.assertNotRegex(wf, r"(?m)^\s*cancel-in-progress:\s*true")   # (o comentário que cita pode ficar)
        self.assertRegex(wf, r"(?m)^\s+PREPARO: python3 scripts/fechar_dia\.py$")
        self.assertNotIn("date -d", (RAIZ / "scripts" / "publicar.sh").read_text(encoding="utf-8"))

    def test_navegadores_pela_imagem_e_caminho_rapido(self):
        """Sem "playwright install --with-deps" (apt: 43 s a 23 min); rápida pula testes e páginas, nunca o validar."""
        wf = (RAIZ / ".github" / "workflows" / "publicar.yml").read_text(encoding="utf-8")
        self.assertNotIn("--with-deps", wf)
        self.assertEqual(wf.count("PAGINAS_IMAGEM: mcr.microsoft.com/playwright:v1.56.1-noble"), 2)   # PR e main
        self.assertIn("SEM_TESTES: ${{ steps.tipo.outputs.modo == 'rapida' && '1' || '' }}", wf)
        sh = (RAIZ / "scripts" / "verificar.sh").read_text(encoding="utf-8")
        self.assertLess(sh.index("python3 scripts/validar.py"), sh.index('if [ "${SEM_TESTES'), "validar roda sempre, antes")


if __name__ == "__main__":
    unittest.main()
