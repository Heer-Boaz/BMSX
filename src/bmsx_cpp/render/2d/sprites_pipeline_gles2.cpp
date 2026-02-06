/*
 * sprites_pipeline_gles2.cpp - GLES2 sprite pipeline
 */

#include "sprites_pipeline_gles2.h"

#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

#include "../../core/engine_core.h"
#include "../../rompack/rompack.h"
#include "../../utils/clamp.h"
#include "../shared/render_queues.h"

#if defined(__GNUC__)
extern "C" __attribute__((weak)) void glVertexAttribDivisor(GLuint index, GLuint divisor);
extern "C" __attribute__((weak)) void glDrawArraysInstanced(GLenum mode, GLint first, GLsizei count, GLsizei instancecount);
extern "C" __attribute__((weak)) void glVertexAttribDivisorEXT(GLuint index, GLuint divisor);
extern "C" __attribute__((weak)) void glDrawArraysInstancedEXT(GLenum mode, GLint first, GLsizei count, GLsizei instancecount);
extern "C" __attribute__((weak)) void glVertexAttribDivisorANGLE(GLuint index, GLuint divisor);
extern "C" __attribute__((weak)) void glDrawArraysInstancedANGLE(GLenum mode, GLint first, GLsizei count, GLsizei instancecount);
extern "C" __attribute__((weak)) void glGenVertexArraysOES(GLsizei n, GLuint* arrays);
extern "C" __attribute__((weak)) void glBindVertexArrayOES(GLuint array);
extern "C" __attribute__((weak)) void glDeleteVertexArraysOES(GLsizei n, const GLuint* arrays);
#else
extern "C" void glVertexAttribDivisor(GLuint index, GLuint divisor);
extern "C" void glDrawArraysInstanced(GLenum mode, GLint first, GLsizei count, GLsizei instancecount);
extern "C" void glVertexAttribDivisorEXT(GLuint index, GLuint divisor);
extern "C" void glDrawArraysInstancedEXT(GLenum mode, GLint first, GLsizei count, GLsizei instancecount);
extern "C" void glVertexAttribDivisorANGLE(GLuint index, GLuint divisor);
extern "C" void glDrawArraysInstancedANGLE(GLenum mode, GLint first, GLsizei count, GLsizei instancecount);
extern "C" void glGenVertexArraysOES(GLsizei n, GLuint* arrays);
extern "C" void glBindVertexArrayOES(GLuint array);
extern "C" void glDeleteVertexArraysOES(GLsizei n, const GLuint* arrays);
#endif

namespace bmsx {
namespace SpritesPipeline {
namespace {

constexpr bool kSpritesVerboseLog = false;

constexpr int kMaxSprites = 256;
constexpr int kVerticesPerSprite = 6;

constexpr int kInstanceStride = 40;
constexpr int kInstancePosOffset = 0;
constexpr int kInstanceSizeOffset = 8;
constexpr int kInstanceUv0Offset = 16;
constexpr int kInstanceUv1Offset = 24;
constexpr int kInstanceZOffset = 32;
constexpr int kInstanceAtlasOffset = 34;
constexpr int kInstanceFxOffset = 35;
constexpr int kInstanceColorOffset = 36;

constexpr int kExpandedVertexStride = 48;
constexpr int kExpandedCornerOffset = 0;
constexpr int kExpandedPosOffset = 8;
constexpr int kExpandedSizeOffset = 16;
constexpr int kExpandedUv0Offset = 24;
constexpr int kExpandedUv1Offset = 32;
constexpr int kExpandedZOffset = 40;
constexpr int kExpandedAtlasOffset = 42;
constexpr int kExpandedFxOffset = 43;
constexpr int kExpandedColorOffset = 44;

constexpr float kZCoordMax = 10000.0f;
constexpr float kDefaultZ = 0.0f;

constexpr int kTexUnitAtlasPrimary = 0;
constexpr int kTexUnitAtlasSecondary = 1;
constexpr int kTexUnitAtlasEngine = 2;
constexpr int kTexUnitAtlasFallback = 3;
constexpr uint8_t kAtlasFallbackSelector = 255u;

constexpr float kCornerData[12] = {
	0.0f, 0.0f,
	0.0f, 1.0f,
	1.0f, 0.0f,
	1.0f, 0.0f,
	0.0f, 1.0f,
	1.0f, 1.0f
};

using VertexAttribDivisorFn = void (*)(GLuint, GLuint);
using DrawArraysInstancedFn = void (*)(GLenum, GLint, GLsizei, GLsizei);

static_assert(ENGINE_ATLAS_INDEX <= 255, "ENGINE_ATLAS_INDEX must fit in uint8_t sprite atlas selector.");

struct SpriteGLES2State {
	GLuint program = 0;

