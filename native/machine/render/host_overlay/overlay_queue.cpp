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
	g_hasPendingFrame = false;
	return g_pendingFrame;
}

void clearOverlayFrame() {
	g_hasPendingFrame = false;
}

} // namespace bmsx
