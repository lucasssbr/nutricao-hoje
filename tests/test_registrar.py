"""CLI de registro: eventos repetidos, dry-run, dia fechado, validação com rollback e envio com corrida."""
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

from base import RAIZ, CopiaRepo
from comum import hoje_la


class BaseRegistro(CopiaRepo):
    def reg(self, *args, check=None):
        r = self.rodar("registrar.py", *args)
        if check is True:
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        if check is False:
            self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        return r

    def hora_no_dia(self, d, hh="08:00"):
        # consumo sempre no passado: no dia de hoje usa 00:01
        return f"{d}T00:01" if d == hoje_la().isoformat() else f"{d}T{hh}"

    def setUp(self):
        super().setUp()
        self.derivados()
        self.d = self.dia_aberto()
        if self.d > hoje_la().isoformat():
            self.skipTest("dia aberto no futuro")

    def total_lancado(self, d):
        return sum(i["kcal"] for r in self.ler(f"{d}.json")["lancado"] for i in r["itens"])


class Registrar(BaseRegistro):
    def test_refeicao_e_evento_repetido(self):
        antes = self.total_lancado(self.d)
        args = ["refeicao", "--evento", "msg-1", "--nome", "Almoço", "--consumido-em", self.hora_no_dia(self.d),
                "--item", "chuck-costco=150g", "--item", "batata-inglesa=100g"]
        r = self.reg(*args, check=True)
        self.assertIn("Consumido:", r.stdout)
        depois = self.total_lancado(self.d)
        self.assertGreater(depois, antes)
        bytes1 = (self.dados / f"{self.d}.json").read_bytes()
        r2 = self.reg(*args, check=True)                      # retry do mesmo evento
        self.assertIn("já registrado", r2.stdout)
        self.assertEqual((self.dados / f"{self.d}.json").read_bytes(), bytes1)
        dia = self.ler(f"{self.d}.json")
        ref = dia["lancado"][-1]
        self.assertEqual(ref["id_evento"], "msg-1")
        self.assertIn("consumido_em", ref)
        self.assertIn("registrado_em", ref)
        self.assertSemErros()                                  # derivados regenerados
        resumo = {x["data"]: x for x in self.ler("resumo.json")}
        self.assertAlmostEqual(resumo[self.d]["cons"]["kcal"], round(depois, 1), places=1)

    def test_dry_run_nao_grava(self):
        antes = (self.dados / f"{self.d}.json").read_bytes()
        r = self.reg("refeicao", "--evento", "msg-2", "--nome", "X", "--consumido-em", self.hora_no_dia(self.d),
                     "--item", "banana=1un", "--dry-run", check=True)
        self.assertIn("nada foi gravado", r.stdout)
        self.assertIn("+", r.stdout)
        self.assertEqual((self.dados / f"{self.d}.json").read_bytes(), antes)

    def test_unidade_obrigatoria_e_futuro(self):
        self.reg("refeicao", "--evento", "msg-3", "--nome", "X", "--consumido-em", self.hora_no_dia(self.d),
                 "--item", "banana=1", check=False)
        amanha = (hoje_la() + datetime.timedelta(days=2)).isoformat()
        r = self.reg("refeicao", "--evento", "msg-4", "--nome", "X", "--consumido-em", f"{amanha}T08:00",
                     "--item", "banana=1un", check=False)
        self.assertIn("futuro", r.stdout)
        self.reg("peso", "--evento", "msg-5", "--data", self.d, "--kg", "-3", check=False)
        self.reg("peso", "--evento", "msg-6", "--data", self.d, "--kg", "nan", check=False)
        self.reg("refeicao", "--evento", "x", "--nome", "X", "--consumido-em", self.hora_no_dia(self.d),
                 "--item", "banana=1un", check=False)          # id curto demais

    def test_dia_fechado_exige_justificativa(self):
        fechados = [d for d in self.ler("dias.json") if self.ler(f"{d}.json")["fechado"]]
        if not fechados:
            self.skipTest("sem dia fechado")
        f = fechados[-1]
        base = ["refeicao", "--evento", "msg-7", "--nome", "Atrasada", "--consumido-em", f"{f}T21:00", "--item", "banana=1un"]
        r = self.reg(*base, check=False)
        self.assertIn("FECHADO", r.stdout)
        self.reg(*base, "--justificativa", "comeu às 21h e mandou depois", check=True)
        dia = self.ler(f"{f}.json")
        self.assertTrue(dia["fechado"])
        self.assertEqual(dia["correcoes"][-1]["justificativa"], "comeu às 21h e mandou depois")
        # confirmar completude de dia fechado não exige justificativa
        self.reg("completo", "--evento", "msg-8", "--data", f, "--status", "completo", check=True)
        self.assertEqual(self.ler(f"{f}.json")["registro"]["status"], "completo")
        self.assertEqual(next(x for x in self.ler("resumo.json") if x["data"] == f)["registro"], "completo")

    def test_remover_por_evento(self):
        self.reg("refeicao", "--evento", "msg-9", "--nome", "Engano", "--consumido-em", self.hora_no_dia(self.d),
                 "--item", "banana=2un", check=True)
        antes = self.total_lancado(self.d)
        self.reg("remover", "--evento", "msg-10", "--data", self.d, "--alvo", "msg-9", check=False)  # sem justificativa
        self.reg("remover", "--evento", "msg-10", "--data", self.d, "--alvo", "msg-9", "--justificativa", "lançado 2x",
                 check=True)
        self.assertLess(self.total_lancado(self.d), antes)
        self.assertEqual(self.ler(f"{self.d}.json")["correcoes"][-1]["tipo"], "remover")

    def test_validacao_falha_desfaz(self):
        a = self.ler("alimentos.json")
        a["tomate"]["kcal"] = -1                              # biblioteca quebrada em outro lugar
        self.gravar("alimentos.json", a)
        antes = {n: (self.dados / n).read_bytes() for n in (f"{self.d}.json", "resumo.json", "objetivo.json")}
        r = self.reg("refeicao", "--evento", "msg-11", "--nome", "X", "--consumido-em", self.hora_no_dia(self.d),
                     "--item", "banana=1un", check=False)
        self.assertIn("validação falhou", r.stdout)
        for n, b in antes.items():
            self.assertEqual((self.dados / n).read_bytes(), b, f"{n} não foi restaurado")


