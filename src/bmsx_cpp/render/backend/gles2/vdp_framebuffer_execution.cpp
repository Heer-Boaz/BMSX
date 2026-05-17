#include "render/backend/gles2/vdp_framebuffer_execution.h"

#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/runtime/runtime.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/pass/framebuffer_execution.h"
#include "render/gameview.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/slot_textures.h"
#include "rompack/format.h"

#if BMSX_ENABLE_GLES2
#include "render/backend/gles2_backend.h"
#include "render/backend/gles2/shaders/vdp_framebuffer_shaders.h"
#endif

#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace bmsx {
namespace {

#if BMSX_ENABLE_GLES2
constexpr float VDP_DRAW_SURFACE_SOLID = 4.0f;
constexpr float SOLID_TEXCOORD_0 = 0.0f;
constexpr float SOLID_TEXCOORD_1 = 1.0f;
constexpr std::array<std::array<f32, 2>, 6> VDP_FRAMEBUFFER_QUAD_CORNERS{{
	{{0.0f, 0.0f}},
	{{0.0f, 1.0f}},
	{{1.0f, 0.0f}},
	{{1.0f, 0.0f}},
	{{0.0f, 1.0f}},
	{{1.0f, 1.0f}},
}};

struct VdpFrameBufferGles2Color {
	f32 r = 1.0f;
	f32 g = 1.0f;
	f32 b = 1.0f;
	f32 a = 1.0f;
};

struct VdpFrameBufferGles2Vertex {
	f32 cornerX = 0.0f;
	f32 cornerY = 0.0f;
	f32 originX = 0.0f;
	f32 originY = 0.0f;
	f32 axisXX = 0.0f;
	f32 axisXY = 0.0f;
	f32 axisYX = 0.0f;
	f32 axisYY = 0.0f;
	f32 u0 = 0.0f;
	f32 v0 = 0.0f;
	f32 u1 = 0.0f;
	f32 v1 = 0.0f;
	f32 z = 0.0f;
	f32 surfaceId = 0.0f;
	f32 fx = 0.0f;
	f32 r = 1.0f;
	f32 g = 1.0f;
	f32 b = 1.0f;
	f32 a = 1.0f;
};

struct VdpFrameBufferGles2Runtime {
	OpenGLES2Backend* backend = nullptr;
	GLuint program = 0;
	GLint attribCorner = -1;
	GLint attribOrigin = -1;
	GLint attribAxisX = -1;
	GLint attribAxisY = -1;
	GLint attribUv0 = -1;
	GLint attribUv1 = -1;
	GLint attribZ = -1;
	GLint attribSurfaceId = -1;
	GLint attribFx = -1;
	GLint attribColor = -1;
	GLint uniformScale = -1;
	GLint uniformLogicalSize = -1;
	GLint uniformTime = -1;
	GLint uniformTexture0 = -1;
	GLint uniformTexture1 = -1;
	GLint uniformTexture2 = -1;
	GLint uniformParallaxRig = -1;
	GLint uniformParallaxRig2 = -1;
	GLint uniformParallaxFlipWindow = -1;
	GLuint vertexBuffer = 0;
	GLuint frameBufferObject = 0;
	GLuint attachedColorTextureId = 0;
	u32 contextGeneration = 0u;
	std::vector<VdpFrameBufferGles2Vertex> vertices;
	std::vector<size_t> commandOrder;
};

VdpFrameBufferGles2Runtime g_gles2FrameBuffer;
#endif

#if BMSX_ENABLE_GLES2
void destroyGles2FrameBufferRuntime() {
	VdpFrameBufferGles2Runtime& state = g_gles2FrameBuffer;
	if (state.vertexBuffer != 0u) {
		glDeleteBuffers(1, &state.vertexBuffer);
		state.vertexBuffer = 0u;
	}
	if (state.frameBufferObject != 0u) {
		glDeleteFramebuffers(1, &state.frameBufferObject);
		state.frameBufferObject = 0u;
	}
	if (state.program != 0u) {
		glDeleteProgram(state.program);
		state.program = 0u;
	}
	state.backend = nullptr;
	state.attachedColorTextureId = 0u;
	state.contextGeneration = 0u;
	state.vertices.clear();
	state.commandOrder.clear();
}

GLint gles2Attrib(GLuint program, const char* name) {
	const GLint location = glGetAttribLocation(program, name);
	if (location < 0) {
		throw BMSX_RUNTIME_ERROR(std::string("[VDPFrameBufferGLES2] missing attribute ") + name + ".");
	}
	return location;
}

GLint gles2Uniform(GLuint program, const char* name) {
	const GLint location = glGetUniformLocation(program, name);
	if (location < 0) {
		throw BMSX_RUNTIME_ERROR(std::string("[VDPFrameBufferGLES2] missing uniform ") + name + ".");
	}
	return location;
}

void bindGles2FrameBufferRuntime(OpenGLES2Backend& backend) {
	VdpFrameBufferGles2Runtime& state = g_gles2FrameBuffer;
	if (state.backend == &backend && state.program != 0u && state.contextGeneration == backend.contextGeneration()) {
		return;
	}
	if (state.program != 0u) {
		destroyGles2FrameBufferRuntime();
	}
	state.backend = &backend;
	state.contextGeneration = backend.contextGeneration();
	state.program = backend.buildProgram(kRenderVdp2DVertexShader, kRenderVdp2DFragmentShader, "vdp_framebuffer_2d");
	state.attribCorner = gles2Attrib(state.program, "a_corner");
	state.attribOrigin = gles2Attrib(state.program, "i_origin");
	state.attribAxisX = gles2Attrib(state.program, "i_axis_x");
	state.attribAxisY = gles2Attrib(state.program, "i_axis_y");
	state.attribUv0 = gles2Attrib(state.program, "i_uv0");
	state.attribUv1 = gles2Attrib(state.program, "i_uv1");
	state.attribZ = gles2Attrib(state.program, "i_z");
	state.attribSurfaceId = gles2Attrib(state.program, "i_surface_id");
	state.attribFx = gles2Attrib(state.program, "i_fx");
	state.attribColor = gles2Attrib(state.program, "i_color");
	state.uniformScale = gles2Uniform(state.program, "u_scale");
	state.uniformLogicalSize = gles2Uniform(state.program, "u_logical_size");
	state.uniformTime = gles2Uniform(state.program, "u_time");
	state.uniformTexture0 = gles2Uniform(state.program, "u_texture0");
	state.uniformTexture1 = gles2Uniform(state.program, "u_texture1");
	state.uniformTexture2 = gles2Uniform(state.program, "u_texture2");
	state.uniformParallaxRig = gles2Uniform(state.program, "u_parallax_rig");
	state.uniformParallaxRig2 = gles2Uniform(state.program, "u_parallax_rig2");
	state.uniformParallaxFlipWindow = gles2Uniform(state.program, "u_parallax_flip_window");
	glGenBuffers(1, &state.vertexBuffer);
	glGenFramebuffers(1, &state.frameBufferObject);
	glUseProgram(state.program);
	glUniform1i(state.uniformTexture0, 0);
	glUniform1i(state.uniformTexture1, 1);
	glUniform1i(state.uniformTexture2, 2);
}

void bindGles2FrameBufferTarget(OpenGLES2Backend& backend, TextureHandle renderTexture, u32 width, u32 height) {
	VdpFrameBufferGles2Runtime& state = g_gles2FrameBuffer;
	backend.setRenderTarget(state.frameBufferObject, static_cast<i32>(width), static_cast<i32>(height));
	GLES2Texture* texture = OpenGLES2Backend::asTexture(renderTexture);
	if (state.attachedColorTextureId != texture->id) {
		glBindFramebuffer(GL_FRAMEBUFFER, state.frameBufferObject);
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture->id, 0);
		const GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
		if (status != GL_FRAMEBUFFER_COMPLETE) {
			throw BMSX_RUNTIME_ERROR("[VDPFrameBufferGLES2] framebuffer incomplete.");
		}
		state.attachedColorTextureId = texture->id;
	}
}


