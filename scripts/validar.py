#!/usr/bin/env python3
"""Confere os dados do site. Roda no GitHub a cada envio e o Grok roda antes do push.

  python3 scripts/validar.py            # confere a pasta dados/ do repositório
  python3 scripts/validar.py --raiz X   # confere outra cópia (usado nos testes)

Erros (fazem a checagem falhar) — sempre com arquivo e campo:
  - JSON inválido, NaN/Infinity, chave duplicada, tipo errado, campo obrigatório faltando
  - números não finitos, booleanos no lugar de número, quantidades/bases ≤ 0, nutrientes < 0
  - datas impossíveis (2026-09-31), carimbos sem fuso, dias.json fora de ordem/duplicado
  - dias.json e arquivos de dia desencontrados; data-dia do index sem arquivo
  - item de dia aberto (a partir de 2026-09-29) sem "alimento"/"quantidade", ou com valores que não
    batem com a biblioteca (dia fechado guarda os valores da época e não é recalculado)
  - perfil, objetivo e favoritas com campos inválidos
  - resumo.json diferente do que os dias geram (rode python3 scripts/derivados.py)
Avisos (não falham): sugestão planejando mais que plano_ate_g; metas que não fecham 4/4/9;
meta semanal agressiva. Nunca há limite para o que foi LANÇADO: comer acima da meta é registrável.
"""
import argparse
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from comum import (DATA_RE, MACROS, ROOT, ErroJSON, carimbo_valido, data_valida, eh_numero,  # noqa: E402
                   ler_json)
from item import base_de, esperado  # noqa: E402

EXIGE_ID_DESDE = "2026-09-29"
FONTES = {"rotulo", "usda", "openfoodfacts", "lucas", "estimado"}
FONTES_GORDURA = {"foto", "fita", "dexa", "bioimpedancia", "lucas"}
STATUS_REGISTRO = {"completo", "parcial"}
TOL = 1.0


