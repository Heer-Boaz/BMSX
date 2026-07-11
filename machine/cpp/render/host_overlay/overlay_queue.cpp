#include "render/host_overlay/overlay_queue.h"

namespace bmsx {
namespace {

HostOverlayFrame g_pendingFrame;
bool g_hasPendingFrame = false;
HostMenuFrame g_pendingMenuFrame;
bool g_hasPendingMenuFrame = false;

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

void publishHostMenuFrame(const HostMenuFrame& frame) {
	g_pendingMenuFrame = frame;
	g_hasPendingMenuFrame = true;
}

bool hasPendingHostMenuFrame() {
	return g_hasPendingMenuFrame;
}

HostMenuFrame consumeHostMenuFrame() {
	g_hasPendingMenuFrame = false;
	return g_pendingMenuFrame;
}

void clearHostMenuFrame() {
	g_hasPendingMenuFrame = false;
}

} // namespace bmsx
