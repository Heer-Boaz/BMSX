#pragma once

#include "common/primitives.h"

namespace bmsx {

class Memory;

constexpr u32 GX_GPU_GP1_RESET = 0x00u;
constexpr u32 GX_GPU_GP1_SET_DISPLAY_MODE = 0x08u;
constexpr u32 GX_GPU_GP1_OPCODE_SHIFT = 24u;
constexpr u32 GX_GPU_GP1_PARAM_MASK = 0x00ffffffu;

constexpr u32 GX_GPU_STATUS_REVERSE_FLAG = 1u << 14u;
constexpr u32 GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2 = 1u << 16u;
constexpr u32 GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT = 17u;
constexpr u32 GX_GPU_STATUS_VERTICAL_RESOLUTION = 1u << 19u;
constexpr u32 GX_GPU_STATUS_PAL_MODE = 1u << 20u;
constexpr u32 GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24 = 1u << 21u;
constexpr u32 GX_GPU_STATUS_VERTICAL_INTERLACE = 1u << 22u;
constexpr u32 GX_GPU_STATUS_GPU_IDLE = 1u << 26u;
constexpr u32 GX_GPU_STATUS_READY_TO_SEND_VRAM = 1u << 27u;
constexpr u32 GX_GPU_STATUS_READY_TO_RECEIVE_DMA = 1u << 28u;
constexpr u32 GX_GPU_STATUS_READY_WORD = GX_GPU_STATUS_GPU_IDLE | GX_GPU_STATUS_READY_TO_SEND_VRAM | GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
constexpr u32 GX_GPU_STATUS_DISPLAY_MODE_MASK = GX_GPU_STATUS_REVERSE_FLAG
	| GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
	| (0x3u << GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT)
	| GX_GPU_STATUS_VERTICAL_RESOLUTION
	| GX_GPU_STATUS_PAL_MODE
	| GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
	| GX_GPU_STATUS_VERTICAL_INTERLACE;

struct GxGpuState {
	u32 gp0Word = 0;
	u32 gp1Word = 0;
	u32 displayModeWord = 0;
	u32 statusWord = 0;
};

class GxGpu {
public:
	explicit GxGpu(Memory& memory);
	void reset();
	GxGpuState captureState() const;
	void restoreState(const GxGpuState& state);
	u32 readGp0() const;
	void writeGp0(u32 word);
	u32 readStatus() const;
	u32 writeGp1(u32 word);
	u32 readDisplayModeWord() const;
	void writeDisplayModeWord(u32 word);

private:
	Memory& m_memory;
	u32 m_gp0Word = 0;
	u32 m_gp1Word = 0;
	u32 m_displayModeWord = 0;
	u32 m_statusWord = GX_GPU_STATUS_READY_WORD;

	void updateDisplayModeStatusBits();
	static u64 readGp0Thunk(void* context, u32 addr);
	static void writeGp0Thunk(void* context, u32 addr, u64 value);
	static u64 readStatusThunk(void* context, u32 addr);
	static void writeGp1Thunk(void* context, u32 addr, u64 value);
};

} // namespace bmsx
