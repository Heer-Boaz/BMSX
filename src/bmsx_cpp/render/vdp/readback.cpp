#include "render/vdp/readback.h"

#include "core/engine.h"
#include "render/texture_manager.h"

namespace bmsx {

void readVdpTextureRegion(const std::string& textureKey, u8* out, i32 width, i32 height, i32 x, i32 y) {
	auto* texmanager = EngineCore::instance().texmanager();
	texmanager->backend()->readTextureRegion(texmanager->getTextureByUri(textureKey), out, width, height, x, y, {});
}

} // namespace bmsx
