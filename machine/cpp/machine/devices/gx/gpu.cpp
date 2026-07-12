#include "machine/devices/gx/gpu.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/gx/gpu_command_timing.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

#include <algorithm>

namespace bmsx {

GxGpu::GxGpu(Memory& memory, IrqController& irq, DeviceScheduler& scheduler, DmaController& dmaController)
	: m_memory(memory)
	, m_irq(irq)
	, m_scheduler(scheduler)
	, m_dmaController(dmaController)
	, m_commandBuffer(dmaController) {
	m_memory.mapIoRead(IO_GX_GPU_GP0, this, &GxGpu::readGp0Thunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP0, this, &GxGpu::writeGp0Thunk);
	m_memory.mapIoWriteReady(IO_GX_GPU_GP0, &GxGpu::gp0WriteReadyThunk);
	m_memory.mapIoRead(IO_GX_GPU_GP1, this, &GxGpu::readStatusThunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP1, this, &GxGpu::writeGp1Thunk);
}

void GxGpu::reset() {
	m_textureDisableAllowedWord = 0u;
	m_gpuReadWord = 0u;
	m_commandBuffer.reset();
	clearGp0CommandState();
	resetGpuRegisters();
}

void GxGpu::resetGpuRegisters() {
	m_gp0Word = 0u;
	m_gp1Word = 0u;
	m_displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	m_statusWord = GX_GPU_STATUS_RESET_WORD;
	m_drawModeWord = 0u;
	m_textureWindowWord = 0u;
	m_drawingAreaTopLeftWord = 0u;
	m_drawingAreaBottomRightWord = 0u;
	m_drawingOffsetWord = 0u;
	m_maskBitModeWord = 0u;
	m_displayStartWord = 0u;
	m_horizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	m_verticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	m_presentStatusWord = GX_GPU_STATUS_RESET_WORD;
	m_presentDisplayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	m_presentDisplayStartWord = 0u;
	m_presentHorizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	m_presentVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	m_scanoutVblankActive = false;
	m_scanoutInterlacedField = 0u;
	m_scanoutInterlacedDisplayField = 0u;
	m_scanoutActiveLineLsb = 0u;
	m_scanoutFrameStartCycle = 0;
	m_scanoutCyclesPerFrame = 1;
	m_scanoutTotalScanlines = 313;
	m_lastFrameCommitted = false;
	updateDisplayModeStatusBits();
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gpuReadWord)));
	writeStatusIo();
}

GxGpuState GxGpu::captureState() const {
	const i64 nowCycles = m_scheduler.currentNowCycles();
	GxGpuState state;
	state.gp0Word = m_gp0Word;
	state.gp1Word = m_gp1Word;
	state.displayModeWord = m_displayModeWord;
	state.statusWord = m_statusWord;
	state.gp0CommandWordCount = m_gp0CommandWordCount;
	state.gp0CommandTargetWordCount = m_gp0CommandTargetWordCount;
	state.gp0CommandWords.assign(m_gp0CommandWords.begin(), m_gp0CommandWords.begin() + static_cast<std::ptrdiff_t>(m_gp0CommandWordCount));
	state.gp0FifoWordCount = m_gp0Fifo.count();
	for (size_t index = 0u; index < state.gp0FifoWordCount; index += 1u) {
		state.gp0FifoWords[index] = m_gp0Fifo.peek(index);
	}
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
	state.textureDisableAllowedWord = m_textureDisableAllowedWord;
	state.scanoutInterlacedField = m_scanoutInterlacedField;
	state.scanoutInterlacedDisplayField = m_scanoutInterlacedDisplayField;
	state.scanoutActiveLineLsb = m_scanoutActiveLineLsb;
	state.presentStatusWord = m_presentStatusWord;
	state.presentDisplayModeWord = m_presentDisplayModeWord;
	state.presentDisplayStartWord = m_presentDisplayStartWord;
	state.presentHorizontalDisplayRangeWord = m_presentHorizontalDisplayRangeWord;
	state.presentVerticalDisplayRangeWord = m_presentVerticalDisplayRangeWord;
	state.commandBuffer = m_commandBuffer.captureState();
	return state;
}

