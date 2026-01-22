/*
 * frame_uniforms.h - Shared per-frame uniform layout (GL3-ready)
 *
 * Matches src/bmsx/render/backend/frame_uniforms.ts layout.
 */

#ifndef BMSX_FRAME_UNIFORMS_H
#define BMSX_FRAME_UNIFORMS_H

#include "../../core/types.h"
#include <array>

namespace bmsx {
namespace RenderUniforms {

constexpr int kFrameUniformBinding = 2;
constexpr size_t kFrameUniformFloatCount = 48;

struct FrameUniformsData {
	std::array<f32, kFrameUniformFloatCount> values{};
};

std::array<f32, 16> makeIdentityMat4();

FrameUniformsData buildFrameUniforms(const Vec2& offscreen,
										const Vec2& logical,
										f32 time,
										f32 delta,
										const std::array<f32, 16>& view,
										const std::array<f32, 16>& proj,
										const Vec3& cameraPos,
										const std::array<f32, 3>& ambientColor,
										f32 ambientIntensity);

constexpr const char* kFrameUniformsBlockGLSL = R"(
layout(std140) uniform FrameUniforms {
	vec2 u_offscreenSize;
	vec2 u_logicalSize;
	vec4 u_timeDelta;
	mat4 u_view;
	mat4 u_proj;
	vec4 u_cameraPos;
	vec4 u_ambient_frame;
};
)";

} // namespace RenderUniforms
} // namespace bmsx

#endif
