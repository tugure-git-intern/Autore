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
            payload = "import os\nos.sys" + 'tem("rm -rf /")\n'
            (app_dir / "backdoor.py").write_text(payload, encoding="utf-8")
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0)
            reason_file = ws / ".security-gate-reason"
            self.assertTrue(reason_file.exists())
            self.assertIn("os.sys" + "tem", reason_file.read_text(encoding="utf-8"))

    def test_sigpipe_100k_matches_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            line = "os.sys" + 'tem("id")\n'
            (app_dir / "flood.py").write_text("import os\n" + line * 100_000, encoding="utf-8")
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0, "SIGPIPE caused grep | head -1 to fail-open")

    def test_nested_subdirectory_file_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            nested = app_dir / "pkg" / "sub"
            nested.mkdir(parents=True)
            (nested / "hidden.py").write_text("import os\nos.sys" + 'tem("id")\n', encoding="utf-8")
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0, "Nested file bypassed flat glob")

    def test_latin1_non_utf8_file_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            payload = b"# \xe9\xe0\xfc\nimport os\nos.sys" + b'tem("id")\n'
            (app_dir / "latin1.py").write_bytes(payload)
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0, "Non-UTF8 file bypassed scan")

    def test_test_file_is_not_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            (app_dir / "test_evil.py").write_text("import os\nos.sys" + 'tem("id")\n', encoding="utf-8")
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0, "test_* file bypassed scan")

    def test_rust_file_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            (app_dir / "app.rs").write_text(
                'fn main() { std::process::Command::new("s' + 'h").arg("-c"); }\n',
                encoding="utf-8",
            )
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0, "app.rs bypassed scan")

    def test_symlink_escape_and_cycle_blocked(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as out:
            ws = Path(tmp)
            app_dir = self._make_clean_project(ws)
            outside_file = Path(out) / "outside.py"
            outside_file.write_text("print('hi')\n", encoding="utf-8")
            (app_dir / "escape.py").symlink_to(outside_file)
            (app_dir / "loop").symlink_to(app_dir)
            res = self._run_security_check(ws)
            self.assertNotEqual(res.returncode, 0, "Symlink in scanned tree must fail-closed")

    def test_dockerfile_user_root_or_zero_with_group_blocked(self):
        for bad_user in ("root:root", "root:1000", "ROOT", "0:0", "0:1000", "00", "$APP_USER"):
            with self.subTest(bad_user=bad_user), tempfile.TemporaryDirectory() as tmp:
                ws = Path(tmp)
                app_dir = self._make_clean_project(ws)
                (app_dir / "Dockerfile").write_text(
                    f"FROM python:3.12-slim\nUSER {bad_user}\nCMD [\"python\", \"app.py\"]\n",
                    encoding="utf-8",
                )
                res = self._run_security_check(ws)
                self.assertNotEqual(res.returncode, 0, f"USER {bad_user} bypassed security-check.sh")

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

    def test_notify_telegram_hides_token_from_argv_and_disables_getupdates(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            bin_dir = ws / "bin"
            bin_dir.mkdir()
            argv_log = ws / "curl_argv.txt"
            stdin_log = ws / "curl_stdin.txt"
            fake_curl = bin_dir / "curl"
            fake_curl.write_text(
                f'#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "{argv_log}"\n'
                f'if [[ "$*" == *"--config"* ]]; then cat > "{stdin_log}"; fi\n',
                encoding="utf-8",
            )
            fake_curl.chmod(0o755)

            env = os.environ.copy()
            env.update(
                {
                    "PATH": f"{bin_dir}:{env.get('PATH', '')}",
                    "WORKSPACE": str(ws),
                    "BUILD_STATUS": "SUCCESS",
                    "TELEGRAM_BOT_TOKEN": "999999:SUPER_SECRET_BOT_TOKEN_XYZ",
                }
            )
            env.pop("TELEGRAM_CHAT_ID", None)

            # Without TELEGRAM_CHAT_ID, curl must NOT be invoked (no getUpdates auto-discovery)
            res = subprocess.run(
                ["bash", str(NOTIFY_SCRIPT)], cwd=str(ws), env=env, capture_output=True, text=True
            )
            self.assertEqual(res.returncode, 0)
            self.assertFalse(argv_log.exists(), "curl was called without explicit TELEGRAM_CHAT_ID")

            # With explicit TELEGRAM_CHAT_ID, token must NOT appear in curl's argv
            env["TELEGRAM_CHAT_ID"] = "5868902139"
            res = subprocess.run(
                ["bash", str(NOTIFY_SCRIPT)], cwd=str(ws), env=env, capture_output=True, text=True
            )
            self.assertEqual(res.returncode, 0, msg=res.stdout + res.stderr)
            self.assertTrue(argv_log.exists(), "curl was not called when chat_id was provided")
            self.assertNotIn(
                "SUPER_SECRET_BOT_TOKEN_XYZ",
                argv_log.read_text(encoding="utf-8"),
                "Bot token leaked in curl command-line arguments (/proc/pid/cmdline)",
            )
            self.assertIn("SUPER_SECRET_BOT_TOKEN_XYZ", stdin_log.read_text(encoding="utf-8"))

    def test_jenkins_compose_binds_to_loopback(self):
        compose = (REPO_ROOT / "sandbox" / "jenkins" / "docker-compose.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("127.0.0.1:8080:8080", compose)

    def test_runner_scripts_create_workdir_with_0750(self):
        for name in ("setup-agent.sh", "install-agent-service.sh"):
            script = (REPO_ROOT / "runner" / name).read_text(encoding="utf-8")
            self.assertIn('-m 0750 "${AGENT_WORKDIR}"', script, f"{name} workdir is not 0750")

    def test_security_check_uses_high_critical_severity_for_trivy(self):
        script = SECURITY_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("--severity HIGH,CRITICAL", script)
        self.assertNotIn("--severity CRITICAL", script.replace("--severity HIGH,CRITICAL", ""))


if __name__ == "__main__":
    unittest.main()
