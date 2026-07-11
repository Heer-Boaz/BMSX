#pragma once

#include "common/primitives.h"
#include "machine/runtime/timing/constants.h"

namespace bmsx {

// Console-model registry: the machine owns fixed PSX-class hardware, device
// throughput/programming-model parameters, and PSX GPU display timing state.

enum class MachineVdpClass { Psx };
enum class PsxGpuVideoStandard { Pal, Ntsc };

constexpr i64 PSX_CPU_FREQ_HZ = 50000000;
constexpr i64 PSX_DMA_BYTES_PER_SEC = 26214400;
constexpr i64 PSX_RAM_BYTES = 0x00400000;
constexpr i32 PSX_GPU_DISPLAY_WIDTH = 320;
constexpr i32 PSX_GPU_DISPLAY_HEIGHT = 240;

constexpr i64 PSX_GEO_WORK_UNITS_PER_SEC = 16384000;

constexpr i64 PAL_REFRESH_UFPS_SCALED = 50 * HZ_SCALE;
constexpr i64 PAL_TOTAL_SCANLINES = 313;
constexpr i64 NTSC_REFRESH_UFPS_SCALED = 59940060;
constexpr i64 NTSC_TOTAL_SCANLINES = 262;
constexpr uint32_t PSX_GPU_DISPLAY_MODE_NTSC_WORD = 0x00000000u;
constexpr uint32_t PSX_GPU_DISPLAY_MODE_PAL_BIT = 0x00000008u;
constexpr uint32_t PSX_GPU_DISPLAY_MODE_PAL_WORD = PSX_GPU_DISPLAY_MODE_PAL_BIT;

struct MachineModelSpec {
	i64 cpuFreqHz;
	i64 dmaBytesPerSec;
	i64 ramBytes;
	i64 geoWorkUnitsPerSec;
};

struct PsxGpuDisplaySizeSpec {
	i32 renderWidth;
	i32 renderHeight;
};

struct PsxGpuDisplayModeTiming {
	PsxGpuVideoStandard videoStandard;
	i64 refreshUfpsScaled;
	i64 totalScanlines;
};

inline constexpr MachineModelSpec PSX_MACHINE_SPEC = {
	PSX_CPU_FREQ_HZ,
	PSX_DMA_BYTES_PER_SEC,
	PSX_RAM_BYTES,
	PSX_GEO_WORK_UNITS_PER_SEC,
};

inline constexpr PsxGpuDisplaySizeSpec PSX_GPU_DISPLAY_SIZE_SPEC = {
	PSX_GPU_DISPLAY_WIDTH,
	PSX_GPU_DISPLAY_HEIGHT,
};

PsxGpuDisplayModeTiming getPsxGpuVideoStandardTiming(PsxGpuVideoStandard videoStandard);
PsxGpuDisplayModeTiming getPsxGpuDisplayModeTimingForWord(uint32_t word);

} // namespace bmsx
