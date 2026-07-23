#include "machine/devices/audio/sample_memory.h"

#include "common/endian.h"
#include "machine/memory/memory.h"

#include <algorithm>

namespace bmsx {

ApuSampleMemory::ApuSampleMemory(const Memory& memory)
	: m_memory(memory) {}

void ApuSampleMemory::reset() {
	m_ram.fill(0u);
}

bool ApuSampleMemory::bindSource(u32 address, u32 byteLength, u32 cartridgeSlot, ApuSourceByteView& out) const {
	if (address >= APU_SAMPLE_RAM_BASE) {
		const u32 offset = address - APU_SAMPLE_RAM_BASE;
		if (byteLength != 0u
			&& byteLength <= APU_SAMPLE_RAM_BYTES
			&& offset <= APU_SAMPLE_RAM_BYTES - byteLength) {
			out.bytes = {m_ram.data() + offset, byteLength};
			out.cartridgeSlot = cartridgeSlot;
			return true;
		}
		return false;
	}
	out.cartridgeSlot = cartridgeSlot;
	return m_memory.bindRomByteView(address, byteLength, cartridgeSlot, out.bytes);
}

auto ApuSampleMemory::readWord(u32 address) const -> u32 {
	return readLE32(m_ram.data() + (address & (APU_SAMPLE_RAM_ADDRESS_MASK & ~3u)));
}

void ApuSampleMemory::writeWord(u32 address, u32 word) {
	writeLE32(m_ram.data() + (address & (APU_SAMPLE_RAM_ADDRESS_MASK & ~3u)), word);
}

auto ApuSampleMemory::captureState() const -> std::vector<u8> {
	return {m_ram.begin(), m_ram.end()};
}

void ApuSampleMemory::restoreState(const std::vector<u8>& bytes) {
	std::copy(bytes.begin(), bytes.end(), m_ram.begin());
}

} // namespace bmsx
