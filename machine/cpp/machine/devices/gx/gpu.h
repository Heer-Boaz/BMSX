#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/device_output.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/gx/gpu_command_fifo.h"
#include "machine/devices/gx/gpu_display.h"

#include <array>
#include <vector>

namespace bmsx {

class Memory;
class DeviceScheduler;
class IrqController;

constexpr u32 GX_GPU_GP1_RESET = 0x00u;
constexpr u32 GX_GPU_GP1_CLEAR_FIFO = 0x01u;
constexpr u32 GX_GPU_GP1_ACK_INTERRUPT = 0x02u;
constexpr u32 GX_GPU_GP1_DISPLAY_DISABLE = 0x03u;
constexpr u32 GX_GPU_GP1_DMA_DIRECTION = 0x04u;
constexpr u32 GX_GPU_GP1_DISPLAY_START = 0x05u;
constexpr u32 GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE = 0x06u;
constexpr u32 GX_GPU_GP1_VERTICAL_DISPLAY_RANGE = 0x07u;
constexpr u32 GX_GPU_GP1_DISPLAY_MODE = 0x08u;
constexpr u32 GX_GPU_GP1_ALLOW_TEXTURE_DISABLE = 0x09u;
constexpr u32 GX_GPU_GP1_GET_GPU_INFO = 0x10u;
constexpr u32 GX_GPU_GP1_GET_GPU_INFO_LAST = 0x1fu;
constexpr u32 GX_GPU_GP1_OPCODE_SHIFT = 24u;
constexpr u32 GX_GPU_GP1_PARAM_MASK = 0x00ffffffu;
constexpr u32 GX_GPU_GP1_OPCODE_MASK = 0x3fu;
constexpr u32 GX_GPU_GP1_GET_GPU_INFO_INDEX_MASK = 0x0fu;
constexpr u32 GX_GPU_INFO_GPU_TYPE_208PIN = 0x00000002u;

constexpr u32 GX_GPU_GP0_DRAW_MODE = 0xe1u;
constexpr u32 GX_GPU_GP0_TEXTURE_WINDOW = 0xe2u;
constexpr u32 GX_GPU_GP0_DRAWING_AREA_TOP_LEFT = 0xe3u;
constexpr u32 GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT = 0xe4u;
constexpr u32 GX_GPU_GP0_DRAWING_OFFSET = 0xe5u;
constexpr u32 GX_GPU_GP0_MASK_BIT = 0xe6u;
constexpr u32 GX_GPU_GP0_IRQ_REQUEST = 0x1fu;
constexpr u32 GX_GPU_GP0_OPCODE_SHIFT = 24u;
constexpr u32 GX_GPU_GP0_PARAM_MASK = 0x00ffffffu;
constexpr u32 GX_GPU_GP0_FILL_RECTANGLE = 0x02u;
constexpr u32 GX_GPU_GP0_POLYGON_FIRST = 0x20u;
constexpr u32 GX_GPU_GP0_POLYGON_LAST = 0x3fu;
constexpr u32 GX_GPU_GP0_LINE_FIRST = 0x40u;
constexpr u32 GX_GPU_GP0_LINE_LAST = 0x5fu;
constexpr u32 GX_GPU_GP0_RECTANGLE_FIRST = 0x60u;
constexpr u32 GX_GPU_GP0_RECTANGLE_LAST = 0x7fu;
constexpr u32 GX_GPU_GP0_VRAM_TO_VRAM_FIRST = 0x80u;
constexpr u32 GX_GPU_GP0_VRAM_TO_VRAM_LAST = 0x9fu;
constexpr u32 GX_GPU_GP0_CPU_TO_VRAM_FIRST = 0xa0u;
constexpr u32 GX_GPU_GP0_CPU_TO_VRAM_LAST = 0xbfu;
constexpr u32 GX_GPU_GP0_VRAM_TO_CPU_FIRST = 0xc0u;
constexpr u32 GX_GPU_GP0_VRAM_TO_CPU_LAST = 0xdfu;
constexpr u32 GX_GPU_GP0_RENDER_TEXTURE_BIT = 0x04u;
constexpr u32 GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT = 0x08u;
constexpr u32 GX_GPU_GP0_RENDER_GOURAUD_BIT = 0x10u;
constexpr u32 GX_GPU_GP0_RECTANGLE_SIZE_MASK = 0x18u;
constexpr u32 GX_GPU_GP0_COMMAND_BUFFER_WORDS = 16u;
constexpr u32 GX_GPU_VRAM_WIDTH_MASK = 0x3ffu;
constexpr u32 GX_GPU_VRAM_HEIGHT_MASK = 0x1ffu;

constexpr u32 GX_GPU_DISPLAY_START_MASK = 0x0007fffeu;
constexpr u32 GX_GPU_DISPLAY_MODE_MASK = 0x000000ffu;
constexpr u32 GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK = 0x00ffffffu;
constexpr u32 GX_GPU_VERTICAL_DISPLAY_RANGE_MASK = 0x000fffffu;
constexpr u32 GX_GPU_DRAW_MODE_MASK = 0x00003fffu;
constexpr u32 GX_GPU_DRAW_MODE_GPUSTAT_MASK = 0x000007ffu;
constexpr u32 GX_GPU_TEXTURE_WINDOW_MASK = 0x000fffffu;
constexpr u32 GX_GPU_DRAWING_AREA_MASK = 0x000fffffu;
constexpr u32 GX_GPU_DRAWING_OFFSET_MASK = 0x003fffffu;
constexpr u32 GX_GPU_MASK_BIT_MODE_MASK = 0x3u;

constexpr u32 GX_GPU_DMA_DIRECTION_OFF = 0u;
constexpr u32 GX_GPU_DMA_DIRECTION_FIFO = 1u;
constexpr u32 GX_GPU_DMA_DIRECTION_CPU_TO_GP0 = 2u;
constexpr u32 GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU = 3u;

constexpr u32 GX_GPU_STATUS_INTERLACED_FIELD = 1u << 13u;
constexpr u32 GX_GPU_STATUS_REVERSE_FLAG = 1u << 14u;
constexpr u32 GX_GPU_STATUS_TEXTURE_DISABLE = 1u << 15u;
constexpr u32 GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2 = 1u << 16u;
constexpr u32 GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT = 17u;
constexpr u32 GX_GPU_STATUS_VERTICAL_RESOLUTION = 1u << 19u;
constexpr u32 GX_GPU_STATUS_PAL_MODE = 1u << 20u;
constexpr u32 GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24 = 1u << 21u;
constexpr u32 GX_GPU_STATUS_VERTICAL_INTERLACE = 1u << 22u;
constexpr u32 GX_GPU_STATUS_DISPLAY_DISABLE = 1u << 23u;
constexpr u32 GX_GPU_STATUS_INTERRUPT_REQUEST = 1u << 24u;
constexpr u32 GX_GPU_STATUS_DMA_DATA_REQUEST = 1u << 25u;
constexpr u32 GX_GPU_STATUS_GPU_IDLE = 1u << 26u;
constexpr u32 GX_GPU_STATUS_READY_TO_SEND_VRAM = 1u << 27u;
constexpr u32 GX_GPU_STATUS_READY_TO_RECEIVE_DMA = 1u << 28u;
constexpr u32 GX_GPU_STATUS_DMA_DIRECTION_SHIFT = 29u;
constexpr u32 GX_GPU_STATUS_DMA_DIRECTION_MASK = 0x3u << GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
constexpr u32 GX_GPU_STATUS_DISPLAY_LINE_LSB = 1u << 31u;
constexpr u32 GX_GPU_STATUS_COMMAND_STATE_MASK = GX_GPU_STATUS_GPU_IDLE
	| GX_GPU_STATUS_READY_TO_SEND_VRAM
	| GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
constexpr u32 GX_GPU_STATUS_RESET_WORD = GX_GPU_STATUS_INTERLACED_FIELD
	| GX_GPU_STATUS_DISPLAY_DISABLE
	| GX_GPU_STATUS_GPU_IDLE
	| GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
constexpr u32 GX_GPU_STATUS_SCANOUT_MASK = GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB;
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
	u32 gp0CommandWordCount = 0;
	u32 gp0CommandTargetWordCount = 0;
	std::vector<u32> gp0CommandWords;
	size_t gp0FifoWordCount = 0u;
	std::array<u32, GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY> gp0FifoWords{};
	i64 pendingCommandCycles = 0;
	size_t pendingCommandTargetCount = 0u;
	u32 gp0ImageLoadWordsRemaining = 0;
	size_t gp0ImageLoadCommandWordStart = 0;
	u32 gp0ImageLoadCommandWordCount = 0;
	u8 gp0ImageLoadCommandOpcode = 0;
	u32 gp0PolylineWordsPerVertex = 0;
	u32 gp0PolylinePayloadPhase = 0;
	size_t gp0PolylineCommandWordStart = 0;
	u32 gp0PolylineCommandWordCount = 0;
	u8 gp0PolylineCommandOpcode = 0;
	u32 gpuReadWord = 0;
	u32 drawModeWord = 0;
	u32 textureWindowWord = 0;
	u32 drawingAreaTopLeftWord = 0;
	u32 drawingAreaBottomRightWord = 0;
	u32 drawingOffsetWord = 0;
	u32 maskBitModeWord = 0;
	u32 displayStartWord = 0;
	u32 horizontalDisplayRangeWord = 0;
	u32 verticalDisplayRangeWord = 0;
	u32 textureDisableAllowedWord = 0;
	u32 scanoutInterlacedField = 0;
	u32 scanoutInterlacedDisplayField = 0;
	u32 scanoutActiveLineLsb = 0;
	u32 presentStatusWord = 0;
	u32 presentDisplayModeWord = 0;
	u32 presentDisplayStartWord = 0;
	u32 presentHorizontalDisplayRangeWord = 0;
	u32 presentVerticalDisplayRangeWord = 0;
	GxGpuCommandBufferState commandBuffer;
};

