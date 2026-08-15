#include "machine/devices/system/debug_transmit.h"

#include "common/utf8.h"
#include "machine/memory/memory.h"

namespace bmsx {

SystemDebugTransmit::SystemDebugTransmit(Memory& memory)
	: m_memory(memory) {
	memory.mapIoWrite<&SystemDebugTransmit::writeChar>(IO_SYS_PRINT_CHAR, *this);
	memory.mapIoWrite<&SystemDebugTransmit::flushLine>(IO_SYS_PRINT_FLUSH, *this);
}

void SystemDebugTransmit::reset() {
	clearOutput();
	m_charWord = 0u;
	m_flushWord = 0u;
	m_memory.writeIoU32(IO_SYS_PRINT_CHAR, 0u);
	m_memory.writeIoU32(IO_SYS_PRINT_FLUSH, 0u);
}

auto SystemDebugTransmit::captureState() const -> SystemDebugTransmitState {
	return {
		m_charWord,
		m_flushWord,
	};
}

void SystemDebugTransmit::restoreState(const SystemDebugTransmitState& state) {
	clearOutput();
	m_charWord = state.charWord;
	m_flushWord = state.flushWord;
	m_memory.writeIoU32(IO_SYS_PRINT_CHAR, state.charWord);
	m_memory.writeIoU32(IO_SYS_PRINT_FLUSH, state.flushWord);
}

auto SystemDebugTransmit::availableByteCount() const -> u32 {
	return m_completeByteCount;
}

auto SystemDebugTransmit::readByte() -> u8 {
	const u8 value = m_outputBytes[m_outputReadIndex];
	m_outputReadIndex = (m_outputReadIndex + 1u) & (SYS_PRINT_BUFFER_BYTES - 1u);
	m_outputByteCount -= 1u;
	m_completeByteCount -= 1u;
	return value;
}

void SystemDebugTransmit::writeChar([[maybe_unused]] u32 address, u32 value) {
	m_charWord = value;
	const u32 byteCount = encodeUtf8Codepoint(value, m_encodingBytes);
	if (!reserveBytes(byteCount)) {
		return;
	}
	for (u32 index = 0u; index < byteCount; ++index) {
		appendByte(m_encodingBytes[index]);
	}
}

void SystemDebugTransmit::flushLine([[maybe_unused]] u32 address, u32 value) {
	m_flushWord = value;
	if (reserveBytes(1u)) {
		appendByte(static_cast<u8>('\n'));
		m_completeByteCount = m_outputByteCount;
	}
	m_lineOverflowed = false;
}

auto SystemDebugTransmit::reserveBytes(u32 byteCount) -> bool {
	if (m_lineOverflowed) {
		return false;
	}
	if (m_outputByteCount + byteCount <= SYS_PRINT_BUFFER_BYTES) {
		return true;
	}
	m_outputByteCount = m_completeByteCount;
	m_lineOverflowed = true;
	return false;
}

void SystemDebugTransmit::clearOutput() {
	m_outputReadIndex = 0u;
	m_outputByteCount = 0u;
	m_completeByteCount = 0u;
	m_lineOverflowed = false;
}

void SystemDebugTransmit::appendByte(u8 value) {
	m_outputBytes[(m_outputReadIndex + m_outputByteCount) & (SYS_PRINT_BUFFER_BYTES - 1u)] = value;
	m_outputByteCount += 1u;
}

} // namespace bmsx
