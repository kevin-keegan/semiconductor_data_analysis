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

RUN set -eux; \
    ARCH="$(uname -m)"; \
    if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; fi; \
    if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi; \
    VERSION="$(curl -fsSL https://api.github.com/repos/tigrisdata/tigrisfs/releases/latest | grep -o '\"tag_name\": \"[^\"]*' | head -1 | cut -d'\"' -f4)"; \
    curl -fsSL "https://github.com/tigrisdata/tigrisfs/releases/download/${VERSION}/tigrisfs_${VERSION#v}_linux_${ARCH}.tar.gz" -o /tmp/tigrisfs.tar.gz; \
    tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin/; \
    chmod +x /usr/local/bin/tigrisfs; \
    rm /tmp/tigrisfs.tar.gz

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
