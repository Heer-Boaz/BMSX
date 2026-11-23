#include "machine/devices/gx/gpu.h"

#include "common/compiler.h"

#include "spec/bmsx/io.h"
#include "spec/gx/gp1.h"
#include "spec/gx/pcrtc.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/gx/gpu_command_timing.h"
#include "machine/devices/gx/vram_power_on.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

#include <algorithm>

namespace bmsx {

namespace {

constexpr u32 GX_GPU_STATUS_SKIP_ACTIVE_FIELD_MASK = GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE | GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD;
constexpr u32 GX_GPU_STATUS_SKIP_ACTIVE_FIELD_WORD = GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE;

} // namespace

GxGpu::GxGpu(
	Memory& memory,
	CPU& cpu,
	IrqController& irq,
	DeviceScheduler& scheduler,
	DmaController& dmaController,
	u32 vramByteCount)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_irq(irq)
	, m_scheduler(scheduler)
	, m_dmaController(dmaController)
	, m_commandBuffer(dmaController)
	, m_vramSnapshotBytes(vramByteCount)
	, m_deviceOutput(
		m_commandBuffer,
		m_commandBuffer.readback,
		m_pcrtc.presentWords(),
		m_pcrtc.timing,
		m_pcrtc.scanout,
		m_vramSnapshotBytes) {
	m_dmaController.connectGpu(*this);
	m_userIngressContext.commandBufferWords.reset(new std::array<u32, GX_GPU_COMMAND_WORD_CAPACITY>);
	m_memory.mapIoRead(IO_GX_GPU_GP0, this, &GxGpu::readGp0Thunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP0, this, &GxGpu::writeGp0Thunk);
	m_memory.mapIoWriteReady(IO_GX_GPU_GP0, &GxGpu::gp0WriteReadyThunk);
	m_memory.mapIoDmaWritePrefix(IO_GX_GPU_GP0, &GxGpu::writeGp0PrefixThunk);
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
	initializeGxGpuVramPowerOn(m_vramSnapshotBytes);
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
	m_memory.writeIoU32(IO_GX_GPU_GP0, m_gp0Word);
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
	context.gp0PolylinePayloadPhase = 0u;
	context.gp0PolylineOpcode = 0u;
	context.gp0PolylineColorWord = 0u;
	context.gp0PolylinePositionWord = 0u;
	context.gp0PolylineNextColorWord = 0u;
	context.commandBufferWordCount = 0u;
	context.gp0Fifo.reset();
	context.gp0DmaIngress.reset();
	context.readback.clear();
}

void GxGpu::storeLiveIngressContext(GxGpuIngressContextBank& context) {
	m_preparedCommands.clear();
	m_preparedTimingDirty = true;
	context.gp0CommandTargetWordCount = m_gp0CommandTargetWordCount;
	context.gp0CommandWordCount = m_gp0CommandWordCount;
	std::copy(m_executionPacket.words.begin(), m_executionPacket.words.begin() + static_cast<std::ptrdiff_t>(m_gp0CommandWordCount), context.gp0CommandWords.begin());
	context.gp0IngressPhase = m_gp0Ingress.phase;
	context.gp0IngressWordsRemaining = m_gp0Ingress.wordsRemaining;
	context.gp0IngressPolylineWordsPerVertex = m_gp0Ingress.polylineWordsPerVertex;
	context.gp0IngressPolylinePayloadPhase = m_gp0Ingress.polylinePayloadPhase;
	context.gp0ImageLoadWordsRemaining = m_gp0ImageLoadWordsRemaining;
	context.gp0ImageLoadCommandWordStart = m_gp0ImageLoadCommandWordStart;
	context.gp0ImageLoadCommandWordCount = m_gp0ImageLoadCommandWordCount;
	context.gp0ImageLoadCommandOpcode = m_gp0ImageLoadCommandOpcode;
	context.gp0PolylinePayloadPhase = m_gp0PolylinePayloadPhase;
	context.gp0PolylineOpcode = m_gp0PolylineOpcode;
	context.gp0PolylineColorWord = m_gp0PolylineColorWord;
	context.gp0PolylinePositionWord = m_gp0PolylinePositionWord;
	context.gp0PolylineNextColorWord = m_gp0PolylineNextColorWord;
	context.commandBufferWordCount = m_commandBuffer.wordCount;
	std::copy(m_commandBuffer.words.begin(), m_commandBuffer.words.begin() + static_cast<std::ptrdiff_t>(m_commandBuffer.wordCount), context.commandBufferWords->begin());
	std::swap(m_gp0Fifo, context.gp0Fifo);
	std::swap(m_gp0DmaIngress, context.gp0DmaIngress);
	m_commandBuffer.readback.swapContext(context.readback);
}

void GxGpu::loadLiveIngressContext(GxGpuIngressContextBank& context) {
	m_preparedCommands.clear();
	m_preparedTimingDirty = true;
	m_gp0CommandWordCount = context.gp0CommandWordCount;
	m_gp0CommandTargetWordCount = context.gp0CommandTargetWordCount;
	std::copy(context.gp0CommandWords.begin(), context.gp0CommandWords.begin() + static_cast<std::ptrdiff_t>(context.gp0CommandWordCount), m_executionPacket.words.begin());
	m_gp0Ingress.phase = context.gp0IngressPhase;
	m_gp0Ingress.wordsRemaining = context.gp0IngressWordsRemaining;
	m_gp0Ingress.polylineWordsPerVertex = context.gp0IngressPolylineWordsPerVertex;
	m_gp0Ingress.polylinePayloadPhase = context.gp0IngressPolylinePayloadPhase;
	m_gp0ImageLoadWordsRemaining = context.gp0ImageLoadWordsRemaining;
	m_gp0ImageLoadCommandWordStart = context.gp0ImageLoadCommandWordStart;
	m_gp0ImageLoadCommandWordCount = context.gp0ImageLoadCommandWordCount;
	m_gp0ImageLoadCommandOpcode = context.gp0ImageLoadCommandOpcode;
	m_gp0PolylinePayloadPhase = context.gp0PolylinePayloadPhase;
	m_gp0PolylineOpcode = context.gp0PolylineOpcode;
	m_gp0PolylineColorWord = context.gp0PolylineColorWord;
	m_gp0PolylinePositionWord = context.gp0PolylinePositionWord;
	m_gp0PolylineNextColorWord = context.gp0PolylineNextColorWord;
	m_commandBuffer.wordCount = context.commandBufferWordCount;
	std::copy(context.commandBufferWords->begin(), context.commandBufferWords->begin() + static_cast<std::ptrdiff_t>(context.commandBufferWordCount), m_commandBuffer.words.begin());
	std::swap(m_gp0Fifo, context.gp0Fifo);
	std::swap(m_gp0DmaIngress, context.gp0DmaIngress);
	m_commandBuffer.readback.swapContext(context.readback);
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
	state.gp0PolylinePayloadPhase = context.gp0PolylinePayloadPhase;
	state.gp0PolylineOpcode = context.gp0PolylineOpcode;
	state.gp0PolylineColorWord = context.gp0PolylineColorWord;
	state.gp0PolylinePositionWord = context.gp0PolylinePositionWord;
	state.gp0PolylineNextColorWord = context.gp0PolylineNextColorWord;
	state.commandBufferWords.assign(context.commandBufferWords->begin(), context.commandBufferWords->begin() + static_cast<std::ptrdiff_t>(context.commandBufferWordCount));
	state.gp0FifoWords = context.gp0Fifo.captureWords();
	state.gp0DmaIngressWords = context.gp0DmaIngress.captureWords();
	state.readbackPhase = context.readback.phase;
	state.readbackFenceCommandCount = context.readback.fenceCommandCount;
	state.readbackX = context.readback.x;
	state.readbackY = context.readback.y;
	state.readbackVramYAddressExtensionWord = context.readback.vramYAddressExtensionWord;
	state.readbackWidth = context.readback.width;
	state.readbackHeight = context.readback.height;
	state.readbackPixelCursor = context.readback.pixelCursor;
	if (context.readback.phase == GX_GPU_READBACK_READY) {
		state.readbackPixelBytes.assign(context.readback.pixelBytes.get(), context.readback.pixelBytes.get() + static_cast<size_t>(context.readback.width) * context.readback.height * 2u);
	}
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
	context.gp0PolylinePayloadPhase = state.gp0PolylinePayloadPhase;
	context.gp0PolylineOpcode = state.gp0PolylineOpcode;
	context.gp0PolylineColorWord = state.gp0PolylineColorWord;
	context.gp0PolylinePositionWord = state.gp0PolylinePositionWord;
	context.gp0PolylineNextColorWord = state.gp0PolylineNextColorWord;
	context.commandBufferWordCount = state.commandBufferWords.size();
	std::copy(state.commandBufferWords.begin(), state.commandBufferWords.end(), context.commandBufferWords->begin());
	context.gp0Fifo.restoreWords(state.gp0FifoWords);
	context.gp0DmaIngress.restoreWords(state.gp0DmaIngressWords);
	context.readback.phase = state.readbackPhase;
	context.readback.fenceCommandCount = state.readbackFenceCommandCount;
	context.readback.x = state.readbackX;
	context.readback.y = state.readbackY;
	context.readback.vramYAddressExtensionWord = state.readbackVramYAddressExtensionWord;
	context.readback.width = state.readbackWidth;
	context.readback.height = state.readbackHeight;
	context.readback.pixelCursor = state.readbackPixelCursor;
	std::copy(state.readbackPixelBytes.begin(), state.readbackPixelBytes.end(), context.readback.pixelBytes.get());
}

void GxGpu::resetTransientContext() {
	m_gp0Fifo.reset();
	m_preparedCommands.clear();
	m_preparedTimingDirty = true;
	m_gp0DmaIngress.reset();
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
	m_memory.writeIoU32(IO_GX_GPU_GP0, m_gpuReadWord);
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
	state.gp0CommandWords.assign(m_executionPacket.words.begin(), m_executionPacket.words.begin() + static_cast<std::ptrdiff_t>(m_gp0CommandWordCount));
	state.gp0FifoWords = m_gp0Fifo.captureWords();
	state.gp0DmaIngressWords = m_gp0DmaIngress.captureWords();
	state.gp0IngressPhase = m_gp0Ingress.phase;
	state.gp0IngressWordsRemaining = m_gp0Ingress.wordsRemaining;
	state.gp0IngressPolylineWordsPerVertex = m_gp0Ingress.polylineWordsPerVertex;
	state.gp0IngressPolylinePayloadPhase = m_gp0Ingress.polylinePayloadPhase;
	state.pendingCommandCycles = m_pendingCommandCompletionCycle == 0
		? 0
		: m_pendingCommandCompletionCycle - nowCycles;
	state.pendingCommandTargetCount = m_pendingCommandTargetCount;
	state.gp0ImageLoadWordsRemaining = m_gp0ImageLoadWordsRemaining;
	state.gp0ImageLoadCommandWordStart = m_gp0ImageLoadCommandWordStart;
	state.gp0ImageLoadCommandWordCount = m_gp0ImageLoadCommandWordCount;
	state.gp0ImageLoadCommandOpcode = m_gp0ImageLoadCommandOpcode;
	state.gp0PolylinePayloadPhase = m_gp0PolylinePayloadPhase;
	state.gp0PolylineOpcode = m_gp0PolylineOpcode;
	state.gp0PolylineColorWord = m_gp0PolylineColorWord;
	state.gp0PolylinePositionWord = m_gp0PolylinePositionWord;
	state.gp0PolylineNextColorWord = m_gp0PolylineNextColorWord;
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
	m_preparedCommands.clear();
	m_preparedTimingDirty = true;
	m_commandBuffer.readback.setDmaReadEnabled(false);
	m_gp0Word = state.gp0Word;
	m_gp1Word = state.gp1Word;
	m_displayModeWord = state.displayModeWord;
	m_statusWord = state.statusWord;
	m_gp0Fifo.restoreWords(state.gp0FifoWords);
	m_gp0DmaIngress.restoreWords(state.gp0DmaIngressWords);
	m_gp0Ingress.phase = state.gp0IngressPhase;
	m_gp0Ingress.wordsRemaining = state.gp0IngressWordsRemaining;
	m_gp0Ingress.polylineWordsPerVertex = state.gp0IngressPolylineWordsPerVertex;
	m_gp0Ingress.polylinePayloadPhase = state.gp0IngressPolylinePayloadPhase;
	m_pendingCommandTargetCount = state.pendingCommandTargetCount;
	m_gp0CommandWordCount = state.gp0CommandWordCount;
	m_gp0CommandTargetWordCount = state.gp0CommandTargetWordCount;
	for (size_t index = 0u; index < m_gp0CommandWordCount; index += 1u) {
		m_executionPacket.words[index] = state.gp0CommandWords[index];
	}
	m_gp0ImageLoadWordsRemaining = state.gp0ImageLoadWordsRemaining;
	m_gp0ImageLoadCommandWordStart = state.gp0ImageLoadCommandWordStart;
	m_gp0ImageLoadCommandWordCount = state.gp0ImageLoadCommandWordCount;
	m_gp0ImageLoadCommandOpcode = state.gp0ImageLoadCommandOpcode;
	m_gp0PolylinePayloadPhase = state.gp0PolylinePayloadPhase;
	m_gp0PolylineOpcode = state.gp0PolylineOpcode;
	m_gp0PolylineColorWord = state.gp0PolylineColorWord;
	m_gp0PolylinePositionWord = state.gp0PolylinePositionWord;
	m_gp0PolylineNextColorWord = state.gp0PolylineNextColorWord;
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
	rebuildGp0Producer();
	rescheduleDeviceService(true, true);
	m_lastFrameCommitted = false;
	updateScanoutStatusBits();
	m_memory.writeIoU32(IO_GX_GPU_GP0, m_gp0Word);
	writeStatusIo();
	if (((m_statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >> GX_GPU_STATUS_DMA_DIRECTION_SHIFT)
		== GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
		m_commandBuffer.readback.setDmaReadEnabled(true);
	}
}

void GxGpu::beginSupervisorControlQuiesce() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	m_supervisorQuiesceRequested = true;
	rescheduleDeviceService();
	updateDynamicStatusBits();
}

void GxGpu::beginSupervisorQuiesce() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	m_supervisorQuiesceRequested = true;
	m_supervisorIngressQuiesceRequested = true;
	rescheduleDeviceService();
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
		&& (m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE
			|| m_commandBuffer.readback.phase() == GX_GPU_READBACK_READY)
		&& m_commandBuffer.commandCount == 0u
		&& !m_backendSubmissionPending;
}

