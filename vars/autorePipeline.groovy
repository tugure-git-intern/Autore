// vars/autorePipeline.groovy
// Admin-controlled trusted Jenkins Shared Library for Autore DevSecOps CI/CD.

def call(Map config = [:]) {
    def appName = config.appName ?: 'autore-dummy'
    def appPort = config.appPort ?: 8000
    def deployPort = config.deployPort ?: 8081
    def dockerfileDir = config.dockerfileDir ?: '.'
    def sonarProjectKey = config.sonarProjectKey ?: (appName == 'autore-dummy' ? 'autore-cli' : appName)
    def sonarCreds = config.sonarCredentialsId ?: 'sonarqube-token'
    def nexusCreds = config.nexusCredentialsId ?: 'nexus-credentials'
    def telegramCreds = config.telegramCredentialsId ?: 'telegram-bot-token'
    def telegramChatId = config.telegramChatId ?: '5868902139'
    def nexusRegistry = config.nexusRegistry ?: '127.0.0.1:5000'

    pipeline {
        agent { label 'vps-runner-1' }

        options {
            timeout(time: 30, unit: 'MINUTES')
            disableConcurrentBuilds()
            buildDiscarder(logRotator(numToKeepStr: '30'))
        }

        environment {
            APP_NAME = "${appName}"
            APP_PORT = "${appPort}"
            DEPLOY_PORT = "${deployPort}"
            DOCKERFILE_DIR = "${dockerfileDir}"
            SONAR_PROJECT_KEY = "${sonarProjectKey}"
            NEXUS_DOCKER_REGISTRY = "${nexusRegistry}"
        }

        stages {
            stage('1. Checkout & Audit Metadata') {
                steps {
                    script { env.FAILED_STAGE = '1. Checkout & Audit Metadata' }
                    sh 'rm -rf .security-gate-reason .verified-image-digest dist'
                    script {
                        // Script gate HANYA dari direktori yang dipasang admin (runner/setup-agent.sh).
                        // Repo yang dipindai tidak boleh menyediakan kode yang menentukan lulus/gagal.
                        def trusted = '/usr/local/lib/autore-ci'
                        def needed = ['ci-sonarqube-gate.sh', 'build-musl-release.sh',
                                      'ci-nexus-publish.sh', 'ci-deploy-by-digest.sh', 'notify-telegram.sh']
                        def missing = needed.findAll { name ->
                            sh(script: "test -x '${trusted}/${name}' && echo yes || echo no", returnStdout: true).trim() != 'yes'
                        }
                        if (missing) {
                            error("Gate script tepercaya hilang: ${missing.join(', ')} (di ${trusted}). Jalankan runner/setup-agent.sh di runner; repo target tidak boleh menyediakan script gate.")
                        }
                    }
                    script {
                        def commit = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                        if (!(commit ==~ /^[0-9a-f]{40}$/)) {
                            error("GIT_COMMIT wajib berupa full 40-hex SHA (dilarang SHORT_SHA atau latest): '${commit}'")
                        }
                        env.FULL_GIT_COMMIT = commit
                        env.SHORT_SHA = commit.take(7)
                        env.IMAGE_TAG = "build-${BUILD_NUMBER}-commit-${commit}"
                        env.AUDIT_AUTHOR = sh(script: "git log -1 --pretty='%an <%ae>'", returnStdout: true).trim()
                        env.AUDIT_MESSAGE = sh(script: 'git log -1 --pretty=%s', returnStdout: true).trim()
                        env.AUDIT_CAUSES = currentBuild.getBuildCauses().collect { it.shortDescription }.join(', ')
                        env.IMMUTABLE_IMAGE_TAG = "${NEXUS_DOCKER_REGISTRY}/${APP_NAME}:build-${BUILD_NUMBER}-commit-${commit}"
                        echo "Target Image Tag: ${env.IMMUTABLE_IMAGE_TAG}"
                    }
                }
            }

            stage('2. Autore Static Guard & Gitleaks') {
                steps {
                    script { env.FAILED_STAGE = '2. Autore Static Guard & Gitleaks' }
                    sh '/usr/local/bin/autore scan --path .'
                }
            }

            stage('3. Trivy Source & Config Scan') {
                steps {
                    script { env.FAILED_STAGE = '3. Trivy Source & Config Scan' }
                    sh '/usr/local/bin/autore scan --severity HIGH,CRITICAL --path .'
                }
            }

            stage('4. Clippy & SonarQube SAST Gate') {
                steps {
                    script {
                        // Gerbang Rust hanya untuk project Rust. Project non-Rust dilewati
                        // terang-terangan (bukan laporan dummy) supaya pipeline tidak gagal palsu.
                        if (fileExists('cli/Cargo.toml')) {
                            env.FAILED_STAGE = '4. Clippy & SonarQube SAST Gate'
                            withCredentials([string(credentialsId: sonarCreds, variable: 'SONAR_TOKEN')]) {
                                sh '/usr/local/lib/autore-ci/ci-sonarqube-gate.sh'
                            }
                        } else {
                            echo "Dilewati: cli/Cargo.toml tidak ada — project non-Rust, gerbang clippy/SonarQube Rust tidak berlaku."
                        }
                    }
                }
            }

            stage('5. Build Image & Static musl Binary') {
                steps {
                    script { env.FAILED_STAGE = '5. Build Image & Static musl Binary' }
                    sh """
                        target_dir="\${DOCKERFILE_DIR}"
                        if [ ! -f "\${target_dir}/Dockerfile" ] && [ -f "sandbox/dummy-app/Dockerfile" ]; then
                          target_dir="sandbox/dummy-app"
                        fi
                        docker build -t "${env.IMMUTABLE_IMAGE_TAG}" "\${target_dir}"

                        if [ -f "cli/Cargo.toml" ]; then
                          /usr/local/lib/autore-ci/build-musl-release.sh
                        else
                          mkdir -p dist
                        fi
                    """
                }
            }

            stage('6. Trivy Final Image Scan & SBOM') {
                steps {
                    script { env.FAILED_STAGE = '6. Trivy Final Image Scan & SBOM' }
                    sh """
                        mkdir -p dist
                        /usr/local/bin/autore scan-image \
                          --image "${env.IMMUTABLE_IMAGE_TAG}" \
                          --severity HIGH,CRITICAL \
                          --sbom-output dist/sbom.cdx.json
                        if [ ! -f "dist/SHA256SUMS" ]; then
                          (cd dist && sha256sum sbom.cdx.json > SHA256SUMS)
                        fi
                    """
                }
            }

            stage('7. Verify Checksums') {
                steps {
                    script { env.FAILED_STAGE = '7. Verify Checksums' }
                    sh 'cd dist && sha256sum -c SHA256SUMS'
                }
            }

            stage('8. Push to Nexus & Verify Remote Digest') {
                steps {
                    script { env.FAILED_STAGE = '8. Push to Nexus & Verify Remote Digest' }
                    withCredentials([usernamePassword(credentialsId: nexusCreds, usernameVariable: 'NEXUS_USER', passwordVariable: 'NEXUS_PASS')]) {
                        sh """
                            export APP_NAME="${APP_NAME}"
                            export BUILD_NUMBER="${BUILD_NUMBER}"
                            export GIT_COMMIT="${env.FULL_GIT_COMMIT}"
                            export NEXUS_DOCKER_REGISTRY="${NEXUS_DOCKER_REGISTRY}"
                            
                            /usr/local/lib/autore-ci/ci-nexus-publish.sh
                        """
                    }
                }
            }

            stage('9. Deploy by Verified Digest') {
                steps {
                    script { env.FAILED_STAGE = '9. Deploy by Verified Digest' }
                    sh '''
                        verified_digest="$(cat .verified-image-digest)"
                        deploy_cmd="/usr/local/lib/autore-ci/ci-deploy-by-digest.sh"
                        export CONTAINER_PORT="${APP_PORT}"
                        export DEPLOY_PORT="${DEPLOY_PORT}"
                        export ACTIVE_CONTAINER_NAME="${APP_NAME}"
                        export CANDIDATE_CONTAINER_NAME="${APP_NAME}-candidate"
                        "${deploy_cmd}" "${verified_digest}"
                    '''
                }
            }
        }

        post {
            always {
                withCredentials([string(credentialsId: telegramCreds, variable: 'TELEGRAM_BOT_TOKEN')]) {
                    sh """
                        export TELEGRAM_CHAT_ID="${telegramChatId}"
                        export APP_NAME="${APP_NAME}"
                        export BUILD_STATUS="${currentBuild.currentResult}"
                        /usr/local/lib/autore-ci/notify-telegram.sh || true
                    """
                }
            }
        }
    }
}
