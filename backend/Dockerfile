FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY climasure ./climasure
COPY scripts ./scripts
RUN pip install --no-cache-dir .

RUN useradd --create-home climasure && mkdir -p /data && chown climasure /data
USER climasure
ENV CLIMASURE_DB_PATH=/data/climasure.db

EXPOSE 8000
CMD ["uvicorn", "climasure.api:app", "--host", "0.0.0.0", "--port", "8000"]