// USER ingress and unread pixels retain ownership while the transient supervisor runs.
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

// LEAVE tears down supervisor scratch, including its unread readback, then resumes USER.
void GxGpu::leaveSupervisorContext() {
	m_supervisorQuiesceRequested = false;
	m_supervisorIngressQuiesceRequested = false;
	m_supervisorIngressStopped = false;
	resetTransientContext();
	loadLiveIngressContext(m_userIngressContext);
	rebuildGp0Producer();
	loadLiveRegisterContext(m_userContext);
	m_pcrtcPresentationPending = true;
	clearRegisterContext(m_userContext);
	clearIngressContext(m_userIngressContext);
}

GxGpuSaveState GxGpu::captureSaveState(std::vector<u8> vramBytes) {
	GxGpuSaveState state;
	static_cast<GxGpuState&>(state) = captureState();
	vramBytes.assign(m_vramSnapshotBytes.begin(), m_vramSnapshotBytes.end());
	state.vramBytes = std::move(vramBytes);
	return state;
}

void GxGpu::restoreSaveState(const GxGpuSaveState& state) {
	restoreState(state);
	replaceVramSnapshotBytes(state.vramBytes);
}

void GxGpu::replaceVramSnapshotBytes(std::span<const u8> bytes) {
	std::copy_n(bytes.begin(), m_vramSnapshotBytes.size(), m_vramSnapshotBytes.begin());
	publishVramSnapshotRevision();
	publishVramReplacementRevision();
	m_vramPresentationPending = true;
}

