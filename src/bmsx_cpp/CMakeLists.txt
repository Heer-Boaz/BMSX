cmake_minimum_required(VERSION 3.16)
project(bmsx VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# =============================================================================
# Options
# =============================================================================

option(BMSX_BUILD_LIBRETRO "Build libretro core" ON)
option(BMSX_BUILD_SDL "Build SDL standalone executable" OFF)
option(BMSX_BUILD_TESTS "Build unit tests" OFF)
option(BMSX_ENABLE_LTO "Enable Link Time Optimization" OFF)

# =============================================================================
# Find zlib (for ROM decompression)
# =============================================================================

find_package(ZLIB REQUIRED)

# =============================================================================
# Compiler flags
# =============================================================================

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    add_compile_options(-Wall -Wextra -Wpedantic)
    if(BMSX_ENABLE_LTO)
        add_compile_options(-flto)
        add_link_options(-flto)
    endif()
elseif(MSVC)
    add_compile_options(/W4)
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
    vendor/stb_impl.cpp

    # Core systems
    core/types.cpp
    core/engine.cpp
    core/registry.cpp
    core/world.cpp
    core/assets.cpp
    core/binencoder.cpp
    core/rompack.cpp
    core/font.cpp
    core/textobject.cpp

    # Timeline systems
    timeline/timeline.cpp

    # FSM systems
    fsm/statedefinition.cpp
    fsm/state.cpp
    fsm/fsmcontroller.cpp
    fsm/fsmlibrary.cpp

    # Input systems
    input/inputstatemanager.cpp
    input/playerinput.cpp
    input/actionparser.cpp
    input/input.cpp
    input/keyboardinput.cpp
    input/gamepadinput.cpp

    # Component systems
    component/component.cpp
    component/collisioncomponents.cpp
    component/transformcomponent.cpp
    component/actioneffectcomponent.cpp
    component/spritecomponent.cpp
    component/timelinecomponent.cpp

    # Action effects
    action_effects/input_action_effect_compiler.cpp

    # Render systems
    render/backend.cpp
    render/gameview.cpp
    render/render_queues.cpp
    render/sprites_pipeline.cpp
    render/renderpasslib.cpp
    render/rendergraph.cpp
    render/glyphs.cpp

    # ECS systems
    ecs/ecsystem.cpp
    ecs/input_action_effect_system.cpp

    # VM (Lua bytecode interpreter)
    vm/cpu.cpp
    vm/font.cpp
    vm/vm_api.cpp
    vm/vm_runtime.cpp
    vm/vm_systems.cpp
    vm/program_loader.cpp
)

# Required for linking static library into shared library
set_target_properties(bmsx_core PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_include_directories(bmsx_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/..
)

target_link_libraries(bmsx_core PUBLIC ZLIB::ZLIB)

# =============================================================================
# Libretro core (shared library)
# =============================================================================

if(BMSX_BUILD_LIBRETRO)
    add_library(bmsx_libretro SHARED
        platform/libretro/libretro_platform.cpp
        platform/libretro/libretro_entry.cpp
    )

    target_link_libraries(bmsx_libretro PRIVATE bmsx_core)

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
