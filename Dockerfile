# syntax=docker/dockerfile:1
FROM oven/bun:1-alpine AS frontend-builder

WORKDIR /app/admin-ui
COPY admin-ui/package.json admin-ui/bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY admin-ui ./
RUN bun run build

FROM rust:1.92-alpine AS builder

RUN apk add --no-cache musl-dev perl make

WORKDIR /app

# Step 1: 依赖预编译（仅 Cargo.toml/Cargo.lock 变化时失效）
COPY Cargo.toml Cargo.lock* ./
RUN mkdir -p src admin-ui/dist \
    && echo 'fn main() {}' > src/main.rs \
    && touch admin-ui/dist/.keep

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --profile docker --no-default-features \
    && rm -rf src admin-ui/dist

# Step 2: 编译应用代码
COPY src ./src
COPY --from=frontend-builder /app/admin-ui/dist /app/admin-ui/dist

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --profile docker --no-default-features \
    && cp /app/target/docker/kiro-rs /app/kiro-rs

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /app/kiro-rs /app/kiro-rs

VOLUME ["/app/config"]

EXPOSE 8990

CMD ["./kiro-rs", "-c", "/app/config/config.json", "--credentials", "/app/config/credentials.json"]
