SNESMINI_ROOT := $(CURDIR)/.snesmini
SNESMINI_SDK_SYSROOT := $(SNESMINI_ROOT)/sdk-sysroot
SNESMINI_RUNTIME_ROOT := $(SNESMINI_ROOT)/rootfs
SNESMINI_BUILD_ROOT := $(SNESMINI_ROOT)/build
SNESMINI_BUILD_DIR = $(SNESMINI_BUILD_ROOT)/core
SNESMINI_BUILD_DIR_HOST = $(SNESMINI_BUILD_ROOT)/host
SNESMINI_BUILD_DIR_SMOKE = $(SNESMINI_BUILD_ROOT)/smoke
SNESMINI_BUILD_TYPE ?= Debug
SNESMINI_TOOLCHAIN_FILE := $(CURDIR)/machine/cpp/cmake/toolchains/snesmini.cmake
SNESMINI_LIBRETRO_ENTRY := $(CURDIR)/hosts/libretro/entry.cpp
SNESMINI_DIST_DIR := $(CURDIR)/dist
SNESMINI_PUBLISH_DIR ?= $(SNESMINI_DIST_DIR)
SNESMINI_SYSTEM_DIR ?= $(SNESMINI_DIST_DIR)
SNESMINI_ROM ?= $(SNESMINI_DIST_DIR)/bare_metal_cart.rom
SNESMINI_SMOKE_FRAMES ?= 16
SNESMINI_SDK_USR_LIB_DIR := $(SNESMINI_SDK_SYSROOT)/usr/lib/arm-linux-gnueabihf
SNESMINI_CMAKE_COMMON_ARGS = \
	-G Ninja \
	-DCMAKE_TOOLCHAIN_FILE="$(SNESMINI_TOOLCHAIN_FILE)" \
	-DCMAKE_BUILD_TYPE="$(SNESMINI_BUILD_TYPE)" \
	-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
	-DCMAKE_C_COMPILER_LAUNCHER=ccache \
	-DCMAKE_CXX_COMPILER_LAUNCHER=ccache

.PHONY: libretro-snesmini-debug
libretro-snesmini-debug:
	SNESMINI_BUILD_TYPE="$(SNESMINI_BUILD_TYPE)" \
	BMSX_SNESMINI_WORKFLOW="core" \
		"$(CURDIR)/scripts/snesmini/build.sh"

.PHONY: libretro-host-snesmini-debug
libretro-host-snesmini-debug:
	SNESMINI_BUILD_TYPE="$(SNESMINI_BUILD_TYPE)" \
	BMSX_SNESMINI_WORKFLOW="host" \
		"$(CURDIR)/scripts/snesmini/build.sh"

.PHONY: libretro-host-wsl-debug
libretro-host-wsl-debug:
	cmake -S machine/cpp -B build-libretro-host-wsl \
		-G Ninja \
		-DCMAKE_C_COMPILER_LAUNCHER=ccache \
		-DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
		-DCMAKE_BUILD_TYPE=Debug \
		-DBMSX_BUILD_LIBRETRO_HOST=ON \
		-DBMSX_BUILD_LIBRETRO=OFF
	cmake --build build-libretro-host-wsl --config Debug --parallel "$$(nproc)" --target bmsx_libretro_host
	@mkdir -p "$(SNESMINI_DIST_DIR)"
	cp build-libretro-host-wsl/bmsx_libretro_host "$(SNESMINI_DIST_DIR)/bmsx_libretro_host.wsl"

.PHONY: snesmini-sysroot
snesmini-sysroot:
	"$(CURDIR)/scripts/snesmini/build.sh" --sysroot-only

.PHONY: libretro-snesmini-build-inner
libretro-snesmini-build-inner:
	cmake -S machine/cpp -B "$(SNESMINI_BUILD_DIR)" \
		$(SNESMINI_CMAKE_COMMON_ARGS) \
		-DBMSX_BUILD_LIBRETRO=ON \
		-DBMSX_BUILD_LIBRETRO_HOST=OFF \
		-DBMSX_ENABLE_GLES2=ON \
		-DBMSX_ENABLE_ZLIB=OFF \
		-DGLESV2_LIBRARY="$(SNESMINI_SDK_USR_LIB_DIR)/libGLESv2.so"
	cmake --build "$(SNESMINI_BUILD_DIR)" --config "$(SNESMINI_BUILD_TYPE)" --parallel "$$(nproc)" --target bmsx_libretro

