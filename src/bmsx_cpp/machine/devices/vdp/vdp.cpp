// @code-quality start hot-path -- VDP command processing, rasterization, and readback code runs on frame-critical paths.
#include "machine/devices/vdp/vdp.h"
#include "machine/devices/vdp/command_processor.h"
#include "machine/devices/vdp/fault.h"
#include "machine/devices/vdp/packet_schema.h"
#include "machine/memory/map.h"
#include "rompack/assets.h"
#include "core/engine.h"
#include "core/font.h"
#include "core/utf8.h"
#if BMSX_ENABLE_GLES2
#include "render/backend/gles2_backend.h"
#endif
#include "render/shared/queues.h"
#include "render/texture_manager.h"
#include "vendor/stb_image.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/scheduler/budget.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <limits>
#include <sstream>
#include <string>
#include <unordered_set>

namespace bmsx {
namespace {

constexpr uint32_t VDP_RD_SURFACE_ENGINE = 0u;
constexpr uint32_t VDP_RD_SURFACE_PRIMARY = 1u;
constexpr uint32_t VDP_RD_SURFACE_SECONDARY = 2u;
constexpr uint32_t VDP_RD_SURFACE_FRAMEBUFFER = 3u;
constexpr uint32_t VDP_RD_SURFACE_COUNT = 4u;
constexpr uint32_t VDP_RD_BUDGET_BYTES = 4096u;
constexpr uint32_t VDP_RD_MAX_CHUNK_PIXELS = 256u;
constexpr int VDP_SERVICE_BATCH_WORK_UNITS = 128;
constexpr size_t BLITTER_FIFO_CAPACITY = 4096u;
constexpr size_t VRAM_GARBAGE_CHUNK_BYTES = 64u * 1024u;
constexpr uint32_t VRAM_GARBAGE_SPACE_SALT = 0x5652414dU;
constexpr int VRAM_GARBAGE_WEIGHT_BLOCK = 1;
constexpr int VRAM_GARBAGE_WEIGHT_ROW = 2;
constexpr int VRAM_GARBAGE_WEIGHT_PAGE = 4;
constexpr int VRAM_GARBAGE_FORCE_T0 = 120;
constexpr int VRAM_GARBAGE_FORCE_T1 = 280;
constexpr int VRAM_GARBAGE_FORCE_T2 = 480;
constexpr int VRAM_GARBAGE_FORCE_T_DEN = 1000;
constexpr u8 IMPLICIT_FRAME_CLEAR_RGBA[4] = {0u, 0u, 0u, 255u};

template <typename T>
std::vector<T> acquireVectorFromPool(std::vector<std::vector<T>>& pool) {
	if (pool.empty()) {
		return {};
	}
	std::vector<T> values = std::move(pool.back());
	pool.pop_back();
	return values;
}

u8 frameBufferColorByte(f32 value) {
	return static_cast<u8>(std::round(value * 255.0f));
}

struct SkyboxPayloadBaseEntry {
	const char* payload;
	uint32_t base;
};

constexpr std::array<SkyboxPayloadBaseEntry, 3> SKYBOX_PAYLOAD_BASES = {{
	{"system", SYSTEM_ROM_BASE},
	{"overlay", OVERLAY_ROM_BASE},
	{"cart", CART_ROM_BASE},
}};

#if BMSX_ENABLE_GLES2
constexpr float VDP_GLES2_PRIMARY_ATLAS_ID = 0.0f;
constexpr float VDP_GLES2_SECONDARY_ATLAS_ID = 1.0f;
constexpr float VDP_GLES2_ENGINE_ATLAS_ID = 2.0f;

struct VdpGles2Vertex {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 u = 0.0f;
	f32 v = 0.0f;
	f32 atlasId = 0.0f;
	f32 r = 1.0f;
	f32 g = 1.0f;
	f32 b = 1.0f;
	f32 a = 1.0f;
};

struct VdpGles2SurfaceInfo {
	TextureHandle texture = nullptr;
	f32 invWidth = 0.0f;
	f32 invHeight = 0.0f;
	f32 atlasId = 0.0f;
};

struct VdpGles2Host {
	OpenGLES2Backend* backend = nullptr;
	TextureHandle renderTexture = nullptr;
	i32 width = 0;
	i32 height = 0;
	std::array<VdpGles2SurfaceInfo, VDP_RD_SURFACE_COUNT> surfaces{};
	SpriteParallaxRig parallaxRig{};
	f64 timeSeconds = 0.0;
};

struct VdpGles2Runtime {
	OpenGLES2Backend* backend = nullptr;
	GLuint program = 0;
	GLint attribPosition = -1;
	GLint attribUv = -1;
	GLint attribAtlasId = -1;
	GLint attribColor = -1;
	GLint uniformLogicalSize = -1;
	GLint uniformTexture0 = -1;
	GLint uniformTexture1 = -1;
	GLint uniformTexture2 = -1;
	GLuint vertexBuffer = 0;
	GLuint frameBufferObject = 0;
	GLuint attachedColorTextureId = 0;
	TextureHandle whiteTexture = nullptr;
	TextureHandle copySnapshotTexture = nullptr;
	i32 copySnapshotWidth = 0;
	i32 copySnapshotHeight = 0;
	std::vector<VdpGles2Vertex> vertices;
};

VdpGles2Runtime g_vdpGles2Runtime{};

std::string dumpStreamWords(const Memory& memory, uint32_t baseAddr, uint32_t wordCount) {
	std::ostringstream out;
	for (uint32_t index = 0; index < wordCount; ++index) {
		if (index != 0u) {
			out << ' ';
		}
		out << memory.readU32(baseAddr + index * IO_WORD_SIZE);
	}
	return out.str();
}

} // namespace

struct VdpGles2Blitter {
	static void pushVertex(
		std::vector<VdpGles2Vertex>& vertices,
		f32 x,
		f32 y,
		f32 u,
		f32 v,
		f32 atlasId,
		const VDP::FrameBufferColor& color
	);
	static void appendQuadVertices(
		std::vector<VdpGles2Vertex>& vertices,
		f32 x00,
		f32 y00,
		f32 x01,
		f32 y01,
		f32 x10,
		f32 y10,
		f32 x11,
		f32 y11,
		f32 u0,
		f32 v0,
		f32 u1,
		f32 v1,
		f32 atlasId,
		const VDP::FrameBufferColor& color
	);
	static void appendAxisAlignedQuadVertices(
		std::vector<VdpGles2Vertex>& vertices,
		f32 x,
		f32 y,
		f32 width,
		f32 height,
		f32 u0,
		f32 v0,
		f32 u1,
		f32 v1,
		f32 atlasId,
		const VDP::FrameBufferColor& color
	);
	static void appendLineQuadVertices(
		std::vector<VdpGles2Vertex>& vertices,
		const VDP::BlitterCommand& command,
		const VDP::FrameBufferColor& color
	);
	static void computeBlitParallax(
		const VdpGles2Host& host,
		const VDP::BlitterCommand& command,
		f32& outScale,
		f32& outOffsetY
	);
	static void appendBlitVertices(
		const VdpGles2Host& host,
		std::vector<VdpGles2Vertex>& vertices,
		const VDP::BlitterCommand& command,
		const VDP::BlitterSource& source,
		f32 atlasId,
		const VDP::FrameBufferColor& color
	);
	static bool execute(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue);
	static void shutdown();
};

constexpr const char* kVdpGles2VertexShader = R"(
precision mediump float;

attribute vec2 a_position;
attribute vec2 a_uv;
attribute float a_atlas_id;
attribute vec4 a_color;

uniform vec2 u_logical_size;

varying vec2 v_texcoord;
varying vec4 v_color;
varying float v_atlas_id;

void main() {
	vec2 clipSpace = (a_position / u_logical_size) * 2.0 - 1.0;
	gl_Position = vec4(clipSpace, 0.0, 1.0);
	v_texcoord = a_uv;
	v_color = a_color;
	v_atlas_id = a_atlas_id;
}
)";

constexpr const char* kVdpGles2FragmentShader = R"(
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

varying vec2 v_texcoord;
varying vec4 v_color;
varying float v_atlas_id;

void main() {
	vec4 texColor;
	if (v_atlas_id < 0.5) {
		texColor = texture2D(u_texture0, v_texcoord);
	} else if (v_atlas_id < 1.5) {
		texColor = texture2D(u_texture1, v_texcoord);
	} else {
		texColor = texture2D(u_texture2, v_texcoord);
	}
	gl_FragColor = texColor * v_color;
}
)";

GLuint compileVdpGles2Shader(GLenum type, const char* source) {
	const GLuint shader = glCreateShader(type);
	glShaderSource(shader, 1, &source, nullptr);
	glCompileShader(shader);
	GLint ok = 0;
	glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
	if (ok == GL_TRUE) {
		return shader;
	}
	GLint logLength = 0;
	glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &logLength);
	std::string log(static_cast<size_t>(std::max(logLength, 1)), '\0');
	glGetShaderInfoLog(shader, logLength, nullptr, log.data());
	glDeleteShader(shader);
	throw vdpBackendFault("shader compile failed: " + log);
}

GLuint linkVdpGles2Program(GLuint vs, GLuint fs) {
	const GLuint program = glCreateProgram();
	glAttachShader(program, vs);
	glAttachShader(program, fs);
	glLinkProgram(program);
	GLint ok = 0;
	glGetProgramiv(program, GL_LINK_STATUS, &ok);
	glDeleteShader(vs);
	glDeleteShader(fs);
	if (ok == GL_TRUE) {
		return program;
	}
	GLint logLength = 0;
	glGetProgramiv(program, GL_INFO_LOG_LENGTH, &logLength);
	std::string log(static_cast<size_t>(std::max(logLength, 1)), '\0');
	glGetProgramInfoLog(program, logLength, nullptr, log.data());
	glDeleteProgram(program);
	throw vdpBackendFault("program link failed: " + log);
}

f32 smoothstep01(f32 value) {
	const f32 t = std::clamp(value, 0.0f, 1.0f);
	return t * t * (3.0f - 2.0f * t);
}

f32 sign01(f32 value) {
	if (value > 0.0f) {
		return 1.0f;
	}
	if (value < 0.0f) {
		return -1.0f;
	}
	return 0.0f;
}

void destroyVdpGles2Runtime() {
	auto& state = g_vdpGles2Runtime;
	if (state.backend && state.whiteTexture) {
		state.backend->destroyTexture(state.whiteTexture);
		state.whiteTexture = nullptr;
	}
	if (state.backend && state.copySnapshotTexture) {
		state.backend->destroyTexture(state.copySnapshotTexture);
		state.copySnapshotTexture = nullptr;
	}
	state.copySnapshotWidth = 0;
	state.copySnapshotHeight = 0;
	if (state.vertexBuffer != 0) {
		glDeleteBuffers(1, &state.vertexBuffer);
		state.vertexBuffer = 0;
	}
	if (state.frameBufferObject != 0) {
		glDeleteFramebuffers(1, &state.frameBufferObject);
		state.frameBufferObject = 0;
	}
	if (state.program != 0) {
		glDeleteProgram(state.program);
		state.program = 0;
	}
	state.backend = nullptr;
	state.attachedColorTextureId = 0;
	state.vertices.clear();
}

void ensureVdpGles2Runtime(OpenGLES2Backend* backend) {
	auto& state = g_vdpGles2Runtime;
	if (state.backend == backend && state.program != 0) {
		return;
	}
	if (state.program != 0) {
		destroyVdpGles2Runtime();
	}
	state.backend = backend;
	const GLuint vs = compileVdpGles2Shader(GL_VERTEX_SHADER, kVdpGles2VertexShader);
	const GLuint fs = compileVdpGles2Shader(GL_FRAGMENT_SHADER, kVdpGles2FragmentShader);
	state.program = linkVdpGles2Program(vs, fs);
	state.attribPosition = glGetAttribLocation(state.program, "a_position");
	state.attribUv = glGetAttribLocation(state.program, "a_uv");
	state.attribAtlasId = glGetAttribLocation(state.program, "a_atlas_id");
	state.attribColor = glGetAttribLocation(state.program, "a_color");
	state.uniformLogicalSize = glGetUniformLocation(state.program, "u_logical_size");
	state.uniformTexture0 = glGetUniformLocation(state.program, "u_texture0");
	state.uniformTexture1 = glGetUniformLocation(state.program, "u_texture1");
	state.uniformTexture2 = glGetUniformLocation(state.program, "u_texture2");
	if (state.attribPosition < 0 || state.attribUv < 0 || state.attribAtlasId < 0 || state.attribColor < 0
		|| state.uniformLogicalSize < 0 || state.uniformTexture0 < 0 || state.uniformTexture1 < 0 || state.uniformTexture2 < 0) {
		throw vdpBackendFault("missing shader attribute or uniform location.");
	}
	glGenBuffers(1, &state.vertexBuffer);
	glGenFramebuffers(1, &state.frameBufferObject);
	state.whiteTexture = backend->createSolidTexture2D(1, 1, Color{1.0f, 1.0f, 1.0f, 1.0f});
	glUseProgram(state.program);
	glUniform1i(state.uniformTexture0, 0);
	glUniform1i(state.uniformTexture1, 1);
	glUniform1i(state.uniformTexture2, 2);
}

TextureHandle ensureVdpGles2CopySnapshot(OpenGLES2Backend* backend, i32 width, i32 height) {
	auto& state = g_vdpGles2Runtime;
	if (state.copySnapshotTexture && state.copySnapshotWidth == width && state.copySnapshotHeight == height) {
		return state.copySnapshotTexture;
	}
	TextureParams params;
	if (!state.copySnapshotTexture) {
		state.copySnapshotTexture = backend->createTexture(nullptr, width, height, params);
	} else {
		state.copySnapshotTexture = backend->resizeTexture(state.copySnapshotTexture, width, height, params);
	}
	state.copySnapshotWidth = width;
	state.copySnapshotHeight = height;
	return state.copySnapshotTexture;
}

void bindVdpGles2Target(const VdpGles2Host& host) {
	auto& state = g_vdpGles2Runtime;
	host.backend->setRenderTarget(state.frameBufferObject, host.width, host.height);
	auto* renderTexture = OpenGLES2Backend::asTexture(host.renderTexture);
	if (state.attachedColorTextureId != renderTexture->id) {
		glBindFramebuffer(GL_FRAMEBUFFER, state.frameBufferObject);
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, renderTexture->id, 0);
		const GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
		if (status != GL_FRAMEBUFFER_COMPLETE) {
			throw vdpBackendFault("framebuffer incomplete.");
		}
		state.attachedColorTextureId = renderTexture->id;
	}
}

void VdpGles2Blitter::pushVertex(
	std::vector<VdpGles2Vertex>& vertices,
	f32 x,
	f32 y,
	f32 u,
	f32 v,
	f32 atlasId,
	const VDP::FrameBufferColor& color
) {
	vertices.push_back(VdpGles2Vertex{
		x,
		y,
		u,
		v,
		atlasId,
		static_cast<f32>(color.r) / 255.0f,
		static_cast<f32>(color.g) / 255.0f,
		static_cast<f32>(color.b) / 255.0f,
		static_cast<f32>(color.a) / 255.0f,
	});
}

void VdpGles2Blitter::appendQuadVertices(
	std::vector<VdpGles2Vertex>& vertices,
	f32 x00,
	f32 y00,
	f32 x01,
	f32 y01,
	f32 x10,
	f32 y10,
	f32 x11,
	f32 y11,
	f32 u0,
	f32 v0,
	f32 u1,
	f32 v1,
	f32 atlasId,
	const VDP::FrameBufferColor& color
) {
	pushVertex(vertices, x00, y00, u0, v0, atlasId, color);
	pushVertex(vertices, x01, y01, u0, v1, atlasId, color);
	pushVertex(vertices, x10, y10, u1, v0, atlasId, color);
	pushVertex(vertices, x10, y10, u1, v0, atlasId, color);
	pushVertex(vertices, x01, y01, u0, v1, atlasId, color);
	pushVertex(vertices, x11, y11, u1, v1, atlasId, color);
}

void VdpGles2Blitter::appendAxisAlignedQuadVertices(
	std::vector<VdpGles2Vertex>& vertices,
	f32 x,
	f32 y,
	f32 width,
	f32 height,
	f32 u0,
	f32 v0,
	f32 u1,
	f32 v1,
	f32 atlasId,
	const VDP::FrameBufferColor& color
) {
	appendQuadVertices(vertices, x, y, x, y + height, x + width, y, x + width, y + height, u0, v0, u1, v1, atlasId, color);
}

void VdpGles2Blitter::appendLineQuadVertices(
	std::vector<VdpGles2Vertex>& vertices,
	const VDP::BlitterCommand& command,
	const VDP::FrameBufferColor& color
) {
	const f32 thickness = std::max(1.0f, std::round(command.thickness));
	const f32 dx = command.x1 - command.x0;
	const f32 dy = command.y1 - command.y0;
	const f32 length = std::hypot(dx, dy);
	if (length == 0.0f) {
		const f32 half = thickness * 0.5f;
		appendAxisAlignedQuadVertices(vertices, command.x0 - half, command.y0 - half, thickness, thickness, 0.0f, 0.0f, 1.0f, 1.0f, VDP_GLES2_PRIMARY_ATLAS_ID, color);
		return;
	}
	const f32 tangentX = dx / length;
	const f32 tangentY = dy / length;
	const f32 normalX = -tangentY;
	const f32 normalY = tangentX;
	const f32 half = thickness * 0.5f;
	const f32 originX = command.x0 - tangentX * half - normalX * half;
	const f32 originY = command.y0 - tangentY * half - normalY * half;
	appendQuadVertices(
		vertices,
		originX,
		originY,
		originX + normalX * thickness,
		originY + normalY * thickness,
		originX + dx + tangentX * thickness,
		originY + dy + tangentY * thickness,
		originX + dx + tangentX * thickness + normalX * thickness,
		originY + dy + tangentY * thickness + normalY * thickness,
		0.0f,
		0.0f,
		1.0f,
		1.0f,
		VDP_GLES2_PRIMARY_ATLAS_ID,
		color
	);
}

void VdpGles2Blitter::computeBlitParallax(
	const VdpGles2Host& host,
	const VDP::BlitterCommand& command,
	f32& outScale,
	f32& outOffsetY
) {
	const f32 dir = sign01(command.parallaxWeight);
	if (dir == 0.0f) {
		outScale = 1.0f;
		outOffsetY = 0.0f;
		return;
	}
	const f32 depth = smoothstep01(command.z);
	const f32 weight = std::abs(command.parallaxWeight) * depth;
	const f32 wobble = std::sin(static_cast<f32>(host.timeSeconds) * 2.2f) * 0.5f
		+ std::sin(static_cast<f32>(host.timeSeconds) * 1.1f + 1.7f) * 0.5f;
	outOffsetY = (host.parallaxRig.bias_px + wobble * host.parallaxRig.vy) * weight * host.parallaxRig.parallax_strength * dir;
	const f32 flipWindowSeconds = std::max(host.parallaxRig.flip_window, 0.0001f);
	const f32 hold = 0.2f * flipWindowSeconds;
	const f32 flipU = std::clamp((host.parallaxRig.impact_t - hold) / std::max(flipWindowSeconds - hold, 0.0001f), 0.0f, 1.0f);
	const f32 flipWindow = 1.0f - smoothstep01(flipU);
	const f32 flip = 1.0f + ((-1.0f - 1.0f) * (flipWindow * host.parallaxRig.flip_strength));
	outOffsetY *= flip;
	const f32 baseScale = 1.0f + (host.parallaxRig.scale - 1.0f) * weight * host.parallaxRig.scale_strength;
	const f32 impactSign = sign01(host.parallaxRig.impact);
	const f32 impactMask = std::max(0.0f, dir * impactSign);
	const f32 pulse = std::exp(-8.0f * host.parallaxRig.impact_t) * std::abs(host.parallaxRig.impact) * weight * impactMask;
	outScale = baseScale + pulse;
}

