#include "render/host_overlay/clip.h"
#include "render/host_overlay/software/renderer.h"
#include "support/host_overlay_fixture.h"
#include "spec/bmsx/model.h"
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace bmsx;

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

int main() {
	HostOverlayClipState scissor;
	const HostOverlayClipRect clip{11, 9, 43, 34};
	scissor.reset(64, 48, 160, 120);
	scissor.set(clip);
	require(scissor.left == 27 && scissor.top == 22 && scissor.right == 107 && scissor.bottom == 85, "logical scissor mapping");
	scissor.set({-30, -20, 100, 100});
	require(scissor.left == 0 && scissor.top == 0 && scissor.right == 160 && scissor.bottom == 120, "scissor target intersection");
	scissor.set({80, 30, 90, 20});
	require(scissor.left == 160 && scissor.top == 75 && scissor.right == 160 && scissor.bottom == 75, "empty scissor intersection");

	SoftwareBackend backend(64, 48, PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(64, 48);
	Host2DPipelineState state;
	test::HostOverlayFixture fixture;
	std::vector<u32> reference(64 * 48);
	for (size_t index = 0; index < fixture.kinds.size(); ++index) {
		std::fill_n(backend.framebuffer(), reference.size(), 0);
		beginHostOverlaySoftware(backend, state);
		renderHost2DEntrySoftware(backend, fixture.kinds[index], fixture.refs[index]);
		std::copy_n(backend.framebuffer(), reference.size(), reference.begin());
		std::fill_n(backend.framebuffer(), reference.size(), 0);
		renderHost2DEntrySoftware(backend, Host2DKind::Clip, {.clip = &clip});
		renderHost2DEntrySoftware(backend, fixture.kinds[index], fixture.refs[index]);
		int lit = 0;
		for (int y = 0; y < 48; ++y) {
			for (int x = 0; x < 64; ++x) {
				const bool inside = x >= clip.left && x < clip.right && y >= clip.top && y < clip.bottom;
				const size_t offset = static_cast<size_t>(y * 64 + x);
				require(backend.framebuffer()[offset] == (inside ? reference[offset] : 0), "clipping must crop, not reposition or resample");
				lit += backend.framebuffer()[offset] != 0;
			}
		}
		require(lit > 0, "fixture must have partially visible pixels");
		endHostOverlaySoftware(backend);
		require(backend.hostOverlayClip.left == 0 && backend.hostOverlayClip.right == 64, "pass end releases the scissor");
	}
	std::cout << "HOST-OVERLAY-CLIP:PASS\n";
}
