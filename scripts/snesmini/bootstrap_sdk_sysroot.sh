#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SDK_SYSROOT="$ROOT_DIR/.snesmini/sdk-sysroot"
SDK_SYSROOT_NEW="$ROOT_DIR/.snesmini/sdk-sysroot.new"
SDK_MARKER="$SDK_SYSROOT/.bmsx-snesmini-sdk"
mkdir -p "$ROOT_DIR/.snesmini"
exec 9<"$ROOT_DIR/.snesmini"
flock 9

SDK_ID="$(python3 "$ROOT_DIR/scripts/snesmini/sdk_recipe_id.py" "$ROOT_DIR")"
BUILDER_IMAGE_ID="$BMSX_SNESMINI_BUILDER_IMAGE_ID"
PACKAGE_LOCK="$ROOT_DIR/scripts/snesmini/jessie-packages.sha256"
PACKAGES="libc6-dev,zlib1g-dev,libegl1-mesa-dev,libgles2-mesa-dev"
CXX_SOURCE="/usr/src/gcc-10/gcc-10.2.0-dfsg.tar.xz"
CXX_PREFIX="/opt/bmsx-snesmini-cxx"

if [ -f "$SDK_MARKER" ] && grep -qxF "$SDK_ID $BUILDER_IMAGE_ID" "$SDK_MARKER"; then
	echo "SNES Mini SDK sysroot ready: $SDK_SYSROOT"
	exit 0
fi

STAGING_ROOT="$(mktemp -d)"
trap 'rm -rf "$STAGING_ROOT" "$SDK_SYSROOT_NEW"' EXIT

debootstrap \
	--arch=armhf \
	--variant=minbase \
	--foreign \
	--keyring=/usr/share/keyrings/debian-archive-removed-keys.gpg \
	--include="$PACKAGES" \
	jessie \
	"$STAGING_ROOT" \
	https://archive.debian.org/debian/

PACKAGE_CACHE="$STAGING_ROOT/var/cache/apt/archives"
awk '{ print $2 }' "$PACKAGE_LOCK" | LC_ALL=C sort > "$STAGING_ROOT/tmp/expected-packages"
find "$PACKAGE_CACHE" -maxdepth 1 -type f -name '*.deb' -printf '%f\n' \
	| LC_ALL=C sort > "$STAGING_ROOT/tmp/downloaded-packages"
cmp "$STAGING_ROOT/tmp/expected-packages" "$STAGING_ROOT/tmp/downloaded-packages"
(
	cd "$PACKAGE_CACHE"
	sha256sum --check "$PACKAGE_LOCK"
)

for package in "$PACKAGE_CACHE"/*.deb; do
	dpkg-deb --extract "$package" "$STAGING_ROOT"
done
rm "$PACKAGE_CACHE"/*.deb

tar -C "$STAGING_ROOT/tmp" -xf "$CXX_SOURCE"
CXX_SOURCE_ROOT="$STAGING_ROOT/tmp/gcc-10.2.0"
CXX_BUILD_ROOT="$STAGING_ROOT/tmp/libstdc++-build"
CXX_CPPFLAGS="-nostdinc -isystem /usr/lib/gcc-cross/arm-linux-gnueabihf/10/include -isystem $STAGING_ROOT/usr/include/arm-linux-gnueabihf -isystem $STAGING_ROOT/usr/include"
ln -s gthr-posix.h "$CXX_SOURCE_ROOT/libgcc/gthr-default.h"
mkdir "$CXX_BUILD_ROOT"
(
	cd "$CXX_BUILD_ROOT"
	CC="arm-linux-gnueabihf-gcc --sysroot=$STAGING_ROOT" \
	CXX="arm-linux-gnueabihf-g++ --sysroot=$STAGING_ROOT" \
	CFLAGS="-O3 -fPIC" \
	CXXFLAGS="-O3 -fPIC" \
	CPPFLAGS="$CXX_CPPFLAGS" \
		"$CXX_SOURCE_ROOT/libstdc++-v3/configure" \
			--build=x86_64-linux-gnu \
			--host=arm-linux-gnueabihf \
			--target=arm-linux-gnueabihf \
			--prefix="$CXX_PREFIX" \
			--with-gxx-include-dir="$CXX_PREFIX/include/c++/10.2.0" \
			--disable-multilib \
			--disable-nls \
			--disable-shared \
			--enable-static \
			--enable-threads=posix \
			--with-pic \
			> "$STAGING_ROOT/tmp/libstdc++-configure.log" 2>&1 \
		|| { cat "$STAGING_ROOT/tmp/libstdc++-configure.log"; exit 1; }
	make --jobs="$(nproc)" \
		> "$STAGING_ROOT/tmp/libstdc++-build.log" 2>&1 \
		|| { cat "$STAGING_ROOT/tmp/libstdc++-build.log"; exit 1; }
	make DESTDIR="$STAGING_ROOT" install \
		> "$STAGING_ROOT/tmp/libstdc++-install.log" 2>&1 \
		|| { cat "$STAGING_ROOT/tmp/libstdc++-install.log"; exit 1; }
)
rm -rf "$STAGING_ROOT/tmp"

python3 "$ROOT_DIR/scripts/snesmini/relocate_sysroot_symlinks.py" "$STAGING_ROOT"

rm -rf "$SDK_SYSROOT_NEW"
mkdir -p "$SDK_SYSROOT_NEW"
tar -C "$STAGING_ROOT" -cf - . | tar -C "$SDK_SYSROOT_NEW" -xf -
printf '%s %s\n' "$SDK_ID" "$BUILDER_IMAGE_ID" > "$SDK_SYSROOT_NEW/.bmsx-snesmini-sdk"
rm -rf "$SDK_SYSROOT"
mv "$SDK_SYSROOT_NEW" "$SDK_SYSROOT"

echo "SNES Mini SDK sysroot created: $SDK_SYSROOT"
