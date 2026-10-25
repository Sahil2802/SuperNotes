from fastapi.testclient import TestClient

from app import create_app


def client(tmp_path):
    return TestClient(create_app("secret", tmp_path))


def test_health_requires_token(tmp_path):
    c = client(tmp_path)
    assert c.get("/health").status_code == 401
    assert c.get("/health", headers={"X-Token": "wrong"}).status_code == 401


def test_health_ok(tmp_path):
    r = client(tmp_path).get("/health", headers={"X-Token": "secret"})
    assert r.status_code == 200 and r.json()["ready"] is True


def test_model_load_reports_state(tmp_path, monkeypatch):
    import app as app_mod

    called = []
    monkeypatch.setattr(app_mod, "load", lambda m: called.append(m))
    c = client(tmp_path)
    assert c.post("/model/load").status_code == 401
    assert c.post("/model/load", headers={"X-Token": "secret"}).json() == {"loading": True}
    import time

    for _ in range(50):
        if called:
            break
        time.sleep(0.05)
    assert called == ["llama3.1:8b"]
