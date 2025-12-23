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

    # Core systems
    core/types.cpp
    core/engine.cpp
    core/registry.cpp
    core/world.cpp
    core/assets.cpp
)

target_include_directories(bmsx_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/..
)

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
