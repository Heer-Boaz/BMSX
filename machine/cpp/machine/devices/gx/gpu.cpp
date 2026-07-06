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
	m_statusWord = GX_GPU_STATUS_READY_WORD;
	updateDisplayModeStatusBits();
	m_memory.writeIoValue(IO_GX_GPU_GP0, valueNumber(0.0));
	m_memory.writeIoValue(IO_GX_GPU_GP1, valueNumber(static_cast<double>(m_statusWord)));
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
	case GX_GPU_GP1_SET_DISPLAY_MODE:
		writeDisplayModeWord(word & GX_GPU_GP1_PARAM_MASK);
		break;
	default:
		m_memory.writeIoValue(IO_GX_GPU_GP1, valueNumber(static_cast<double>(m_statusWord)));
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
	m_memory.writeIoValue(IO_GX_GPU_GP1, valueNumber(static_cast<double>(m_statusWord)));
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
