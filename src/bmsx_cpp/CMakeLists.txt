cmake_minimum_required(VERSION 3.16)
project(bmsx VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
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

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
	"${CMAKE_CURRENT_SOURCE_DIR}/render/host_overlay/gles2/shaders/host_overlay.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/host_overlay/gles2/shaders/host_overlay.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/axis_gizmo.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/axis_gizmo.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/skybox.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/skybox.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/particle.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/particle.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/mesh.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/mesh.frag.glsl"
)

file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/host_overlay/gles2/shaders/host_overlay.vert.glsl"
	BMSX_HOST_OVERLAY_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/host_overlay/gles2/shaders/host_overlay.frag.glsl"
	BMSX_HOST_OVERLAY_FRAGMENT_SHADER
)
configure_file(
	"${CMAKE_CURRENT_SOURCE_DIR}/render/host_overlay/gles2/shaders/host_overlay_shaders.h.in"
	"${CMAKE_CURRENT_BINARY_DIR}/generated/render/host_overlay/gles2/host_overlay_shaders.h"
	@ONLY
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/axis_gizmo.vert.glsl"
	BMSX_RENDER_3D_AXIS_GIZMO_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/axis_gizmo.frag.glsl"
	BMSX_RENDER_3D_AXIS_GIZMO_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/skybox.vert.glsl"
	BMSX_RENDER_3D_SKYBOX_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/skybox.frag.glsl"
	BMSX_RENDER_3D_SKYBOX_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/particle.vert.glsl"
	BMSX_RENDER_3D_PARTICLE_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/particle.frag.glsl"
	BMSX_RENDER_3D_PARTICLE_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/mesh.vert.glsl"
	BMSX_RENDER_3D_MESH_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/mesh.frag.glsl"
	BMSX_RENDER_3D_MESH_FRAGMENT_SHADER
)
configure_file(
	"${CMAKE_CURRENT_SOURCE_DIR}/render/3d/shaders/render_3d_shaders.h.in"
	"${CMAKE_CURRENT_BINARY_DIR}/generated/render/3d/shaders/render_3d_shaders.h"
	@ONLY
)

