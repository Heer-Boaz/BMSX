#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/save_state.h"

#include <array>
#include <vector>

namespace bmsx {

class Memory;

struct ApuSourceDmaResult {
	u32 faultCode = APU_FAULT_NONE;
	u32 faultDetail = 0u;
};


class ApuSourceDma final {
public:
	void reset();
	void clearSlot(ApuAudioSlot slot);
	ApuSourceDmaResult loadSlot(const Memory& memory, ApuAudioSlot slot, const ApuAudioSource& source);
	const std::vector<u8>& bytesForSlot(ApuAudioSlot slot) const { return m_slotSourceBytes[slot]; }
	const ApuSlotSourceBytes& captureState() const;
	void restoreState(const ApuSlotSourceBytes& slotSourceBytes);

private:
	ApuSourceDmaResult validateSource(const Memory& memory, const ApuAudioSource& source) const;

	ApuSlotSourceBytes m_slotSourceBytes{};
};

} // namespace bmsx
