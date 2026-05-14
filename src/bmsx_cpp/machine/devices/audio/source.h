#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <array>
#include <vector>

namespace bmsx {

class Memory;

struct ApuSourceDmaResult {
	u32 faultCode = APU_FAULT_NONE;
	u32 faultDetail = 0u;
};

using ApuSlotSourceBytes = std::array<std::vector<u8>, APU_SLOT_COUNT>;

class ApuSourceDma final {
public:
	void reset();
	void clearSlot(ApuAudioSlot slot);
	ApuSourceDmaResult loadSlot(const Memory& memory, ApuAudioSlot slot, const ApuAudioSource& source);
	const std::vector<u8>& bytesForSlot(ApuAudioSlot slot) const { return m_slotSourceBytes[slot]; }
	const ApuSlotSourceBytes& captureState() const { return m_slotSourceBytes; }
	void restoreState(const ApuSlotSourceBytes& slotSourceBytes) { m_slotSourceBytes = slotSourceBytes; }

private:
	ApuSourceDmaResult validateSource(const Memory& memory, const ApuAudioSource& source) const;

	ApuSlotSourceBytes m_slotSourceBytes{};
};

} // namespace bmsx
