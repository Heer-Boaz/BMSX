#include "machine/devices/audio/source.h"

#include "machine/memory/memory.h"

namespace bmsx {

namespace {
constexpr ApuSourceDmaResult APU_SOURCE_DMA_OK{};
} // namespace

void ApuSourceDma::reset() {
	for (std::vector<u8>& bytes : m_slotSourceBytes) {
		bytes.clear();
	}
}

void ApuSourceDma::clearSlot(ApuAudioSlot slot) {
	std::vector<u8>& bytes = m_slotSourceBytes[slot];
	bytes.clear();
}

ApuSourceDmaResult ApuSourceDma::loadSlot(const Memory& memory, ApuAudioSlot slot, const ApuAudioSource& source) {
	if (apuAudioSourceUsesGenerator(source)) {
		clearSlot(slot);
		return APU_SOURCE_DMA_OK;
	}
	const ApuSourceDmaResult validation = validateSource(memory, source);
	if (validation.faultCode != APU_FAULT_NONE) {
		return validation;
	}
	std::vector<u8>& bytes = m_slotSourceBytes[slot];
	bytes.resize(source.sourceBytes);
	memory.readBytes(source.sourceAddr, bytes.data(), bytes.size());
	return APU_SOURCE_DMA_OK;
}

ApuSourceDmaResult ApuSourceDma::validateSource(const Memory& memory, const ApuAudioSource& source) const {
	if (source.sourceBytes == 0u) {
		return {APU_FAULT_SOURCE_BYTES, source.sourceBytes};
	}
	if (!memory.isReadableMainMemoryRange(source.sourceAddr, source.sourceBytes)) {
		return {APU_FAULT_SOURCE_RANGE, source.sourceAddr};
	}
	return APU_SOURCE_DMA_OK;
}

} // namespace bmsx
