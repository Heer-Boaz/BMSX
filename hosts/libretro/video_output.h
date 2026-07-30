#pragma once

#include "bmsx_libretro.h"
#include "render/video_output.h"

namespace bmsx {

class LibretroVideoOutput final : public VideoOutput {
public:
	explicit LibretroVideoOutput(retro_system_av_info& avInfo);
	void setDisplaySize(i32 width, i32 height) override;

private:
	retro_system_av_info& m_av_info;
};

} // namespace bmsx