class Eventos(BaseRegistro):
    """Revisão Codex #5, item 6: um id por OPERAÇÃO; retry idêntico não duplica; reuso incompatível é recusado."""

    def ref(self, ev, item="banana=1un", nome="Lanche"):
        return ["refeicao", "--evento", ev, "--nome", nome, "--consumido-em", self.hora_no_dia(self.d), "--item", item]

    def test_mensagem_com_refeicao_e_peso(self):
        self.reg(*self.ref("m1:refeicao:1"), check=True)
        r = self.reg("peso", "--evento", "m1:peso:1", "--data", self.d, "--kg", "88.1", check=True)
        self.assertNotIn("já registrado", r.stdout)
        dia = self.ler(f"{self.d}.json")
        self.assertEqual(dia["peso_kg"], 88.1)
        self.assertEqual(sum(1 for x in dia["lancado"] if x.get("id_evento") == "m1:refeicao:1"), 1)

    def test_retry_identico_nao_duplica(self):
        self.reg(*self.ref("m2:refeicao:1"), check=True)
        antes = (self.dados / f"{self.d}.json").read_bytes()
        r = self.reg(*self.ref("m2:refeicao:1"), check=True)
        self.assertIn("já registrado", r.stdout)
        self.assertEqual((self.dados / f"{self.d}.json").read_bytes(), antes)

    def test_mesmo_id_outro_tipo_recusado(self):
        peso_antes = self.ler(f"{self.d}.json")["peso_kg"]
        self.reg(*self.ref("msg-3"), check=True)
        r = self.reg("peso", "--evento", "msg-3", "--data", self.d, "--kg", "88.1", check=False)
        self.assertIn("já foi usado para 'refeicao'", r.stdout)
        self.assertNotIn("já registrado", r.stdout)
        self.assertEqual(self.ler(f"{self.d}.json")["peso_kg"], peso_antes, "o peso não pode ter sido aplicado")

    def test_mesmo_id_conteudo_diferente_recusado(self):
        self.reg(*self.ref("m4:refeicao:1", item="banana=1un"), check=True)
        antes = (self.dados / f"{self.d}.json").read_bytes()
        r = self.reg(*self.ref("m4:refeicao:1", item="banana=2un"), check=False)
        self.assertIn("conteúdo DIFERENTE", r.stdout)
        self.assertEqual((self.dados / f"{self.d}.json").read_bytes(), antes)
        # peso: mesmo id com outro valor também não vira sucesso silencioso
        self.reg("peso", "--evento", "m4:peso:1", "--data", self.d, "--kg", "88.0", check=True)
        r = self.reg("peso", "--evento", "m4:peso:1", "--data", self.d, "--kg", "87.0", check=False)
        self.assertIn("conteúdo DIFERENTE", r.stdout)
        self.assertEqual(self.ler(f"{self.d}.json")["peso_kg"], 88.0)

    def test_sufixo_do_id_tem_que_bater_com_o_comando(self):
        r = self.reg(*self.ref("m5:peso:1"), check=False)
        self.assertIn("diz 'peso'", r.stdout)

    def test_evento_antigo_sem_assinatura_continua_idempotente(self):
        dia = self.ler(f"{self.d}.json")
        dia.setdefault("eventos", []).append({"id_evento": "legado-1", "tipo": "peso", "em": dia["atualizado"],
                                              "resumo": "peso antigo"})
        self.gravar(f"{self.d}.json", dia)
        self.derivados()
        r = self.reg("peso", "--evento", "legado-1", "--data", self.d, "--kg", "88.3", check=True)
        self.assertIn("já registrado", r.stdout)
        self.assertIn("sem assinatura", r.stdout)
        r = self.reg(*self.ref("legado-1"), check=False)   # outro tipo com id antigo: recusado
        self.assertIn("já foi usado para 'peso'", r.stdout)


