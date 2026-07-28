#include "machine/devices/gx/gpu.h"

#include "spec/bmsx/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/gx/gpu_command_timing.h"
#include "machine/devices/gx/vram_power_on.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

#include <algorithm>

namespace bmsx {

namespace {

constexpr bool gxGpuGp0OpcodeIsNop(u32 opcode) {
	return opcode == 0x00u
		|| (opcode >= 0x04u && opcode <= 0x1eu)
		|| opcode == 0xe0u
		|| (opcode >= 0xe7u && opcode <= 0xefu);
}

constexpr u32 GX_GPU_STATUS_SKIP_ACTIVE_FIELD_MASK = GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE | GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD;
constexpr u32 GX_GPU_STATUS_SKIP_ACTIVE_FIELD_WORD = GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE;

} // namespace

GxGpu::GxGpu(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler, DmaController& dmaController)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_irq(irq)
	, m_scheduler(scheduler)
	, m_dmaController(dmaController)
	, m_commandBuffer(dmaController)
	, m_vramSnapshotBytes(std::make_unique<std::array<u8, GX_GPU_VRAM_BYTE_COUNT>>())
	, m_deviceOutput(m_commandBuffer, m_pcrtc.presentWords(), m_pcrtc.timing, m_pcrtc.scanout, *m_vramSnapshotBytes) {
	m_userIngressContext.commandBufferWords.reset(new std::array<u32, GX_GPU_COMMAND_WORD_CAPACITY>);
	m_memory.mapIoRead(IO_GX_GPU_GP0, this, &GxGpu::readGp0Thunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP0, this, &GxGpu::writeGp0Thunk);
	m_memory.mapIoWriteReady(IO_GX_GPU_GP0, &GxGpu::gp0WriteReadyThunk);
	m_memory.mapIoRead(IO_GX_GPU_GP1, this, &GxGpu::readStatusThunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP1, this, &GxGpu::writeGp1Thunk);
	m_memory.mapIoWriteReady(IO_GX_GPU_GP1, &GxGpu::gp1WriteReadyThunk);
	for (u32 index = 0u; index < GX_GPU_PCRTC_WORD_COUNT; index += 1u) {
		const u32 address = gxGpuPcrtcRegisterAddress(index);
		m_memory.mapIoRead(address, this, &GxGpu::readPcrtcThunk);
		m_memory.mapIoWrite(address, this, &GxGpu::writePcrtcThunk);
	}
}

void GxGpu::reset() {
	m_deviceServiceDeadlineCycle = -1;
	m_pcrtc.reset(m_scheduler.currentNowCycles());
	m_pcrtcTimingPublicationPending = true;
	m_vramYAddressExtensionWord = 0u;
	m_gpuReadWord = 0u;
	m_commandBuffer.reset();
	initializeGxGpuVramPowerOn(m_vramSnapshotBytes->data());
	publishVramSnapshotRevision();
	publishVramReplacementRevision();
	clearGp0CommandState();
	m_scanoutInterlacedField = 0u;
	m_scanoutInterlacedDisplayField = 0u;
	m_scanoutActiveLineLsb = 0u;
	resetGpuRegisters();
	latchPresentationRegisters();
	m_pcrtcPresentationPending = true;
	m_lastFrameCommitted = false;
	m_vramPresentationPending = false;
	m_supervisorQuiesceRequested = false;
	m_supervisorIngressQuiesceRequested = false;
	m_supervisorIngressStopped = false;
	clearRegisterContext(m_userContext);
	clearIngressContext(m_userIngressContext);
	rescheduleDeviceService(true);
}

void GxGpu::clearRegisterContext(GxGpuRegisterContextState& context) {
	context = GxGpuRegisterContextState{};
}

void GxGpu::storeLiveRegisterContext(GxGpuRegisterContextState& context) const {
	context.gp0Word = m_gp0Word;
	context.gp1Word = m_gp1Word;
	context.displayModeWord = m_displayModeWord;
	context.statusWord = m_statusWord;
	context.gpuReadWord = m_gpuReadWord;
	context.drawModeWord = m_drawModeWord;
	context.textureWindowWord = m_textureWindowWord;
	context.drawingAreaTopLeftWord = m_drawingAreaTopLeftWord;
	context.drawingAreaBottomRightWord = m_drawingAreaBottomRightWord;
	context.drawingOffsetWord = m_drawingOffsetWord;
	context.maskBitModeWord = m_maskBitModeWord;
	context.displayStartWord = m_displayStartWord;
	context.horizontalDisplayRangeWord = m_horizontalDisplayRangeWord;
	context.verticalDisplayRangeWord = m_verticalDisplayRangeWord;
	context.vramYAddressExtensionWord = m_vramYAddressExtensionWord;
	context.presentStatusWord = m_presentStatusWord;
	context.presentDisplayModeWord = m_presentDisplayModeWord;
	context.presentDisplayStartWord = m_presentDisplayStartWord;
	context.presentVramYAddressExtensionWord = m_presentVramYAddressExtensionWord;
	context.presentHorizontalDisplayRangeWord = m_presentHorizontalDisplayRangeWord;
	context.presentVerticalDisplayRangeWord = m_presentVerticalDisplayRangeWord;
	m_pcrtc.captureContext(context.pcrtcRegisterWords, context.pcrtcPresentWords);
	context.vramPresentationPending = m_vramPresentationPending;
}

void GxGpu::loadLiveRegisterContext(const GxGpuRegisterContextState& context) {
	m_commandBuffer.readback.setDmaReadEnabled(false);
	m_gp0Word = context.gp0Word;
	m_gp1Word = context.gp1Word;
	m_displayModeWord = context.displayModeWord;
	m_statusWord = context.statusWord;
	m_gpuReadWord = context.gpuReadWord;
	m_drawModeWord = context.drawModeWord;
	m_textureWindowWord = context.textureWindowWord;
	m_drawingAreaTopLeftWord = context.drawingAreaTopLeftWord;
	m_drawingAreaBottomRightWord = context.drawingAreaBottomRightWord;
	m_drawingOffsetWord = context.drawingOffsetWord;
	m_maskBitModeWord = context.maskBitModeWord;
	m_displayStartWord = context.displayStartWord;
	m_horizontalDisplayRangeWord = context.horizontalDisplayRangeWord;
	m_verticalDisplayRangeWord = context.verticalDisplayRangeWord;
	m_vramYAddressExtensionWord = context.vramYAddressExtensionWord;
	m_presentStatusWord = context.presentStatusWord;
	m_presentDisplayModeWord = context.presentDisplayModeWord;
	m_presentDisplayStartWord = context.presentDisplayStartWord;
	m_presentVramYAddressExtensionWord = context.presentVramYAddressExtensionWord;
	m_presentHorizontalDisplayRangeWord = context.presentHorizontalDisplayRangeWord;
	m_presentVerticalDisplayRangeWord = context.presentVerticalDisplayRangeWord;
	m_pcrtc.restoreContext(
		context.pcrtcRegisterWords,
		context.pcrtcPresentWords);
	m_vramPresentationPending = context.vramPresentationPending;
	updateScanoutStatusBits();
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));
	writeStatusIo();
	if (((m_statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >> GX_GPU_STATUS_DMA_DIRECTION_SHIFT)
		== GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
		m_commandBuffer.readback.setDmaReadEnabled(true);
	}
}

void GxGpu::clearIngressContext(GxGpuIngressContextBank& context) {
	context.gp0CommandTargetWordCount = 0u;
	context.gp0CommandWordCount = 0u;
	context.gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
	context.gp0IngressWordsRemaining = 0u;
	context.gp0IngressPolylineWordsPerVertex = 0u;
	context.gp0IngressPolylinePayloadPhase = 0u;
	context.gp0ImageLoadWordsRemaining = 0u;
	context.gp0ImageLoadCommandWordStart = 0u;
	context.gp0ImageLoadCommandWordCount = 0u;
	context.gp0ImageLoadCommandOpcode = 0u;
	context.gp0PolylineWordsPerVertex = 0u;
	context.gp0PolylinePayloadPhase = 0u;
	context.gp0PolylineCommandWordStart = 0u;
	context.gp0PolylineCommandWordCount = 0u;
	context.gp0PolylineCommandOpcode = 0u;
	context.commandBufferWordCount = 0u;
}

