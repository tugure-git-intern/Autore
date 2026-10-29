// vars/autorePipeline.groovy
// Admin-controlled trusted Jenkins Shared Library for Autore DevSecOps CI/CD.

def call(Map config = [:]) {
    def appName = config.appName ?: 'autore-dummy'
    def deployPort = config.deployPort ?: 8081
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
            DEPLOY_PORT = "${deployPort}"
            NEXUS_DOCKER_REGISTRY = "${nexusRegistry}"
        }

        stages {
            stage('1. Checkout & Audit Metadata') {
                steps {
                    script {
                        def commit = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                        if (!(commit ==~ /^[0-9a-f]{40}$/)) {
                            error("GIT_COMMIT wajib berupa full 40-hex SHA (dilarang SHORT_SHA atau latest): '${commit}'")
                        }
                        env.FULL_GIT_COMMIT = commit
                        env.IMMUTABLE_IMAGE_TAG = "${NEXUS_DOCKER_REGISTRY}/${APP_NAME}:build-${BUILD_NUMBER}-commit-${commit}"
                        echo "Target Image Tag: ${env.IMMUTABLE_IMAGE_TAG}"
                    }
                }
            }

            stage('2. Autore Static Guard & Gitleaks') {
                steps {
                    sh '/usr/local/bin/autore scan --path .'
                }
            }

            stage('3. Trivy Source & Config Scan') {
                steps {
                    sh '/usr/local/bin/autore scan --severity HIGH,CRITICAL --path .'
                }
            }

            stage('4. Clippy & SonarQube SAST Gate') {
                steps {
                    withCredentials([string(credentialsId: sonarCreds, variable: 'SONAR_TOKEN')]) {
                        sh '''
                            gate_cmd="/usr/local/lib/autore-ci/ci-sonarqube-gate.sh"
                            if [ ! -x "${gate_cmd}" ]; then
                              gate_cmd="./scripts/ci-sonarqube-gate.sh"
                            fi
                            "${gate_cmd}"
                        '''
                    }
                }
            }

            stage('5. Build Image & Static musl Binary') {
                steps {
                    sh """
                        docker build -t "${env.IMMUTABLE_IMAGE_TAG}" sandbox/dummy-app
                        
                        build_musl="/usr/local/lib/autore-ci/build-musl-release.sh"
                        if [ ! -x "\${build_musl}" ]; then
                          build_musl="./scripts/build-musl-release.sh"
                        fi
                        "\${build_musl}"
                    """
                }
            }

            stage('6. Trivy Final Image Scan & SBOM') {
                steps {
                    sh """
                        /usr/local/bin/autore scan-image \
                          --image "${env.IMMUTABLE_IMAGE_TAG}" \
                          --severity HIGH,CRITICAL \
                          --sbom-output dist/sbom.cdx.json
                    """
                }
            }

            stage('7. Verify Checksums') {
                steps {
                    sh 'cd dist && sha256sum -c SHA256SUMS'
                }
            }

            stage('8. Push to Nexus & Verify Remote Digest') {
                steps {
                    withCredentials([usernamePassword(credentialsId: nexusCreds, usernameVariable: 'NEXUS_USER', passwordVariable: 'NEXUS_PASS')]) {
                        sh """
                            export APP_NAME="${APP_NAME}"
                            export BUILD_NUMBER="${BUILD_NUMBER}"
                            export GIT_COMMIT="${env.FULL_GIT_COMMIT}"
                            export NEXUS_DOCKER_REGISTRY="${NEXUS_DOCKER_REGISTRY}"
                            
                            pub_cmd="/usr/local/lib/autore-ci/ci-nexus-publish.sh"
                            if [ ! -x "\${pub_cmd}" ]; then
                              pub_cmd="./scripts/ci-nexus-publish.sh"
                            fi
                            "\${pub_cmd}"
                        """
                    }
                }
            }

            stage('9. Deploy by Verified Digest') {
                steps {
                    sh '''
                        verified_digest="$(cat .verified-image-digest)"
                        deploy_cmd="/usr/local/lib/autore-ci/ci-deploy-by-digest.sh"
                        if [ ! -x "${deploy_cmd}" ]; then
                          deploy_cmd="./scripts/ci-deploy-by-digest.sh"
                        fi
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
                        notify_cmd="./scripts/notify-telegram.sh"
                        if [ -x "\${notify_cmd}" ]; then
                          "\${notify_cmd}" || true
                        fi
                    """
                }
            }
        }
    }
}
