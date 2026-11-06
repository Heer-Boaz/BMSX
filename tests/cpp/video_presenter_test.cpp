#include "render/video_presenter.h"
#include "render/backend/pass/library.h"
#include "render/shared/submissions.h"
#include "spec/bmsx/model.h"
#include "support/gpu_output_fixture.h"
#include <iostream>
#include <stdexcept>

using namespace bmsx;

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	i32 width = 256, height = 192;
	u32 changes = 0;
	void setDisplaySize(i32 w, i32 h, i32 viewportWidth, i32 viewportHeight) override { width = w; height = h; ++changes; visibleViewportBounds = RectBounds{0, 0, static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight), 0}; }
};

int main() {
	TestVideoOutput video(256, 192);
	auto backend = std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes);
	auto& software = *backend;
	backend->resizePresentationTarget(256, 192);
	VideoPresenter presenter(video, std::move(backend), 256, 192);
	require(&presenter.visibleViewportBounds == &video.visibleViewportBounds, "visible bounds are retained by the actual video output");
	require(presenter.visibleViewportBounds.left == 0 && presenter.visibleViewportBounds.top == 0
		&& presenter.visibleViewportBounds.right == 256 && presenter.visibleViewportBounds.bottom == 192,
		"initial visible bounds represent the actual initial target before any resize");
	presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&presenter.backend(), &presenter));
	presenter.crt_postprocessing_enabled = false;
	test::GpuOutputFixture fixture;
	fixture.scanout.backgroundColor = 0x00332211;
	presenter.configurePresentation(VideoPresenter::PresentationMode::Completed, true);
	presenter.present(fixture.output, 0, 0);
	const auto* initialPixels = software.framebuffer();
	const u32 initialPixel = initialPixels[0];
	const auto sequence = presenter.gameFrameSequence();
	const auto nativeConfiguration = presenter.deviceQuantizeConfigurationRevision();
	presenter.setFixedRenderTargetSize(384, 288, 384, 288);
	presenter.setFixedRenderTargetSize(512, 384, 512, 384);
	presenter.setFixedRenderTargetSize(384, 288, 384, 288);
	require(software.framebuffer() == initialPixels && initialPixels[0] == initialPixel && video.changes == 0,
		"size selection retains the displayed pixels and does not publish an undrawn target");
	require(presenter.viewportSize.x == 384 && presenter.canvasSize.x == 256,
		"logical selection and actual allocation remain distinct until presentation");
	presenter.configurePresentation(VideoPresenter::PresentationMode::Completed, false);
	presenter.present(fixture.output, 0, 0);
	require(video.changes == 1 && presenter.canvasSize.x == 384 && presenter.canvasSize.y == 288,
		"presentation coalesces requests into the final target");
	require(presenter.gameFrameSequence() == sequence, "host resizing does not commit a new game frame");
	require(presenter.visibleViewportBounds.right == 384 && presenter.visibleViewportBounds.bottom == 288,
		"native full-output bounds follow the actual target producer resize");
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
	require(software.framebuffer() == pixels && video.changes == 1, "host release retains the last rendered target");
	presenter.present(fixture.output, 0, 0);
	require(software.width() == 320 && software.height() == 240 && video.width == 320 && video.height == 240, "backend and video output share the selected target");
	presenter.setFixedRenderTargetSize(384, 288, 384, 288);
	presenter.useScanoutRenderTargetSize();
	presenter.present(fixture.output, 0, 0);
	require(video.changes == 2, "returning to the allocated size before drawing avoids reallocation");
	presenter.setFixedRenderTargetSize(320, 240, 320, 240);
	presenter.setScanoutSize(256, 192);
	require(video.changes == 2, "same-size host admission still establishes fixed sizing");
	presenter.setFixedRenderTargetSize(384, 288, 384, 288);
	presenter.useScanoutRenderTargetSize();
	presenter.present(fixture.output, 0, 0);
	require(software.width() == 256 && software.height() == 192, "fixed-size changes do not overwrite scanout size");
	presenter.setScanoutSize(320, 240);
	presenter.present(fixture.output, 0, 0);
	require(software.width() == 320 && software.height() == 240, "normal gameplay continues following scanout");
	std::cout << "VIDEO-PRESENTER-SIZING:PASS\n";
	// Complete frame coordinates survive a different destination allocation.
	const HostOverlayTransform transform{0.5F, 1, 0.5F};
	const HostOverlayClipRect clip{1, 1, 3, 2};
	const RectRenderSubmission fill{RectRenderKind::Fill, {0, 0, 4, 3, 0}, 0xffffffff, Layer2D::IDE};
	const Host2DKind kinds[]{Host2DKind::Transform, Host2DKind::Clip, Host2DKind::Rect};
	const Host2DRef refs[]{{.transform = &transform}, {.clip = &clip}, {.rect = &fill}};
	const HostOverlayFrame frame{4, 3, kinds, refs, 3};
	for (const bool menu : {false, true}) {
		if (menu) presenter.hostOverlayQueue.publishHostMenuFrame(frame); else presenter.hostOverlayQueue.publishOverlayFrame(frame);
		presenter.setFixedRenderTargetSize(12, 12, 12, 12);
		presenter.present(fixture.output, 0, 0);
		for (i32 y = 0; y < 12; y++) for (i32 x = 0; x < 12; x++) {
			const bool white = software.framebuffer()[y * 12 + x] == 0xffffffff;
			require(white == (x >= 3 && x < 9 && y >= 4 && y < 8), "both host lanes map frame-local transforms and clips to the target");
		}
	}
	std::cout << "HOST-FRAME-VIEWPORT:PASS\n";
	const auto nativeSequence = presenter.gameFrameSequence();
	const auto nativeRevision = presenter.deviceQuantizeConfigurationRevision();
	presenter.setFixedRenderTargetSize(96, 72, 32, 24);
	presenter.present(fixture.output, 0, 0);
	require(presenter.canvasSize.x == 96 && presenter.displayedViewportSize.x == 32
		&& video.visibleViewportBounds.right == 32 && video.visibleViewportBounds.bottom == 24,
		"raster density and published logical viewport are independent");
	const auto* densePixels = software.framebuffer();
	const auto priorChanges = video.changes;
	presenter.setFixedRenderTargetSize(96, 72, 48, 36);
	require(presenter.displayedViewportSize.x == 32 && video.changes == priorChanges,
		"logical selection does not publish undrawn input geometry");
	presenter.present(fixture.output, 0, 0);
	require(software.framebuffer() == densePixels && video.width == 96 && video.height == 72,
		"UI scaling reuses the physical raster buffer");
	require(video.changes == priorChanges + 1 && presenter.displayedViewportSize.x == 48
		&& video.visibleViewportBounds.right == 48 && video.visibleViewportBounds.bottom == 36,
		"logical-only presentation changes still publish the new coordinate frame");
	require(presenter.gameFrameSequence() == nativeSequence && presenter.deviceQuantizeConfigurationRevision() == nativeRevision,
		"UI scale and density do not rebuild native scanout or commit game history");
	std::cout << "HOST-DISPLAY-DENSITY:PASS\n";
}