void pushGles2Vertex(
	std::vector<VdpFrameBufferGles2Vertex>& vertices,
	f32 cornerX,
	f32 cornerY,
	f32 originX,
	f32 originY,
	f32 axisXX,
	f32 axisXY,
	f32 axisYX,
	f32 axisYY,
	f32 u0,
	f32 v0,
	f32 u1,
	f32 v1,
	f32 z,
	f32 fx,
	float surfaceId,
	const VdpFrameBufferGles2Color& color
) {
	vertices.push_back(VdpFrameBufferGles2Vertex{
		cornerX,
		cornerY,
		originX,
		originY,
		axisXX,
		axisXY,
		axisYX,
		axisYY,
		u0,
		v0,
		u1,
		v1,
		z,
		surfaceId,
		fx,
		color.r,
		color.g,
		color.b,
		color.a,
	});
}

void appendGles2Quad(
	std::vector<VdpFrameBufferGles2Vertex>& vertices,
	f32 originX,
	f32 originY,
	f32 axisXX,
	f32 axisXY,
	f32 axisYX,
	f32 axisYY,
	f32 u0,
	f32 v0,
	f32 u1,
	f32 v1,
	f32 z,
	f32 fx,
	u32 color,
	float surfaceId
) {
	const VdpFrameBufferColor colorBytes = unpackArgbColor(color);
	const VdpFrameBufferGles2Color vertexColor{
		static_cast<f32>(colorBytes.r) / 255.0f,
		static_cast<f32>(colorBytes.g) / 255.0f,
		static_cast<f32>(colorBytes.b) / 255.0f,
		static_cast<f32>(colorBytes.a) / 255.0f,
	};
	for (const auto& corner : VDP_FRAMEBUFFER_QUAD_CORNERS) {
		pushGles2Vertex(vertices, corner[0], corner[1], originX, originY, axisXX, axisXY, axisYX, axisYY, u0, v0, u1, v1, z, fx, surfaceId, vertexColor);
	}
}


