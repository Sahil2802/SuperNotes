from fastapi.testclient import TestClient

from app import create_app


def make(store, title, said, summary="", terms=()):
    lid = store.create("mic", None)["id"]
    store.update(lid, title=title)
    store.write_json(lid, "transcript.json", [{"start": 0, "end": 1, "text": said}])
    store.write_json(lid, "extract.json", {"flashcards": [], "terms": [{"term": t, "definition": d} for t, d in terms], "actions": []})
    (store.dir(lid) / "summary.md").write_text(summary)
    return lid


def test_search(tmp_path):
    app = create_app("secret", tmp_path)
    c = TestClient(app, headers={"X-Token": "secret"})
    a = make(app.state.store, "Calculus", "we talked about Gradient Descent today")
    b = make(app.state.store, "History", "the war", summary="descent into chaos", terms=[("gradient", "slope")])

    r = c.get("/search", params={"q": "gradient descent"}).json()
    assert {x["id"] for x in r} == {a, b}  # words may sit in different fields
    assert next(x for x in r if x["id"] == a)["matched"] == ["transcript"]
    assert "Gradient Descent" in next(x for x in r if x["id"] == a)["snippet"]
    assert [x["id"] for x in c.get("/search", params={"q": "WAR chaos"}).json()] == [b]
    assert c.get("/search", params={"q": "gradient", "scope": "names"}).json() == []
    assert [x["id"] for x in c.get("/search", params={"q": "calc", "scope": "names"}).json()] == [a]
    assert c.get("/search", params={"q": ""}).status_code == 422
