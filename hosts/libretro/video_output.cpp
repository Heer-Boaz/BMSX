#include "video_output.h"

#include "audio_output.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "spec/bmsx/model.h"

namespace bmsx {

LibretroVideoOutput::LibretroVideoOutput()
	: VideoOutput(gxGpuDisplayModeScreenWidth(GX_GPU_RESET_DISPLAY_MODE_WORD),
		gxGpuVerticalVisibleLines(GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, GX_GPU_RESET_DISPLAY_MODE_WORD)) {
	resetAvInfo();
}

void LibretroVideoOutput::resetAvInfo() {
	m_avInfo = {};
	m_avInfo.geometry.max_width = 1920u;
	m_avInfo.geometry.max_height = 1080u;
	const i32 width = gxGpuDisplayModeScreenWidth(GX_GPU_RESET_DISPLAY_MODE_WORD);
	const i32 height = gxGpuVerticalVisibleLines(GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, GX_GPU_RESET_DISPLAY_MODE_WORD);
	stageDisplaySize(width, height, width, height);
	m_avInfo.timing.sample_rate = DEFAULT_LIBRETRO_AUDIO_SAMPLE_RATE;
	setFrameRate(GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED);
}

void LibretroVideoOutput::setFrameRate(i64 ufpsScaled) {
	m_avInfo.timing.fps = static_cast<double>(ufpsScaled) / static_cast<double>(HZ_SCALE);
}

void LibretroVideoOutput::getSystemAvInfo(retro_system_av_info& info) {
	info = m_avInfo;
	m_frontendAvInfo = m_avInfo;
	m_frontendAvInfoValid = true;
}

void LibretroVideoOutput::stageDisplaySize(i32 width, i32 height, i32 viewportWidth, i32 viewportHeight) {
	visibleViewportBounds = RectBounds{0.0f, 0.0f, static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight), 0.0f};
	auto& geometry = m_avInfo.geometry;
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

void LibretroVideoOutput::setDisplaySize(i32 width, i32 height, i32 viewportWidth, i32 viewportHeight) {
	stageDisplaySize(width, height, viewportWidth, viewportHeight);
	if (pendingAvInfoNotification() == LibretroAvInfoNotification::Geometry) publishPendingAvInfo();
}

LibretroAvInfoNotification LibretroVideoOutput::pendingAvInfoNotification() const {
	if (!m_frontendAvInfoValid
			|| m_avInfo.geometry.max_width != m_frontendAvInfo.geometry.max_width
			|| m_avInfo.geometry.max_height != m_frontendAvInfo.geometry.max_height
			|| m_avInfo.timing.fps != m_frontendAvInfo.timing.fps
			|| m_avInfo.timing.sample_rate != m_frontendAvInfo.timing.sample_rate) {
		return LibretroAvInfoNotification::System;
	}
	if (m_avInfo.geometry.base_width != m_frontendAvInfo.geometry.base_width
			|| m_avInfo.geometry.base_height != m_frontendAvInfo.geometry.base_height
			|| m_avInfo.geometry.aspect_ratio != m_frontendAvInfo.geometry.aspect_ratio) {
		return LibretroAvInfoNotification::Geometry;
	}
	return LibretroAvInfoNotification::None;
}

LibretroAvInfoNotification LibretroVideoOutput::publishPendingAvInfo() {
	const LibretroAvInfoNotification notification = pendingAvInfoNotification();
	switch (notification) {
		case LibretroAvInfoNotification::None:
			return notification;
		case LibretroAvInfoNotification::Geometry:
			m_environment(RETRO_ENVIRONMENT_SET_GEOMETRY, &m_avInfo.geometry);
			break;
		case LibretroAvInfoNotification::System:
			m_environment(RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO, &m_avInfo);
			break;
	}
	m_frontendAvInfo = m_avInfo;
	m_frontendAvInfoValid = true;
	return notification;
}

} // namespace bmsx
