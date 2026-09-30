"""Validação: entradas inválidas, datas impossíveis, estruturas e derivados."""
import unittest

from base import CopiaRepo


class Validacao(CopiaRepo):
    def test_dados_atuais_passam(self):
        self.derivados()
        self.assertSemErros()

    def _primeiro_item_lancado_ou_sugerido(self, dia):
        for lista in ("lancado", "sugestao"):
            for r in dia.get(lista, []):
                if r.get("itens"):
                    return r["itens"][0]
        self.skipTest("dia sem itens")

    def test_quantidade_negativa_recusada(self):
        d = self.dia_aberto()
        dia = self.ler(f"{d}.json")
        it = self._primeiro_item_lancado_ou_sugerido(dia)
        it["quantidade"] = -1
        self.gravar(f"{d}.json", dia)
        self.assertErro(".quantidade: precisa ser maior que 0")

    def test_item_py_recusa_negativo_zero_nan(self):
        for q in ("-1", "0", "nan", "inf", "1e999", "abc"):
            r = self.rodar("item.py", "ovo-inteiro", q)
            self.assertNotEqual(r.returncode, 0, f"item.py aceitou {q}")
        r = self.rodar("item.py", "chuck-costco", "2un")
        self.assertNotEqual(r.returncode, 0, "unidade errada aceita")
        self.assertEqual(self.rodar("item.py", "chuck-costco", "200g").returncode, 0)

    def test_nan_e_infinity_no_json(self):
        d = self.dia_aberto()
        txt = (self.dados / f"{d}.json").read_text(encoding="utf-8").replace('"peso_kg": null', '"peso_kg": NaN', 1)
        if "NaN" not in txt:
            txt = txt.replace('"fechado": false', '"fechado": false, "x": Infinity', 1)
        self.gravar_texto(f"{d}.json", txt)
        self.assertErro("JSON inválido")

    def test_chave_duplicada(self):
        self.gravar_texto("perfil.json", '{"altura_cm": 183, "altura_cm": 190, "nascimento": "1993-10", "sexo": "M", "atividade": 1.55}\n')
        self.assertErro("chave duplicada")

    def test_booleano_nao_e_numero(self):
        d = self.dia_aberto()
        dia = self.ler(f"{d}.json")
        dia["meta"]["kcal"] = True
        self.gravar(f"{d}.json", dia)
        self.assertErro(".meta.kcal: precisa ser número finito")

    def test_peso_negativo(self):
        d = self.dia_aberto()
        dia = self.ler(f"{d}.json")
        dia["peso_kg"] = -80
        self.gravar(f"{d}.json", dia)
        self.assertErro(".peso_kg: não pode ser menor que 20")

    def test_fibra_textual(self):
        d = self.dia_aberto()
        dia = self.ler(f"{d}.json")
        it = self._primeiro_item_lancado_ou_sugerido(dia)
        it["fibra"] = "3 g"
        self.gravar(f"{d}.json", dia)
        self.assertErro(".fibra: precisa ser número finito")

    def test_dia_inteiro_lista_vazia(self):
        d = self.dia_aberto()
        self.gravar(f"{d}.json", [])
        self.assertErro(f"{d}.json: precisa ser objeto")

    def test_data_impossivel_no_indice(self):
        dias = self.ler("dias.json")
        self.gravar("dias.json", dias + ["2026-09-31"])
        self.assertErro("data inválida '2026-09-31'")

    def test_arquivo_com_data_impossivel(self):
        dia = self.ler(f"{self.dia_aberto()}.json")
        dia["data"] = "2026-02-30"
        self.gravar("2026-02-30.json", dia)
        self.assertErro("2026-02-30.json: nome de arquivo com data impossível")

    def test_indice_duplicado_e_fora_de_ordem(self):
        dias = self.ler("dias.json")
        self.gravar("dias.json", dias + [dias[0]])
        self.assertErro("data repetida")
        self.gravar("dias.json", list(reversed(dias)))
        self.assertErro("fora de ordem")

    def test_carimbo_sem_fuso(self):
        d = self.dia_aberto()
        dia = self.ler(f"{d}.json")
        dia["atualizado"] = "2026-09-30T08:00:00"
        self.gravar(f"{d}.json", dia)
        self.assertErro(".atualizado: carimbo inválido")

    def test_perfil_atividade_textual(self):
        p = self.ler("perfil.json")
        p["atividade"] = "alta"
        self.gravar("perfil.json", p)
        self.assertErro("perfil.json.atividade")

    def test_objetivo_invalido(self):
        o = self.ler("objetivo.json")
        o["atual"]["data_alvo"] = "2026-10-32"
        o["atual"]["meta_modo"] = "talvez"
        self.gravar("objetivo.json", o)
        self.assertErro("objetivo.json/atual.data_alvo: data inválida")
        self.assertErro("objetivo.json/atual.meta_modo")

    def test_favorita_com_quantidade_zero(self):
        r = self.ler("refeicoes.json")
        primeira = next(iter(r["refeicoes"].values()))
        primeira["itens"][0][1] = 0
        self.gravar("refeicoes.json", r)
        self.assertErro("precisa ser maior que 0")

    def test_biblioteca_nutriente_negativo_e_base_zero(self):
        a = self.ler("alimentos.json")
        a["banana"]["kcal"] = -5
        a["tomate"]["base"] = "0 g"
        self.gravar("alimentos.json", a)
        self.assertErro("alimentos.json/banana.kcal: não pode ser menor que 0")
        self.assertErro("alimentos.json/tomate.base")

    def test_resumo_desatualizado(self):
        self.derivados()
        d = self.dia_aberto()
        dia = self.ler(f"{d}.json")
        dia["peso_kg"] = 85.0
        self.gravar(f"{d}.json", dia)
        self.assertErro("resumo.json: desatualizado")
        self.derivados()
        self.assertSemErros()

    def test_comer_muito_acima_da_meta_e_registravel(self):
        """Não existe limite máximo de comida: 6000 kcal lançadas não geram erro nem aviso."""
        import sys
        sys.path.insert(0, str(self.tmp / "scripts"))
        d = self.dia_aberto()
        dia = self.ler(f"{d}.json")
        from item import carregar_alimentos, esperado
        ali = self.ler("alimentos.json")
        q = 2000
        vals = esperado(ali["chuck-costco"], q)
        dia["lancado"].append({"refeicao": "Banquete", "itens": [
            {"nome": "Chuck", "qtd": f"{q} g", "alimento": "chuck-costco", "quantidade": q, **vals}]})
        self.gravar(f"{d}.json", dia)
        self.derivados()
        c = self.assertSemErros()
        self.assertFalse(any("chuck" in a.lower() and "lançado" in a.lower() for a in c.avisos), c.avisos)


    # ---- revisão Codex #5, item 5: parâmetros da simulação dos 10% ----
    def ritmo_com(self, **kw):
        o = self.ler("objetivo.json")
        o["meta_final"]["ritmo"].update(kw)
        self.gravar("objetivo.json", o)

    def test_ritmo_atual_passa(self):
        self.assertSemErros()
        self.assertEqual(self.ler("objetivo.json")["meta_final"]["ritmo"]["pct_semana"], [1.2, 1.0, 0.8])

    def test_ritmo_invalido(self):
        casos = [
            (dict(pct_semana="oops"), "ritmo.pct_semana"),
            (dict(pct_semana=[0, 0, 0]), "ritmo.pct_semana[0]"),
            (dict(pct_semana=[1.2, 1.0]), "ritmo.pct_semana"),
            (dict(pct_semana=[1.2, float("nan"), 0.8]), "objetivo.json"),   # NaN nem chega a ser JSON válido
            (dict(pct_semana=[1.2, True, 0.8]), "ritmo.pct_semana[1]"),
            (dict(faixas_gordura=[12, 15]), "ritmo.faixas_gordura"),
            (dict(faixas_gordura=[15]), "ritmo.faixas_gordura"),
            (dict(fracao_forbes=1.5), "ritmo.fracao_forbes"),
            (dict(fracao_forbes="0,5"), "ritmo.fracao_forbes"),
            (dict(pausa_semanas=[0, 1]), "ritmo.pausa_semanas[0]"),
            (dict(pausa_semanas=[8.5, 1]), "ritmo.pausa_semanas[0]"),
            (dict(pausa_semanas="8/1"), "ritmo.pausa_semanas"),
        ]
        original = self.ler("objetivo.json")
        for kw, trecho in casos:
            with self.subTest(kw=kw):
                self.gravar("objetivo.json", original)
                if any(isinstance(v, list) and any(isinstance(x, float) and x != x for x in v) for v in kw.values()):
                    import re
                    texto = re.sub(r'"pct_semana":\s*\[[^\]]*\]', '"pct_semana": [1.2, NaN, 0.8]',
                                   (self.dados / "objetivo.json").read_text(), count=1)
                    self.assertIn("NaN", texto)
                    self.gravar_texto("objetivo.json", texto)
                else:
                    self.ritmo_com(**kw)
                self.assertErro(trecho)
                self.derivados_nao_mascaram()

    def derivados_nao_mascaram(self):
        """derivados.py não pode 'consertar' nem esconder um ritmo inválido: a checagem continua falhando."""
        self.rodar("derivados.py")
        self.assertTrue(self.validar().erros)

    def test_pausa_nula_e_permitida(self):
        self.ritmo_com(pausa_semanas=None)
        self.assertSemErros()

    # ---- item 10: nascimento no futuro ----
    def test_nascimento_futuro(self):
        p = self.ler("perfil.json")
        p["nascimento"] = "2099-12"
        self.gravar("perfil.json", p)
        self.assertErro("perfil.json.nascimento")


if __name__ == "__main__":
    unittest.main()
