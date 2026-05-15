#pragma once

#include "common/types.h"
#include "machine/cpu/string_pool.h"

namespace bmsx {

struct InputControllerRegisterState {
	u32 player = 1;
	StringId actionStringId = 0;
	StringId bindStringId = 0;
	u32 ctrl = 0;
	StringId queryStringId = 0;
	u32 status = 0;
	u32 value = 0;
	StringId consumeStringId = 0;
	u32 outputIntensityQ16 = 0;
	u32 outputDurationMs = 0;
};

} // namespace bmsx
