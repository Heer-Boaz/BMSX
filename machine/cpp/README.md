# BMSX C++ Machine Runtime

This directory contains the C++ implementation of the BMSX machine runtime. It
builds the C++ machine library used by hosts such as the libretro core entrypoint.

BMSX is a fantasy console with real console discipline. The C++ tree mirrors the TypeScript machine layout where possible: cart-visible behavior belongs in the machine, memory map, and device controllers; host code presents the result to libretro or local frontends.

## Directory Structure

```
machine/cpp/
├── README.md
└── src/
    ├── CMakeLists.txt
    ├── audio/                 # C++ host audio edge
    ├── common/                # Shared low-level C++ helpers
    ├── core/                  # Runtime coordination and system bootstrap
    ├── input/                 # Host input models and mapping
    ├── lua/                   # Lua syntax/runtime support
    ├── machine/               # CPU, memory, MMIO, devices, firmware, scheduler
    ├── platform/              # C++ platform service interfaces
    ├── render/                # C++ render backends and presentation edge
    ├── rompack/               # ROM package format/loaders
    └── vendor/                # C/C++ third-party implementation files
```

The libretro core entrypoint lives in `hosts/libretro`. The local executable
that can run a libretro core lives in `hosts/libretro_host`.

## Architecture (Machine-first)

The C++ runtime focuses on mirroring the console machine boundary from the TypeScript implementation.

- `machine/` owns CPU, memory, MMIO registers, device controllers, firmware, program loading, timing, and runtime state.
- `render/`, `audio/`, `input/`, and `platform/` adapt machine state to C++ host edges.
- `audio/SoundMaster` is the host audio edge for master gain and platform pacing. The machine owns AOUT next to the APU controller; source-DMA buffers, voice ids, cursor/timer state, decode/mixer state, and raw PCM rendering live under `machine/devices/audio`; cart-visible audio state belongs to the APU controller, source-DMA owner, and AOUT owner.

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
cmake ../src -DCMAKE_BUILD_TYPE=Release

# Build
cmake --build . --config Release

# The output will be:
# - machine: lib/libbmsx.a
# - libretro core: libretro_bmsx.so (Linux), libretro_bmsx.dll (Windows), libretro_bmsx.dylib (macOS)
```

### Build Options

- `BMSX_BUILD_SDL`: Build SDL2 test application (default: OFF)
- `BMSX_BUILD_LIBRETRO`: Build libretro core (default: ON)
- `BMSX_BUILD_LIBRETRO_HOST`: Build `bmsx_libretro_host` (default: OFF)

```bash
# Build with SDL2 test app
cmake ../src -DBMSX_BUILD_SDL=ON

# Build only static library (no libretro)
cmake ../src -DBMSX_BUILD_LIBRETRO=OFF

# Build the local libretro frontend executable (Linux)
cmake ../src -DBMSX_BUILD_LIBRETRO_HOST=ON
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
| N/A | `platform.cpp` |

### Key Patterns

1. **Machine-first ownership**: CPU, RAM/ROM, MMIO, device state, firmware, and save-state live under `src/machine`.
2. **Host edges stay outside the machine**: libretro entrypoint code lives in `hosts/libretro`; the local frontend executable lives in `hosts/libretro_host`.
3. **Mirrored contracts**: TS and C++ runtime slices are audited by `npm run audit:core-parity`.

### Libretro Integration

The libretro core entrypoint exposes BMSX through the libretro callback ABI while consuming the C++ machine runtime. The local `bmsx_libretro_host` executable is a small frontend that can load that core without RetroArch.

## Testing with RetroArch

1. Build the libretro core.
2. Copy `libretro_bmsx.so` to RetroArch's cores directory.
3. Load a `.rom` through RetroArch.

## Notes

- The C++ version is designed to be functionally equivalent to the TypeScript version.
- Performance-critical paths should use scratch buffers and raw machine representations.
- No defensive coding: trust the produced representations and fix the producing boundary.
