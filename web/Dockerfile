FROM rust:1-slim-bookworm AS build

WORKDIR /src

# Build dependencies first so they're cached between source changes
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs \
 && cargo build --release --locked \
 && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release --locked

FROM debian:bookworm-slim

RUN useradd --system --uid 1000 --home /data mx

COPY --from=build /src/target/release/mxweb /usr/local/bin/mxweb

USER mx
WORKDIR /data
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/mxweb"]