void appendGles2FillRect(const VdpBlitterCommandBuffer& commands, size_t index, std::vector<VdpFrameBufferGles2Vertex>& vertices) {
	i32 left = commands.x0[index];
	i32 top = commands.y0[index];
	i32 right = commands.x1[index];
	i32 bottom = commands.y1[index];
	if (right < left) {
		std::swap(left, right);
	}
	if (bottom < top) {
		std::swap(top, bottom);
	}
	if (left == right || top == bottom) {
		return;
	}
	appendGles2Quad(
		vertices,
		static_cast<f32>(left),
		static_cast<f32>(top),
		static_cast<f32>(right - left),
		0.0f,
		0.0f,
		static_cast<f32>(bottom - top),
		SOLID_TEXCOORD_0,
		SOLID_TEXCOORD_0,
		SOLID_TEXCOORD_1,
		SOLID_TEXCOORD_1,
		commands.priority[index],
		0.0f,
		commands.color[index],
		VDP_DRAW_SURFACE_SOLID
	);
}

void appendGles2Line(const VdpBlitterCommandBuffer& commands, size_t index, std::vector<VdpFrameBufferGles2Vertex>& vertices) {
	const f32 x0 = static_cast<f32>(commands.x0[index]);
	const f32 y0 = static_cast<f32>(commands.y0[index]);
	const f32 dx = static_cast<f32>(commands.x1[index] - commands.x0[index]);
	const f32 dy = static_cast<f32>(commands.y1[index] - commands.y0[index]);
	const f32 thickness = static_cast<f32>(commands.thickness[index]);
	const f32 length = std::hypot(dx, dy);
	if (length == 0.0f) {
		const f32 half = thickness * 0.5f;
		appendGles2Quad(vertices, x0 - half, y0 - half, thickness, 0.0f, 0.0f, thickness, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, commands.priority[index], 0.0f, commands.color[index], VDP_DRAW_SURFACE_SOLID);
		return;
	}
	const f32 tangentX = dx / length;
	const f32 tangentY = dy / length;
	const f32 normalX = -tangentY;
	const f32 normalY = tangentX;
	const f32 half = thickness * 0.5f;
	appendGles2Quad(
		vertices,
		x0 - tangentX * half - normalX * half,
		y0 - tangentY * half - normalY * half,
		dx + tangentX * thickness,
		dy + tangentY * thickness,
		normalX * thickness,
		normalY * thickness,
		SOLID_TEXCOORD_0,
		SOLID_TEXCOORD_0,
		SOLID_TEXCOORD_1,
		SOLID_TEXCOORD_1,
		commands.priority[index],
		0.0f,
		commands.color[index],
		VDP_DRAW_SURFACE_SOLID
	);
}

