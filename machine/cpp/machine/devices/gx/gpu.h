#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/device_output.h"
#include "spec/gx/gp0.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/devices/word_fifo.h"
#include "machine/memory/bus_signals.h"

#include <array>
#include <memory>
#include <vector>

namespace bmsx {

constexpr u32 GX_GPU_SERVICE_RUNTIME_EDGE_MASK = 0x3u;
constexpr u32 GX_GPU_SERVICE_TIMING_PUBLISHED = 1u << 2u;

constexpr u32 GX_GPU_GP0_INGRESS_COMMAND = 0u;
constexpr u32 GX_GPU_GP0_INGRESS_FIXED = 1u;
constexpr u32 GX_GPU_GP0_INGRESS_IMAGE_HEADER = 2u;
constexpr u32 GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD = 3u;
constexpr u32 GX_GPU_GP0_INGRESS_POLYLINE_HEADER = 4u;
constexpr u32 GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD = 5u;

class Memory;
class CPU;
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
constexpr u32 GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION = 0x09u;
constexpr u32 GX_GPU_GP1_GET_GPU_INFO = 0x10u;
constexpr u32 GX_GPU_GP1_GET_GPU_INFO_LAST = 0x1fu;
constexpr u32 GX_GPU_GP1_OPCODE_SHIFT = 24u;
constexpr u32 GX_GPU_GP1_PARAM_MASK = 0x00ffffffu;
constexpr u32 GX_GPU_GP1_GET_GPU_INFO_INDEX_MASK = 0x0fu;
constexpr u32 GX_GPU_INFO_GPU_TYPE_V2 = 0x00000002u;

constexpr u32 GX_GPU_DISPLAY_START_MASK = 0x000ffffeu;
constexpr u32 GX_GPU_DISPLAY_MODE_MASK = 0x000000ffu;
constexpr u32 GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK = 0x00ffffffu;
constexpr u32 GX_GPU_VERTICAL_DISPLAY_RANGE_MASK = 0x000fffffu;
constexpr u32 GX_GPU_DRAW_MODE_MASK = 0x00003fffu;
constexpr u32 GX_GPU_DRAW_MODE_GPUSTAT_MASK = 0x000007ffu;
constexpr u32 GX_GPU_TEXTURE_WINDOW_MASK = 0x000fffffu;
constexpr u32 GX_GPU_DRAWING_AREA_MASK = 0x000fffffu;
constexpr u32 GX_GPU_DRAWING_OFFSET_MASK = 0x003fffffu;
constexpr u32 GX_GPU_MASK_BIT_MODE_MASK = 0x3u;

constexpr u32 GX_GPU_STATUS_INTERLACED_FIELD = 1u << 13u;
constexpr u32 GX_GPU_STATUS_REVERSE_FLAG = 1u << 14u;
constexpr u32 GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH = 1u << 15u;
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

struct GxGpuRegisterContextState {
	u32 gp0Word = 0;
	u32 gp1Word = 0;
	u32 displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	u32 statusWord = GX_GPU_STATUS_RESET_WORD;
	u32 gpuReadWord = 0;
	u32 drawModeWord = 0;
	u32 textureWindowWord = 0;
	u32 drawingAreaTopLeftWord = 0;
	u32 drawingAreaBottomRightWord = 0;
	u32 drawingOffsetWord = 0;
	u32 maskBitModeWord = 0;
	u32 displayStartWord = 0;
	u32 horizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	u32 verticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	u32 vramYAddressExtensionWord = 0;
	u32 presentStatusWord = GX_GPU_STATUS_RESET_WORD;
	u32 presentDisplayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	u32 presentDisplayStartWord = 0;
	u32 presentVramYAddressExtensionWord = 0;
	u32 presentHorizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	u32 presentVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT> pcrtcRegisterWords{};
	std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT> pcrtcPresentWords{};
	bool vramPresentationPending = false;
};

struct GxGpuIngressContextState {
	u32 gp0CommandTargetWordCount = 0u;
	std::vector<u32> gp0CommandWords;
	u32 gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
	u32 gp0IngressWordsRemaining = 0u;
	u32 gp0IngressPolylineWordsPerVertex = 0u;
	u32 gp0IngressPolylinePayloadPhase = 0u;
	u32 gp0ImageLoadWordsRemaining = 0u;
	size_t gp0ImageLoadCommandWordStart = 0u;
	u32 gp0ImageLoadCommandWordCount = 0u;
	u8 gp0ImageLoadCommandOpcode = 0u;
	u32 gp0PolylineWordsPerVertex = 0u;
	u32 gp0PolylinePayloadPhase = 0u;
	size_t gp0PolylineCommandWordStart = 0u;
	u32 gp0PolylineCommandWordCount = 0u;
	u8 gp0PolylineCommandOpcode = 0u;
	std::vector<u32> commandBufferWords;
};

struct GxGpuIngressContextBank {
	u32 gp0CommandTargetWordCount = 0u;
	u32 gp0CommandWordCount = 0u;
	std::array<u32, GX_GPU_GP0_COMMAND_BUFFER_WORDS> gp0CommandWords{};
	u32 gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
	u32 gp0IngressWordsRemaining = 0u;
	u32 gp0IngressPolylineWordsPerVertex = 0u;
	u32 gp0IngressPolylinePayloadPhase = 0u;
	u32 gp0ImageLoadWordsRemaining = 0u;
	size_t gp0ImageLoadCommandWordStart = 0u;
	u32 gp0ImageLoadCommandWordCount = 0u;
	u8 gp0ImageLoadCommandOpcode = 0u;
	u32 gp0PolylineWordsPerVertex = 0u;
	u32 gp0PolylinePayloadPhase = 0u;
	size_t gp0PolylineCommandWordStart = 0u;
	u32 gp0PolylineCommandWordCount = 0u;
	u8 gp0PolylineCommandOpcode = 0u;
	size_t commandBufferWordCount = 0u;
	std::unique_ptr<std::array<u32, GX_GPU_COMMAND_WORD_CAPACITY>> commandBufferWords;
};

struct GxGpuState {
	u32 gp0Word = 0;
	u32 gp1Word = 0;
	u32 displayModeWord = 0;
	u32 statusWord = 0;
	u32 gp0CommandWordCount = 0;
	u32 gp0CommandTargetWordCount = 0;
	std::vector<u32> gp0CommandWords;
	std::vector<u32> gp0FifoWords;
	std::vector<u32> gp0DmaIngressWords;
	u32 gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
	u32 gp0IngressWordsRemaining = 0u;
	u32 gp0IngressPolylineWordsPerVertex = 0u;
	u32 gp0IngressPolylinePayloadPhase = 0u;
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
	u32 vramYAddressExtensionWord = 0;
	u32 presentStatusWord = 0;
	u32 presentDisplayModeWord = 0;
	u32 presentDisplayStartWord = 0;
	u32 presentVramYAddressExtensionWord = 0;
	u32 presentHorizontalDisplayRangeWord = 0;
	u32 presentVerticalDisplayRangeWord = 0;
	GxGpuPcrtcState pcrtc;
	bool pcrtcPresentationPending = false;
	bool vramPresentationPending = false;
	bool supervisorQuiesceRequested = false;
	bool supervisorIngressQuiesceRequested = false;
	bool supervisorIngressStopped = false;
	GxGpuRegisterContextState userContext;
	GxGpuIngressContextState userIngressContext;
	GxGpuCommandBufferState commandBuffer;
};

struct GxGpuSaveState : GxGpuState {
	std::vector<u8> vramBytes;
};

class GxGpu {
public:
	GxGpu(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler, DmaController& dmaController);
	void reset();
	GxGpuState captureState();
	void restoreState(const GxGpuState& state);
	GxGpuSaveState captureSaveState();
	void restoreSaveState(const GxGpuSaveState& state);
	void replaceVramSnapshotBytes(const u8* bytes);
	u64 commitRenderedVramSnapshotBytes(const u8* bytes, size_t renderedCommandCount);
	const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& readVramSnapshotBytes() const { return *m_vramSnapshotBytes; }
	u64 readVramSnapshotSerial() const { return m_vramSnapshotSerial; }
	u64 readVramReplacementSerial() const { return m_vramReplacementSerial; }
	u32 readGp0(MappedBusSignals busSignals = MAPPED_BUS_MASTER_CPU);
	void writeGp0(u32 word, MappedBusSignals busSignals = MAPPED_BUS_MASTER_CPU);
	u32 readStatus();
	u32 writeGp1(u32 word);
	u32 onService(i64 nowCycles);
	u32 readDisplayModeWord() const;
	void writeDisplayModeWord(u32 word);
	void setTiming(i64 cpuHz, i64 nowCycles);
	u32 readGpuReadWord() const;
	const GxGpuPcrtcTiming& readPcrtcTiming() const { return m_pcrtc.timing; }
	const GxGpuDeviceOutput& readDeviceOutput();
	bool backendReadbackPending() const { return m_commandBuffer.readback.phase() == GX_GPU_READBACK_PENDING; }
	bool backendReadbackBlocksMachine() const {
		const u8 phase = m_commandBuffer.readback.phase();
		return phase == GX_GPU_READBACK_PENDING || phase == GX_GPU_READBACK_SUBMITTED;
	}
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
	u32 readVramYAddressExtensionWord() const;
	void beginSupervisorControlQuiesce();
	void beginSupervisorQuiesce();
	bool supervisorQuiescent();
	void enterSupervisorContext();
	void enterSupervisorFaultContext();
	void leaveSupervisorContext();

private:
	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	DmaController& m_dmaController;
	u32 m_gp0Word = 0;
	u32 m_gp1Word = 0;
	u32 m_displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	u32 m_statusWord = GX_GPU_STATUS_RESET_WORD;
	WordFifo<GX_GPU_COMMAND_FIFO_WORD_CAPACITY> m_gp0Fifo;
	WordFifo<GX_GPU_DMA_INGRESS_WORD_CAPACITY> m_gp0DmaIngress;
	u32 m_gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
	u32 m_gp0IngressWordsRemaining = 0u;
	u32 m_gp0IngressPolylineWordsPerVertex = 0u;
	u32 m_gp0IngressPolylinePayloadPhase = 0u;
	i64 m_pendingCommandCompletionCycle = 0;
	size_t m_pendingCommandTargetCount = 0u;
	i64 m_deviceServiceDeadlineCycle = -1;
	GxGpuCommandBuffer m_commandBuffer;
	GxGpuPcrtc m_pcrtc;
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
	u32 m_vramYAddressExtensionWord = 0u;
	u32 m_presentStatusWord = GX_GPU_STATUS_RESET_WORD;
	u32 m_presentDisplayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	u32 m_presentDisplayStartWord = 0u;
	u32 m_presentVramYAddressExtensionWord = 0u;
	u32 m_presentHorizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	u32 m_presentVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	bool m_lastFrameCommitted = false;
	bool m_vramPresentationPending = false;
	bool m_supervisorQuiesceRequested = false;
	bool m_supervisorIngressQuiesceRequested = false;
	bool m_supervisorIngressStopped = false;
	GxGpuRegisterContextState m_userContext;
	GxGpuIngressContextBank m_userIngressContext;
	u32 m_scanoutInterlacedField = 0u;
	u32 m_scanoutInterlacedDisplayField = 0u;
	u32 m_scanoutActiveLineLsb = 0u;
	u8 m_skippedLineParity = GX_GPU_SKIPPED_LINE_NONE;
	bool m_pcrtcTimingPublicationPending = false;
	bool m_pcrtcPresentationPending = false;
	std::unique_ptr<std::array<u8, GX_GPU_VRAM_BYTE_COUNT>> m_vramSnapshotBytes;
	u64 m_vramSnapshotSerial = 0u;
	u64 m_vramReplacementSerial = 0u;
	mutable GxGpuDeviceOutput m_deviceOutput;
	inline static u64 nextVramSnapshotSerial = 0u;
	inline static u64 nextVramReplacementSerial = 0u;

