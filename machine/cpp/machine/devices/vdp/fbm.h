#pragma once

#include "common/types.h"
#include <vector>

namespace bmsx {

class VdpFbmUnit {
public:
	VdpFbmUnit(u32 width, u32 height);

	u32 width() const { return m_width; }
	u32 height() const { return m_height; }

	void configure(u32 width, u32 height);
	std::vector<u8> captureDisplayReadback() const;
	void restoreDisplayReadback(const std::vector<u8>& pixels);
	const std::vector<u8>& displayReadback() const { return m_displayFrameBufferCpuReadback; }

private:
	u32 m_width = 0u;
	u32 m_height = 0u;
	std::vector<u8> m_displayFrameBufferCpuReadback;
};

} // namespace bmsx
