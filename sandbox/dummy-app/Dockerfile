# Stage 1 — run the unit tests. If any test fails, the build stops here.
FROM python:3.12-slim AS test
WORKDIR /app
COPY app.py test_app.py ./
RUN python -m unittest -v

# Stage 2 — runtime image.
# app.py is copied FROM the test stage on purpose: BuildKit skips stages that
# nothing depends on, so this COPY is what forces the tests above to run.
FROM python:3.12-slim
WORKDIR /app
COPY --from=test /app/app.py /app/app.py
# Tambal paket OS dari repo security. Base `python:3.12-slim` membawa apt 3.0.3
# dengan CVE-2026-109518 (perbaikan 3.0.4 ada di trixie-security), dan gerbang
# Trivy tahap 6 memblokir image karena celah itu punya versi perbaikan — inilah
# sebab build autore-e2e #141 merah. Hanya stage ini yang dipindai, jadi menambal
# di stage `test` tidak menolong. Tanpa pin versi supaya perbaikan berikutnya ikut
# terbawa tanpa menyunting berkas ini lagi.
RUN apt-get update \
    && apt-get -y upgrade \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --no-create-home appuser
USER appuser
EXPOSE 8000
CMD ["python", "app.py"]
