#include "video_output.h"

#include "spec/bmsx/model.h"

namespace bmsx {

LibretroVideoOutput::LibretroVideoOutput(retro_system_av_info& avInfo)
	: VideoOutput(static_cast<i32>(avInfo.geometry.base_width), static_cast<i32>(avInfo.geometry.base_height))
	, m_av_info(avInfo) {
}

void LibretroVideoOutput::setDisplaySize(i32 width, i32 height) {
	visibleViewportBounds = RectBounds{0.0f, 0.0f, static_cast<f32>(width), static_cast<f32>(height), 0.0f};
	auto& geometry = m_av_info.geometry;
	geometry.base_width = static_cast<unsigned>(width);
	geometry.base_height = static_cast<unsigned>(height);
	geometry.aspect_ratio = static_cast<float>(GX_GPU_DISPLAY_ASPECT_WIDTH)
		/ static_cast<float>(GX_GPU_DISPLAY_ASPECT_HEIGHT);
	if (geometry.base_width > geometry.max_width) {
		geometry.max_width = geometry.base_width;
	}
	if (geometry.base_height > geometry.max_height) {
		geometry.max_height = geometry.base_height;
	}
}

} // namespace bmsx
