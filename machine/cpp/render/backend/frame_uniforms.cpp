/*
 * frame_uniforms.cpp - Shared per-frame uniform layout (GL3-ready)
 */

#include "frame_uniforms.h"

namespace bmsx {
namespace RenderUniforms {

FrameUniformsData buildFrameUniforms(const Vec2& offscreen,
										const Vec2& logical,
										f32 time,
										f32 delta,
										const std::array<f32, 16>& view,
										const std::array<f32, 16>& proj,
										const Vec3& cameraPos,
										const std::array<f32, 3>& ambientColor,
										f32 ambientIntensity) {
	FrameUniformsData out{};
	auto& v = out.values;
	v[0] = offscreen.x;
	v[1] = offscreen.y;
	v[2] = logical.x;
	v[3] = logical.y;
	v[4] = time;
	v[5] = delta;
	v[6] = 0.0f;
	v[7] = 0.0f;
	for (size_t i = 0; i < 16; ++i) {
		v[8 + i] = view[i];
	}
	for (size_t i = 0; i < 16; ++i) {
		v[24 + i] = proj[i];
	}
	v[40] = cameraPos.x;
	v[41] = cameraPos.y;
	v[42] = cameraPos.z;
	v[43] = 0.0f;
	v[44] = ambientColor[0];
	v[45] = ambientColor[1];
	v[46] = ambientColor[2];
	v[47] = ambientIntensity;
	return out;
}

} // namespace RenderUniforms
} // namespace bmsx