void VdpGles2Blitter::appendBlitVertices(
	const VdpGles2Host& host,
	std::vector<VdpGles2Vertex>& vertices,
	const VDP::BlitterCommand& command,
	const VDP::BlitterSource& source,
	f32 atlasId,
	const VDP::FrameBufferColor& color
) {
	const auto& surface = host.surfaces[source.surfaceId];
	const f32 dstWidth = std::max(1.0f, std::round(static_cast<f32>(source.width) * command.scaleX));
	const f32 dstHeight = std::max(1.0f, std::round(static_cast<f32>(source.height) * command.scaleY));
	f32 u0 = static_cast<f32>(source.srcX) * surface.invWidth;
	f32 v0 = static_cast<f32>(source.srcY) * surface.invHeight;
	f32 u1 = static_cast<f32>(source.srcX + source.width) * surface.invWidth;
	f32 v1 = static_cast<f32>(source.srcY + source.height) * surface.invHeight;
	if (command.flipH) {
		std::swap(u0, u1);
	}
	if (command.flipV) {
		std::swap(v0, v1);
	}
	const f32 x0 = std::round(command.dstX);
	const f32 y0 = std::round(command.dstY);
	const f32 centerX = x0 + dstWidth * 0.5f;
	const f32 centerY = y0 + dstHeight * 0.5f;
	f32 scale = 1.0f;
	f32 offsetY = 0.0f;
	computeBlitParallax(host, command, scale, offsetY);
	auto transformPoint = [&](f32 x, f32 y, f32& outX, f32& outY) {
		outX = (x - centerX) * scale + centerX;
		outY = (y - centerY) * scale + centerY + offsetY;
	};
	f32 px00 = 0.0f;
	f32 py00 = 0.0f;
	f32 px01 = 0.0f;
	f32 py01 = 0.0f;
	f32 px10 = 0.0f;
	f32 py10 = 0.0f;
	f32 px11 = 0.0f;
	f32 py11 = 0.0f;
	transformPoint(x0, y0, px00, py00);
	transformPoint(x0, y0 + dstHeight, px01, py01);
	transformPoint(x0 + dstWidth, y0, px10, py10);
	transformPoint(x0 + dstWidth, y0 + dstHeight, px11, py11);
	appendQuadVertices(vertices, px00, py00, px01, py01, px10, py10, px11, py11, u0, v0, u1, v1, atlasId, color);
}

void bindVdpVertexLayout(const VdpGles2Runtime& state) {
	glBindBuffer(GL_ARRAY_BUFFER, state.vertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribPosition));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribUv));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribAtlasId));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribColor));
	glVertexAttribPointer(state.attribPosition, 2, GL_FLOAT, GL_FALSE, sizeof(VdpGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpGles2Vertex, x)));
	glVertexAttribPointer(state.attribUv, 2, GL_FLOAT, GL_FALSE, sizeof(VdpGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpGles2Vertex, u)));
	glVertexAttribPointer(state.attribAtlasId, 1, GL_FLOAT, GL_FALSE, sizeof(VdpGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpGles2Vertex, atlasId)));
	glVertexAttribPointer(state.attribColor, 4, GL_FLOAT, GL_FALSE, sizeof(VdpGles2Vertex), reinterpret_cast<const void*>(offsetof(VdpGles2Vertex, r)));
}

enum class VdpDrawMode { None, Solid, Atlas };

void bindVdpSolidMode(const VdpGles2Host& host, VdpDrawMode& boundMode) {
	if (boundMode == VdpDrawMode::Solid) return;
	host.backend->setActiveTextureUnit(0);
	host.backend->bindTexture2D(g_vdpGles2Runtime.whiteTexture);
	boundMode = VdpDrawMode::Solid;
}

void bindVdpAtlasMode(const VdpGles2Host& host, VdpDrawMode& boundMode) {
	if (boundMode == VdpDrawMode::Atlas) return;
	host.backend->setActiveTextureUnit(0);
	host.backend->bindTexture2D(host.surfaces[VDP_RD_SURFACE_PRIMARY].texture);
	host.backend->setActiveTextureUnit(1);
	host.backend->bindTexture2D(host.surfaces[VDP_RD_SURFACE_SECONDARY].texture);
	host.backend->setActiveTextureUnit(2);
	host.backend->bindTexture2D(host.surfaces[VDP_RD_SURFACE_ENGINE].texture);
	boundMode = VdpDrawMode::Atlas;
}

void setupVdpDrawState(const VdpGles2Host& host) {
	auto& state = g_vdpGles2Runtime;
	bindVdpGles2Target(host);
	glUseProgram(state.program);
	glUniform2f(state.uniformLogicalSize, static_cast<f32>(host.width), static_cast<f32>(host.height));
	glDisable(GL_CULL_FACE);
	glDisable(GL_DEPTH_TEST);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_STENCIL_TEST);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glEnable(GL_BLEND);
	glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	bindVdpVertexLayout(state);
}

bool VdpGles2Blitter::execute(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue) {
	auto* view = EngineCore::instance().view();
	if (view->backendType() != BackendType::OpenGLES2) {
		return false;
	}
	auto* backend = static_cast<OpenGLES2Backend*>(view->backend());
	ensureVdpGles2Runtime(backend);
	auto* texmanager = EngineCore::instance().texmanager();
	VdpGles2Host host;
	host.backend = backend;
	host.renderTexture = view->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY];
	host.width = static_cast<i32>(vdp.m_frameBufferWidth);
	host.height = static_cast<i32>(vdp.m_frameBufferHeight);
	host.parallaxRig = RenderQueues::spriteParallaxRig;
	host.timeSeconds = EngineCore::instance().totalTime();
	auto prepareSurface = [&](uint32_t surfaceId, f32 atlasId) {
		auto& info = host.surfaces[surfaceId];
		info.atlasId = atlasId;
		const auto& surface = vdp.getReadSurface(surfaceId);
		if (surface.textureKey.empty()) {
			return;
		}
		info.texture = texmanager->getTextureByUri(surface.textureKey);
		const auto& entry = vdp.m_memory.getAssetEntry(surface.assetId);
		info.invWidth = 1.0f / static_cast<f32>(entry.regionW);
		info.invHeight = 1.0f / static_cast<f32>(entry.regionH);
	};
	prepareSurface(VDP_RD_SURFACE_ENGINE, VDP_GLES2_ENGINE_ATLAS_ID);
	prepareSurface(VDP_RD_SURFACE_PRIMARY, VDP_GLES2_PRIMARY_ATLAS_ID);
	prepareSurface(VDP_RD_SURFACE_SECONDARY, VDP_GLES2_SECONDARY_ATLAS_ID);
	prepareSurface(VDP_RD_SURFACE_FRAMEBUFFER, VDP_GLES2_PRIMARY_ATLAS_ID);
	if (!host.renderTexture) {
		throw vdpBackendFault("missing framebuffer render texture.");
	}
	if (!host.surfaces[VDP_RD_SURFACE_ENGINE].texture) {
		throw vdpBackendFault("missing engine atlas texture.");
	}
	if (!host.surfaces[VDP_RD_SURFACE_PRIMARY].texture) {
		throw vdpBackendFault("missing primary atlas texture.");
	}
	if (!host.surfaces[VDP_RD_SURFACE_SECONDARY].texture) {
		throw vdpBackendFault("missing secondary atlas texture.");
	}
	auto clearFrame = [&](const VDP::FrameBufferColor& color) {
		bindVdpGles2Target(host);
		glDisable(GL_BLEND);
		glClearColor(
			static_cast<f32>(color.r) / 255.0f,
			static_cast<f32>(color.g) / 255.0f,
			static_cast<f32>(color.b) / 255.0f,
			static_cast<f32>(color.a) / 255.0f
		);
		glClear(GL_COLOR_BUFFER_BIT);
	};
	auto& state = g_vdpGles2Runtime;
	auto drawSortedSegment = [&](size_t start, size_t end) {
		if (start >= end) {
			return;
		}
		auto& sortedCommands = vdp.m_sortedBlitterCommandScratch;
		sortedCommands.clear();
		for (size_t index = start; index < end; ++index) {
			const auto& command = queue[index];
			if (command.type == VDP::BlitterCommandType::Clear || command.type == VDP::BlitterCommandType::CopyRect) {
				continue;
			}
			sortedCommands.push_back(&command);
		}
		if (sortedCommands.empty()) {
			return;
		}
		std::sort(
			sortedCommands.begin(),
			sortedCommands.end(),
			[](const VDP::BlitterCommand* a, const VDP::BlitterCommand* b) {
				if (a->layer != b->layer) {
					return a->layer < b->layer;
				}
				if (a->z != b->z) {
					return a->z < b->z;
				}
				return a->seq < b->seq;
			}
		);
		setupVdpDrawState(host);
		state.vertices.clear();
		state.vertices.reserve(sortedCommands.size() * 6u);
		VdpDrawMode boundMode = VdpDrawMode::None;
		auto flushVertices = [&]() {
			if (state.vertices.empty()) {
				return;
			}
			glBufferData(
				GL_ARRAY_BUFFER,
				static_cast<GLsizeiptr>(state.vertices.size() * sizeof(VdpGles2Vertex)),
				state.vertices.data(),
				GL_STREAM_DRAW
			);
			glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(state.vertices.size()));
			state.vertices.clear();
		};
		auto bindMode = [&](VdpDrawMode mode) {
			if (boundMode == mode) {
				return;
			}
			flushVertices();
			if (mode == VdpDrawMode::Solid) {
				bindVdpSolidMode(host, boundMode);
				return;
			}
			bindVdpAtlasMode(host, boundMode);
		};
		const VDP::FrameBufferColor white{255u, 255u, 255u, 255u};
		for (const VDP::BlitterCommand* command : sortedCommands) {
			switch (command->type) {
				case VDP::BlitterCommandType::Blit: {
					bindMode(VdpDrawMode::Atlas);
					appendBlitVertices(
						host,
						state.vertices,
						*command,
						command->source,
						host.surfaces[command->source.surfaceId].atlasId,
						command->color
					);
					break;
				}
				case VDP::BlitterCommandType::FillRect: {
					bindMode(VdpDrawMode::Solid);
					f32 left = std::round(command->x0);
					f32 top = std::round(command->y0);
					f32 right = std::round(command->x1);
					f32 bottom = std::round(command->y1);
					if (right < left) {
						std::swap(left, right);
					}
					if (bottom < top) {
						std::swap(top, bottom);
					}
					if (left != right && top != bottom) {
						appendAxisAlignedQuadVertices(
							state.vertices,
							left,
							top,
							right - left,
							bottom - top,
							0.0f,
							0.0f,
							1.0f,
							1.0f,
							VDP_GLES2_PRIMARY_ATLAS_ID,
							command->color
						);
					}
					break;
				}
				case VDP::BlitterCommandType::DrawLine: {
					bindMode(VdpDrawMode::Solid);
					appendLineQuadVertices(state.vertices, *command, command->color);
					break;
				}
				case VDP::BlitterCommandType::GlyphRun: {
					if (command->backgroundColor.has_value()) {
						bindMode(VdpDrawMode::Solid);
						for (const auto& glyph : command->glyphs) {
							appendAxisAlignedQuadVertices(
								state.vertices,
								glyph.dstX,
								glyph.dstY,
								static_cast<f32>(glyph.advance),
								static_cast<f32>(command->lineHeight),
								0.0f,
								0.0f,
								1.0f,
								1.0f,
								VDP_GLES2_PRIMARY_ATLAS_ID,
								*command->backgroundColor
							);
						}
					}
					bindMode(VdpDrawMode::Atlas);
					for (const auto& glyph : command->glyphs) {
						const auto& surface = host.surfaces[glyph.surfaceId];
						const f32 u0 = static_cast<f32>(glyph.srcX) * surface.invWidth;
						const f32 v0 = static_cast<f32>(glyph.srcY) * surface.invHeight;
						const f32 u1 = static_cast<f32>(glyph.srcX + glyph.width) * surface.invWidth;
						const f32 v1 = static_cast<f32>(glyph.srcY + glyph.height) * surface.invHeight;
						appendAxisAlignedQuadVertices(
							state.vertices,
							std::round(glyph.dstX),
							std::round(glyph.dstY),
							static_cast<f32>(glyph.width),
							static_cast<f32>(glyph.height),
							u0,
							v0,
							u1,
							v1,
							surface.atlasId,
							command->color
						);
					}
					break;
				}
				case VDP::BlitterCommandType::TileRun: {
					bindMode(VdpDrawMode::Atlas);
					for (const auto& tile : command->tiles) {
						const auto& surface = host.surfaces[tile.surfaceId];
						const f32 u0 = static_cast<f32>(tile.srcX) * surface.invWidth;
						const f32 v0 = static_cast<f32>(tile.srcY) * surface.invHeight;
						const f32 u1 = static_cast<f32>(tile.srcX + tile.width) * surface.invWidth;
						const f32 v1 = static_cast<f32>(tile.srcY + tile.height) * surface.invHeight;
						appendAxisAlignedQuadVertices(
							state.vertices,
							std::round(tile.dstX),
							std::round(tile.dstY),
							static_cast<f32>(tile.width),
							static_cast<f32>(tile.height),
							u0,
							v0,
							u1,
							v1,
							surface.atlasId,
							white
						);
					}
					break;
				}
				case VDP::BlitterCommandType::Clear:
				case VDP::BlitterCommandType::CopyRect:
					break;
			}
		}
		flushVertices();
	};
	auto drawCopyRect = [&](const VDP::BlitterCommand& command) {
		const VDP::FrameBufferColor white{255u, 255u, 255u, 255u};
		TextureHandle snapshot = ensureVdpGles2CopySnapshot(backend, host.width, host.height);
		backend->copyTextureRegion(host.renderTexture, snapshot, command.srcX, command.srcY, command.srcX, command.srcY, command.width, command.height);
		state.vertices.clear();
		state.vertices.reserve(6u);
		appendAxisAlignedQuadVertices(
			state.vertices,
			std::round(command.dstX),
			std::round(command.dstY),
			static_cast<f32>(command.width),
			static_cast<f32>(command.height),
			static_cast<f32>(command.srcX) / static_cast<f32>(host.width),
			static_cast<f32>(command.srcY) / static_cast<f32>(host.height),
			static_cast<f32>(command.srcX + command.width) / static_cast<f32>(host.width),
			static_cast<f32>(command.srcY + command.height) / static_cast<f32>(host.height),
			VDP_GLES2_PRIMARY_ATLAS_ID,
			white
		);
		setupVdpDrawState(host);
		host.backend->setActiveTextureUnit(0);
		host.backend->bindTexture2D(snapshot);
		glDisable(GL_BLEND);
		glBufferData(
			GL_ARRAY_BUFFER,
			static_cast<GLsizeiptr>(state.vertices.size() * sizeof(VdpGles2Vertex)),
			state.vertices.data(),
			GL_STREAM_DRAW
		);
		glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(state.vertices.size()));
	};
	if (queue.front().type != VDP::BlitterCommandType::Clear) {
		clearFrame(VDP::FrameBufferColor{
			IMPLICIT_FRAME_CLEAR_RGBA[0],
			IMPLICIT_FRAME_CLEAR_RGBA[1],
			IMPLICIT_FRAME_CLEAR_RGBA[2],
			IMPLICIT_FRAME_CLEAR_RGBA[3],
		});
	}
	size_t segmentStart = 0u;
	for (size_t index = 0; index < queue.size(); ++index) {
		const auto& command = queue[index];
		if (command.type == VDP::BlitterCommandType::Clear) {
			drawSortedSegment(segmentStart, index);
			clearFrame(command.color);
			segmentStart = index + 1u;
			continue;
		}
		if (command.type == VDP::BlitterCommandType::CopyRect) {
			drawSortedSegment(segmentStart, index);
			drawCopyRect(command);
			segmentStart = index + 1u;
		}
	}
	drawSortedSegment(segmentStart, queue.size());
	vdp.invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
	return true;
}

void VdpGles2Blitter::shutdown() {
	destroyVdpGles2Runtime();
}
#endif