struct GxGpuSaveState : GxGpuState {
	std::vector<u8> vramBytes;
};

class GxGpu {
public:
	GxGpu(Memory& memory, IrqController& irq, DeviceScheduler& scheduler, DmaController& dmaController);
	void reset();
	GxGpuState captureState() const;
	void restoreState(const GxGpuState& state);
	GxGpuSaveState captureSaveState() const;
	void restoreSaveState(const GxGpuSaveState& state);
	void replaceVramSnapshotBytes(const u8* bytes);
	u32 commitRenderedVramSnapshotBytes(const u8* bytes);
	const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& readVramSnapshotBytes() const { return m_vramSnapshotBytes; }
	u32 readVramSnapshotSerial() const { return m_vramSnapshotSerial; }
	u32 readGp0();
	void writeGp0(u32 word);
	u32 readStatus();
	u32 writeGp1(u32 word);
	void onService(i64 nowCycles);
	u32 readDisplayModeWord() const;
	void writeDisplayModeWord(u32 word);
	void setScanoutTiming(bool vblankActive, int cyclesIntoFrame, int cyclesPerFrame, int totalScanlines);
	u32 readGpuReadWord() const;
	const GxGpuDeviceOutput& readDeviceOutput();
	void presentReadyFrameOnVblankEdge();
	bool lastFrameCommitted() const { return m_lastFrameCommitted; }
	void retirePresentedCommands();
	u32 readDrawModeWord() const;
	u32 readTextureWindowWord() const;
	u32 readDrawingAreaTopLeftWord() const;
	u32 readDrawingAreaBottomRightWord() const;
	u32 readDrawingOffsetWord() const;
	u32 readMaskBitModeWord() const;
	u32 readDisplayStartWord() const;
	u32 readHorizontalDisplayRangeWord() const;
	u32 readVerticalDisplayRangeWord() const;
	u32 readTextureDisableAllowedWord() const;

private:
	Memory& m_memory;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	DmaController& m_dmaController;
	u32 m_gp0Word = 0;
	u32 m_gp1Word = 0;
	u32 m_displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	u32 m_statusWord = GX_GPU_STATUS_RESET_WORD;
	GxGpuCommandFifo m_gp0Fifo;
	i64 m_pendingCommandCompletionCycle = 0;
	size_t m_pendingCommandTargetCount = 0u;
	GxGpuCommandBuffer m_commandBuffer;
	mutable GxGpuDeviceOutput m_deviceOutput{&m_commandBuffer, &m_commandBuffer.readback};
	std::array<u32, GX_GPU_GP0_COMMAND_BUFFER_WORDS> m_gp0CommandWords{};
	u32 m_gp0CommandWordCount = 0u;
	u32 m_gp0CommandTargetWordCount = 0u;
	u32 m_gp0ImageLoadWordsRemaining = 0u;
	size_t m_gp0ImageLoadCommandWordStart = 0u;
	u32 m_gp0ImageLoadCommandWordCount = 0u;
	u8 m_gp0ImageLoadCommandOpcode = 0u;
	u32 m_gp0PolylineWordsPerVertex = 0u;
	u32 m_gp0PolylinePayloadPhase = 0u;
	size_t m_gp0PolylineCommandWordStart = 0u;
	u32 m_gp0PolylineCommandWordCount = 0u;
	u8 m_gp0PolylineCommandOpcode = 0u;
	u32 m_gpuReadWord = 0u;
	u32 m_drawModeWord = 0u;
	u32 m_textureWindowWord = 0u;
	u32 m_drawingAreaTopLeftWord = 0u;
	u32 m_drawingAreaBottomRightWord = 0u;
	u32 m_drawingOffsetWord = 0u;
	u32 m_maskBitModeWord = 0u;
	u32 m_displayStartWord = 0u;
	u32 m_horizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	u32 m_verticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	u32 m_textureDisableAllowedWord = 0u;
	u32 m_presentStatusWord = GX_GPU_STATUS_RESET_WORD;
	u32 m_presentDisplayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	u32 m_presentDisplayStartWord = 0u;
	u32 m_presentHorizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	u32 m_presentVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	bool m_lastFrameCommitted = false;
	bool m_scanoutVblankActive = false;
	u32 m_scanoutInterlacedField = 0u;
	u32 m_scanoutInterlacedDisplayField = 0u;
	u32 m_scanoutActiveLineLsb = 0u;
	i64 m_scanoutFrameStartCycle = 0;
	int m_scanoutCyclesPerFrame = 1;
	int m_scanoutTotalScanlines = 313;
	std::array<u8, GX_GPU_VRAM_BYTE_COUNT> m_vramSnapshotBytes{};
	u32 m_vramSnapshotSerial = 0u;

