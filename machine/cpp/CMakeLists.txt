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
option(BMSX_ENABLE_ZLIB "Enable PNG screenshot output" ON)
set(BMSX_ENABLE_GLES2_DEFAULT ON)
# Previously GLES2 was disabled by default on Windows; enable by default on all platforms
message(STATUS "BMSX: Default BMSX_ENABLE_GLES2=${BMSX_ENABLE_GLES2_DEFAULT}")
option(BMSX_ENABLE_GLES2 "Enable OpenGLES2 backend" ${BMSX_ENABLE_GLES2_DEFAULT})

# =============================================================================
# Find zlib for PNG screenshot output.
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
# Shared wire-format libraries
# =============================================================================

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
	"${CMAKE_CURRENT_SOURCE_DIR}/render/host_overlay/gles2/shaders/host_overlay.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/host_overlay/gles2/shaders/host_overlay.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_fill.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_fill.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_line.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_line.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_textured.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_textured.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_transfer.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_transfer.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_scanout.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_scanout.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_readback.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_shaders.h.in"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/gles2/shaders/fullscreen.vert.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/crt/gles2/shaders/present.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/crt/gles2/shaders/crt.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/crt/gles2/shaders/crt_post_shaders.h.in"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/device_quantize/gles2/shaders/device_quantize.frag.glsl"
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/device_quantize/gles2/shaders/device_quantize_shaders.h.in"
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
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_fill.vert.glsl"
	BMSX_GX_GPU_FILL_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_fill.frag.glsl"
	BMSX_GX_GPU_FILL_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_line.vert.glsl"
	BMSX_GX_GPU_LINE_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_line.frag.glsl"
	BMSX_GX_GPU_LINE_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_textured.vert.glsl"
	BMSX_GX_GPU_TEXTURED_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_textured.frag.glsl"
	BMSX_GX_GPU_TEXTURED_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_transfer.vert.glsl"
	BMSX_GX_GPU_TRANSFER_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_transfer.frag.glsl"
	BMSX_GX_GPU_TRANSFER_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_scanout.vert.glsl"
	BMSX_GX_GPU_SCANOUT_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_scanout.frag.glsl"
	BMSX_GX_GPU_SCANOUT_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_readback.frag.glsl"
	BMSX_GX_GPU_READBACK_FRAGMENT_SHADER
)
configure_file(
	"${CMAKE_CURRENT_SOURCE_DIR}/render/backend/gles2/shaders/gx_gpu_shaders.h.in"
	"${CMAKE_CURRENT_BINARY_DIR}/generated/render/backend/gles2/shaders/gx_gpu_shaders.h"
	@ONLY
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/gles2/shaders/fullscreen.vert.glsl"
	BMSX_POST_GLES2_FULLSCREEN_VERTEX_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/crt/gles2/shaders/present.frag.glsl"
	BMSX_PRESENT_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/crt/gles2/shaders/crt.frag.glsl"
	BMSX_CRT_FRAGMENT_SHADER
)
file(READ
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/device_quantize/gles2/shaders/device_quantize.frag.glsl"
	BMSX_DEVICE_QUANTIZE_FRAGMENT_SHADER
)
configure_file(
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/crt/gles2/shaders/crt_post_shaders.h.in"
	"${CMAKE_CURRENT_BINARY_DIR}/generated/render/post/crt/gles2/shaders/crt_post_shaders.h"
	@ONLY
)
configure_file(
	"${CMAKE_CURRENT_SOURCE_DIR}/render/post/device_quantize/gles2/shaders/device_quantize_shaders.h.in"
	"${CMAKE_CURRENT_BINARY_DIR}/generated/render/post/device_quantize/gles2/shaders/device_quantize_shaders.h"
	@ONLY
)

add_library(bmsx_binary_codec STATIC
	common/serializer/binencoder.cpp
)

add_library(bmsx_rom_image STATIC
	rompack/format.cpp
	rompack/image.cpp
)

foreach(target bmsx_binary_codec bmsx_rom_image)
	set_target_properties(${target} PROPERTIES
		POSITION_INDEPENDENT_CODE ON
	)
	target_include_directories(${target} PUBLIC
		${CMAKE_CURRENT_SOURCE_DIR}
		${CMAKE_CURRENT_SOURCE_DIR}/..
	)
endforeach()

# =============================================================================
# Machine library (static)
# =============================================================================