add_library(bmsx_core STATIC
	# Platform abstraction
	platform/platform.cpp
	common/subscription.cpp

	# Vendor (header-only implementations)
	vendor/stb_impl.c

	# Core systems
	common/vector.cpp
	core/console.cpp
	core/rom_boot_manager.cpp
	core/host_frame.cpp
	core/host_overlay_menu.cpp
	core/system.cpp
	machine/terminal/terminal.cpp
	common/registry.cpp
	rompack/loader.cpp
	rompack/tokens.cpp
	rompack/toc.cpp
	rompack/metadata.cpp
	rompack/source.cpp
	rompack/host_system_atlas.cpp
	rompack/host_system_atlas.generated.cpp
	common/serializer/binencoder.cpp
	rompack/format.cpp
	render/shared/bitmap_font.cpp
	core/taskgate.cpp
	common/byte_hex_string.cpp
	common/mem_snapshot.cpp
	common/scratchbuffer.cpp

	# Audio systems
	audio/soundmaster.cpp
	machine/devices/audio/biquad_filter.cpp
	machine/devices/audio/command_fifo.cpp
	machine/devices/audio/source.cpp
	machine/devices/audio/output.cpp
	machine/devices/audio/save_state.cpp

	# Input systems
	input/player.cpp
	input/action_parser.cpp
	input/manager.cpp
	input/keyboard.cpp
	input/gamepad.cpp
	input/pointer.cpp

	# Render systems
	render/backend/backend.cpp
	render/3d/math.cpp
	render/3d/camera.cpp
	render/3d/axis_gizmo_pipeline.cpp
	render/3d/mesh/pipeline.cpp
	render/3d/mesh/rom_source.cpp
	render/3d/mesh/vertex_stream.cpp
	render/3d/particles/pipeline.cpp
	render/3d/skybox/pipeline.cpp
	render/gameview.cpp
	render/backend/frame_uniforms.cpp
	render/lighting/system.cpp
	render/shared/camera_state.cpp
	render/host_overlay/pipeline.cpp
	render/host_overlay/overlay_queue.cpp
	render/host_overlay/software/renderer.cpp
	render/host_overlay/gles2/renderer.cpp
	render/shared/hardware/camera.cpp
	render/shared/hardware/lighting.cpp
	render/vdp/context_state.cpp
	render/vdp/framebuffer.cpp
	render/vdp/surfaces.cpp
	render/vdp/slot_textures.cpp
	render/vdp/transform.cpp
	render/vdp/view_snapshot.cpp
	render/texture_manager.cpp
	render/backend/pass/library.cpp
	render/backend/pass/software_scene.cpp
	render/graph/graph.cpp
	render/shared/glyphs.cpp
	render/test_pattern.cpp

	# Machine runtime (Lua bytecode interpreter)
	machine/cpu/cpu.cpp
	machine/cpu/opcode_info.cpp
	machine/cpu/instruction_format.cpp
	render/shared/bmsx_font.cpp
	machine/cpu/source_text.cpp
	lua/syntax/lexer.cpp
	lua/syntax/parser.cpp
	machine/devices/dma/controller.cpp
	machine/devices/device_status.cpp
	machine/devices/geometry/addressing.cpp
	machine/devices/geometry/xform2.cpp
	machine/devices/geometry/sat2.cpp
	machine/devices/geometry/overlap2d.cpp
	machine/devices/geometry/controller.cpp
	machine/devices/geometry/save_state.cpp
	machine/devices/imgdec/controller.cpp
	machine/devices/input/action_table.cpp
	machine/devices/input/control_port.cpp
	machine/devices/input/controller.cpp
	machine/devices/input/event_fifo.cpp
	machine/devices/input/output_port.cpp
	machine/devices/input/query_port.cpp
	machine/devices/input/registers.cpp
	machine/devices/input/sample_latch.cpp
	machine/devices/input/save_state.cpp
	machine/devices/audio/controller.cpp
	machine/devices/irq/controller.cpp
	machine/devices/irq/save_state.cpp
	machine/firmware/devtools.cpp
	machine/firmware/builtin_descriptors.cpp
	machine/firmware/builtins.cpp
	machine/firmware/system_globals.cpp
	machine/firmware/handler_registry.cpp
	machine/cpu/disassembler.cpp
	machine/program/load_compiler.cpp
	machine/firmware/globals.cpp
	machine/memory/lua_heap_usage.cpp
	machine/firmware/runtime.cpp
	machine/machine.cpp
	machine/save_state.cpp
	machine/scheduler/device.cpp
	machine/runtime/runtime.cpp
	machine/runtime/machine_state.cpp
	machine/runtime/save_machine_state.cpp
	machine/runtime/cpu_state.cpp
	machine/runtime/save_state.cpp
	machine/runtime/save_state/schema.cpp
	machine/runtime/save_state/codec.cpp
	machine/runtime/resume_snapshot.cpp
	machine/runtime/cart_boot.cpp
	machine/runtime/cpu_executor.cpp
	machine/runtime/system_irq.cpp
	machine/runtime/boot_timing.cpp
	machine/runtime/frame/loop.cpp
	machine/runtime/frame/step.cpp
	machine/program/executor.cpp
	machine/program/scratch.cpp
	machine/specs.cpp
	machine/scheduler/frame.cpp
	machine/memory/specs.cpp
	render/presentation_state.cpp
	machine/runtime/timing/index.cpp
	machine/runtime/timing/state.cpp
	machine/runtime/timing/config.cpp
	machine/runtime/vblank.cpp
	machine/runtime/debug.cpp
	machine/runtime/host/native_bridge.cpp
	machine/memory/access_kind.cpp
	machine/memory/memory.cpp
	machine/memory/map.cpp
	machine/devices/vdp/bbu.cpp
	machine/devices/vdp/blitter.cpp
	machine/devices/vdp/fbm.cpp
	machine/devices/vdp/frame.cpp
	machine/devices/vdp/ingress.cpp
	machine/devices/vdp/jtu.cpp
	machine/devices/vdp/mdu.cpp
	machine/devices/vdp/mfu.cpp
	machine/devices/vdp/pmu.cpp
	machine/devices/vdp/readback.cpp
	machine/devices/vdp/registers.cpp
	machine/devices/vdp/sbx.cpp
	machine/devices/vdp/save_state.cpp
	machine/devices/vdp/vout.cpp
	machine/devices/vdp/vram.cpp
	machine/devices/vdp/xf.cpp
	machine/common/hash.cpp
	machine/devices/vdp/vram_garbage.cpp
	machine/devices/vdp/vdp.cpp
	machine/cpu/string_pool.cpp
	machine/program/loader.cpp
	machine/program/linker.cpp
)