namespace {

EngineCore::RomView resolvePayloadRomView(const RomAssetInfo& romInfo) {
	if (!romInfo.payloadId.has_value()) {
		throw vdpFault("image asset missing payload id.");
	}
	const std::string& payloadId = *romInfo.payloadId;
	if (payloadId == "system") {
		return EngineCore::instance().engineRomView();
	}
	if (payloadId == "cart") {
		return EngineCore::instance().cartRomView();
	}
	throw vdpFault("unsupported image payload id '" + payloadId + "'.");
}

void ensureDecodedPixels(ImgAsset& asset) {
	if (!asset.pixels.empty()) {
		return;
	}
	if (!asset.rom.start.has_value() || !asset.rom.end.has_value()) {
		throw vdpFault("image asset '" + asset.id + "' missing ROM byte range.");
	}
	const EngineCore::RomView romView = resolvePayloadRomView(asset.rom);
	const size_t start = static_cast<size_t>(*asset.rom.start);
	const size_t end = static_cast<size_t>(*asset.rom.end);
	if (end <= start || end > romView.size) {
		throw vdpFault("image asset '" + asset.id + "' ROM byte range is invalid.");
	}
	int width = 0;
	int height = 0;
	int comp = 0;
	unsigned char* decoded = stbi_load_from_memory(
		romView.data + start,
		static_cast<int>(end - start),
		&width,
		&height,
		&comp,
		4
	);
	if (!decoded) {
		throw vdpFault("image asset '" + asset.id + "' decode failed.");
	}
	if (width != asset.meta.width || height != asset.meta.height) {
		stbi_image_free(decoded);
		throw vdpFault(
			"image asset '" + asset.id + "' decoded dimensions "
			+ std::to_string(width)
			+ "x"
			+ std::to_string(height)
			+ " do not match metadata "
			+ std::to_string(asset.meta.width)
			+ "x"
			+ std::to_string(asset.meta.height)
			+ "."
		);
	}
	const size_t pixelBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
	asset.pixels.resize(pixelBytes);
	std::memcpy(asset.pixels.data(), decoded, pixelBytes);
	stbi_image_free(decoded);
}

struct OctaveSpec {
	uint32_t shift;
	int weight;
	uint32_t mul;
	uint32_t mix;
};

constexpr OctaveSpec VRAM_GARBAGE_OCTAVES[] = {
	{11u, 8, 0x165667b1U, 0xd3a2646cU},
	{15u, 12, 0x27d4eb2fU, 0x6c8e9cf5U},
	{17u, 16, 0x7f4a7c15U, 0x31415926U},
	{19u, 20, 0xa24baed5U, 0x9e3779b9U},
	{21u, 24, 0x6a09e667U, 0xbb67ae85U},
};

uint32_t skyboxFaceBaseByIndex(size_t index) {
	switch (index) {
		case 0: return VRAM_SKYBOX_POSX_BASE;
		case 1: return VRAM_SKYBOX_NEGX_BASE;
		case 2: return VRAM_SKYBOX_POSY_BASE;
		case 3: return VRAM_SKYBOX_NEGY_BASE;
		case 4: return VRAM_SKYBOX_POSZ_BASE;
		case 5: return VRAM_SKYBOX_NEGZ_BASE;
		default: break;
	}
	throw vdpFault("skybox face index out of range.");
}

bool isAtlasName(const std::string& name) {
	static constexpr const char* kPrefix = "_atlas_";
	return name.rfind(kPrefix, 0) == 0;
}

uint32_t fmix32(uint32_t h) {
	h ^= h >> 16u;
	h *= 0x85ebca6bU;
	h ^= h >> 13u;
	h *= 0xc2b2ae35U;
	h ^= h >> 16u;
	return h;
}

uint32_t xorshift32(uint32_t x) {
	x ^= x << 13u;
	x ^= x >> 17u;
	x ^= x << 5u;
	return x;
}

uint32_t scramble32(uint32_t x) {
	return x * 0x9e3779bbU;
}

int signed8FromHash(uint32_t h) {
	return static_cast<int>((h >> 24u) & 0xFFu) - 128;
}

struct BlockGen {
	uint32_t forceMask = 0;
	uint32_t prefWord = 0;
	uint32_t weakMask = 0;
	uint32_t baseState = 0;
	uint32_t bootState = 0;
	uint32_t genWordPos = 0;
};

struct BiasConfig {
	uint32_t activeOctaves = 0;
	int threshold0 = 0;
	int threshold1 = 0;
	int threshold2 = 0;
};

BiasConfig makeBiasConfig(uint32_t vramBytes) {
	const uint32_t maxOctaveBytes = vramBytes >> 1u;
	int weightSum = VRAM_GARBAGE_WEIGHT_BLOCK + VRAM_GARBAGE_WEIGHT_ROW + VRAM_GARBAGE_WEIGHT_PAGE;
	uint32_t activeOctaves = 0;
	for (uint32_t i = 0; i < (sizeof(VRAM_GARBAGE_OCTAVES) / sizeof(VRAM_GARBAGE_OCTAVES[0])); ++i) {
		const uint32_t octaveBytes = 1u << (VRAM_GARBAGE_OCTAVES[i].shift + 5u);
		if (octaveBytes > maxOctaveBytes) {
			break;
		}
		weightSum += VRAM_GARBAGE_OCTAVES[i].weight;
		activeOctaves = i + 1u;
	}
	const int maxBias = weightSum * 127;
	BiasConfig config;
	config.activeOctaves = activeOctaves;
	config.threshold0 = (maxBias * VRAM_GARBAGE_FORCE_T0) / VRAM_GARBAGE_FORCE_T_DEN;
	config.threshold1 = (maxBias * VRAM_GARBAGE_FORCE_T1) / VRAM_GARBAGE_FORCE_T_DEN;
	config.threshold2 = (maxBias * VRAM_GARBAGE_FORCE_T2) / VRAM_GARBAGE_FORCE_T_DEN;
	return config;
}

BlockGen initBlockGen(uint32_t biasSeed, uint32_t bootSeedMix, uint32_t blockIndex, const BiasConfig& biasConfig) {
	const uint32_t pageIndex = blockIndex >> 7u;
	const uint32_t rowIndex = blockIndex >> 3u;

	const uint32_t pageH = fmix32((biasSeed ^ (pageIndex * 0xc2b2ae35U) ^ 0xa5a5a5a5U));
	const uint32_t rowH = fmix32((biasSeed ^ (rowIndex * 0x85ebca6bU) ^ 0x1b873593U));
	const uint32_t blkH = fmix32((biasSeed ^ (blockIndex * 0x9e3779b9U) ^ 0x85ebca77U));

	int bias =
		signed8FromHash(pageH) * VRAM_GARBAGE_WEIGHT_PAGE +
		signed8FromHash(rowH) * VRAM_GARBAGE_WEIGHT_ROW +
		signed8FromHash(blkH) * VRAM_GARBAGE_WEIGHT_BLOCK;

	uint32_t macroH = pageH;
	for (uint32_t i = 0; i < biasConfig.activeOctaves; ++i) {
		const OctaveSpec& octave = VRAM_GARBAGE_OCTAVES[i];
		const uint32_t octaveIndex = blockIndex >> octave.shift;
		const uint32_t octaveH = fmix32((biasSeed ^ (octaveIndex * octave.mul) ^ octave.mix));
		bias += signed8FromHash(octaveH) * octave.weight;
		macroH = octaveH;
	}

	const int absBias = bias < 0 ? -bias : bias;

	const int forceLevel =
		(absBias < biasConfig.threshold0) ? 0 :
		(absBias < biasConfig.threshold1) ? 1 :
		(absBias < biasConfig.threshold2) ? 2 : 3;

	const int jitterLevel = 3 - forceLevel;

	uint32_t ps = (blkH ^ rowH ^ 0xdeadbeefU) | 1u;
	ps = xorshift32(ps); const uint32_t m1 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t m2 = scramble32(ps);
	ps = xorshift32(ps);
	const uint32_t prefWord = scramble32(macroH);
	ps = xorshift32(ps); const uint32_t w1 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w2 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w3 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w4 = scramble32(ps);

	uint32_t forceMask = 0;
	switch (forceLevel) {
		case 0: forceMask = 0; break;
		case 1: forceMask = (m1 & m2); break;
		case 2: forceMask = m1; break;
		default: forceMask = (m1 | m2); break;
	}

	uint32_t weak = (w1 & w2 & w3);
	if (jitterLevel <= 2) weak &= w4;
	if (jitterLevel <= 1) weak &= (weak >> 1);
	if (jitterLevel <= 0) weak = 0;
	weak &= ~forceMask;

	const uint32_t baseState = (blkH ^ 0xa1b2c3d4U) | 1u;
	const uint32_t bootState = (fmix32((bootSeedMix ^ (blockIndex * 0x7f4a7c15U) ^ 0x31415926U)) | 1u);

	BlockGen gen;
	gen.forceMask = forceMask;
	gen.prefWord = prefWord;
	gen.weakMask = weak;
	gen.baseState = baseState;
	gen.bootState = bootState;
	gen.genWordPos = 0;
	return gen;
}

uint32_t nextWord(BlockGen& gen) {
	gen.baseState = xorshift32(gen.baseState);
	gen.bootState = xorshift32(gen.bootState);
	gen.genWordPos += 1;

	const uint32_t baseWord = scramble32(gen.baseState);
	const uint32_t bootWord = scramble32(gen.bootState);

	uint32_t word = (baseWord & ~gen.forceMask) | (gen.prefWord & gen.forceMask);
	word ^= (bootWord & gen.weakMask);
	return word;
}

}

VDP::VDP(
	Memory& memory,
	CPU& cpu,
	Api& api,
	DeviceScheduler& scheduler
)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_api(api)
	, m_vramStaging(VRAM_STAGING_SIZE)
	, m_vramGarbageScratch(VRAM_GARBAGE_CHUNK_BYTES)
	, m_scheduler(scheduler) {
	m_memory.setVramWriter(this);
	m_memory.mapIoRead(IO_VDP_RD_STATUS, this, &VDP::readVdpStatusThunk);
	m_memory.mapIoRead(IO_VDP_RD_DATA, this, &VDP::readVdpDataThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO, this, &VDP::onFifoWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO_CTRL, this, &VDP::onFifoCtrlWriteThunk);
	m_memory.mapIoWrite(IO_PAYLOAD_ALLOC_ADDR, this, &VDP::onObsoletePayloadWriteThunk);
	m_memory.mapIoWrite(IO_PAYLOAD_DATA_ADDR, this, &VDP::onObsoletePayloadWriteThunk);
	m_memory.mapIoWrite(IO_VDP_CMD, this, &VDP::onCommandWriteThunk);
	m_buildBlitterQueue.reserve(BLITTER_FIFO_CAPACITY);
	m_activeBlitterQueue.reserve(BLITTER_FIFO_CAPACITY);
	m_pendingBlitterQueue.reserve(BLITTER_FIFO_CAPACITY);
	m_vramMachineSeed = nextVramMachineSeed();
	m_vramBootSeed = nextVramBootSeed();
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
}

void VDP::resetIngressState() {
	m_vdpFifoWordByteCount = 0;
	m_vdpFifoStreamWordCount = 0u;
	m_dmaSubmitActive = false;
	refreshSubmitBusyStatus();
}

void VDP::resetStatus() {
	m_vdpStatus = 0u;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
	refreshSubmitBusyStatus();
}

void VDP::setVblankStatus(bool active) {
	setStatusFlag(VDP_STATUS_VBLANK, active);
}

void VDP::setStatusFlag(uint32_t mask, bool active) {
	const uint32_t nextStatus = active ? (m_vdpStatus | mask) : (m_vdpStatus & ~mask);
	if (nextStatus == m_vdpStatus) {
		return;
	}
	m_vdpStatus = nextStatus;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
}

bool VDP::canAcceptVdpSubmit() const {
	return !hasBlockedSubmitPath();
}

void VDP::acceptSubmitAttempt() {
	setSubmitRejectedStatus(false);
	refreshSubmitBusyStatus();
}

void VDP::rejectSubmitAttempt() {
	setSubmitRejectedStatus(true);
	refreshSubmitBusyStatus();
}

void VDP::beginDmaSubmit() {
	m_dmaSubmitActive = true;
	acceptSubmitAttempt();
}

void VDP::endDmaSubmit() {
	m_dmaSubmitActive = false;
	refreshSubmitBusyStatus();
}

void VDP::sealDmaTransfer(uint32_t src, size_t byteLength) {
	try {
		consumeSealedVdpStream(src, byteLength);
	} catch (...) {
		endDmaSubmit();
		throw;
	}
	endDmaSubmit();
}

void VDP::writeVdpFifoBytes(const u8* data, size_t length) {
	for (size_t index = 0; index < length; index += 1u) {
		m_vdpFifoWordScratch[static_cast<size_t>(m_vdpFifoWordByteCount)] = data[index];
		m_vdpFifoWordByteCount += 1;
		if (m_vdpFifoWordByteCount != 4) {
			continue;
		}
		const u32 word = static_cast<u32>(m_vdpFifoWordScratch[0])
			| (static_cast<u32>(m_vdpFifoWordScratch[1]) << 8)
			| (static_cast<u32>(m_vdpFifoWordScratch[2]) << 16)
			| (static_cast<u32>(m_vdpFifoWordScratch[3]) << 24);
		m_vdpFifoWordByteCount = 0;
		pushVdpFifoWord(word);
	}
	refreshSubmitBusyStatus();
}

bool VDP::hasOpenDirectVdpFifoIngress() const {
	return m_vdpFifoWordByteCount != 0 || m_vdpFifoStreamWordCount != 0u;
}

bool VDP::hasBlockedSubmitPath() const {
	return hasOpenDirectVdpFifoIngress() || m_dmaSubmitActive || !canAcceptSubmittedFrame();
}

void VDP::setSubmitBusyStatus(bool active) {
	setStatusFlag(VDP_STATUS_SUBMIT_BUSY, active);
}

void VDP::refreshSubmitBusyStatus() {
	setSubmitBusyStatus(hasBlockedSubmitPath());
}

void VDP::setSubmitRejectedStatus(bool active) {
	setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, active);
}

void VDP::pushVdpFifoWord(u32 word) {
	if (m_vdpFifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
		throw vdpStreamFault("stream overflow (" + std::to_string(m_vdpFifoStreamWordCount + 1u) + " > " + std::to_string(VDP_STREAM_CAPACITY_WORDS) + ").");
	}
	m_vdpFifoStreamWords[static_cast<size_t>(m_vdpFifoStreamWordCount)] = word;
	m_vdpFifoStreamWordCount += 1u;
	refreshSubmitBusyStatus();
}

void VDP::consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength) {
	if ((byteLength & 3u) != 0u) {
		throw vdpStreamFault("sealed stream length must be word-aligned.");
	}
	if (byteLength > VDP_STREAM_BUFFER_SIZE) {
		throw vdpStreamFault("sealed stream overflow (" + std::to_string(byteLength) + " > " + std::to_string(VDP_STREAM_BUFFER_SIZE) + ").");
	}
	uint32_t cursor = baseAddr;
	const uint32_t end = baseAddr + static_cast<uint32_t>(byteLength);
	uint32_t packetIndex = 0u;
	beginSubmittedFrame();
	try {
		while (cursor < end) {
			if (cursor + VDP_STREAM_PACKET_HEADER_WORDS * IO_WORD_SIZE > end) {
				throw vdpStreamFault("stream ended mid-packet header.");
			}
			const u32 cmd = m_memory.readU32(cursor);
			const u32 argWords = m_memory.readU32(cursor + IO_WORD_SIZE);
			const u32 payloadWords = m_memory.readU32(cursor + IO_WORD_SIZE * 2u);
			if (payloadWords > VDP_STREAM_PAYLOAD_CAPACITY_WORDS) {
				const uint32_t dumpBase = cursor >= (IO_WORD_SIZE * 6u) ? (cursor - IO_WORD_SIZE * 6u) : baseAddr;
				const uint32_t dumpWords = ((cursor + IO_WORD_SIZE * 6u) <= end) ? 12u : ((end - dumpBase) / IO_WORD_SIZE);
				throw vdpStreamFault(
					"submit payload overflow at addr="
					+ std::to_string(cursor)
					+ " cmd=" + std::to_string(cmd)
					+ " argWords=" + std::to_string(argWords)
					+ " payloadWords=" + std::to_string(payloadWords)
					+ " dump=[" + dumpStreamWords(m_memory, dumpBase, dumpWords) + "]"
					+ " (" + std::to_string(payloadWords)
					+ " > " + std::to_string(VDP_STREAM_PAYLOAD_CAPACITY_WORDS) + ")."
				);
			}
			const u32 packetWordCount = VDP_STREAM_PACKET_HEADER_WORDS + argWords + payloadWords;
			const u32 packetByteCount = packetWordCount * IO_WORD_SIZE;
			if (cursor + packetByteCount > end) {
				const uint32_t dumpBase = cursor >= (IO_WORD_SIZE * 6u) ? (cursor - IO_WORD_SIZE * 6u) : baseAddr;
				const uint32_t dumpWords = ((cursor + IO_WORD_SIZE * 6u) <= end) ? 12u : ((end - dumpBase) / IO_WORD_SIZE);
				throw vdpStreamFault(
					"stream ended mid-packet payload at addr="
					+ std::to_string(cursor)
					+ " packet=" + std::to_string(packetIndex)
					+ " cmd=" + std::to_string(cmd)
					+ " argWords=" + std::to_string(argWords)
					+ " payloadWords=" + std::to_string(payloadWords)
					+ " packetWords=" + std::to_string(packetWordCount)
					+ " remainingWords=" + std::to_string((end - cursor) / IO_WORD_SIZE)
					+ " dump=[" + dumpStreamWords(m_memory, dumpBase, dumpWords) + "]"
				);
			}
			syncRegisters();
			processVdpCommand(
				*this,
				m_cpu,
				m_api,
				m_memory,
				cmd,
				argWords,
				cursor + VDP_STREAM_PACKET_HEADER_WORDS * IO_WORD_SIZE,
				cursor + (VDP_STREAM_PACKET_HEADER_WORDS + argWords) * IO_WORD_SIZE,
				payloadWords
			);
			cursor += packetByteCount;
			packetIndex += 1u;
		}
		sealSubmittedFrame();
	} catch (...) {
		cancelSubmittedFrame();
		throw;
	}
	refreshSubmitBusyStatus();
}

void VDP::consumeSealedVdpWordStream(u32 wordCount) {
	u32 cursor = 0u;
	beginSubmittedFrame();
	try {
		while (cursor < wordCount) {
			if (cursor + VDP_STREAM_PACKET_HEADER_WORDS > wordCount) {
				throw vdpStreamFault("stream ended mid-packet header.");
			}
			const u32 cmd = m_vdpFifoStreamWords[static_cast<size_t>(cursor)];
			const u32 argWords = m_vdpFifoStreamWords[static_cast<size_t>(cursor + 1u)];
			const u32 payloadWords = m_vdpFifoStreamWords[static_cast<size_t>(cursor + 2u)];
			if (payloadWords > VDP_STREAM_PAYLOAD_CAPACITY_WORDS) {
				throw vdpStreamFault(
					"submit payload overflow at word="
					+ std::to_string(cursor)
					+ " cmd=" + std::to_string(cmd)
					+ " argWords=" + std::to_string(argWords)
					+ " payloadWords=" + std::to_string(payloadWords)
					+ " (" + std::to_string(payloadWords)
					+ " > " + std::to_string(VDP_STREAM_PAYLOAD_CAPACITY_WORDS) + ")."
				);
			}
			const u32 packetWordCount = VDP_STREAM_PACKET_HEADER_WORDS + argWords + payloadWords;
			if (cursor + packetWordCount > wordCount) {
				throw vdpStreamFault("stream ended mid-packet payload.");
			}
			syncRegisters();
			processVdpBufferedCommand(
				*this,
				m_cpu,
				m_api,
				m_vdpFifoStreamWords.data(),
				cmd,
				argWords,
				cursor + VDP_STREAM_PACKET_HEADER_WORDS,
				cursor + VDP_STREAM_PACKET_HEADER_WORDS + argWords,
				payloadWords
			);
			cursor += packetWordCount;
		}
		sealSubmittedFrame();
	} catch (...) {
		cancelSubmittedFrame();
		throw;
	}
	refreshSubmitBusyStatus();
}

void VDP::sealVdpFifoTransfer() {
	if (m_vdpFifoWordByteCount != 0) {
		throw vdpStreamFault("FIFO transfer ended on a partial word.");
	}
	if (m_vdpFifoStreamWordCount == 0u) {
		return;
	}
	consumeSealedVdpWordStream(m_vdpFifoStreamWordCount);
	resetIngressState();
}

void VDP::consumeDirectVdpCommand(u32 cmd) {
	const VdpPacketSchema& schema = getVdpPacketSchema(cmd);
	beginSubmittedFrame();
	try {
		syncRegisters();
		processVdpCommand(*this, m_cpu, m_api, m_memory, cmd, schema.argWords, IO_VDP_CMD_ARG0, 0u, 0u);
		sealSubmittedFrame();
	} catch (...) {
		cancelSubmittedFrame();
		throw;
	}
	refreshSubmitBusyStatus();
}

void VDP::onVdpFifoWrite() {
	if (m_dmaSubmitActive || (!hasOpenDirectVdpFifoIngress() && !canAcceptSubmittedFrame())) {
		rejectSubmitAttempt();
		return;
	}
	acceptSubmitAttempt();
	pushVdpFifoWord(m_memory.readIoU32(IO_VDP_FIFO));
}

void VDP::onVdpFifoCtrlWrite() {
	if ((m_memory.readIoU32(IO_VDP_FIFO_CTRL) & VDP_FIFO_CTRL_SEAL) == 0u) {
		return;
	}
	if (m_dmaSubmitActive) {
		rejectSubmitAttempt();
		return;
	}
	sealVdpFifoTransfer();
	refreshSubmitBusyStatus();
}

void VDP::onObsoletePayloadIoWrite() {
	throw vdpFault("payload staging I/O is obsolete. Write payload words directly into the claimed VDP stream packet in RAM.");
}

void VDP::onVdpCommandWrite() {
	const uint32_t command = m_memory.readIoU32(IO_VDP_CMD);
	if (command == 0u) {
		return;
	}
	if (hasBlockedSubmitPath()) {
		rejectSubmitAttempt();
		return;
	}
	acceptSubmitAttempt();
	consumeDirectVdpCommand(command);
}

void VDP::onFifoWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpFifoWrite();
}

