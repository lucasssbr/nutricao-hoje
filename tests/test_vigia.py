"""Vigia da publicação (scripts/vigia.py): só cancela o que está preso em "waiting" há mais de 30 min."""
import datetime
import sys
import unittest

from base import RAIZ

sys.path.insert(0, str(RAIZ / "scripts"))
from vigia import presas  # noqa: E402

AGORA = datetime.datetime(2026, 10, 6, 18, 0, tzinfo=datetime.timezone.utc)


def run(i, status, minutos_atras):
    t = (AGORA - datetime.timedelta(minutes=minutos_atras)).isoformat().replace("+00:00", "Z")
    return {"id": i, "status": status, "created_at": t, "updated_at": t}


class Vigia(unittest.TestCase):
    def test_so_waiting_antigo(self):
        runs = [run(1, "waiting", 9 * 60),      # o caso de 06/10: 9 h em waiting → cancela
                run(2, "waiting", 5),           # esperando o ambiente agora há pouco → normal
                run(3, "pending", 120),         # fila normal (concurrency) → nunca
                run(4, "queued", 120),
                run(5, "in_progress", 120),     # rodando → nunca (o job tem timeout próprio)
                run(6, "waiting", 31)]
        self.assertEqual(presas(runs, AGORA), [1, 6])

    def test_nada_preso(self):
        self.assertEqual(presas([], AGORA), [])
        self.assertEqual(presas([run(1, "waiting", 29)], AGORA), [])


if __name__ == "__main__":
    unittest.main()
