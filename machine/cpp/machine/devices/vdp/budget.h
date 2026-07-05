#pragma once

#include "common/primitives.h"

namespace bmsx {

constexpr int VDP_RPU_PACKET_COST = 1;
constexpr int VDP_RPU_RESOURCE_COST = 2;
constexpr int VDP_RPU_PASS_COST = 8;
constexpr int VDP_RPU_DRAW_COST = 4;
constexpr int VDP_RPU_BIND_COST = 1;
constexpr int VDP_RPU_UPLOAD_COST = 2;
constexpr int VDP_RPU_DISCARD_COST = 1;
constexpr u32 VDP_RPU_UPLOAD_BYTE_DENSITY_DIVISOR = 256u;
constexpr u32 VDP_RPU_DRAW_VERTEX_DENSITY_DIVISOR = 64u;
constexpr u32 VDP_RPU_DRAW_INSTANCE_DENSITY_DIVISOR = 16u;
constexpr u32 VDP_RPU_DRAW_INDEX_DENSITY_DIVISOR = 64u;
// Fill-rate proxy: a pass is charged for the pixels its viewport covers, so
// clears and fullscreen passes carry a fill cost that plain draw-call counting
// misses. Estimated at submit from the pass viewport (integer, O(1) per pass) —
// never per rasterized pixel, so it stays cheap on the GLES2/SNES-mini target.
// Divisor = viewport pixels per fill work-unit; tune to set the overdraw ceiling
// (4096 -> a 320x240 pass costs ~19 units of the ~427/frame NTSC budget).
constexpr u32 VDP_RPU_PASS_FILL_PIXEL_DENSITY_DIVISOR = 4096u;

inline int rpuWorkBucket(u32 workUnits, u32 densityDivisor) {
	if (workUnits == 0u) {
		return 0;
	}
	const u32 work = workUnits + densityDivisor - 1u;
	return static_cast<int>((work - (work % densityDivisor)) / densityDivisor);
}

inline int rpuUploadCost(u32 byteLength) {
	return VDP_RPU_UPLOAD_COST + rpuWorkBucket(byteLength, VDP_RPU_UPLOAD_BYTE_DENSITY_DIVISOR);
}

inline int rpuPassFillCost(u32 viewportWH) {
	const u32 width = viewportWH & 0xffffu;
	const u32 height = (viewportWH >> 16) & 0xffffu;
	return rpuWorkBucket(width * height, VDP_RPU_PASS_FILL_PIXEL_DENSITY_DIVISOR);
}

inline int rpuDrawCost(u32 vertexCount, u32 instanceCount, u32 indexCount) {
	return VDP_RPU_DRAW_COST
		+ rpuWorkBucket(vertexCount, VDP_RPU_DRAW_VERTEX_DENSITY_DIVISOR)
		+ rpuWorkBucket(instanceCount, VDP_RPU_DRAW_INSTANCE_DENSITY_DIVISOR)
		+ rpuWorkBucket(indexCount, VDP_RPU_DRAW_INDEX_DENSITY_DIVISOR);
}

} // namespace bmsx