void VDP::onFifoCtrlWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpFifoCtrlWrite();
}

void VDP::onObsoletePayloadWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onObsoletePayloadIoWrite();
}

void VDP::onCommandWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpCommandWrite();
}

void VDP::setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_workUnitsPerSec = workUnitsPerSec;
	m_workCarry = 0;
	m_availableWorkUnits = 0;
	scheduleNextService(nowCycles);
}

void VDP::accrueCycles(int cycles, int64_t nowCycles) {
	if (!hasPendingRenderWork() || cycles <= 0) {
		return;
	}
	const int64_t wholeUnits = accrueBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, cycles);
	if (wholeUnits > 0) {
		const int remainingWork = getPendingRenderWorkUnits() - m_availableWorkUnits;
		const int64_t maxGrant = remainingWork <= 0 ? 0 : remainingWork;
		const int64_t granted = wholeUnits > maxGrant ? maxGrant : wholeUnits;
		m_availableWorkUnits += static_cast<int>(granted);
	}
	scheduleNextService(nowCycles);
	refreshSubmitBusyStatus();
}

void VDP::onService(int64_t nowCycles) {
	if (needsImmediateSchedulerService()) {
		promotePendingFrame();
	}
	if (hasPendingRenderWork() && m_availableWorkUnits > 0) {
		const int pendingBefore = getPendingRenderWorkUnits();
		advanceWork(m_availableWorkUnits);
		const int pendingAfter = getPendingRenderWorkUnits();
		const int consumed = pendingBefore - pendingAfter;
		if (consumed > 0) {
			m_availableWorkUnits -= consumed;
		}
	}
	scheduleNextService(nowCycles);
}

void VDP::writeVram(uint32_t addr, const u8* data, size_t length) {
	if (addr >= VRAM_STAGING_BASE && addr + length <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		const uint32_t offset = addr - VRAM_STAGING_BASE;
		std::memcpy(m_vramStaging.data() + offset, data, length);
		return;
	}
	auto& slot = findVramSlot(addr, length);
	const uint32_t offset = addr - slot.baseAddr;
	if ((offset & 3u) != 0u || (length & 3u) != 0u) {
		throw vdpFault("VRAM writes must be 32-bit aligned.");
	}
	if (slot.kind == VramSlotKind::Skybox) {
		return;
	}
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	if (entry.baseStride == 0 || entry.regionW == 0 || entry.regionH == 0) {
		throw vdpFault("VRAM slot not initialized for writes.");
	}
	syncVramSlotTextureSize(slot);
	const uint32_t stride = entry.baseStride;
	const uint32_t totalBytes = entry.regionH * stride;
	if (offset + length > totalBytes) {
		throw vdpFault("VRAM write exceeds slot bounds.");
	}
	auto* texmanager = EngineCore::instance().texmanager();
	size_t remaining = length;
	size_t cursor = 0;
	uint32_t row = offset / stride;
	uint32_t rowOffset = offset - row * stride;
	while (remaining > 0) {
		const uint32_t rowAvailable = stride - rowOffset;
		const uint32_t rowBytes = static_cast<uint32_t>(std::min<size_t>(remaining, rowAvailable));
		const i32 x = static_cast<i32>(rowOffset / 4u);
		const i32 width = static_cast<i32>(rowBytes / 4u);
		texmanager->updateTextureRegionForKey(
			slot.textureKey,
			data + cursor,
			width,
			1,
			x,
			static_cast<i32>(row)
		);
		const size_t cpuOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
		std::memcpy(slot.cpuReadback.data() + cpuOffset, data + cursor, rowBytes);
		invalidateReadCache(slot.surfaceId);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1;
		rowOffset = 0;
	}
}

void VDP::readVram(uint32_t addr, u8* out, size_t length) const {
	if (addr >= VRAM_STAGING_BASE && addr + length <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		const uint32_t offset = addr - VRAM_STAGING_BASE;
		std::memcpy(out, m_vramStaging.data() + offset, length);
		return;
	}
	const auto& slot = findVramSlot(addr, length);
	if (slot.kind == VramSlotKind::Skybox) {
		std::memset(out, 0, length);
		return;
	}
	const auto& entry = m_memory.getAssetEntry(slot.assetId);
	if (entry.baseStride == 0 || entry.regionW == 0 || entry.regionH == 0) {
		std::memset(out, 0, length);
		return;
	}
	const uint32_t offset = addr - slot.baseAddr;
	const uint32_t stride = entry.baseStride;
	const uint32_t totalBytes = entry.regionH * stride;
	if (offset + length > totalBytes) {
		throw vdpFault("VRAM read exceeds slot bounds.");
	}
	size_t remaining = length;
	size_t cursor = 0;
	uint32_t row = offset / stride;
	uint32_t rowOffset = offset - row * stride;
	while (remaining > 0) {
		const uint32_t rowAvailable = stride - rowOffset;
		const uint32_t rowBytes = static_cast<uint32_t>(std::min<size_t>(remaining, rowAvailable));
		const size_t cpuOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
		std::memcpy(out + cursor, slot.cpuReadback.data() + cpuOffset, rowBytes);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1;
		rowOffset = 0;
	}
}

void VDP::beginFrame() {
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
	m_readOverflow = false;
}

VDP::FrameBufferColor VDP::packFrameBufferColor(const Color& color) const {
	return FrameBufferColor{
		frameBufferColorByte(color.r),
		frameBufferColorByte(color.g),
		frameBufferColorByte(color.b),
		frameBufferColorByte(color.a),
	};
}

u32 VDP::nextBlitterSequence() {
	return m_blitterSequence++;
}

std::vector<VDP::GlyphRunGlyph> VDP::acquireGlyphBuffer() {
	return acquireVectorFromPool(m_glyphBufferPool);
}

std::vector<VDP::TileRunBlit> VDP::acquireTileBuffer() {
	return acquireVectorFromPool(m_tileBufferPool);
}

void VDP::recycleBlitterBuffers(std::vector<BlitterCommand>& queue) {
	for (auto& command : queue) {
		if (command.type == BlitterCommandType::GlyphRun) {
			command.glyphs.clear();
			m_glyphBufferPool.push_back(std::move(command.glyphs));
		} else if (command.type == BlitterCommandType::TileRun) {
			command.tiles.clear();
			m_tileBufferPool.push_back(std::move(command.tiles));
		}
	}
}

void VDP::resetBuildFrameState() {
	recycleBlitterBuffers(m_buildBlitterQueue);
	m_buildBlitterQueue.clear();
	m_buildFrameCost = 0;
	m_buildFrameOpen = false;
}

void VDP::enqueueBlitterCommand(BlitterCommand&& command) {
	if (!m_buildFrameOpen) {
		throw vdpFault("no submitted frame is open.");
	}
	if (m_buildBlitterQueue.size() >= BLITTER_FIFO_CAPACITY) {
		throw vdpFault("blitter FIFO overflow (4096 commands).");
	}
	m_buildFrameCost += command.renderCost;
	m_buildBlitterQueue.push_back(std::move(command));
}

int VDP::calculateVisibleRectCost(double width, double height) const {
	return blitAreaBucket(width * height);
}

int VDP::calculateAlphaMultiplier(const FrameBufferColor& color) const {
	return color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
}

void VDP::ensureDisplayFrameBufferTexture() {
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	if (!handle) {
		TextureParams params;
		const TextureKey key = texmanager->makeKey(FRAMEBUFFER_TEXTURE_KEY, params);
		handle = texmanager->getOrCreateTexture(key, m_vramSeedPixel.data(), 1, 1, params);
	}
	handle = texmanager->resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, static_cast<i32>(m_frameBufferWidth), static_cast<i32>(m_frameBufferHeight));
	EngineCore::instance().view()->textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
}