void GxGpu::restoreState(const GxGpuState& state) {
	m_gp0Word = state.gp0Word;
	m_gp1Word = state.gp1Word;
	m_displayModeWord = state.displayModeWord;
	m_statusWord = state.statusWord;
	m_gp0Fifo.reset();
	for (size_t index = 0u; index < state.gp0FifoWordCount; index += 1u) {
		m_gp0Fifo.push(state.gp0FifoWords[index]);
	}
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
	m_textureDisableAllowedWord = state.textureDisableAllowedWord;
	m_scanoutInterlacedField = state.scanoutInterlacedField;
	m_scanoutInterlacedDisplayField = state.scanoutInterlacedDisplayField;
	m_scanoutActiveLineLsb = state.scanoutActiveLineLsb;
	m_presentStatusWord = state.presentStatusWord;
	m_presentDisplayModeWord = state.presentDisplayModeWord;
	m_presentDisplayStartWord = state.presentDisplayStartWord;
	m_presentHorizontalDisplayRangeWord = state.presentHorizontalDisplayRangeWord;
	m_presentVerticalDisplayRangeWord = state.presentVerticalDisplayRangeWord;
	m_commandBuffer.restoreState(state.commandBuffer);
	if (state.pendingCommandCycles != 0) {
		m_pendingCommandCompletionCycle = m_scheduler.currentNowCycles() + state.pendingCommandCycles;
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_GPU, m_pendingCommandCompletionCycle);
	} else {
		m_pendingCommandCompletionCycle = 0;
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
	}
	m_lastFrameCommitted = false;
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));
	writeStatusIo();
}

GxGpuSaveState GxGpu::captureSaveState() const {
	GxGpuSaveState state;
	static_cast<GxGpuState&>(state) = captureState();
	state.vramBytes.assign(m_vramSnapshotBytes.begin(), m_vramSnapshotBytes.end());
	return state;
}

void GxGpu::restoreSaveState(const GxGpuSaveState& state) {
	restoreState(state);
	replaceVramSnapshotBytes(state.vramBytes.data());
}

void GxGpu::replaceVramSnapshotBytes(const u8* bytes) {
	std::copy(bytes, bytes + GX_GPU_VRAM_BYTE_COUNT, m_vramSnapshotBytes.begin());
	m_vramSnapshotSerial += 1u;
}

u32 GxGpu::commitRenderedVramSnapshotBytes(const u8* bytes) {
	std::copy(bytes, bytes + GX_GPU_VRAM_BYTE_COUNT, m_vramSnapshotBytes.begin());
	m_vramSnapshotSerial += 1u;
	retirePresentedCommands();
	return m_vramSnapshotSerial;
}

u32 GxGpu::readGp0() {
	const i64 nowCycles = m_scheduler.currentNowCycles();
	synchronizeCommandExecution(nowCycles);
	if (m_commandBuffer.readback.phase() == GX_GPU_READBACK_READY) {
		m_gpuReadWord = m_commandBuffer.readback.readWord();
		consumeGp0Fifo(nowCycles);
		m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gpuReadWord)));
	}
	updateDynamicStatusBits();
	return m_gpuReadWord;
}

void GxGpu::writeGp0(u32 word) {
	const i64 nowCycles = m_scheduler.currentNowCycles();
	synchronizeCommandExecution(nowCycles);
	m_gp0Word = word;
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));
	m_gp0Fifo.push(word);
	consumeGp0Fifo(nowCycles);
	updateDynamicStatusBits();
}

void GxGpu::onService(i64 nowCycles) {
	synchronizeCommandExecution(nowCycles);
	writeStatusIo();
}