add_library(bmsx_core STATIC
	common/scratchbuffer.cpp

	machine/devices/audio/active_slots.cpp
	machine/devices/audio/badp_decoder.cpp
	machine/devices/audio/biquad_filter.cpp
	machine/devices/audio/command_executor.cpp
	machine/devices/audio/command_fifo.cpp
	machine/devices/audio/command_ingress.cpp
	machine/devices/audio/command_latch.cpp
	machine/devices/audio/event_latch.cpp
	machine/devices/audio/sample_memory.cpp
	machine/devices/audio/sample_transfer.cpp
	machine/devices/audio/source.cpp
	machine/devices/audio/selected_slot_latch.cpp
	machine/devices/audio/service_clock.cpp
	machine/devices/audio/slot_bank.cpp
	machine/devices/audio/status_register.cpp
	machine/devices/audio/output_ring.cpp
	machine/devices/audio/queue_status_registers.cpp
	machine/devices/audio/playback.cpp
	machine/devices/audio/output.cpp
	machine/devices/audio/save_state.cpp

	machine/cpu/cpu.cpp
	machine/cpu/lua_heap.cpp
	machine/cpu/table.cpp
	machine/cpu/value.cpp
	machine/execution_address_space.cpp
	spec/blua32/opcode.cpp
	spec/blua32/instruction_format.cpp
	machine/devices/cartridge/controller.cpp
	machine/devices/dma/controller.cpp
	machine/devices/imgdec/controller.cpp
	machine/devices/device_status.cpp
	machine/devices/geometry/addressing.cpp
	machine/devices/geometry/xform2.cpp
	machine/devices/geometry/sat2.cpp
	machine/devices/geometry/overlap2d.cpp
	machine/devices/geometry/controller.cpp
	machine/devices/geometry/save_state.cpp
	machine/devices/input/controller.cpp
	machine/devices/input/output_port.cpp
	machine/devices/input/registers.cpp
	machine/devices/input/save_state.cpp
	machine/devices/system/controller.cpp
	machine/devices/audio/controller.cpp
	machine/devices/irq/controller.cpp
	machine/devices/irq/save_state.cpp
	machine/firmware/globals.cpp
	machine/machine.cpp
	machine/model_registry.cpp
	machine/save_state.cpp
	machine/scheduler/device.cpp
	machine/runtime/runtime.cpp
	machine/runtime/machine_state.cpp
	machine/runtime/save_machine_state.cpp
	machine/runtime/save_state.cpp
	machine/runtime/save_state/schema.cpp
	machine/runtime/save_state/codec.cpp
	machine/runtime/cpu_executor.cpp
	machine/runtime/frame/loop.cpp
	machine/runtime/lua_scratch.cpp
	machine/scheduler/frame.cpp
	machine/runtime/timing/index.cpp
	machine/runtime/timing/state.cpp
	machine/runtime/timing/config.cpp
	machine/runtime/vblank.cpp
	machine/memory/memory.cpp
	machine/devices/gx/gpu.cpp
	machine/devices/gx/gpu_pcrtc.cpp
	machine/devices/gx/gpu_command_timing.cpp
	machine/devices/gx/vram_power_on.cpp
	machine/devices/gx/gte.cpp
	common/hash.cpp
	machine/cpu/string_pool.cpp
)


# Required for linking static library into shared library.
set_target_properties(bmsx_core PROPERTIES
	POSITION_INDEPENDENT_CODE ON
	OUTPUT_NAME "bmsx"
)

target_include_directories(bmsx_core PUBLIC
	${CMAKE_CURRENT_SOURCE_DIR}
	${CMAKE_CURRENT_SOURCE_DIR}/..
)

target_link_libraries(bmsx_core PUBLIC bmsx_binary_codec)

# =============================================================================
# Native host support (static)
# =============================================================================

