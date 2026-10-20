#!/usr/bin/env bash

set -euo pipefail

: "${RELEASE_TAG:?RELEASE_TAG is required, for example digi-dev-0.0.14-dev.10}"

repository="${GITHUB_REPOSITORY:-Mixlong/studio}"
release_root="${RELEASE_ROOT:-release-oss/DigiwiseStudio}"
version="${RELEASE_TAG#digi-dev-}"

if [[ "$version" == "$RELEASE_TAG" || ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-dev\.[0-9]+$ ]]; then
    echo "Unsupported DigiStudio development release tag: $RELEASE_TAG" >&2
    exit 1
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/digistudio-release.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_auth=(--header "Authorization: Bearer $GITHUB_TOKEN")
else
    curl_auth=()
fi

download_asset() {
    local asset_name="$1"
    local destination="$2"
    local asset_url="https://github.com/${repository}/releases/download/${RELEASE_TAG}/${asset_name}"
    local attempt

    for attempt in $(seq 1 20); do
        if curl --fail --location --silent --show-error \
            "${curl_auth[@]}" \
            --output "$destination" "$asset_url"; then
            return 0
        fi
        rm -f "$destination"
        echo "Waiting for GitHub release asset ${asset_name} (attempt ${attempt}/20)" >&2
        sleep 15
    done

    echo "Unable to download GitHub release asset: $asset_url" >&2
    exit 1
}

rm -rf "$release_root"
mkdir -p "$release_root"

mac_archive="$temporary_dir/DigiStudio-${version}-mac.tar.gz"
windows_archive="$temporary_dir/DigiStudio-${version}-win-x64.tar.gz"

download_asset "DigiStudio-${version}-mac.tar.gz" "$mac_archive"
download_asset "DigiStudio-${version}-win-x64.tar.gz" "$windows_archive"

tar -xzf "$mac_archive" -C "$release_root"
tar -xzf "$windows_archive" -C "$release_root"

test -f "$release_root/dist-mac/latest-mac.yml"
test -f "$release_root/dist-win-x64/latest.yml"
find "$release_root" -type f -maxdepth 3 -print