void GxGpu::storeLiveIngressContext(GxGpuIngressContextBank& context) const {
	context.gp0CommandTargetWordCount = m_gp0CommandTargetWordCount;
	context.gp0CommandWordCount = m_gp0CommandWordCount;
	std::copy(m_gp0CommandWords.begin(), m_gp0CommandWords.begin() + static_cast<std::ptrdiff_t>(m_gp0CommandWordCount), context.gp0CommandWords.begin());
	context.gp0IngressPhase = m_gp0IngressPhase;
	context.gp0IngressWordsRemaining = m_gp0IngressWordsRemaining;
	context.gp0IngressPolylineWordsPerVertex = m_gp0IngressPolylineWordsPerVertex;
	context.gp0IngressPolylinePayloadPhase = m_gp0IngressPolylinePayloadPhase;
	context.gp0ImageLoadWordsRemaining = m_gp0ImageLoadWordsRemaining;
	context.gp0ImageLoadCommandWordStart = m_gp0ImageLoadCommandWordStart;
	context.gp0ImageLoadCommandWordCount = m_gp0ImageLoadCommandWordCount;
	context.gp0ImageLoadCommandOpcode = m_gp0ImageLoadCommandOpcode;
	context.gp0PolylineWordsPerVertex = m_gp0PolylineWordsPerVertex;
	context.gp0PolylinePayloadPhase = m_gp0PolylinePayloadPhase;
	context.gp0PolylineCommandWordStart = m_gp0PolylineCommandWordStart;
	context.gp0PolylineCommandWordCount = m_gp0PolylineCommandWordCount;
	context.gp0PolylineCommandOpcode = m_gp0PolylineCommandOpcode;
	context.commandBufferWordCount = m_commandBuffer.wordCount;
	std::copy(m_commandBuffer.words.begin(), m_commandBuffer.words.begin() + static_cast<std::ptrdiff_t>(m_commandBuffer.wordCount), context.commandBufferWords->begin());
}

void GxGpu::loadLiveIngressContext(const GxGpuIngressContextBank& context) {
	m_gp0CommandWordCount = context.gp0CommandWordCount;
	m_gp0CommandTargetWordCount = context.gp0CommandTargetWordCount;
	std::copy(context.gp0CommandWords.begin(), context.gp0CommandWords.begin() + static_cast<std::ptrdiff_t>(context.gp0CommandWordCount), m_gp0CommandWords.begin());
	m_gp0IngressPhase = context.gp0IngressPhase;
	m_gp0IngressWordsRemaining = context.gp0IngressWordsRemaining;
	m_gp0IngressPolylineWordsPerVertex = context.gp0IngressPolylineWordsPerVertex;
	m_gp0IngressPolylinePayloadPhase = context.gp0IngressPolylinePayloadPhase;
	m_gp0ImageLoadWordsRemaining = context.gp0ImageLoadWordsRemaining;
	m_gp0ImageLoadCommandWordStart = context.gp0ImageLoadCommandWordStart;
	m_gp0ImageLoadCommandWordCount = context.gp0ImageLoadCommandWordCount;
	m_gp0ImageLoadCommandOpcode = context.gp0ImageLoadCommandOpcode;
	m_gp0PolylineWordsPerVertex = context.gp0PolylineWordsPerVertex;
	m_gp0PolylinePayloadPhase = context.gp0PolylinePayloadPhase;
	m_gp0PolylineCommandWordStart = context.gp0PolylineCommandWordStart;
	m_gp0PolylineCommandWordCount = context.gp0PolylineCommandWordCount;
	m_gp0PolylineCommandOpcode = context.gp0PolylineCommandOpcode;
	m_commandBuffer.wordCount = context.commandBufferWordCount;
	std::copy(context.commandBufferWords->begin(), context.commandBufferWords->begin() + static_cast<std::ptrdiff_t>(context.commandBufferWordCount), m_commandBuffer.words.begin());
}

GxGpuIngressContextState GxGpu::captureIngressContext(const GxGpuIngressContextBank& context) const {
	GxGpuIngressContextState state;
	state.gp0CommandTargetWordCount = context.gp0CommandTargetWordCount;
	state.gp0CommandWords.assign(context.gp0CommandWords.begin(), context.gp0CommandWords.begin() + static_cast<std::ptrdiff_t>(context.gp0CommandWordCount));
	state.gp0IngressPhase = context.gp0IngressPhase;
	state.gp0IngressWordsRemaining = context.gp0IngressWordsRemaining;
	state.gp0IngressPolylineWordsPerVertex = context.gp0IngressPolylineWordsPerVertex;
	state.gp0IngressPolylinePayloadPhase = context.gp0IngressPolylinePayloadPhase;
	state.gp0ImageLoadWordsRemaining = context.gp0ImageLoadWordsRemaining;
	state.gp0ImageLoadCommandWordStart = context.gp0ImageLoadCommandWordStart;
	state.gp0ImageLoadCommandWordCount = context.gp0ImageLoadCommandWordCount;
	state.gp0ImageLoadCommandOpcode = context.gp0ImageLoadCommandOpcode;
	state.gp0PolylineWordsPerVertex = context.gp0PolylineWordsPerVertex;
	state.gp0PolylinePayloadPhase = context.gp0PolylinePayloadPhase;
	state.gp0PolylineCommandWordStart = context.gp0PolylineCommandWordStart;
	state.gp0PolylineCommandWordCount = context.gp0PolylineCommandWordCount;
	state.gp0PolylineCommandOpcode = context.gp0PolylineCommandOpcode;
	state.commandBufferWords.assign(context.commandBufferWords->begin(), context.commandBufferWords->begin() + static_cast<std::ptrdiff_t>(context.commandBufferWordCount));
	return state;
}

void GxGpu::restoreIngressContext(GxGpuIngressContextBank& context, const GxGpuIngressContextState& state) {
	context.gp0CommandTargetWordCount = state.gp0CommandTargetWordCount;
	context.gp0CommandWordCount = state.gp0CommandWords.size();
	std::copy(state.gp0CommandWords.begin(), state.gp0CommandWords.end(), context.gp0CommandWords.begin());
	context.gp0IngressPhase = state.gp0IngressPhase;
	context.gp0IngressWordsRemaining = state.gp0IngressWordsRemaining;
	context.gp0IngressPolylineWordsPerVertex = state.gp0IngressPolylineWordsPerVertex;
	context.gp0IngressPolylinePayloadPhase = state.gp0IngressPolylinePayloadPhase;
	context.gp0ImageLoadWordsRemaining = state.gp0ImageLoadWordsRemaining;
	context.gp0ImageLoadCommandWordStart = state.gp0ImageLoadCommandWordStart;
	context.gp0ImageLoadCommandWordCount = state.gp0ImageLoadCommandWordCount;
	context.gp0ImageLoadCommandOpcode = state.gp0ImageLoadCommandOpcode;
	context.gp0PolylineWordsPerVertex = state.gp0PolylineWordsPerVertex;
	context.gp0PolylinePayloadPhase = state.gp0PolylinePayloadPhase;
	context.gp0PolylineCommandWordStart = state.gp0PolylineCommandWordStart;
	context.gp0PolylineCommandWordCount = state.gp0PolylineCommandWordCount;
	context.gp0PolylineCommandOpcode = state.gp0PolylineCommandOpcode;
	context.commandBufferWordCount = state.commandBufferWords.size();
	std::copy(state.commandBufferWords.begin(), state.commandBufferWords.end(), context.commandBufferWords->begin());
}

void GxGpu::resetTransientContext() {
	m_commandBuffer.reset();
	clearGp0CommandState();
	m_gpuReadWord = 0u;
	m_vramYAddressExtensionWord = 0u;
	m_scanoutInterlacedField = 0u;
	m_scanoutInterlacedDisplayField = 0u;
	m_scanoutActiveLineLsb = 0u;
	resetGpuRegisters();
	latchPresentationRegisters();
	m_lastFrameCommitted = false;
	m_vramPresentationPending = false;
}

void GxGpu::latchPresentationRegisters() {
	m_presentStatusWord = m_statusWord;
	m_presentDisplayModeWord = m_displayModeWord;
	m_presentDisplayStartWord = m_displayStartWord;
	m_presentVramYAddressExtensionWord = m_vramYAddressExtensionWord;
	m_presentHorizontalDisplayRangeWord = m_horizontalDisplayRangeWord;
	m_presentVerticalDisplayRangeWord = m_verticalDisplayRangeWord;
}

void GxGpu::resetGpuRegisters() {
	m_gp0Word = 0u;
	m_gp1Word = 0u;
	m_displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	m_statusWord = GX_GPU_STATUS_RESET_WORD;
	m_commandBuffer.readback.setDmaReadEnabled(false);
	m_drawModeWord = 0u;
	m_textureWindowWord = 0u;
	m_drawingAreaTopLeftWord = 0u;
	m_drawingAreaBottomRightWord = 0u;
	m_drawingOffsetWord = 0u;
	m_maskBitModeWord = 0u;
	m_displayStartWord = 0u;
	m_horizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	m_verticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	updateDisplayModeStatusBits();
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gpuReadWord)));
	writeStatusIo();
}

