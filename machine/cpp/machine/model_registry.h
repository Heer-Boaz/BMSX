#pragma once

#include "common/primitives.h"
#include "machine/runtime/timing/constants.h"

namespace bmsx {

// Console-model registry: the machine owns fixed hardware, device classes own
// throughput/programming-model parameters, and region is runtime timing state.
// Slice 24.1 intentionally populates only the psx model + psx VDP class.

enum class MachineVdpClass { Psx };
enum class MachineVdpMode : u32 { Msx1 = 0u, Msx2 = 1u, Psx = 2u };
enum class MachineRegion { Pal, Ntsc };

constexpr i64 PSX_CPU_FREQ_HZ = 50000000;
constexpr i64 PSX_IMGDEC_BYTES_PER_SEC = 26214400;
constexpr i64 PSX_DMA_BYTES_PER_SEC_ISO = 8388608;
constexpr i64 PSX_DMA_BYTES_PER_SEC_BULK = 26214400;
constexpr i64 PSX_RAM_BYTES = 0x00400000;
constexpr i64 PSX_VRAM_TEXTURE_BYTES = 0x00200000;
constexpr i64 PSX_VRAM_STAGING_BYTES = 0x00022000;
constexpr u32 VDP_MODE_MSX1_WORD = 0u;
constexpr u32 VDP_MODE_MSX2_WORD = 1u;
constexpr u32 VDP_MODE_PSX_WORD = 2u;
constexpr i32 VDP_MODE_MSX1_RENDER_WIDTH = 256;
constexpr i32 VDP_MODE_MSX1_RENDER_HEIGHT = 192;
constexpr i32 VDP_MODE_MSX2_RENDER_WIDTH = 256;
constexpr i32 VDP_MODE_MSX2_RENDER_HEIGHT = 212;
constexpr i32 VDP_MODE_PSX_RENDER_WIDTH = 320;
constexpr i32 VDP_MODE_PSX_RENDER_HEIGHT = 240;


constexpr i64 PSX_VDP_WORK_UNITS_PER_SEC = 25600;
constexpr i64 PSX_GEO_WORK_UNITS_PER_SEC = 16384000;

constexpr i64 PAL_REFRESH_UFPS_SCALED = 50 * HZ_SCALE;
constexpr i64 PAL_TOTAL_SCANLINES = 313;
constexpr i64 NTSC_REFRESH_UFPS_SCALED = 59940060;
constexpr i64 NTSC_TOTAL_SCANLINES = 262;
constexpr uint32_t MACHINE_REGION_PAL_WORD = 0;
constexpr uint32_t MACHINE_REGION_NTSC_WORD = 1;

struct MachineModelProfile {
	i64 cpuFreqHz;
	i64 imgDecBytesPerSec;
	i64 dmaBytesPerSecIso;
	i64 dmaBytesPerSecBulk;
	i64 ramBytes;
	i64 textureBytes;
	i64 stagingBytes;
	MachineVdpMode biosVdpMode;
};

struct MachineVdpClassProfile {
	i64 vdpWorkUnitsPerSec;
	i64 geoWorkUnitsPerSec;
};

struct MachineVdpModeProfile {
	MachineVdpMode mode;
	i32 renderWidth;
	i32 renderHeight;
};

struct MachineRegionTiming {
	MachineRegion region;
	i64 refreshUfpsScaled;
	i64 totalScanlines;
};

inline constexpr MachineModelProfile PSX_MODEL_PROFILE = {
	PSX_CPU_FREQ_HZ,
	PSX_IMGDEC_BYTES_PER_SEC,
	PSX_DMA_BYTES_PER_SEC_ISO,
	PSX_DMA_BYTES_PER_SEC_BULK,
	PSX_RAM_BYTES,
	PSX_VRAM_TEXTURE_BYTES,
	PSX_VRAM_STAGING_BYTES,
	MachineVdpMode::Psx,
};

inline constexpr MachineVdpClassProfile PSX_VDP_CLASS_PROFILE = {
	PSX_VDP_WORK_UNITS_PER_SEC,
	PSX_GEO_WORK_UNITS_PER_SEC,
};

inline constexpr MachineVdpModeProfile VDP_MODE_MSX1_PROFILE = {
	MachineVdpMode::Msx1,
	VDP_MODE_MSX1_RENDER_WIDTH,
	VDP_MODE_MSX1_RENDER_HEIGHT,
};

inline constexpr MachineVdpModeProfile VDP_MODE_MSX2_PROFILE = {
	MachineVdpMode::Msx2,
	VDP_MODE_MSX2_RENDER_WIDTH,
	VDP_MODE_MSX2_RENDER_HEIGHT,
};

inline constexpr MachineVdpModeProfile VDP_MODE_PSX_PROFILE = {
	MachineVdpMode::Psx,
	VDP_MODE_PSX_RENDER_WIDTH,
	VDP_MODE_PSX_RENDER_HEIGHT,
};

const MachineVdpModeProfile& getMachineVdpModeProfile(MachineVdpMode mode);
MachineRegionTiming getMachineRegionTiming(MachineRegion region);
MachineRegionTiming getMachineRegionTimingForWord(uint32_t word);

} // namespace bmsx