class HorarioDeVerao(unittest.TestCase):
    """Item 7: comparar INSTANTES (UTC), não texto, na hora repetida de 01/11/2026 em Los Angeles."""

    def setUp(self):
        import registrar
        self.r = registrar

    def test_consumo_45_min_antes_na_hora_repetida_e_aceito(self):
        # consumo 01:45 PDT (08:45 UTC) · agora 01:30 PST (09:30 UTC): foi 45 min ANTES
        self.assertFalse(self.r.no_futuro("2026-11-01T01:45:00-07:00", "2026-11-01T01:30:00-08:00"))

    def test_consumo_45_min_no_futuro_na_hora_repetida_e_recusado(self):
        # consumo 01:30 PST (09:30 UTC) · agora 01:45 PDT (08:45 UTC): está 45 min no FUTURO
        self.assertTrue(self.r.no_futuro("2026-11-01T01:30:00-08:00", "2026-11-01T01:45:00-07:00"))

    def test_comando_usa_a_comparacao_por_instante(self):
        import argparse
        a = argparse.Namespace(evento="t:refeicao:1", consumido_em="2026-11-01T01:45:00-07:00", favorita=None, item=["banana=1un"],
                               nome="Lanche", remover_sugestao=None)
        data, _, conteudo = self.r.cmd_refeicao(a, None, "2026-11-01T01:30:00-08:00")   # aceito
        self.assertEqual(data, "2026-11-01")
        self.assertEqual(conteudo["consumido_utc"], "2026-11-01T08:45:00+00:00")
        a.consumido_em = "2026-11-01T01:30:00-08:00"
        with self.assertRaises(self.r.Recusa):
            self.r.cmd_refeicao(a, None, "2026-11-01T01:45:00-07:00")                     # recusado

    def test_horario_sem_fuso_ambiguo_ou_inexistente_pede_fuso(self):
        self.assertTrue(self.r.horario_ambiguo("2026-11-01T01:30"))    # hora repetida
        self.assertTrue(self.r.horario_ambiguo("2026-03-08T02:30"))    # hora que não existe
        self.assertFalse(self.r.horario_ambiguo("2026-11-01T03:30"))
        self.assertFalse(self.r.horario_ambiguo("2026-11-01T01:30-08:00"))
        import argparse
        a = argparse.Namespace(evento="t:refeicao:1", consumido_em="2026-11-01T01:30", favorita=None, item=["banana=1un"],
                               nome="Lanche", remover_sugestao=None)
        with self.assertRaises(self.r.Recusa) as cm:
            self.r.cmd_refeicao(a, None, "2026-11-01T05:00:00-08:00")
        self.assertIn("troca de horário", str(cm.exception))