GxGpuState GxGpu::captureState() {
	const i64 nowCycles = m_scheduler.currentNowCycles();
	synchronizeCommandExecution(nowCycles);
	updateDynamicStatusBits();
	GxGpuState state;
	state.gp0Word = m_gp0Word;
	state.gp1Word = m_gp1Word;
	state.displayModeWord = m_displayModeWord;
	state.statusWord = m_statusWord;
	state.gp0CommandWordCount = m_gp0CommandWordCount;
	state.gp0CommandTargetWordCount = m_gp0CommandTargetWordCount;
	state.gp0CommandWords.assign(m_gp0CommandWords.begin(), m_gp0CommandWords.begin() + static_cast<std::ptrdiff_t>(m_gp0CommandWordCount));
	state.gp0FifoWords = m_gp0Fifo.captureWords();
	state.gp0DmaIngressWords = m_gp0DmaIngress.captureWords();
	state.gp0IngressPhase = m_gp0IngressPhase;
	state.gp0IngressWordsRemaining = m_gp0IngressWordsRemaining;
	state.gp0IngressPolylineWordsPerVertex = m_gp0IngressPolylineWordsPerVertex;
	state.gp0IngressPolylinePayloadPhase = m_gp0IngressPolylinePayloadPhase;
	state.pendingCommandCycles = m_pendingCommandCompletionCycle == 0
		? 0
		: m_pendingCommandCompletionCycle - nowCycles;
	state.pendingCommandTargetCount = m_pendingCommandTargetCount;
	state.gp0ImageLoadWordsRemaining = m_gp0ImageLoadWordsRemaining;
	state.gp0ImageLoadCommandWordStart = m_gp0ImageLoadCommandWordStart;
	state.gp0ImageLoadCommandWordCount = m_gp0ImageLoadCommandWordCount;
	state.gp0ImageLoadCommandOpcode = m_gp0ImageLoadCommandOpcode;
	state.gp0PolylineWordsPerVertex = m_gp0PolylineWordsPerVertex;
	state.gp0PolylinePayloadPhase = m_gp0PolylinePayloadPhase;
	state.gp0PolylineCommandWordStart = m_gp0PolylineCommandWordStart;
	state.gp0PolylineCommandWordCount = m_gp0PolylineCommandWordCount;
	state.gp0PolylineCommandOpcode = m_gp0PolylineCommandOpcode;
	state.gpuReadWord = m_gpuReadWord;
	state.drawModeWord = m_drawModeWord;
	state.textureWindowWord = m_textureWindowWord;
	state.drawingAreaTopLeftWord = m_drawingAreaTopLeftWord;
	state.drawingAreaBottomRightWord = m_drawingAreaBottomRightWord;
	state.drawingOffsetWord = m_drawingOffsetWord;
	state.maskBitModeWord = m_maskBitModeWord;
	state.displayStartWord = m_displayStartWord;
	state.horizontalDisplayRangeWord = m_horizontalDisplayRangeWord;
	state.verticalDisplayRangeWord = m_verticalDisplayRangeWord;
	state.vramYAddressExtensionWord = m_vramYAddressExtensionWord;
	state.presentStatusWord = m_presentStatusWord;
	state.presentDisplayModeWord = m_presentDisplayModeWord;
	state.presentDisplayStartWord = m_presentDisplayStartWord;
	state.presentVramYAddressExtensionWord = m_presentVramYAddressExtensionWord;
	state.presentHorizontalDisplayRangeWord = m_presentHorizontalDisplayRangeWord;
	state.presentVerticalDisplayRangeWord = m_presentVerticalDisplayRangeWord;
	state.pcrtc = m_pcrtc.captureState(nowCycles);
	state.pcrtcPresentationPending = m_pcrtcPresentationPending;
	state.vramPresentationPending = m_vramPresentationPending;
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	state.supervisorIngressQuiesceRequested = m_supervisorIngressQuiesceRequested;
	state.supervisorIngressStopped = m_supervisorIngressStopped;
	state.userContext = m_userContext;
	state.userIngressContext = captureIngressContext(m_userIngressContext);
	state.commandBuffer = m_commandBuffer.captureState();
	return state;
}

void GxGpu::restoreState(const GxGpuState& state) {
	m_commandBuffer.readback.setDmaReadEnabled(false);
	m_gp0Word = state.gp0Word;
	m_gp1Word = state.gp1Word;
	m_displayModeWord = state.displayModeWord;
	m_statusWord = state.statusWord;
	m_gp0Fifo.restoreWords(state.gp0FifoWords);
	m_gp0DmaIngress.restoreWords(state.gp0DmaIngressWords);
	m_gp0IngressPhase = state.gp0IngressPhase;
	m_gp0IngressWordsRemaining = state.gp0IngressWordsRemaining;
	m_gp0IngressPolylineWordsPerVertex = state.gp0IngressPolylineWordsPerVertex;
	m_gp0IngressPolylinePayloadPhase = state.gp0IngressPolylinePayloadPhase;
	m_pendingCommandTargetCount = state.pendingCommandTargetCount;
	m_gp0CommandWordCount = state.gp0CommandWordCount;
	m_gp0CommandTargetWordCount = state.gp0CommandTargetWordCount;
	for (size_t index = 0u; index < m_gp0CommandWordCount; index += 1u) {
		m_gp0CommandWords[index] = state.gp0CommandWords[index];
	}
	m_gp0ImageLoadWordsRemaining = state.gp0ImageLoadWordsRemaining;
	m_gp0ImageLoadCommandWordStart = state.gp0ImageLoadCommandWordStart;
	m_gp0ImageLoadCommandWordCount = state.gp0ImageLoadCommandWordCount;
	m_gp0ImageLoadCommandOpcode = state.gp0ImageLoadCommandOpcode;
	m_gp0PolylineWordsPerVertex = state.gp0PolylineWordsPerVertex;
	m_gp0PolylinePayloadPhase = state.gp0PolylinePayloadPhase;
	m_gp0PolylineCommandWordStart = state.gp0PolylineCommandWordStart;
	m_gp0PolylineCommandWordCount = state.gp0PolylineCommandWordCount;
	m_gp0PolylineCommandOpcode = state.gp0PolylineCommandOpcode;
	m_gpuReadWord = state.gpuReadWord;
	m_drawModeWord = state.drawModeWord;
	m_textureWindowWord = state.textureWindowWord;
	m_drawingAreaTopLeftWord = state.drawingAreaTopLeftWord;
	m_drawingAreaBottomRightWord = state.drawingAreaBottomRightWord;
	m_drawingOffsetWord = state.drawingOffsetWord;
	m_maskBitModeWord = state.maskBitModeWord;
	m_displayStartWord = state.displayStartWord;
	m_horizontalDisplayRangeWord = state.horizontalDisplayRangeWord;
	m_verticalDisplayRangeWord = state.verticalDisplayRangeWord;
	m_vramYAddressExtensionWord = state.vramYAddressExtensionWord;
	m_presentStatusWord = state.presentStatusWord;
	m_presentDisplayModeWord = state.presentDisplayModeWord;
	m_presentDisplayStartWord = state.presentDisplayStartWord;
	m_presentVramYAddressExtensionWord = state.presentVramYAddressExtensionWord;
	m_presentHorizontalDisplayRangeWord = state.presentHorizontalDisplayRangeWord;
	m_presentVerticalDisplayRangeWord = state.presentVerticalDisplayRangeWord;
	m_pcrtc.restoreState(state.pcrtc, m_scheduler.currentNowCycles());
	m_pcrtcPresentationPending = state.pcrtcPresentationPending;
	m_vramPresentationPending = state.vramPresentationPending;
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	m_supervisorIngressQuiesceRequested = state.supervisorIngressQuiesceRequested;
	m_supervisorIngressStopped = state.supervisorIngressStopped;
	m_userContext = state.userContext;
	restoreIngressContext(m_userIngressContext, state.userIngressContext);
	m_commandBuffer.restoreState(state.commandBuffer);
	if (state.pendingCommandCycles != 0) {
		m_pendingCommandCompletionCycle = m_scheduler.currentNowCycles() + state.pendingCommandCycles;
	} else {
		m_pendingCommandCompletionCycle = 0;
	}
	rescheduleDeviceService(true);
	m_lastFrameCommitted = false;
	updateScanoutStatusBits();
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));
	writeStatusIo();
	if (((m_statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >> GX_GPU_STATUS_DMA_DIRECTION_SHIFT)
		== GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
		m_commandBuffer.readback.setDmaReadEnabled(true);
	}
}

void GxGpu::beginSupervisorControlQuiesce() {
	m_supervisorQuiesceRequested = true;
	updateDynamicStatusBits();
}

void GxGpu::beginSupervisorQuiesce() {
	m_supervisorQuiesceRequested = true;
	m_supervisorIngressQuiesceRequested = true;
	if (!m_dmaController.hasAdmittedWriteBlock(IO_GX_GPU_GP0)) {
		m_supervisorIngressStopped = true;
	}
	updateDynamicStatusBits();
	notifySupervisorBoundary();
}

bool GxGpu::supervisorQuiescent() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	if (m_supervisorIngressQuiesceRequested
		&& !m_supervisorIngressStopped
		&& !m_dmaController.hasAdmittedWriteBlock(IO_GX_GPU_GP0)) {
		m_supervisorIngressStopped = true;
		updateDynamicStatusBits();
	}
	return supervisorFenceReady();
}

bool GxGpu::supervisorFenceReady() const {
	return m_supervisorIngressQuiesceRequested
		&& m_supervisorIngressStopped
		&& m_pendingCommandCompletionCycle == 0
		&& m_gp0DmaIngress.empty()
		&& m_gp0Fifo.empty()
		&& m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE
		&& m_commandBuffer.commandCount == 0u;
}

