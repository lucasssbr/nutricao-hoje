"""Dias fechados são histórico: nada reescreve o que foi guardado neles.

- mudar a biblioteca (ex.: rótulo novo) não recalcula itens nem totais de dias fechados;
- regenerar derivados e rodar o fechamento de novo não mexe no conteúdo de dias fechados;
- a checagem não acusa diferença de biblioteca em dia fechado (só em dia aberto).
"""
import json
import unittest

from base import CopiaRepo


class DiasFechados(CopiaRepo):
    def fechado_com_itens(self):
        for d in reversed(self.ler("dias.json")):
            dia = self.ler(f"{d}.json")
            if dia["fechado"] and any(it.get("alimento") for r in dia["lancado"] for it in r["itens"]):
                return d, dia
        self.skipTest("sem dia fechado com itens da biblioteca")

    def test_biblioteca_nova_nao_reescreve_dia_fechado(self):
        d, dia = self.fechado_com_itens()
        antes_bytes = (self.dados / f"{d}.json").read_bytes()
        antes_resumo = next(x for x in self.ler("resumo.json") if x["data"] == d)

        # um alimento usado no dia fechado muda de valor (ex.: rótulo novo com o dobro de kcal)
        usado = next(it["alimento"] for r in dia["lancado"] for it in r["itens"] if it.get("alimento"))
        ali = self.ler("alimentos.json")
        ali[usado]["kcal"] = round(ali[usado]["kcal"] * 2 + 1, 1)
        self.gravar("alimentos.json", ali)

        self.derivados()
        self.rodar("fechar_dia.py", check=True, env={"HOJE": self.dia_aberto()})
        self.derivados()

        self.assertEqual((self.dados / f"{d}.json").read_bytes(), antes_bytes,
                         f"{d}.json (fechado) foi reescrito")
        depois_resumo = next(x for x in self.ler("resumo.json") if x["data"] == d)
        self.assertEqual(depois_resumo["cons"], antes_resumo["cons"],
                         "totais históricos mudaram com a biblioteca nova")
        # a checagem não pode exigir que o dia fechado "bata" com a biblioteca nova
        c = self.validar()
        self.assertFalse([e for e in c.erros if e.startswith(f"{d}.json")], "\n".join(c.erros))

    def test_fechamento_repetido_nao_mexe_em_dia_fechado(self):
        d, _ = self.fechado_com_itens()
        fechados = {x: (self.dados / f"{x}.json").read_bytes()
                    for x in self.ler("dias.json") if self.ler(f"{x}.json")["fechado"]}
        for _ in range(2):
            self.rodar("fechar_dia.py", check=True, env={"HOJE": self.dia_aberto()})
            self.derivados()
        for x, b in fechados.items():
            self.assertEqual((self.dados / f"{x}.json").read_bytes(), b, f"{x}.json (fechado) mudou")
        self.assertSemErros()


if __name__ == "__main__":
    unittest.main()
