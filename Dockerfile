FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bash \
    fuse3 \
    tar \
    && rm -rf /var/lib/apt/lists/*

# The dashboard will start with GitHub-bundled data/cache only.
# Raw OES R2 mounting will be added after R2 is enabled and tested.

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend /app/backend
COPY frontend /app/frontend
COPY data /app/data
COPY data_paths.json /app/data_paths.json
COPY container-entrypoint.sh /app/container-entrypoint.sh

RUN chmod +x /app/container-entrypoint.sh \
    && mkdir -p /mnt/r2 /app/data/measurement

EXPOSE 8080

CMD ["/app/container-entrypoint.sh"]
