#include "render/host_overlay/overlay_queue.h"

namespace bmsx {
namespace {

HostOverlayFrame g_pendingFrame;
bool g_hasPendingFrame = false;

} // namespace

void publishOverlayFrame(const HostOverlayFrame& frame) {
	g_pendingFrame = frame;
	g_hasPendingFrame = true;
}

bool hasPendingOverlayFrame() {
	return g_hasPendingFrame;
}

HostOverlayFrame consumeOverlayFrame() {
	const HostOverlayFrame frame = g_pendingFrame;
	g_hasPendingFrame = false;
	return frame;
}

void clearOverlayFrame() {
	g_hasPendingFrame = false;
}

} // namespace bmsx