void VDP::swapFrameBufferPages() {
	auto* texmanager = EngineCore::instance().texmanager();
	texmanager->swapTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	auto* view = EngineCore::instance().view();
	view->textures[FRAMEBUFFER_TEXTURE_KEY] = texmanager->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	view->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = texmanager->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	
	// CRITICAL: After swapping texture handles, invalidate the FBO attachment cache
	// so that the next render pass re-attaches to the correct (new) render texture
	g_vdpGles2Runtime.attachedColorTextureId = 0;
	
	auto& renderSlot = getVramSlotByTextureKey(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	std::swap(renderSlot.cpuReadback, m_displayFrameBufferCpuReadback);
	invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
}

void VDP::syncRenderFrameBufferToDisplayPage() {
	auto& renderSlot = getVramSlotByTextureKey(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	if (m_displayFrameBufferCpuReadback.size() != renderSlot.cpuReadback.size()) {
		m_displayFrameBufferCpuReadback.resize(renderSlot.cpuReadback.size());
	}
	std::memcpy(m_displayFrameBufferCpuReadback.data(), renderSlot.cpuReadback.data(), renderSlot.cpuReadback.size());
	auto* texmanager = EngineCore::instance().texmanager();
	texmanager->copyTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY, static_cast<i32>(m_frameBufferWidth), static_cast<i32>(m_frameBufferHeight));
}

void VDP::beginSubmittedFrame() {
	if (m_buildFrameOpen) {
		throw vdpFault("submitted frame already open.");
	}
	resetBuildFrameState();
	m_blitterSequence = 0u;
	m_buildFrameOpen = true;
}

void VDP::cancelSubmittedFrame() {
	resetBuildFrameState();
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::assignBuildToSlot(bool active) {
	if (!m_buildFrameOpen) {
		throw vdpFault("no submitted frame is open.");
	}
	auto& targetQueue = active ? m_activeBlitterQueue : m_pendingBlitterQueue;
	if (!targetQueue.empty()) {
		throw vdpFault(active
			? "active frame queue is not empty."
			: "pending frame queue is not empty.");
	}
	targetQueue.swap(m_buildBlitterQueue);
	const int frameCost = (!targetQueue.empty() && targetQueue.front().type != BlitterCommandType::Clear)
		? (m_buildFrameCost + VDP_RENDER_CLEAR_COST)
		: m_buildFrameCost;
	if (active) {
		m_activeFrameOccupied = true;
		m_activeFrameCost = frameCost;
		m_activeFrameWorkRemaining = frameCost;
		m_activeFrameReady = frameCost == 0;
		m_activeDitherType = m_lastDitherType;
		m_activeSlotAtlasIds = m_slotAtlasIds;
		m_activeSkyboxFaceIds = m_skyboxFaceIds;
		m_activeHasSkybox = m_hasSkybox;
	} else {
		m_pendingFrameOccupied = true;
		m_pendingFrameCost = frameCost;
		m_pendingDitherType = m_lastDitherType;
		m_pendingSlotAtlasIds = m_slotAtlasIds;
		m_pendingSkyboxFaceIds = m_skyboxFaceIds;
		m_pendingHasSkybox = m_hasSkybox;
	}
	m_buildFrameCost = 0;
	m_buildFrameOpen = false;
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::sealSubmittedFrame() {
	if (!m_buildFrameOpen) {
		throw vdpFault("no submitted frame is open.");
	}
	if (!m_activeFrameOccupied) {
		assignBuildToSlot(true);
		return;
	}
	if (!m_pendingFrameOccupied) {
		assignBuildToSlot(false);
		return;
	}
	throw vdpFault("submit slot busy.");
}

void VDP::promotePendingFrame() {
	if (m_activeFrameOccupied || !m_pendingFrameOccupied) {
		return;
	}
	m_activeBlitterQueue.swap(m_pendingBlitterQueue);
	m_pendingBlitterQueue.clear();
	m_activeFrameOccupied = true;
	m_activeFrameReady = m_pendingFrameCost == 0;
	m_activeFrameCost = m_pendingFrameCost;
	m_activeFrameWorkRemaining = m_pendingFrameCost;
	m_activeDitherType = m_pendingDitherType;
	m_activeSlotAtlasIds = m_pendingSlotAtlasIds;
	m_activeSkyboxFaceIds = m_pendingSkyboxFaceIds;
	m_activeHasSkybox = m_pendingHasSkybox;
	m_pendingFrameOccupied = false;
	m_pendingFrameCost = 0;
	m_pendingDitherType = 0;
	m_pendingSlotAtlasIds = {{-1, -1}};
	m_pendingSkyboxFaceIds = {};
	m_pendingHasSkybox = false;
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::advanceWork(int workUnits) {
	if (!m_activeFrameOccupied) {
		promotePendingFrame();
	}
	if (!m_activeFrameOccupied || m_activeFrameReady || workUnits <= 0) {
		return;
	}
	if (workUnits >= m_activeFrameWorkRemaining) {
		m_activeFrameWorkRemaining = 0;
		executeBlitterQueue(m_activeBlitterQueue);
		m_activeFrameReady = true;
		scheduleNextService(m_scheduler.currentNowCycles());
		return;
	}
	m_activeFrameWorkRemaining -= workUnits;
}

int VDP::getPendingRenderWorkUnits() const {
	if (!m_activeFrameOccupied) {
		return m_pendingFrameCost;
	}
	return m_activeFrameReady ? 0 : m_activeFrameWorkRemaining;
}

void VDP::scheduleNextService(int64_t nowCycles) {
	if (needsImmediateSchedulerService()) {
		m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles);
		return;
	}
	if (!hasPendingRenderWork()) {
		m_scheduler.cancelDeviceService(DeviceServiceVdp);
		return;
	}
	const int pendingWork = getPendingRenderWorkUnits();
	const int targetUnits = pendingWork < VDP_SERVICE_BATCH_WORK_UNITS ? pendingWork : VDP_SERVICE_BATCH_WORK_UNITS;
	if (m_availableWorkUnits >= targetUnits) {
		m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, targetUnits - m_availableWorkUnits));
}

void VDP::clearActiveFrame() {
	recycleBlitterBuffers(m_activeBlitterQueue);
	m_activeBlitterQueue.clear();
	m_activeFrameOccupied = false;
	m_activeFrameReady = false;
	m_activeFrameCost = 0;
	m_activeFrameWorkRemaining = 0;
	m_activeDitherType = 0;
	m_activeSlotAtlasIds = {{-1, -1}};
	m_activeSkyboxFaceIds = {};
	m_activeHasSkybox = false;
}

void VDP::commitActiveVisualState() {
	m_committedDitherType = m_activeDitherType;
	m_committedSlotAtlasIds = m_activeSlotAtlasIds;
	if (!m_activeHasSkybox) {
		m_committedHasSkybox = false;
	} else {
		commitSkyboxImages(m_activeSkyboxFaceIds);
		m_committedSkyboxFaceIds = m_activeSkyboxFaceIds;
		m_committedHasSkybox = true;
	}
}

void VDP::presentReadyFrameOnVblankEdge() {
	if (!m_activeFrameOccupied) {
		m_lastFrameCommitted = false;
		m_lastFrameCost = 0;
		m_lastFrameHeld = false;
		promotePendingFrame();
		scheduleNextService(m_scheduler.currentNowCycles());
		refreshSubmitBusyStatus();
		return;
	}
	m_lastFrameCost = m_activeFrameCost;
	if (!m_activeFrameReady) {
		m_lastFrameCommitted = false;
		m_lastFrameHeld = true;
		return;
	}
	if (!m_activeBlitterQueue.empty()) {
		swapFrameBufferPages();
	}
	commitActiveVisualState();
	m_lastFrameCommitted = true;
	m_lastFrameHeld = false;
	clearActiveFrame();
	promotePendingFrame();
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::initializeFrameBufferSurface() {
	auto* backend = EngineCore::instance().view()->backend();
	auto* view = EngineCore::instance().view();
	const uint32_t width = static_cast<uint32_t>(view->viewportSize.x);
	const uint32_t height = static_cast<uint32_t>(view->viewportSize.y);
	auto& entry = m_memory.hasAsset(FRAMEBUFFER_RENDER_TEXTURE_KEY)
		? m_memory.getAssetEntry(FRAMEBUFFER_RENDER_TEXTURE_KEY)
		: m_memory.registerImageSlotAt(
			FRAMEBUFFER_RENDER_TEXTURE_KEY,
			VRAM_FRAMEBUFFER_BASE,
			VRAM_FRAMEBUFFER_SIZE,
			0,
			false
		);
	const uint32_t size = width * height * 4u;
	if (size > entry.capacity) {
		throw vdpFault("framebuffer surface exceeds VRAM capacity.");
	}
	entry.baseSize = size;
	entry.baseStride = width * 4u;
	entry.regionX = 0;
	entry.regionY = 0;
	entry.regionW = width;
	entry.regionH = height;
	m_frameBufferWidth = width;
	m_frameBufferHeight = height;
	const size_t pixelCount = static_cast<size_t>(width) * static_cast<size_t>(height);
	m_frameBufferPriorityLayer.resize(pixelCount);
	m_frameBufferPriorityZ.resize(pixelCount);
	m_frameBufferPrioritySeq.resize(pixelCount);
	std::fill(m_frameBufferPriorityLayer.begin(), m_frameBufferPriorityLayer.end(), static_cast<u8>(Layer2D::World));
	std::fill(m_frameBufferPriorityZ.begin(), m_frameBufferPriorityZ.end(), -std::numeric_limits<f32>::infinity());
	std::fill(m_frameBufferPrioritySeq.begin(), m_frameBufferPrioritySeq.end(), 0u);
	m_displayFrameBufferCpuReadback.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	registerVramSlot(entry, FRAMEBUFFER_RENDER_TEXTURE_KEY, VDP_RD_SURFACE_FRAMEBUFFER);
	if (!backend->readyForTextureUpload()) {
		return;
	}
	ensureDisplayFrameBufferTexture();
	syncRenderFrameBufferToDisplayPage();
}

void VDP::resetFrameBufferPriority() {
	std::fill(m_frameBufferPriorityLayer.begin(), m_frameBufferPriorityLayer.end(), static_cast<u8>(Layer2D::World));
	std::fill(m_frameBufferPriorityZ.begin(), m_frameBufferPriorityZ.end(), -std::numeric_limits<f32>::infinity());
	std::fill(m_frameBufferPrioritySeq.begin(), m_frameBufferPrioritySeq.end(), 0u);
}

VDP::BlitterSource VDP::resolveBlitterSource(u32 handle) const {
	const auto& entry = m_memory.getAssetEntryByHandle(handle);
	if (entry.type != Memory::AssetType::Image) {
		throw vdpFault("asset handle is not an image.");
	}
	if ((entry.flags & ASSET_FLAG_VIEW) != 0u) {
		const auto& base = m_memory.getAssetEntryByHandle(entry.ownerIndex);
		const auto slotIt = std::find_if(m_vramSlots.begin(), m_vramSlots.end(), [this, &base](const VramSlot& candidate) {
			return candidate.kind == VramSlotKind::Asset && m_memory.getAssetEntry(candidate.assetId).ownerIndex == base.ownerIndex;
		});
		if (slotIt == m_vramSlots.end()) {
			throw vdpFault("VIEW asset handle not found in VRAM slots.");
		}
		const auto& slot = *slotIt;
		return BlitterSource{
			slot.surfaceId,
			entry.regionX,
			entry.regionY,
			entry.regionW,
			entry.regionH,
		};
	}
	const auto slotIt = std::find_if(m_vramSlots.begin(), m_vramSlots.end(), [this, &entry](const VramSlot& candidate) {
		return candidate.kind == VramSlotKind::Asset && m_memory.getAssetEntry(candidate.assetId).ownerIndex == entry.ownerIndex;
	});
	if (slotIt == m_vramSlots.end()) {
		throw vdpFault("asset handle not found in VRAM slots.");
	}
	const auto& slot = *slotIt;
	return BlitterSource{
		slot.surfaceId,
		0u,
		0u,
		entry.regionW,
		entry.regionH,
	};
}

void VDP::enqueueClear(const Color& color) {
	BlitterCommand command;
	command.type = BlitterCommandType::Clear;
	command.seq = nextBlitterSequence();
	command.renderCost = VDP_RENDER_CLEAR_COST;
	command.color = packFrameBufferColor(color);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueBlit(u32 handle, f32 x, f32 y, f32 z, Layer2D layer, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const Color& color, f32 parallaxWeight) {
	const BlitterSource source = resolveBlitterSource(handle);
	const auto clipped = computeClippedRect(
		static_cast<double>(x),
		static_cast<double>(y),
		static_cast<double>(x) + static_cast<double>(source.width) * std::abs(static_cast<double>(scaleX)),
		static_cast<double>(y) + static_cast<double>(source.height) * std::abs(static_cast<double>(scaleY)),
		static_cast<double>(m_frameBufferWidth),
		static_cast<double>(m_frameBufferHeight)
	);
	if (clipped.area == 0.0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::Blit;
	command.seq = nextBlitterSequence();
	command.renderCost = calculateVisibleRectCost(clipped.width, clipped.height);
	command.z = z;
	command.layer = layer;
	command.source = source;
	command.dstX = x;
	command.dstY = y;
	command.scaleX = scaleX;
	command.scaleY = scaleY;
	command.parallaxWeight = parallaxWeight;
	command.flipH = flipH;
	command.flipV = flipV;
	command.color = packFrameBufferColor(color);
	command.renderCost *= calculateAlphaMultiplier(command.color);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueCopyRect(i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, f32 z, Layer2D layer) {
	const auto clipped = computeClippedRect(
		static_cast<double>(dstX),
		static_cast<double>(dstY),
		static_cast<double>(dstX + width),
		static_cast<double>(dstY + height),
		static_cast<double>(m_frameBufferWidth),
		static_cast<double>(m_frameBufferHeight)
	);
	if (clipped.area == 0.0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::CopyRect;
	command.seq = nextBlitterSequence();
	command.renderCost = calculateVisibleRectCost(clipped.width, clipped.height);
	command.z = z;
	command.layer = layer;
	command.srcX = srcX;
	command.srcY = srcY;
	command.width = width;
	command.height = height;
	command.dstX = static_cast<f32>(dstX);
	command.dstY = static_cast<f32>(dstY);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueFillRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color) {
	const auto clipped = computeClippedRect(
		static_cast<double>(x0),
		static_cast<double>(y0),
		static_cast<double>(x1),
		static_cast<double>(y1),
		static_cast<double>(m_frameBufferWidth),
		static_cast<double>(m_frameBufferHeight)
	);
	if (clipped.area == 0.0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::FillRect;
	command.seq = nextBlitterSequence();
	command.renderCost = calculateVisibleRectCost(clipped.width, clipped.height);
	command.x0 = x0;
	command.y0 = y0;
	command.x1 = x1;
	command.y1 = y1;
	command.z = z;
	command.layer = layer;
	command.color = packFrameBufferColor(color);
	command.renderCost *= calculateAlphaMultiplier(command.color);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueDrawLine(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color, f32 thickness) {
	const double span = computeClippedLineSpan(
		static_cast<double>(x0),
		static_cast<double>(y0),
		static_cast<double>(x1),
		static_cast<double>(y1),
		static_cast<double>(m_frameBufferWidth),
		static_cast<double>(m_frameBufferHeight)
	);
	if (span == 0.0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::DrawLine;
	command.seq = nextBlitterSequence();
	command.renderCost = blitSpanBucket(span) * (thickness > 1.0f ? 2 : 1);
	command.x0 = x0;
	command.y0 = y0;
	command.x1 = x1;
	command.y1 = y1;
	command.z = z;
	command.layer = layer;
	command.thickness = thickness;
	command.color = packFrameBufferColor(color);
	command.renderCost *= calculateAlphaMultiplier(command.color);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueDrawRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color) {
	enqueueDrawLine(x0, y0, x1, y0, z, layer, color, 1.0f);
	enqueueDrawLine(x0, y1, x1, y1, z, layer, color, 1.0f);
	enqueueDrawLine(x0, y0, x0, y1, z, layer, color, 1.0f);
	enqueueDrawLine(x1, y0, x1, y1, z, layer, color, 1.0f);
}

void VDP::enqueueDrawPoly(const std::vector<f32>& points, f32 z, const Color& color, f32 thickness, Layer2D layer) {
	if (points.size() < 4u) {
		return;
	}
	for (size_t index = 0; index < points.size(); index += 2u) {
		const size_t next = (index + 2u) % points.size();
		enqueueDrawLine(points[index], points[index + 1u], points[next], points[next + 1u], z, layer, color, thickness);
	}
}

void VDP::enqueueGlyphRun(const std::string& text, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer) {
	if (!font) {
		throw vdpFault("no font available for glyph rendering.");
	}
	BlitterCommand command;
	command.type = BlitterCommandType::GlyphRun;
	command.seq = nextBlitterSequence();
	command.glyphs = acquireGlyphBuffer();
	command.z = z;
	command.layer = layer;
	command.lineHeight = static_cast<u32>(font->lineHeight());
	command.color = packFrameBufferColor(color);
	command.backgroundColor = backgroundColor.has_value()
		? std::optional<FrameBufferColor>(packFrameBufferColor(*backgroundColor))
		: std::nullopt;
	f32 cursorY = y;
	int renderCost = 0;
	const auto enqueueGlyphLine = [&](const std::string& source, size_t byteStart, size_t byteEnd) {
		if (byteStart == byteEnd) {
			cursorY += static_cast<f32>(font->lineHeight());
			return;
		}
		f32 cursorX = x;
		size_t byteIndex = byteStart;
		i32 glyphIndex = 0;
		while (byteIndex < byteEnd) {
			const u32 codepoint = readUtf8Codepoint(source, byteIndex);
			if (glyphIndex >= end) {
				break;
			}
			if (glyphIndex < start) {
				glyphIndex += 1;
				continue;
			}
			const FontGlyph& glyph = font->getGlyph(codepoint);
			const BlitterSource sourceBlit = resolveBlitterSource(m_memory.resolveAssetHandle(glyph.imgid));
			const auto clipped = computeClippedRect(
				static_cast<double>(cursorX),
				static_cast<double>(cursorY),
				static_cast<double>(cursorX) + static_cast<double>(sourceBlit.width),
				static_cast<double>(cursorY) + static_cast<double>(sourceBlit.height),
				static_cast<double>(m_frameBufferWidth),
				static_cast<double>(m_frameBufferHeight)
			);
			if (clipped.area > 0.0) {
				renderCost += calculateVisibleRectCost(clipped.width, clipped.height);
				if (command.backgroundColor.has_value()) {
					const auto backgroundRect = computeClippedRect(
						static_cast<double>(cursorX),
						static_cast<double>(cursorY),
						static_cast<double>(cursorX) + static_cast<double>(glyph.advance),
						static_cast<double>(cursorY) + static_cast<double>(font->lineHeight()),
						static_cast<double>(m_frameBufferWidth),
						static_cast<double>(m_frameBufferHeight)
					);
					if (backgroundRect.area > 0.0) {
						renderCost += calculateVisibleRectCost(backgroundRect.width, backgroundRect.height) * calculateAlphaMultiplier(*command.backgroundColor);
					}
				}
				command.glyphs.emplace_back();
				auto& blit = command.glyphs.back();
				blit.surfaceId = sourceBlit.surfaceId;
				blit.srcX = sourceBlit.srcX;
				blit.srcY = sourceBlit.srcY;
				blit.width = sourceBlit.width;
				blit.height = sourceBlit.height;
				blit.dstX = cursorX;
				blit.dstY = cursorY;
				blit.advance = static_cast<u32>(glyph.advance);
			}
			cursorX += static_cast<f32>(glyph.advance);
			glyphIndex += 1;
		}
		cursorY += static_cast<f32>(font->lineHeight());
	};
	size_t lineStart = 0u;
	while (lineStart <= text.size()) {
		const size_t lineEnd = text.find('\n', lineStart);
		if (lineEnd == std::string::npos) {
			enqueueGlyphLine(text, lineStart, text.size());
			break;
		}
		enqueueGlyphLine(text, lineStart, lineEnd);
		lineStart = lineEnd + 1u;
	}
	if (command.glyphs.empty()) {
		command.glyphs.clear();
		m_glyphBufferPool.push_back(std::move(command.glyphs));
		return;
	}
	command.renderCost = renderCost;
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueGlyphRun(const std::vector<std::string>& lines, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer) {
	if (!font) {
		throw vdpFault("no font available for glyph rendering.");
	}
	BlitterCommand command;
	command.type = BlitterCommandType::GlyphRun;
	command.seq = nextBlitterSequence();
	command.glyphs = acquireGlyphBuffer();
	command.z = z;
	command.layer = layer;
	command.lineHeight = static_cast<u32>(font->lineHeight());
	command.color = packFrameBufferColor(color);
	command.backgroundColor = backgroundColor.has_value()
		? std::optional<FrameBufferColor>(packFrameBufferColor(*backgroundColor))
		: std::nullopt;
	f32 cursorY = y;
	int renderCost = 0;
	for (const auto& line : lines) {
		if (line.empty()) {
			cursorY += static_cast<f32>(font->lineHeight());
			continue;
		}
		f32 cursorX = x;
		size_t byteIndex = 0u;
		i32 glyphIndex = 0;
		while (byteIndex < line.size()) {
			const u32 codepoint = readUtf8Codepoint(line, byteIndex);
			if (glyphIndex >= end) {
				break;
			}
			if (glyphIndex < start) {
				glyphIndex += 1;
				continue;
			}
			const FontGlyph& glyph = font->getGlyph(codepoint);
			const BlitterSource source = resolveBlitterSource(m_memory.resolveAssetHandle(glyph.imgid));
			const auto clipped = computeClippedRect(
				static_cast<double>(cursorX),
				static_cast<double>(cursorY),
				static_cast<double>(cursorX) + static_cast<double>(source.width),
				static_cast<double>(cursorY) + static_cast<double>(source.height),
				static_cast<double>(m_frameBufferWidth),
				static_cast<double>(m_frameBufferHeight)
			);
			if (clipped.area > 0.0) {
				renderCost += calculateVisibleRectCost(clipped.width, clipped.height);
				if (command.backgroundColor.has_value()) {
					const auto backgroundRect = computeClippedRect(
						static_cast<double>(cursorX),
						static_cast<double>(cursorY),
						static_cast<double>(cursorX) + static_cast<double>(glyph.advance),
						static_cast<double>(cursorY) + static_cast<double>(font->lineHeight()),
						static_cast<double>(m_frameBufferWidth),
						static_cast<double>(m_frameBufferHeight)
					);
					if (backgroundRect.area > 0.0) {
						renderCost += calculateVisibleRectCost(backgroundRect.width, backgroundRect.height) * calculateAlphaMultiplier(*command.backgroundColor);
					}
				}
				command.glyphs.emplace_back();
				auto& blit = command.glyphs.back();
				blit.surfaceId = source.surfaceId;
				blit.srcX = source.srcX;
				blit.srcY = source.srcY;
				blit.width = source.width;
				blit.height = source.height;
				blit.dstX = cursorX;
				blit.dstY = cursorY;
				blit.advance = static_cast<u32>(glyph.advance);
			}
			cursorX += static_cast<f32>(glyph.advance);
			glyphIndex += 1;
		}
		cursorY += static_cast<f32>(font->lineHeight());
	}
	if (command.glyphs.empty()) {
		command.glyphs.clear();
		m_glyphBufferPool.push_back(std::move(command.glyphs));
		return;
	}
	command.renderCost = renderCost;
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueTileRun(const std::vector<u32>& handles, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	const i32 frameWidth = static_cast<i32>(m_frameBufferWidth);
	const i32 frameHeight = static_cast<i32>(m_frameBufferHeight);
	const i32 totalWidth = cols * tileW;
	const i32 totalHeight = rows * tileH;
	i32 dstX = originX - scrollX;
	i32 dstY = originY - scrollY;
	i32 srcClipX = 0;
	i32 srcClipY = 0;
	i32 writeWidth = totalWidth;
	i32 writeHeight = totalHeight;
	if (dstX < 0) {
		srcClipX = -dstX;
		writeWidth += dstX;
		dstX = 0;
	}
	if (dstY < 0) {
		srcClipY = -dstY;
		writeHeight += dstY;
		dstY = 0;
	}
	const i32 overflowX = (dstX + writeWidth) - frameWidth;
	if (overflowX > 0) {
		writeWidth -= overflowX;
	}
	const i32 overflowY = (dstY + writeHeight) - frameHeight;
	if (overflowY > 0) {
		writeHeight -= overflowY;
	}
	if (writeWidth <= 0 || writeHeight <= 0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::TileRun;
	command.seq = nextBlitterSequence();
	command.tiles = acquireTileBuffer();
	command.z = z;
	command.layer = layer;
	int visibleRowCount = 0;
	int visibleNonEmptyTileCount = 0;
	for (i32 row = 0; row < rows; row += 1) {
		const i32 base = row * cols;
		bool rowHasVisibleTile = false;
		for (i32 col = 0; col < cols; col += 1) {
			const u32 handle = handles[static_cast<size_t>(base + col)];
			if (handle == IO_VDP_TILE_HANDLE_NONE) {
				continue;
			}
			const BlitterSource source = resolveBlitterSource(handle);
			if (source.width != static_cast<u32>(tileW) || source.height != static_cast<u32>(tileH)) {
				throw vdpFault("enqueueTileRun tile size mismatch.");
			}
			const i32 tileX = dstX + (col * tileW) - srcClipX;
			const i32 tileY = dstY + (row * tileH) - srcClipY;
			const auto clipped = computeClippedRect(
				static_cast<double>(tileX),
				static_cast<double>(tileY),
				static_cast<double>(tileX + tileW),
				static_cast<double>(tileY + tileH),
				static_cast<double>(frameWidth),
				static_cast<double>(frameHeight)
			);
			if (clipped.area == 0.0) {
				continue;
			}
			visibleNonEmptyTileCount += 1;
			if (!rowHasVisibleTile) {
				rowHasVisibleTile = true;
				visibleRowCount += 1;
			}
			command.tiles.emplace_back();
			auto& blit = command.tiles.back();
			blit.surfaceId = source.surfaceId;
			blit.srcX = source.srcX;
			blit.srcY = source.srcY;
			blit.width = source.width;
			blit.height = source.height;
			blit.dstX = static_cast<f32>(tileX);
			blit.dstY = static_cast<f32>(tileY);
		}
	}
	if (command.tiles.empty()) {
		command.tiles.clear();
		m_tileBufferPool.push_back(std::move(command.tiles));
		return;
	}
	command.renderCost = tileRunCost(visibleRowCount, visibleNonEmptyTileCount);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueuePayloadTileRun(uint32_t payloadBase, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	if (tileCount != static_cast<uint32_t>(cols * rows)) {
		throw vdpFault("enqueuePayloadTileRun size mismatch.");
	}
	const i32 frameWidth = static_cast<i32>(m_frameBufferWidth);
	const i32 frameHeight = static_cast<i32>(m_frameBufferHeight);
	const i32 totalWidth = cols * tileW;
	const i32 totalHeight = rows * tileH;
	i32 dstX = originX - scrollX;
	i32 dstY = originY - scrollY;
	i32 srcClipX = 0;
	i32 srcClipY = 0;
	i32 writeWidth = totalWidth;
	i32 writeHeight = totalHeight;
	if (dstX < 0) {
		srcClipX = -dstX;
		writeWidth += dstX;
		dstX = 0;
	}
	if (dstY < 0) {
		srcClipY = -dstY;
		writeHeight += dstY;
		dstY = 0;
	}
	const i32 overflowX = (dstX + writeWidth) - frameWidth;
	if (overflowX > 0) {
		writeWidth -= overflowX;
	}
	const i32 overflowY = (dstY + writeHeight) - frameHeight;
	if (overflowY > 0) {
		writeHeight -= overflowY;
	}
	if (writeWidth <= 0 || writeHeight <= 0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::TileRun;
	command.seq = nextBlitterSequence();
	command.tiles = acquireTileBuffer();
	command.z = z;
	command.layer = layer;
	int visibleRowCount = 0;
	int visibleNonEmptyTileCount = 0;
	for (i32 row = 0; row < rows; row += 1) {
		const i32 base = row * cols;
		bool rowHasVisibleTile = false;
		for (i32 col = 0; col < cols; col += 1) {
			const u32 handle = m_memory.readU32(payloadBase + static_cast<uint32_t>(base + col) * IO_WORD_SIZE);
			if (handle == IO_VDP_TILE_HANDLE_NONE) {
				continue;
			}
			const BlitterSource source = resolveBlitterSource(handle);
			if (source.width != static_cast<u32>(tileW) || source.height != static_cast<u32>(tileH)) {
				throw vdpFault("enqueuePayloadTileRun tile size mismatch.");
			}
			const i32 tileX = dstX + (col * tileW) - srcClipX;
			const i32 tileY = dstY + (row * tileH) - srcClipY;
			const auto clipped = computeClippedRect(
				static_cast<double>(tileX),
				static_cast<double>(tileY),
				static_cast<double>(tileX + tileW),
				static_cast<double>(tileY + tileH),
				static_cast<double>(frameWidth),
				static_cast<double>(frameHeight)
			);
			if (clipped.area == 0.0) {
				continue;
			}
			visibleNonEmptyTileCount += 1;
			if (!rowHasVisibleTile) {
				rowHasVisibleTile = true;
				visibleRowCount += 1;
			}
			command.tiles.emplace_back();
			auto& blit = command.tiles.back();
			blit.surfaceId = source.surfaceId;
			blit.srcX = source.srcX;
			blit.srcY = source.srcY;
			blit.width = source.width;
			blit.height = source.height;
			blit.dstX = static_cast<f32>(tileX);
			blit.dstY = static_cast<f32>(tileY);
		}
	}
	if (command.tiles.empty()) {
		command.tiles.clear();
		m_tileBufferPool.push_back(std::move(command.tiles));
		return;
	}
	command.renderCost = tileRunCost(visibleRowCount, visibleNonEmptyTileCount);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueuePayloadTileRunWords(const u32* payloadWords, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	if (tileCount != static_cast<uint32_t>(cols * rows)) {
		throw vdpFault("enqueuePayloadTileRunWords size mismatch.");
	}
	const i32 frameWidth = static_cast<i32>(m_frameBufferWidth);
	const i32 frameHeight = static_cast<i32>(m_frameBufferHeight);
	const i32 totalWidth = cols * tileW;
	const i32 totalHeight = rows * tileH;
	i32 dstX = originX - scrollX;
	i32 dstY = originY - scrollY;
	i32 srcClipX = 0;
	i32 srcClipY = 0;
	i32 writeWidth = totalWidth;
	i32 writeHeight = totalHeight;
	if (dstX < 0) {
		srcClipX = -dstX;
		writeWidth += dstX;
		dstX = 0;
	}
	if (dstY < 0) {
		srcClipY = -dstY;
		writeHeight += dstY;
		dstY = 0;
	}
	const i32 overflowX = (dstX + writeWidth) - frameWidth;
	if (overflowX > 0) {
		writeWidth -= overflowX;
	}
	const i32 overflowY = (dstY + writeHeight) - frameHeight;
	if (overflowY > 0) {
		writeHeight -= overflowY;
	}
	if (writeWidth <= 0 || writeHeight <= 0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::TileRun;
	command.seq = nextBlitterSequence();
	command.tiles = acquireTileBuffer();
	command.z = z;
	command.layer = layer;
	int visibleRowCount = 0;
	int visibleNonEmptyTileCount = 0;
	for (i32 row = 0; row < rows; row += 1) {
		const i32 base = row * cols;
		bool rowHasVisibleTile = false;
		for (i32 col = 0; col < cols; col += 1) {
			const u32 handle = payloadWords[static_cast<size_t>(base + col)];
			if (handle == IO_VDP_TILE_HANDLE_NONE) {
				continue;
			}
			const BlitterSource source = resolveBlitterSource(handle);
			if (source.width != static_cast<u32>(tileW) || source.height != static_cast<u32>(tileH)) {
				throw vdpFault("enqueuePayloadTileRunWords tile size mismatch.");
			}
			const i32 tileX = dstX + (col * tileW) - srcClipX;
			const i32 tileY = dstY + (row * tileH) - srcClipY;
			const auto clipped = computeClippedRect(
				static_cast<double>(tileX),
				static_cast<double>(tileY),
				static_cast<double>(tileX + tileW),
				static_cast<double>(tileY + tileH),
				static_cast<double>(frameWidth),
				static_cast<double>(frameHeight)
			);
			if (clipped.area == 0.0) {
				continue;
			}
			visibleNonEmptyTileCount += 1;
			if (!rowHasVisibleTile) {
				rowHasVisibleTile = true;
				visibleRowCount += 1;
			}
			command.tiles.emplace_back();
			auto& blit = command.tiles.back();
			blit.surfaceId = source.surfaceId;
			blit.srcX = source.srcX;
			blit.srcY = source.srcY;
			blit.width = source.width;
			blit.height = source.height;
			blit.dstX = static_cast<f32>(tileX);
			blit.dstY = static_cast<f32>(tileY);
		}
	}
	if (command.tiles.empty()) {
		command.tiles.clear();
		m_tileBufferPool.push_back(std::move(command.tiles));
		return;
	}
	command.renderCost = tileRunCost(visibleRowCount, visibleNonEmptyTileCount);
	enqueueBlitterCommand(std::move(command));
}

void VDP::blendFrameBufferPixel(std::vector<u8>& pixels, size_t index, u8 r, u8 g, u8 b, u8 a, Layer2D layer, f32 z, u32 seq) {
	if (a == 0u) {
		return;
	}
	const size_t pixelIndex = index >> 2u;
	const auto currentLayer = static_cast<Layer2D>(m_frameBufferPriorityLayer[pixelIndex]);
	if (layer < currentLayer) {
		return;
	}
	if (layer == currentLayer) {
		const f32 currentZ = m_frameBufferPriorityZ[pixelIndex];
		if (z < currentZ) {
			return;
		}
		if (z == currentZ && seq < m_frameBufferPrioritySeq[pixelIndex]) {
			return;
		}
	}
	if (a == 255u) {
		pixels[index + 0u] = r;
		pixels[index + 1u] = g;
		pixels[index + 2u] = b;
		pixels[index + 3u] = 255u;
		m_frameBufferPriorityLayer[pixelIndex] = static_cast<u8>(layer);
		m_frameBufferPriorityZ[pixelIndex] = z;
		m_frameBufferPrioritySeq[pixelIndex] = seq;
		return;
	}
	const u32 inverse = 255u - a;
	pixels[index + 0u] = static_cast<u8>(((static_cast<u32>(r) * a) + (static_cast<u32>(pixels[index + 0u]) * inverse) + 127u) / 255u);
	pixels[index + 1u] = static_cast<u8>(((static_cast<u32>(g) * a) + (static_cast<u32>(pixels[index + 1u]) * inverse) + 127u) / 255u);
	pixels[index + 2u] = static_cast<u8>(((static_cast<u32>(b) * a) + (static_cast<u32>(pixels[index + 2u]) * inverse) + 127u) / 255u);
	pixels[index + 3u] = static_cast<u8>(a + ((static_cast<u32>(pixels[index + 3u]) * inverse) + 127u) / 255u);
	m_frameBufferPriorityLayer[pixelIndex] = static_cast<u8>(layer);
	m_frameBufferPriorityZ[pixelIndex] = z;
	m_frameBufferPrioritySeq[pixelIndex] = seq;
}

void VDP::rasterizeFrameBufferFill(std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, const FrameBufferColor& color, Layer2D layer, f32 z, u32 seq) {
	i32 left = static_cast<i32>(std::round(x0));
	i32 top = static_cast<i32>(std::round(y0));
	i32 right = static_cast<i32>(std::round(x1));
	i32 bottom = static_cast<i32>(std::round(y1));
	if (right < left) {
		std::swap(left, right);
	}
	if (bottom < top) {
		std::swap(top, bottom);
	}
	left = std::max(0, left);
	top = std::max(0, top);
	right = std::min(static_cast<i32>(m_frameBufferWidth), right);
	bottom = std::min(static_cast<i32>(m_frameBufferHeight), bottom);
	for (i32 y = top; y < bottom; ++y) {
		size_t index = (static_cast<size_t>(y) * static_cast<size_t>(m_frameBufferWidth) + static_cast<size_t>(left)) * 4u;
		for (i32 x = left; x < right; ++x) {
			blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, z, seq);
			index += 4u;
		}
	}
}

void VDP::rasterizeFrameBufferLine(std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, f32 thicknessValue, const FrameBufferColor& color, Layer2D layer, f32 z, u32 seq) {
	i32 currentX = static_cast<i32>(std::round(x0));
	i32 currentY = static_cast<i32>(std::round(y0));
	const i32 targetX = static_cast<i32>(std::round(x1));
	const i32 targetY = static_cast<i32>(std::round(y1));
	const i32 dx = std::abs(targetX - currentX);
	const i32 dy = std::abs(targetY - currentY);
	const i32 sx = currentX < targetX ? 1 : -1;
	const i32 sy = currentY < targetY ? 1 : -1;
	i32 err = dx - dy;
	const i32 thickness = std::max(1, static_cast<i32>(std::round(thicknessValue)));
	while (true) {
		const i32 half = thickness >> 1;
		for (i32 yy = currentY - half; yy < currentY - half + thickness; ++yy) {
			if (yy < 0 || yy >= static_cast<i32>(m_frameBufferHeight)) {
				continue;
			}
			for (i32 xx = currentX - half; xx < currentX - half + thickness; ++xx) {
				if (xx < 0 || xx >= static_cast<i32>(m_frameBufferWidth)) {
					continue;
				}
				const size_t index = (static_cast<size_t>(yy) * static_cast<size_t>(m_frameBufferWidth) + static_cast<size_t>(xx)) * 4u;
				blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, z, seq);
			}
		}
		if (currentX == targetX && currentY == targetY) {
			return;
		}
		const i32 e2 = err << 1;
		if (e2 > -dy) {
			err -= dy;
			currentX += sx;
		}
		if (e2 < dx) {
			err += dx;
			currentY += sy;
		}
	}
}

void VDP::rasterizeFrameBufferBlit(std::vector<u8>& pixels, const BlitterSource& source, f32 dstXValue, f32 dstYValue, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const FrameBufferColor& color, Layer2D layer, f32 z, u32 seq) {
	const auto& sourceSurface = getReadSurface(source.surfaceId);
	const u8* sourcePixels = getVramSlotByTextureKey(sourceSurface.textureKey).cpuReadback.data();
	const u32 sourceStride = m_memory.getAssetEntry(sourceSurface.assetId).regionW * 4u;
	const i32 dstW = std::max(1, static_cast<i32>(std::round(static_cast<f32>(source.width) * scaleX)));
	const i32 dstH = std::max(1, static_cast<i32>(std::round(static_cast<f32>(source.height) * scaleY)));
	const i32 dstX = static_cast<i32>(std::round(dstXValue));
	const i32 dstY = static_cast<i32>(std::round(dstYValue));
	for (i32 y = 0; y < dstH; ++y) {
		const i32 targetY = dstY + y;
		if (targetY < 0 || targetY >= static_cast<i32>(m_frameBufferHeight)) {
			continue;
		}
		const i32 srcY = flipV
			? static_cast<i32>(source.height) - 1 - ((y * static_cast<i32>(source.height)) / dstH)
			: ((y * static_cast<i32>(source.height)) / dstH);
		for (i32 x = 0; x < dstW; ++x) {
			const i32 targetX = dstX + x;
			if (targetX < 0 || targetX >= static_cast<i32>(m_frameBufferWidth)) {
				continue;
			}
			const i32 srcX = flipH
				? static_cast<i32>(source.width) - 1 - ((x * static_cast<i32>(source.width)) / dstW)
				: ((x * static_cast<i32>(source.width)) / dstW);
			const size_t srcIndex = (static_cast<size_t>(source.srcY + static_cast<uint32_t>(srcY)) * static_cast<size_t>(sourceStride))
				+ (static_cast<size_t>(source.srcX + static_cast<uint32_t>(srcX)) * 4u);
			const u8 srcA = sourcePixels[srcIndex + 3u];
			if (srcA == 0u) {
				continue;
			}
			const u8 outA = static_cast<u8>((static_cast<u32>(srcA) * static_cast<u32>(color.a) + 127u) / 255u);
			const u8 outR = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 0u]) * static_cast<u32>(color.r) + 127u) / 255u);
			const u8 outG = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 1u]) * static_cast<u32>(color.g) + 127u) / 255u);
			const u8 outB = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 2u]) * static_cast<u32>(color.b) + 127u) / 255u);
			const size_t dstIndex = (static_cast<size_t>(targetY) * static_cast<size_t>(m_frameBufferWidth) + static_cast<size_t>(targetX)) * 4u;
			blendFrameBufferPixel(pixels, dstIndex, outR, outG, outB, outA, layer, z, seq);
		}
	}
}

void VDP::copyFrameBufferRect(std::vector<u8>& pixels, i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, Layer2D layer, f32 z, u32 seq) {
	const size_t rowBytes = static_cast<size_t>(width) * 4u;
	const bool overlapping =
		dstX < srcX + width
		&& dstX + width > srcX
		&& dstY < srcY + height
		&& dstY + height > srcY;
	const i32 startRow = overlapping && dstY > srcY ? height - 1 : 0;
	const i32 endRow = overlapping && dstY > srcY ? -1 : height;
	const i32 step = overlapping && dstY > srcY ? -1 : 1;
	for (i32 row = startRow; row != endRow; row += step) {
		const size_t sourceIndex = (static_cast<size_t>(srcY + row) * static_cast<size_t>(m_frameBufferWidth) + static_cast<size_t>(srcX)) * 4u;
		const size_t targetIndex = (static_cast<size_t>(dstY + row) * static_cast<size_t>(m_frameBufferWidth) + static_cast<size_t>(dstX)) * 4u;
		std::memmove(pixels.data() + targetIndex, pixels.data() + sourceIndex, rowBytes);
		const size_t targetPixel = (static_cast<size_t>(dstY + row) * static_cast<size_t>(m_frameBufferWidth)) + static_cast<size_t>(dstX);
		for (i32 col = 0; col < width; ++col) {
			const size_t pixelIndex = targetPixel + static_cast<size_t>(col);
			m_frameBufferPriorityLayer[pixelIndex] = static_cast<u8>(layer);
			m_frameBufferPriorityZ[pixelIndex] = z;
			m_frameBufferPrioritySeq[pixelIndex] = seq;
		}
	}
}

void VDP::executeBlitterQueue(const std::vector<BlitterCommand>& queue) {
	if (queue.empty()) {
		return;
	}
#if BMSX_ENABLE_GLES2
	if (VdpGles2Blitter::execute(*this, queue)) {
		return;
	}
#endif
	resetFrameBufferPriority();
	auto& pixels = getVramSlotByTextureKey(FRAMEBUFFER_RENDER_TEXTURE_KEY).cpuReadback;
	if (queue.front().type != BlitterCommandType::Clear) {
		for (size_t index = 0; index < pixels.size(); index += 4u) {
			pixels[index + 0u] = IMPLICIT_FRAME_CLEAR_RGBA[0];
			pixels[index + 1u] = IMPLICIT_FRAME_CLEAR_RGBA[1];
			pixels[index + 2u] = IMPLICIT_FRAME_CLEAR_RGBA[2];
			pixels[index + 3u] = IMPLICIT_FRAME_CLEAR_RGBA[3];
		}
	}
	for (const auto& command : queue) {
		switch (command.type) {
			case BlitterCommandType::Clear:
				for (size_t index = 0; index < pixels.size(); index += 4u) {
					pixels[index + 0u] = command.color.r;
					pixels[index + 1u] = command.color.g;
					pixels[index + 2u] = command.color.b;
					pixels[index + 3u] = command.color.a;
				}
				resetFrameBufferPriority();
				break;
			case BlitterCommandType::FillRect:
				rasterizeFrameBufferFill(pixels, command.x0, command.y0, command.x1, command.y1, command.color, command.layer, command.z, command.seq);
				break;
			case BlitterCommandType::DrawLine:
				rasterizeFrameBufferLine(pixels, command.x0, command.y0, command.x1, command.y1, command.thickness, command.color, command.layer, command.z, command.seq);
				break;
			case BlitterCommandType::Blit:
				rasterizeFrameBufferBlit(pixels, command.source, command.dstX, command.dstY, command.scaleX, command.scaleY, command.flipH, command.flipV, command.color, command.layer, command.z, command.seq);
				break;
			case BlitterCommandType::CopyRect:
				copyFrameBufferRect(pixels, command.srcX, command.srcY, command.width, command.height, static_cast<i32>(std::round(command.dstX)), static_cast<i32>(std::round(command.dstY)), command.layer, command.z, command.seq);
				break;
			case BlitterCommandType::GlyphRun:
				if (command.backgroundColor.has_value()) {
					for (const auto& glyph : command.glyphs) {
						rasterizeFrameBufferFill(
							pixels,
							glyph.dstX,
							glyph.dstY,
							glyph.dstX + static_cast<f32>(glyph.advance),
							glyph.dstY + static_cast<f32>(command.lineHeight),
							*command.backgroundColor,
							command.layer,
							command.z,
							command.seq
						);
					}
				}
				for (const auto& glyph : command.glyphs) {
					rasterizeFrameBufferBlit(pixels, glyph, glyph.dstX, glyph.dstY, 1.0f, 1.0f, false, false, command.color, command.layer, command.z, command.seq);
				}
				break;
			case BlitterCommandType::TileRun:
				for (const auto& tile : command.tiles) {
					rasterizeFrameBufferBlit(pixels, tile, tile.dstX, tile.dstY, 1.0f, 1.0f, false, false, FrameBufferColor{255u, 255u, 255u, 255u}, command.layer, command.z, command.seq);
				}
				break;
		}
	}
	TextureParams params;
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = EngineCore::instance().view()->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY];
	texmanager->updateTexture(handle, pixels.data(), static_cast<i32>(m_frameBufferWidth), static_cast<i32>(m_frameBufferHeight), params);
	invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
}

void VDP::shutdownBackendResources() {
#if BMSX_ENABLE_GLES2
	VdpGles2Blitter::shutdown();
#endif
}

void VDP::commitSkyboxImages(const SkyboxImageIds& ids) {
	const std::array<const std::string*, 6> faces = {{&ids.posx, &ids.negx, &ids.posy, &ids.negy, &ids.posz, &ids.negz}};
	for (size_t index = 0; index < faces.size(); ++index) {
		const std::string& assetId = *faces[index];
		auto* asset = EngineCore::instance().resolveImgAsset(assetId);
		if (!asset) {
			throw vdpFault("skybox image '" + assetId + "' not found.");
		}
		if (asset->meta.atlassed) {
			throw vdpFault("skybox image '" + assetId + "' must not be atlassed.");
		}
		if (!asset->rom.start || !asset->rom.end) {
			throw vdpFault("skybox image '" + assetId + "' missing ROM range.");
		}
		const i32 start = *asset->rom.start;
		const i32 end = *asset->rom.end;
		if (end <= start) {
			throw vdpFault("skybox image '" + assetId + "' has invalid ROM range.");
		}
		uint32_t base = CART_ROM_BASE;
			if (asset->rom.payloadId.has_value()) {
				const auto& payload = *asset->rom.payloadId;
				bool found = false;
				for (const auto& entry : SKYBOX_PAYLOAD_BASES) {
					if (payload == entry.payload) {
						base = entry.base;
						found = true;
						break;
					}
				}
				if (!found) {
					throw vdpFault("skybox image '" + assetId + "' has unsupported payload_id " + payload + ".");
				}
			}
		const size_t len = static_cast<size_t>(end - start);
		std::vector<u8> buffer(len);
		m_memory.readBytes(base + static_cast<uint32_t>(start), buffer.data(), len);
		auto& slot = m_skyboxSlots[index];
		m_imgDecController->decodeToVram(std::move(buffer), slot.baseAddr, slot.capacity,
			[asset](uint32_t width, uint32_t height, bool clipped) {
				(void)clipped;
				if (asset->meta.width <= 0) {
					asset->meta.width = static_cast<i32>(width);
				}
				if (asset->meta.height <= 0) {
					asset->meta.height = static_cast<i32>(height);
				}
			});
	}
}

void VDP::commitLiveVisualState() {
	m_committedDitherType = m_lastDitherType;
	m_committedSlotAtlasIds = m_slotAtlasIds;
	if (!m_hasSkybox) {
		m_committedHasSkybox = false;
		return;
	}
	commitSkyboxImages(m_skyboxFaceIds);
	m_committedSkyboxFaceIds = m_skyboxFaceIds;
	m_committedHasSkybox = true;
}

uint32_t VDP::readVdpStatus() {
	uint32_t status = 0;
	if (m_readBudgetBytes >= 4u) {
		status |= VDP_RD_STATUS_READY;
	}
	if (m_readOverflow) {
		status |= VDP_RD_STATUS_OVERFLOW;
	}
	return status;
}

Value VDP::readVdpStatusThunk(void* context, uint32_t) {
	return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpStatus()));
}