class Meta(CopiaRepo):
    def test_modo_manual_atualiza_diagnostico(self):
        o = self.ler("objetivo.json")
        o["atual"].update(meta_modo="manual", meta_semanal_kg=0.5, gasto_kcal=2500)
        self.gravar("objetivo.json", o)
        self.derivados()
        a = self.ler("objetivo.json")["atual"]
        self.assertEqual(a["meta_semanal_kg"], 0.5)                 # escolha preservada
        self.assertEqual(a["calculo"]["gasto_estimado"], 2500)      # diagnóstico novo (antes ficava o antigo)
        self.assertEqual(a["calculo"]["gasto_fonte"], "informado")
        self.assertIn("manual", a["calculo"]["meta_origem"])
        self.assertEqual(a["calculo"]["atualizado"], hoje_la().isoformat())

    def _serie(self, hoje, plano):
        """plano: lista de (offset_dias, kcal ou None, peso ou None) relativos a hoje."""
        base = self.ler(f"{self.dia_aberto()}.json")
        dias = []
        for off, kcal, peso in plano:
            d = (hoje + datetime.timedelta(days=off)).isoformat()
            x = json.loads(json.dumps(base))
            itens = [] if kcal is None else [{"nome": "X", "qtd": "1", "kcal": kcal, "p": 0, "c": 0, "g": 0}]
            x.update(data=d, fechado=off < 0, peso_kg=peso, sugestao=[], lancado=[{"refeicao": "Dia", "itens": itens}] if itens else [],
                     registro={"status": "completo", "em": "2026-09-30T08:00:00-07:00"} if kcal else None)
            if x["registro"] is None:
                x.pop("registro")
            x.pop("gordura_pct", None); x.pop("gordura_fonte", None)
            self.gravar(f"{d}.json", x)
            dias.append(d)
        for p in self.dados.glob("????-??-??.json"):
            if p.stem not in dias:
                p.unlink()
        self.gravar("dias.json", sorted(dias))
        (self.tmp / "index.html").write_text((self.tmp / "index.html").read_text().replace(
            f'data-dia="{self.dia_aberto()}"', f'data-dia="{dias[-1]}"'))
        o = self.ler("objetivo.json")
        o["atual"]["inicio"] = dias[0]
        o["atual"]["data_alvo"] = (hoje + datetime.timedelta(days=30)).isoformat()
        o["atual"]["meta_modo"] = "auto"
        self.gravar("objetivo.json", o)

    def test_gasto_inferido_so_no_intervalo_das_pesagens(self):
        """Repro Codex: 10 dias de 3000 sem pesagem + 11 dias de 1800 com peso estável → ~1800 (não 2371)."""
        hoje = hoje_la()
        plano = [(-21 + i, 3000, None) for i in range(10)] + [(-11 + i, 1800, 88.0) for i in range(11)] + [(0, None, None)]
        self._serie(hoje, plano)
        import meta
        _, novo = meta.calcular(dados=self.dados, hoje=hoje)
        gi = novo["calculo"]["gasto_inferido"]
        self.assertIsNotNone(gi, novo["calculo"]["gasto_inferido_falta"])
        self.assertEqual(gi["kcal"], 1800)
        self.assertEqual(gi["cobertura_pct"], 100)

    def test_ignora_datas_futuras_e_dias_sem_confirmacao(self):
        hoje = hoje_la()
        plano = [(-3, 1500, 88.0), (-2, 1500, 87.9), (-1, 1500, 87.8), (0, None, None), (3, 9000, 50.0)]
        self._serie(hoje, plano)
        import meta
        _, novo = meta.calcular(dados=self.dados, hoje=hoje)
        c = novo["calculo"]
        self.assertEqual(c["peso_ref_kg"], 87.8)                  # o peso de 50 kg no futuro não entra
        self.assertEqual(c["ingestao_media"], 1500)               # 3 dias completos; o de 9000 (futuro) não
        # sem confirmação de registro, a média real não é usada
        for off in (-3, -2, -1):
            d = (hoje + datetime.timedelta(days=off)).isoformat()
            x = self.ler(f"{d}.json"); x.pop("registro"); self.gravar(f"{d}.json", x)
        _, novo2 = meta.calcular(dados=self.dados, hoje=hoje)
        self.assertIn("registro completo", novo2["calculo"]["ingestao_fonte"])
        self.assertEqual(novo2["calculo"]["dias_completos"], 0)


