#pragma once

#include "common/types.h"
#include "machine/devices/vdp/device_output.h"
#include <vector>

namespace bmsx {

enum class VdpFbmState : u8 {
	PageWritable = 0,
	PagePendingPresent = 1,
	PagePresented = 2,
	ReadbackRequested = 3,
};

class VdpFbmUnit {
public:
	u32 width() const { return m_width; }
	u32 height() const { return m_height; }
	VdpFbmState state() const { return m_state; }
	const std::vector<u8>& displayReadback() const { return m_displayFrameBufferCpuReadback; }
	bool hasPendingPresentation() const { return m_presentationCount != 0u; }

	void configure(u32 width, u32 height);
	std::vector<u8> captureDisplayReadback() const;
	void restoreDisplayReadback(const std::vector<u8>& pixels);
	void presentPage(VdpSurfaceUploadSlot& renderSlot);
	void copyReadbackPixelsFrom(const std::vector<u8>& source, u32 x, u32 y, u32 width, u32 height, u8* out);
	const VdpFrameBufferPresentation& buildPresentation(const std::vector<u8>& renderReadback, bool forceFullSync = false);
	void clearPresentation();
	void drainPresentation(VdpFrameBufferPresentationSink& sink, const std::vector<u8>& renderReadback);
	void syncPresentation(VdpFrameBufferPresentationSink& sink, const std::vector<u8>& renderReadback);

private:
	void resetPresentation();

	u32 m_width = 0u;
	u32 m_height = 0u;
	VdpFbmState m_state = VdpFbmState::PageWritable;
	std::vector<u8> m_displayFrameBufferCpuReadback;
	u32 m_presentationCount = 0u;
	bool m_presentationRequiresFullSync = false;
	u32 m_presentationDirtyRowStart = 0u;
	u32 m_presentationDirtyRowEnd = 0u;
	std::vector<VdpDirtySpan> m_presentationDirtySpansByRow;
	VdpFrameBufferPresentation m_presentationOutput;
};

} // namespace bmsx
