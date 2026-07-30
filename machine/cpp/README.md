# BMSX C++ Machine Runtime

This directory contains the C++ implementation of the BMSX machine runtime. It
builds the C++ machine library used by hosts such as the libretro core entrypoint.

BMSX is an emulated machine with emulator discipline. The C++ tree mirrors the TypeScript machine layout where possible: cart-visible behavior belongs in the machine, memory map, and device controllers; host code presents the result to libretro or local frontends.

## Directory Structure

```
machine/cpp/
├── README.md
├── CMakeLists.txt
├── audio/                 # C++ host audio edge
├── common/                # Shared low-level C++ helpers
├── core/                  # Runtime coordination and system bootstrap
├── lua/                   # Lua syntax/runtime support
├── machine/               # CPU, memory, MMIO, devices, firmware, scheduler
├── render/                # C++ render backends and presentation edge
├── rompack/               # ROM package format/loaders
└── vendor/                # C/C++ third-party implementation files
```

The libretro core entrypoint lives in `hosts/libretro`. The local executable
that can run a libretro core lives in `hosts/libretro_host`.

## Architecture (Machine-first)

The C++ runtime focuses on mirroring the machine boundary from the TypeScript implementation.

- `machine/` owns CPU, memory, MMIO registers, device controllers, firmware, program loading, timing, and runtime state.
- `render/` and `audio/` contain the mirrored presentation datapaths used by
  concrete hosts.
- Physical input, frontend callbacks, media ownership, output buffers, and
  product lifecycle stay under `hosts/`; the machine consumes only its raw
  device-facing contracts.
- `audio/AudioOutputResampler` owns retained output-rate conversion. Buffering and underrun policy belong to browser and libretro output owners. The machine owns the continuous 44.1-kHz AOUT timeline next to the APU controller; source bytes, cursor/remainder, fade/filter/BADP state, mixing, END timing, and the presentation ring live under `machine/devices/audio`.

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
# - machine: libbmsx.a in this build directory
# - libretro core: libretro_bmsx.so (Linux), libretro_bmsx.dll (Windows), libretro_bmsx.dylib (macOS)
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

# Build the local libretro frontend executable (Linux)
cmake .. -DBMSX_BUILD_LIBRETRO_HOST=ON
```

## Architecture

### Host Boundary

There is no generic platform service locator in either runtime. The C++ render
presenter consumes the small mirrored `render/video_output.h` contract.
`hosts/libretro` owns concrete video, audio, input, media, diagnostics, and
libretro lifecycle directly. TypeScript products compose their concrete browser
or Node owners above the same machine-facing device and render boundaries.

### Key Patterns

1. **Machine-first ownership**: CPU, RAM/ROM, MMIO, device state, firmware, and save-state live under `machine/cpp/machine`.
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
