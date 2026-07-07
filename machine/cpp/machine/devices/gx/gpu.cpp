#include "machine/devices/gx/gpu.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/scheduler/device.h"

namespace bmsx {

GxGpu::GxGpu(Memory& memory, DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_scheduler(scheduler)
	, m_displayModeWord(PSX_GPU_DISPLAY_MODE_PAL_WORD) {
	m_memory.mapIoRead(IO_GX_GPU_GP0, this, &GxGpu::readGp0Thunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP0, this, &GxGpu::writeGp0Thunk);
	m_memory.mapIoRead(IO_GX_GPU_GP1, this, &GxGpu::readStatusThunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP1, this, &GxGpu::writeGp1Thunk);
}

void GxGpu::reset() {
	m_textureDisableAllowedWord = 0u;
	resetGpuRegisters();
}

void GxGpu::resetGpuRegisters() {
	m_gp0Word = 0u;
	m_gp1Word = 0u;
	m_displayModeWord = PSX_GPU_DISPLAY_MODE_PAL_WORD;
	m_statusWord = GX_GPU_STATUS_RESET_WORD;
	m_commandBuffer.reset();
	clearGp0CommandState();
	m_gpuReadWord = 0x00000400u;
	m_drawModeWord = 0u;
	m_textureWindowWord = 0u;
	m_drawingAreaTopLeftWord = 0u;
	m_drawingAreaBottomRightWord = 0u;
	m_drawingOffsetWord = 0u;
	m_maskBitModeWord = 0u;
	m_displayStartWord = 0u;
	m_horizontalDisplayRangeWord = 0x00c60260u;
	m_verticalDisplayRangeWord = 0x0003fc10u;
	m_scanoutVblankActive = false;
	m_scanoutInterlacedField = 0u;
	m_scanoutInterlacedDisplayField = 0u;
	m_scanoutActiveLineLsb = 0u;
	m_scanoutFrameStartCycle = 0;
	m_scanoutCyclesPerFrame = 1;
	m_scanoutTotalScanlines = 313;
	updateDisplayModeStatusBits();
	updateScanoutStatusBits();
	updateDmaRequestStatusBit();
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(0.0));
	writeStatusIo();
}

GxGpuState GxGpu::captureState() const {
	return {
		m_gp0Word,
		m_gp1Word,
		m_displayModeWord,
		m_statusWord,
	};
}

void GxGpu::restoreState(const GxGpuState& state) {
	m_gp0Word = state.gp0Word;
	m_gp1Word = state.gp1Word;
	m_displayModeWord = state.displayModeWord;
	m_statusWord = state.statusWord;
	m_commandBuffer.reset();
	clearGp0CommandState();
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));
	m_memory.writeIoValue(IO_GX_GPU_GP1, valueNumber(static_cast<double>(m_statusWord)));
}

u32 GxGpu::readGp0() const {
	return m_gpuReadWord;
}

void GxGpu::writeGp0(u32 word) {
	m_gp0Word = word;
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));

	if (m_gp0ImageLoadWordsRemaining != 0u) {
		consumeImageLoadWord();
		updateDynamicStatusBits();
		return;
	}

	if (m_gp0PolylineWordsPerVertex != 0u) {
		consumeGp0PolylinePayloadWord();
		updateDynamicStatusBits();
		return;
	}

	if (m_gp0CommandTargetWordCount == 0u) {
		m_gp0CommandTargetWordCount = gp0CommandWordCountForOpcode(m_gp0Word >> GX_GPU_GP0_OPCODE_SHIFT);
	}

	m_gp0CommandWords[m_gp0CommandWordCount] = m_gp0Word;
	m_gp0CommandWordCount += 1u;
	if (m_gp0CommandWordCount == m_gp0CommandTargetWordCount) {
		executeGp0Command();
	}
	updateDynamicStatusBits();
}

