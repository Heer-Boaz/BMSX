#pragma once

#include "bmsx_libretro.h"
#include "render/video_output.h"

namespace bmsx {

enum class LibretroAvInfoNotification : u8 {
	None,
	Geometry,
	System,
};

class LibretroVideoOutput final : public VideoOutput {
public:
	LibretroVideoOutput();
	void setEnvironment(retro_environment_t callback) { m_environment = callback; }
	void resetAvInfo();
	void clearFrontendAvInfo() { m_frontendAvInfoValid = false; }
	void getSystemAvInfo(retro_system_av_info& info);
	const retro_system_av_info& avInfo() const { return m_avInfo; }
	void setFrameRate(i64 ufpsScaled);
	// Init/reset/restore can stage parameters outside retro_run. Only the
	// presentation path publishes in-envelope geometry before acquiring its FBO.
	void stageDisplaySize(i32 width, i32 height, i32 viewportWidth, i32 viewportHeight);
	void setDisplaySize(i32 width, i32 height, i32 viewportWidth, i32 viewportHeight) override;
	// Driver-reinitializing System notifications belong to entry's safe frame
	// boundaries, never an active presenter/render-graph execution.
	LibretroAvInfoNotification publishPendingAvInfo();

private:
	LibretroAvInfoNotification pendingAvInfoNotification() const;
	retro_environment_t m_environment = nullptr;
	retro_system_av_info m_avInfo{};
	retro_system_av_info m_frontendAvInfo{};
	bool m_frontendAvInfoValid = false;
};

} // namespace bmsx
