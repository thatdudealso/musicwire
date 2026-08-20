FROM node:22-bookworm-slim AS runtime

ARG TARGETARCH
ARG MSCORE_RELEASE="4.7.2.260525085"
ENV MS_BASIC_LICENSE="/opt/musescore/share/mscore4portable-4.7/sound/MS Basic_License.md"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg fontconfig libasound2 libegl1 libgl1 libnss3 libxkbcommon0 libxkbcommon-x11-0 libxrender1 procps xauth xvfb \
  && rm -rf /var/lib/apt/lists/* \
  && case "$TARGETARCH" in amd64) mscore_arch=x86_64 ;; arm64) mscore_arch=aarch64 ;; *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; esac \
  && curl --fail --location --retry 3 "https://github.com/musescore/MuseScore/releases/download/v4.7.2/MuseScore-Studio-${MSCORE_RELEASE}-${mscore_arch}.AppImage" --output /tmp/mscore.AppImage \
  && chmod +x /tmp/mscore.AppImage \
  && /tmp/mscore.AppImage --appimage-extract \
  && mv squashfs-root /opt/musescore \
  && test -f "$MS_BASIC_LICENSE" \
  && rm /tmp/mscore.AppImage

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY src ./src
COPY static ./static

ENV NODE_ENV=production \
  MSCORE_BIN=/opt/musescore/AppRun \
  MSCORE_ARCH= \
  FFMPEG_BIN=ffmpeg \
  FFPROBE_BIN=ffprobe \
  MUSICWIRE_DATA_DIR=/var/lib/musicwire/data

RUN mkdir -p /var/lib/musicwire/data && chown -R node:node /app /var/lib/musicwire
USER node
EXPOSE 8787
ENTRYPOINT ["/bin/sh", "-c", "Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp & exec env DISPLAY=:99 node src/server.js"]
