import pytest

import config
import main


@pytest.fixture
def sampling(monkeypatch):
    monkeypatch.setattr(config, "TEMP", 0.7)
    monkeypatch.setattr(config, "TOP_P", 0.95)
    monkeypatch.setattr(config, "THINK_TEMP", 0.9)
    return main._sampling


def test_default_8b_uses_think_temp(sampling):
    assert sampling("8b", False, None, None) == {"temperature": 0.9, "top_p": 0.95}


def test_8b_no_think_uses_temp(sampling):
    assert sampling("8b", True, None, None) == {"temperature": 0.7, "top_p": 0.95}


def test_other_model_uses_temp(sampling):
    assert sampling("5-1b", False, None, None) == {"temperature": 0.7, "top_p": 0.95}
    assert sampling("5-1b", True, None, None) == {"temperature": 0.7, "top_p": 0.95}


def test_explicit_temperature_passthrough(sampling):
    assert sampling("8b", False, 0.2, None) == {"temperature": 0.2, "top_p": 0.95}


def test_explicit_top_p_passthrough(sampling):
    assert sampling("8b", True, None, 0.5) == {"temperature": 0.7, "top_p": 0.5}


def test_all_explicit(sampling):
    assert sampling("8b", False, 0.3, 0.4) == {"temperature": 0.3, "top_p": 0.4}