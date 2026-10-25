import threading

from store import Store


def test_concurrent_updates_keep_status_valid(tmp_path):
    s = Store(tmp_path)
    lid = s.create("mic", None)["id"]
    errors = []

    def writer(key):
        try:
            for i in range(300):
                s.update(lid, **{key: i})
        except Exception as e:
            errors.append(e)

    def reader():
        try:
            for _ in range(300):
                s.list(); s.get(lid)
        except Exception as e:
            errors.append(e)

    ts = [threading.Thread(target=f, args=a) for f, a in [(writer, ("a",)), (writer, ("b",)), (reader, ())]]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert not errors
    st = s.get(lid)
    assert st["a"] == 299 and st["b"] == 299  # no lost updates