void GxGpu::enterSupervisorContext() {
	updateScanoutStatusBits();
	updateDynamicStatusBits();
	storeLiveRegisterContext(m_userContext);
	storeLiveIngressContext(m_userIngressContext);
	m_supervisorQuiesceRequested = false;
	m_supervisorIngressQuiesceRequested = false;
	m_supervisorIngressStopped = false;
	resetTransientContext();
	m_pcrtc.enterSupervisorContext(m_userContext.pcrtcPresentWords);
	m_pcrtcPresentationPending = true;
}

void GxGpu::leaveSupervisorContext() {
	m_supervisorQuiesceRequested = false;
	m_supervisorIngressQuiesceRequested = false;
	m_supervisorIngressStopped = false;
	resetTransientContext();
	loadLiveIngressContext(m_userIngressContext);
	loadLiveRegisterContext(m_userContext);
	m_pcrtcPresentationPending = true;
	clearRegisterContext(m_userContext);
	clearIngressContext(m_userIngressContext);
}

GxGpuSaveState GxGpu::captureSaveState() {
	GxGpuSaveState state;
	static_cast<GxGpuState&>(state) = captureState();
	state.vramBytes.assign(m_vramSnapshotBytes->begin(), m_vramSnapshotBytes->end());
	return state;
}

void GxGpu::restoreSaveState(const GxGpuSaveState& state) {
	restoreState(state);
	replaceVramSnapshotBytes(state.vramBytes.data());
}

void GxGpu::replaceVramSnapshotBytes(const u8* bytes) {
	std::copy(bytes, bytes + GX_GPU_VRAM_BYTE_COUNT, m_vramSnapshotBytes->begin());
	publishVramSnapshotRevision();
	publishVramReplacementRevision();
	m_vramPresentationPending = true;
}

u64 GxGpu::commitRenderedVramSnapshotBytes(const u8* bytes, size_t renderedCommandCount) {
	std::copy(bytes, bytes + GX_GPU_VRAM_BYTE_COUNT, m_vramSnapshotBytes->begin());
	publishVramSnapshotRevision();
	if (renderedCommandCount != 0u) {
		retireCommandPrefix(renderedCommandCount);
		m_vramPresentationPending = true;
	}
	notifySupervisorBoundary();
	return m_vramSnapshotSerial;
}

void GxGpu::publishVramSnapshotRevision() {
	nextVramSnapshotSerial += 1u;
	m_vramSnapshotSerial = nextVramSnapshotSerial;
}

void GxGpu::publishVramReplacementRevision() {
	nextVramReplacementSerial += 1u;
	m_vramReplacementSerial = nextVramReplacementSerial;
}

u32 GxGpu::readGp0(MappedBusSignals busSignals) {
	const i64 nowCycles = m_scheduler.currentNowCycles();
	synchronizeCommandExecution(nowCycles);
	const bool dmaRead = (busSignals & MAPPED_BUS_MASTER_DMA) != 0u;
	if ((dmaRead || !m_dmaController.ownsReadPort(IO_GX_GPU_GP0))
		&& m_commandBuffer.readback.phase() == GX_GPU_READBACK_READY) {
		m_gpuReadWord = m_commandBuffer.readback.readWord();
		processGp0Pipeline(nowCycles);
		m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gpuReadWord)));
	}
	updateDynamicStatusBits();
	notifySupervisorBoundary();
	return m_gpuReadWord;
}

void GxGpu::writeGp0(u32 word, MappedBusSignals busSignals) {
	const bool dmaWrite = (busSignals & MAPPED_BUS_MASTER_DMA) != 0u;
	if (dmaWrite) {
		m_gp0Word = word;
		if (!m_gp0DmaIngress.full()) {
			m_gp0DmaIngress.writeWord(word);
		}
		if ((busSignals & MAPPED_BUS_DMA_BLOCK_END) == 0u) {
			return;
		}
	}
	const i64 nowCycles = m_scheduler.currentNowCycles();
	synchronizeCommandExecution(nowCycles);
	if (!dmaWrite) {
		m_gp0Word = word;
		acceptGp0Word(word);
	}
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));
	processGp0Pipeline(nowCycles);
	if (m_supervisorIngressQuiesceRequested
		&& m_gp0IngressPhase == GX_GPU_GP0_INGRESS_COMMAND
		&& !m_dmaController.hasAdmittedWriteBlock(IO_GX_GPU_GP0)) {
		m_supervisorIngressStopped = true;
	}
	updateDynamicStatusBits();
	notifySupervisorBoundary();
}

bool GxGpu::acceptGp0Word(u32 word) {
	const u32 phase = m_gp0IngressPhase;
	const u32 opcode = word >> GX_GPU_GP0_OPCODE_SHIFT;
	if (phase == GX_GPU_GP0_INGRESS_COMMAND) {
		if (gxGpuGp0OpcodeIsNop(opcode)) {
			return true;
		}
		switch (opcode) {
		case GX_GPU_GP0_DRAWING_AREA_TOP_LEFT:
			m_drawingAreaTopLeftWord = word & GX_GPU_DRAWING_AREA_MASK;
			return true;
		case GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT:
			m_drawingAreaBottomRightWord = word & GX_GPU_DRAWING_AREA_MASK;
			return true;
		case GX_GPU_GP0_DRAWING_OFFSET:
			m_drawingOffsetWord = word & GX_GPU_DRAWING_OFFSET_MASK;
			return true;
		}
	}
	if (m_gp0Fifo.full()) {
		return false;
	}
	m_gp0Fifo.writeWord(word);
	switch (phase) {
	case GX_GPU_GP0_INGRESS_COMMAND:
		if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) {
			m_gp0IngressPhase = GX_GPU_GP0_INGRESS_IMAGE_HEADER;
			m_gp0IngressWordsRemaining = 2u;
			return true;
		}
		if (opcode >= GX_GPU_GP0_LINE_FIRST
			&& opcode <= GX_GPU_GP0_LINE_LAST
			&& (opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) != 0u) {
			m_gp0IngressPhase = GX_GPU_GP0_INGRESS_POLYLINE_HEADER;
			m_gp0IngressWordsRemaining = gp0LineWordCount(opcode) - 1u;
			m_gp0IngressPolylineWordsPerVertex = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u ? 2u : 1u;
			m_gp0IngressPolylinePayloadPhase = 0u;
			return true;
		}
		m_gp0IngressWordsRemaining = gp0CommandWordCountForOpcode(opcode) - 1u;
		if (m_gp0IngressWordsRemaining != 0u) {
			m_gp0IngressPhase = GX_GPU_GP0_INGRESS_FIXED;
		}
		return true;
	case GX_GPU_GP0_INGRESS_FIXED:
		m_gp0IngressWordsRemaining -= 1u;
		if (m_gp0IngressWordsRemaining == 0u) {
			m_gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
		}
		return true;
	case GX_GPU_GP0_INGRESS_IMAGE_HEADER:
		m_gp0IngressWordsRemaining -= 1u;
		if (m_gp0IngressWordsRemaining == 0u) {
			m_gp0IngressPhase = GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD;
			m_gp0IngressWordsRemaining = ((gxGpuTransferWidth(word) * gxGpuTransferHeight(word)) + 1u) >> 1u;
		}
		return true;
	case GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD:
		m_gp0IngressWordsRemaining -= 1u;
		if (m_gp0IngressWordsRemaining == 0u) {
			m_gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
		}
		return true;
	case GX_GPU_GP0_INGRESS_POLYLINE_HEADER:
		m_gp0IngressWordsRemaining -= 1u;
		if (m_gp0IngressWordsRemaining == 0u) {
			m_gp0IngressPhase = GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD;
		}
		return true;
	case GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD:
		if (m_gp0IngressPolylinePayloadPhase == 0u && (word & 0xf000f000u) == 0x50005000u) {
			m_gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
			m_gp0IngressPolylineWordsPerVertex = 0u;
			m_gp0IngressPolylinePayloadPhase = 0u;
			return true;
		}
		m_gp0IngressPolylinePayloadPhase += 1u;
		if (m_gp0IngressPolylinePayloadPhase == m_gp0IngressPolylineWordsPerVertex) {
			m_gp0IngressPolylinePayloadPhase = 0u;
		}
		return true;
	}
	__builtin_unreachable();
}

void GxGpu::processGp0Pipeline(i64 commandStartCycle) {
	while (true) {
		consumeGp0Fifo(commandStartCycle);
		bool ingressAdvanced = false;
		while (!m_gp0DmaIngress.empty() && acceptGp0Word(m_gp0DmaIngress.peek())) {
			m_gp0DmaIngress.pop();
			ingressAdvanced = true;
		}
		if (!ingressAdvanced) return;
	}
}

