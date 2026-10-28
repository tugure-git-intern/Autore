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
RUN useradd --system --no-create-home appuser
USER appuser
EXPOSE 8000
CMD ["python", "app.py"]