	GLint attrib_corner = -1;
	GLint attrib_pos = -1;
	GLint attrib_size = -1;
	GLint attrib_uv0 = -1;
	GLint attrib_uv1 = -1;
	GLint attrib_z = -1;
	GLint attrib_atlas = -1;
	GLint attrib_fx = -1;
	GLint attrib_color = -1;

	GLint uniform_resolution = -1;
	GLint uniform_scale = -1;
	GLint uniform_parallax_rig = -1;
	GLint uniform_parallax_rig2 = -1;
	GLint uniform_parallax_flip_window = -1;
	GLint uniform_tex0 = -1;
	GLint uniform_tex1 = -1;
	GLint uniform_tex2 = -1;
	GLint uniform_tex3 = -1;
	GLint uniform_time = -1;

	GLuint corner_vbo = 0;
	GLuint instance_vbo = 0;
	GLuint expanded_vbo = 0;
	GLuint vao = 0;

	bool use_vao = false;
	bool use_instancing = false;

	VertexAttribDivisorFn vertexAttribDivisor = nullptr;
	DrawArraysInstancedFn drawArraysInstanced = nullptr;

	std::vector<uint8_t> instance_data;
	std::vector<uint8_t> expanded_data;
};

SpriteGLES2State g_sprite;

const char* kSpriteVertexShader = R"(
precision mediump float;

attribute vec2 a_corner;
attribute vec2 i_pos;
attribute vec2 i_size;
attribute vec2 i_uv0;
attribute vec2 i_uv1;
attribute float i_z;
attribute float i_atlas_id;
attribute float i_fx;
attribute vec4 i_color_override;

uniform vec2 u_resolution;
uniform float u_scale;
uniform float u_time;
uniform vec4 u_parallax_rig;
uniform vec4 u_parallax_rig2;
uniform float u_parallax_flip_window;

varying vec2 v_texcoord;
varying vec4 v_color_override;
varying float v_atlas_id;

float wobble(float t) {
	return sin(t * 2.2) * 0.5 + sin(t * 1.1 + 1.7) * 0.5;
}

void main() {
	float depth = smoothstep(0.0, 1.0, i_z);
	float dir = sign(i_fx);
	float weight = abs(i_fx) * depth;
	float wob = wobble(u_time);
	float dy_px = (u_parallax_rig2.x + wob * u_parallax_rig.x) * weight * u_parallax_rig2.y * dir;
	float flipWindowSeconds = max(u_parallax_flip_window, 0.0001);
	float hold = 0.2 * flipWindowSeconds;
	float flipU = clamp((u_parallax_rig.w - hold) / max(flipWindowSeconds - hold, 0.0001), 0.0, 1.0);
	float flipWindow = 1.0 - smoothstep(0.0, 1.0, flipU);
	float flip = mix(1.0, -1.0, flipWindow * u_parallax_rig2.w);
	dy_px *= flip;
	float baseScale = 1.0 + (u_parallax_rig.y - 1.0) * weight * u_parallax_rig2.z;
	float impactSign = sign(u_parallax_rig.z);
	float impactMask = max(0.0, dir * impactSign);
	float pulse = exp(-8.0 * u_parallax_rig.w) * abs(u_parallax_rig.z) * weight * impactMask;
	float parallaxScale = baseScale + pulse;

	vec2 center = i_pos + i_size * 0.5;
	vec2 pos = i_pos + a_corner * i_size;
	vec2 parallaxPos = (pos - center) * parallaxScale + center + vec2(0.0, dy_px);
	vec2 scaledPosition = parallaxPos * u_scale;
	vec2 clipSpace = ((scaledPosition / u_resolution) * 2.0 - 1.0) * vec2(1.0, -1.0);

	gl_Position = vec4(clipSpace, i_z, 1.0);
	v_texcoord = mix(i_uv0, i_uv1, a_corner);
	v_color_override = i_color_override;
	v_atlas_id = i_atlas_id;
}
)";

const char* kSpriteFragmentShader = R"(
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform sampler2D u_texture3;

varying vec2 v_texcoord;
varying vec4 v_color_override;
varying float v_atlas_id;

const float ENGINE_ATLAS_ID = 254.0;
const float FALLBACK_ATLAS_ID = 255.0;

void main() {
	vec4 texColor;
	if (abs(v_atlas_id - FALLBACK_ATLAS_ID) < 0.5) {
		texColor = texture2D(u_texture3, v_texcoord);
	} else if (v_atlas_id < 0.5) {
		texColor = texture2D(u_texture0, v_texcoord);
	} else if (abs(v_atlas_id - ENGINE_ATLAS_ID) < 0.5) {
		texColor = texture2D(u_texture2, v_texcoord);
	} else {
		texColor = texture2D(u_texture1, v_texcoord);
	}
	texColor *= v_color_override;

	gl_FragColor = texColor;
}
)";

GLuint compileShader(GLenum type, const char* src) {
	GLuint shader = glCreateShader(type);
	glShaderSource(shader, 1, &src, nullptr);
	glCompileShader(shader);
	GLint status = 0;
	glGetShaderiv(shader, GL_COMPILE_STATUS, &status);
	if (status == GL_FALSE) {
		GLint log_length = 0;
		glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &log_length);
		std::string log;
		if (log_length > 1) {
			std::string log_buffer;
			log_buffer.resize(static_cast<size_t>(log_length));
			GLsizei written = 0;
			glGetShaderInfoLog(shader, log_length, &written, log_buffer.data());
			log.assign(log_buffer.data(), static_cast<size_t>(written));
		}
		EngineCore::instance().log(LogLevel::Error,
								"[BMSX] GLES2 shader compile failed: %s\n",
								log.c_str());
		glDeleteShader(shader);
		throw BMSX_RUNTIME_ERROR(std::string("[BMSX] GLES2 shader compile failed: ") + log);
	}
	return shader;
}

