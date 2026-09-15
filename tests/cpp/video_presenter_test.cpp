#include "render/video_presenter.h"
#include "render/backend/pass/library.h"
#include "spec/bmsx/model.h"
#include <iostream>
#include <stdexcept>

using namespace bmsx;

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

class TestVideoOutput final : public VideoOutput {
public:
	i32 width = 256, height = 192;
	u32 changes = 0;
	void setDisplaySize(i32 w, i32 h) override { width = w; height = h; ++changes; }
};

int main() {
	TestVideoOutput video;
	auto backend = std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes);
	auto& software = *backend;
	backend->resizePresentationTarget(256, 192);
	VideoPresenter presenter(video, std::move(backend), 256, 192);
	presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&presenter.backend(), &presenter));
	const auto nativeConfiguration = presenter.deviceQuantizeConfigurationRevision();
	presenter.setFixedRenderTargetSize(384, 288);
	require(presenter.offscreenCanvasSize.x == 256 && presenter.offscreenCanvasSize.y == 192, "host admission retains native dimensions");
	require(presenter.deviceQuantizeConfigurationRevision() == nativeConfiguration, "host admission retains native graph");
	const auto* pixels = software.framebuffer();
	const auto configuration = presenter.deviceQuantizeConfigurationRevision();
	presenter.setScanoutSize(256, 192);
	presenter.setScanoutSize(320, 240);
	require(presenter.viewportSize.x == 384 && presenter.viewportSize.y == 288, "scanout updates do not resize a fixed host surface");
	require(software.framebuffer() == pixels && video.changes == 1, "scanout updates retain targets and do not relayout the host");
	require(presenter.offscreenCanvasSize.x == 320 && presenter.offscreenCanvasSize.y == 240, "native size follows scanout under fixed host target");
	require(presenter.deviceQuantizeConfigurationRevision() == configuration + 1, "only native geometry rebuilds graph");
	presenter.useScanoutRenderTargetSize();
	require(presenter.deviceQuantizeConfigurationRevision() == configuration + 1, "host release retains native graph");
	require(presenter.viewportSize.x == 320 && presenter.viewportSize.y == 240, "release uses latest scanout, not entry size");
	require(software.width() == 320 && software.height() == 240 && video.width == 320 && video.height == 240, "backend and video output share the selected target");
	presenter.setFixedRenderTargetSize(320, 240);
	presenter.setScanoutSize(256, 192);
	require(video.changes == 2, "same-size host admission still establishes fixed sizing");
	presenter.setFixedRenderTargetSize(384, 288);
	presenter.useScanoutRenderTargetSize();
	require(software.width() == 256 && software.height() == 192, "fixed-size changes do not overwrite scanout size");
	presenter.setScanoutSize(320, 240);
	require(software.width() == 320 && software.height() == 240, "normal gameplay continues following scanout");
	std::cout << "VIDEO-PRESENTER-SIZING:PASS\n";
}
