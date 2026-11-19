import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

from app import make_server


class AppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server("127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=5) as resp:
            return resp.status, resp.read().decode("utf-8")

    def test_health_returns_ok(self):
        status, body = self.get("/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"status": "ok"})

    def test_root_returns_greeting(self):
        status, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertEqual(body, "Hello from Autore sandbox")

    def test_root_menyertakan_app_version(self):
        with mock.patch.dict(os.environ, {"APP_VERSION": "autore-dummy-production-36"}):
            status, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertEqual(body, "Hello from Autore sandbox (autore-dummy-production-36)")

    def test_unknown_path_returns_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/nope")
        self.assertEqual(ctx.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
