#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/gpu_command_buffer.h"

#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t kGxGpuSoftwareVramWords = static_cast<size_t>(GX_GPU_VRAM_WIDTH) * static_cast<size_t>(GX_GPU_VRAM_HEIGHT);

extern std::array<u16, kGxGpuSoftwareVramWords> g_gxGpuSoftwareVram;

void resetGxGpuSoftwareVram();
size_t gxGpuSoftwareVramIndex(i32 x, i32 y);
u16 gxGpuSoftwareRgb888WordToRgb555(u32 word);
u8 gxGpuSoftwareRgb555ChannelTo8(u32 channel);
u32 gxGpuSoftwareTextureModulationPreDither(u32 texture5, u32 vertex8);
u32 gxGpuSoftwareTextureModulationChannel5(u32 texture5, u32 vertex8, i32 ditherOffset);
void gxGpuSoftwareWriteMaskedVramWord(size_t index, u32 word, u32 maskBitModeWord);
void gxGpuSoftwareWriteRenderVramPixel5(i32 x, i32 y, u32 r5, u32 g5, u32 b5, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, u32 outputMaskBit);
void gxGpuSoftwareWriteRenderVramPixel(i32 x, i32 y, u32 r8, u32 g8, u32 b8, bool ditherEnabled, bool blendEnabled, u32 blendMode, u32 maskBitModeWord);
i32 gxGpuSoftwareDitherOffset(i32 x, i32 y);
bool gxGpuSoftwareInterlacedSkipsLine(i32 y, u32 interlacedRenderWord);

} // namespace bmsx
