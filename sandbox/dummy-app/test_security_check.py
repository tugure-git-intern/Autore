import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SECURITY_SCRIPT = REPO_ROOT / "scripts" / "security-check.sh"
NOTIFY_SCRIPT = REPO_ROOT / "scripts" / "notify-telegram.sh"


class SecurityGateTest(unittest.TestCase):
    def _make_clean_project(self, tmpdir: Path):
        app_dir = tmpdir / "sandbox" / "dummy-app"
        app_dir.mkdir(parents=True, exist_ok=True)
        (app_dir / "app.py").write_text(
            'def greet():\n    return "Hello safe world"\n',
            encoding="utf-8",
        )
        (app_dir / "Dockerfile").write_text(
            "FROM python:3.12-slim\n"
            "WORKDIR /app\n"
            "COPY app.py ./\n"
            "RUN useradd --system --no-create-home appuser\n"
            "USER appuser\n"
            'CMD ["python", "app.py"]\n',
            encoding="utf-8",
        )
        return app_dir

    def _run_security_check(self, workspace: Path, skip_docker: bool = True):
        env = os.environ.copy()
        env["WORKSPACE"] = str(workspace)
        env["APP_DIR"] = "sandbox/dummy-app"
        if skip_docker:
            env["SECURITY_SKIP_DOCKER"] = "1"
        return subprocess.run(
            ["bash", str(SECURITY_SCRIPT)],
            cwd=str(workspace),
            env=env,
            capture_output=True,
            text=True,
        )

    def test_clean_directory_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            self._make_clean_project(ws)
            res = self._run_security_check(ws)
            self.assertEqual(res.returncode, 0, msg=res.stdout + res.stderr)

    def test_dangerous_eval_or_os_system_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            (app_dir / "backdoor.py").write_text(
                'import os\nos.system("rm -rf /")\n',
                encoding="utf-8",
            )
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0)
            reason_file = ws / ".security-gate-reason"
            self.assertTrue(reason_file.exists())
            self.assertIn("os.system", reason_file.read_text(encoding="utf-8"))

    def test_dockerfile_without_non_root_user_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            (app_dir / "Dockerfile").write_text(
                "FROM python:3.12-slim\nCOPY app.py ./\nCMD [\"python\", \"app.py\"]\n",
                encoding="utf-8",
            )
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0)
            reason_file = ws / ".security-gate-reason"
            self.assertTrue(reason_file.exists())
            self.assertIn("USER", reason_file.read_text(encoding="utf-8"))

    def test_hardcoded_secret_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            # Build fake token at runtime so bytecode does not store a literal PAT
            prefix = "".join(["gh", "p_"])
            body = "".join(chr(65 + (i * 7 % 26)) for i in range(36))
            fake_token = f"{prefix}{body}"
            (app_dir / "config.py").write_text(
                f'GITHUB_TOKEN = "{fake_token}"\n',
                encoding="utf-8",
            )
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0)
            reason_file = ws / ".security-gate-reason"
            self.assertTrue(reason_file.exists())

    def test_notify_telegram_formats_report_without_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / ".security-gate-reason").write_text(
                "Terdeteksi fungsi berbahaya os.system di backdoor.py",
                encoding="utf-8",
            )
            env = os.environ.copy()
            env.update(
                {
                    "WORKSPACE": str(ws),
                    "BUILD_STATUS": "FAILURE",
                    "APP_NAME": "autore-dummy",
                    "BUILD_NUMBER": "99",
                    "GIT_BRANCH": "origin/main",
                    "SHORT_SHA": "a1b2c3d",
                    "AUDIT_AUTHOR": "Budi <budi@example.com>",
                    "AUDIT_MESSAGE": "coba tambah fitur",
                    "NODE_NAME": "vps-runner-1",
                    "FAILED_STAGE": "Security Gate",
                }
            )
            env.pop("TELEGRAM_BOT_TOKEN", None)
            env.pop("TELEGRAM_CHAT_ID", None)
            res = subprocess.run(
                ["bash", str(NOTIFY_SCRIPT)],
                cwd=str(ws),
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(res.returncode, 0, msg=res.stdout + res.stderr)
            self.assertIn("Budi <budi@example.com>", res.stdout)
            self.assertIn("Security Gate", res.stdout)
            self.assertIn("os.system", res.stdout)


if __name__ == "__main__":
    unittest.main()
