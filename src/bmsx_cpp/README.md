# BMSX C++ Implementation

This directory contains the C++ implementation of the BMSX game engine, designed to run as a libretro core for RetroArch and other libretro-compatible frontends.

## Directory Structure

```
bmsx_cpp/
├── CMakeLists.txt              # Main build configuration
├── platform.h                  # Platform abstraction layer (mirrors TS version)
├── platform.cpp                # Base platform implementations
├── subscription.h              # SubscriptionHandle pattern
├── subscription.cpp
├── audio/
├── core/
│   ├── types.h                 # Core type definitions (Vec2, Vec3, Color, Rect, etc.)
│   ├── types.cpp
│   ├── registry.h              # Global object registry (mirrors TS Registry)
│   ├── registry.cpp
│   ├── engine_core.h           # EngineCore with global $ accessor
│   ├── engine_core.cpp
│   ├── font.h                  # Font rendering helpers
│   ├── font.cpp
│   ├── taskgate.h              # Async gate (mirrors TS TaskGate)
│   ├── taskgate.cpp
│   ├── assetbarrier.h          # AssetBarrier (mirrors TS AssetBarrier)
│   └── assetbarrier.cpp
├── input/
├── render/
│   ├── gameview.h              # GameView abstraction
│   ├── gameview.cpp
│   ├── texturemanager.h        # Texture manager
│   ├── texturemanager.cpp
│   ├── backend/
│   │   ├── backend.h
│   │   ├── backend.cpp
│   │   ├── frame_uniforms.h
│   │   ├── frame_uniforms.cpp
│   │   ├── gles2_backend.h
│   │   ├── gles2_backend.cpp
│   │   ├── renderpass_builder.h
│   │   ├── renderpasslib.h
│   │   └── renderpasslib.cpp
│   ├── graph/
│   │   ├── rendergraph.h
│   │   └── rendergraph.cpp
│   ├── post/
│   │   ├── crt_pipeline_gles2.h
│   │   └── crt_pipeline_gles2.cpp
│   └── shared/
│       ├── glyphs.h
│       ├── glyphs.cpp
│       ├── render_queues.h
│       ├── render_queues.cpp
│       └── render_types.h
├── rompack/
│   ├── rompack.h               # ROM pack utilities
│   ├── rompack.cpp
│   ├── runtime_assets.h        # RuntimeAssets (img, audio, model, data)
│   └── runtime_assets.cpp
├── common/
│   ├── serializer/
│   │   ├── binencoder.h
│   │   └── binencoder.cpp
│   ├── clamp.h
│   ├── feature_queue.h
│   ├── mem_snapshot.h
│   ├── mem_snapshot.cpp
│   ├── mmap_file.h
│   ├── mmap_file.cpp
│   └── scratchbatch.h
├── machine/
│   ├── bus/
│   │   └── io.h                 # Memory-mapped I/O register map
│   ├── common/
│   │   └── number_format.h
│   ├── cpu/                     # Lua bytecode CPU + disassembler
│   ├── devices/
│   │   ├── dma/
│   │   ├── geometry/
│   │   ├── imgdec/
│   │   ├── input/
│   │   └── vdp/                 # VDP + packet schema + render budget
│   ├── firmware/                # Runtime firmware API and Lua globals
│   ├── memory/                  # RAM, memory map, strings and Lua heap accounting
│   ├── program/                 # Program loading, linking and load compilation
│   └── runtime/                 # Runtime lifecycle, timing, frame loop and debug
└── platform/
    └── libretro/
        ├── libretro.h          # Libretro API header
        ├── libretro_entry.cpp  # Libretro callback implementations
        ├── libretro_platform.h # Platform implementation for libretro
        └── libretro_platform.cpp
```

## Architecture (Runtime-first)

The C++ runtime focuses on the Lua bytecode interpreter and render/input subsystems.

- `EngineCore` drives `Runtime` update/draw directly each frame.
- Rendering happens through `GameView` + render queues.
- Input is polled through the `Input` singleton.

## Building

### Prerequisites

- CMake 3.16 or later
- C++20 compatible compiler (GCC 10+, Clang 10+, MSVC 2019+)
- Optional: SDL2 for standalone testing

### Build Commands

```bash
# Create build directory
mkdir build && cd build

# Configure (libretro core)
cmake .. -DCMAKE_BUILD_TYPE=Release

# Build
cmake --build . --config Release

# The output will be:
# - libretro: bmsx_libretro.so (Linux), bmsx_libretro.dll (Windows), bmsx_libretro.dylib (macOS)
```

### Build Options

- `BMSX_BUILD_SDL`: Build SDL2 test application (default: OFF)
- `BMSX_BUILD_LIBRETRO`: Build libretro core (default: ON)
- `BMSX_BUILD_LIBRETRO_HOST`: Build `bmsx_libretro_host` (default: OFF)

```bash
# Build with SDL2 test app
cmake .. -DBMSX_BUILD_SDL=ON

# Build only static library (no libretro)
cmake .. -DBMSX_BUILD_LIBRETRO=OFF

# Build the standalone libretro host (Linux)
cmake .. -DBMSX_BUILD_LIBRETRO_HOST=ON
```

## Architecture

### Platform Abstraction

The C++ implementation mirrors the TypeScript platform abstraction layer, making it easier to maintain both versions in parallel:

| TypeScript | C++ |
|------------|-----|
| `platform.ts` | `platform.h` |
| `SubscriptionHandle` | `SubscriptionHandle` struct |
| `Clock`, `FrameLoop`, etc. | Abstract base classes |
| `platform_browser.ts` | N/A (web only) |
| N/A | `libretro_platform.cpp` |

### Key Patterns

1. **SubscriptionHandle**: Replaces closure-based unsubscribe with explicit handle objects
2. **ECS Registry**: Simple entity-component system for game objects
3. **Platform interface**: All host-specific code goes through the Platform interface

### Libretro Integration

The libretro implementation provides:

- **Video**: 32-bit XRGB8888 framebuffer output
- **Audio**: Stereo 16-bit PCM at 44100Hz
- **Input**: Up to 4 players with joypad support
- **Save States**: Full serialization support (TODO)
- **Cheats**: Cheat code support (TODO)

## Development Status

### Completed
- [x] CMake build system
- [x] Platform abstraction layer
- [x] SubscriptionHandle pattern
- [x] Basic type definitions
- [x] ECS Registry
- [x] Engine core skeleton
- [x] Libretro entry points
- [x] Libretro platform implementation skeleton

### In Progress
- [ ] ROM loading and parsing
- [ ] Resource management
- [ ] Sprite rendering
- [ ] Audio mixing
- [ ] Input mapping
- [ ] Save state serialization

### Planned
- [ ] Lua interpreter integration (via custom Lua compiler (see existing TS implementation))
- [ ] FSM system
- [ ] Collision system
- [ ] Animation system
- [ ] UI system

## Testing with RetroArch

1. Build the libretro core
2. Copy `bmsx_libretro.so` to RetroArch's cores directory
3. Load a `.rom` or `.bmsx` file through RetroArch

## Notes

- The C++ version is designed to be functionally equivalent to the TypeScript version
- Performance-critical paths should use the scratch buffer patterns from the TS version
- No defensive coding - trust the types, let errors surface naturally