uint32_t VDP::readVdpData() {
	const uint32_t surfaceId = m_memory.readIoU32(IO_VDP_RD_SURFACE);
	const uint32_t x = m_memory.readIoU32(IO_VDP_RD_X);
	const uint32_t y = m_memory.readIoU32(IO_VDP_RD_Y);
	const uint32_t mode = m_memory.readIoU32(IO_VDP_RD_MODE);
	if (mode != VDP_RD_MODE_RGBA8888) {
		throw vdpFault("unsupported VDP read mode.");
	}
	const auto& surface = getReadSurface(surfaceId);
	auto& entry = m_memory.getAssetEntry(surface.assetId);
	const uint32_t width = entry.regionW;
	const uint32_t height = entry.regionH;
	if (x >= width || y >= height) {
		throw vdpFault("VDP read out of bounds.");
	}
	if (m_readBudgetBytes < 4u) {
		m_readOverflow = true;
		return 0u;
	}
	auto& cache = getReadCache(surfaceId, surface, x, y);
	const uint32_t localX = x - cache.x0;
	const size_t byteIndex = static_cast<size_t>(localX) * 4u;
	const u32 r = cache.data[byteIndex + 0];
	const u32 g = cache.data[byteIndex + 1];
	const u32 b = cache.data[byteIndex + 2];
	const u32 a = cache.data[byteIndex + 3];
	m_readBudgetBytes -= 4u;
	uint32_t nextX = x + 1u;
	uint32_t nextY = y;
	if (nextX >= width) {
		nextX = 0u;
		nextY = y + 1u;
	}
	m_memory.writeValue(IO_VDP_RD_X, valueNumber(static_cast<double>(nextX)));
	m_memory.writeValue(IO_VDP_RD_Y, valueNumber(static_cast<double>(nextY)));
	return (r | (g << 8u) | (b << 16u) | (a << 24u));
}

