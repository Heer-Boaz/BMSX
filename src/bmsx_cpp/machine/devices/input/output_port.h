#pragma once

#include "common/types.h"

namespace bmsx {

class Input;

class InputControllerOutputPort {
public:
	explicit InputControllerOutputPort(Input& input);

	u32 readStatus(u32 player) const;
	void apply(u32 player, u32 intensityQ16, u32 durationMs);

private:
	Input& m_input;
};

} // namespace bmsx
