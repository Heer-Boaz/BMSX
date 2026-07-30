#pragma once

#include "render/host_overlay/commands.h"
#include <cstddef>

namespace bmsx {

struct HostOverlayFrame {
	i32 logicalWidth = 0;
	i32 logicalHeight = 0;
	i32 renderWidth = 0;
	i32 renderHeight = 0;
	const Host2DKind* commandKinds = nullptr;
	const Host2DRef* commandRefs = nullptr;
	size_t commandCount = 0;
};

struct HostMenuFrame {
	const Host2DKind* commandKinds = nullptr;
	const Host2DRef* commandRefs = nullptr;
	size_t commandCount = 0;
};

class HostOverlayQueue {
public:
	void publishOverlayFrame(const HostOverlayFrame& frame);
	bool hasPendingOverlayFrame() const;
	HostOverlayFrame consumeOverlayFrame();
	void clearOverlayFrame();
	void publishHostMenuFrame(const HostMenuFrame& frame);
	bool hasPendingHostMenuFrame() const;
	HostMenuFrame consumeHostMenuFrame();
	void clearHostMenuFrame();

private:
	HostOverlayFrame m_pendingFrame;
	bool m_hasPendingFrame = false;
	HostMenuFrame m_pendingMenuFrame;
	bool m_hasPendingMenuFrame = false;
};

} // namespace bmsx