.PHONY: libretro-host-snesmini-build-inner
libretro-host-snesmini-build-inner:
	cmake -S machine/cpp -B "$(SNESMINI_BUILD_DIR_HOST)" \
		$(SNESMINI_CMAKE_COMMON_ARGS) \
		-DBMSX_BUILD_LIBRETRO=OFF \
		-DBMSX_BUILD_LIBRETRO_HOST=ON \
		-DBMSX_ENABLE_GLES2=OFF \
		-DBMSX_ENABLE_ZLIB=ON
	cmake --build "$(SNESMINI_BUILD_DIR_HOST)" --config "$(SNESMINI_BUILD_TYPE)" --parallel "$$(nproc)" --target bmsx_libretro_host

.PHONY: libretro-host-snesmini-audit-inner
libretro-host-snesmini-audit-inner:
	python3 scripts/snesmini/check_abi.py \
		--rootfs "$(SNESMINI_RUNTIME_ROOT)" \
		--artifact "$(SNESMINI_BUILD_DIR_HOST)/bmsx_libretro_host" \
		--runtime-symbols 'libGLESv2.so.2|libGLESv2.so=$(CURDIR)/hosts/libretro_host/gles2_symbols.inc' \
		--runtime-symbols 'libEGL.so.1|libEGL.so=$(CURDIR)/hosts/libretro_host/egl_symbols.inc'
	@status=0; \
		qemu-arm-static -L "$(SNESMINI_RUNTIME_ROOT)" \
			"$(SNESMINI_BUILD_DIR_HOST)/bmsx_libretro_host" || status=$$?; \
		if [ "$$status" -ne 2 ]; then \
			echo "SNES Mini direct host did not enter its CLI through the target loader." >&2; \
			exit 1; \
		fi
	@echo "[snesmini host smoke] target loader entered the direct-host CLI"
	@mkdir -p "$(SNESMINI_PUBLISH_DIR)"
	cp "$(SNESMINI_BUILD_DIR_HOST)/bmsx_libretro_host" "$(SNESMINI_PUBLISH_DIR)/bmsx_libretro_host"

.PHONY: snesmini-qemu-build-inner
snesmini-qemu-build-inner: libretro-snesmini-build-inner
	cmake -S tests/platform/snesmini -B "$(SNESMINI_BUILD_DIR_SMOKE)" \
		$(SNESMINI_CMAKE_COMMON_ARGS)
	cmake --build "$(SNESMINI_BUILD_DIR_SMOKE)" --config "$(SNESMINI_BUILD_TYPE)" --parallel "$$(nproc)" \
		--target bmsx_snesmini_libretro_smoke

.PHONY: snesmini-qemu-audit-inner
snesmini-qemu-audit-inner:
	python3 scripts/snesmini/check_abi.py \
		--rootfs "$(SNESMINI_RUNTIME_ROOT)" \
		--libretro-core "$(SNESMINI_BUILD_DIR)/libretro_bmsx.so" \
		--libretro-map "$(CURDIR)/hosts/libretro/libretro.map" \
		--artifact "$(SNESMINI_BUILD_DIR_SMOKE)/bmsx_snesmini_libretro_smoke"
	qemu-arm-static -L "$(SNESMINI_RUNTIME_ROOT)" \
		"$(SNESMINI_BUILD_DIR_SMOKE)/bmsx_snesmini_libretro_smoke" \
		"$(SNESMINI_BUILD_DIR)/libretro_bmsx.so" \
		"$(SNESMINI_SYSTEM_DIR)" \
		"$(SNESMINI_ROM)" \
		"$(SNESMINI_SMOKE_FRAMES)"
	@mkdir -p "$(SNESMINI_PUBLISH_DIR)"
	cp "$(SNESMINI_BUILD_DIR)/libretro_bmsx.so" "$(SNESMINI_PUBLISH_DIR)/libretro_bmsx.so"
	@core_name=$$(sed -nE 's/.*CORE_NAME = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	core_version=$$(sed -nE 's/.*CORE_VERSION = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	extensions=$$(sed -nE 's/.*VALID_EXTENSIONS = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	printf 'display_name = "%s"\n' "$$core_name" > "$(SNESMINI_PUBLISH_DIR)/libretro_bmsx.info"; \
	printf 'display_version = "%s"\n' "$$core_version" >> "$(SNESMINI_PUBLISH_DIR)/libretro_bmsx.info"; \
	printf 'corename = "%s"\n' "$$core_name" >> "$(SNESMINI_PUBLISH_DIR)/libretro_bmsx.info"; \
	printf 'supported_extensions = "%s"\n' "$$extensions" >> "$(SNESMINI_PUBLISH_DIR)/libretro_bmsx.info"; \
	printf 'supports_no_game = "true"\n' >> "$(SNESMINI_PUBLISH_DIR)/libretro_bmsx.info"
