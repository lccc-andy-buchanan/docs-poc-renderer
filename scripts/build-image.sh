#!/bin/sh
set -eu
mode=${1:-check}
revision=${RENDERER_REVISION:-$(git rev-parse HEAD)}
source_url=${RENDERER_SOURCE_URL:-$(git remote get-url origin)}
platforms=${RENDERER_PLATFORMS:-linux/amd64,linux/arm64}
metadata=${RENDERER_BUILD_METADATA:-renderer-image-metadata.json}
case "$mode" in
  check)
    docker buildx build --platform "$platforms" --output type=cacheonly \
      --label "org.opencontainers.image.revision=$revision" \
      --label "org.opencontainers.image.source=$source_url" .
    ;;
  publish)
    image=${2:?Usage: build-image.sh publish IMAGE RELEASE_TAG}
    version=${3:?Usage: build-image.sh publish IMAGE RELEASE_TAG}
    printf '%s' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || {
      echo 'Publication requires a version release tag, such as v0.1.0' >&2; exit 2;
    }
    docker buildx build --platform "$platforms" \
      --label "org.opencontainers.image.revision=$revision" \
      --label "org.opencontainers.image.source=$source_url" \
      --tag "$image:$version" --tag "$image:$revision" \
      --metadata-file "$metadata" --push .
    docker buildx imagetools inspect "$image:$version"
    ;;
  *) echo 'Usage: build-image.sh check | publish IMAGE RELEASE_TAG' >&2; exit 2 ;;
esac
