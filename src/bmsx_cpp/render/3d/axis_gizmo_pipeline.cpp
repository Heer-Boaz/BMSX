#include "render/3d/axis_gizmo_pipeline.h"

#if BMSX_ENABLE_GLES2
#include "common/clamp.h"
#include "core/console.h"
#include "render/3d/math.h"
#include "render/3d/shaders/render_3d_shaders.h"
#include "render/backend/gles2_backend.h"
#include "render/gameview.h"
#include "render/shared/bitmap_font.h"
#include "render/shared/hardware/camera.h"

#include <GLES2/gl2.h>
#include <cmath>

namespace bmsx {
namespace {

constexpr i32 AXIS_VERTEX_COUNT = 6;
constexpr f32 AXIS_GIZMO_SIZE = 0.15f;
constexpr f32 AXIS_LABEL_MARGIN_PX = 24.0f;
constexpr f32 AXIS_LABEL_SPACING_PX = 56.0f;
constexpr f32 AXIS_LABEL_PAD_PX = 8.0f;
constexpr f32 AXIS_LABEL_INSET_PX = 6.0f;
constexpr i32 AXIS_VERTEX_STRIDE = 6 * 4;
constexpr color AXIS_LABEL_X_COLOR = 0xffff0000u;
constexpr color AXIS_LABEL_Y_COLOR = 0xff00ff00u;
constexpr color AXIS_LABEL_Z_COLOR = 0xff0000ffu;
constexpr color AXIS_LABEL_R_COLOR = 0xffff7f7fu;
constexpr color AXIS_LABEL_U_COLOR = 0xff7fff7fu;
constexpr color AXIS_LABEL_F_COLOR = 0xff7f7fffu;

struct AxisGizmoGLES2Runtime {
	GLuint program = 0;
	GLint attribPosition = -1;
	GLint attribColor = -1;
	GLint uniformView = -1;
	GLint uniformAspect = -1;
	GLint uniformSize = -1;
	GLint uniformOffset = -1;
	GLuint buffer = 0;
	Render3D::Mat4 axisInvRot{};
};

AxisGizmoGLES2Runtime g_axisGizmo{};
bool g_axisGizmoEnabled = false;

f32 axisLabelScale(f32 depth) {
	return 0.70f + 0.30f * clamp(depth, -1.0f, 1.0f);
}

f32 axisNdcToPixelX(f32 x, f32 width) {
	return (x + 1.0f) * 0.5f * width;
}

f32 axisNdcToPixelY(f32 y, f32 height) {
	return (1.0f - y) * 0.5f * height;
}

void drawAxisLabel(AxisGizmoHostImageSink emitHostImage, void* emitHostImageContext, f32 px, f32 py, u32 letter, color col, f32 scale) {
	emitHostImage(emitHostImageContext, ConsoleCore::instance().view()->default_font->char_to_img(letter), px, py, 999.0f, scale, col);
}

void placeAxisLabel(AxisGizmoHostImageSink emitHostImage, void* emitHostImageContext, f32 originX, f32 originY, f32 vx, f32 vy, u32 letter, color col, f32 scale, f32 aspect, f32 width, f32 height) {
	const f32 tipX = originX + (vx / aspect) * AXIS_GIZMO_SIZE;
	const f32 tipY = originY + vy * AXIS_GIZMO_SIZE;
	const f32 originPixelX = axisNdcToPixelX(originX, width);
	const f32 originPixelY = axisNdcToPixelY(originY, height);
	const f32 tipPixelX = axisNdcToPixelX(tipX, width);
	const f32 tipPixelY = axisNdcToPixelY(tipY, height);
	f32 dx = tipPixelX - originPixelX;
	f32 dy = tipPixelY - originPixelY;
	const f32 length = std::sqrt(dx * dx + dy * dy);
	if (length != 0.0f) {
		dx /= length;
		dy /= length;
	}
	const f32 x = clamp(tipPixelX + dx * AXIS_LABEL_PAD_PX, AXIS_LABEL_INSET_PX, width - AXIS_LABEL_INSET_PX);
	const f32 y = clamp(tipPixelY + dy * AXIS_LABEL_PAD_PX, AXIS_LABEL_INSET_PX, height - AXIS_LABEL_INSET_PX);
	drawAxisLabel(emitHostImage, emitHostImageContext, x, y, letter, col, scale);
}

void bindAxisVertexLayout(const AxisGizmoGLES2Runtime& state) {
	glBindBuffer(GL_ARRAY_BUFFER, state.buffer);
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribPosition));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribColor));
	glVertexAttribPointer(state.attribPosition, 3, GL_FLOAT, GL_FALSE, AXIS_VERTEX_STRIDE, nullptr);
	glVertexAttribPointer(state.attribColor, 3, GL_FLOAT, GL_FALSE, AXIS_VERTEX_STRIDE, reinterpret_cast<const void*>(3 * 4));
}

} // namespace

void setAxisGizmoEnabled(bool v) {
	g_axisGizmoEnabled = v;
}

bool shouldRenderAxisGizmo() {
	return g_axisGizmoEnabled;
}