void appendGles2Blit(GameView& view, const VdpBlitterCommandBuffer& commands, size_t index, std::vector<VdpFrameBufferGles2Vertex>& vertices) {
	const u32 surfaceId = commands.sourceSurfaceId[index];
	const u32 surfaceWidth = view.vdpSlotTextures().readSurfaceTextureWidth(surfaceId);
	const u32 surfaceHeight = view.vdpSlotTextures().readSurfaceTextureHeight(surfaceId);
	f32 u0 = static_cast<f32>(commands.sourceSrcX[index]) / static_cast<f32>(surfaceWidth);
	f32 v0 = static_cast<f32>(commands.sourceSrcY[index]) / static_cast<f32>(surfaceHeight);
	f32 u1 = static_cast<f32>(commands.sourceSrcX[index] + commands.sourceWidth[index]) / static_cast<f32>(surfaceWidth);
	f32 v1 = static_cast<f32>(commands.sourceSrcY[index] + commands.sourceHeight[index]) / static_cast<f32>(surfaceHeight);
	if (commands.flipH[index] != 0u) {
		std::swap(u0, u1);
	}
	if (commands.flipV[index] != 0u) {
		std::swap(v0, v1);
	}
	appendGles2Quad(
		vertices,
		static_cast<f32>(commands.dstX[index]),
		static_cast<f32>(commands.dstY[index]),
		static_cast<f32>(commands.width[index]),
		0.0f,
		0.0f,
		static_cast<f32>(commands.height[index]),
		u0,
		v0,
		u1,
		v1,
		commands.priority[index],
		commands.parallaxWeight[index],
		commands.color[index],
		static_cast<f32>(surfaceId)
	);
}

void appendGles2BatchBlitItem(GameView& view, const VdpBlitterCommandBuffer& commands, size_t commandIndex, size_t itemIndex, std::vector<VdpFrameBufferGles2Vertex>& vertices) {
	const u32 surfaceId = commands.batchBlitSurfaceId[itemIndex];
	const u32 surfaceWidth = view.vdpSlotTextures().readSurfaceTextureWidth(surfaceId);
	const u32 surfaceHeight = view.vdpSlotTextures().readSurfaceTextureHeight(surfaceId);
	const u32 srcX = commands.batchBlitSrcX[itemIndex];
	const u32 srcY = commands.batchBlitSrcY[itemIndex];
	const u32 width = commands.batchBlitWidth[itemIndex];
	const u32 height = commands.batchBlitHeight[itemIndex];
	appendGles2Quad(
		vertices,
		static_cast<f32>(commands.batchBlitDstX[itemIndex]),
		static_cast<f32>(commands.batchBlitDstY[itemIndex]),
		static_cast<f32>(width),
		0.0f,
		0.0f,
		static_cast<f32>(height),
		static_cast<f32>(srcX) / static_cast<f32>(surfaceWidth),
		static_cast<f32>(srcY) / static_cast<f32>(surfaceHeight),
		static_cast<f32>(srcX + width) / static_cast<f32>(surfaceWidth),
		static_cast<f32>(srcY + height) / static_cast<f32>(surfaceHeight),
		commands.priority[commandIndex],
		commands.parallaxWeight[commandIndex],
		commands.color[commandIndex],
		static_cast<f32>(surfaceId)
	);
}

bool gles2CommandComesBefore(const VdpBlitterCommandBuffer& commands, size_t left, size_t right) {
	const Layer2D leftLayer = commands.layer[left];
	const Layer2D rightLayer = commands.layer[right];
	if (leftLayer != rightLayer) {
		return static_cast<u8>(leftLayer) < static_cast<u8>(rightLayer);
	}
	const f32 leftPriority = commands.priority[left];
	const f32 rightPriority = commands.priority[right];
	if (leftPriority != rightPriority) {
		return leftPriority < rightPriority;
	}
	return commands.seq[left] < commands.seq[right];
}

size_t buildGles2CommandOrder(VdpFrameBufferGles2Runtime& state, const VdpBlitterCommandBuffer& commands, size_t start, size_t end) {
	std::vector<size_t>& order = state.commandOrder;
	const size_t count = end - start;
	if (order.size() < count) {
		order.resize(count);
	}
	size_t orderCount = 0u;
	for (size_t commandIndex = start; commandIndex < end; ++commandIndex) {
		size_t insertAt = orderCount;
		while (insertAt > 0u && gles2CommandComesBefore(commands, commandIndex, order[insertAt - 1u])) {
			order[insertAt] = order[insertAt - 1u];
			--insertAt;
		}
		order[insertAt] = commandIndex;
		++orderCount;
	}
	return orderCount;
}

