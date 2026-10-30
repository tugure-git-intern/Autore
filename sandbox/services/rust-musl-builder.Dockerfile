# sandbox/services/rust-musl-builder.Dockerfile
# Builder untuk binary statis x86_64-unknown-linux-musl (Rust CLI autore).
# rust:alpine dipilih karena alpine memakai musl libc secara native;
# build-base menyediakan gcc/musl-gcc untuk meng-link dependency C (clap dkk).
# Target musl di-pre-bake supaya build di CI berjalan tanpa rustup di host.
FROM rust:1.85-alpine@sha256:4333721398de61f53ccbe53b0b855bcc4bb49e55828e8f652d7a8ac33dd0c118

RUN apk add --no-cache build-base \
 && rustup target add x86_64-unknown-linux-musl
USER 1000:1000
