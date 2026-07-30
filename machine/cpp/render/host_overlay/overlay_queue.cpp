#include "render/host_overlay/overlay_queue.h"

namespace bmsx {

void HostOverlayQueue::publishOverlayFrame(const HostOverlayFrame& frame) {
	m_pendingFrame = frame;
	m_hasPendingFrame = true;
}

bool HostOverlayQueue::hasPendingOverlayFrame() const {
	return m_hasPendingFrame;
}

HostOverlayFrame HostOverlayQueue::consumeOverlayFrame() {
	m_hasPendingFrame = false;
	return m_pendingFrame;
}

void HostOverlayQueue::clearOverlayFrame() {
	m_hasPendingFrame = false;
}

void HostOverlayQueue::publishHostMenuFrame(const HostMenuFrame& frame) {
	m_pendingMenuFrame = frame;
	m_hasPendingMenuFrame = true;
}

bool HostOverlayQueue::hasPendingHostMenuFrame() const {
	return m_hasPendingMenuFrame;
}

HostMenuFrame HostOverlayQueue::consumeHostMenuFrame() {
	m_hasPendingMenuFrame = false;
	return m_pendingMenuFrame;
}

void HostOverlayQueue::clearHostMenuFrame() {
	m_hasPendingMenuFrame = false;
}

} // namespace bmsx