u32 GxGpu::onService(i64 nowCycles) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
	m_deviceServiceDeadlineCycle = -1;
	bool timingPublished = m_pcrtcTimingPublicationPending;
	m_pcrtcTimingPublicationPending = false;
	synchronizeCommandExecution(nowCycles);
	u32 runtimeEdge = GX_GPU_PCRTC_RUNTIME_EDGE_NONE;
	const i64 pcrtcDeadline = m_pcrtc.nextDeadlineCycle();
	if (pcrtcDeadline >= 0 && pcrtcDeadline <= nowCycles) {
		const u32 serviceResult = m_pcrtc.service(nowCycles);
		if ((serviceResult & GX_GPU_PCRTC_SERVICE_IRQ) != 0u) m_irq.raise(IRQ_GX_PCRTC);
		runtimeEdge = serviceResult & GX_GPU_PCRTC_SERVICE_RUNTIME_EDGE_MASK;
	}
	rescheduleDeviceService();
	writeStatusIo();
	if (runtimeEdge == GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) timingPublished = true;
	return runtimeEdge | (timingPublished ? GX_GPU_SERVICE_TIMING_PUBLISHED : 0u);
}

void GxGpu::synchronizeCommandExecution(i64 nowCycles) {
	bool completed = false;
	while (m_pendingCommandCompletionCycle != 0 && nowCycles >= m_pendingCommandCompletionCycle) {
		const i64 commandCompletionCycle = m_pendingCommandCompletionCycle;
		const size_t completedCommandCount = m_pendingCommandTargetCount;
		m_pendingCommandCompletionCycle = 0;
		m_pendingCommandTargetCount = 0u;
		if (completedCommandCount > m_commandBuffer.executedCommandCount) {
			m_commandBuffer.completeCommandExecution(completedCommandCount);
		}
		if (m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE) {
			processGp0Pipeline(commandCompletionCycle);
		}
		completed = true;
	}
	if (completed) {
		rescheduleDeviceService();
		notifySupervisorBoundary();
	}
}

void GxGpu::rescheduleDeviceService(bool force) {
	i64 deadline = m_pendingCommandCompletionCycle == 0 ? -1 : m_pendingCommandCompletionCycle;
	if (m_pcrtcTimingPublicationPending) {
		deadline = m_scheduler.currentNowCycles();
	} else {
		const i64 pcrtcDeadline = m_pcrtc.nextDeadlineCycle();
		if (pcrtcDeadline >= 0 && (deadline < 0 || pcrtcDeadline < deadline)) {
			deadline = pcrtcDeadline;
		}
	}
	if (!force && deadline == m_deviceServiceDeadlineCycle) return;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
	m_deviceServiceDeadlineCycle = deadline;
	if (deadline >= 0) m_scheduler.scheduleDeviceService(DEVICE_SERVICE_GPU, deadline);
}

void GxGpu::consumeGp0Fifo(i64 commandStartCycle) {
	while (m_pendingCommandCompletionCycle == 0
		&& m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE
		&& !m_gp0Fifo.empty()) {
		if (m_gp0ImageLoadWordsRemaining != 0u) {
			consumeImageLoadWord(m_gp0Fifo.pop(), commandStartCycle);
			continue;
		}
		if (m_gp0PolylineWordsPerVertex != 0u) {
			consumeGp0PolylinePayloadWord(m_gp0Fifo.pop(), commandStartCycle);
			continue;
		}
		if (m_gp0CommandTargetWordCount == 0u) {
			m_gp0CommandTargetWordCount = gp0CommandWordCountForOpcode(m_gp0Fifo.peek() >> GX_GPU_GP0_OPCODE_SHIFT);
		}
		while (m_gp0CommandWordCount < m_gp0CommandTargetWordCount && !m_gp0Fifo.empty()) {
			m_gp0CommandWords[m_gp0CommandWordCount] = m_gp0Fifo.pop();
			m_gp0CommandWordCount += 1u;
		}
		if (m_gp0CommandWordCount != m_gp0CommandTargetWordCount) {
			return;
		}
		executeGp0Command(commandStartCycle);
	}
}

void GxGpu::beginCommandCompletion(i64 commandTicks, size_t targetCommandCount, i64 commandStartCycle) {
	if (commandTicks == 0) {
		if (targetCommandCount > m_commandBuffer.executedCommandCount) {
			m_commandBuffer.completeCommandExecution(targetCommandCount);
		}
		return;
	}
	m_pendingCommandTargetCount = targetCommandCount;
	m_pendingCommandCompletionCycle = commandStartCycle + ((commandTicks + 1) >> 1u);
	rescheduleDeviceService();
}

void GxGpu::executeGp0Command(i64 commandStartCycle) {
	const u32 opcode = m_gp0CommandWords[0] >> GX_GPU_GP0_OPCODE_SHIFT;
	const u32 commandWordCount = m_gp0CommandWordCount;
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;

	switch (opcode) {
	case GX_GPU_GP0_FILL_RECTANGLE:
		emitFixedGp0Command(GX_GPU_COMMAND_FILL_RECTANGLE, opcode, commandWordCount, commandStartCycle);
		break;
	case GX_GPU_GP0_IRQ_REQUEST:
		if ((m_statusWord & GX_GPU_STATUS_INTERRUPT_REQUEST) == 0u) {
			m_statusWord |= GX_GPU_STATUS_INTERRUPT_REQUEST;
			m_irq.raise(IRQ_GPU);
		}
		beginCommandCompletion(1, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_DRAW_MODE:
		writeDrawModeWord(m_gp0CommandWords[0] & GX_GPU_GP0_PARAM_MASK);
		beginCommandCompletion(1, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_TEXTURE_WINDOW:
		m_textureWindowWord = m_gp0CommandWords[0] & GX_GPU_TEXTURE_WINDOW_MASK;
		beginCommandCompletion(1, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_MASK_BIT:
		writeMaskBitModeWord(m_gp0CommandWords[0] & GX_GPU_GP0_PARAM_MASK);
		beginCommandCompletion(1, m_commandBuffer.commandCount, commandStartCycle);
		break;
	default:
		if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) {
			if ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) != 0u) {
				const u32 texturePageWord = m_gp0CommandWords[gxGpuPolygonTexturePageWordIndex(opcode)];
				writeDrawModeWord(gxGpuPolygonDrawModeWord(m_drawModeWord, gxGpuTextureAttribute(texturePageWord)));
			}
			emitFixedGp0Command(GX_GPU_COMMAND_DRAW_POLYGON, opcode, commandWordCount, commandStartCycle);
		} else if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) {
			if ((opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) != 0u) {
				beginPolylinePayload(opcode, commandWordCount);
			} else {
				emitFixedGp0Command(GX_GPU_COMMAND_DRAW_LINE, opcode, commandWordCount, commandStartCycle);
			}
		} else if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) {
			emitFixedGp0Command(GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, commandWordCount, commandStartCycle);
		} else if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) {
			emitFixedGp0Command(GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, opcode, commandWordCount, commandStartCycle);
		} else if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) {
			beginImageLoadToVram(opcode, commandWordCount);
		} else if (opcode >= GX_GPU_GP0_VRAM_TO_CPU_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) {
			emitFixedGp0Command(GX_GPU_COMMAND_READ_VRAM_TO_CPU, opcode, commandWordCount, commandStartCycle);
		} else {
			beginCommandCompletion(1, m_commandBuffer.commandCount, commandStartCycle);
		}
		break;
	}
}

u32 GxGpu::readStatus() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	updateScanoutStatusBits();
	updateDynamicStatusBits();
	return m_statusWord;
}

u32 GxGpu::writeGp1(u32 word) {
	const i64 nowCycles = m_scheduler.currentNowCycles();
	synchronizeCommandExecution(nowCycles);
	m_gp1Word = word;
	const u32 opcode = word >> GX_GPU_GP1_OPCODE_SHIFT;
	switch (opcode) {
	case GX_GPU_GP1_RESET:
		clearGp0Fifo(nowCycles);
		resetGpuRegisters();
		break;
	case GX_GPU_GP1_CLEAR_FIFO:
		clearGp0Fifo(nowCycles);
		writeStatusIo();
		break;
	case GX_GPU_GP1_ACK_INTERRUPT:
		m_statusWord &= ~GX_GPU_STATUS_INTERRUPT_REQUEST;
		writeStatusIo();
		break;
	case GX_GPU_GP1_DISPLAY_DISABLE:
		writeDisplayDisableWord(word);
		break;
	case GX_GPU_GP1_DMA_DIRECTION:
		writeDmaDirectionWord(word);
		break;
	case GX_GPU_GP1_DISPLAY_START:
		m_displayStartWord = word & GX_GPU_DISPLAY_START_MASK;
		updateScanoutStatusBits();
		writeStatusIo();
		break;
	case GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE:
		m_horizontalDisplayRangeWord = word & GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK;
		writeStatusIo();
		break;
	case GX_GPU_GP1_VERTICAL_DISPLAY_RANGE:
		m_verticalDisplayRangeWord = word & GX_GPU_VERTICAL_DISPLAY_RANGE_MASK;
		writeStatusIo();
		break;
	case GX_GPU_GP1_DISPLAY_MODE:
		writeDisplayModeWord(word & GX_GPU_DISPLAY_MODE_MASK);
		break;
	case GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION:
		m_vramYAddressExtensionWord = word & 0x1u;
		updateScanoutStatusBits();
		writeStatusIo();
		break;
	case GX_GPU_GP1_GET_GPU_INFO:
		writeGpuInfoQuery(word);
		break;
	default:
		if (opcode >= GX_GPU_GP1_GET_GPU_INFO && opcode <= GX_GPU_GP1_GET_GPU_INFO_LAST) {
			writeGpuInfoQuery(word);
		} else {
			writeStatusIo();
		}
		break;
	}
	return opcode;
}

