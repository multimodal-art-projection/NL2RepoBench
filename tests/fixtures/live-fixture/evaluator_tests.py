from pathlib import Path
import attrs
from answer import Answer, answer, add


def test_answer():
    assert answer() == 42


def test_add():
    assert add(2, 3) == 5
    assert add(-2, 2) == 0


def test_prepared_dependency():
    assert attrs.has(Answer)
    assert Answer().value == 42


def test_real_readme():
    text = Path("README.md").read_text().strip()
    assert len(text) >= 20
    assert not text.startswith("[Written file body omitted")
    assert not text.startswith("Previously completed file write receipts:")