def git(cwd, *args):
    r = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(r.stdout + r.stderr)
    return r.stdout.strip()


class Concorrencia(BaseRegistro):
    """Auditoria Codex #7: dois registros no MESMO checkout. A falha na validação depois que B tentou gravar;
    o rollback de A não pode apagar o que B confirmou (e B não pode gravar no meio da transação de A)."""

    def injetar_falha_com_pausa(self):
        # só na CÓPIA temporária: validar() de quem tiver TESTE_SINAL avisa que está dentro, espera liberação e falha
        v = self.tmp / "scripts" / "validar.py"
        v.write_text(v.read_text(encoding="utf-8") + '''

_validar_original = validar


def validar(raiz=ROOT):
    import os, time
    sinal = os.environ.get("TESTE_SINAL")
    if not sinal:
        return _validar_original(raiz)
    pathlib.Path(sinal + ".dentro").write_text("1")
    for _ in range(400):
        if pathlib.Path(sinal + ".libera").exists():
            break
        time.sleep(0.05)
    c = _validar_original(raiz)
    c.erros.append("falha injetada no teste")
    return c
''', encoding="utf-8")

    def popen(self, *args, **env):
        return subprocess.Popen([sys.executable, str(self.tmp / "scripts" / "registrar.py"), *args], cwd=self.tmp,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=dict(os.environ, **env))

    def test_rollback_de_um_nao_apaga_o_registro_do_outro(self):
        import time
        self.injetar_falha_com_pausa()
        fechado = next(d for d in sorted(self.ler("dias.json")) if self.ler(f"{d}.json").get("fechado"))
        aberto = self.dia_aberto()
        self.assertNotEqual(fechado, aberto)
        antes_fechado = (self.dados / f"{fechado}.json").read_bytes()
        sinal = str(self.tmp / "sinal")
        a = self.popen("completo", "--evento", "msg-a:completo:1", "--data", fechado, "--status", "completo",
                       TESTE_SINAL=sinal)
        for _ in range(400):                                    # A dentro da transação (depois dos derivados)
            if os.path.exists(sinal + ".dentro") or a.poll() is not None:
                break
            time.sleep(0.05)
        self.assertTrue(os.path.exists(sinal + ".dentro"), a.communicate()[0] if a.poll() is not None else "")
        b = self.popen("peso", "--evento", "msg-b:peso:1", "--data", aberto, "--kg", "87.1")
        time.sleep(1.0)                                         # B tenta gravar enquanto A está no meio
        self.assertIsNone(b.poll(), "B gravou no meio da transação de A (sem exclusão entre escritores)")
        pathlib.Path(sinal + ".libera").write_text("1")
        out_a, _ = a.communicate(timeout=120)
        out_b, err_b = b.communicate(timeout=120)
        self.assertEqual(a.returncode, 2, out_a)
        self.assertIn("falha injetada", out_a)
        self.assertEqual(b.returncode, 0, out_b + err_b)
        dia_b = self.ler(f"{aberto}.json")
        self.assertEqual(dia_b["peso_kg"], 87.1, "o peso confirmado por B sumiu")
        self.assertTrue(any(e.get("id_evento") == "msg-b:peso:1" for e in dia_b.get("eventos", [])), "evento de B sumiu")
        self.assertEqual((self.dados / f"{fechado}.json").read_bytes(), antes_fechado, "A falhou: 30/09 tem de ficar como antes")
        # derivados coerentes com o estado final (B regenerou depois do rollback de A)
        from derivados import resumo_texto
        self.assertEqual((self.dados / "resumo.json").read_text(encoding="utf-8"), resumo_texto(self.dados))

    def test_trava_ocupada_recusa_sem_gravar(self):
        from comum import trava_escrita
        aberto = self.dia_aberto()
        antes = (self.dados / f"{aberto}.json").read_bytes()
        with trava_escrita(self.dados):                         # outro escritor segurando a trava
            r = subprocess.run([sys.executable, str(self.tmp / "scripts" / "registrar.py"), "peso", "--evento",
                                "msg-c:peso:1", "--data", aberto, "--kg", "86.9"], cwd=self.tmp, capture_output=True,
                               text=True, env=dict(os.environ, TRAVA_ESPERA="0.5"))
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("outra gravação em dados/ em andamento", r.stdout)
        self.assertEqual((self.dados / f"{aberto}.json").read_bytes(), antes)


