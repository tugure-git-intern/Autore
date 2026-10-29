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

    def test_build_musl_release_produces_static_binary_and_checksums(self):
        build_script = REPO_ROOT / "scripts" / "build-musl-release.sh"
        self.assertTrue(build_script.exists(), "scripts/build-musl-release.sh must exist")
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            env = os.environ.copy()
            env["DIST_DIR"] = str(dist)
            res = subprocess.run(
                ["bash", str(build_script)],
                cwd=str(REPO_ROOT),
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(res.returncode, 0, msg=res.stdout + res.stderr)
            bin_path = dist / "autore-linux-x86_64-musl"
            self.assertTrue(bin_path.exists(), "dist/autore-linux-x86_64-musl must be created")
            checksum_path = dist / "SHA256SUMS"
            self.assertTrue(checksum_path.exists(), "dist/SHA256SUMS must be created")
            verify = subprocess.run(
                ["sha256sum", "-c", "SHA256SUMS"],
                cwd=str(dist),
                capture_output=True,
                text=True,
            )
            self.assertEqual(verify.returncode, 0, msg=verify.stdout + verify.stderr)

    def test_sonarqube_gate_disables_internal_clippy_and_imports_report(self):
        gate_script = REPO_ROOT / "scripts" / "ci-sonarqube-gate.sh"
        self.assertTrue(gate_script.exists(), "scripts/ci-sonarqube-gate.sh must exist")
        content = gate_script.read_text(encoding="utf-8")
        self.assertIn("cargo clippy --all-targets --message-format=json -- -D warnings", content)
        self.assertIn("-Dsonar.rust.clippy.enabled=false", content)
        self.assertIn("-Dsonar.rust.clippyReport.reportPaths=", content)
        self.assertIn("sonarsource/sonar-scanner-cli:12.3.0.4285_8.1.0@sha256:47956b669bf486bdad919e1cbd0533223515aa0b6d1d31763e5a3754942df6d7", content)

    def test_sonarqube_gate_polls_ce_task_and_verifies_analysis_id_and_rust_ncloc(self):
        gate_script = REPO_ROOT / "scripts" / "ci-sonarqube-gate.sh"
        self.assertTrue(gate_script.exists())
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            bin_dir = ws / "bin"
            bin_dir.mkdir()
            curl_log = ws / "curl_calls.log"

            # Fake curl that records requests and returns mock Sonar responses
            fake_curl = bin_dir / "curl"
            fake_curl.write_text(
                "#!/usr/bin/env bash\n"
                f'echo "$@" >> "{curl_log}"\n'
                'stdin_cfg=""\n'
                'if [[ "$*" == *"--config"* ]]; then\n'
                '  stdin_cfg="$(cat)"\n'
                f'  echo "STDIN: $stdin_cfg" >> "{curl_log}"\n'
                'fi\n'
                'target="${*} ${stdin_cfg}"\n'
                'if [[ "$target" == *"/api/languages/list"* ]]; then\n'
                '  echo \'{"languages":[{"key":"rust","name":"Rust"}]}\'\n'
                'elif [[ "$target" == *"/api/ce/task"* ]]; then\n'
                '  echo \'{"task":{"id":"ce-123","status":"SUCCESS","analysisId":"analysis-456"}}\'\n'
                'elif [[ "$target" == *"/api/qualitygates/project_status"* ]]; then\n'
                '  echo \'{"projectStatus":{"status":"OK"}}\'\n'
                'elif [[ "$target" == *"/api/measures/component"* ]]; then\n'
                '  echo \'{"component":{"measures":[{"metric":"ncloc_language_distribution","value":"rust=1200;python=300"}]}}\'\n'
                'fi\n'
                'exit 0\n',
                encoding="utf-8",
            )
            fake_curl.chmod(0o755)

            # Fake docker that writes report-task.txt
            fake_docker = bin_dir / "docker"
            fake_docker.write_text(
                "#!/usr/bin/env bash\n"
                'mkdir -p .scannerwork\n'
                'echo "ceTaskId=ce-123" > .scannerwork/report-task.txt\n'
                'exit 0\n',
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)

            # Fake cargo that writes clippy-report.json
            fake_cargo = bin_dir / "cargo"
            fake_cargo.write_text(
                "#!/usr/bin/env bash\n"
                'echo "{}" > clippy-report.json\n'
                'exit 0\n',
                encoding="utf-8",
            )
            fake_cargo.chmod(0o755)

            env = os.environ.copy()
            env["PATH"] = f"{bin_dir}:{env['PATH']}"
            env["SONAR_TOKEN"] = "squ_super_secret_token_12345"
            env["SONAR_PROJECT_KEY"] = "test-project"
            env["WORKSPACE"] = str(ws)

            res = subprocess.run(
                ["bash", str(gate_script)],
                cwd=str(ws),
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(res.returncode, 0, msg=res.stdout + res.stderr)
            calls = curl_log.read_text(encoding="utf-8")
            self.assertIn("/api/ce/task?id=ce-123", calls)
            self.assertIn("/api/qualitygates/project_status?analysisId=analysis-456", calls)
            self.assertIn("metricKeys=ncloc,ncloc_language_distribution", calls)
            self.assertNotIn("squ_super_secret_token_12345", [arg for arg in calls.splitlines() if not arg.startswith("STDIN:")], "Token leaked in curl argv")

    def test_sonarqube_gate_fails_when_rust_ncloc_zero(self):
        gate_script = REPO_ROOT / "scripts" / "ci-sonarqube-gate.sh"
        self.assertTrue(gate_script.exists())
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            bin_dir = ws / "bin"
            bin_dir.mkdir()

            fake_curl = bin_dir / "curl"
            fake_curl.write_text(
                "#!/usr/bin/env bash\n"
                'stdin_cfg=""\n'
                'if [[ "$*" == *"--config"* ]]; then\n'
                '  stdin_cfg="$(cat)"\n'
                'fi\n'
                'target="${*} ${stdin_cfg}"\n'
                'if [[ "$target" == *"/api/languages/list"* ]]; then\n'
                '  echo \'{"languages":[{"key":"rust","name":"Rust"}]}\'\n'
                'elif [[ "$target" == *"/api/ce/task"* ]]; then\n'
                '  echo \'{"task":{"id":"ce-123","status":"SUCCESS","analysisId":"analysis-456"}}\'\n'
                'elif [[ "$target" == *"/api/qualitygates/project_status"* ]]; then\n'
                '  echo \'{"projectStatus":{"status":"OK"}}\'\n'
                'elif [[ "$target" == *"/api/measures/component"* ]]; then\n'
                '  echo \'{"component":{"measures":[{"metric":"ncloc_language_distribution","value":"python=300"}]}}\'\n'
                'fi\n'
                'exit 0\n',
                encoding="utf-8",
            )
            fake_curl.chmod(0o755)

            fake_docker = bin_dir / "docker"
            fake_docker.write_text(
                "#!/usr/bin/env bash\n"
                'mkdir -p .scannerwork\n'
                'echo "ceTaskId=ce-123" > .scannerwork/report-task.txt\n'
                'exit 0\n',
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)

            fake_cargo = bin_dir / "cargo"
            fake_cargo.write_text(
                "#!/usr/bin/env bash\n"
                'echo "{}" > clippy-report.json\n'
                'exit 0\n',
                encoding="utf-8",
            )
            fake_cargo.chmod(0o755)

            # Create a dummy .rs file in ws to indicate this is a Rust project
            (ws / "src").mkdir()
            (ws / "src" / "main.rs").write_text("fn main() {}\n", encoding="utf-8")

            env = os.environ.copy()
            env["PATH"] = f"{bin_dir}:{env['PATH']}"
            env["SONAR_TOKEN"] = "squ_secret"
            env["WORKSPACE"] = str(ws)

            res = subprocess.run(
                ["bash", str(gate_script)],
                cwd=str(ws),
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(res.returncode, 0, "Gate must fail when rust ncloc is absent on a Rust project")

    def test_nexus_publish_rejects_latest_or_short_sha_tag(self):
        pub_script = REPO_ROOT / "scripts" / "ci-nexus-publish.sh"
        self.assertTrue(pub_script.exists(), "scripts/ci-nexus-publish.sh must exist")
        env = os.environ.copy()
        env["APP_NAME"] = "dummy-app"
        env["BUILD_NUMBER"] = "1"
        env["NEXUS_USER"] = "admin"
        env["NEXUS_PASS"] = "secret"

        # 1. Reject SHORT_SHA (7 chars)
        env["GIT_COMMIT"] = "e77d504"
        res = subprocess.run(["bash", str(pub_script)], env=env, capture_output=True, text=True)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("40", res.stderr + res.stdout)

        # 2. Reject 'latest'
        env["GIT_COMMIT"] = "latest"
        res = subprocess.run(["bash", str(pub_script)], env=env, capture_output=True, text=True)
        self.assertNotEqual(res.returncode, 0)

    def test_nexus_publish_verifies_allow_once_and_authenticated_head_digest(self):
        pub_script = REPO_ROOT / "scripts" / "ci-nexus-publish.sh"
        self.assertTrue(pub_script.exists())
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            bin_dir = ws / "bin"
            bin_dir.mkdir()
            dist_dir = ws / "dist"
            dist_dir.mkdir()
            (dist_dir / "autore-linux-x86_64-musl").write_bytes(b"static-binary")
            (dist_dir / "sbom.cdx.json").write_text('{"bomFormat":"CycloneDX"}', encoding="utf-8")
            (dist_dir / "SHA256SUMS").write_text("dummy sha256sums\n", encoding="utf-8")

            call_log = ws / "calls.log"
            digest_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            full_commit = "e77d5049f8a12b3c4d5e6f708192a3b4c5d6e7f8"

            fake_docker = bin_dir / "docker"
            fake_docker.write_text(
                "#!/usr/bin/env bash\n"
                f'echo "DOCKER $@" >> "{call_log}"\n'
                'if [[ "$*" == *"inspect"* ]]; then\n'
                f'  echo "127.0.0.1:5000/dummy-app@sha256:{digest_hex}"\n'
                'fi\n'
                'exit 0\n',
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)

            fake_curl = bin_dir / "curl"
            fake_curl.write_text(
                "#!/usr/bin/env bash\n"
                f'echo "CURL $@" >> "{call_log}"\n'
                'stdin_cfg=""\n'
                'if [[ "$*" == *"--config"* ]]; then\n'
                '  stdin_cfg="$(cat)"\n'
                f'  echo "STDIN: $stdin_cfg" >> "{call_log}"\n'
                'fi\n'
                'target="${*} ${stdin_cfg}"\n'
                'if [[ "$target" == *"/service/rest/v1/repositories/docker/hosted"* ]]; then\n'
                '  echo \'{"storage":{"writePolicy":"ALLOW_ONCE"}}\'\n'
                'elif [[ "$*" == *"-X HEAD"* || "$*" == *"-I"* || "$*" == *"-fsSI"* ]]; then\n'
                '  echo "HTTP/1.1 200 OK"\n'
                f'  echo "Docker-Content-Digest: sha256:{digest_hex}"\n'
                'fi\n'
                'exit 0\n',
                encoding="utf-8",
            )
            fake_curl.chmod(0o755)

            env = os.environ.copy()
            env["PATH"] = f"{bin_dir}:{env['PATH']}"
            env["WORKSPACE"] = str(ws)
            env["DIST_DIR"] = str(dist_dir)
            env["APP_NAME"] = "dummy-app"
            env["BUILD_NUMBER"] = "42"
            env["GIT_COMMIT"] = full_commit
            env["NEXUS_USER"] = "admin"
            env["NEXUS_PASS"] = "SuperSecretPassword123"

            res = subprocess.run(["bash", str(pub_script)], env=env, cwd=str(ws), capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, msg=res.stdout + res.stderr)

            verified_digest_file = ws / ".verified-image-digest"
            self.assertTrue(verified_digest_file.exists(), ".verified-image-digest must be created")
            self.assertEqual(
                verified_digest_file.read_text(encoding="utf-8").strip(),
                f"127.0.0.1:5000/dummy-app@sha256:{digest_hex}",
            )

            calls = call_log.read_text(encoding="utf-8")
            self.assertIn(f"/v2/dummy-app/manifests/sha256:{digest_hex}", calls)
            self.assertNotIn("SuperSecretPassword123", [c for c in calls.splitlines() if not c.startswith("STDIN:")])

    def test_deploy_by_digest_rejects_tag_without_sha256_digest(self):
        dep_script = REPO_ROOT / "scripts" / "ci-deploy-by-digest.sh"
        self.assertTrue(dep_script.exists(), "scripts/ci-deploy-by-digest.sh must exist")
        for bad_ref in ("127.0.0.1:5000/app:latest", "127.0.0.1:5000/app:build-1", "127.0.0.1:5000/app"):
            res = subprocess.run(["bash", str(dep_script), bad_ref], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0, f"Deploy script must reject {bad_ref}")


if __name__ == "__main__":
    unittest.main()
