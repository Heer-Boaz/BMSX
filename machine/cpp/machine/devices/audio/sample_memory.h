#pragma once

#include "common/primitives.h"
#include "machine/devices/audio/contracts.h"

#include <array>
#include <vector>

namespace bmsx {

class Memory;

class ApuSampleMemory final {
public:
	explicit ApuSampleMemory(const Memory& memory);

	void reset();
	bool bindSource(u32 address, u32 byteLength, Span<const u8>& out) const;
	[[nodiscard]] auto readWord(u32 address) const -> u32;
	void writeWord(u32 address, u32 word);
	[[nodiscard]] auto captureState() const -> std::vector<u8>;
	void restoreState(const std::vector<u8>& bytes);

private:
	const Memory& m_memory;
	std::array<u8, APU_SAMPLE_RAM_BYTES> m_ram{};
};

} // namespace bmsx
