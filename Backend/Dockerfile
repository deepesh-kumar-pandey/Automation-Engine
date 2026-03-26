# Stage 1: Build the C++ application
FROM alpine:3.19 AS builder

# Install build dependencies
RUN apk add --no-cache \
    build-base \
    cmake \
    git \
    curl \
    zip \
    unzip \
    tar \
    perl \
    linux-headers \
    openssl-dev \
    ninja \
    pkgconfig \
    bash

# vcpkg requires some extra environment variables for Alpine (musl compatibility)
ENV VCPKG_FORCE_SYSTEM_BINARIES=1

# Install vcpkg
WORKDIR /opt
RUN git clone https://github.com/microsoft/vcpkg.git && \
    ./vcpkg/bootstrap-vcpkg.sh

WORKDIR /app

# Copy the source code and vcpkg configuration
COPY . .

# Build the project using vcpkg toolchain
RUN cmake -B build -S . \
    -DCMAKE_TOOLCHAIN_FILE=/opt/vcpkg/scripts/buildsystems/vcpkg.cmake \
    -DVCPKG_TARGET_TRIPLET=x64-linux-musl \
    -GNinja && \
    cmake --build build

# Stage 2: Runtime
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache libstdc++ libgcc openssl

WORKDIR /app

# Copy the built binaries from the builder stage
COPY --from=builder /app/build/automation_backend .
COPY --from=builder /app/build/log_viewer .

# Expose port 8080 (standard listener port)
EXPOSE 8080

# Start the automation engine
CMD ["./automation_backend"]