void bootstrapAxisGizmo_GLES2(OpenGLES2Backend& backend) {
	auto& state = g_axisGizmo;
	state.program = backend.buildProgram(kRender3DAxisGizmoVertexShader, kRender3DAxisGizmoFragmentShader, "axis_gizmo");
	state.attribPosition = glGetAttribLocation(state.program, "a_position");
	state.attribColor = glGetAttribLocation(state.program, "a_color");
	state.uniformView = glGetUniformLocation(state.program, "u_view");
	state.uniformAspect = glGetUniformLocation(state.program, "u_aspect");
	state.uniformSize = glGetUniformLocation(state.program, "u_size");
	state.uniformOffset = glGetUniformLocation(state.program, "u_offset");
	const f32 vertices[AXIS_VERTEX_COUNT * 6] = {
		0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f,
		1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f,
		0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f,
		0.0f, 1.0f, 0.0f, 0.0f, 1.0f, 0.0f,
		0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f,
		0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 1.0f,
	};
	glGenBuffers(1, &state.buffer);
	glBindBuffer(GL_ARRAY_BUFFER, state.buffer);
	glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
}

void renderAxisGizmo_GLES2(OpenGLES2Backend& backend, AxisGizmoHostImageSink emitHostImage, void* emitHostImageContext) {
	if (!shouldRenderAxisGizmo()) {
		return;
	}
	auto& state = g_axisGizmo;
	const GameView& view = *ConsoleCore::instance().view();
	const HardwareCameraState& camera = resolveActiveHardwareCamera();
	const f32 aspect = view.offscreenCanvasSize.x / view.offscreenCanvasSize.y;
	const f32 w = view.viewportSize.x;
	const f32 h = view.viewportSize.y;
	const f32 dxNDC = (AXIS_LABEL_MARGIN_PX / w) * 2.0f;
	const f32 dyNDC = (AXIS_LABEL_MARGIN_PX / h) * 2.0f;
	const f32 offsetX = 1.0f - dxNDC;
	const f32 offsetY = 1.0f - dyNDC;
	const f32 spacingNDC = (AXIS_LABEL_SPACING_PX / w) * 2.0f;
	const f32 offset2X = offsetX - spacingNDC;
	const f32 offset2Y = offsetY;

	backend.setRenderTarget(backend.backbuffer(), static_cast<i32>(view.offscreenCanvasSize.x), static_cast<i32>(view.offscreenCanvasSize.y));
	glUseProgram(state.program);
	bindAxisVertexLayout(state);
	glDisable(GL_CULL_FACE);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glUniformMatrix4fv(state.uniformView, 1, GL_FALSE, camera.view.data());
	glUniform1f(state.uniformAspect, aspect);
	glUniform1f(state.uniformSize, AXIS_GIZMO_SIZE);
	glUniform2f(state.uniformOffset, offsetX, offsetY);
	glDrawArrays(GL_LINES, 0, AXIS_VERTEX_COUNT);

	Render3D::mat4SkyboxFromViewInto(state.axisInvRot, camera.view);
	state.axisInvRot[8] = -state.axisInvRot[8];
	state.axisInvRot[9] = -state.axisInvRot[9];
	state.axisInvRot[10] = -state.axisInvRot[10];
	glUniformMatrix4fv(state.uniformView, 1, GL_FALSE, state.axisInvRot.data());
	glUniform2f(state.uniformOffset, offset2X, offset2Y);
	glDrawArrays(GL_LINES, 0, AXIS_VERTEX_COUNT);

	placeAxisLabel(emitHostImage, emitHostImageContext, offsetX, offsetY, camera.view[0], camera.view[1], static_cast<u32>('X'), AXIS_LABEL_X_COLOR, axisLabelScale(state.axisInvRot[8]), aspect, w, h);
	placeAxisLabel(emitHostImage, emitHostImageContext, offsetX, offsetY, camera.view[4], camera.view[5], static_cast<u32>('Y'), AXIS_LABEL_Y_COLOR, axisLabelScale(state.axisInvRot[9]), aspect, w, h);
	placeAxisLabel(emitHostImage, emitHostImageContext, offsetX, offsetY, camera.view[8], camera.view[9], static_cast<u32>('Z'), AXIS_LABEL_Z_COLOR, axisLabelScale(state.axisInvRot[10]), aspect, w, h);
	placeAxisLabel(emitHostImage, emitHostImageContext, offset2X, offset2Y, state.axisInvRot[0], state.axisInvRot[1], static_cast<u32>('R'), AXIS_LABEL_R_COLOR, axisLabelScale(state.axisInvRot[8]), aspect, w, h);
	placeAxisLabel(emitHostImage, emitHostImageContext, offset2X, offset2Y, state.axisInvRot[4], state.axisInvRot[5], static_cast<u32>('U'), AXIS_LABEL_U_COLOR, axisLabelScale(state.axisInvRot[9]), aspect, w, h);
	placeAxisLabel(emitHostImage, emitHostImageContext, offset2X, offset2Y, state.axisInvRot[8], state.axisInvRot[9], static_cast<u32>('F'), AXIS_LABEL_F_COLOR, axisLabelScale(state.axisInvRot[10]), aspect, w, h);
}

} // namespace bmsx
#endif