class Checagem:
    def __init__(self, raiz):
        self.raiz = pathlib.Path(raiz)
        self.dados = self.raiz / "dados"
        self.erros, self.avisos = [], []
        self.n_alimentos = 0

    # ---- helpers ----
    def erro(self, onde, msg):
        self.erros.append(f"{onde}: {msg}")

    def aviso(self, onde, msg):
        self.avisos.append(f"{onde}: {msg}")

    def ler(self, nome):
        p = self.dados / nome
        if not p.exists():
            self.erro(nome, "arquivo não existe")
            return None
        try:
            return ler_json(p)
        except (ValueError, ErroJSON) as e:
            self.erro(nome, f"JSON inválido ({e})")
            return None

    def numero(self, onde, v, minimo=None, maximo=None, maior_que=None, obrigatorio=True):
        if v is None and not obrigatorio:
            return True
        if not eh_numero(v):
            self.erro(onde, f"precisa ser número finito (veio {v!r})")
            return False
        if maior_que is not None and not v > maior_que:
            self.erro(onde, f"precisa ser maior que {maior_que:g} (veio {v:g})")
            return False
        if minimo is not None and v < minimo:
            self.erro(onde, f"não pode ser menor que {minimo:g} (veio {v:g})")
            return False
        if maximo is not None and v > maximo:
            self.erro(onde, f"não pode ser maior que {maximo:g} (veio {v:g})")
            return False
        return True

    def texto(self, onde, v, obrigatorio=True, vazio=False):
        if v is None and not obrigatorio:
            return True
        if not isinstance(v, str) or (not vazio and not v.strip()):
            self.erro(onde, f"precisa ser texto{'' if vazio else ' não vazio'} (veio {v!r})")
            return False
        return True

    def data(self, onde, v, obrigatorio=True):
        if v is None and not obrigatorio:
            return True
        if not data_valida(v):
            self.erro(onde, f"data inválida {v!r} (use AAAA-MM-DD de um dia que existe)")
            return False
        return True

    def carimbo(self, onde, v, obrigatorio=True):
        if v is None and not obrigatorio:
            return True
        if not carimbo_valido(v):
            self.erro(onde, f"carimbo inválido {v!r} (use AAAA-MM-DDTHH:MM:SS-07:00, com fuso)")
            return False
        return True

    def objeto(self, onde, v):
        if not isinstance(v, dict):
            self.erro(onde, f"precisa ser objeto {{…}} (veio {type(v).__name__})")
            return False
        return True

    def lista(self, onde, v):
        if not isinstance(v, list):
            self.erro(onde, f"precisa ser lista […] (veio {type(v).__name__})")
            return False
        return True

    def metas(self, onde, m):
        if not self.objeto(onde, m):
            return False
        ok = True
        for k in MACROS:
            ok &= self.numero(f"{onde}.{k}", m.get(k), maior_que=0)
        return ok

    # ---- alimentos ----
    def alimentos(self):
        a = self.ler("alimentos.json")
        if a is None or not self.objeto("alimentos.json", a):
            return {}
        out = {}
        for k, v in a.items():
            if k.startswith("_"):
                continue
            onde = f"alimentos.json/{k}"
            if not self.objeto(onde, v):
                continue
            self.texto(f"{onde}.nome", v.get("nome"))
            if "apelidos" in v and (not isinstance(v["apelidos"], list)
                                   or not all(isinstance(x, str) and x.strip() for x in v["apelidos"])):
                self.erro(f"{onde}.apelidos", "precisa ser lista de textos")
            try:
                base_de(v)
            except ValueError as e:
                self.erro(f"{onde}.base", str(e))
                continue
            ok = True
            for m in MACROS:
                ok &= self.numero(f"{onde}.{m}", v.get(m), minimo=0)
            if "fibra" in v:
                ok &= self.numero(f"{onde}.fibra", v["fibra"], minimo=0)
            if "plano_ate_g" in v:
                self.numero(f"{onde}.plano_ate_g", v["plano_ate_g"], maior_que=0)
            if v.get("fonte") not in FONTES:
                self.erro(f"{onde}.fonte", f"'{v.get('fonte')}' inválida (use {sorted(FONTES)})")
            self.data(f"{onde}.salvo_em", v.get("salvo_em"), obrigatorio=False)
            self.data(f"{onde}.atualizado_em", v.get("atualizado_em"), obrigatorio=False)
            if ok:
                out[k] = v
        self.n_alimentos = len(out)
        return out

    # ---- favoritas ----
    def refeicoes(self, alimentos):
        refs = self.ler("refeicoes.json")
        if refs is None or not self.objeto("refeicoes.json", refs):
            return
        todas = refs.get("refeicoes")
        if not self.objeto("refeicoes.json.refeicoes", todas):
            return
        for rid, r in todas.items():
            onde = f"refeicoes.json/{rid}"
            if not self.objeto(onde, r):
                continue
            self.texto(f"{onde}.nome", r.get("nome"))
            if not self.lista(f"{onde}.itens", r.get("itens")):
                continue
            for i, par in enumerate(r["itens"]):
                o = f"{onde}.itens[{i}]"
                if not (isinstance(par, list) and len(par) == 2 and isinstance(par[0], str)):
                    self.erro(o, f"precisa ser [id do alimento, quantidade] (veio {par!r})")
                    continue
                if par[0] not in alimentos:
                    self.erro(o, f"alimento '{par[0]}' não existe em alimentos.json")
                self.numero(f"{o}[1]", par[1], maior_que=0)
        plano = refs.get("plano_padrao", [])
        if self.lista("refeicoes.json.plano_padrao", plano):
            for rid in plano:
                if rid not in todas:
                    self.erro("refeicoes.json.plano_padrao", f"cita '{rid}', que não existe")
        self.texto("refeicoes.json.plano_padrao_nota", refs.get("plano_padrao_nota"), obrigatorio=False)

    # ---- perfil ----
    def perfil(self):
        p = self.ler("perfil.json")
        if p is None or not self.objeto("perfil.json", p):
            return
        self.numero("perfil.json.altura_cm", p.get("altura_cm"), minimo=100, maximo=250)
        nasc = p.get("nascimento")
        if not (isinstance(nasc, str) and re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", nasc)):
            self.erro("perfil.json.nascimento", f"use AAAA-MM (veio {nasc!r})")
        if p.get("sexo") not in ("M", "F"):
            self.erro("perfil.json.sexo", f"use 'M' ou 'F' (veio {p.get('sexo')!r})")
        self.numero("perfil.json.atividade", p.get("atividade"), minimo=1.0, maximo=2.5)

    # ---- objetivo ----
    def um_objetivo(self, onde, o):
        if not self.objeto(onde, o):
            return
        self.texto(f"{onde}.nome", o.get("nome"))
        ok_i = self.data(f"{onde}.inicio", o.get("inicio"))
        ok_a = self.data(f"{onde}.data_alvo", o.get("data_alvo"))
        if ok_i and ok_a and o["data_alvo"] <= o["inicio"]:
            self.erro(f"{onde}.data_alvo", "precisa ser depois do início")
        self.numero(f"{onde}.peso_inicial_kg", o.get("peso_inicial_kg"), minimo=20, maximo=400)
        if self.numero(f"{onde}.meta_semanal_kg", o.get("meta_semanal_kg"), minimo=0, maximo=5) \
                and o["meta_semanal_kg"] > 1.2:
            self.aviso(f"{onde}.meta_semanal_kg", f"{o['meta_semanal_kg']} kg/semana é bem agressiva")
        if o.get("meta_modo", "auto") not in ("auto", "manual"):
            self.erro(f"{onde}.meta_modo", f"use 'auto' ou 'manual' (veio {o.get('meta_modo')!r})")
        if "metas" in o and self.metas(f"{onde}.metas", o["metas"]):
            m = o["metas"]
            soma = 4 * m["p"] + 4 * m["c"] + 9 * m["g"]
            if abs(soma - m["kcal"]) > 0.05 * m["kcal"]:
                self.aviso(f"{onde}.metas", f"somam {soma:g} kcal pelos macros (4/4/9), mas kcal = {m['kcal']:g}")
        self.numero(f"{onde}.gasto_kcal", o.get("gasto_kcal"), minimo=1200, maximo=5000, obrigatorio=False)
        if "calculo" in o and o["calculo"] is not None and self.objeto(f"{onde}.calculo", o["calculo"]):
            for k, v in o["calculo"].items():
                if isinstance(v, float) and not eh_numero(v):
                    self.erro(f"{onde}.calculo.{k}", "número não finito")
        self.numero(f"{onde}.peso_final_kg", o.get("peso_final_kg"), minimo=20, maximo=400, obrigatorio=False)
        self.data(f"{onde}.encerrado_em", o.get("encerrado_em"), obrigatorio=False)

    def objetivo(self):
        o = self.ler("objetivo.json")
        if o is None or not self.objeto("objetivo.json", o):
            return None
        if o.get("atual") is not None:
            self.um_objetivo("objetivo.json/atual", o["atual"])
        ant = o.get("anteriores", [])
        if self.lista("objetivo.json.anteriores", ant):
            for i, x in enumerate(ant):
                self.um_objetivo(f"objetivo.json/anteriores[{i}]", x)
        mf = o.get("meta_final")
        if mf is not None and self.objeto("objetivo.json.meta_final", mf):
            self.numero("objetivo.json.meta_final.peso_kg", mf.get("peso_kg"), minimo=20, maximo=400)
            for k in ("gordura_pct", "gordura_inicial_pct"):
                self.numero(f"objetivo.json.meta_final.{k}", mf.get(k), minimo=3, maximo=60, obrigatorio=False)
            self.numero("objetivo.json.meta_final.peso_inicial_kg", mf.get("peso_inicial_kg"), minimo=20, maximo=400,
                        obrigatorio=False)
        return o

    # ---- dias ----
    def item(self, onde, it, dia_aberto_novo, fechado, alimentos, gramas_plano, lista):
        if not self.objeto(onde, it):
            return
        self.texto(f"{onde}.nome", it.get("nome"))
        self.texto(f"{onde}.qtd", it.get("qtd"), obrigatorio=False)
        ok = True
        for m in MACROS:
            ok &= self.numero(f"{onde}.{m}", it.get(m), minimo=0)
        if "fibra" in it:
            ok &= self.numero(f"{onde}.fibra", it["fibra"], minimo=0)
        aid = it.get("alimento")
        if aid is None:
            if dia_aberto_novo:
                self.erro(f"{onde}.alimento", "faltando — gere o item com scripts/item.py ou scripts/registrar.py")
            return
        if not isinstance(aid, str) or aid not in alimentos:
            self.erro(f"{onde}.alimento", f"'{aid}' não existe em alimentos.json")
            return
        if not self.numero(f"{onde}.quantidade", it.get("quantidade"), maior_que=0):
            return
        if ok and not fechado:
            exp = esperado(alimentos[aid], it["quantidade"])
            ruins = [f"{m} {it[m]}≠{exp[m]}" for m in MACROS if abs(it[m] - exp[m]) > TOL]
            if "fibra" in it and "fibra" in exp and abs(it["fibra"] - exp["fibra"]) > TOL:
                ruins.append(f"fibra {it['fibra']}≠{exp['fibra']}")
            if ruins:
                self.erro(onde, f"valores não batem com a biblioteca ({', '.join(ruins)})")
        if lista == "sugestao" and "plano_ate_g" in alimentos[aid]:
            gramas_plano[aid] = gramas_plano.get(aid, 0.0) + float(it["quantidade"])

    def dia(self, d, dia, alimentos, metas_obj):
        nome = f"{d}.json"
        if not self.objeto(nome, dia):
            return None
        if dia.get("data") != d:
            self.erro(f"{nome}.data", f"({dia.get('data')!r}) diferente do nome do arquivo")
        self.carimbo(f"{nome}.atualizado", dia.get("atualizado"))
        if not isinstance(dia.get("fechado"), bool):
            self.erro(f"{nome}.fechado", "precisa ser true/false")
        fechado = dia.get("fechado") is True
        self.metas(f"{nome}.meta", dia.get("meta"))
        self.numero(f"{nome}.peso_kg", dia.get("peso_kg"), minimo=20, maximo=400, obrigatorio=False)
        if dia.get("gordura_pct") is not None:
            self.numero(f"{nome}.gordura_pct", dia["gordura_pct"], minimo=3, maximo=50)
            if dia.get("gordura_fonte") not in FONTES_GORDURA:
                self.erro(f"{nome}.gordura_fonte", f"use um de {sorted(FONTES_GORDURA)}")
        self.texto(f"{nome}.sugestao_nota", dia.get("sugestao_nota"), obrigatorio=False, vazio=True)
        reg = dia.get("registro")
        if reg is not None and self.objeto(f"{nome}.registro", reg):
            if reg.get("status") not in STATUS_REGISTRO:
                self.erro(f"{nome}.registro.status", f"use 'completo' ou 'parcial' (veio {reg.get('status')!r})")
            self.carimbo(f"{nome}.registro.em", reg.get("em"))
        cor = dia.get("correcoes")
        if cor is not None and self.lista(f"{nome}.correcoes", cor):
            for i, c in enumerate(cor):
                o = f"{nome}.correcoes[{i}]"
                if self.objeto(o, c):
                    self.carimbo(f"{o}.em", c.get("em"))
                    self.texto(f"{o}.justificativa", c.get("justificativa"))
                    self.texto(f"{o}.id_evento", c.get("id_evento"))
        dia_aberto_novo = not fechado and d >= EXIGE_ID_DESDE
        gramas = {}
        ids = set()
        for lista in ("lancado", "sugestao"):
            refs = dia.get(lista)
            if not self.lista(f"{nome}.{lista}", refs):
                continue
            for ri, r in enumerate(refs):
                onde_r = f"{nome}.{lista}[{ri}]"
                if not self.objeto(onde_r, r):
                    continue
                self.texto(f"{onde_r}.refeicao", r.get("refeicao"))
                ev = r.get("id_evento")
                if ev is not None:
                    if self.texto(f"{onde_r}.id_evento", ev):
                        if ev in ids:
                            self.erro(f"{onde_r}.id_evento", f"'{ev}' repetido no mesmo dia")
                        ids.add(ev)
                self.carimbo(f"{onde_r}.consumido_em", r.get("consumido_em"), obrigatorio=False)
                self.carimbo(f"{onde_r}.registrado_em", r.get("registrado_em"), obrigatorio=False)
                if not self.lista(f"{onde_r}.itens", r.get("itens")):
                    continue
                for ii, it in enumerate(r["itens"]):
                    self.item(f"{onde_r}.itens[{ii}] ({it.get('nome', '?') if isinstance(it, dict) else '?'})",
                              it, dia_aberto_novo, fechado, alimentos, gramas, lista)
        if not fechado:
            for aid, g in gramas.items():
                lim = alimentos[aid]["plano_ate_g"]
                if g > lim:
                    self.aviso(f"{nome}.sugestao", f"planeja {g:g} g de {aid} (plano até {lim:g} g)")
            if metas_obj and isinstance(dia.get("meta"), dict) and {m: dia["meta"].get(m) for m in MACROS} != metas_obj:
                self.aviso(f"{nome}.meta", "diferente das metas do objetivo — atualizar 'meta' do dia aberto")
        return dia

    def rodar(self):
        alimentos = self.alimentos()
        self.refeicoes(alimentos)
        self.perfil()
        o = self.objetivo()
        metas_obj = None
        if isinstance(o, dict) and isinstance((o.get("atual") or {}).get("metas"), dict):
            metas_obj = {m: o["atual"]["metas"].get(m) for m in MACROS}

        dias = self.ler("dias.json")
        arquivos = sorted(p.name[:-5] for p in self.dados.glob("*.json") if DATA_RE.match(p.name[:-5]))
        for d in arquivos:
            if not data_valida(d):
                self.erro(f"{d}.json", "nome de arquivo com data impossível")
        if dias is not None and self.lista("dias.json", dias):
            vistos = set()
            for i, d in enumerate(dias):
                if not data_valida(d):
                    self.erro(f"dias.json[{i}]", f"data inválida {d!r}")
                    continue
                if d in vistos:
                    self.erro(f"dias.json[{i}]", f"data repetida {d}")
                vistos.add(d)
                if d not in arquivos:
                    self.erro(f"dias.json[{i}]", f"lista {d}, mas dados/{d}.json não existe")
            if [d for d in dias if isinstance(d, str)] != sorted(d for d in dias if isinstance(d, str)):
                self.erro("dias.json", "fora de ordem (precisa estar em ordem crescente)")
            for d in arquivos:
                if d not in vistos:
                    self.erro(f"{d}.json", "existe, mas não está em dias.json")
        for d in arquivos:
            if not data_valida(d):
                continue
            try:
                dia = ler_json(self.dados / f"{d}.json")
            except (ValueError, ErroJSON) as e:
                self.erro(f"{d}.json", f"JSON inválido ({e})")
                continue
            self.dia(d, dia, alimentos, metas_obj)

        idx = self.raiz / "index.html"
        m = re.search(r'data-dia="([^"]+)"', idx.read_text(encoding="utf-8")) if idx.exists() else None
        if not m or m.group(1) not in arquivos:
            self.erro("index.html", f"data-dia {m.group(1) if m else '?'} sem arquivo em dados/")

        # derivados: só compara se o resto está íntegro (senão o erro de origem já basta)
        if not self.erros:
            from derivados import resumo_texto  # import tardio: evita ciclo
            atual = (self.dados / "resumo.json")
            esperado_txt = resumo_texto(self.dados)
            if not atual.exists() or atual.read_text(encoding="utf-8") != esperado_txt:
                self.erro("resumo.json", "desatualizado em relação aos dias — rode python3 scripts/derivados.py")
        return self


def validar(raiz=ROOT):
    return Checagem(raiz).rodar()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raiz", default=str(ROOT))
    args = ap.parse_args()
    c = validar(args.raiz)
    for a in c.avisos:
        print(f"::warning::{a}")
    for e in c.erros:
        print(f"::error::{e}")
    n_dias = len(list((pathlib.Path(args.raiz) / "dados").glob("????-??-??.json")))
    if c.erros:
        print(f"\n{len(c.erros)} erro(s).")
        sys.exit(1)
    print(f"Dados OK ({n_dias} dias, {c.n_alimentos} alimentos, {len(c.avisos)} aviso(s)).")


if __name__ == "__main__":
    main()