void appendGles2Command(GameView& view, const VdpBlitterCommandBuffer& commands, size_t index, std::vector<VdpFrameBufferGles2Vertex>& vertices) {
	switch (commands.opcode[index]) {
		case VdpBlitterCommandType::FillRect:
			appendGles2FillRect(commands, index, vertices);
			break;
		case VdpBlitterCommandType::DrawLine:
			appendGles2Line(commands, index, vertices);
			break;
		case VdpBlitterCommandType::Blit:
			appendGles2Blit(view, commands, index, vertices);
			break;
		case VdpBlitterCommandType::BatchBlit: {
			const size_t firstItem = commands.batchBlitFirstEntry[index];
			const size_t itemEnd = firstItem + commands.batchBlitItemCount[index];
			if (commands.hasBackgroundColor[index] != 0u) {
				for (size_t itemIndex = firstItem; itemIndex < itemEnd; ++itemIndex) {
					appendGles2Quad(vertices, static_cast<f32>(commands.batchBlitDstX[itemIndex]), static_cast<f32>(commands.batchBlitDstY[itemIndex]), static_cast<f32>(commands.batchBlitAdvance[itemIndex]), 0.0f, 0.0f, static_cast<f32>(commands.lineHeight[index]), SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, commands.priority[index], commands.parallaxWeight[index], commands.backgroundColor[index], VDP_DRAW_SURFACE_SOLID);
				}
			}
			for (size_t itemIndex = firstItem; itemIndex < itemEnd; ++itemIndex) {
				appendGles2BatchBlitItem(view, commands, index, itemIndex, vertices);
			}
			break;
		}
		case VdpBlitterCommandType::Clear:
			break;
	}
}

void appendGles2CommandSegment(GameView& view, VdpFrameBufferGles2Runtime& state, const VdpBlitterCommandBuffer& commands, size_t start, size_t end) {
	const size_t orderCount = buildGles2CommandOrder(state, commands, start, end);
	for (size_t orderIndex = 0u; orderIndex < orderCount; ++orderIndex) {
		appendGles2Command(view, commands, state.commandOrder[orderIndex], state.vertices);
	}
}

void bindGles2VertexLayout(const VdpFrameBufferGles2Runtime& state) {
	glBindBuffer(GL_ARRAY_BUFFER, state.vertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribCorner));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribOrigin));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribAxisX));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribAxisY));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribUv0));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribUv1));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribZ));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribSurfaceId));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribFx));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribColor));
	glVertexAttribPointer(state.attribCorner, 2, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, cornerX)));
	glVertexAttribPointer(state.attribOrigin, 2, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, originX)));
	glVertexAttribPointer(state.attribAxisX, 2, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, axisXX)));
	glVertexAttribPointer(state.attribAxisY, 2, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, axisYX)));
	glVertexAttribPointer(state.attribUv0, 2, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, u0)));
	glVertexAttribPointer(state.attribUv1, 2, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, u1)));
	glVertexAttribPointer(state.attribZ, 1, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, z)));
	glVertexAttribPointer(state.attribSurfaceId, 1, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, surfaceId)));
	glVertexAttribPointer(state.attribFx, 1, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, fx)));
	glVertexAttribPointer(state.attribColor, 4, GL_FLOAT, GL_FALSE, sizeof(VdpFrameBufferGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpFrameBufferGles2Vertex, r)));
}

