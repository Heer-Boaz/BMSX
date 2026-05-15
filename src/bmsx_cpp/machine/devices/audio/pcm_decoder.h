#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

namespace bmsx {

struct ApuPcmValidationResult {
	u32 faultCode = APU_FAULT_NONE;
	u32 faultDetail = 0u;
};

ApuPcmValidationResult validateApuPcmSourceData(const ApuAudioSource& source);

} // namespace bmsx
