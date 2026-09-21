FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PERMITIR_GERAR_PAYLOAD=0

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py questoes_bank.py questoes.json ./
COPY templates ./templates
COPY static ./static
COPY scripts ./scripts

RUN python scripts/gerar_payload.py

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--worker-class", "gthread", "--timeout", "30", "--graceful-timeout", "10", "--max-requests", "2000", "--max-requests-jitter", "200", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
