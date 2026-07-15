#include "machine/devices/gx/system_vram_port.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/memory/memory.h"

#include <algorithm>

namespace bmsx {

GxGpuSystemVramPort::GxGpuSystemVramPort(Memory& memory) {
	memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_POSITION, this, &GxGpuSystemVramPort::readRegister);
	memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_SIZE, this, &GxGpuSystemVramPort::readRegister);
	memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_CONTROL, this, &GxGpuSystemVramPort::readRegister);
	memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_DATA, this, &GxGpuSystemVramPort::readRegister);
	memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_STATUS, this, &GxGpuSystemVramPort::readRegister);
	memory.mapIoWrite(IO_GX_GPU_SYSTEM_VRAM_POSITION, this, &GxGpuSystemVramPort::writeRegister);
	memory.mapIoWrite(IO_GX_GPU_SYSTEM_VRAM_SIZE, this, &GxGpuSystemVramPort::writeRegister);
	memory.mapIoWrite(IO_GX_GPU_SYSTEM_VRAM_CONTROL, this, &GxGpuSystemVramPort::writeRegister);
	memory.mapIoWrite(IO_GX_GPU_SYSTEM_VRAM_DATA, this, &GxGpuSystemVramPort::writeRegister);
}

void GxGpuSystemVramPort::reset() {
	m_positionWord = 0u;
	m_sizeWord = 0u;
	m_controlWord = 0u;
	m_dataWord = 0u;
	m_statusWord = 0u;
	commandCount = 0u;
	presentCommandCount = 0u;
	wordCount = 0u;
	m_activePositionWord = 0u;
	m_activeSizeWord = 0u;
	m_activeWordStart = 0u;
	m_activeWordsRemaining = 0u;
	publishRevision();
}

