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
├── core/
│   ├── types.h                 # Core type definitions (Vec2, Vec3, Color, Rect, etc.)
│   ├── types.cpp
│   ├── registry.h              # Global object registry (mirrors TS Registry)
│   ├── registry.cpp
│   ├── world.h                 # World, Space, WorldObject, Component
│   ├── world.cpp
│   ├── fsm.h                   # StateMachineController (stub)
│   ├── fsm.cpp
│   ├── assets.h                # RuntimeAssets (img, audio, model, data)
│   ├── assets.cpp
│   ├── engine.h                # EngineCore with global $ accessor
│   └── engine.cpp
└── platform/
    └── libretro/
        ├── libretro.h          # Libretro API header
        ├── libretro_entry.cpp  # Libretro callback implementations
        ├── libretro_platform.h # Platform implementation for libretro
        └── libretro_platform.cpp
```

## Architecture (mirrors TypeScript)

**IMPORTANT**: This C++ code mirrors the TypeScript architecture exactly!

- `WorldObject` does **NOT** have `tick()` or `paint()` methods
- Ticking is done by `World.run()` which drives Systems through phases
- Rendering is done by Components and Systems
- Behavior is driven by `StateMachineController` (FSM)

| TypeScript               | C++                      | Description                              |
| ------------------------ | ------------------------ | ---------------------------------------- |
| `EngineCore` / `$`       | `EngineCore` / `$()`     | Global engine accessor                   |
| `World`                  | `World`                  | Container for Spaces, drives tick phases |
| `Space`                  | `Space`                  | Container for WorldObjects (level/scene) |
| `WorldObject`            | `WorldObject`            | Game object with components (NO tick!)   |
| `Component`              | `Component`              | Behavior/data attached to objects        |
| `StateMachineController` | `StateMachineController` | FSM manager per object                   |
| `Registry`               | `Registry`               | Global object lookup by ID               |
| `RuntimeAssets`          | `RuntimeAssets`          | Loaded assets (img, audio, etc.)         |
| `Platform`               | `Platform`               | Host abstraction (input, audio, video)   |
| `SubscriptionHandle`     | `SubscriptionHandle`     | Event unsubscription handle              |

### Tick Phases (World.run)

The TypeScript `World.run()` drives updates through phases, NOT individual object `tick()` calls:

1. **Input** - Input processing
2. **ActionEffect** - Ability/montage updates
3. **ModeResolution** - FSM ticks (`sc.tick()`)
4. **Physics** - Physics/collision
5. **Animation** - Animation controllers
6. **Presentation** - Render prep, audio, UI
7. **EventFlush** - Event flush, debug hooks

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
- `BMSX_LIBRETRO`: Build libretro core (default: ON)

```bash
# Build with SDL2 test app
cmake .. -DBMSX_BUILD_SDL=ON

# Build only static library (no libretro)
cmake .. -DBMSX_LIBRETRO=OFF
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
- [ ] Lua VM integration (via custom Lua compiler (see existing TS implementation))
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