GLuint linkProgram(GLuint vs, GLuint fs) {
	GLuint program = glCreateProgram();
	glAttachShader(program, vs);
	glAttachShader(program, fs);
	glLinkProgram(program);
	GLint status = 0;
	glGetProgramiv(program, GL_LINK_STATUS, &status);
	if (status == GL_FALSE) {
		GLint log_length = 0;
		glGetProgramiv(program, GL_INFO_LOG_LENGTH, &log_length);
		std::string log;
		if (log_length > 1) {
			std::string log_buffer;
			log_buffer.resize(static_cast<size_t>(log_length));
			GLsizei written = 0;
			glGetProgramInfoLog(program, log_length, &written, log_buffer.data());
			log.assign(log_buffer.data(), static_cast<size_t>(written));
		}
		EngineCore::instance().log(LogLevel::Error,
								"[BMSX] GLES2 program link failed: %s\n",
								log.c_str());
		glDeleteProgram(program);
		glDeleteShader(vs);
		glDeleteShader(fs);
		throw BMSX_RUNTIME_ERROR(std::string("[BMSX] GLES2 program link failed: ") + log);
	}
	glDeleteShader(vs);
	glDeleteShader(fs);
	return program;
}

void setupBuffers() {
	g_sprite.instance_data.resize(static_cast<size_t>(kMaxSprites * kInstanceStride));
	g_sprite.expanded_data.resize(static_cast<size_t>(kMaxSprites * kVerticesPerSprite * kExpandedVertexStride));

	glGenBuffers(1, &g_sprite.corner_vbo);
	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.corner_vbo);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kCornerData)), kCornerData, GL_STATIC_DRAW);

	glGenBuffers(1, &g_sprite.instance_vbo);
	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.instance_vbo);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(g_sprite.instance_data.size()), nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_sprite.expanded_vbo);
	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.expanded_vbo);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(g_sprite.expanded_data.size()), nullptr, GL_DYNAMIC_DRAW);
}

