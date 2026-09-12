# syntax=docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d
# The shipped JavaScript/assets are architecture-independent. Run compilers on
# the builder CPU, so multi-platform local builds never emulate esbuild/Go.
FROM --platform=$BUILDPLATFORM node:26.8.2-trixie-slim@sha256:f7bb8247fdb16250dbec7fd0e24f091c6f5f0a29d256f3aef5816a7a369166b2 AS build
WORKDIR /build
ENV PUPPETEER_SKIP_DOWNLOAD=1
# Include build-time tools and dependencies in the BuildKit SBOM as well.
ARG BUILDKIT_SBOM_SCAN_STAGE=true
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN --network=none node scripts/build-container.mjs \
    && npm sbom --omit=dev --sbom-format=spdx > out/production-dependencies.spdx.json \
    && mkdir /runtime-cache

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:f7e3539249fa844f7019255d3ed1acb5faf626006607a602f8a24d59f0a97c6c AS runtime
ARG OCI_SOURCE=https://github.com/northcutted/gods-eye-view
ARG OCI_REVISION=unknown
ARG OCI_VERSION=dev
ARG OCI_CREATED=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="God's Eye View" \
      org.opencontainers.image.description="Real-time Earth intelligence console with a standalone Node.js server" \
      org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.url="${OCI_SOURCE}" \
      org.opencontainers.image.documentation="${OCI_SOURCE}/blob/${OCI_REVISION}/docs/CONTAINERS.md" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.created="${OCI_CREATED}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.base.name="gcr.io/distroless/nodejs26-debian13:nonroot" \
      org.opencontainers.image.base.digest="sha256:f7e3539249fa844f7019255d3ed1acb5faf626006607a602f8a24d59f0a97c6c"
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    GEV_CACHE_DIR=/app/.gev-cache
# Root owns the application; the service account cannot modify its own code.
COPY --from=build --chown=0:0 /build/out/ /app/
COPY --from=build --chown=65532:65532 /runtime-cache/ /app/.gev-cache/
USER 65532:65532
EXPOSE 8080
STOPSIGNAL SIGTERM
# Health checks belong to the deployment: OCI has no standard Healthcheck field.
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["/app/server/standalone/index.mjs"]
