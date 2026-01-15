cmake_minimum_required(VERSION 3.16)
project(bmsx VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# =============================================================================
# Options
# =============================================================================

option(BMSX_BUILD_LIBRETRO "Build libretro core" ON)
option(BMSX_BUILD_LIBRETRO_HOST "Build libretro host executable" OFF)
option(BMSX_BUILD_SDL "Build SDL standalone executable" OFF)
option(BMSX_BUILD_TESTS "Build unit tests" OFF)
option(BMSX_ENABLE_LTO "Enable Link Time Optimization" OFF)
option(BMSX_ENABLE_ZLIB "Enable zlib-based ROM decompression" ON)
option(BMSX_ENABLE_PERFORMANCE_LOGS "Enable per-frame performance logging" OFF)
set(BMSX_ENABLE_GLES2_DEFAULT ON)
# Previously GLES2 was disabled by default on Windows; enable by default on all platforms
message(STATUS "BMSX: Default BMSX_ENABLE_GLES2=${BMSX_ENABLE_GLES2_DEFAULT}")
option(BMSX_ENABLE_GLES2 "Enable OpenGLES2 backend" ${BMSX_ENABLE_GLES2_DEFAULT})

# =============================================================================
# Find zlib (for ROM decompression)
# =============================================================================

if(BMSX_ENABLE_ZLIB)
	if(WIN32)
		find_package(ZLIB)
		if(NOT ZLIB_FOUND)
			include(FetchContent)
			set(FETCHCONTENT_BASE_DIR "${CMAKE_BINARY_DIR}/third_party")
			set(ZLIB_BUILD_SHARED OFF CACHE BOOL "" FORCE)
			set(ZLIB_BUILD_STATIC ON CACHE BOOL "" FORCE)
			FetchContent_Declare(
				zlib
				URL https://zlib.net/zlib-1.3.1.tar.gz
				URL_HASH SHA256=9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
				DOWNLOAD_EXTRACT_TIMESTAMP TRUE
			)
			FetchContent_MakeAvailable(zlib)
			if(TARGET zlibstatic AND NOT TARGET ZLIB::ZLIB)
				add_library(ZLIB::ZLIB ALIAS zlibstatic)
			elseif(TARGET zlib AND NOT TARGET ZLIB::ZLIB)
				add_library(ZLIB::ZLIB ALIAS zlib)
			endif()
			if(TARGET ZLIB::ZLIB)
				set(ZLIB_FOUND TRUE)
			endif()
		endif()
		if(NOT ZLIB_FOUND)
			message(FATAL_ERROR "ZLIB not found. Install zlib or provide it in the build directory.")
		endif()
	else()
		find_package(ZLIB REQUIRED)
	endif()
endif()

# =============================================================================
# Compiler flags
# =============================================================================

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
	add_compile_options(-O3 -Wall -Wextra -Wpedantic)
	if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
		add_compile_options(-Wno-psabi)
	endif()
	if(BMSX_ENABLE_LTO)
		add_compile_options(-flto)
		add_link_options(-flto)
	endif()
elseif(MSVC)
	add_compile_options(/O2 /W4)
	if(BMSX_ENABLE_LTO)
		add_compile_options(/GL)
		add_link_options(/LTCG)
	endif()
endif()

# =============================================================================
# Core engine library (static)
# =============================================================================

add_library(bmsx_core STATIC
	# Platform abstraction
	platform.cpp
	subscription.cpp

	# Vendor (header-only implementations)
	vendor/stb_impl.c

	# Core systems
	core/types.cpp
	core/engine.cpp
	core/registry.cpp
	core/assets.cpp
	core/binencoder.cpp
	core/rompack.cpp
	core/font.cpp
	core/taskgate.cpp
	utils/mem_snapshot.cpp

	# Audio systems
	audio/soundmaster.cpp

	# Input systems
	input/inputstatemanager.cpp
	input/playerinput.cpp
	input/actionparser.cpp
	input/input.cpp
	input/keyboardinput.cpp
	input/gamepadinput.cpp

	# Render systems
	render/backend.cpp
	render/gameview.cpp
	render/frame_uniforms.cpp
	render/render_queues.cpp
	render/sprites_pipeline.cpp
	render/texturemanager.cpp
	render/renderpasslib.cpp
	render/rendergraph.cpp
	render/glyphs.cpp

	# VM (Lua bytecode interpreter)
	vm/cpu.cpp
	vm/font.cpp
	vm/vm_api.cpp
	vm/vm_runtime.cpp
	vm/vm_memory.cpp
	vm/vdp.cpp
	vm/string_memory.cpp
	vm/program_loader.cpp
	vm/program_linker.cpp
)

# stb is plain C; compile it as C to avoid libstdc++'s legacy C wrappers (e.g. <math.h>)

# Required for linking static library into shared library
set_target_properties(bmsx_core PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_include_directories(bmsx_core PUBLIC
	${CMAKE_CURRENT_SOURCE_DIR}
	${CMAKE_CURRENT_SOURCE_DIR}/..
)

target_compile_definitions(bmsx_core PUBLIC
	BMSX_ENABLE_GLES2=$<BOOL:${BMSX_ENABLE_GLES2}>
	BMSX_ENABLE_ZLIB=$<BOOL:${BMSX_ENABLE_ZLIB}>
)

if(BMSX_ENABLE_GLES2)
	target_sources(bmsx_core PRIVATE
		render/gles2_backend.cpp
		render/sprites_pipeline_gles2.cpp
		render/crt_pipeline_gles2.cpp
	)
endif()

if(BMSX_ENABLE_ZLIB)
	target_link_libraries(bmsx_core PUBLIC ZLIB::ZLIB)
endif()

# =============================================================================
# Libretro core (shared library)
# =============================================================================

	if(BMSX_BUILD_LIBRETRO)
		add_library(bmsx_libretro SHARED
			platform/libretro/libretro_platform.cpp
			platform/libretro/libretro_entry.cpp
		)

	target_link_libraries(bmsx_libretro PRIVATE bmsx_core)
	if(BMSX_ENABLE_GLES2)
		find_library(GLESV2_LIBRARY GLESv2 REQUIRED)
		target_link_libraries(bmsx_libretro PRIVATE ${GLESV2_LIBRARY})
	endif()

	# Libretro naming convention
	set_target_properties(bmsx_libretro PROPERTIES
		PREFIX ""
		OUTPUT_NAME "bmsx_libretro"
	)

	# Platform-specific extensions
	if(WIN32)
		set_target_properties(bmsx_libretro PROPERTIES SUFFIX ".dll")
	elseif(APPLE)
		set_target_properties(bmsx_libretro PROPERTIES SUFFIX ".dylib")
	else()
		set_target_properties(bmsx_libretro PROPERTIES SUFFIX ".so")
	endif()

	# Libretro header
	target_include_directories(bmsx_libretro PRIVATE
		${CMAKE_CURRENT_SOURCE_DIR}/platform/libretro
	)

	if(BMSX_ENABLE_PERFORMANCE_LOGS)
		target_compile_definitions(bmsx_libretro PRIVATE ENABLE_PERFORMANCE_LOGS=1)
	endif()
endif()

# =============================================================================
# Libretro host executable (Linux)
# =============================================================================

if(BMSX_BUILD_LIBRETRO_HOST)
	if(NOT UNIX OR APPLE)
		message(FATAL_ERROR "BMSX_BUILD_LIBRETRO_HOST is supported only on Linux-like UNIX platforms.")
	endif()

	add_executable(bmsx_libretro_host
		platform/libretro_host/main.c
	)

	# SNES Mini sysroot uses glibc 2.19; the cross toolchain defaults to time64.
	if(CMAKE_CROSSCOMPILING)
		target_compile_definitions(bmsx_libretro_host PRIVATE _TIME_BITS=32)
	endif()
	target_link_libraries(bmsx_libretro_host PRIVATE dl rt pthread)
	target_include_directories(bmsx_libretro_host PRIVATE
		${CMAKE_CURRENT_SOURCE_DIR}/platform/libretro
	)

	if(NOT CMAKE_CROSSCOMPILING)
		find_package(SDL2)
		if(SDL2_FOUND)
			target_compile_definitions(bmsx_libretro_host PRIVATE BMSX_LIBRETRO_HOST_SDL=1)
			target_include_directories(bmsx_libretro_host PRIVATE ${SDL2_INCLUDE_DIRS})
			target_link_libraries(bmsx_libretro_host PRIVATE ${SDL2_LIBRARIES})
		endif()
	endif()
endif()

# =============================================================================
# SDL standalone (for debugging) - TODO: implement
# =============================================================================

if(BMSX_BUILD_SDL)
	message(WARNING "SDL platform not yet implemented")
	# find_package(SDL2 REQUIRED)
	# add_executable(bmsx_sdl ...)
endif()

# =============================================================================
# Tests
# =============================================================================

if(BMSX_BUILD_TESTS)
	enable_testing()
	# add_subdirectory(tests)
endif()

# =============================================================================
# Installation
# =============================================================================

install(TARGETS bmsx_core
	ARCHIVE DESTINATION lib
	LIBRARY DESTINATION lib
)

if(BMSX_BUILD_LIBRETRO)
	install(TARGETS bmsx_libretro
		LIBRARY DESTINATION lib/libretro
		RUNTIME DESTINATION lib/libretro
	)
endif()

install(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/
	DESTINATION include/bmsx
	FILES_MATCHING PATTERN "*.h"
)
