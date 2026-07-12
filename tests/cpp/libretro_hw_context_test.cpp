#include "core/machine_manager.h"
#include "platform.h"
#include "render/backend/gles2/backend.h"

#include <cstdint>
#include <stdexcept>

namespace {

void RETRO_CALLCONV frontendGlProc() {
}

retro_proc_address_t RETRO_CALLCONV frontendGetProcAddress(const char*) {
	return frontendGlProc;
}

uintptr_t RETRO_CALLCONV frontendGetCurrentFramebuffer() {
	return 7u;
}

} // namespace

int main() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(bmsx::BackendType::OpenGLES2, avInfo);
	platform.setHwRenderCallbacks(frontendGetCurrentFramebuffer, frontendGetProcAddress);
	auto* backend = static_cast<bmsx::OpenGLES2Backend*>(platform.machineManager()->view()->backend());
	if (backend->resolveProcAddress("glTextureBarrierNV") != frontendGlProc) {
		throw std::runtime_error("libretro hardware context should own GL procedure resolution");
	}
	return 0;
}
