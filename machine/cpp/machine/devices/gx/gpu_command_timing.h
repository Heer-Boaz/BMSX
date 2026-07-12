#pragma once

#include "machine/devices/gx/gpu_command_buffer.h"

namespace bmsx {

constexpr i64 GX_GPU_COMMAND_TICKS_PER_CPU_CYCLE = 2;

i64 gxGpuCommandTicks(
	u8 kind,
	u8 opcode,
	const u32* words,
	size_t wordStart,
	u32 wordCount,
	u32 drawModeWord,
	u32 drawingAreaTopLeftWord,
	u32 drawingAreaBottomRightWord,
	u32 drawingOffsetWord,
	u32 maskBitModeWord,
	u8 interlacedRenderWord);

} // namespace bmsx