void configureVertexLayout() {
	if (g_sprite.use_instancing) {
		glBindBuffer(GL_ARRAY_BUFFER, g_sprite.corner_vbo);
		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_corner));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_corner), 2, GL_FLOAT, GL_FALSE, 0, nullptr);
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_corner), 0u);

		glBindBuffer(GL_ARRAY_BUFFER, g_sprite.instance_vbo);

		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_pos));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_pos), 2, GL_FLOAT, GL_FALSE, kInstanceStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kInstancePosOffset)));
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_pos), 1u);

		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_size));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_size), 2, GL_FLOAT, GL_FALSE, kInstanceStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kInstanceSizeOffset)));
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_size), 1u);

		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_uv0));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_uv0), 2, GL_FLOAT, GL_FALSE, kInstanceStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kInstanceUv0Offset)));
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_uv0), 1u);

		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_uv1));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_uv1), 2, GL_FLOAT, GL_FALSE, kInstanceStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kInstanceUv1Offset)));
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_uv1), 1u);

		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_z));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_z), 1, GL_UNSIGNED_SHORT, GL_TRUE, kInstanceStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kInstanceZOffset)));
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_z), 1u);

		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_atlas));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_atlas), 1, GL_UNSIGNED_BYTE, GL_FALSE, kInstanceStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kInstanceAtlasOffset)));
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_atlas), 1u);

		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_fx));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_fx), 1, GL_BYTE, GL_TRUE, kInstanceStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kInstanceFxOffset)));
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_fx), 1u);

		glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_color));
		glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_color), 4, GL_UNSIGNED_BYTE, GL_TRUE, kInstanceStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kInstanceColorOffset)));
		g_sprite.vertexAttribDivisor(static_cast<GLuint>(g_sprite.attrib_color), 1u);
		return;
	}

	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.expanded_vbo);

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_corner));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_corner), 2, GL_FLOAT, GL_FALSE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedCornerOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_pos));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_pos), 2, GL_FLOAT, GL_FALSE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedPosOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_size));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_size), 2, GL_FLOAT, GL_FALSE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedSizeOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_uv0));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_uv0), 2, GL_FLOAT, GL_FALSE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedUv0Offset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_uv1));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_uv1), 2, GL_FLOAT, GL_FALSE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedUv1Offset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_z));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_z), 1, GL_UNSIGNED_SHORT, GL_TRUE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedZOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_atlas));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_atlas), 1, GL_UNSIGNED_BYTE, GL_FALSE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedAtlasOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_fx));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_fx), 1, GL_BYTE, GL_TRUE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedFxOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_color));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_color), 4, GL_UNSIGNED_BYTE, GL_TRUE,
						kExpandedVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kExpandedColorOffset)));
}

void setupVertexLayout() {
	if (g_sprite.use_vao) {
		glBindVertexArrayOES(g_sprite.vao);
		configureVertexLayout();
		glBindVertexArrayOES(0);
		return;
	}
	configureVertexLayout();
}

void bindVertexLayout() {
	if (g_sprite.use_vao) {
		glBindVertexArrayOES(g_sprite.vao);
		return;
	}
	configureVertexLayout();
}

void unbindVertexLayout() {
	if (!g_sprite.use_vao) {
		return;
	}
	glBindVertexArrayOES(0);
}

uint16_t packUnorm16(float value) {
	const float clamped = clamp(value, 0.0f, 1.0f);
	return static_cast<uint16_t>(std::lround(clamped * 65535.0f));
}

uint8_t packUnorm8(float value) {
	const float clamped = clamp(value, 0.0f, 1.0f);
	return static_cast<uint8_t>(std::lround(clamped * 255.0f));
}

int8_t packSnorm8(float value) {
	const float clamped = clamp(value, -1.0f, 1.0f);
	return static_cast<int8_t>(std::lround(clamped * 127.0f));
}

inline void writeF32(uint8_t* dst, int offset, float value) {
	std::memcpy(dst + offset, &value, sizeof(float));
}

inline void writeU16(uint8_t* dst, int offset, uint16_t value) {
	std::memcpy(dst + offset, &value, sizeof(uint16_t));
}