void GxGpu::executeGp0Command() {
	const u32 opcode = m_gp0CommandWords[0] >> GX_GPU_GP0_OPCODE_SHIFT;
	const u32 commandWordCount = m_gp0CommandWordCount;
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;

	switch (opcode) {
	case GX_GPU_GP0_FILL_RECTANGLE:
		emitFixedGp0Command(GX_GPU_COMMAND_FILL_RECTANGLE, opcode, commandWordCount);
		break;
	case GX_GPU_GP0_IRQ_REQUEST:
		m_statusWord |= GX_GPU_STATUS_INTERRUPT_REQUEST;
		writeStatusIo();
		break;
	case GX_GPU_GP0_SET_DRAW_MODE:
		writeDrawModeWord(m_gp0Word & GX_GPU_GP0_PARAM_MASK);
		break;
	case GX_GPU_GP0_SET_TEXTURE_WINDOW:
		m_textureWindowWord = m_gp0Word & GX_GPU_TEXTURE_WINDOW_MASK;
		break;
	case GX_GPU_GP0_SET_DRAWING_AREA_TOP_LEFT:
		m_drawingAreaTopLeftWord = m_gp0Word & GX_GPU_DRAWING_AREA_MASK;
		break;
	case GX_GPU_GP0_SET_DRAWING_AREA_BOTTOM_RIGHT:
		m_drawingAreaBottomRightWord = m_gp0Word & GX_GPU_DRAWING_AREA_MASK;
		break;
	case GX_GPU_GP0_SET_DRAWING_OFFSET:
		m_drawingOffsetWord = m_gp0Word & GX_GPU_DRAWING_OFFSET_MASK;
		break;
	case GX_GPU_GP0_SET_MASK_BIT:
		writeMaskBitModeWord(m_gp0CommandWords[0] & GX_GPU_GP0_PARAM_MASK);
		break;
	default:
		if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) {
			if ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) != 0u) {
				const u32 texturePageWord = m_gp0CommandWords[gxGpuPolygonTexturePageWordIndex(opcode)];
				writeDrawModeWord(gxGpuPolygonDrawModeWord(m_drawModeWord, gxGpuTextureAttribute(texturePageWord)));
			}
			emitFixedGp0Command(GX_GPU_COMMAND_DRAW_POLYGON, opcode, commandWordCount);
		} else if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) {
			if ((opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) != 0u) {
				beginPolylinePayload(opcode, commandWordCount);
			} else {
				emitFixedGp0Command(GX_GPU_COMMAND_DRAW_LINE, opcode, commandWordCount);
			}
		} else if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) {
			emitFixedGp0Command(GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, commandWordCount);
		} else if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) {
			emitFixedGp0Command(GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, opcode, commandWordCount);
		} else if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) {
			beginImageLoadToVram(opcode, commandWordCount);
		} else if (opcode >= GX_GPU_GP0_VRAM_TO_CPU_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) {
			emitFixedGp0Command(GX_GPU_COMMAND_READ_VRAM_TO_CPU, opcode, commandWordCount);
		}
		break;
	}
}

u32 GxGpu::readStatus() {
	updateScanoutStatusBits();
	updateDynamicStatusBits();
	return m_statusWord;
}

