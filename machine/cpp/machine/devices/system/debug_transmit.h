#pragma once

#include "common/primitives.h"
#include "spec/bmsx/io.h"

#include <array>

namespace bmsx {

class Memory;

struct SystemDebugTransmitState {
	u32 charWord = 0u;
	u32 flushWord = 0u;
};

class SystemDebugTransmit final {
public:
	explicit SystemDebugTransmit(Memory& memory);

	void reset();
	void clearOutput();
	[[nodiscard]] auto captureState() const -> SystemDebugTransmitState;
	void restoreState(const SystemDebugTransmitState& state);
	[[nodiscard]] auto availableByteCount() const -> u32;
	[[nodiscard]] auto readByte() -> u8;

private:
	void writeChar(u32 address, u32 value);
	void flushLine(u32 address, u32 value);
	[[nodiscard]] auto reserveBytes(u32 byteCount) -> bool;
	void appendByte(u8 value);

	Memory& m_memory;
	u32 m_charWord = 0u;
	u32 m_flushWord = 0u;
	std::array<u8, SYS_PRINT_BUFFER_BYTES> m_outputBytes{};
	u32 m_outputReadIndex = 0u;
	u32 m_outputByteCount = 0u;
	u32 m_completeByteCount = 0u;
	bool m_lineOverflowed = false;
	std::array<u8, 4> m_encodingBytes{};
};

} // namespace bmsx