void writeInstance(uint8_t* dst, float posX, float posY, float sizeX, float sizeY,
					float uv0x, float uv0y, float uv1x, float uv1y, uint16_t z,
					uint8_t atlas, int8_t fx, uint8_t r, uint8_t g, uint8_t b,
					uint8_t a) {
	writeF32(dst, kInstancePosOffset + 0, posX);
	writeF32(dst, kInstancePosOffset + 4, posY);
	writeF32(dst, kInstanceSizeOffset + 0, sizeX);
	writeF32(dst, kInstanceSizeOffset + 4, sizeY);
	writeF32(dst, kInstanceUv0Offset + 0, uv0x);
	writeF32(dst, kInstanceUv0Offset + 4, uv0y);
	writeF32(dst, kInstanceUv1Offset + 0, uv1x);
	writeF32(dst, kInstanceUv1Offset + 4, uv1y);
	writeU16(dst, kInstanceZOffset, z);
	dst[kInstanceAtlasOffset] = atlas;
	dst[kInstanceFxOffset] = static_cast<uint8_t>(fx);
	dst[kInstanceColorOffset + 0] = r;
	dst[kInstanceColorOffset + 1] = g;
	dst[kInstanceColorOffset + 2] = b;
	dst[kInstanceColorOffset + 3] = a;
}

void writeExpandedVertex(uint8_t* dst, float cornerX, float cornerY, float posX,
						float posY, float sizeX, float sizeY, float uv0x,
						float uv0y, float uv1x, float uv1y, uint16_t z,
						uint8_t atlas, int8_t fx, uint8_t r, uint8_t g, uint8_t b,
						uint8_t a) {
	writeF32(dst, kExpandedCornerOffset + 0, cornerX);
	writeF32(dst, kExpandedCornerOffset + 4, cornerY);
	writeF32(dst, kExpandedPosOffset + 0, posX);
	writeF32(dst, kExpandedPosOffset + 4, posY);
	writeF32(dst, kExpandedSizeOffset + 0, sizeX);
	writeF32(dst, kExpandedSizeOffset + 4, sizeY);
	writeF32(dst, kExpandedUv0Offset + 0, uv0x);
	writeF32(dst, kExpandedUv0Offset + 4, uv0y);
	writeF32(dst, kExpandedUv1Offset + 0, uv1x);
	writeF32(dst, kExpandedUv1Offset + 4, uv1y);
	writeU16(dst, kExpandedZOffset, z);
	dst[kExpandedAtlasOffset] = atlas;
	dst[kExpandedFxOffset] = static_cast<uint8_t>(fx);
	dst[kExpandedColorOffset + 0] = r;
	dst[kExpandedColorOffset + 1] = g;
	dst[kExpandedColorOffset + 2] = b;
	dst[kExpandedColorOffset + 3] = a;
}

void writeExpandedSprite(uint8_t* dst, float posX, float posY, float sizeX,
						float sizeY, float uv0x, float uv0y, float uv1x,
						float uv1y, uint16_t z, uint8_t atlas, int8_t fx,
						uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	for (int v = 0; v < kVerticesPerSprite; ++v) {
		uint8_t* vertexDst = dst + static_cast<size_t>(v) * kExpandedVertexStride;
		writeExpandedVertex(vertexDst, kCornerData[v * 2], kCornerData[v * 2 + 1],
						posX, posY, sizeX, sizeY, uv0x, uv0y, uv1x, uv1y, z,
						atlas, fx, r, g, b, a);
	}
}

void updateInstanceBuffer(size_t spriteCount) {
	const size_t byteCount = spriteCount * static_cast<size_t>(kInstanceStride);
	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.instance_vbo);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(byteCount), g_sprite.instance_data.data());
}

void updateExpandedBuffer(size_t spriteCount) {
	const size_t byteCount = spriteCount * static_cast<size_t>(kVerticesPerSprite) *
						static_cast<size_t>(kExpandedVertexStride);
	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.expanded_vbo);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(byteCount), g_sprite.expanded_data.data());
}

}  // namespace

