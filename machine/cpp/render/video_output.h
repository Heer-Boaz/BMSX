#pragma once

#include "common/primitives.h"

namespace bmsx {

class VideoOutput {
public:
	virtual ~VideoOutput() = default;
	virtual void setDisplaySize(i32 width, i32 height) = 0;
};

} // namespace bmsx
