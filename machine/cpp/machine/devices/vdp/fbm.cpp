#include "machine/devices/vdp/fbm.h"

namespace bmsx {

VdpFbmUnit::VdpFbmUnit(u32 width, u32 height) {
	configure(width, height);
}

void VdpFbmUnit::configure(u32 width, u32 height) {
	m_width = width;
	m_height = height;
	const size_t byteLength = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
	m_displayFrameBufferCpuReadback.resize(byteLength);
	for (size_t index = 0u; index < byteLength; ++index) {
		m_displayFrameBufferCpuReadback[index] = 0u;
	}
}

std::vector<u8> VdpFbmUnit::captureDisplayReadback() const {
	std::vector<u8> pixels;
	pixels.resize(m_displayFrameBufferCpuReadback.size());
	for (size_t index = 0u; index < m_displayFrameBufferCpuReadback.size(); ++index) {
		pixels[index] = m_displayFrameBufferCpuReadback[index];
	}
	return pixels;
}

void VdpFbmUnit::restoreDisplayReadback(const std::vector<u8>& pixels) {
	m_displayFrameBufferCpuReadback.resize(pixels.size());
	for (size_t index = 0u; index < pixels.size(); ++index) {
		m_displayFrameBufferCpuReadback[index] = pixels[index];
	}
}

} // namespace bmsx