void initGLES2(OpenGLES2Backend* backend, GameView* context) {
	(void)backend;
	(void)context;

	GLuint vs = compileShader(GL_VERTEX_SHADER, kSpriteVertexShader);
	GLuint fs = compileShader(GL_FRAGMENT_SHADER, kSpriteFragmentShader);
	g_sprite.program = linkProgram(vs, fs);

	g_sprite.attrib_corner = glGetAttribLocation(g_sprite.program, "a_corner");
	g_sprite.attrib_pos = glGetAttribLocation(g_sprite.program, "i_pos");
	g_sprite.attrib_size = glGetAttribLocation(g_sprite.program, "i_size");
	g_sprite.attrib_uv0 = glGetAttribLocation(g_sprite.program, "i_uv0");
	g_sprite.attrib_uv1 = glGetAttribLocation(g_sprite.program, "i_uv1");
	g_sprite.attrib_z = glGetAttribLocation(g_sprite.program, "i_z");
	g_sprite.attrib_atlas = glGetAttribLocation(g_sprite.program, "i_atlas_id");
	g_sprite.attrib_fx = glGetAttribLocation(g_sprite.program, "i_fx");
	g_sprite.attrib_color = glGetAttribLocation(g_sprite.program, "i_color_override");

	g_sprite.uniform_resolution = glGetUniformLocation(g_sprite.program, "u_resolution");
	g_sprite.uniform_scale = glGetUniformLocation(g_sprite.program, "u_scale");
	g_sprite.uniform_parallax_rig = glGetUniformLocation(g_sprite.program, "u_parallax_rig");
	g_sprite.uniform_parallax_rig2 = glGetUniformLocation(g_sprite.program, "u_parallax_rig2");
	g_sprite.uniform_parallax_flip_window = glGetUniformLocation(g_sprite.program, "u_parallax_flip_window");
	g_sprite.uniform_tex0 = glGetUniformLocation(g_sprite.program, "u_texture0");
	g_sprite.uniform_tex1 = glGetUniformLocation(g_sprite.program, "u_texture1");
	g_sprite.uniform_tex2 = glGetUniformLocation(g_sprite.program, "u_texture2");
	g_sprite.uniform_tex3 = glGetUniformLocation(g_sprite.program, "u_texture3");
	g_sprite.uniform_time = glGetUniformLocation(g_sprite.program, "u_time");

	const char* extensions = reinterpret_cast<const char*>(glGetString(GL_EXTENSIONS));
	const bool hasExtInstancing = (extensions != nullptr) &&
		(std::strstr(extensions, "GL_EXT_instanced_arrays") != nullptr);
	const bool hasAngleInstancing = (extensions != nullptr) &&
		(std::strstr(extensions, "GL_ANGLE_instanced_arrays") != nullptr);

	if (glVertexAttribDivisor != nullptr && glDrawArraysInstanced != nullptr) {
		g_sprite.vertexAttribDivisor = glVertexAttribDivisor;
		g_sprite.drawArraysInstanced = glDrawArraysInstanced;
	} else if (hasExtInstancing && glVertexAttribDivisorEXT != nullptr && glDrawArraysInstancedEXT != nullptr) {
		g_sprite.vertexAttribDivisor = glVertexAttribDivisorEXT;
		g_sprite.drawArraysInstanced = glDrawArraysInstancedEXT;
	} else if (hasAngleInstancing && glVertexAttribDivisorANGLE != nullptr && glDrawArraysInstancedANGLE != nullptr) {
		g_sprite.vertexAttribDivisor = glVertexAttribDivisorANGLE;
		g_sprite.drawArraysInstanced = glDrawArraysInstancedANGLE;
	}

	g_sprite.use_instancing = (g_sprite.vertexAttribDivisor != nullptr) && (g_sprite.drawArraysInstanced != nullptr);
	if (!g_sprite.use_instancing) {
		EngineCore::instance().log(
			LogLevel::Warn,
			"[BMSX][GLES2][Sprites] Instanced arrays unavailable; using expanded-vertex fallback.\n");
	}

	setupBuffers();

	const bool hasVaoExtension = (extensions != nullptr) &&
		(std::strstr(extensions, "GL_OES_vertex_array_object") != nullptr);
	const bool hasVaoFunctions =
		(glGenVertexArraysOES != nullptr) &&
		(glBindVertexArrayOES != nullptr) &&
		(glDeleteVertexArraysOES != nullptr);
	g_sprite.use_vao = hasVaoExtension && hasVaoFunctions;
	if (g_sprite.use_vao) {
		glGenVertexArraysOES(1, &g_sprite.vao);
		g_sprite.use_vao = (g_sprite.vao != 0);
	}
	setupVertexLayout();

	glUseProgram(g_sprite.program);
	glUniform1i(g_sprite.uniform_tex0, kTexUnitAtlasPrimary);
	glUniform1i(g_sprite.uniform_tex1, kTexUnitAtlasSecondary);
	glUniform1i(g_sprite.uniform_tex2, kTexUnitAtlasEngine);
	glUniform1i(g_sprite.uniform_tex3, kTexUnitAtlasFallback);

	if (kSpritesVerboseLog) {
		std::fprintf(stderr,
					"[BMSX][GLES2][Sprites] init program=%u vao=%u use_vao=%d\n",
					static_cast<unsigned>(g_sprite.program),
					static_cast<unsigned>(g_sprite.vao),
					g_sprite.use_vao ? 1 : 0);
	}
}

