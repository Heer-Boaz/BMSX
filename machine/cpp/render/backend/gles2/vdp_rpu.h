#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

#if BMSX_ENABLE_GLES2
void registerVdpRpuPass(RenderPassLibrary& registry);
#endif

} // namespace bmsx