GxGpuSystemVramPortState GxGpuSystemVramPort::captureState() const {
	GxGpuSystemVramPortState state;
	state.positionWord = m_positionWord;
	state.sizeWord = m_sizeWord;
	state.controlWord = m_controlWord;
	state.dataWord = m_dataWord;
	state.statusWord = m_statusWord;
	state.commandCount = commandCount;
	state.presentCommandCount = presentCommandCount;
	state.wordCount = wordCount;
	state.activePositionWord = m_activePositionWord;
	state.activeSizeWord = m_activeSizeWord;
	state.activeWordStart = m_activeWordStart;
	state.activeWordsRemaining = m_activeWordsRemaining;
	state.commandPositionWord.assign(commandPositionWord.begin(), commandPositionWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
	state.commandSizeWord.assign(commandSizeWord.begin(), commandSizeWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
	state.commandWordStart.assign(commandWordStart.begin(), commandWordStart.begin() + static_cast<std::ptrdiff_t>(commandCount));
	state.words.assign(words.begin(), words.begin() + static_cast<std::ptrdiff_t>(wordCount));
	return state;
}

void GxGpuSystemVramPort::restoreState(const GxGpuSystemVramPortState& state) {
	m_positionWord = state.positionWord;
	m_sizeWord = state.sizeWord;
	m_controlWord = state.controlWord;
	m_dataWord = state.dataWord;
	m_statusWord = state.statusWord;
	commandCount = state.commandCount;
	presentCommandCount = state.presentCommandCount;
	wordCount = state.wordCount;
	m_activePositionWord = state.activePositionWord;
	m_activeSizeWord = state.activeSizeWord;
	m_activeWordStart = state.activeWordStart;
	m_activeWordsRemaining = state.activeWordsRemaining;
	std::copy(state.commandPositionWord.begin(), state.commandPositionWord.end(), commandPositionWord.begin());
	std::copy(state.commandSizeWord.begin(), state.commandSizeWord.end(), commandSizeWord.begin());
	std::copy(state.commandWordStart.begin(), state.commandWordStart.end(), commandWordStart.begin());
	std::copy(state.words.begin(), state.words.end(), words.begin());
	publishRevision();
}

void GxGpuSystemVramPort::sealForPresentation() {
	presentCommandCount = commandCount;
}

void GxGpuSystemVramPort::retirePresentedCommands() {
	const size_t retiredCommands = presentCommandCount;
	if (retiredCommands == 0u) {
		return;
	}
	const size_t oldCommandCount = commandCount;
	const size_t oldWordCount = wordCount;
	const size_t retiredWords = retiredCommands < oldCommandCount
		? commandWordStart[retiredCommands]
		: m_activeWordsRemaining != 0u ? m_activeWordStart : oldWordCount;
	const size_t remainingCommands = oldCommandCount - retiredCommands;
	std::move(commandPositionWord.begin() + static_cast<std::ptrdiff_t>(retiredCommands), commandPositionWord.begin() + static_cast<std::ptrdiff_t>(oldCommandCount), commandPositionWord.begin());
	std::move(commandSizeWord.begin() + static_cast<std::ptrdiff_t>(retiredCommands), commandSizeWord.begin() + static_cast<std::ptrdiff_t>(oldCommandCount), commandSizeWord.begin());
	std::move(commandWordStart.begin() + static_cast<std::ptrdiff_t>(retiredCommands), commandWordStart.begin() + static_cast<std::ptrdiff_t>(oldCommandCount), commandWordStart.begin());
	for (size_t commandIndex = 0u; commandIndex < remainingCommands; commandIndex += 1u) {
		commandWordStart[commandIndex] -= static_cast<u32>(retiredWords);
	}
	std::move(words.begin() + static_cast<std::ptrdiff_t>(retiredWords), words.begin() + static_cast<std::ptrdiff_t>(oldWordCount), words.begin());
	commandCount = remainingCommands;
	presentCommandCount = 0u;
	wordCount = oldWordCount - retiredWords;
	if (m_activeWordsRemaining != 0u) {
		m_activeWordStart -= retiredWords;
	}
	publishRevision();
	updateStatus();
}

void GxGpuSystemVramPort::publishRevision() {
	nextSerial += 1u;
	serial = nextSerial;
}

void GxGpuSystemVramPort::abortTransfers() {
	commandCount = 0u;
	presentCommandCount = 0u;
	wordCount = 0u;
	m_activePositionWord = 0u;
	m_activeSizeWord = 0u;
	m_activeWordStart = 0u;
	m_activeWordsRemaining = 0u;
	m_statusWord = 0u;
	publishRevision();
}

void GxGpuSystemVramPort::beginTransfer() {
	if (m_activeWordsRemaining != 0u) {
		m_statusWord |= GX_GPU_SYSTEM_VRAM_PORT_STATUS_OVERFLOW;
		updateStatus();
		return;
	}
	const u32 pixelCount = gxGpuSystemVramWidth(m_sizeWord) * gxGpuSystemVramHeight(m_sizeWord);
	const u32 transferWordCount = (pixelCount + 1u) >> 1u;
	if (commandCount == GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY
		|| wordCount + transferWordCount > GX_GPU_SYSTEM_VRAM_PORT_WORD_CAPACITY) {
		m_statusWord |= GX_GPU_SYSTEM_VRAM_PORT_STATUS_OVERFLOW;
		updateStatus();
		return;
	}
	m_activeWordStart = wordCount;
	m_activePositionWord = m_positionWord;
	m_activeSizeWord = m_sizeWord;
	m_activeWordsRemaining = transferWordCount;
	updateStatus();
}

void GxGpuSystemVramPort::writeData(u32 word) {
	m_dataWord = word;
	if (m_activeWordsRemaining == 0u) {
		return;
	}
	words[wordCount] = word;
	wordCount += 1u;
	m_activeWordsRemaining -= 1u;
	if (m_activeWordsRemaining == 0u) {
		const size_t commandIndex = commandCount;
		commandPositionWord[commandIndex] = m_activePositionWord;
		commandSizeWord[commandIndex] = m_activeSizeWord;
		commandWordStart[commandIndex] = static_cast<u32>(m_activeWordStart);
		commandCount = commandIndex + 1u;
		m_activePositionWord = 0u;
		m_activeSizeWord = 0u;
		m_activeWordStart = 0u;
	}
	updateStatus();
}

void GxGpuSystemVramPort::updateStatus() {
	const u32 retainedStatus = m_statusWord & GX_GPU_SYSTEM_VRAM_PORT_STATUS_OVERFLOW;
	m_statusWord = retainedStatus
		| (m_activeWordsRemaining != 0u ? GX_GPU_SYSTEM_VRAM_PORT_STATUS_BUSY | GX_GPU_SYSTEM_VRAM_PORT_STATUS_WRITE_READY : 0u)
		| (commandCount != 0u ? GX_GPU_SYSTEM_VRAM_PORT_STATUS_PENDING : 0u)
		| (m_activeWordsRemaining << GX_GPU_SYSTEM_VRAM_PORT_STATUS_REMAINING_SHIFT);
}

u64 GxGpuSystemVramPort::readRegister(void* context, u32 address) {
	auto& port = *static_cast<GxGpuSystemVramPort*>(context);
	switch (address) {
	case IO_GX_GPU_SYSTEM_VRAM_POSITION:
		return valueNumber(static_cast<double>(port.m_positionWord));
	case IO_GX_GPU_SYSTEM_VRAM_SIZE:
		return valueNumber(static_cast<double>(port.m_sizeWord));
	case IO_GX_GPU_SYSTEM_VRAM_CONTROL:
		return valueNumber(static_cast<double>(port.m_controlWord));
	case IO_GX_GPU_SYSTEM_VRAM_DATA:
		return valueNumber(static_cast<double>(port.m_dataWord));
	case IO_GX_GPU_SYSTEM_VRAM_STATUS:
		return valueNumber(static_cast<double>(port.m_statusWord));
	}
	throw BMSX_RUNTIME_ERROR("GX system VRAM port read outside mapped registerfile.");
}

void GxGpuSystemVramPort::writeRegister(void* context, u32 address, u64 value) {
	auto& port = *static_cast<GxGpuSystemVramPort*>(context);
	const u32 word = toU32(value);
	switch (address) {
	case IO_GX_GPU_SYSTEM_VRAM_POSITION:
		port.m_positionWord = word;
		return;
	case IO_GX_GPU_SYSTEM_VRAM_SIZE:
		port.m_sizeWord = word;
		return;
	case IO_GX_GPU_SYSTEM_VRAM_CONTROL:
		port.m_controlWord = word;
		if ((word & GX_GPU_SYSTEM_VRAM_PORT_CONTROL_RESET) != 0u) {
			port.abortTransfers();
		}
		if ((word & GX_GPU_SYSTEM_VRAM_PORT_CONTROL_START) != 0u) {
			port.beginTransfer();
		}
		return;
	case IO_GX_GPU_SYSTEM_VRAM_DATA:
		port.writeData(word);
		return;
	}
	throw BMSX_RUNTIME_ERROR("GX system VRAM port write outside mapped registerfile.");
}

} // namespace bmsx