void GxGpu::synchronizeCommandExecution(i64 nowCycles) {
	while (m_pendingCommandCompletionCycle != 0 && nowCycles >= m_pendingCommandCompletionCycle) {
		const i64 commandCompletionCycle = m_pendingCommandCompletionCycle;
		const size_t completedCommandCount = m_pendingCommandTargetCount;
		m_pendingCommandCompletionCycle = 0;
		m_pendingCommandTargetCount = 0u;
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
		if (completedCommandCount > m_commandBuffer.executedCommandCount) {
			m_commandBuffer.completeCommandExecution(completedCommandCount);
		}
		if (m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE) {
			consumeGp0Fifo(commandCompletionCycle);
		}
	}
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
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_GPU, m_pendingCommandCompletionCycle);
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
	case GX_GPU_GP0_DRAWING_AREA_TOP_LEFT:
		m_drawingAreaTopLeftWord = m_gp0CommandWords[0] & GX_GPU_DRAWING_AREA_MASK;
		beginCommandCompletion(1, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT:
		m_drawingAreaBottomRightWord = m_gp0CommandWords[0] & GX_GPU_DRAWING_AREA_MASK;
		beginCommandCompletion(1, m_commandBuffer.commandCount, commandStartCycle);
		break;
	case GX_GPU_GP0_DRAWING_OFFSET:
		m_drawingOffsetWord = m_gp0CommandWords[0] & GX_GPU_DRAWING_OFFSET_MASK;
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
	const u32 opcode = (word >> GX_GPU_GP1_OPCODE_SHIFT) & GX_GPU_GP1_OPCODE_MASK;
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
	case GX_GPU_GP1_ALLOW_TEXTURE_DISABLE:
		m_textureDisableAllowedWord = word & 0x1u;
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

u32 GxGpu::readDisplayModeWord() const {
	return m_displayModeWord;
}

void GxGpu::writeDisplayModeWord(u32 word) {
	m_displayModeWord = word;
	updateDisplayModeStatusBits();
	writeStatusIo();
}

void GxGpu::setScanoutTiming(bool vblankActive, int cyclesIntoFrame, int cyclesPerFrame, int totalScanlines) {
	if (!m_scanoutVblankActive && vblankActive) {
		m_scanoutInterlacedDisplayField = gpuStatInInterleaved480iMode() ? (m_scanoutInterlacedField ^ 1u) : 0u;
	}
	if (m_scanoutVblankActive && !vblankActive) {
		if ((m_statusWord & GX_GPU_STATUS_VERTICAL_INTERLACE) != 0u) {
			m_scanoutInterlacedField ^= 1u;
		} else {
			m_scanoutInterlacedField = 0u;
		}
	}
	m_scanoutVblankActive = vblankActive;
	m_scanoutFrameStartCycle = m_scheduler.currentNowCycles() - static_cast<i64>(cyclesIntoFrame);
	m_scanoutCyclesPerFrame = cyclesPerFrame;
	m_scanoutTotalScanlines = totalScanlines;
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
	m_deviceOutput.horizontalDisplayRangeWord = m_presentHorizontalDisplayRangeWord;
	m_deviceOutput.verticalDisplayRangeWord = m_presentVerticalDisplayRangeWord;
	m_deviceOutput.vramSnapshotBytes = &m_vramSnapshotBytes;
	m_deviceOutput.vramSnapshotSerial = m_vramSnapshotSerial;
	return m_deviceOutput;
}

void GxGpu::presentReadyFrameOnVblankEdge() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	updateScanoutStatusBits();
	updateDynamicStatusBits();
	const u32 visibleStatusWord = m_statusWord & GX_GPU_STATUS_DISPLAY_DISABLE;
	const bool scanoutStateChanged = (m_presentStatusWord & GX_GPU_STATUS_DISPLAY_DISABLE) != visibleStatusWord
		|| m_presentDisplayModeWord != m_displayModeWord
		|| m_presentDisplayStartWord != m_displayStartWord
		|| m_presentHorizontalDisplayRangeWord != m_horizontalDisplayRangeWord
		|| m_presentVerticalDisplayRangeWord != m_verticalDisplayRangeWord;
	m_presentStatusWord = m_statusWord;
	m_presentDisplayModeWord = m_displayModeWord;
	m_presentDisplayStartWord = m_displayStartWord;
	m_presentHorizontalDisplayRangeWord = m_horizontalDisplayRangeWord;
	m_presentVerticalDisplayRangeWord = m_verticalDisplayRangeWord;
	m_commandBuffer.sealCommandsForPresentation();
	m_lastFrameCommitted = m_commandBuffer.hasUnretiredPresentCommands() || scanoutStateChanged;
}

