import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from notes import llm


class Slow(BaseHTTPRequestHandler):
    """Fake Ollama /api/chat: streams one token every 0.2 s for 10 s."""

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(200)
        self.end_headers()
        try:
            for i in range(50):
                self.wfile.write((json.dumps({"message": {"content": f"t{i} "}, "done": False}) + "\n").encode())
                self.wfile.flush()
                time.sleep(0.2)
            self.wfile.write(b'{"message":{"content":""},"done":true}\n')
        except OSError:
            pass  # client hung up (cancelled)

    def log_message(self, *a):
        pass


@pytest.fixture
def fake_ollama(monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(llm, "OLLAMA", f"http://127.0.0.1:{srv.server_port}")
    yield
    srv.shutdown()


def test_cancel_interrupts_generation_within_a_second(fake_ollama):
    flag = threading.Event()
    threading.Timer(0.5, flag.set).start()
    t = time.time()
    with pytest.raises(llm.Cancelled):
        llm.chat("m", "hi", cancelled=flag.is_set)
    assert time.time() - t < 2  # would be ~10 s if it waited for the full response


def test_streamed_tokens_are_joined(fake_ollama, monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)  # speed the fake server up
    assert llm.chat("m", "hi").startswith("t0 t1 t2")