# stb is plain C; compile it as C to avoid libstdc++'s legacy C wrappers (e.g. <math.h>)

# Required for linking static library into shared library
set_target_properties(bmsx_core PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_include_directories(bmsx_core PUBLIC
	${CMAKE_CURRENT_SOURCE_DIR}
	${CMAKE_CURRENT_SOURCE_DIR}/..
	${CMAKE_CURRENT_BINARY_DIR}/generated
)

target_compile_definitions(bmsx_core PUBLIC
	BMSX_ENABLE_GLES2=$<BOOL:${BMSX_ENABLE_GLES2}>
	BMSX_ENABLE_ZLIB=$<BOOL:${BMSX_ENABLE_ZLIB}>
)

if(BMSX_ENABLE_GLES2)
	target_sources(bmsx_core PRIVATE
		render/backend/gles2_backend.cpp
		render/post/crt_pipeline_gles2.cpp
	)
	find_library(GLESV2_LIBRARY GLESv2 REQUIRED)
	target_link_libraries(bmsx_core PUBLIC ${GLESV2_LIBRARY})
endif()

if(BMSX_ENABLE_ZLIB)
	target_link_libraries(bmsx_core PUBLIC ZLIB::ZLIB)
endif()

# =============================================================================
# Libretro core (shared library)
# =============================================================================

	if(BMSX_BUILD_LIBRETRO)
		add_library(bmsx_libretro SHARED
			platform/libretro/platform.cpp
			platform/libretro/entry.cpp
		)

	target_link_libraries(bmsx_libretro PRIVATE bmsx_core)
	if(UNIX AND NOT APPLE AND CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
		target_link_options(bmsx_libretro PRIVATE "-Wl,--no-undefined")
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
	if(NOT BMSX_ENABLE_ZLIB)
		message(FATAL_ERROR "BMSX_BUILD_LIBRETRO_HOST requires BMSX_ENABLE_ZLIB for PNG screenshot output.")
	endif()

	add_executable(bmsx_libretro_host
		platform/libretro_host/main.c
		platform/libretro_host/input_timeline.c
		platform/libretro_host/screenshot.c
	)

	# SNES Mini sysroot uses glibc 2.19; the cross toolchain defaults to time64.
	if(CMAKE_CROSSCOMPILING)
		target_compile_definitions(bmsx_libretro_host PRIVATE _TIME_BITS=32)
	endif()
	target_link_libraries(bmsx_libretro_host PRIVATE dl rt pthread m ZLIB::ZLIB)
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
	add_executable(bmsx_vdp_ingress_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/vdp_ingress_test.cpp
	)
	target_link_libraries(bmsx_vdp_ingress_tests PRIVATE bmsx_core)
	add_test(NAME bmsx_vdp_ingress_tests COMMAND bmsx_vdp_ingress_tests)

	add_executable(bmsx_core_golden_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/core_golden_test.cpp
	)
	target_link_libraries(bmsx_core_golden_tests PRIVATE bmsx_core)
	add_test(NAME bmsx_core_golden_tests COMMAND bmsx_core_golden_tests)

	add_executable(bmsx_libretro_save_state_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_save_state_test.cpp
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/support/program_cart_fixture.cpp
		platform/libretro/platform.cpp
	)
	target_link_libraries(bmsx_libretro_save_state_tests PRIVATE bmsx_core)
	add_test(NAME bmsx_libretro_save_state_tests COMMAND bmsx_libretro_save_state_tests)
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