void GxGpu::retirePresentedCommands() {
	const size_t retiredCommands = m_commandBuffer.presentCommandCount;
	const size_t retiredWords = m_commandBuffer.retireCommandsPreservingVram();
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

u32 GxGpu::readTextureDisableAllowedWord() const {
	return m_textureDisableAllowedWord;
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
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
	m_gp0Fifo.reset();
	m_pendingCommandCompletionCycle = 0;
	m_pendingCommandTargetCount = 0u;
	m_gp0CommandWords.fill(0u);
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;
	clearImageLoadState();
	clearPolylineState();
}

void GxGpu::clearGp0Fifo(i64 nowCycles) {
	m_gp0Fifo.reset();
	flushImageLoadToVram(nowCycles);
	if (m_gp0PolylineCommandWordCount != 0u) {
		m_commandBuffer.wordCount = m_gp0PolylineCommandWordStart;
	}
	m_commandBuffer.abortReadbackAndQueuedCommands();
	m_gp0CommandWords.fill(0u);
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;
	clearImageLoadState();
	clearPolylineState();
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
	const u8 interlacedRenderWord = gxGpuInterlacedRenderWord(m_statusWord, m_scanoutActiveLineLsb);
	m_commandBuffer.pushCommand(
		kind,
		static_cast<u8>(opcode),
		wordStart,
		commandWordCount,
		m_drawModeWord,
		m_textureWindowWord,
		m_drawingAreaTopLeftWord,
		m_drawingAreaBottomRightWord,
		m_drawingOffsetWord,
		m_maskBitModeWord,
		interlacedRenderWord);
	beginCommandCompletion(
		gxGpuCommandTicks(
			kind,
			static_cast<u8>(opcode),
			m_commandBuffer.words.data(),
			wordStart,
			commandWordCount,
			m_drawModeWord,
			m_drawingAreaTopLeftWord,
			m_drawingAreaBottomRightWord,
			m_drawingOffsetWord,
			m_maskBitModeWord,
			interlacedRenderWord),
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
	if (m_textureDisableAllowedWord == 0u) {
		m_drawModeWord &= ~GX_GPU_DRAW_MODE_TEXTURE_DISABLE;
	}
	updateDrawModeStatusBits();
}

void GxGpu::updateDrawModeStatusBits() {
	const u32 textureDisable = (m_drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) != 0u
		? GX_GPU_STATUS_TEXTURE_DISABLE
		: 0u;
	m_statusWord = (m_statusWord & ~(GX_GPU_DRAW_MODE_GPUSTAT_MASK | GX_GPU_STATUS_TEXTURE_DISABLE))
		| (m_drawModeWord & GX_GPU_DRAW_MODE_GPUSTAT_MASK)
		| textureDisable;
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
		m_gpuReadWord = GX_GPU_INFO_GPU_TYPE_208PIN;
		break;
	case 0x08u:
		m_gpuReadWord = 0u;
		break;
	}
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gpuReadWord)));
	writeStatusIo();
}

void GxGpu::writeDmaDirectionWord(u32 word) {
	const u32 dmaDirectionBits = (word & 0x3u) << GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_DMA_DIRECTION_MASK) | dmaDirectionBits;
	writeStatusIo();
}

void GxGpu::updateCommandStatusBits() {
	u32 commandStatusBits = 0u;
	const bool readbackIdle = m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE;
	bool readyToReceiveDma = false;
	if (readbackIdle) {
		if (m_gp0ImageLoadWordsRemaining != 0u || m_gp0PolylineWordsPerVertex != 0u) {
			readyToReceiveDma = m_gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY;
		} else if (m_gp0CommandWordCount != 0u) {
			readyToReceiveDma = m_gp0CommandWordCount < m_gp0CommandTargetWordCount;
		} else if (m_gp0Fifo.empty()) {
			readyToReceiveDma = true;
		} else {
			readyToReceiveDma = m_gp0Fifo.count() < gp0CommandWordCountForOpcode(m_gp0Fifo.peek() >> GX_GPU_GP0_OPCODE_SHIFT);
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
		&& m_gp0Fifo.empty()
		&& m_gp0CommandWordCount == 0u
		&& m_gp0ImageLoadWordsRemaining == 0u
		&& m_gp0PolylineWordsPerVertex == 0u) {
		commandStatusBits |= GX_GPU_STATUS_GPU_IDLE;
	}
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_COMMAND_STATE_MASK) | commandStatusBits;
	m_dmaController.setGxGpuWriteReady(readyToReceiveDma);
}

void GxGpu::updateDynamicStatusBits() {
	updateCommandStatusBits();
	updateDmaRequestStatusBit();
}