void GxGpu::writePcrtcRegister(u32 index, u32 word) {
	const i64 nowCycles = m_scheduler.currentNowCycles();
	if (index < GX_GPU_PCRTC_CONFIG_WORD_COUNT) {
		if (m_pcrtc.writeConfigWord(index, word, nowCycles)) {
			m_pcrtcTimingPublicationPending = true;
			rescheduleDeviceService(true);
		}
		return;
	}
	if (index == GX_GPU_PCRTC_CSR_LOW) {
		const u32 actions = m_pcrtc.writeCsr(word, nowCycles);
		if ((actions & GX_GPU_PCRTC_CSR_RESET) != 0u) {
			clearGp0Fifo(nowCycles);
			resetGpuRegisters();
			m_pcrtc.reset(nowCycles);
			m_pcrtcTimingPublicationPending = true;
			latchPresentationRegisters();
			m_pcrtcPresentationPending = true;
		} else if ((actions & GX_GPU_PCRTC_CSR_FLUSH) != 0u) {
			clearGp0Fifo(nowCycles);
		}
		rescheduleDeviceService(true);
		return;
	}
	if (index == GX_GPU_PCRTC_IMR_LOW && m_pcrtc.writeImr(word)) {
		m_irq.raise(IRQ_GX_PCRTC);
	}
}

u32 GxGpu::readDisplayModeWord() const {
	return m_displayModeWord;
}

void GxGpu::writeDisplayModeWord(u32 word) {
	m_displayModeWord = word;
	updateDisplayModeStatusBits();
	writeStatusIo();
}

void GxGpu::setTiming(i64 cpuHz, i64 nowCycles) {
	if (!m_pcrtc.setCpuHz(cpuHz, nowCycles)) return;
	m_pcrtcTimingPublicationPending = true;
	rescheduleDeviceService(true);
	updateScanoutStatusBits();
	writeStatusIo();
}

u32 GxGpu::readGpuReadWord() const {
	return m_gpuReadWord;
}

const GxGpuDeviceOutput& GxGpu::readDeviceOutput() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	updateScanoutStatusBits();
	updateDynamicStatusBits();
	m_deviceOutput.statusWord = m_presentStatusWord;
	m_deviceOutput.displayModeWord = m_presentDisplayModeWord;
	m_deviceOutput.displayStartWord = m_presentDisplayStartWord;
	m_deviceOutput.vramYAddressExtensionWord = m_presentVramYAddressExtensionWord;
	m_deviceOutput.horizontalDisplayRangeWord = m_presentHorizontalDisplayRangeWord;
	m_deviceOutput.verticalDisplayRangeWord = m_presentVerticalDisplayRangeWord;
	m_deviceOutput.vramSnapshotSerial = m_vramSnapshotSerial;
	m_deviceOutput.vramReplacementSerial = m_vramReplacementSerial;
	return m_deviceOutput;
}

void GxGpu::presentReadyFrameOnVblankEdge() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	updateScanoutStatusBits();
	updateDynamicStatusBits();
	// A field edge exposes the other retained scanout field even when no GP0 work completed.
	constexpr u32 visibleStatusMask = GX_GPU_STATUS_DISPLAY_DISABLE | GX_GPU_STATUS_INTERLACED_FIELD;
	const u32 visibleStatusWord = m_statusWord & visibleStatusMask;
	const bool pcrtcChanged = m_pcrtc.latchPresentationWords();
	const bool scanoutStateChanged = (m_presentStatusWord & visibleStatusMask) != visibleStatusWord
		|| m_presentDisplayModeWord != m_displayModeWord
		|| m_presentDisplayStartWord != m_displayStartWord
		|| m_presentVramYAddressExtensionWord != m_vramYAddressExtensionWord
		|| m_presentHorizontalDisplayRangeWord != m_horizontalDisplayRangeWord
		|| m_presentVerticalDisplayRangeWord != m_verticalDisplayRangeWord
		|| pcrtcChanged
		|| m_pcrtcPresentationPending;
	latchPresentationRegisters();
	m_commandBuffer.sealCommandsForPresentation();
	m_lastFrameCommitted = m_vramPresentationPending
		|| m_commandBuffer.hasUnretiredPresentCommands()
		|| scanoutStateChanged;
	m_pcrtcPresentationPending = false;
}

void GxGpu::retirePresentedCommands() {
	const size_t retiredCommands = m_commandBuffer.presentCommandCount;
	retireCommandPrefix(retiredCommands);
	m_vramPresentationPending = false;
	notifySupervisorBoundary();
}

void GxGpu::retireCommandPrefix(size_t retiredCommands) {
	const size_t retiredWords = m_commandBuffer.retireCommandsPreservingVram(retiredCommands);
	if (m_pendingCommandTargetCount != 0u) {
		m_pendingCommandTargetCount -= retiredCommands;
	}
	if (retiredWords != 0u) {
		if (m_gp0ImageLoadCommandWordCount != 0u) {
			m_gp0ImageLoadCommandWordStart -= retiredWords;
		}
		if (m_gp0PolylineCommandWordCount != 0u) {
			m_gp0PolylineCommandWordStart -= retiredWords;
		}
	}
}

u32 GxGpu::readDrawModeWord() const {
	return m_drawModeWord;
}

u32 GxGpu::readTextureWindowWord() const {
	return m_textureWindowWord;
}

u32 GxGpu::readDrawingAreaTopLeftWord() const {
	return m_drawingAreaTopLeftWord;
}

u32 GxGpu::readDrawingAreaBottomRightWord() const {
	return m_drawingAreaBottomRightWord;
}

u32 GxGpu::readDrawingOffsetWord() const {
	return m_drawingOffsetWord;
}

u32 GxGpu::readMaskBitModeWord() const {
	return m_maskBitModeWord;
}

u32 GxGpu::readDisplayStartWord() const {
	return m_displayStartWord;
}

u32 GxGpu::readHorizontalDisplayRangeWord() const {
	return m_horizontalDisplayRangeWord;
}

u32 GxGpu::readVerticalDisplayRangeWord() const {
	return m_verticalDisplayRangeWord;
}

u32 GxGpu::readVramYAddressExtensionWord() const {
	return m_vramYAddressExtensionWord;
}

void GxGpu::writeDisplayDisableWord(u32 word) {
	if ((word & 0x1u) != 0u) {
		m_statusWord |= GX_GPU_STATUS_DISPLAY_DISABLE;
	} else {
		m_statusWord &= ~GX_GPU_STATUS_DISPLAY_DISABLE;
	}
	writeStatusIo();
}

void GxGpu::clearGp0CommandState() {
	m_gp0DmaIngress.reset();
	m_gp0Fifo.reset();
	clearGp0IngressState();
	m_pendingCommandCompletionCycle = 0;
	m_pendingCommandTargetCount = 0u;
	m_gp0CommandWords.fill(0u);
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;
	clearImageLoadState();
	clearPolylineState();
	rescheduleDeviceService();
}

void GxGpu::clearGp0Fifo(i64 nowCycles) {
	m_gp0DmaIngress.reset();
	m_gp0Fifo.reset();
	clearGp0IngressState();
	flushImageLoadToVram(nowCycles);
	if (m_gp0PolylineCommandWordCount != 0u) {
		m_commandBuffer.wordCount = m_gp0PolylineCommandWordStart;
	}
	m_commandBuffer.abortReadbackAndQueuedCommands();
	// GP1(01h) completes accepted raster/upload work, but not a C0 removed above.
	if (m_pendingCommandTargetCount > m_commandBuffer.executedCommandCount
		&& m_pendingCommandTargetCount <= m_commandBuffer.commandCount) {
		m_commandBuffer.completeCommandExecution(m_pendingCommandTargetCount);
	}
	m_pendingCommandCompletionCycle = 0;
	m_pendingCommandTargetCount = 0u;
	m_gp0CommandWords.fill(0u);
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;
	clearImageLoadState();
	clearPolylineState();
	rescheduleDeviceService();
}

void GxGpu::clearGp0IngressState() {
	m_gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
	m_gp0IngressWordsRemaining = 0u;
	m_gp0IngressPolylineWordsPerVertex = 0u;
	m_gp0IngressPolylinePayloadPhase = 0u;
}

void GxGpu::clearPolylineState() {
	m_gp0PolylineWordsPerVertex = 0u;
	m_gp0PolylinePayloadPhase = 0u;
	m_gp0PolylineCommandWordStart = 0u;
	m_gp0PolylineCommandWordCount = 0u;
	m_gp0PolylineCommandOpcode = 0u;
}