void shutdownGLES2(OpenGLES2Backend* backend) {
	(void)backend;
	if (g_sprite.program != 0) {
		glDeleteProgram(g_sprite.program);
	}
	if (g_sprite.corner_vbo != 0) {
		glDeleteBuffers(1, &g_sprite.corner_vbo);
	}
	if (g_sprite.instance_vbo != 0) {
		glDeleteBuffers(1, &g_sprite.instance_vbo);
	}
	if (g_sprite.expanded_vbo != 0) {
		glDeleteBuffers(1, &g_sprite.expanded_vbo);
	}
	if (g_sprite.vao != 0) {
		glDeleteVertexArraysOES(1, &g_sprite.vao);
	}
	g_sprite = SpriteGLES2State{};
}

void renderSpriteBatchGLES2(OpenGLES2Backend* backend, GameView* context,
							const SpritesPipelineState& state) {
	const i32 spriteCount = RenderQueues::beginSpriteQueue();
	if (spriteCount == 0) {
		return;
	}

	glUseProgram(g_sprite.program);
	glUniform1i(g_sprite.uniform_tex0, kTexUnitAtlasPrimary);
	glUniform1i(g_sprite.uniform_tex1, kTexUnitAtlasSecondary);
	glUniform1i(g_sprite.uniform_tex2, kTexUnitAtlasEngine);
	glUniform1i(g_sprite.uniform_tex3, kTexUnitAtlasFallback);

	bindVertexLayout();

	glDisable(GL_CULL_FACE);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glEnable(GL_BLEND);
	glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

	const float baseWidth = static_cast<float>(state.baseWidth);
	const float baseHeight = static_cast<float>(state.baseHeight);
	glUniform2f(g_sprite.uniform_resolution, baseWidth, baseHeight);
	glUniform1f(g_sprite.uniform_time, static_cast<float>(EngineCore::instance().totalTime()));
	const SpriteParallaxRig& parallaxRig = RenderQueues::spriteParallaxRig;
	glUniform4f(g_sprite.uniform_parallax_rig, parallaxRig.vy, parallaxRig.scale,
				parallaxRig.impact, parallaxRig.impact_t);
	glUniform4f(g_sprite.uniform_parallax_rig2, parallaxRig.bias_px,
				parallaxRig.parallax_strength, parallaxRig.scale_strength,
				parallaxRig.flip_strength);
	glUniform1f(g_sprite.uniform_parallax_flip_window, parallaxRig.flip_window);

	const bool ideIsViewport = (state.viewportTypeIde == "viewport");
	const float ideScale = ideIsViewport ? 1.0f : (baseWidth / static_cast<float>(state.width));
	float currentScale = 1.0f;
	glUniform1f(g_sprite.uniform_scale, currentScale);

	backend->setActiveTextureUnit(kTexUnitAtlasPrimary);
	backend->bindTexture2D(state.atlasPrimaryTex);
	if (state.atlasSecondaryTex) {
		backend->setActiveTextureUnit(kTexUnitAtlasSecondary);
		backend->bindTexture2D(state.atlasSecondaryTex);
	}
	if (state.atlasEngineTex) {
		backend->setActiveTextureUnit(kTexUnitAtlasEngine);
		backend->bindTexture2D(state.atlasEngineTex);
	}

	bool fallbackTextureBound = false;

	size_t batchCount = 0;
	auto flush = [&]() {
		if (batchCount == 0) {
			return;
		}
		if (g_sprite.use_instancing) {
			updateInstanceBuffer(batchCount);
			g_sprite.drawArraysInstanced(GL_TRIANGLES, 0, kVerticesPerSprite, static_cast<GLsizei>(batchCount));
		} else {
			updateExpandedBuffer(batchCount);
			glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(batchCount * static_cast<size_t>(kVerticesPerSprite)));
		}
		batchCount = 0;
	};

	RenderQueues::forEachSprite([&](const SpriteQueueItem& item, size_t index) {
		(void)index;
		const auto& options = item.options;
		const ImgMeta* imgmeta = item.imgmeta;

		const RenderLayer layer = options.layer.value_or(RenderLayer::World);
		const float desiredScale = (layer == RenderLayer::IDE) ? ideScale : 1.0f;
		if (desiredScale != currentScale) {
			flush();
			currentScale = desiredScale;
			glUniform1f(g_sprite.uniform_scale, currentScale);
		}

		const Vec3& pos = options.pos;
		const Vec2& scale = options.scale.value();
		const Color& colorize = options.colorize.value();
		const FlipOptions& flip = options.flip.value();
		const float zValue = (pos.z == 0.0f) ? kDefaultZ : pos.z;
		const float zNorm = 1.0f - (zValue / kZCoordMax);
		float parallaxWeight = options.parallax_weight.value_or(0.0f);
		if (layer != RenderLayer::World) {
			parallaxWeight = 0.0f;
		}

		const float sizeX = static_cast<float>(imgmeta->width) * scale.x;
		const float sizeY = static_cast<float>(imgmeta->height) * scale.y;
		const auto& texcoords = flip.flip_h
			? (flip.flip_v ? imgmeta->texcoords_fliphv : imgmeta->texcoords_fliph)
			: (flip.flip_v ? imgmeta->texcoords_flipv : imgmeta->texcoords);
		const float uv0x = texcoords[0];
		const float uv0y = texcoords[1];
		const float uv1x = texcoords[10];
		const float uv1y = texcoords[11];

		const uint16_t zPacked = packUnorm16(zNorm);
		const i32 atlasId = imgmeta->atlasid;
		uint8_t atlasPacked = static_cast<uint8_t>(ENGINE_ATLAS_INDEX);
		if (item.useFallbackTexture) {
			if (!fallbackTextureBound) {
				TextureHandle fallbackTex = context->textures.at("_atlas_fallback");
				backend->setActiveTextureUnit(kTexUnitAtlasFallback);
				backend->bindTexture2D(fallbackTex);
				fallbackTextureBound = true;
			}
			atlasPacked = kAtlasFallbackSelector;
		} else if (atlasId != ENGINE_ATLAS_INDEX) {
			if (atlasId == context->primaryAtlasIdInSlot) {
				atlasPacked = 0;
			} else if (atlasId == context->secondaryAtlasIdInSlot) {
				atlasPacked = 1;
			} else {
				atlasPacked = 0;
			}
		}

		const int8_t weightPacked = packSnorm8(parallaxWeight);
		const uint8_t colorR = packUnorm8(colorize.r);
		const uint8_t colorG = packUnorm8(colorize.g);
		const uint8_t colorB = packUnorm8(colorize.b);
		const uint8_t colorA = packUnorm8(colorize.a);

		if (g_sprite.use_instancing) {
			const size_t base = batchCount * static_cast<size_t>(kInstanceStride);
			uint8_t* dst = g_sprite.instance_data.data() + base;
			writeInstance(dst, pos.x, pos.y, sizeX, sizeY, uv0x, uv0y, uv1x, uv1y,
						zPacked, atlasPacked, weightPacked, colorR, colorG, colorB, colorA);
		} else {
			const size_t base = batchCount * static_cast<size_t>(kVerticesPerSprite) *
							static_cast<size_t>(kExpandedVertexStride);
			uint8_t* dst = g_sprite.expanded_data.data() + base;
			writeExpandedSprite(dst, pos.x, pos.y, sizeX, sizeY, uv0x, uv0y, uv1x, uv1y,
							zPacked, atlasPacked, weightPacked, colorR, colorG, colorB, colorA);
		}

		batchCount++;
		if (batchCount >= static_cast<size_t>(kMaxSprites)) {
			flush();
		}
	});

	if (batchCount > 0) {
		flush();
	}

	unbindVertexLayout();
	glDepthMask(GL_TRUE);
}

}  // namespace SpritesPipeline
}  // namespace bmsx
