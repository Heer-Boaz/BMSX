#pragma once

#include "common/primitives.h"
#include "machine/runtime/timing/constants.h"

namespace bmsx {

// Console-model registry: the machine owns fixed PSX-class hardware, device
// throughput/programming-model parameters, and PSX GPU display timing state.

enum class MachineVdpClass { Psx };
enum class PsxGpuVideoStandard { Pal, Ntsc };

constexpr i64 PSX_CPU_FREQ_HZ = 50000000;
constexpr i64 PSX_DMA_WORDS_PER_SEC = 6553600;
constexpr i64 PSX_RAM_BYTES = 0x00400000;
constexpr i32 PSX_GPU_MAX_DISPLAY_WIDTH = 640;
constexpr i32 PSX_GPU_MAX_DISPLAY_HEIGHT = 480;
constexpr i32 PSX_GPU_DISPLAY_ASPECT_WIDTH = 4;
constexpr i32 PSX_GPU_DISPLAY_ASPECT_HEIGHT = 3;

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
	i64 dmaWordsPerSec;
	i64 ramBytes;
	i64 geoWorkUnitsPerSec;
};

struct PsxGpuDisplayModeTiming {
	PsxGpuVideoStandard videoStandard;
	i64 refreshUfpsScaled;
	i64 totalScanlines;
};

inline constexpr MachineModelSpec PSX_MACHINE_SPEC = {
	PSX_CPU_FREQ_HZ,
	PSX_DMA_WORDS_PER_SEC,
	PSX_RAM_BYTES,
	PSX_GEO_WORK_UNITS_PER_SEC,
};

PsxGpuDisplayModeTiming getPsxGpuVideoStandardTiming(PsxGpuVideoStandard videoStandard);
PsxGpuDisplayModeTiming getPsxGpuDisplayModeTimingForWord(uint32_t word);

} // namespace bmsx