	void publishVramSnapshotRevision();
	void publishVramReplacementRevision();
	void clearRegisterContext(GxGpuRegisterContextState& context);
	void storeLiveRegisterContext(GxGpuRegisterContextState& context) const;
	void loadLiveRegisterContext(const GxGpuRegisterContextState& context);
	void clearIngressContext(GxGpuIngressContextBank& context);
	void storeLiveIngressContext(GxGpuIngressContextBank& context) const;
	void loadLiveIngressContext(const GxGpuIngressContextBank& context);
	GxGpuIngressContextState captureIngressContext(const GxGpuIngressContextBank& context) const;
	void restoreIngressContext(GxGpuIngressContextBank& context, const GxGpuIngressContextState& state);
	void resetTransientContext();
	bool supervisorFenceReady() const;
	void notifySupervisorBoundary();
	void retireCommandPrefix(size_t retiredCommands);
	void resetGpuRegisters();
	void latchPresentationRegisters();
	void writeDisplayDisableWord(u32 word);
	void writePcrtcRegister(u32 index, u32 word);
	void clearGp0CommandState();
	void clearGp0Fifo(i64 nowCycles);
	void clearGp0IngressState();
	void clearPolylineState();
	void clearImageLoadState();
	void finishImageLoadToVram(i64 commandStartCycle);
	void flushImageLoadToVram(i64 commandStartCycle);
	void consumeImageLoadWord(u32 word, i64 commandStartCycle);
	void consumeGp0PolylinePayloadWord(u32 word, i64 commandStartCycle);
	void beginPolylinePayload(u32 opcode, u32 commandWordCount);
	bool acceptGp0Word(u32 word);
	void processGp0Pipeline(i64 commandStartCycle);
	void consumeGp0Fifo(i64 commandStartCycle);
	void synchronizeCommandExecution(i64 nowCycles);
	void rescheduleDeviceService(bool force = false);
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
	void updateSkippedLineParity();
	void updateDisplayModeStatusBits();
	void writeStatusIo();
	bool gp0WriteReady(MappedBusSignals busSignals);
	static u64 readGp0Thunk(void* context, u32 addr, MappedBusSignals busSignals);
	static void writeGp0Thunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);
	static bool gp0WriteReadyThunk(void* context, u32 addr, MappedBusSignals busSignals);
	static bool gp1WriteReadyThunk(void* context, u32 addr, MappedBusSignals busSignals);
	static u64 readStatusThunk(void* context, u32 addr, MappedBusSignals busSignals);
	static void writeGp1Thunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);
	static u64 readPcrtcThunk(void* context, u32 addr, MappedBusSignals busSignals);
	static void writePcrtcThunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);
};

} // namespace bmsx
