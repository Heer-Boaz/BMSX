#pragma once
#include "machine/devices/input/contracts.h"

namespace bmsx {

class RuntimeInputSource : public InputControllerInputSource {
public:
	~RuntimeInputSource() override = default;
	virtual void setRuntimeInputFrameDurationMs(f64 frameDurationMs) = 0;
};

} // namespace bmsx
