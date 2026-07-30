#pragma once

#include "audio_output.h"
#include "host.h"
#include "input.h"
#include "video_output.h"
#include "machine/devices/gx/gpu_display.h"
#include "render/backend/pass/library.h"
#include "render/shared/bmsx_font.h"
#include "render/video_presenter.h"
#include "spec/bmsx/model.h"

#include <memory>
#include <string_view>

namespace bmsx::test {

class LibretroSoftwareProduct {
public:
	LibretroSoftwareProduct(
		bmsx_supervisor_request_line_t supervisorRequestLine,
		retro_environment_t environment,
		void (*logCallback)(enum retro_log_level, const char*, ...),
		std::string_view systemDirectory = {})
		: input(supervisorRequestLine)
		, videoOutput(avInfo)
		, presenter(
			videoOutput,
			std::make_unique<SoftwareBackend>(
				static_cast<i32>(gxGpuDisplayModeScreenWidth(
					GX_GPU_RESET_DISPLAY_MODE_WORD)),
				gxGpuVerticalVisibleLines(
					GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
					GX_GPU_RESET_DISPLAY_MODE_WORD),
				PSX_MACHINE_SPEC.gxGpuVramBytes),
			static_cast<i32>(gxGpuDisplayModeScreenWidth(
				GX_GPU_RESET_DISPLAY_MODE_WORD)),
			gxGpuVerticalVisibleLines(
				GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
				GX_GPU_RESET_DISPLAY_MODE_WORD))
		, host(
			PSX_MACHINE_SPEC,
			input,
			audioOutput,
			presenter,
			environment,
			logCallback,
			systemDirectory) {
		const i32 width = static_cast<i32>(
			gxGpuDisplayModeScreenWidth(GX_GPU_RESET_DISPLAY_MODE_WORD));
		const i32 height = gxGpuVerticalVisibleLines(
			GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
			GX_GPU_RESET_DISPLAY_MODE_WORD);
		videoOutput.setDisplaySize(width, height);
		presenter.default_font = &font;
		presenter.installRenderPipeline(
			std::make_unique<RenderPassLibrary>(&presenter.backend(), &presenter));
		presenter.initializeDefaultTextures();
	}

	retro_system_av_info avInfo{};
	LibretroInput input;
	LibretroAudioOutput audioOutput;
	LibretroVideoOutput videoOutput;
	VideoPresenter presenter;
	Font font;
	LibretroHost host;
};

} // namespace bmsx::test
