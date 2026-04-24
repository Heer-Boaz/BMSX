#include "render/vdp/blitter/gles2.h"

#if BMSX_ENABLE_GLES2
#include "machine/devices/vdp/fault.h"
#include "render/backend/gles2_backend.h"
#include "render/shared/queues.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/slot_textures.h"
#include "render/vdp/surfaces.h"
#include "render/vdp/texture_transfer.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <string>

namespace bmsx {
namespace {

constexpr u8 IMPLICIT_FRAME_CLEAR_RGBA[4] = {0u, 0u, 0u, 255u};
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
	std::vector<const VDP::BlitterCommand*> sortedCommands;
	std::vector<VdpGles2Vertex> vertices;
};

VdpGles2Runtime g_vdpGles2Runtime{};

const TextureParams DEFAULT_TEXTURE_PARAMS{};

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

void initializeVdpGles2Runtime(OpenGLES2Backend* backend) {
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

TextureHandle resizeVdpGles2CopySnapshotTexture(OpenGLES2Backend* backend, i32 width, i32 height) {
	auto& state = g_vdpGles2Runtime;
	if (state.copySnapshotTexture && state.copySnapshotWidth == width && state.copySnapshotHeight == height) {
		return state.copySnapshotTexture;
	}
	if (!state.copySnapshotTexture) {
		state.copySnapshotTexture = backend->createTexture(nullptr, width, height, DEFAULT_TEXTURE_PARAMS);
	} else {
		state.copySnapshotTexture = backend->resizeTexture(state.copySnapshotTexture, width, height, DEFAULT_TEXTURE_PARAMS);
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

// start hot-path -- GLES2 blitter emits per-frame vertex batches directly.
// start numeric-sanitization-acceptable -- GPU vertex generation owns its geometry rounding and bounds math at the raster boundary.
void pushVertex(
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

void appendQuadVertices(
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

// disable-next-line single_line_method_pattern -- axis-aligned quads are the hot common case; this keeps zero-skew arguments out of every callsite.
void appendAxisAlignedQuadVertices(
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

void appendLineQuadVertices(
	std::vector<VdpGles2Vertex>& vertices,
	const VDP::BlitterCommand& command,
	const VDP::FrameBufferColor& color
) {
	const f32 dx = command.x1 - command.x0;
	const f32 dy = command.y1 - command.y0;
	const f32 length = std::hypot(dx, dy);
	if (length == 0.0f) {
		const f32 half = command.thickness * 0.5f;
		appendAxisAlignedQuadVertices(vertices, command.x0 - half, command.y0 - half, command.thickness, command.thickness, 0.0f, 0.0f, 1.0f, 1.0f, VDP_GLES2_PRIMARY_ATLAS_ID, color);
		return;
	}
	const f32 tangentX = dx / length;
	const f32 tangentY = dy / length;
	const f32 normalX = -tangentY;
	const f32 normalY = tangentX;
	const f32 half = command.thickness * 0.5f;
	const f32 originX = command.x0 - tangentX * half - normalX * half;
	const f32 originY = command.y0 - tangentY * half - normalY * half;
	appendQuadVertices(
		vertices,
		originX,
		originY,
		originX + normalX * command.thickness,
		originY + normalY * command.thickness,
		originX + dx + tangentX * command.thickness,
		originY + dy + tangentY * command.thickness,
		originX + dx + tangentX * command.thickness + normalX * command.thickness,
		originY + dy + tangentY * command.thickness + normalY * command.thickness,
		0.0f,
		0.0f,
		1.0f,
		1.0f,
		VDP_GLES2_PRIMARY_ATLAS_ID,
		color
	);
}

void computeBlitParallax(
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

void appendBlitVertices(
	const VdpGles2Host& host,
	std::vector<VdpGles2Vertex>& vertices,
	const VDP::BlitterCommand& command,
	const VDP::BlitterSource& source,
	f32 atlasId,
	const VDP::FrameBufferColor& color
) {
	const auto& surface = host.surfaces[source.surfaceId];
	const f32 dstWidth = static_cast<f32>(source.width) * command.scaleX;
	const f32 dstHeight = static_cast<f32>(source.height) * command.scaleY;
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
	const f32 x0 = command.dstX;
	const f32 y0 = command.dstY;
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

} // namespace

void VdpGles2Blitter::initialize() {
	GPUBackend& backend = vdpTextureBackend();
	if (backend.type() != BackendType::OpenGLES2) {
		return;
	}
	initializeVdpGles2Runtime(static_cast<OpenGLES2Backend*>(&backend));
}

bool VdpGles2Blitter::execute(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue, f64 timeSeconds) {
	using CommandType = VDP::BlitterCommandType;
	GPUBackend& textureBackend = vdpTextureBackend();
	if (textureBackend.type() != BackendType::OpenGLES2) {
		return false;
	}
	syncVdpSlotTextures(vdp);
	auto* backend = static_cast<OpenGLES2Backend*>(&textureBackend);
	applyVdpFrameBufferTextureWrites(vdp);
	VdpGles2Host host;
	host.backend = backend;
	host.renderTexture = vdpRenderFrameBufferTexture();
	host.width = static_cast<i32>(vdp.frameBufferWidth());
	host.height = static_cast<i32>(vdp.frameBufferHeight());
	host.parallaxRig = RenderQueues::spriteParallaxRig;
	host.timeSeconds = timeSeconds;
	auto prepareSurface = [&](uint32_t surfaceId, f32 atlasId) {
		auto& info = host.surfaces[surfaceId];
		info.atlasId = atlasId;
		const auto surface = resolveVdpRenderSurface(vdp, surfaceId);
		info.texture = getVdpRenderSurfaceTexture(surfaceId);
		info.invWidth = 1.0f / static_cast<f32>(surface.width);
		info.invHeight = 1.0f / static_cast<f32>(surface.height);
	};
	prepareSurface(VDP_RD_SURFACE_ENGINE, static_cast<f32>(resolveVdpSurfaceAtlasBinding(VDP_RD_SURFACE_ENGINE)));
	prepareSurface(VDP_RD_SURFACE_PRIMARY, static_cast<f32>(resolveVdpSurfaceAtlasBinding(VDP_RD_SURFACE_PRIMARY)));
	prepareSurface(VDP_RD_SURFACE_SECONDARY, static_cast<f32>(resolveVdpSurfaceAtlasBinding(VDP_RD_SURFACE_SECONDARY)));
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
		auto& sortedCommands = state.sortedCommands;
		sortedCommands.clear();
		for (size_t index = start; index < end; ++index) {
			const auto& command = queue[index];
			if (command.type == CommandType::Clear || command.type == CommandType::CopyRect) {
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
				case CommandType::Blit: {
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
				case CommandType::FillRect: {
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
				case CommandType::DrawLine: {
					bindMode(VdpDrawMode::Solid);
					appendLineQuadVertices(state.vertices, *command, command->color);
					break;
				}
				case CommandType::GlyphRun: {
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
							glyph.dstX,
							glyph.dstY,
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
				case CommandType::TileRun: {
					bindMode(VdpDrawMode::Atlas);
					for (const auto& tile : command->tiles) {
						const auto& surface = host.surfaces[tile.surfaceId];
						const f32 u0 = static_cast<f32>(tile.srcX) * surface.invWidth;
						const f32 v0 = static_cast<f32>(tile.srcY) * surface.invHeight;
						const f32 u1 = static_cast<f32>(tile.srcX + tile.width) * surface.invWidth;
						const f32 v1 = static_cast<f32>(tile.srcY + tile.height) * surface.invHeight;
						appendAxisAlignedQuadVertices(
							state.vertices,
							tile.dstX,
							tile.dstY,
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
				case CommandType::Clear:
				case CommandType::CopyRect:
					break;
			}
		}
		flushVertices();
	};
	auto drawCopyRect = [&](const VDP::BlitterCommand& command) {
		const VDP::FrameBufferColor white{255u, 255u, 255u, 255u};
		TextureHandle snapshot = resizeVdpGles2CopySnapshotTexture(backend, host.width, host.height);
		backend->copyTextureRegion(host.renderTexture, snapshot, command.srcX, command.srcY, command.srcX, command.srcY, command.width, command.height);
		state.vertices.clear();
		state.vertices.reserve(6u);
		appendAxisAlignedQuadVertices(
			state.vertices,
			command.dstX,
			command.dstY,
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
	if (queue.front().type != CommandType::Clear) {
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
		if (command.type == CommandType::Clear) {
			drawSortedSegment(segmentStart, index);
			clearFrame(command.color);
			segmentStart = index + 1u;
			continue;
		}
		if (command.type == CommandType::CopyRect) {
			drawSortedSegment(segmentStart, index);
			drawCopyRect(command);
			segmentStart = index + 1u;
		}
	}
	drawSortedSegment(segmentStart, queue.size());
	syncVdpRenderFrameBufferReadback(vdp);
	return true;
}

// disable-next-line single_line_method_pattern -- public blitter lifecycle hook delegates to the GLES2 runtime storage owner.
void VdpGles2Blitter::shutdown() {
	destroyVdpGles2Runtime();
}

void VdpGles2Blitter::invalidateFrameBufferAttachment() {
	g_vdpGles2Runtime.attachedColorTextureId = 0;
}
// end numeric-sanitization-acceptable
// end hot-path

} // namespace bmsx

#endif
