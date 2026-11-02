# sandbox/services/rust-musl-builder.Dockerfile
# Builder untuk binary statis x86_64-unknown-linux-musl (Rust CLI autore).
# rust:alpine dipilih karena alpine memakai musl libc secara native;
# build-base menyediakan gcc/musl-gcc untuk meng-link dependency C (clap dkk).
# Target musl di-pre-bake supaya build di CI berjalan tanpa rustup di host.
FROM clux/muslrust@sha256:15a72a4abf1c593b0bea63a4a8f20e95c1e5a0696d7051eca87b9b850b2d7e43

RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends gcc-mingw-w64-x86-64 \
 && rm -rf /var/lib/apt/lists/* \
 && rustup target add x86_64-unknown-linux-musl x86_64-pc-windows-gnu
