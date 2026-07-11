#include "render/host_overlay/overlay_queue.h"

#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

} // namespace

int main() {
	bmsx::Host2DKind commandKinds[] = {bmsx::Host2DKind::Rect, bmsx::Host2DKind::Glyphs};
	const int rect = 1;
	const int glyphs = 2;
	bmsx::Host2DRef commandRefs[] = {&rect, &glyphs};
	const bmsx::HostMenuFrame frame{commandKinds, commandRefs, 2u};
	bmsx::publishHostMenuFrame(frame);
	require(bmsx::hasPendingHostMenuFrame(), "host menu frame should be pending after publication");
	const bmsx::HostMenuFrame consumed = bmsx::consumeHostMenuFrame();
	require(consumed.commandKinds == commandKinds, "host menu queue should retain the producer kind array");
	require(consumed.commandRefs == commandRefs, "host menu queue should retain the producer reference array");
	require(consumed.commandCount == 2u, "host menu queue should preserve the published command count");
	require(!bmsx::hasPendingHostMenuFrame(), "host menu frame should no longer be pending after consumption");
	bmsx::publishHostMenuFrame(frame);
	bmsx::clearHostMenuFrame();
	require(!bmsx::hasPendingHostMenuFrame(), "host menu clear should remove the pending frame");
	return 0;
}