u32 GxGpu::writeGp1(u32 word) {
	m_gp1Word = word;
	const u32 opcode = (word >> GX_GPU_GP1_OPCODE_SHIFT) & GX_GPU_GP1_OPCODE_MASK;
	switch (opcode) {
	case GX_GPU_GP1_RESET:
		resetGpuRegisters();
		break;
	case GX_GPU_GP1_CLEAR_FIFO:
		flushImageLoadToVram();
		clearGp0CommandState();
		writeStatusIo();
		break;
	case GX_GPU_GP1_ACK_INTERRUPT:
		m_statusWord &= ~GX_GPU_STATUS_INTERRUPT_REQUEST;
		writeStatusIo();
		break;
	case GX_GPU_GP1_SET_DISPLAY_DISABLE:
		writeDisplayDisableWord(word);
		break;
	case GX_GPU_GP1_SET_DMA_DIRECTION:
		writeDmaDirectionWord(word);
		break;
	case GX_GPU_GP1_SET_DISPLAY_START:
		m_displayStartWord = word & GX_GPU_DISPLAY_START_MASK;
		updateScanoutStatusBits();
		writeStatusIo();
		break;
	case GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE:
		m_horizontalDisplayRangeWord = word & GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK;
		writeStatusIo();
		break;
	case GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE:
		m_verticalDisplayRangeWord = word & GX_GPU_VERTICAL_DISPLAY_RANGE_MASK;
		writeStatusIo();
		break;
	case GX_GPU_GP1_SET_DISPLAY_MODE:
		writeDisplayModeWord(word & GX_GPU_DISPLAY_MODE_MASK);
		break;
	case GX_GPU_GP1_SET_ALLOW_TEXTURE_DISABLE:
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
	updateScanoutStatusBits();
	updateDynamicStatusBits();
	m_deviceOutput.statusWord = m_statusWord;
	m_deviceOutput.displayModeWord = m_displayModeWord;
	m_deviceOutput.displayStartWord = m_displayStartWord;
	m_deviceOutput.horizontalDisplayRangeWord = m_horizontalDisplayRangeWord;
	m_deviceOutput.verticalDisplayRangeWord = m_verticalDisplayRangeWord;
	return m_deviceOutput;
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
	m_gp0CommandWords.fill(0u);
	m_gp0CommandWordCount = 0u;
	m_gp0CommandTargetWordCount = 0u;
	clearImageLoadState();
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

void GxGpu::finishImageLoadToVram() {
	pushGpuCommand(
		GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		m_gp0ImageLoadCommandOpcode,
		m_gp0ImageLoadCommandWordStart,
		m_gp0ImageLoadCommandWordCount);
	clearImageLoadState();
}

void GxGpu::flushImageLoadToVram() {
	if (m_gp0ImageLoadCommandWordCount > 3u) {
		finishImageLoadToVram();
	} else {
		clearImageLoadState();
	}
}

void GxGpu::consumeImageLoadWord() {
	m_commandBuffer.appendWord(m_gp0Word);
	m_gp0ImageLoadCommandWordCount += 1u;
	m_gp0ImageLoadWordsRemaining -= 1u;
	if (m_gp0ImageLoadWordsRemaining == 0u) {
		finishImageLoadToVram();
	}
}

void GxGpu::consumeGp0PolylinePayloadWord() {
	if (m_gp0PolylinePayloadPhase == 0u && (m_gp0Word & 0xf000f000u) == 0x50005000u) {
		pushGpuCommand(
			GX_GPU_COMMAND_DRAW_POLYLINE,
			m_gp0PolylineCommandOpcode,
			m_gp0PolylineCommandWordStart,
			m_gp0PolylineCommandWordCount);
		m_gp0PolylineWordsPerVertex = 0u;
		m_gp0PolylinePayloadPhase = 0u;
		m_gp0PolylineCommandWordStart = 0u;
		m_gp0PolylineCommandWordCount = 0u;
		m_gp0PolylineCommandOpcode = 0u;
		return;
	}
	m_commandBuffer.appendWord(m_gp0Word);
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

void GxGpu::emitFixedGp0Command(u8 kind, u32 opcode, u32 commandWordCount) {
	const size_t wordStart = m_commandBuffer.appendWords(m_gp0CommandWords.data(), commandWordCount);
	pushGpuCommand(kind, opcode, wordStart, commandWordCount);
}

void GxGpu::pushGpuCommand(u8 kind, u32 opcode, size_t wordStart, u32 commandWordCount) {
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
		gxGpuInterlacedRenderWord(m_statusWord, m_scanoutActiveLineLsb));
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
	writeStatusIo();
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
	writeStatusIo();
}

void GxGpu::writeGpuInfoQuery(u32 word) {
	switch (word & 0x7u) {
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
	u32 commandStatusBits = GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
	if (m_gp0CommandWordCount == 0u && m_gp0ImageLoadWordsRemaining == 0u && m_gp0PolylineWordsPerVertex == 0u) {
		commandStatusBits |= GX_GPU_STATUS_GPU_IDLE;
	}
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_COMMAND_STATE_MASK) | commandStatusBits;
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