class Enviar(unittest.TestCase):
    def setUp(self):
        from test_publicacao import Publicacao
        self.p = Publicacao()
        self.p.setUp()
        # o remoto recusa o 1º push (simula alguém enviando no meio)
        hook = self.p.remoto / "hooks" / "pre-receive"
        flag = self.p.tmp / "recusou"
        hook.write_text(f"#!/bin/sh\nif [ ! -f {flag} ]; then touch {flag}; echo 'corrida simulada' >&2; exit 1; fi\nexit 0\n")
        hook.chmod(0o755)
        # derivados em dia no remoto
        subprocess.run([sys.executable, "scripts/derivados.py"], cwd=self.p.a, check=True, capture_output=True)
        git(self.p.a, "add", "-A")
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "derivados"], cwd=self.p.a)
        (self.p.tmp / "recusou").touch()
        git(self.p.a, "push", "-q", "origin", "HEAD:main")
        (self.p.tmp / "recusou").unlink()

    def tearDown(self):
        self.p.tearDown()

    def test_enviar_com_corrida_nao_duplica(self):
        from test_publicacao import dia_aberto
        d = dia_aberto(self.p.a)
        if d > hoje_la().isoformat():
            self.skipTest("dia aberto no futuro")
        args = [sys.executable, "scripts/registrar.py", "refeicao", "--evento", "msg-env-1", "--nome", "Lanche",
                "--consumido-em", f"{d}T00:01", "--item", "banana=1un", "--enviar"]
        r = subprocess.run(args, cwd=self.p.a, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("push recusado", r.stderr)
        self.assertIn("Enviado:", r.stdout)
        r2 = subprocess.run(args, cwd=self.p.a, capture_output=True, text=True)   # retry do Grok
        self.assertIn("já registrado", r2.stdout)
        c = self.p.conferir_remoto()
        dia = json.loads((c / "dados" / f"{d}.json").read_text())
        self.assertEqual([r["id_evento"] for r in dia["lancado"] if r.get("id_evento") == "msg-env-1"], ["msg-env-1"])


if __name__ == "__main__":
    unittest.main()