void GxGpu::clearImageLoadState() {
	m_gp0ImageLoadWordsRemaining = 0u;
	m_gp0ImageLoadCommandWordStart = 0u;
	m_gp0ImageLoadCommandWordCount = 0u;
	m_gp0ImageLoadCommandOpcode = 0u;
}

void GxGpu::finishImageLoadToVram(i64 commandStartCycle) {
	pushGpuCommand(
		GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		m_gp0ImageLoadCommandOpcode,
		m_gp0ImageLoadCommandWordStart,
		m_gp0ImageLoadCommandWordCount,
		commandStartCycle);
	clearImageLoadState();
}

void GxGpu::flushImageLoadToVram(i64 commandStartCycle) {
	if (m_gp0ImageLoadCommandWordCount == 0u) {
		return;
	}
	if (m_gp0ImageLoadCommandWordCount > 3u) {
		finishImageLoadToVram(commandStartCycle);
	} else {
		m_commandBuffer.wordCount = m_gp0ImageLoadCommandWordStart;
		clearImageLoadState();
	}
}

void GxGpu::consumeImageLoadWord(u32 word, i64 commandStartCycle) {
	m_commandBuffer.appendWord(word);
	m_gp0ImageLoadCommandWordCount += 1u;
	m_gp0ImageLoadWordsRemaining -= 1u;
	if (m_gp0ImageLoadWordsRemaining == 0u) {
		finishImageLoadToVram(commandStartCycle);
	}
}

void GxGpu::consumeGp0PolylinePayloadWord(u32 word, i64 commandStartCycle) {
	if (m_gp0PolylinePayloadPhase == 0u && (word & 0xf000f000u) == 0x50005000u) {
		pushGpuCommand(
			GX_GPU_COMMAND_DRAW_POLYLINE,
			m_gp0PolylineCommandOpcode,
			m_gp0PolylineCommandWordStart,
			m_gp0PolylineCommandWordCount,
			commandStartCycle);
		clearPolylineState();
		return;
	}
	m_commandBuffer.appendWord(word);
	m_gp0PolylineCommandWordCount += 1u;
	m_gp0PolylinePayloadPhase += 1u;
	if (m_gp0PolylinePayloadPhase == m_gp0PolylineWordsPerVertex) {
		m_gp0PolylinePayloadPhase = 0u;
	}
}

void GxGpu::beginPolylinePayload(u32 opcode, u32 commandWordCount) {
	m_gp0PolylineCommandWordStart = m_commandBuffer.appendWords(m_gp0CommandWords.data(), commandWordCount);
	m_gp0PolylineCommandWordCount = commandWordCount;
	m_gp0PolylineCommandOpcode = static_cast<u8>(opcode);
	m_gp0PolylineWordsPerVertex = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u ? 2u : 1u;
	m_gp0PolylinePayloadPhase = 0u;
}

u32 GxGpu::gp0CommandWordCountForOpcode(u32 opcode) const {
	if (opcode == GX_GPU_GP0_FILL_RECTANGLE) {
		return 3u;
	}
	if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) {
		return gp0PolygonWordCount(opcode);
	}
	if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) {
		return gp0LineWordCount(opcode);
	}
	if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) {
		return gp0RectangleWordCount(opcode);
	}
	if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) {
		return 4u;
	}
	if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) {
		return 3u;
	}
	return 1u;
}

u32 GxGpu::gp0PolygonWordCount(u32 opcode) const {
	const u32 wordsPerVertex = 1u
		+ ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >> 2u)
		+ ((opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) >> 4u);
	const u32 vertexCount = (opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) != 0u ? 4u : 3u;
	const u32 firstColorWord = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u ? 0u : 1u;
	return wordsPerVertex * vertexCount + firstColorWord;
}

u32 GxGpu::gp0LineWordCount(u32 opcode) const {
	const u32 gouraudLineWordCount = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u ? 4u : 3u;
	return gouraudLineWordCount;
}

u32 GxGpu::gp0RectangleWordCount(u32 opcode) const {
	const u32 textureWordCount = (opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >> 2u;
	const u32 sizeWordCount = (opcode & GX_GPU_GP0_RECTANGLE_SIZE_MASK) == 0u ? 1u : 0u;
	return 2u + textureWordCount + sizeWordCount;
}

void GxGpu::emitFixedGp0Command(u8 kind, u32 opcode, u32 commandWordCount, i64 commandStartCycle) {
	const size_t wordStart = m_commandBuffer.appendWords(m_gp0CommandWords.data(), commandWordCount);
	pushGpuCommand(kind, opcode, wordStart, commandWordCount, commandStartCycle);
}

void GxGpu::pushGpuCommand(u8 kind, u32 opcode, size_t wordStart, u32 commandWordCount, i64 commandStartCycle) {
	m_commandBuffer.pushCommand(
		kind,
		static_cast<u8>(opcode),
		wordStart,
		commandWordCount,
		m_drawModeWord,
		static_cast<u8>(m_vramYAddressExtensionWord),
		m_textureWindowWord,
		m_drawingAreaTopLeftWord,
		m_drawingAreaBottomRightWord,
		m_drawingOffsetWord,
		m_maskBitModeWord,
		m_skippedLineParity);
	beginCommandCompletion(
		gxGpuCommandTicks(
			kind,
			static_cast<u8>(opcode),
			m_commandBuffer.words.data(),
			wordStart,
			commandWordCount,
			m_drawModeWord,
			m_vramYAddressExtensionWord,
			m_drawingAreaTopLeftWord,
			m_drawingAreaBottomRightWord,
			m_drawingOffsetWord,
			m_maskBitModeWord,
			m_skippedLineParity),
		m_commandBuffer.commandCount,
		commandStartCycle);
}

void GxGpu::beginImageLoadToVram(u32 opcode, u32 commandWordCount) {
	const u32 sizeWord = m_gp0CommandWords[2];
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	m_gp0ImageLoadCommandWordStart = m_commandBuffer.appendWords(m_gp0CommandWords.data(), commandWordCount);
	m_gp0ImageLoadCommandWordCount = commandWordCount;
	m_gp0ImageLoadCommandOpcode = static_cast<u8>(opcode);
	m_gp0ImageLoadWordsRemaining = ((width * height) + 1u) >> 1u;
}

void GxGpu::writeDrawModeWord(u32 word) {
	m_drawModeWord = word & GX_GPU_DRAW_MODE_MASK;
	updateDrawModeStatusBits();
}

void GxGpu::updateDrawModeStatusBits() {
	const u32 texturePageYHigh = (m_drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH) != 0u
		? GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH
		: 0u;
	m_statusWord = (m_statusWord & ~(GX_GPU_DRAW_MODE_GPUSTAT_MASK | GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH))
		| (m_drawModeWord & GX_GPU_DRAW_MODE_GPUSTAT_MASK)
		| texturePageYHigh;
	updateSkippedLineParity();
}

void GxGpu::writeMaskBitModeWord(u32 word) {
	m_maskBitModeWord = word & GX_GPU_MASK_BIT_MODE_MASK;
	m_statusWord = (m_statusWord & ~((1u << 11u) | (1u << 12u))) | (m_maskBitModeWord << 11u);
}

void GxGpu::writeGpuInfoQuery(u32 word) {
	switch (word & GX_GPU_GP1_GET_GPU_INFO_INDEX_MASK) {
	case 0x02u:
		m_gpuReadWord = m_textureWindowWord;
		break;
	case 0x03u:
		m_gpuReadWord = m_drawingAreaTopLeftWord;
		break;
	case 0x04u:
		m_gpuReadWord = m_drawingAreaBottomRightWord;
		break;
	case 0x05u:
		m_gpuReadWord = m_drawingOffsetWord;
		break;
	case 0x07u:
		m_gpuReadWord = GX_GPU_INFO_GPU_TYPE_V2;
		break;
	case 0x08u:
		m_gpuReadWord = 0u;
		break;
	}
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gpuReadWord)));
	writeStatusIo();
}

void GxGpu::writeDmaDirectionWord(u32 word) {
	const u32 previousDmaDirection = (m_statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >> GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
	const u32 dmaDirection = word & 0x3u;
	if (previousDmaDirection == GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU
		&& dmaDirection != GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
		m_commandBuffer.readback.setDmaReadEnabled(false);
	}
	const u32 dmaDirectionBits = dmaDirection << GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_DMA_DIRECTION_MASK) | dmaDirectionBits;
	writeStatusIo();
	if (previousDmaDirection != GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU
		&& dmaDirection == GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
		m_commandBuffer.readback.setDmaReadEnabled(true);
	}
}

