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
