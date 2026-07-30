#include "bmsx_libretro.h"
#include "render/backend/gles2/backend.h"
#include "spec/bmsx/model.h"

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
	bmsx::OpenGLES2Backend backend(
		256,
		240,
		false,
		bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.setContextCallbacks(frontendGetCurrentFramebuffer, frontendGetProcAddress);
	if (backend.resolveProcAddress("glTextureBarrierNV") != frontendGlProc) {
		throw std::runtime_error("libretro hardware context should own GL procedure resolution");
	}
	return 0;
}