u64 GxGpu::commitRenderedVramSnapshotBytes(std::span<const u8> bytes, size_t renderedCommandCount) {
	std::copy_n(bytes.begin(), m_vramSnapshotBytes.size(), m_vramSnapshotBytes.begin());
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
		m_memory.writeIoU32(IO_GX_GPU_GP0, m_gpuReadWord);
	}
	updateDynamicStatusBits();
	notifySupervisorBoundary();
	return m_gpuReadWord;
}

void GxGpu::writeGp0(u32 word, MappedBusSignals busSignals) {
	const bool dmaWrite = (busSignals & MAPPED_BUS_MASTER_DMA) != 0u;
	const i64 nowCycles = m_scheduler.currentNowCycles();
	synchronizeCommandExecution(nowCycles);
	u32 directImageWords = 0u;
	if (dmaWrite) {
		m_gp0Word = word;
		if (m_gp0DmaImagePrefixWords != 0u) {
			m_commandBuffer.words[m_commandBuffer.wordCount + m_gp0DmaImagePrefixWords] = word;
			recordGp0ProducerWord(word);
			directImageWords = m_gp0DmaImagePrefixWords + 1u;
			m_gp0DmaImagePrefixWords = 0u;
		} else if (!m_gp0DmaIngress.full()) {
			m_gp0DmaIngress.writeWord(word);
			recordGp0ProducerWord(word);
		}
		if ((busSignals & MAPPED_BUS_DMA_BLOCK_END) == 0u) {
			return;
		}
	}
	if (!dmaWrite) {
		m_gp0Word = word;
		if (acceptGp0Word(word) != Gp0WordAdmission::Blocked) recordGp0ProducerWord(word);
	}
	m_memory.writeIoU32(IO_GX_GPU_GP0, m_gp0Word);
	processGp0Pipeline(nowCycles, directImageWords);
	rescheduleDeviceService();
	if (m_supervisorIngressQuiesceRequested
		&& m_gp0Ingress.phase == GX_GPU_GP0_INGRESS_COMMAND
		&& !m_dmaController.hasAdmittedWriteBlock(IO_GX_GPU_GP0)) {
		m_supervisorIngressStopped = true;
	}
	updateDynamicStatusBits();
	notifySupervisorBoundary();
}

void GxGpu::recordGp0ProducerWord(u32 word) {
	const u32 boundary = m_gp0Producer.advance(word);
	m_queuedGp0Irqs += boundary & GP0_STREAM_IRQ;
	m_queuedGp0Readbacks += (boundary & GP0_STREAM_READBACK) >> 1u;
}