add_library(bmsx_host_support STATIC
	platform/platform.cpp
	common/subscription.cpp
	common/vector.cpp
	common/taskgate.cpp
	common/byte_hex_string.cpp
	common/mmap_file.cpp
	audio/output_resampler.cpp
	input/manager.cpp
	render/backend/backend.cpp
	render/backend/software/gx_gpu.cpp
	render/backend/software/gx_gpu_commands.cpp
	render/backend/software/gx_gpu_rasterizer.cpp
	render/backend/software/gx_gpu_scanout.cpp
	render/backend/software/gx_gpu_vram.cpp
	render/backend/frame_uniforms.cpp
	render/backend/pass/library.cpp
	render/graph/graph.cpp
	render/host_overlay/atlas.cpp
	render/host_overlay/atlas.generated.cpp
	render/host_overlay/pipeline.cpp
	render/host_overlay/overlay_queue.cpp
	render/host_overlay/software/renderer.cpp
	render/host_overlay/gles2/pipeline.cpp
	render/post/crt/software/pipeline.cpp
	render/post/crt/software/crt_processor.cpp
	render/post/device_quantize/lut.cpp
	render/post/device_quantize/software/pipeline.cpp
	render/shared/bitmap_font.cpp
	render/shared/bmsx_font.cpp
	render/video_presenter.cpp
)

set_target_properties(bmsx_host_support PROPERTIES
	POSITION_INDEPENDENT_CODE ON
)

target_include_directories(bmsx_host_support PUBLIC
	${CMAKE_CURRENT_SOURCE_DIR}
	${CMAKE_CURRENT_SOURCE_DIR}/..
	${CMAKE_CURRENT_BINARY_DIR}/generated
)

target_compile_definitions(bmsx_host_support PUBLIC
	BMSX_ENABLE_GLES2=$<BOOL:${BMSX_ENABLE_GLES2}>
)

target_link_libraries(bmsx_host_support PUBLIC bmsx_core)

if(BMSX_ENABLE_GLES2)
	target_sources(bmsx_host_support PRIVATE
		render/backend/gles2/backend.cpp
		render/backend/gles2/fullscreen_quad.cpp
		render/backend/gles2/gx_gpu.cpp
		render/post/crt/gles2/pipeline.cpp
		render/post/device_quantize/gles2/pipeline.cpp
	)
	find_library(GLESV2_LIBRARY GLESv2 REQUIRED)
	target_link_libraries(bmsx_host_support PUBLIC ${GLESV2_LIBRARY})
	if(UNIX AND NOT APPLE)
		target_link_libraries(bmsx_host_support PUBLIC dl)
	endif()
endif()

# =============================================================================
# ROM and BLua32 source diagnostics tooling
# =============================================================================

if(BMSX_BUILD_LIBRETRO OR BMSX_BUILD_TESTS)
	add_library(bmsx_rom_tooling STATIC
		rompack/tokens.cpp
		rompack/toc.cpp
	)

	set_target_properties(bmsx_rom_tooling PROPERTIES
		POSITION_INDEPENDENT_CODE ON
	)

	target_link_libraries(bmsx_rom_tooling PUBLIC
		bmsx_binary_codec
		bmsx_rom_image
	)

	add_library(bmsx_blua32_tooling STATIC
		rompack/tooling/blua32_image.cpp
		rompack/tooling/blua32_symbols.cpp
		rompack/tooling/blua32_media.cpp
		rompack/tooling/opcode_metadata.cpp
		rompack/tooling/source_text.cpp
		rompack/tooling/disassembler.cpp
	)

	set_target_properties(bmsx_blua32_tooling PROPERTIES
		POSITION_INDEPENDENT_CODE ON
	)

	target_link_libraries(bmsx_blua32_tooling PUBLIC bmsx_rom_tooling)
endif()

# =============================================================================
# Libretro core (shared library)
# =============================================================================