void bindGles2ExecutionState(Runtime& runtime, OpenGLES2Backend& backend, const VdpBlitterCommandBuffer& commands) {
	VDP& vdp = runtime.machine.vdp;
	GameView& view = runtime.view();
	VdpFrameBufferGles2Runtime& state = g_gles2FrameBuffer;
	const size_t estimatedVertexCount = (commands.length + commands.batchBlitEntryCount) * 6u;
	if (state.vertices.capacity() < estimatedVertexCount) {
		state.vertices.reserve(estimatedVertexCount);
	}
	state.vertices.clear();
	vdp.drainSurfaceUploads(view.vdpSlotTextures());
	bindGles2FrameBufferTarget(backend, view.vdpFrameBufferTextures().renderTexture(), vdp.frameBufferWidth(), vdp.frameBufferHeight());
	glUseProgram(state.program);
	glUniform1f(state.uniformScale, 1.0f);
	glUniform2f(state.uniformLogicalSize, static_cast<f32>(vdp.frameBufferWidth()), static_cast<f32>(vdp.frameBufferHeight()));
	glUniform1f(state.uniformTime, static_cast<f32>(runtime.frameLoop.currentTimeSeconds));
	glUniform4f(state.uniformParallaxRig, 0.0f, 1.0f, 0.0f, 0.0f);
	glUniform4f(state.uniformParallaxRig2, 0.0f, 1.0f, 1.0f, 0.0f);
	glUniform1f(state.uniformParallaxFlipWindow, 1.0f);
	glDisable(GL_CULL_FACE);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_STENCIL_TEST);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glEnable(GL_BLEND);
	glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	backend.setActiveTextureUnit(0);
	backend.bindTexture2D(view.textures.at(VDP_PRIMARY_SLOT_TEXTURE_KEY));
	backend.setActiveTextureUnit(1);
	backend.bindTexture2D(view.textures.at(VDP_SECONDARY_SLOT_TEXTURE_KEY));
	backend.setActiveTextureUnit(2);
	backend.bindTexture2D(view.textures.at(SYSTEM_SLOT_TEXTURE_KEY));
	bindGles2VertexLayout(state);
}

void clearGles2FrameBuffer(u32 color) {
	const VdpFrameBufferColor colorBytes = unpackArgbColor(color);
	glDisable(GL_BLEND);
	glClearColor(
		static_cast<f32>(colorBytes.r) / 255.0f,
		static_cast<f32>(colorBytes.g) / 255.0f,
		static_cast<f32>(colorBytes.b) / 255.0f,
		static_cast<f32>(colorBytes.a) / 255.0f
	);
	glClear(GL_COLOR_BUFFER_BIT);
	glEnable(GL_BLEND);
}

void flushGles2FrameBufferVertices(VdpFrameBufferGles2Runtime& state) {
	if (state.vertices.empty()) {
		return;
	}
	glBufferData(
		GL_ARRAY_BUFFER,
		static_cast<GLsizeiptr>(state.vertices.size() * sizeof(VdpFrameBufferGles2Vertex)),
		state.vertices.data(),
		GL_STREAM_DRAW
	);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(state.vertices.size()));
	state.vertices.clear();
}

void executeGles2FrameBufferCommands(Runtime& runtime, const VdpBlitterCommandBuffer& commands) {
	GameView& view = runtime.view();
	auto& backend = *static_cast<OpenGLES2Backend*>(view.backend());
	bindGles2FrameBufferRuntime(backend);
	bindGles2ExecutionState(runtime, backend, commands);
	VdpFrameBufferGles2Runtime& state = g_gles2FrameBuffer;
	if (commands.length == 0u || commands.opcode[0] != VdpBlitterCommandType::Clear) {
		clearGles2FrameBuffer(VDP_BLITTER_IMPLICIT_CLEAR);
	}
	size_t segmentStart = 0u;
	for (size_t index = 0u; index < commands.length; ++index) {
		if (commands.opcode[index] == VdpBlitterCommandType::Clear) {
			appendGles2CommandSegment(view, state, commands, segmentStart, index);
			flushGles2FrameBufferVertices(state);
			clearGles2FrameBuffer(commands.color[index]);
			segmentStart = index + 1u;
		}
	}
	appendGles2CommandSegment(view, state, commands, segmentStart, commands.length);
	flushGles2FrameBufferVertices(state);
	glDisable(GL_BLEND);
	glDepthMask(GL_TRUE);
}
#endif

} // namespace

#if BMSX_ENABLE_GLES2
void registerVdpFrameBufferExecutionPass_GLES2(RenderPassLibrary& registry) {
	RenderPassDef desc;
	configureVdpFrameBufferExecutionPass(desc);
	desc.exec = [](GPUBackend*, void*, std::any& state) {
		auto& executionState = std::any_cast<VdpFrameBufferExecutionPassState&>(state);
		executeGles2FrameBufferCommands(*executionState.runtime, *executionState.commands);
		executionState.runtime->machine.vdp.completeReadyFrameBufferExecution(nullptr);
	};
	registry.registerPass(desc);
}
#else
void registerVdpFrameBufferExecutionPass_GLES2(RenderPassLibrary&) {
	throw BMSX_RUNTIME_ERROR("[VDPFrameBuffer] OpenGLES2 backend disabled at compile time.");
}
#endif

} // namespace bmsx