void GxGpu::updateCommandStatusBits() {
	u32 commandStatusBits = 0u;
	const bool readbackIdle = m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE;
	bool readyToReceiveDma = false;
	if (readbackIdle && !m_supervisorIngressStopped && m_gp0DmaIngress.empty()) {
		if (m_gp0ImageLoadWordsRemaining != 0u) {
			readyToReceiveDma = m_gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY;
		} else if (m_gp0PolylineWordsPerVertex != 0u) {
			readyToReceiveDma = false;
		} else if (m_gp0CommandWordCount == 0u && m_gp0Fifo.empty()) {
			readyToReceiveDma = true;
		} else {
			const bool assemblingPacket = m_gp0CommandWordCount != 0u;
			const u32 opcode = (assemblingPacket ? m_gp0CommandWords[0] : m_gp0Fifo.peek()) >> GX_GPU_GP0_OPCODE_SHIFT;
			const u32 packetWordCount = assemblingPacket ? m_gp0CommandWordCount : m_gp0Fifo.count();
			const u32 packetTargetWordCount = assemblingPacket ? m_gp0CommandTargetWordCount : gp0CommandWordCountForOpcode(opcode);
			const bool polygonOrLinePacket = opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_LINE_LAST;
			readyToReceiveDma = !polygonOrLinePacket && packetWordCount < packetTargetWordCount;
		}
	}
	if (readyToReceiveDma) {
		commandStatusBits |= GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
	}
	if (m_commandBuffer.readback.phase() == GX_GPU_READBACK_READY) {
		commandStatusBits |= GX_GPU_STATUS_READY_TO_SEND_VRAM;
	}
	if (readbackIdle
		&& m_pendingCommandCompletionCycle == 0
		&& m_gp0DmaIngress.empty()
		&& m_gp0Fifo.empty()
		&& m_gp0CommandWordCount == 0u
		&& m_gp0ImageLoadWordsRemaining == 0u
		&& m_gp0PolylineWordsPerVertex == 0u) {
		commandStatusBits |= GX_GPU_STATUS_GPU_IDLE;
	}
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_COMMAND_STATE_MASK) | commandStatusBits;
	// CPU stores need one physical FIFO slot; DMA packet acceptance is a
	// separate, stricter GPUSTAT line while a command is being assembled.
	if (!m_supervisorIngressStopped
		&& m_gp0DmaIngress.empty()
		&& m_gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY
		&& !m_dmaController.ownsWritePort(IO_GX_GPU_GP0)) {
		m_cpu.resumeMemoryWrite(IO_GX_GPU_GP0);
	}
}

void GxGpu::updateDynamicStatusBits() {
	updateCommandStatusBits();
	updateDmaRequestStatusBit();
}

void GxGpu::updateDmaRequestStatusBit() {
	const u32 dmaDirection = (m_statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >> GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
	u32 dmaRequest = 0u;
	if (dmaDirection == GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
		dmaRequest = m_statusWord & GX_GPU_STATUS_READY_TO_SEND_VRAM;
	} else if (!m_supervisorIngressStopped) {
		switch (dmaDirection) {
		case GX_GPU_DMA_DIRECTION_FIFO:
			dmaRequest = m_gp0DmaIngress.empty() && m_gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY
				? GX_GPU_STATUS_DMA_DATA_REQUEST
				: 0u;
			break;
		case GX_GPU_DMA_DIRECTION_CPU_TO_GP0:
			dmaRequest = m_statusWord & GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
			break;
		}
	}
	if (dmaRequest != 0u) {
		m_statusWord |= GX_GPU_STATUS_DMA_DATA_REQUEST;
	} else {
		m_statusWord &= ~GX_GPU_STATUS_DMA_DATA_REQUEST;
	}
	const u32 writeRequestBit = 1u << DMA_REQUEST_GX_WRITE;
	u32 assertedRequests = 0u;
	if ((dmaDirection == GX_GPU_DMA_DIRECTION_FIFO || dmaDirection == GX_GPU_DMA_DIRECTION_CPU_TO_GP0)
		&& dmaRequest != 0u) {
		assertedRequests = writeRequestBit;
	}
	m_dmaController.setRequestLines(
		writeRequestBit,
		assertedRequests);
}

bool GxGpu::gpuStatInInterleaved480iMode() const {
	return (m_statusWord & (GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE)) == (GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE);
}

int GxGpu::scanoutLine() const {
	return static_cast<int>(m_pcrtc.currentHalfLine(m_scheduler.currentNowCycles()) / 2u);
}

void GxGpu::updateScanoutStatusBits() {
	if (!m_pcrtc.timing.running) {
		updateSkippedLineParity();
		return;
	}
	m_scanoutInterlacedField = m_pcrtc.field();
	m_scanoutInterlacedDisplayField = m_scanoutInterlacedField;
	u32 scanoutBits = 0u;
	const u32 displayStartY = gxGpuDisplayStartY(m_displayStartWord, m_vramYAddressExtensionWord);
	if (gpuStatInInterleaved480iMode()) {
		m_scanoutActiveLineLsb = (displayStartY + m_scanoutInterlacedDisplayField) & 1u;
		const u32 displayedField = m_pcrtc.vblankActive() ? 0u : m_scanoutInterlacedDisplayField;
		if (((displayStartY + displayedField) & 1u) != 0u) {
			scanoutBits |= GX_GPU_STATUS_DISPLAY_LINE_LSB;
		}
	} else {
		m_scanoutActiveLineLsb = 0u;
		if (((displayStartY + static_cast<u32>(scanoutLine())) & 1u) != 0u) {
			scanoutBits |= GX_GPU_STATUS_DISPLAY_LINE_LSB;
		}
	}
	if ((m_statusWord & GX_GPU_STATUS_VERTICAL_INTERLACE) == 0u || m_scanoutInterlacedField == 0u) {
		scanoutBits |= GX_GPU_STATUS_INTERLACED_FIELD;
	}
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_SCANOUT_MASK) | scanoutBits;
	updateSkippedLineParity();
}

void GxGpu::updateSkippedLineParity() {
	m_skippedLineParity = (m_statusWord & GX_GPU_STATUS_SKIP_ACTIVE_FIELD_MASK) == GX_GPU_STATUS_SKIP_ACTIVE_FIELD_WORD
		? static_cast<u8>(m_scanoutActiveLineLsb)
		: GX_GPU_SKIPPED_LINE_NONE;
}

void GxGpu::updateDisplayModeStatusBits() {
	const u32 displayMode = m_displayModeWord;
	const u32 statusDisplayModeBits = ((displayMode & 0x03u) << GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT)
		| ((displayMode & 0x04u) << 17u)
		| ((displayMode & 0x08u) << 17u)
		| ((displayMode & 0x10u) << 17u)
		| ((displayMode & 0x20u) << 17u)
		| ((displayMode & 0x40u) << 10u);
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_DISPLAY_MODE_MASK) | statusDisplayModeBits;
	updateScanoutStatusBits();
}

void GxGpu::writeStatusIo() {
	updateDynamicStatusBits();
	m_memory.writeIoValue(IO_GX_GPU_GP1, valueNumber(static_cast<double>(m_statusWord)));
}

bool GxGpu::gp0WriteReady(MappedBusSignals busSignals) {
	if ((busSignals & MAPPED_BUS_MASTER_DMA) != 0u) {
		return !m_supervisorIngressStopped;
	}
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	updateDynamicStatusBits();
	return !m_supervisorIngressStopped
		&& m_gp0DmaIngress.empty()
		&& m_gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY
		&& !m_dmaController.ownsWritePort(IO_GX_GPU_GP0);
}

void GxGpu::notifySupervisorBoundary() {
	if (supervisorFenceReady()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	}
}

u64 GxGpu::readGp0Thunk(void* context, u32 addr, MappedBusSignals busSignals) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	return valueNumber(static_cast<double>(gpu.readGp0(busSignals)));
}

void GxGpu::writeGp0Thunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	gpu.writeGp0(toU32(value), busSignals);
}

bool GxGpu::gp0WriteReadyThunk(void* context, u32 addr, MappedBusSignals busSignals) {
	(void)addr;
	return static_cast<GxGpu*>(context)->gp0WriteReady(busSignals);
}

bool GxGpu::gp1WriteReadyThunk(void* context, u32 addr, MappedBusSignals) {
	(void)addr;
	return !static_cast<GxGpu*>(context)->m_supervisorQuiesceRequested;
}

u64 GxGpu::readStatusThunk(void* context, u32 addr, MappedBusSignals) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	return valueNumber(static_cast<double>(gpu.readStatus()));
}

void GxGpu::writeGp1Thunk(void* context, u32 addr, u64 value, MappedBusSignals) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	gpu.writeGp1(toU32(value));
}

u64 GxGpu::readPcrtcThunk(void* context, u32 address, MappedBusSignals) {
	const u32 index = address < IO_GX_PCRTC_TIMING_BASE
		? (address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE
		: IO_GX_PCRTC_WORD_COUNT + (address - IO_GX_PCRTC_TIMING_BASE) / IO_WORD_SIZE;
	return valueNumber(static_cast<double>(static_cast<GxGpu*>(context)->m_pcrtc.readRegisterWord(index)));
}

void GxGpu::writePcrtcThunk(void* context, u32 address, u64 value, MappedBusSignals) {
	const u32 index = address < IO_GX_PCRTC_TIMING_BASE
		? (address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE
		: IO_GX_PCRTC_WORD_COUNT + (address - IO_GX_PCRTC_TIMING_BASE) / IO_WORD_SIZE;
	static_cast<GxGpu*>(context)->writePcrtcRegister(index, toU32(value));
}

} // namespace bmsx