void GxGpu::updateDmaRequestStatusBit() {
	const u32 dmaDirection = (m_statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >> GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
	u32 dmaRequest = 0u;
	switch (dmaDirection) {
	case GX_GPU_DMA_DIRECTION_FIFO:
		dmaRequest = m_commandBuffer.readback.phase() == GX_GPU_READBACK_IDLE
			&& m_gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY
			? GX_GPU_STATUS_DMA_DATA_REQUEST
			: 0u;
		break;
	case GX_GPU_DMA_DIRECTION_CPU_TO_GP0:
		dmaRequest = m_statusWord & GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
		break;
	case GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU:
		dmaRequest = m_statusWord & GX_GPU_STATUS_READY_TO_SEND_VRAM;
		break;
	}
	if (dmaRequest != 0u) {
		m_statusWord |= GX_GPU_STATUS_DMA_DATA_REQUEST;
	} else {
		m_statusWord &= ~GX_GPU_STATUS_DMA_DATA_REQUEST;
	}
}

bool GxGpu::gpuStatInInterleaved480iMode() const {
	return (m_statusWord & (GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE)) == (GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE);
}

int GxGpu::scanoutLine() const {
	const int cyclesIntoFrame = static_cast<int>((m_scheduler.currentNowCycles() - m_scanoutFrameStartCycle) % static_cast<i64>(m_scanoutCyclesPerFrame));
	const int numerator = cyclesIntoFrame * m_scanoutTotalScanlines;
	return (numerator - numerator % m_scanoutCyclesPerFrame) / m_scanoutCyclesPerFrame;
}

void GxGpu::updateScanoutStatusBits() {
	u32 scanoutBits = 0u;
	const u32 displayStartY = gxGpuDisplayStartY(m_displayStartWord);
	if (gpuStatInInterleaved480iMode()) {
		m_scanoutActiveLineLsb = (displayStartY + m_scanoutInterlacedDisplayField) & 1u;
		const u32 displayedField = m_scanoutVblankActive ? 0u : m_scanoutInterlacedDisplayField;
		if (((displayStartY + displayedField) & 1u) != 0u) {
			scanoutBits |= GX_GPU_STATUS_DISPLAY_LINE_LSB;
		}
	} else {
		m_scanoutActiveLineLsb = 0u;
		m_scanoutInterlacedDisplayField = 0u;
		if (((displayStartY + static_cast<u32>(scanoutLine())) & 1u) != 0u) {
			scanoutBits |= GX_GPU_STATUS_DISPLAY_LINE_LSB;
		}
	}
	if ((m_statusWord & GX_GPU_STATUS_VERTICAL_INTERLACE) == 0u || m_scanoutInterlacedField == 0u) {
		scanoutBits |= GX_GPU_STATUS_INTERLACED_FIELD;
	}
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_SCANOUT_MASK) | scanoutBits;
}

void GxGpu::updateDisplayModeStatusBits() {
	const u32 displayMode = m_displayModeWord;
	const u32 statusDisplayModeBits = ((displayMode & 0x03u) << GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT)
		| ((displayMode & 0x04u) << 17u)
		| ((displayMode & 0x08u) << 17u)
		| ((displayMode & 0x10u) << 17u)
		| ((displayMode & 0x20u) << 17u)
		| ((displayMode & 0x40u) << 10u)
		| ((displayMode & 0x80u) << 7u);
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_DISPLAY_MODE_MASK) | statusDisplayModeBits;
	updateScanoutStatusBits();
}

void GxGpu::writeStatusIo() {
	updateDynamicStatusBits();
	m_memory.writeIoValue(IO_GX_GPU_GP1, valueNumber(static_cast<double>(m_statusWord)));
}

bool GxGpu::gp0WriteReady() {
	synchronizeCommandExecution(m_scheduler.currentNowCycles());
	return m_gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY;
}

u64 GxGpu::readGp0Thunk(void* context, u32 addr) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	return valueNumber(static_cast<double>(gpu.readGp0()));
}

void GxGpu::writeGp0Thunk(void* context, u32 addr, u64 value) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	gpu.writeGp0(toU32(value));
}

bool GxGpu::gp0WriteReadyThunk(void* context, u32 addr) {
	(void)addr;
	return static_cast<GxGpu*>(context)->gp0WriteReady();
}

u64 GxGpu::readStatusThunk(void* context, u32 addr) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	return valueNumber(static_cast<double>(gpu.readStatus()));
}

void GxGpu::writeGp1Thunk(void* context, u32 addr, u64 value) {
	(void)addr;
	GxGpu& gpu = *static_cast<GxGpu*>(context);
	gpu.writeGp1(toU32(value));
}

} // namespace bmsx