	void resetGpuRegisters();
	void writeDisplayDisableWord(u32 word);
	void clearGp0CommandState();
	void clearGp0Fifo(i64 nowCycles);
	void clearPolylineState();
	void clearImageLoadState();
	void finishImageLoadToVram(i64 commandStartCycle);
	void flushImageLoadToVram(i64 commandStartCycle);
	void consumeImageLoadWord(u32 word, i64 commandStartCycle);
	void consumeGp0PolylinePayloadWord(u32 word, i64 commandStartCycle);
	void beginPolylinePayload(u32 opcode, u32 commandWordCount);
	void consumeGp0Fifo(i64 commandStartCycle);
	void synchronizeCommandExecution(i64 nowCycles);
	void beginCommandCompletion(i64 commandTicks, size_t targetCommandCount, i64 commandStartCycle);
	void executeGp0Command(i64 commandStartCycle);
	u32 gp0CommandWordCountForOpcode(u32 opcode) const;
	u32 gp0PolygonWordCount(u32 opcode) const;
	u32 gp0LineWordCount(u32 opcode) const;
	u32 gp0RectangleWordCount(u32 opcode) const;
	void emitFixedGp0Command(u8 kind, u32 opcode, u32 commandWordCount, i64 commandStartCycle);
	void pushGpuCommand(u8 kind, u32 opcode, size_t wordStart, u32 commandWordCount, i64 commandStartCycle);
	void beginImageLoadToVram(u32 opcode, u32 commandWordCount);
	void writeDrawModeWord(u32 word);
	void updateDrawModeStatusBits();
	void writeMaskBitModeWord(u32 word);
	void writeGpuInfoQuery(u32 word);
	void writeDmaDirectionWord(u32 word);
	void updateCommandStatusBits();
	void updateDynamicStatusBits();
	void updateDmaRequestStatusBit();
	bool gpuStatInInterleaved480iMode() const;
	int scanoutLine() const;
	void updateScanoutStatusBits();
	void updateDisplayModeStatusBits();
	void writeStatusIo();
	bool gp0WriteReady();
	static u64 readGp0Thunk(void* context, u32 addr);
	static void writeGp0Thunk(void* context, u32 addr, u64 value);
	static bool gp0WriteReadyThunk(void* context, u32 addr);
	static u64 readStatusThunk(void* context, u32 addr);
	static void writeGp1Thunk(void* context, u32 addr, u64 value);
};

} // namespace bmsx
