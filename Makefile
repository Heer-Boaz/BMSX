SNESMINI_ROOT ?= $(CURDIR)/.snesmini
SNESMINI_TOOLCHAIN ?= $(CURDIR)/cmake/toolchains/snesmini-armhf.cmake
SNESMINI_SYSROOT ?= $(SNESMINI_ROOT)/sysroot
SNESMINI_BUILD_DIR ?= $(CURDIR)/build-snesmini
SNESMINI_BUILD_TYPE ?= Debug
SNESMINI_TOOLCHAIN_PREFIX ?= arm-linux-gnueabihf
SNESMINI_CMAKE_ARGS ?= -DBMSX_BUILD_LIBRETRO=ON -DBMSX_ENABLE_GLES2=ON
SNESMINI_LIBRETRO_ENTRY ?= $(CURDIR)/src/bmsx_cpp/platform/libretro/libretro_entry.cpp
SNESMINI_DIST_DIR ?= $(CURDIR)/dist

.PHONY: libretro-snesmini-debug libretro-snesmini-debug-inner snesmini-sysroot
libretro-snesmini-debug:
	SNESMINI_BUILD_TYPE="$(SNESMINI_BUILD_TYPE)" \
		"$(CURDIR)/scripts/setup-snesmini-local-core.sh" "$(SNESMINI_SYSROOT)"

.PHONY: libretro-host-snesmini-debug libretro-host-snesmini-debug-inner
libretro-host-snesmini-debug:
	SNESMINI_BUILD_TYPE="$(SNESMINI_BUILD_TYPE)" \
		BMSX_SNESMINI_MAKE_TARGET="libretro-host-snesmini-debug-inner" \
		"$(CURDIR)/scripts/setup-snesmini-local-core.sh" "$(SNESMINI_SYSROOT)"

snesmini-sysroot:
	@if [ -f "$(SNESMINI_SYSROOT)/.snesmini-ready" ]; then \
		echo "SNES Mini sysroot ready: $(SNESMINI_SYSROOT)"; \
	else \
		"$(CURDIR)/scripts/setup-snesmini-local-core.sh" --sysroot-only "$(SNESMINI_SYSROOT)"; \
	fi

libretro-snesmini-debug-inner: snesmini-sysroot
	BMSX_SYSROOT="$(SNESMINI_SYSROOT)" BMSX_TOOLCHAIN_PREFIX="$(SNESMINI_TOOLCHAIN_PREFIX)" \
		cmake -S src/bmsx_cpp -B "$(SNESMINI_BUILD_DIR)" \
			-DCMAKE_BUILD_TYPE="$(SNESMINI_BUILD_TYPE)" \
			-DCMAKE_TOOLCHAIN_FILE="$(SNESMINI_TOOLCHAIN)" \
			$(SNESMINI_CMAKE_ARGS)
	cmake --build "$(SNESMINI_BUILD_DIR)" --config "$(SNESMINI_BUILD_TYPE)"
	@mkdir -p "$(SNESMINI_DIST_DIR)"
	cp "$(SNESMINI_BUILD_DIR)/bmsx_libretro.so" "$(SNESMINI_DIST_DIR)/bmsx_libretro.so"
	@core_name=$$(sed -nE 's/.*CORE_NAME = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	core_version=$$(sed -nE 's/.*CORE_VERSION = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	extensions=$$(sed -nE 's/.*VALID_EXTENSIONS = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	printf 'display_name = "%s"\n' "$$core_name" > "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"; \
	printf 'display_version = "%s"\n' "$$core_version" >> "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"; \
	printf 'corename = "%s"\n' "$$core_name" >> "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"; \
	printf 'supported_extensions = "%s"\n' "$$extensions" >> "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"; \
	printf 'supports_no_game = "true"\n' >> "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"

libretro-host-snesmini-debug-inner: snesmini-sysroot
	BMSX_SYSROOT="$(SNESMINI_SYSROOT)" BMSX_TOOLCHAIN_PREFIX="$(SNESMINI_TOOLCHAIN_PREFIX)" \
		cmake -S src/bmsx_cpp -B "$(SNESMINI_BUILD_DIR)" \
			-DCMAKE_BUILD_TYPE="$(SNESMINI_BUILD_TYPE)" \
			-DCMAKE_TOOLCHAIN_FILE="$(SNESMINI_TOOLCHAIN)" \
			$(SNESMINI_CMAKE_ARGS) \
			-DBMSX_BUILD_LIBRETRO_HOST=ON
	cmake --build "$(SNESMINI_BUILD_DIR)" --config "$(SNESMINI_BUILD_TYPE)"
	@mkdir -p "$(SNESMINI_DIST_DIR)"
	cp "$(SNESMINI_BUILD_DIR)/bmsx_libretro.so" "$(SNESMINI_DIST_DIR)/bmsx_libretro.so"
	@core_name=$$(sed -nE 's/.*CORE_NAME = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	core_version=$$(sed -nE 's/.*CORE_VERSION = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	extensions=$$(sed -nE 's/.*VALID_EXTENSIONS = "([^"]*)".*/\1/p' "$(SNESMINI_LIBRETRO_ENTRY)"); \
	printf 'display_name = "%s"\n' "$$core_name" > "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"; \
	printf 'display_version = "%s"\n' "$$core_version" >> "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"; \
	printf 'corename = "%s"\n' "$$core_name" >> "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"; \
	printf 'supported_extensions = "%s"\n' "$$extensions" >> "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"; \
	printf 'supports_no_game = "true"\n' >> "$(SNESMINI_DIST_DIR)/bmsx_libretro.info"
	cp "$(SNESMINI_BUILD_DIR)/bmsx_libretro_host" "$(SNESMINI_DIST_DIR)/bmsx_libretro_host"
