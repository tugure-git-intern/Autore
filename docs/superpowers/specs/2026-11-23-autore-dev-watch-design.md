# `autore dev` Automatic Watch Design

## Intent

Developers should run `autore dev` once and edit project files without learning Docker commands or restarting Autore manually. Current `autore dev` builds one image and runs one container; the container does not receive later host edits.

## Goals

- Make watch mode the default for `autore dev`; one command starts development and watches project files.
- For Python and Node.js, sync ordinary project changes into the running container and restart the app, avoiding an image rebuild.
- For Java and Go, rebuild and replace the container on project changes because source changes need compilation.
- Rebuild for changes to `Dockerfile`, `.dockerignore`, or stack dependency manifests/lockfiles.
- Keep `autore dev` local-only; do not call GitHub, Jenkins, or production services.
- Keep existing user `Dockerfile` and `.dockerignore` byte-for-byte; generated files remain create-if-missing.
- Keep Ctrl+C as the stop action and clean up the development container/resources.
- Do not add a Rust dependency; use Docker Compose Watch.

## Non-goals

- Guarantee application-level hot reload without restarting its process.
- Generate application code or framework-specific run commands.
- Change Java/Go to interpreted development servers.
- Modify `autore connect`, deploy, or production pipeline behavior.

## Behavior

- `autore dev` remains the entry point and enables watch behavior automatically; no required extra script or remembered flag.
- Require Docker Compose 2.23.0 or newer. Compose Watch starts at 2.22.0, but `sync+restart` was added in 2.23.0. If unavailable, fail before launching the development service with an actionable version/upgrade message; do not silently fall back to the current non-watching mode.
- Retain existing stack detection, port selection, image build, URL output, and app-name validation.
- Use a temporary Compose definition, not a generated Compose file in the user's repository. Resolve build context and watch paths to the selected project directory.
- Generated Python and Node.js Dockerfiles with Autore's explicit watch-ready marker: `sync+restart` ordinary files into `/app`; `rebuild` for `Dockerfile`, `.dockerignore`, and stack dependency manifests/lockfiles. Update only Autore's generated templates to make `/app` writable by the existing non-root runtime user. Existing generated files without the marker count as custom for watch behavior and are not rewritten.
- Custom Dockerfiles and Java/Go projects: `rebuild` on project changes. Never guess a custom image's working directory or weaken its runtime user to enable sync.
- Dependency files that trigger rebuild:
  - Python: `requirements*.txt`, `pyproject.toml`, `setup.py`, `setup.cfg`, `Pipfile`, `Pipfile.lock`, `poetry.lock`, `uv.lock`.
  - Node.js: `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `.npmrc`.
  - Java: `pom.xml`, `build.gradle`, `build.gradle.kts`, `gradle.properties`, `gradlew`, `mvnw`, `mvnw.cmd`, and `gradle/wrapper/gradle-wrapper.properties`.
  - Go rebuilds for all project-file changes, so `go.mod`, `go.sum`, source, and vendor changes are included.
- Exclude `.git`, generated dependency/build directories, `.env`, `.env.*`, `*.secret`, `*.pem`, `*.key`, and `*.p12` from sync/watch rules. Keep existing Docker build-context and `.dockerignore` behavior; do not claim protection against secrets omitted from a user-owned `.dockerignore`.
- Keep local project files as the source of truth. Give each invocation a unique Compose project name so it cannot remove or adopt another run's containers. Ctrl+C stops and removes only resources belonging to that invocation, not unrelated containers or images. A port collision fails without touching existing containers.

## Constraints and calls left to implementation

- Existing generated runtime images use non-root users, so generated Dockerfile permissions must be adjusted narrowly for the watch target without weakening runtime identity.
- Compose Watch handles file detection and cross-platform host sync; do not build a second Rust watcher.
- Initial image build can still take minutes. The feature must avoid rebuilding for ordinary Python/Node edits; compiled Java/Go rebuilds are an explicit tradeoff.
- Validate path quoting, temporary Compose-file cleanup, signals, and container naming on Linux and Windows. User files and pre-existing containers must remain untouched.

## Success criteria

- Start `autore dev` once for a Python or Node project; edit an ordinary source file; observe sync and app restart without `docker build`.
- Change a dependency manifest or Dockerfile; observe image rebuild and service replacement.
- Start `autore dev` for Java or Go; edit source; observe rebuild and service replacement.
- Ctrl+C exits and leaves no Autore dev container running.
- Older/missing Compose Watch fails clearly before creating a development container.
- Existing Dockerfile and `.dockerignore` remain unchanged.
