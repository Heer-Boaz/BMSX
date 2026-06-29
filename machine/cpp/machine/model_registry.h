#pragma once

#include "common/primitives.h"
#include "machine/runtime/timing/constants.h"

namespace bmsx {

// Console-model registry: the machine owns fixed hardware, device classes own
// throughput/programming-model parameters, and region is runtime timing state.
// Slice 24.1 intentionally populates only the psx model + psx VDP class.

enum class MachineModelId { Psx };
enum class MachineVdpClass { Psx };
enum class MachineRegion { Pal, Ntsc };

constexpr i64 PSX_CPU_FREQ_HZ = 50000000;
constexpr i64 PSX_IMGDEC_BYTES_PER_SEC = 26214400;
constexpr i64 PSX_DMA_BYTES_PER_SEC_ISO = 8388608;
constexpr i64 PSX_DMA_BYTES_PER_SEC_BULK = 26214400;
constexpr i64 PSX_RAM_BYTES = 0x08000000;
constexpr i64 PSX_VRAM_SLOT_BYTES = 167772160;
constexpr i64 PSX_VRAM_STAGING_BYTES = 41943040;
constexpr i32 PSX_BIOS_RENDER_WIDTH = 320;
constexpr i32 PSX_BIOS_RENDER_HEIGHT = 240;

constexpr i64 PSX_VDP_WORK_UNITS_PER_SEC = 25600;
constexpr i64 PSX_GEO_WORK_UNITS_PER_SEC = 16384000;

constexpr i64 PAL_REFRESH_UFPS_SCALED = 50 * HZ_SCALE;
constexpr i64 PAL_TOTAL_SCANLINES = 313;
constexpr i64 NTSC_REFRESH_UFPS_SCALED = 59940060;
constexpr i64 NTSC_TOTAL_SCANLINES = 262;

struct MachineModelProfile {
	MachineModelId model = MachineModelId::Psx;
	i64 cpuFreqHz = 0;
	i64 imgDecBytesPerSec = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
	i64 ramBytes = 0;
	i64 slotBytes = 0;
	i64 stagingBytes = 0;
	i32 biosRenderWidth = 0;
	i32 biosRenderHeight = 0;
};

struct MachineVdpClassProfile {
	MachineVdpClass vdpClass = MachineVdpClass::Psx;
	i64 vdpWorkUnitsPerSec = 0;
	i64 geoWorkUnitsPerSec = 0;
};

struct MachineRegionTiming {
	MachineRegion region = MachineRegion::Pal;
	i64 refreshUfpsScaled = 0;
	i64 totalScanlines = 0;
};

inline constexpr MachineModelProfile PSX_MODEL_PROFILE = {
	MachineModelId::Psx,
	PSX_CPU_FREQ_HZ,
	PSX_IMGDEC_BYTES_PER_SEC,
	PSX_DMA_BYTES_PER_SEC_ISO,
	PSX_DMA_BYTES_PER_SEC_BULK,
	PSX_RAM_BYTES,
	PSX_VRAM_SLOT_BYTES,
	PSX_VRAM_STAGING_BYTES,
	PSX_BIOS_RENDER_WIDTH,
	PSX_BIOS_RENDER_HEIGHT,
};

inline constexpr MachineVdpClassProfile PSX_VDP_CLASS_PROFILE = {
	MachineVdpClass::Psx,
	PSX_VDP_WORK_UNITS_PER_SEC,
	PSX_GEO_WORK_UNITS_PER_SEC,
};

MachineRegionTiming getMachineRegionTiming(MachineRegion region);

} // namespace bmsx