Value VDP::readVdpDataThunk(void* context, uint32_t) {
	return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpData()));
}

void VDP::initializeRegisters() {
	const i32 dither = 0;
	const auto& frameBufferSurface = m_readSurfaces[VDP_RD_SURFACE_FRAMEBUFFER];
	if (!frameBufferSurface.assetId.empty()) {
		const auto& entry = m_memory.getAssetEntry(frameBufferSurface.assetId);
		m_frameBufferWidth = entry.regionW;
		m_frameBufferHeight = entry.regionH;
	} else {
		auto* view = EngineCore::instance().view();
		m_frameBufferWidth = static_cast<uint32_t>(view->viewportSize.x);
		m_frameBufferHeight = static_cast<uint32_t>(view->viewportSize.y);
	}
	resetBuildFrameState();
	clearActiveFrame();
	recycleBlitterBuffers(m_pendingBlitterQueue);
	m_pendingBlitterQueue.clear();
	m_pendingFrameOccupied = false;
	m_pendingFrameCost = 0;
	m_pendingDitherType = 0;
	m_pendingSlotAtlasIds = {{-1, -1}};
	m_pendingSkyboxFaceIds = {};
	m_pendingHasSkybox = false;
	m_slotAtlasIds = {{-1, -1}};
	resetIngressState();
	resetStatus();
	m_memory.writeIoValue(IO_VDP_PRIMARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeIoValue(IO_VDP_SECONDARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeIoValue(IO_VDP_RD_SURFACE, valueNumber(static_cast<double>(VDP_RD_SURFACE_ENGINE)));
	m_memory.writeIoValue(IO_VDP_RD_X, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_Y, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_MODE, valueNumber(static_cast<double>(VDP_RD_MODE_RGBA8888)));
	m_memory.writeIoValue(IO_VDP_DITHER, valueNumber(static_cast<double>(dither)));
	m_memory.writeIoValue(IO_VDP_CMD, valueNumber(0.0));
	for (int index = 0; index < IO_VDP_CMD_ARG_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_CMD_ARG0 + static_cast<uint32_t>(index) * IO_WORD_SIZE, valueNumber(0.0));
	}
	m_lastDitherType = dither;
	m_committedDitherType = dither;
	m_skyboxFaceIds = {};
	m_hasSkybox = false;
	m_committedSkyboxFaceIds = {};
	m_committedHasSkybox = false;
	m_committedSlotAtlasIds = m_slotAtlasIds;
	m_lastFrameCommitted = true;
	m_lastFrameCost = 0;
	m_lastFrameHeld = false;
	if (EngineCore::instance().texmanager()->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY)) {
		syncRenderFrameBufferToDisplayPage();
	}
	commitViewSnapshot(*EngineCore::instance().view());
}

void VDP::syncRegisters() {
	const i32 dither = m_memory.readIoI32(IO_VDP_DITHER);
	if (dither != m_lastDitherType) {
		m_lastDitherType = dither;
	}
	const uint32_t primaryRaw = m_memory.readIoU32(IO_VDP_PRIMARY_ATLAS_ID);
	const uint32_t secondaryRaw = m_memory.readIoU32(IO_VDP_SECONDARY_ATLAS_ID);
	const i32 primary = primaryRaw == VDP_ATLAS_ID_NONE ? -1 : static_cast<i32>(primaryRaw);
	const i32 secondary = secondaryRaw == VDP_ATLAS_ID_NONE ? -1 : static_cast<i32>(secondaryRaw);
	if (primary != m_slotAtlasIds[0] || secondary != m_slotAtlasIds[1]) {
		applyAtlasSlotMapping(primary, secondary);
	}
}

void VDP::setDitherType(i32 type) {
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(type)));
	syncRegisters();
}

