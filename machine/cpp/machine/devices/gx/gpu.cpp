#include "machine/devices/gx/gpu.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"

namespace bmsx {

GxGpu::GxGpu(Memory& memory)
	: m_memory(memory)
	, m_displayModeWord(PSX_GPU_DISPLAY_MODE_PAL_WORD) {
	m_memory.mapIoRead(IO_GX_GPU_GP0, this, &GxGpu::readGp0Thunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP0, this, &GxGpu::writeGp0Thunk);
	m_memory.mapIoRead(IO_GX_GPU_GP1, this, &GxGpu::readStatusThunk);
	m_memory.mapIoWrite(IO_GX_GPU_GP1, this, &GxGpu::writeGp1Thunk);
}

void GxGpu::reset() {
	m_gp0Word = 0u;
	m_gp1Word = 0u;
	m_displayModeWord = PSX_GPU_DISPLAY_MODE_PAL_WORD;
	m_statusWord = GX_GPU_STATUS_RESET_WORD;
	m_displayStartWord = 0u;
	m_horizontalDisplayRangeWord = 0x00c60260u;
	m_verticalDisplayRangeWord = 0x0003fc10u;
	m_textureDisableMaskWord = 0u;
	updateDisplayModeStatusBits();
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
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));
	m_memory.writeIoValue(IO_GX_GPU_GP1, valueNumber(static_cast<double>(m_statusWord)));
}

u32 GxGpu::readGp0() const {
	return m_gp0Word;
}

void GxGpu::writeGp0(u32 word) {
	m_gp0Word = word;
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(static_cast<double>(m_gp0Word)));
	if ((m_gp0Word >> GX_GPU_GP0_OPCODE_SHIFT) == GX_GPU_GP0_IRQ_REQUEST) {
		m_statusWord |= GX_GPU_STATUS_INTERRUPT_REQUEST;
		writeStatusIo();
	}
}

u32 GxGpu::readStatus() const {
	return m_statusWord;
}

u32 GxGpu::writeGp1(u32 word) {
	m_gp1Word = word;
	const u32 opcode = word >> GX_GPU_GP1_OPCODE_SHIFT;
	switch (opcode) {
	case GX_GPU_GP1_RESET:
		reset();
		break;
	case GX_GPU_GP1_CLEAR_FIFO:
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
		writeDisplayModeWord(word & GX_GPU_GP1_PARAM_MASK);
		break;
	case GX_GPU_GP1_SET_TEXTURE_DISABLE_MASK:
		m_textureDisableMaskWord = word & 0x1u;
		writeStatusIo();
		break;
	default:
		writeStatusIo();
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

u32 GxGpu::readDisplayStartWord() const {
	return m_displayStartWord;
}

u32 GxGpu::readHorizontalDisplayRangeWord() const {
	return m_horizontalDisplayRangeWord;
}

u32 GxGpu::readVerticalDisplayRangeWord() const {
	return m_verticalDisplayRangeWord;
}

u32 GxGpu::readTextureDisableMaskWord() const {
	return m_textureDisableMaskWord;
}

void GxGpu::writeDisplayDisableWord(u32 word) {
	if ((word & 0x1u) != 0u) {
		m_statusWord |= GX_GPU_STATUS_DISPLAY_DISABLE;
	} else {
		m_statusWord &= ~GX_GPU_STATUS_DISPLAY_DISABLE;
	}
	writeStatusIo();
}

void GxGpu::writeDmaDirectionWord(u32 word) {
	const u32 dmaDirectionBits = (word & 0x3u) << GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
	m_statusWord = (m_statusWord & ~GX_GPU_STATUS_DMA_DIRECTION_MASK) | dmaDirectionBits;
	updateDmaRequestStatusBit();
	writeStatusIo();
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
}

void GxGpu::writeStatusIo() {
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