void GxGpu::rebuildGp0Producer() {
	m_gp0Producer = {};
	m_queuedGp0Irqs = 0u;
	m_queuedGp0Readbacks = 0u;
	if (m_gp0ImageLoadWordsRemaining != 0u) {
		m_gp0Producer.phase = GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD;
		m_gp0Producer.wordsRemaining = m_gp0ImageLoadWordsRemaining;
	} else if (m_gp0PolylineOpcode != 0u) {
		m_gp0Producer.phase = GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD;
		m_gp0Producer.polylineWordsPerVertex = (m_gp0PolylineOpcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u ? 2u : 1u;
		m_gp0Producer.polylinePayloadPhase = m_gp0PolylinePayloadPhase;
	} else {
		for (u32 index = 0u; index < m_gp0CommandWordCount; ++index) recordGp0ProducerWord(m_executionPacket.words[index]);
	}
	for (size_t index = 0u; index < m_gp0Fifo.count(); ++index) recordGp0ProducerWord(m_gp0Fifo.peek(index));
	for (size_t index = 0u; index < m_gp0DmaIngress.count(); ++index) recordGp0ProducerWord(m_gp0DmaIngress.peek(index));
}

Gp0WordAdmission GxGpu::acceptGp0Word(u32 word) {
	const u32 phase = m_gp0Ingress.phase;
	const u32 opcode = word >> GX_GPU_GP0_OPCODE_SHIFT;
	if (phase == GX_GPU_GP0_INGRESS_COMMAND) {
		if (gxGpuGp0OpcodeIsNop(opcode)) {
			return Gp0WordAdmission::Filtered;
		}
	}
	if (m_gp0Fifo.full()) {
		return Gp0WordAdmission::Blocked;
	}
	m_gp0Fifo.writeWord(word);
	m_gp0Ingress.advance(word);
	return Gp0WordAdmission::Queued;
}

void GxGpu::processGp0Pipeline(i64 commandStartCycle, u32 directImageWords) {
	m_processingGp0Pipeline = true;
	if (directImageWords != 0u) {
		m_gp0Ingress.skipPayloadWords(directImageWords);
		commitImageLoadWords(directImageWords, commandStartCycle);
	}
	while (true) {
		consumeGp0Fifo(commandStartCycle);
		bool ingressAdvanced = false;
		while (!m_gp0DmaIngress.empty()) {
			if (m_gp0Ingress.phase == GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD) {
				// An empty, runnable execution FIFO consumes payload at this same
				// edge. Keep the counted stream, without copying through each slot.
				const bool consumingImage = m_gp0Fifo.empty() && m_gp0ImageLoadWordsRemaining != 0u
					&& m_pendingCommandCompletionCycle == 0 && m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE;
				const size_t words = std::min({m_gp0DmaIngress.count(),
					consumingImage ? static_cast<size_t>(m_gp0ImageLoadWordsRemaining) : m_gp0Fifo.free(),
					static_cast<size_t>(m_gp0Ingress.wordsRemaining)});
				if (words == 0u) break;
				m_gp0Ingress.skipPayloadWords(static_cast<u32>(words));
				if (consumingImage) consumeImageLoadWords(m_gp0DmaIngress, words, commandStartCycle);
				else m_gp0DmaIngress.transferWords(m_gp0Fifo, words);
			} else {
				const auto admission = acceptGp0Word(m_gp0DmaIngress.peek());
				if (admission == Gp0WordAdmission::Blocked) break;
				if (admission == Gp0WordAdmission::Filtered && m_preparedCommands.sourceWordCount > m_gp0Fifo.count()) {
					--m_preparedCommands.sourceWordCount;
				}
				m_gp0DmaIngress.pop();
			}
			ingressAdvanced = true;
		}
		if (!ingressAdvanced) break;
	}
	m_processingGp0Pipeline = false;
	const u8 deferred = m_deferredServiceFlags;
	m_deferredServiceFlags = 0u;
	if (deferred != 0u) rescheduleDeviceService((deferred & 2u) != 0u, (deferred & 4u) != 0u);
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
		updateScanoutStatusBits();
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

void GxGpu::copyDrawState(GxGpuDrawState& state) const {
	state.drawModeWord = m_drawModeWord;
	state.vramYAddressExtensionWord = m_vramYAddressExtensionWord;
	state.textureWindowWord = m_textureWindowWord;
	state.drawingAreaTopLeftWord = m_drawingAreaTopLeftWord;
	state.drawingAreaBottomRightWord = m_drawingAreaBottomRightWord;
	state.drawingOffsetWord = m_drawingOffsetWord;
	state.maskBitModeWord = m_maskBitModeWord;
	const u32 interlace = GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE;
	state.skippedLineParity = (m_statusWord & interlace) == interlace
		? static_cast<u8>(m_scanoutActiveLineLsb) : GX_GPU_SKIPPED_LINE_NONE;
}

void GxGpu::prepareGp0Commands() {
	if (m_pendingCommandCompletionCycle == 0 || m_gp0ImageLoadWordsRemaining != 0u
		|| m_gp0CommandWordCount != 0u || m_commandBuffer.readback.phase() != GX_GPU_READBACK_IDLE) return;
	if (m_preparedCommands.count == 0u) {
		m_preparedCommands.sourceWordCount = 0u;
		m_preparedCommands.polylineOpcode = m_gp0PolylineOpcode;
		m_preparedCommands.polylineColorWord = m_gp0PolylineColorWord;
		m_preparedCommands.polylinePositionWord = m_gp0PolylinePositionWord;
		m_preparedCommands.polylineNextColorWord = m_gp0PolylineNextColorWord;
		m_preparedCommands.polylinePayloadPhase = m_gp0PolylinePayloadPhase;
	}
	if (m_preparedTimingDirty || m_preparedCommands.count == 0u) {
		copyDrawState(m_projectedDrawState);
		m_preparedCommands.retime(m_pendingCommandCompletionCycle, m_projectedDrawState);
		m_preparedTimingDirty = false;
	}
	if (m_preparedCommands.count != 0u
		&& m_preparedCommands.packets[m_preparedCommands.index(m_preparedCommands.count - 1u)].kind == GX_GPU_COMMAND_READ_VRAM_TO_CPU) return;
	const i64 startCycle = m_preparedCommands.count == 0u ? m_pendingCommandCompletionCycle
		: m_preparedCommands.completionCycles[m_preparedCommands.index(m_preparedCommands.count - 1u)];
	m_preparedCommands.prepare(m_gp0Fifo, m_gp0DmaIngress, startCycle, m_projectedDrawState);
}

i64 GxGpu::preparedCommandDeadline() const {
	size_t commands = m_commandBuffer.commandCount;
	size_t words = m_commandBuffer.wordCount;
	for (size_t offset = 0u; offset < m_preparedCommands.count; ++offset) {
		const size_t index = m_preparedCommands.index(offset);
		const auto& packet = m_preparedCommands.packets[index];
		if (packet.opcode == GX_GPU_GP0_IRQ_REQUEST) return m_preparedCommands.startCycles[index];
		if (packet.kind == GX_GPU_COMMAND_READ_VRAM_TO_CPU) return m_preparedCommands.completionCycles[index];
		if (packet.kind != 0u) {
			++commands;
			words += packet.wordCount;
			if (commands >= m_backendSubmissionCommandLimit || commands == GX_GPU_COMMAND_CAPACITY
				|| words > GX_GPU_COMMAND_WORD_DRAIN_THRESHOLD) return m_preparedCommands.completionCycles[index];
		}
	}
	// More raw input may be in the separate DMA ingress, or a streaming
	// header may follow this bounded prefix. Refill after its last start has
	// really released credits; do not wake once for every internal command.
	return m_preparedCommands.count == 0u ? m_pendingCommandCompletionCycle
		: m_preparedCommands.startCycles[m_preparedCommands.index(m_preparedCommands.count - 1u)];
}

void GxGpu::rescheduleDeviceService(bool force, bool ensureCompletion) {
	if (m_processingGp0Pipeline) {
		m_deferredServiceFlags |= 1u | (force ? 2u : 0u) | (ensureCompletion ? 4u : 0u);
		return;
	}
	const u32 dmaDirection = (m_statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >> GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
	// Drawing can free GP0 ingress, but cannot create GPUREAD pixels. Readback
	// commands and their port state carry that independent completion dependency.
	const bool dmaWriteObservesCompletion = !m_supervisorIngressStopped
		&& (dmaDirection == GX_GPU_DMA_DIRECTION_FIFO || dmaDirection == GX_GPU_DMA_DIRECTION_CPU_TO_GP0)
		&& (m_dmaController.gpuCommandServiceDemand() & (1u << static_cast<u32>(DmaEndpoint::GpuWrite))) != 0u;
	const bool commandObservable = ensureCompletion || m_operationObserver.emitted != nullptr
		|| (m_pendingCommandTargetCount != 0u && m_commandBuffer.commandKind[m_pendingCommandTargetCount - 1u] == GX_GPU_COMMAND_READ_VRAM_TO_CPU)
		|| (m_pendingCommandTargetCount > m_commandBuffer.executedCommandCount
			&& (m_pendingCommandTargetCount >= m_backendSubmissionCommandLimit || commandBufferDrainRequired()))
		|| m_commandBuffer.readback.phase() != GX_GPU_READBACK_IDLE || m_supervisorQuiesceRequested
		|| (m_cpu.isMemoryWriteBlocked() && m_cpu.stalledMemoryWriteAddress() == IO_GX_GPU_GP0
			&& !m_supervisorIngressStopped && !m_dmaController.ownsWritePort(IO_GX_GPU_GP0))
		|| dmaWriteObservesCompletion;
	i64 deadline = m_pendingCommandCompletionCycle == 0 || !commandObservable ? -1 : m_pendingCommandCompletionCycle;
	if (!commandObservable && m_pendingCommandCompletionCycle != 0 && (m_queuedGp0Irqs != 0u || m_queuedGp0Readbacks != 0u)) {
		prepareGp0Commands();
		deadline = preparedCommandDeadline();
	}
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

void GxGpu::setBackendSubmissionCommandLimit(size_t commands) {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	m_backendSubmissionCommandLimit = commands;
	rescheduleDeviceService();
}

void GxGpu::consumeGp0Fifo(i64 commandStartCycle) {
	while (m_pendingCommandCompletionCycle == 0
		&& m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE
		&& !m_gp0Fifo.empty()) {
		if (m_gp0ImageLoadWordsRemaining != 0u) {
			consumeImageLoadWords(m_gp0Fifo, std::min(m_gp0Fifo.count(), static_cast<size_t>(m_gp0ImageLoadWordsRemaining)), commandStartCycle);
			continue;
		}
		if (m_gp0PolylineOpcode != 0u && m_gp0PolylinePayloadPhase == 0u
			&& (m_gp0Fifo.peek() & 0xf000f000u) == 0x50005000u) {
			m_gp0Fifo.pop();
			if (m_preparedCommands.sourceWordCount != 0u) --m_preparedCommands.sourceWordCount;
			clearPolylineState();
			continue;
		}
		if (m_preparedCommands.count != 0u) {
			if (commandBufferDrainRequired()) return;
			// A zero-cost predecessor can reach this start before ingress has
			// refilled the physical FIFO. Return to the transport datapath first.
			const u32 sourceWords = m_preparedCommands.sourceWordCounts[m_preparedCommands.head];
			if (sourceWords > m_gp0Fifo.count()) return;
			if (m_preparedTimingDirty || m_preparedCommands.startCycles[m_preparedCommands.head] != commandStartCycle) {
				copyDrawState(m_projectedDrawState);
				m_preparedCommands.retime(commandStartCycle, m_projectedDrawState);
				m_preparedTimingDirty = false;
			}
			const auto& packet = m_preparedCommands.pop();
			for (u32 word = 0u; word < sourceWords; ++word) m_gp0Fifo.pop();
			if (packet.kind == GX_GPU_COMMAND_DRAW_LINE && (packet.opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) != 0u) {
				emitPreparedGp0Command(packet, commandStartCycle);
				const bool gouraud = (packet.opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u;
				m_gp0PolylineColorWord = packet.words[gouraud ? 2u : 0u];
				m_gp0PolylinePositionWord = packet.words[gouraud ? 3u : 2u];
				m_gp0PolylineNextColorWord = 0u;
				m_gp0PolylinePayloadPhase = 0u;
			} else {
				executeGp0Command(packet, commandStartCycle);
			}
			continue;
		}
		if (m_gp0PolylineOpcode != 0u) {
			if (((m_gp0PolylineOpcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) == 0u
				|| m_gp0PolylinePayloadPhase != 0u) && commandBufferDrainRequired()) return;
			consumeGp0PolylinePayloadWord(m_gp0Fifo.pop(), commandStartCycle);
			continue;
		}
		if (m_gp0CommandTargetWordCount == 0u) {
			if (commandBufferDrainRequired()) {
				return;
			}
			m_gp0CommandTargetWordCount = gp0CommandWordCountForOpcode(m_gp0Fifo.peek() >> GX_GPU_GP0_OPCODE_SHIFT);
		}
		while (m_gp0CommandWordCount < m_gp0CommandTargetWordCount && !m_gp0Fifo.empty()) {
			m_executionPacket.words[m_gp0CommandWordCount] = m_gp0Fifo.pop();
			m_gp0CommandWordCount += 1u;
		}
		if (m_gp0CommandWordCount != m_gp0CommandTargetWordCount) {
			return;
		}
		copyDrawState(m_projectedDrawState);
		prepareGpuPacket(m_executionPacket, m_gp0CommandWordCount, m_projectedDrawState);
		executeGp0Command(m_executionPacket, commandStartCycle);
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

void GxGpu::executeGp0Command(const GxGpuPacket& packet, i64 commandStartCycle) {
	const u32 opcode = packet.opcode;
	if (opcode == GX_GPU_GP0_IRQ_REQUEST) --m_queuedGp0Irqs;
	else if (opcode >= GX_GPU_GP0_VRAM_TO_CPU_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) --m_queuedGp0Readbacks;
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;

	switch (opcode) {
	case GX_GPU_GP0_IRQ_REQUEST:
		if ((m_statusWord & GX_GPU_STATUS_INTERRUPT_REQUEST) == 0u) {
			m_statusWord |= GX_GPU_STATUS_INTERRUPT_REQUEST;
			m_irq.raise(IRQ_GPU);
		}
		beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_DRAW_MODE:
		writeDrawModeWord(packet.controlWord);
		beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_TEXTURE_WINDOW:
		m_textureWindowWord = packet.controlWord;
		beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_DRAWING_AREA_TOP_LEFT:
		m_drawingAreaTopLeftWord = packet.controlWord;
		beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT:
		m_drawingAreaBottomRightWord = packet.controlWord;
		beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_DRAWING_OFFSET:
		m_drawingOffsetWord = packet.controlWord;
		beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_MASK_BIT:
		writeMaskBitModeWord(packet.controlWord);
		beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
		break;
	default:
		if (packet.kind == GX_GPU_COMMAND_DRAW_POLYGON && (opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) != 0u) {
			writeDrawModeWord(packet.drawState.drawModeWord);
		}
		if (packet.kind == GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM) {
			beginImageLoadToVram(packet);
		} else if (packet.kind == GX_GPU_COMMAND_DRAW_POLYLINE) {
			beginPolylinePayload(packet, commandStartCycle);
		} else if (packet.kind != 0u) {
			emitPreparedGp0Command(packet, commandStartCycle);
		} else {
			beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
		}
		break;
	}
}

u32 GxGpu::readStatus() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	updateScanoutStatusBits();
	updateDynamicStatusBits();
	if (m_preparedTimingDirty && m_preparedCommands.count != 0u) rescheduleDeviceService();
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
		m_preparedTimingDirty = true;
		m_displayStartWord = word & GX_GPU_DISPLAY_START_MASK;
		updateScanoutStatusBits();
		writeStatusIo();
		rescheduleDeviceService();
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
		m_preparedTimingDirty = true;
		m_vramYAddressExtensionWord = word & 0x1u;
		updateScanoutStatusBits();
		writeStatusIo();
		rescheduleDeviceService();
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
		synchronizeCommandExecution(nowCycles);
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
	m_preparedTimingDirty = true;
	m_displayModeWord = word;
	updateDisplayModeStatusBits();
	writeStatusIo();
	rescheduleDeviceService();
}

void GxGpu::setTiming(i64 cpuHz, i64 nowCycles) {
	if (!m_pcrtc.setCpuHz(cpuHz, nowCycles)) return;
	m_pcrtcTimingPublicationPending = true;
	updateScanoutStatusBits();
	rescheduleDeviceService(true);
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
	if (m_presentationObserver.latched != nullptr) {
		m_presentationObserver.latched(m_presentationObserver.context, m_presentStatusWord, m_pcrtc.scanout, m_lastFrameCommitted);
	}
}

void GxGpu::retirePresentedCommands() {
	const size_t retiredCommands = m_commandBuffer.presentCommandCount;
	retireCommandPrefix(retiredCommands);
	m_vramPresentationPending = false;
	notifySupervisorBoundary();
}

void GxGpu::retireExecutedCommands() {
	retireCommandPrefix(m_commandBuffer.executedCommandCount);
	m_vramPresentationPending = true;
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
	}
	processGp0Pipeline(m_scheduler.currentNowCycles());
	updateDynamicStatusBits();
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
	m_preparedCommands.clear();
	m_preparedTimingDirty = true;
	clearGp0IngressState();
	m_pendingCommandCompletionCycle = 0;
	m_pendingCommandTargetCount = 0u;
	m_executionPacket.words.fill(0u);
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;
	clearImageLoadState();
	clearPolylineState();
	rescheduleDeviceService();
}

void GxGpu::clearGp0Fifo(i64 nowCycles) {
	m_gp0DmaIngress.reset();
	m_gp0Fifo.reset();
	m_preparedCommands.clear();
	m_preparedTimingDirty = true;
	clearGp0IngressState();
	flushImageLoadToVram(nowCycles);
	m_commandBuffer.abortReadbackAndQueuedCommands();
	if (m_pendingCommandTargetCount > m_commandBuffer.commandCount) {
		m_pendingCommandCompletionCycle = 0;
		m_pendingCommandTargetCount = 0u;
	}
	m_executionPacket.words.fill(0u);
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;
	clearImageLoadState();
	clearPolylineState();
	rescheduleDeviceService();
}

void GxGpu::clearGp0IngressState() {
	m_gp0Producer = {};
	m_queuedGp0Irqs = 0u;
	m_queuedGp0Readbacks = 0u;
	m_gp0Ingress.phase = GX_GPU_GP0_INGRESS_COMMAND;
	m_gp0Ingress.wordsRemaining = 0u;
	m_gp0Ingress.polylineWordsPerVertex = 0u;
	m_gp0Ingress.polylinePayloadPhase = 0u;
}

void GxGpu::clearPolylineState() {
	m_gp0PolylinePayloadPhase = 0u;
	m_gp0PolylineOpcode = 0u;
	m_gp0PolylineColorWord = 0u;
	m_gp0PolylinePositionWord = 0u;
	m_gp0PolylineNextColorWord = 0u;
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

template <size_t Capacity>
void GxGpu::consumeImageLoadWords(WordFifo<Capacity>& source, size_t words, i64 commandStartCycle) {
	source.readWords(m_commandBuffer.words.data() + m_commandBuffer.wordCount, words);
	commitImageLoadWords(words, commandStartCycle);
}

void GxGpu::commitImageLoadWords(size_t words, i64 commandStartCycle) {
	m_commandBuffer.wordCount += words;
	m_gp0ImageLoadCommandWordCount += static_cast<u32>(words);
	m_gp0ImageLoadWordsRemaining -= static_cast<u32>(words);
	if (m_gp0ImageLoadWordsRemaining == 0u) {
		finishImageLoadToVram(commandStartCycle);
	}
}

void GxGpu::consumeGp0PolylinePayloadWord(u32 word, i64 commandStartCycle) {
	if ((m_gp0PolylineOpcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u) {
		if (m_gp0PolylinePayloadPhase == 0u) {
			m_gp0PolylineNextColorWord = word;
			m_gp0PolylinePayloadPhase = 1u;
			return;
		}
		m_executionPacket.words[0] = m_gp0PolylineColorWord;
		m_executionPacket.words[1] = m_gp0PolylinePositionWord;
		m_executionPacket.words[2] = m_gp0PolylineNextColorWord;
		m_executionPacket.words[3] = word;
		emitFixedGp0Command(GX_GPU_COMMAND_DRAW_LINE, m_gp0PolylineOpcode, 4u, commandStartCycle);
		m_gp0PolylineColorWord = m_gp0PolylineNextColorWord;
		m_gp0PolylinePositionWord = word;
		m_gp0PolylineNextColorWord = 0u;
		m_gp0PolylinePayloadPhase = 0u;
		return;
	}
	m_executionPacket.words[0] = m_gp0PolylineColorWord;
	m_executionPacket.words[1] = m_gp0PolylinePositionWord;
	m_executionPacket.words[2] = word;
	emitFixedGp0Command(GX_GPU_COMMAND_DRAW_LINE, m_gp0PolylineOpcode, 3u, commandStartCycle);
	m_gp0PolylinePositionWord = word;
}

void GxGpu::beginPolylinePayload(const GxGpuPacket& packet, i64 commandStartCycle) {
	emitPreparedGp0Command(packet, commandStartCycle);
	m_gp0PolylineOpcode = packet.opcode;
	m_gp0PolylinePayloadPhase = 0u;
	if ((packet.opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u) {
		m_gp0PolylineColorWord = packet.words[2];
		m_gp0PolylinePositionWord = packet.words[3];
	} else {
		m_gp0PolylineColorWord = packet.words[0];
		m_gp0PolylinePositionWord = packet.words[2];
	}
	m_gp0PolylineNextColorWord = 0u;
}

bool GxGpu::commandBufferDrainRequired() const {
	return m_commandBuffer.commandCount == GX_GPU_COMMAND_CAPACITY
		|| (m_gp0ImageLoadWordsRemaining == 0u
			&& m_commandBuffer.wordCount > GX_GPU_COMMAND_WORD_DRAIN_THRESHOLD);
}

void GxGpu::emitPreparedGp0Command(const GxGpuPacket& packet, i64 commandStartCycle) {
	const size_t wordStart = m_commandBuffer.appendWords(packet.words.data(), packet.wordCount);
	m_commandBuffer.pushPreparedCommand(packet, wordStart);
	if (m_operationObserver.emitted != nullptr) {
		m_operationObserver.emitted(m_operationObserver.context, m_commandBuffer, m_commandBuffer.commandCount - 1u,
			commandStartCycle, std::span<const u32>(packet.words.data(), packet.wordCount));
	}
	beginCommandCompletion(packet.ticks, m_commandBuffer.commandCount, commandStartCycle);
}

void GxGpu::emitFixedGp0Command(u8 kind, u32 opcode, u32 commandWordCount, i64 commandStartCycle) {
	copyDrawState(m_projectedDrawState);
	prepareGpuPacket(m_executionPacket, commandWordCount, m_projectedDrawState, kind, static_cast<u8>(opcode));
	emitPreparedGp0Command(m_executionPacket, commandStartCycle);
}

void GxGpu::setOperationObserver(GxGpuOperationObserver observer) {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	m_operationObserver = observer;
	rescheduleDeviceService();
}

void GxGpu::pushGpuCommand(u8 kind, u32 opcode, size_t wordStart, u32 commandWordCount, i64 commandStartCycle) {
	copyDrawState(m_projectedDrawState);
	if ((m_drawModeWord & GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD) != 0u) m_projectedDrawState.skippedLineParity = GX_GPU_SKIPPED_LINE_NONE;
	m_commandBuffer.pushCommand(
		kind,
		static_cast<u8>(opcode),
		wordStart,
		commandWordCount,
		m_drawModeWord,
		m_vramYAddressExtensionWord,
		m_textureWindowWord,
		m_drawingAreaTopLeftWord,
		m_drawingAreaBottomRightWord,
		m_drawingOffsetWord,
		m_maskBitModeWord,
		m_skippedLineParity);
	if (m_operationObserver.emitted != nullptr) {
		const u32* operationWords = kind == GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM
			? m_commandBuffer.words.data() + wordStart : m_executionPacket.words.data();
		m_operationObserver.emitted(m_operationObserver.context, m_commandBuffer, m_commandBuffer.commandCount - 1u, commandStartCycle,
			std::span<const u32>(operationWords, commandWordCount));
	}
	beginCommandCompletion(
		gxGpuPacketTicks(kind, static_cast<u8>(opcode), m_commandBuffer.words.data(), wordStart, 0u, 1u, 0u, m_projectedDrawState),
		m_commandBuffer.commandCount,
		commandStartCycle);
}

void GxGpu::beginImageLoadToVram(const GxGpuPacket& packet) {
	const u32 sizeWord = packet.words[2];
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	m_gp0ImageLoadCommandWordStart = m_commandBuffer.appendWords(packet.words.data(), packet.wordCount);
	m_gp0ImageLoadCommandWordCount = packet.wordCount;
	m_gp0ImageLoadCommandOpcode = packet.opcode;
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
	m_memory.writeIoU32(IO_GX_GPU_GP0, m_gpuReadWord);
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
	rescheduleDeviceService();
}

void GxGpu::updateCommandStatusBits() {
	u32 commandStatusBits = 0u;
	const bool readbackIdle = m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE;
	const bool readyToReceiveDma = !m_supervisorIngressStopped && m_gp0DmaIngress.empty();
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
		&& m_gp0PolylineOpcode == 0u) {
		commandStatusBits |= GX_GPU_STATUS_GPU_IDLE;
	}
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_COMMAND_STATE_MASK) | commandStatusBits;
	// CPU writes need a command FIFO slot; DMA reserves its separate ingress buffer.
	// Packet assembly never restricts an empty ingress buffer.
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
	const bool writing = (dmaDirection == GX_GPU_DMA_DIRECTION_FIFO || dmaDirection == GX_GPU_DMA_DIRECTION_CPU_TO_GP0)
		&& dmaRequest != 0u;
	m_dmaController.setEndpointCapacity(DmaEndpoint::GpuWrite, writing ? GX_GPU_DMA_INGRESS_WORD_CAPACITY : 0u);
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
	const u32 previousActiveLineLsb = m_scanoutActiveLineLsb;
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
	if (previousActiveLineLsb != m_scanoutActiveLineLsb) m_preparedTimingDirty = true;
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
	m_memory.writeIoU32(IO_GX_GPU_GP1, m_statusWord);
}

bool GxGpu::gp0WriteReady(MappedBusSignals busSignals) {
	if ((busSignals & MAPPED_BUS_MASTER_DMA) != 0u) {
		return !m_supervisorIngressStopped;
	}
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	updateDynamicStatusBits();
	const bool ready = !m_supervisorIngressStopped
		&& m_gp0DmaIngress.empty()
		&& m_gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY
		&& !m_dmaController.ownsWritePort(IO_GX_GPU_GP0);
	if (!ready) rescheduleDeviceService(false,
		!m_supervisorIngressStopped && !m_dmaController.ownsWritePort(IO_GX_GPU_GP0));
	return ready;
}

void GxGpu::synchronizeDmaRequest() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	updateDynamicStatusBits();
}

void GxGpu::dependencyStateChanged() {
	rescheduleDeviceService();
}

void GxGpu::notifySupervisorBoundary() {
	if (supervisorFenceReady()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	}
}

u32 GxGpu::readGp0Thunk(void* context, u32 addr, MappedBusSignals busSignals) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	return gpu.readGp0(busSignals);
}

void GxGpu::writeGp0PrefixThunk(void* context, u32, const u32* words, u32 count, MappedBusSignals) {
	auto& gpu = *static_cast<GxGpu*>(context);
	if (gpu.m_supervisorIngressStopped) return;
	gpu.synchronizeCommandExecution(gpu.m_scheduler.currentNowCycles());
	// If both FIFOs are empty and the whole burst continues the runnable
	// image, its final packet can own the payload immediately. Publish it
	// at block end, after the source device has processed the terminal word.
	if (gpu.m_gp0DmaIngress.empty() && gpu.m_gp0Fifo.empty()
		&& gpu.m_gp0Producer.phase == GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD
		&& gpu.m_gp0Producer.wordsRemaining > count
		&& gpu.m_gp0Ingress.phase == GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD
		&& gpu.m_gp0Ingress.wordsRemaining > count
		&& gpu.m_gp0ImageLoadWordsRemaining > count
		&& gpu.m_pendingCommandCompletionCycle == 0
		&& gpu.m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE) {
		std::copy_n(words, count, gpu.m_commandBuffer.words.data() + gpu.m_commandBuffer.wordCount);
		gpu.m_gp0Producer.skipPayloadWords(count);
		gpu.m_gp0DmaImagePrefixWords = count;
	} else {
		const size_t accepted = std::min<size_t>(count, gpu.m_gp0DmaIngress.free());
		gpu.m_gp0DmaIngress.writeWords(words, accepted);
		for (size_t index = 0u; index < accepted;) {
			const u32 skipped = gpu.m_gp0Producer.skipPayloadWords(static_cast<u32>(accepted - index));
			if (skipped != 0u) index += skipped;
			else gpu.recordGp0ProducerWord(words[index++]);
		}
	}
	gpu.m_gp0Word = words[count - 1u];
	gpu.m_memory.writeIoU32(IO_GX_GPU_GP0, gpu.m_gp0Word);
}

void GxGpu::writeGp0Thunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	gpu.writeGp0(value, busSignals);
}

bool GxGpu::gp0WriteReadyThunk(void* context, u32 addr, MappedBusSignals busSignals) {
	(void)addr;
	return static_cast<GxGpu*>(context)->gp0WriteReady(busSignals);
}

bool GxGpu::gp1WriteReadyThunk(void* context, u32 addr, MappedBusSignals) {
	(void)addr;
	return !static_cast<GxGpu*>(context)->m_supervisorQuiesceRequested;
}

u32 GxGpu::readStatusThunk(void* context, u32 addr, MappedBusSignals) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	return gpu.readStatus();
}

void GxGpu::writeGp1Thunk(void* context, u32 addr, u32 value, MappedBusSignals) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	gpu.writeGp1(value);
}

u32 GxGpu::readPcrtcThunk(void* context, u32 address, MappedBusSignals) {
	const u32 index = address < IO_GX_PCRTC_TIMING_BASE
		? (address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE
		: IO_GX_PCRTC_WORD_COUNT + (address - IO_GX_PCRTC_TIMING_BASE) / IO_WORD_SIZE;
	return static_cast<GxGpu*>(context)->m_pcrtc.readRegisterWord(index);
}

void GxGpu::writePcrtcThunk(void* context, u32 address, u32 value, MappedBusSignals) {
	const u32 index = address < IO_GX_PCRTC_TIMING_BASE
		? (address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE
		: IO_GX_PCRTC_WORD_COUNT + (address - IO_GX_PCRTC_TIMING_BASE) / IO_WORD_SIZE;
	static_cast<GxGpu*>(context)->writePcrtcRegister(index, value);
}

} // namespace bmsx