void VDP::registerImageAssets(RuntimeAssets& assets, bool keepDecodedData) {
	m_atlasResourceById.clear();
	m_atlasViewIdsById.clear();
	m_atlasSlotById.clear();
	m_slotAtlasIds = {{-1, -1}};
	m_vramSlots.clear();
	m_imgDecController->clearExternalSlots();
	m_readSurfaces = {};
	for (auto& cache : m_readCaches) {
		cache.width = 0;
		cache.data.clear();
	}
	resetBuildFrameState();
	clearActiveFrame();
	recycleBlitterBuffers(m_pendingBlitterQueue);
	m_pendingBlitterQueue.clear();
	m_pendingFrameOccupied = false;
	m_pendingFrameCost = 0;
	m_pendingDitherType = 0;
	m_pendingSlotAtlasIds = {{-1, -1}};
	m_pendingSkyboxFaceIds = {};
	m_pendingHasSkybox = false;
	m_skyboxFaceIds = {};
	m_hasSkybox = false;
	m_committedSkyboxFaceIds = {};
	m_committedHasSkybox = false;
	m_committedSlotAtlasIds = {{-1, -1}};
	m_committedDitherType = m_lastDitherType;
	m_vramBootSeed = nextVramBootSeed();
	seedVramStaging();
	initializeFrameBufferSurface();

	std::vector<std::string> viewAssets;
	viewAssets.reserve(assets.img.size());
	std::unordered_set<std::string> viewAssetIds;
	viewAssetIds.reserve(EngineCore::instance().systemAssets().img.size() + assets.img.size());
	std::unordered_map<std::string, ImgAsset*> viewAssetById;
	viewAssetById.reserve(EngineCore::instance().systemAssets().img.size() + assets.img.size());

	const std::string engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	RuntimeAssets& systemAssets = EngineCore::instance().systemAssets();
	ImgAsset* engineAtlasAsset = systemAssets.getImg(engineAtlasName);
	ensureDecodedPixels(*engineAtlasAsset);

	for (auto& entry : systemAssets.img) {
		auto& imgAsset = entry.second;
		if (!imgAsset.meta.atlassed || imgAsset.meta.atlasid != ENGINE_ATLAS_INDEX) {
			continue;
		}
		if (viewAssetIds.insert(imgAsset.id).second) {
			viewAssets.push_back(imgAsset.id);
		}
		viewAssetById[imgAsset.id] = &imgAsset;
	}

	for (auto& entry : assets.img) {
		auto& imgAsset = entry.second;
		const std::string& id = imgAsset.id;
		if (imgAsset.meta.atlassed) {
			if (viewAssetIds.insert(id).second) {
				viewAssets.push_back(id);
			}
			viewAssetById[id] = &imgAsset;
			continue;
		}
		if (id == engineAtlasName) {
			continue;
		}
		if (!isAtlasName(id)) {
			continue;
		}
		const i32 atlasId = imgAsset.meta.atlasid;
		m_atlasResourceById[atlasId] = id;
	}

	if (engineAtlasAsset->meta.width <= 0 || engineAtlasAsset->meta.height <= 0) {
		throw vdpFault("engine atlas missing dimensions.");
	}
	auto setAtlasEntryDimensions = [](Memory::AssetEntry& slotEntry, uint32_t width, uint32_t height) {
		const uint32_t size = width * height * 4u;
		if (size > slotEntry.capacity) {
			throw vdpFault("atlas entry '" + slotEntry.id + "' exceeds capacity.");
		}
		slotEntry.baseSize = size;
		slotEntry.baseStride = width * 4u;
		slotEntry.regionX = 0;
		slotEntry.regionY = 0;
		slotEntry.regionW = width;
		slotEntry.regionH = height;
	};
	auto seedAtlasSlot = [&](Memory::AssetEntry& slotEntry) {
		const double maxPixels = static_cast<double>(slotEntry.capacity) / 4.0;
		const uint32_t side = static_cast<uint32_t>(std::floor(std::sqrt(maxPixels)));
		setAtlasEntryDimensions(slotEntry, side, side);
	};
	if (!m_memory.hasAsset(engineAtlasName)) {
		m_memory.registerImageSlotAt(
			engineAtlasName,
			VRAM_SYSTEM_ATLAS_BASE,
			VRAM_SYSTEM_ATLAS_SIZE,
			0,
			false
		);
	}
	auto& engineEntry = m_memory.getAssetEntry(engineAtlasName);
	setAtlasEntryDimensions(engineEntry, static_cast<uint32_t>(engineAtlasAsset->meta.width), static_cast<uint32_t>(engineAtlasAsset->meta.height));
	registerVramSlot(engineEntry, ENGINE_ATLAS_TEXTURE_KEY, VDP_RD_SURFACE_ENGINE);

	for (size_t index = 0; index < m_skyboxSlots.size(); ++index) {
		auto& slot = m_skyboxSlots[index];
		slot.baseAddr = skyboxFaceBaseByIndex(index);
		slot.capacity = VRAM_SKYBOX_FACE_BYTES;
		slot.baseSize = 0;
		slot.baseStride = 0;
		slot.regionX = 0;
		slot.regionY = 0;
		slot.regionW = 0;
		slot.regionH = 0;
		m_imgDecController->registerExternalSlot(slot.baseAddr, &slot);
		VramSlot vramSlot;
		vramSlot.kind = VramSlotKind::Skybox;
		vramSlot.baseAddr = slot.baseAddr;
		vramSlot.capacity = slot.capacity;
		m_vramSlots.push_back(std::move(vramSlot));
	}

	if (!m_memory.hasAsset(ATLAS_PRIMARY_SLOT_ID)) {
		m_memory.registerImageSlotAt(
			ATLAS_PRIMARY_SLOT_ID,
			VRAM_PRIMARY_ATLAS_BASE,
			VRAM_PRIMARY_ATLAS_SIZE,
			0,
			false
		);
	}
	auto& primarySlotEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	seedAtlasSlot(primarySlotEntry);
	if (!m_memory.hasAsset(ATLAS_SECONDARY_SLOT_ID)) {
		m_memory.registerImageSlotAt(
			ATLAS_SECONDARY_SLOT_ID,
			VRAM_SECONDARY_ATLAS_BASE,
			VRAM_SECONDARY_ATLAS_SIZE,
			0,
			false
		);
	}
	auto& secondarySlotEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	seedAtlasSlot(secondarySlotEntry);
	registerVramSlot(primarySlotEntry, ATLAS_PRIMARY_SLOT_ID, VDP_RD_SURFACE_PRIMARY);
	registerVramSlot(secondarySlotEntry, ATLAS_SECONDARY_SLOT_ID, VDP_RD_SURFACE_SECONDARY);

	std::sort(viewAssets.begin(), viewAssets.end());
	for (const auto& id : viewAssets) {
		const auto viewAssetIt = viewAssetById.find(id);
		if (viewAssetIt == viewAssetById.end()) {
			throw vdpFault("image asset '" + id + "' not found.");
		}
		ImgAsset* imgAsset = viewAssetIt->second;
		if (!imgAsset->meta.atlassed) {
			throw vdpFault("image asset '" + id + "' expected to be atlassed.");
		}
		const i32 atlasId = imgAsset->meta.atlasid;
		const auto& tc = imgAsset->meta.texcoords;
		const f32 minU = std::min({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 maxU = std::max({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 minV = std::min({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		const f32 maxV = std::max({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		const Memory::AssetEntry* baseEntry = nullptr;
		std::string baseEntryId;
		i32 atlasWidth = 0;
		i32 atlasHeight = 0;
		if (atlasId == ENGINE_ATLAS_INDEX) {
			baseEntryId = engineAtlasName;
			atlasWidth = engineAtlasAsset->meta.width;
			atlasHeight = engineAtlasAsset->meta.height;
		} else {
			const auto atlasNameIt = m_atlasResourceById.find(atlasId);
			if (atlasNameIt == m_atlasResourceById.end()) {
				throw vdpFault("atlas " + std::to_string(atlasId) + " missing for image '" + id + "'.");
			}
			const auto* atlasAsset = assets.getImg(atlasNameIt->second);
			atlasWidth = atlasAsset->meta.width;
			atlasHeight = atlasAsset->meta.height;
			baseEntryId = ATLAS_PRIMARY_SLOT_ID;
			const auto slotIt = m_atlasSlotById.find(atlasId);
			if (slotIt != m_atlasSlotById.end()) {
				baseEntryId = slotIt->second == 1 ? ATLAS_SECONDARY_SLOT_ID : ATLAS_PRIMARY_SLOT_ID;
			}
		}
		baseEntry = &m_memory.getAssetEntry(baseEntryId);
		// Texcoords are stored as float32, so round back to the source texel grid.
		const i32 offsetX = static_cast<i32>(std::round(minU * static_cast<f32>(atlasWidth)));
		const i32 offsetY = static_cast<i32>(std::round(minV * static_cast<f32>(atlasHeight)));
		const i32 regionW = std::max(1, std::min(atlasWidth - offsetX,
			static_cast<i32>(std::round((maxU - minU) * static_cast<f32>(atlasWidth)))));
		const i32 regionH = std::max(1, std::min(atlasHeight - offsetY,
			static_cast<i32>(std::round((maxV - minV) * static_cast<f32>(atlasHeight)))));
		if (!m_memory.hasAsset(id)) {
			m_memory.registerImageView(
				id,
				*baseEntry,
				static_cast<uint32_t>(offsetX),
				static_cast<uint32_t>(offsetY),
				static_cast<uint32_t>(regionW),
				static_cast<uint32_t>(regionH),
				0
			);
		} else {
			auto& viewEntry = m_memory.getAssetEntry(id);
			m_memory.updateImageView(
				viewEntry,
				*baseEntry,
				static_cast<uint32_t>(offsetX),
				static_cast<uint32_t>(offsetY),
				static_cast<uint32_t>(regionW),
				static_cast<uint32_t>(regionH),
				0
			);
		}
		m_atlasViewIdsById[atlasId].push_back(id);
	}

	syncRegisters();
	commitViewSnapshot(*EngineCore::instance().view());

	if (!keepDecodedData) {
		for (auto& entry : assets.img) {
			auto& imgAsset = entry.second;
			const std::string& id = imgAsset.id;
			if (id == engineAtlasName || isAtlasName(id)) {
				continue;
			}
			if (!imgAsset.pixels.empty()) {
				std::vector<u8>().swap(imgAsset.pixels);
			}
		}
	}
}

void VDP::restoreVramSlotTextures() {
	const auto& frameBufferEntry = m_memory.getAssetEntry(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	restoreVramSlotTexture(frameBufferEntry, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	ensureDisplayFrameBufferTexture();
	syncRenderFrameBufferToDisplayPage();
	const auto& engineEntry = m_memory.getAssetEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
	restoreVramSlotTexture(engineEntry, ENGINE_ATLAS_TEXTURE_KEY);
	auto* view = EngineCore::instance().view();
	view->loadEngineAtlasTexture();
	const auto& primaryEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	const auto& secondaryEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	restoreVramSlotTexture(primaryEntry, ATLAS_PRIMARY_SLOT_ID);
	restoreVramSlotTexture(secondaryEntry, ATLAS_SECONDARY_SLOT_ID);
}

void VDP::captureVramTextureSnapshots() {
	auto* texmanager = EngineCore::instance().texmanager();
	auto* backend = texmanager->backend();
	for (auto& slot : m_vramSlots) {
		if (slot.kind != VramSlotKind::Asset) {
			continue;
		}
		auto& entry = m_memory.getAssetEntry(slot.assetId);
		const size_t bytes = static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u;
		slot.contextSnapshot.resize(bytes);
		TextureHandle handle = texmanager->getTextureByUri(slot.textureKey);
		backend->readTextureRegion(
			handle,
			slot.contextSnapshot.data(),
			static_cast<i32>(entry.regionW),
			static_cast<i32>(entry.regionH),
			0,
			0,
			{}
		);
	}
}

void VDP::flushAssetEdits() {
	auto* texmanager = EngineCore::instance().texmanager();
	auto* backend = texmanager->backend();
	if (!backend->readyForTextureUpload()) {
		return;
	}
	auto* view = EngineCore::instance().view();
	auto dirty = m_memory.consumeDirtyAssets();
	if (dirty.empty()) {
		return;
	}
	const std::string engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	for (const auto* entry : dirty) {
		if (entry->type == Memory::AssetType::Image) {
			const uint32_t span = entry->capacity > 0 ? entry->capacity : 1u;
			if (m_memory.isVramRange(entry->baseAddr, span)) {
				continue;
			}
			const u8* pixels = m_memory.getImagePixels(*entry);
			const i32 width = static_cast<i32>(entry->regionW);
			const i32 height = static_cast<i32>(entry->regionH);
			const bool isEngineAtlas = entry->id == engineAtlasName;
			const bool isAtlasSlot = (entry->id == ATLAS_PRIMARY_SLOT_ID || entry->id == ATLAS_SECONDARY_SLOT_ID);
			const std::string& textureKey = isEngineAtlas ? ENGINE_ATLAS_TEXTURE_KEY : entry->id;
			if (isAtlasSlot || isEngineAtlas) {
				TextureParams params;
				const TextureKey key = texmanager->makeKey(textureKey, params);
				TextureHandle handle = texmanager->getTexture(key);
				if (!handle) {
					handle = texmanager->getOrCreateTexture(key, pixels, width, height, params);
				} else {
					texmanager->updateTexture(handle, pixels, width, height, params);
				}
				view->textures[textureKey] = handle;
				if (isEngineAtlas) {
					ImgAsset* engineAsset = EngineCore::instance().systemAssets().getImg(engineAtlasName);
					engineAsset->textureHandle = reinterpret_cast<uintptr_t>(handle);
					engineAsset->uploaded = true;
				}
			} else {
				texmanager->updateTexturesForAsset(textureKey, pixels, width, height);
			}
		}
	}
}

uint32_t VDP::trackedUsedVramBytes() const {
	uint32_t usedBytes = 0;
	for (const auto& slot : m_vramSlots) {
		if (slot.kind == VramSlotKind::Skybox) {
			continue;
		}
		const auto& entry = m_memory.getAssetEntry(slot.assetId);
		usedBytes += entry.baseSize;
	}
	return usedBytes;
}

uint32_t VDP::trackedTotalVramBytes() const {
	return VRAM_SYSTEM_ATLAS_SIZE + VRAM_PRIMARY_ATLAS_SIZE + VRAM_SECONDARY_ATLAS_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
}

void VDP::applyAtlasSlotMapping(i32 primaryAtlasId, i32 secondaryAtlasId) {
	auto configureSlotEntry = [this](Memory::AssetEntry& slotEntry, i32 atlasId) {
		if (atlasId < 0) {
			const uint32_t maxPixels = slotEntry.capacity / 4u;
			const uint32_t side = static_cast<uint32_t>(std::floor(std::sqrt(static_cast<double>(maxPixels))));
			slotEntry.baseSize = side * side * 4u;
			slotEntry.baseStride = side * 4u;
			slotEntry.regionX = 0u;
			slotEntry.regionY = 0u;
			slotEntry.regionW = side;
			slotEntry.regionH = side;
			return;
		}
		const auto atlasIt = m_atlasResourceById.find(atlasId);
		if (atlasIt == m_atlasResourceById.end()) {
			throw vdpFault("atlas " + std::to_string(atlasId) + " not registered.");
		}
		ImgAsset* atlasAsset = EngineCore::instance().resolveImgAsset(atlasIt->second);
		const uint32_t width = static_cast<uint32_t>(atlasAsset->meta.width);
		const uint32_t height = static_cast<uint32_t>(atlasAsset->meta.height);
		const uint32_t size = width * height * 4u;
		if (size > slotEntry.capacity) {
			throw vdpFault("atlas " + std::to_string(atlasId) + " exceeds slot capacity.");
		}
		slotEntry.baseSize = size;
		slotEntry.baseStride = width * 4u;
		slotEntry.regionX = 0u;
		slotEntry.regionY = 0u;
		slotEntry.regionW = width;
		slotEntry.regionH = height;
	};
	auto& primaryEntryForMetrics = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	auto& secondaryEntryForMetrics = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	configureSlotEntry(primaryEntryForMetrics, primaryAtlasId);
	configureSlotEntry(secondaryEntryForMetrics, secondaryAtlasId);
	m_atlasSlotById.clear();
	m_slotAtlasIds[0] = primaryAtlasId;
	m_slotAtlasIds[1] = secondaryAtlasId;
	if (primaryAtlasId >= 0) {
		m_atlasSlotById[primaryAtlasId] = 0;
	}
	if (secondaryAtlasId >= 0) {
		m_atlasSlotById[secondaryAtlasId] = 1;
	}
	auto& primaryEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	auto& secondaryEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	if (primaryAtlasId >= 0) {
		const auto viewIt = m_atlasViewIdsById.find(primaryAtlasId);
		if (viewIt != m_atlasViewIdsById.end()) {
			for (const auto& viewId : viewIt->second) {
				auto& viewEntry = m_memory.getAssetEntry(viewId);
				m_memory.updateImageViewBase(viewEntry, primaryEntry);
			}
		}
	}
	if (secondaryAtlasId >= 0) {
		const auto viewIt = m_atlasViewIdsById.find(secondaryAtlasId);
		if (viewIt != m_atlasViewIdsById.end()) {
			for (const auto& viewId : viewIt->second) {
				auto& viewEntry = m_memory.getAssetEntry(viewId);
				m_memory.updateImageViewBase(viewEntry, secondaryEntry);
			}
		}
	}
	auto* backend = EngineCore::instance().view()->backend();
	if (backend->readyForTextureUpload()) {
		syncVramSlotTextureSize(getVramSlotByTextureKey(ATLAS_PRIMARY_SLOT_ID));
		syncVramSlotTextureSize(getVramSlotByTextureKey(ATLAS_SECONDARY_SLOT_ID));
	}
}

void VDP::attachImgDecController(ImgDecController& controller) {
	m_imgDecController = &controller;
}

void VDP::setSkyboxImages(const SkyboxImageIds& ids) {
	const std::array<const std::string*, 6> faces = {{&ids.posx, &ids.negx, &ids.posy, &ids.negy, &ids.posz, &ids.negz}};
	for (size_t index = 0; index < faces.size(); ++index) {
		const std::string& assetId = *faces[index];
		auto* asset = EngineCore::instance().resolveImgAsset(assetId);
		if (!asset) {
			throw vdpFault("skybox image '" + assetId + "' not found.");
		}
		if (asset->meta.atlassed) {
			throw vdpFault("skybox image '" + assetId + "' must not be atlassed.");
		}
		if (!asset->rom.start || !asset->rom.end) {
			throw vdpFault("skybox image '" + assetId + "' missing ROM range.");
		}
	}
	m_skyboxFaceIds = ids;
	m_hasSkybox = true;
}

void VDP::clearSkybox() {
	m_skyboxFaceIds = {};
	m_hasSkybox = false;
}

VdpState VDP::captureState() const {
	VdpState state;
	state.atlasSlots = m_slotAtlasIds;
	if (m_hasSkybox) {
		state.skyboxFaceIds = m_skyboxFaceIds;
	}
	state.ditherType = m_lastDitherType;
	return state;
}

void VDP::restoreState(const VdpState& state) {
	m_memory.writeValue(IO_VDP_PRIMARY_ATLAS_ID, valueNumber(static_cast<double>(state.atlasSlots[0] < 0 ? VDP_ATLAS_ID_NONE : state.atlasSlots[0])));
	m_memory.writeValue(IO_VDP_SECONDARY_ATLAS_ID, valueNumber(static_cast<double>(state.atlasSlots[1] < 0 ? VDP_ATLAS_ID_NONE : state.atlasSlots[1])));
	applyAtlasSlotMapping(state.atlasSlots[0], state.atlasSlots[1]);
	if (state.skyboxFaceIds.has_value()) {
		setSkyboxImages(*state.skyboxFaceIds);
	} else {
		clearSkybox();
	}
	setDitherType(state.ditherType);
	commitLiveVisualState();
	commitViewSnapshot(*EngineCore::instance().view());
}

void VDP::registerVramSlot(const Memory::AssetEntry& entry, const std::string& textureKey, uint32_t surfaceId) {
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->getTextureByUri(textureKey);
	const bool isEngineAtlas = textureKey == ENGINE_ATLAS_TEXTURE_KEY;
	if (!handle) {
		auto* backend = texmanager->backend();
		if (backend->readyForTextureUpload()) {
			VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
			fillVramGarbageScratch(m_vramSeedPixel.data(), m_vramSeedPixel.size(), stream);
			TextureParams params;
			const TextureKey key = texmanager->makeKey(textureKey, params);
			handle = texmanager->getOrCreateTexture(
				key,
				m_vramSeedPixel.data(),
				1,
				1,
				params
			);
		}
	}
	auto* view = EngineCore::instance().view();
	if (handle) {
		handle = texmanager->resizeTextureForKey(textureKey, static_cast<i32>(entry.regionW), static_cast<i32>(entry.regionH));
		view->textures[textureKey] = handle;
	} else {
		view->textures[textureKey] = nullptr;
	}
	VramSlot slot;
	slot.kind = VramSlotKind::Asset;
	slot.baseAddr = entry.baseAddr;
	slot.capacity = entry.capacity;
	slot.assetId = entry.id;
	slot.textureKey = textureKey;
	slot.surfaceId = surfaceId;
	slot.textureWidth = entry.regionW;
	slot.textureHeight = entry.regionH;
	slot.cpuReadback.resize(static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u);
	m_vramSlots.push_back(std::move(slot));
	registerReadSurface(surfaceId, entry.id, textureKey);
	if (isEngineAtlas) {
		auto& engineSlot = m_vramSlots.back();
		ImgAsset* engineAsset = EngineCore::instance().systemAssets().getImg(generateAtlasName(ENGINE_ATLAS_INDEX));
		const size_t expectedBytes = static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u;
		if (engineAsset->pixels.size() != expectedBytes) {
			throw vdpFault("engine atlas pixel buffer size mismatch.");
		}
		engineSlot.cpuReadback.assign(engineAsset->pixels.begin(), engineAsset->pixels.end());
		if (handle) {
			TextureParams params;
			texmanager->updateTexture(
				handle,
				engineSlot.cpuReadback.data(),
				static_cast<i32>(entry.regionW),
				static_cast<i32>(entry.regionH),
				params
			);
		}
		invalidateReadCache(surfaceId);
		return;
	}
	if (handle) {
		seedVramSlotTexture(m_vramSlots.back());
	}
}

VDP::VramSlot& VDP::findVramSlot(uint32_t addr, size_t length) {
	for (auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return slot;
		}
	}
	throw vdpFault("VRAM write has no mapped slot.");
}

const VDP::VramSlot& VDP::findVramSlot(uint32_t addr, size_t length) const {
	for (const auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return slot;
		}
	}
	throw vdpFault("VRAM write has no mapped slot.");
}

void VDP::syncVramSlotTextureSize(VramSlot& slot) {
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	const uint32_t width = entry.regionW;
	const uint32_t height = entry.regionH;
	if (slot.textureWidth == width && slot.textureHeight == height) {
		return;
	}
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->resizeTextureForKey(slot.textureKey,
		static_cast<i32>(width),
		static_cast<i32>(height));
	EngineCore::instance().view()->textures[slot.textureKey] = handle;
	slot.textureWidth = width;
	slot.textureHeight = height;
	slot.cpuReadback.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	invalidateReadCache(slot.surfaceId);
	seedVramSlotTexture(slot);
}

VDP::VramSlot& VDP::getVramSlotByTextureKey(const std::string& textureKey) {
	for (auto& slot : m_vramSlots) {
		if (slot.textureKey == textureKey) {
			return slot;
		}
	}
	throw vdpFault("VRAM slot not registered for texture '" + textureKey + "'.");
}

const VDP::VramSlot& VDP::getVramSlotByTextureKey(const std::string& textureKey) const {
	for (const auto& slot : m_vramSlots) {
		if (slot.textureKey == textureKey) {
			return slot;
		}
	}
	throw vdpFault("VRAM slot not registered for texture '" + textureKey + "'.");
}

uint32_t VDP::nextVramMachineSeed() const {
	const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
	const uint64_t mixed = static_cast<uint64_t>(now) ^ static_cast<uint64_t>(reinterpret_cast<uintptr_t>(this));
	return static_cast<uint32_t>(mixed ^ (mixed >> 32));
}

uint32_t VDP::nextVramBootSeed() const {
	static uint32_t counter = 0;
	counter += 1;
	const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
	const uint64_t mixed = static_cast<uint64_t>(now)
		^ static_cast<uint64_t>(reinterpret_cast<uintptr_t>(this))
		^ (static_cast<uint64_t>(counter) << 1u);
	return static_cast<uint32_t>(mixed ^ (mixed >> 32) ^ (mixed >> 17));
}

void VDP::fillVramGarbageScratch(u8* buffer, size_t length, VramGarbageStream& s) const {
	const size_t total = length;
	const uint32_t startAddr = s.addr;

	const uint32_t biasSeed = s.machineSeed ^ s.slotSalt;
	const uint32_t bootSeedMix = s.bootSeed ^ s.slotSalt;
	const uint32_t vramBytes = (VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) - VRAM_STAGING_BASE;
	const BiasConfig biasConfig = makeBiasConfig(vramBytes);

	const size_t BLOCK_BYTES = 32u;
	const uint32_t BLOCK_SHIFT = 5u;

	size_t out = 0;
	const bool aligned4 = (((startAddr | static_cast<uint32_t>(total)) & 3u) == 0u);

	while (out < total) {
		const uint32_t addr = startAddr + static_cast<uint32_t>(out);
		const uint32_t blockIndex = addr >> BLOCK_SHIFT;
		const uint32_t blockBase = blockIndex << BLOCK_SHIFT;

		const uint32_t startOff = addr - blockBase;
		const size_t maxBytesThisBlock = std::min<size_t>(BLOCK_BYTES - startOff, total - out);

		BlockGen gen = initBlockGen(biasSeed, bootSeedMix, blockIndex, biasConfig);

		if (aligned4 && startOff == 0u && maxBytesThisBlock == BLOCK_BYTES) {
			for (uint32_t w = 0; w < 8u; ++w) {
				const uint32_t word = nextWord(gen);
				const size_t p = out + (static_cast<size_t>(w) << 2u);
				buffer[p] = static_cast<u8>(word & 0xFFu);
				buffer[p + 1] = static_cast<u8>((word >> 8u) & 0xFFu);
				buffer[p + 2] = static_cast<u8>((word >> 16u) & 0xFFu);
				buffer[p + 3] = static_cast<u8>((word >> 24u) & 0xFFu);
			}
		} else {
			const uint32_t rangeStart = startOff;
			const uint32_t rangeEnd = startOff + static_cast<uint32_t>(maxBytesThisBlock);

			for (uint32_t w = 0; w < 8u; ++w) {
				const uint32_t word = nextWord(gen);
				const uint32_t wordByteStart = w << 2u;
				const uint32_t wordByteEnd = wordByteStart + 4u;
				const uint32_t a0 = std::max<uint32_t>(wordByteStart, rangeStart);
				const uint32_t a1 = std::min<uint32_t>(wordByteEnd, rangeEnd);
				if (a0 >= a1) {
					continue;
				}
				uint32_t tmp = word >> ((a0 - wordByteStart) << 3u);
				for (uint32_t k = a0; k < a1; ++k) {
					buffer[out + static_cast<size_t>(k - rangeStart)] = static_cast<u8>(tmp & 0xFFu);
					tmp >>= 8u;
				}
			}
		}

		out += maxBytesThisBlock;
	}

	s.addr = startAddr + static_cast<uint32_t>(total);
}

void VDP::seedVramStaging() {
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, VRAM_STAGING_BASE};
	fillVramGarbageScratch(m_vramStaging.data(), m_vramStaging.size(), stream);
}

void VDP::seedVramSlotTexture(VramSlot& slot) {
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	auto* texmanager = EngineCore::instance().texmanager();
	const size_t rowPixels = static_cast<size_t>(entry.regionW);
	const size_t maxPixels = m_vramGarbageScratch.size() / 4u;
	slot.cpuReadback.resize(static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u);
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
	const size_t rowBytes = rowPixels * 4u;
	const uint32_t height = entry.regionH;
	if (rowBytes <= m_vramGarbageScratch.size()) {
		const size_t rowsPerChunk = std::max<size_t>(1u, m_vramGarbageScratch.size() / rowBytes);
		for (uint32_t y = 0; y < height; ) {
			const size_t rows = std::min<size_t>(rowsPerChunk, height - y);
			const size_t chunkBytes = rowBytes * rows;
			fillVramGarbageScratch(m_vramGarbageScratch.data(), chunkBytes, stream);
			texmanager->updateTextureRegionForKey(
				slot.textureKey,
				m_vramGarbageScratch.data(),
				static_cast<i32>(rowPixels),
				static_cast<i32>(rows),
				0,
				static_cast<i32>(y)
			);
			std::memcpy(slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes, m_vramGarbageScratch.data(), chunkBytes);
			y += static_cast<uint32_t>(rows);
		}
	} else {
		for (uint32_t y = 0; y < height; ++y) {
			for (uint32_t x = 0; x < entry.regionW; ) {
				const size_t segmentWidth = std::min<size_t>(maxPixels, entry.regionW - x);
				const size_t segmentBytes = segmentWidth * 4u;
				fillVramGarbageScratch(m_vramGarbageScratch.data(), segmentBytes, stream);
				texmanager->updateTextureRegionForKey(
					slot.textureKey,
					m_vramGarbageScratch.data(),
					static_cast<i32>(segmentWidth),
					1,
					static_cast<i32>(x),
					static_cast<i32>(y)
				);
				std::memcpy(
					slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes + static_cast<size_t>(x) * 4u,
					m_vramGarbageScratch.data(),
					segmentBytes
				);
				x += static_cast<uint32_t>(segmentWidth);
			}
		}
	}
	invalidateReadCache(slot.surfaceId);
}

void VDP::restoreVramSlotTexture(const Memory::AssetEntry& entry, const std::string& textureKey) {
	const bool isEngineAtlas = textureKey == ENGINE_ATLAS_TEXTURE_KEY;
	auto* texmanager = EngineCore::instance().texmanager();
	auto* view = EngineCore::instance().view();
	auto& slot = getVramSlotByTextureKey(textureKey);
	const size_t snapshotBytes = static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u;
	const bool restoreSnapshot = slot.contextSnapshot.size() == snapshotBytes;
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
	fillVramGarbageScratch(m_vramSeedPixel.data(), m_vramSeedPixel.size(), stream);
	TextureParams params;
	const TextureKey key = texmanager->makeKey(textureKey, params);
	TextureHandle handle = texmanager->getOrCreateTexture(
		key,
		m_vramSeedPixel.data(),
		1,
		1,
		params
	);
	handle = texmanager->resizeTextureForKey(
		textureKey,
		static_cast<i32>(entry.regionW),
		static_cast<i32>(entry.regionH)
	);
	view->textures[textureKey] = handle;
	setSlotTextureSize(textureKey, entry.regionW, entry.regionH);
	if (restoreSnapshot) {
		texmanager->updateTexture(
			handle,
			slot.contextSnapshot.data(),
			static_cast<i32>(entry.regionW),
			static_cast<i32>(entry.regionH),
			params
		);
		slot.cpuReadback = slot.contextSnapshot;
		slot.contextSnapshot.clear();
		invalidateReadCache(slot.surfaceId);
		return;
	}
	if (isEngineAtlas) {
		ImgAsset* engineAsset = EngineCore::instance().systemAssets().getImg(generateAtlasName(ENGINE_ATLAS_INDEX));
		ensureDecodedPixels(*engineAsset);
		slot.cpuReadback.assign(engineAsset->pixels.begin(), engineAsset->pixels.end());
		texmanager->updateTexture(
			handle,
			slot.cpuReadback.data(),
			static_cast<i32>(entry.regionW),
			static_cast<i32>(entry.regionH),
			params
		);
		invalidateReadCache(slot.surfaceId);
		return;
	}
	if (!isEngineAtlas) {
		seedVramSlotTexture(slot);
	}
}

void VDP::setSlotTextureSize(const std::string& textureKey, uint32_t width, uint32_t height) {
	for (auto& slot : m_vramSlots) {
		if (slot.textureKey == textureKey) {
			slot.textureWidth = width;
			slot.textureHeight = height;
			return;
		}
	}
}

void VDP::registerReadSurface(uint32_t surfaceId, const std::string& assetId, const std::string& textureKey) {
	m_readSurfaces[surfaceId].assetId = assetId;
	m_readSurfaces[surfaceId].textureKey = textureKey;
	invalidateReadCache(surfaceId);
}

const VDP::ReadSurface& VDP::getReadSurface(uint32_t surfaceId) const {
	return m_readSurfaces[surfaceId];
}

void VDP::invalidateReadCache(uint32_t surfaceId) {
	m_readCaches[surfaceId].width = 0;
}

VDP::ReadCache& VDP::getReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y) {
	auto& cache = m_readCaches[surfaceId];
	if (cache.width == 0 || cache.y != y || x < cache.x0 || x >= cache.x0 + cache.width) {
		prefetchReadCache(surfaceId, surface, x, y);
	}
	return cache;
}

void VDP::prefetchReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y) {
	auto& entry = m_memory.getAssetEntry(surface.assetId);
	const uint32_t maxPixelsByBudget = m_readBudgetBytes / 4u;
	if (maxPixelsByBudget == 0) {
		m_readOverflow = true;
		m_readCaches[surfaceId].width = 0;
		return;
	}
	const uint32_t chunkW = std::min(VDP_RD_MAX_CHUNK_PIXELS, std::min(entry.regionW - x, maxPixelsByBudget));
	auto& cache = m_readCaches[surfaceId];
	readSurfacePixels(surface, x, y, chunkW, 1, cache.data);
	cache.x0 = x;
	cache.y = y;
	cache.width = chunkW;
}

void VDP::readSurfacePixels(const ReadSurface& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height, std::vector<u8>& out) {
	auto* texmanager = EngineCore::instance().texmanager();
	out.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	texmanager->backend()->readTextureRegion(texmanager->getTextureByUri(surface.textureKey), out.data(), static_cast<i32>(width), static_cast<i32>(height),
								static_cast<i32>(x), static_cast<i32>(y), {});
}

void VDP::commitViewSnapshot(GameView& view) {
	view.dither_type = static_cast<GameView::DitherType>(m_committedDitherType);
	view.primaryAtlasIdInSlot = m_committedSlotAtlasIds[0];
	view.secondaryAtlasIdInSlot = m_committedSlotAtlasIds[1];
	view.skyboxFaceIds = m_committedHasSkybox ? m_committedSkyboxFaceIds : SkyboxImageIds{};
}

} // namespace bmsx
// @code-quality end hot-path