set(BMSX_LIBRETRO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../hosts/libretro")
set(BMSX_LIBRETRO_HOST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../hosts/libretro_host")
set(BMSX_LIBRETRO_PLATFORM_SOURCES
	${BMSX_LIBRETRO_DIR}/audio_output.cpp
	${BMSX_LIBRETRO_DIR}/host_frame.cpp
	${BMSX_LIBRETRO_DIR}/host_overlay_menu.cpp
	${BMSX_LIBRETRO_DIR}/mem_snapshot.cpp
	${BMSX_LIBRETRO_DIR}/platform.cpp
	${BMSX_LIBRETRO_DIR}/presentation_state.cpp
	${BMSX_LIBRETRO_DIR}/runtime_error.cpp
)

if(BMSX_BUILD_LIBRETRO)
	add_library(bmsx_libretro SHARED
		${BMSX_LIBRETRO_PLATFORM_SOURCES}
		${BMSX_LIBRETRO_DIR}/entry.cpp
	)

	target_link_libraries(bmsx_libretro PRIVATE bmsx_host_support bmsx_blua32_tooling)
	if(UNIX AND NOT APPLE AND CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
		target_link_options(bmsx_libretro PRIVATE
			"-Wl,--no-undefined"
			"-Wl,--version-script=${BMSX_LIBRETRO_DIR}/libretro.map"
		)
		set_target_properties(bmsx_libretro PROPERTIES
			LINK_DEPENDS "${BMSX_LIBRETRO_DIR}/libretro.map"
		)
	endif()
	if(BMSX_SNESMINI_TARGET)
		target_compile_definitions(bmsx_libretro PRIVATE BMSX_LIBRETRO_SNESMINI_LAYOUT=1)
		target_link_options(bmsx_libretro PRIVATE
			-static-libstdc++
			-static-libgcc
		)
	endif()
	# Libretro naming convention
	set_target_properties(bmsx_libretro PROPERTIES
		PREFIX ""
		OUTPUT_NAME "libretro_bmsx"
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
		${BMSX_LIBRETRO_DIR}
	)

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
		${BMSX_LIBRETRO_HOST_DIR}/main.c
		${BMSX_LIBRETRO_HOST_DIR}/audio_output.c
		${BMSX_LIBRETRO_HOST_DIR}/audio_queue.c
		${BMSX_LIBRETRO_HOST_DIR}/core_options.c
		${BMSX_LIBRETRO_HOST_DIR}/core_session.c
		${BMSX_LIBRETRO_HOST_DIR}/frame_pacer.c
		${BMSX_LIBRETRO_HOST_DIR}/frame_timing.c
		${BMSX_LIBRETRO_HOST_DIR}/host_fatal.c
		${BMSX_LIBRETRO_HOST_DIR}/input_devices.c
		${BMSX_LIBRETRO_HOST_DIR}/input_timeline.c
		${BMSX_LIBRETRO_HOST_DIR}/keyboard_input.c
		${BMSX_LIBRETRO_HOST_DIR}/screenshot.c
		${BMSX_LIBRETRO_HOST_DIR}/software_frame_blitter.c
		${BMSX_LIBRETRO_HOST_DIR}/supervisor_chord.c
		${BMSX_LIBRETRO_HOST_DIR}/video_context.c
		${BMSX_LIBRETRO_HOST_DIR}/video_presenter.c
	)

	target_link_libraries(bmsx_libretro_host PRIVATE dl rt pthread m ZLIB::ZLIB)
	target_include_directories(bmsx_libretro_host PRIVATE
		${BMSX_LIBRETRO_DIR}
	)

	if(NOT CMAKE_CROSSCOMPILING)
		find_package(SDL2 REQUIRED CONFIG)
		target_compile_definitions(bmsx_libretro_host PRIVATE BMSX_LIBRETRO_HOST_SDL=1)
		target_link_libraries(bmsx_libretro_host PRIVATE SDL2::SDL2)
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
	set(BMSX_TEST_ROM_SOURCE
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/support/blua32_test_rom.cpp
	)

	add_executable(bmsx_libretro_host_frame_pacer_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_host_frame_pacer_test.c
		${BMSX_LIBRETRO_HOST_DIR}/frame_pacer.c
	)
	target_include_directories(bmsx_libretro_host_frame_pacer_tests PRIVATE ${BMSX_LIBRETRO_HOST_DIR})
	add_test(NAME bmsx_libretro_host_frame_pacer_tests COMMAND bmsx_libretro_host_frame_pacer_tests)

	add_executable(bmsx_libretro_host_frame_timing_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_host_frame_timing_test.c
		${BMSX_LIBRETRO_HOST_DIR}/frame_timing.c
	)
	target_include_directories(bmsx_libretro_host_frame_timing_tests PRIVATE
		${BMSX_LIBRETRO_HOST_DIR}
		${BMSX_LIBRETRO_DIR}
	)
	add_test(NAME bmsx_libretro_host_frame_timing_tests COMMAND bmsx_libretro_host_frame_timing_tests)

	add_executable(bmsx_libretro_host_core_options_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_host_core_options_test.c
		${BMSX_LIBRETRO_HOST_DIR}/core_options.c
	)
	target_include_directories(bmsx_libretro_host_core_options_tests PRIVATE
		${BMSX_LIBRETRO_HOST_DIR}
		${BMSX_LIBRETRO_DIR}
	)
	add_test(NAME bmsx_libretro_host_core_options_tests COMMAND bmsx_libretro_host_core_options_tests)

	add_executable(bmsx_libretro_host_supervisor_chord_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_host_supervisor_chord_test.c
		${BMSX_LIBRETRO_HOST_DIR}/supervisor_chord.c
	)
	target_include_directories(bmsx_libretro_host_supervisor_chord_tests PRIVATE
		${BMSX_LIBRETRO_HOST_DIR}
		${BMSX_LIBRETRO_DIR}
	)
	add_test(NAME bmsx_libretro_host_supervisor_chord_tests COMMAND bmsx_libretro_host_supervisor_chord_tests)

	add_executable(bmsx_libretro_host_software_frame_blitter_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_host_software_frame_blitter_test.c
		${BMSX_LIBRETRO_HOST_DIR}/host_fatal.c
		${BMSX_LIBRETRO_HOST_DIR}/software_frame_blitter.c
	)
	target_include_directories(bmsx_libretro_host_software_frame_blitter_tests PRIVATE
		${BMSX_LIBRETRO_HOST_DIR}
	)
	add_test(
		NAME bmsx_libretro_host_software_frame_blitter_tests
		COMMAND bmsx_libretro_host_software_frame_blitter_tests
	)

	if(UNIX AND NOT APPLE)
		add_executable(bmsx_libretro_host_audio_queue_tests
			${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_host_audio_queue_test.c
			${BMSX_LIBRETRO_HOST_DIR}/audio_queue.c
		)
		target_include_directories(bmsx_libretro_host_audio_queue_tests PRIVATE ${BMSX_LIBRETRO_HOST_DIR})
		target_link_libraries(bmsx_libretro_host_audio_queue_tests PRIVATE pthread)
		add_test(NAME bmsx_libretro_host_audio_queue_tests COMMAND bmsx_libretro_host_audio_queue_tests)
	endif()
	add_executable(bmsx_gx_gte_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/gx_gte_test.cpp
		${BMSX_TEST_ROM_SOURCE}
	)
	target_link_libraries(bmsx_gx_gte_tests PRIVATE bmsx_core bmsx_rom_tooling)
	add_test(NAME bmsx_gx_gte_tests COMMAND bmsx_gx_gte_tests)

	add_executable(bmsx_gx_gpu_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/gx_gpu_test.cpp
	)
	target_link_libraries(bmsx_gx_gpu_tests PRIVATE bmsx_host_support)
	add_test(NAME bmsx_gx_gpu_tests COMMAND bmsx_gx_gpu_tests)

	add_executable(bmsx_device_quantize_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/device_quantize_test.cpp
	)
	target_link_libraries(bmsx_device_quantize_tests PRIVATE bmsx_host_support)
	add_test(NAME bmsx_device_quantize_tests COMMAND bmsx_device_quantize_tests)

	add_executable(bmsx_host_system_atlas_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/host_system_atlas_test.cpp
	)
	target_link_libraries(bmsx_host_system_atlas_tests PRIVATE bmsx_host_support)
	add_test(NAME bmsx_host_system_atlas_tests COMMAND bmsx_host_system_atlas_tests)

	add_executable(bmsx_dma_controller_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/dma_controller_test.cpp
	)
	target_link_libraries(bmsx_dma_controller_tests PRIVATE bmsx_core)
	add_test(NAME bmsx_dma_controller_tests COMMAND bmsx_dma_controller_tests)

	add_executable(bmsx_cartridge_controller_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/cartridge_controller_test.cpp
	)
	target_link_libraries(bmsx_cartridge_controller_tests PRIVATE bmsx_core)
	add_test(NAME bmsx_cartridge_controller_tests COMMAND bmsx_cartridge_controller_tests)

	add_executable(bmsx_rompack_format_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/rompack_format_test.cpp
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/support/blua32_test_rom.cpp
	)
	target_link_libraries(bmsx_rompack_format_tests PRIVATE bmsx_core bmsx_blua32_tooling)
	add_test(NAME bmsx_rompack_format_tests COMMAND bmsx_rompack_format_tests)

	add_executable(bmsx_imgdec_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/imgdec_test.cpp
	)
	target_link_libraries(bmsx_imgdec_tests PRIVATE bmsx_core)
	add_test(NAME bmsx_imgdec_tests COMMAND bmsx_imgdec_tests)

	add_executable(bmsx_audio_controller_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/audio_controller_test.cpp
	)
	target_link_libraries(bmsx_audio_controller_tests PRIVATE bmsx_host_support)
	add_test(NAME bmsx_audio_controller_tests COMMAND bmsx_audio_controller_tests)

	add_executable(bmsx_memory_bus_fault_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/memory_bus_fault_test.cpp
	)
	target_link_libraries(bmsx_memory_bus_fault_tests PRIVATE bmsx_core)
	add_test(NAME bmsx_memory_bus_fault_tests COMMAND bmsx_memory_bus_fault_tests)

	add_executable(bmsx_cpu_supervisor_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/cpu_supervisor_test.cpp
		${BMSX_TEST_ROM_SOURCE}
	)
	target_link_libraries(bmsx_cpu_supervisor_tests PRIVATE bmsx_core bmsx_blua32_tooling)
	add_test(NAME bmsx_cpu_supervisor_tests COMMAND bmsx_cpu_supervisor_tests)

	add_executable(bmsx_input_controller_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/input_controller_test.cpp
	)
	target_link_libraries(bmsx_input_controller_tests PRIVATE bmsx_core)
	add_test(NAME bmsx_input_controller_tests COMMAND bmsx_input_controller_tests)

	add_executable(bmsx_system_controller_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/system_controller_test.cpp
		${BMSX_TEST_ROM_SOURCE}
	)
	target_link_libraries(bmsx_system_controller_tests PRIVATE bmsx_core bmsx_rom_tooling)
	add_test(NAME bmsx_system_controller_tests COMMAND bmsx_system_controller_tests)

	add_executable(bmsx_host_overlay_queue_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/host_overlay_queue_test.cpp
	)
	target_link_libraries(bmsx_host_overlay_queue_tests PRIVATE bmsx_host_support)
	add_test(NAME bmsx_host_overlay_queue_tests COMMAND bmsx_host_overlay_queue_tests)

	add_executable(bmsx_libretro_save_state_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_save_state_test.cpp
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/support/boot_rom_fixture.cpp
		${BMSX_TEST_ROM_SOURCE}
		${BMSX_LIBRETRO_PLATFORM_SOURCES}
	)
	target_link_libraries(bmsx_libretro_save_state_tests PRIVATE bmsx_host_support bmsx_blua32_tooling)
	target_include_directories(bmsx_libretro_save_state_tests PRIVATE
		${BMSX_LIBRETRO_DIR}
	)
	add_test(NAME bmsx_libretro_save_state_tests COMMAND bmsx_libretro_save_state_tests)

	add_executable(bmsx_libretro_environment_tests
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_environment_test.cpp
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/support/boot_rom_fixture.cpp
		${BMSX_TEST_ROM_SOURCE}
		${BMSX_LIBRETRO_DIR}/entry.cpp
		${BMSX_LIBRETRO_PLATFORM_SOURCES}
	)
	target_link_libraries(bmsx_libretro_environment_tests PRIVATE bmsx_host_support bmsx_blua32_tooling)
	target_include_directories(bmsx_libretro_environment_tests PRIVATE
		${BMSX_LIBRETRO_DIR}
	)
	add_test(NAME bmsx_libretro_environment_tests COMMAND bmsx_libretro_environment_tests)

	add_executable(bmsx_cartridge_conformance_runner
		${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/cartridge_conformance_runner.cpp
		${BMSX_LIBRETRO_PLATFORM_SOURCES}
	)
	target_link_libraries(bmsx_cartridge_conformance_runner PRIVATE bmsx_host_support bmsx_blua32_tooling)
	target_include_directories(bmsx_cartridge_conformance_runner PRIVATE
		${BMSX_LIBRETRO_DIR}
	)

	if(BMSX_ENABLE_GLES2)
		add_executable(bmsx_libretro_hw_context_tests
			${CMAKE_CURRENT_SOURCE_DIR}/../../tests/cpp/libretro_hw_context_test.cpp
			${BMSX_LIBRETRO_PLATFORM_SOURCES}
		)
		target_link_libraries(bmsx_libretro_hw_context_tests PRIVATE bmsx_host_support bmsx_blua32_tooling)
		target_include_directories(bmsx_libretro_hw_context_tests PRIVATE
			${BMSX_LIBRETRO_DIR}
		)
		add_test(NAME bmsx_libretro_hw_context_tests COMMAND bmsx_libretro_hw_context_tests)
	endif()
endif()

# =============================================================================
# Installation
# =============================================================================

install(TARGETS
	bmsx_binary_codec
	bmsx_rom_image
	bmsx_core
	bmsx_host_support
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
