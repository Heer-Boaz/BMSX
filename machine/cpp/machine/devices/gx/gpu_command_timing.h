#pragma once

#include "machine/devices/gx/gpu_packet.h"

#include <cstddef>

namespace bmsx {

constexpr i64 GX_GPU_COMMAND_TICKS_PER_CPU_CYCLE = 2;

void prepareGpuPacket(GxGpuPacket& packet, u32 wordCount, GxGpuDrawState& projectedState, u8 kindOverride = 0u, u8 opcodeOverride = 0u);
void retimeGpuPacket(GxGpuPacket& packet, GxGpuDrawState& projectedState);
i64 gxGpuPacketTicks(u8 kind, u8 opcode, const u32* words, size_t wordStart,
	u32 vertexCount, u8 positionStride, u32 sizeOffset, const GxGpuDrawState& state);

} // namespace bmsx
