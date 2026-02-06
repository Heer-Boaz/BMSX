/*
 * sprites_pipeline_gles2.cpp - GLES2 sprite pipeline
 */

#include "sprites_pipeline_gles2.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <stdexcept>
#include <string>

#include "../../rompack/runtime_assets.h"
#include "../../core/engine_core.h"
#include "../../rompack/rompack.h"
#include "../../emulator/runtime.h"
#include "../../utils/clamp.h"
#include "../shared/render_queues.h"

#if defined(__GNUC__)
extern "C" __attribute__((weak)) void glGenVertexArraysOES(GLsizei n, GLuint* arrays);
extern "C" __attribute__((weak)) void glBindVertexArrayOES(GLuint array);
extern "C" __attribute__((weak)) void glDeleteVertexArraysOES(GLsizei n, const GLuint* arrays);
#else
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
constexpr int kPositionComponents = 2;
constexpr int kTexcoordComponents = 2;
constexpr int kZComponents = 1;
constexpr int kColorComponents = 4;
constexpr int kAtlasComponents = 1;
constexpr int kCenterComponents = 2;
constexpr int kParallaxWeightComponents = 1;
constexpr int kVertexStride = 24;
constexpr int kPositionOffset = 0;
constexpr int kTexcoordOffset = 8;
constexpr int kZOffset = 12;
constexpr int kAtlasOffset = 14;
constexpr int kParallaxWeightOffset = 15;
constexpr int kColorOffset = 16;
constexpr int kCenterOffset = 20;
constexpr float kCornerX[6] = {0.0f, 0.0f, 1.0f, 1.0f, 0.0f, 1.0f};
constexpr float kCornerY[6] = {0.0f, 1.0f, 0.0f, 0.0f, 1.0f, 1.0f};

constexpr float kZCoordMax = 10000.0f;
constexpr float kDefaultZ = 0.0f;

constexpr int kTexUnitAtlasPrimary = 0;
constexpr int kTexUnitAtlasSecondary = 1;
constexpr int kTexUnitAtlasEngine = 2;
constexpr int kTexUnitAtlasFallback = 3;
constexpr uint8_t kAtlasFallbackSelector = 255u;

static_assert(ENGINE_ATLAS_INDEX <= 255, "ENGINE_ATLAS_INDEX must fit in uint8_t sprite atlas selector.");

struct SpriteGLES2State {
	GLuint program = 0;
	GLint attrib_pos = -1;
	GLint attrib_uv = -1;
	GLint attrib_z = -1;
	GLint attrib_center = -1;
	GLint attrib_parallax_weight = -1;
	GLint attrib_color = -1;
	GLint attrib_atlas = -1;
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
	GLuint vbo = 0;
	GLuint vao = 0;
	bool use_vao = false;
	std::vector<uint8_t> vertex_data;
};

SpriteGLES2State g_sprite;

const char* kSpriteVertexShader = R"(
precision mediump float;

attribute vec2 a_position;
attribute vec2 a_texcoord;
attribute float a_pos_z;
attribute vec2 a_center;
attribute float a_parallax_weight;
attribute vec4 a_color_override;
attribute float a_atlas_id;

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
	float depth = smoothstep(0.0, 1.0, a_pos_z);
	float dir = sign(a_parallax_weight);
	float weight = abs(a_parallax_weight) * depth;
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
	vec2 parallaxPos = (a_position - a_center) * parallaxScale + a_center + vec2(0.0, dy_px);
	vec2 scaledPosition = parallaxPos * u_scale;
	vec2 clipSpace = ((scaledPosition / u_resolution) * 2.0 - 1.0) * vec2(1.0, -1.0);
	gl_Position = vec4(clipSpace, a_pos_z, 1.0);
	v_texcoord = a_texcoord;
	v_color_override = a_color_override;
	v_atlas_id = a_atlas_id;
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
	g_sprite.vertex_data.resize(
		static_cast<size_t>(kMaxSprites * kVerticesPerSprite * kVertexStride));

	glGenBuffers(1, &g_sprite.vbo);
	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo);
	glBufferData(GL_ARRAY_BUFFER,
				static_cast<GLsizeiptr>(g_sprite.vertex_data.size()),
				nullptr, GL_DYNAMIC_DRAW);
}

void setupAttributes() {
	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo);

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_pos));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_pos),
						kPositionComponents, GL_FLOAT, GL_FALSE, kVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kPositionOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_uv));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_uv),
						kTexcoordComponents, GL_UNSIGNED_SHORT, GL_TRUE,
						kVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kTexcoordOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_z));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_z), kZComponents,
						GL_UNSIGNED_SHORT, GL_TRUE, kVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kZOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_atlas));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_atlas),
						kAtlasComponents, GL_UNSIGNED_BYTE, GL_FALSE, kVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kAtlasOffset)));

	glEnableVertexAttribArray(
		static_cast<GLuint>(g_sprite.attrib_parallax_weight));
	glVertexAttribPointer(
		static_cast<GLuint>(g_sprite.attrib_parallax_weight),
		kParallaxWeightComponents, GL_BYTE, GL_TRUE, kVertexStride,
		reinterpret_cast<void*>(static_cast<intptr_t>(kParallaxWeightOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_color));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_color),
						kColorComponents, GL_UNSIGNED_BYTE, GL_TRUE, kVertexStride,
						reinterpret_cast<void*>(static_cast<intptr_t>(kColorOffset)));

	glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_center));
	glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_center),
						kCenterComponents, GL_SHORT, GL_FALSE, kVertexStride,
							reinterpret_cast<void*>(static_cast<intptr_t>(kCenterOffset)));
}

void setupVertexLayout() {
	if (g_sprite.use_vao) {
		glBindVertexArrayOES(g_sprite.vao);
		setupAttributes();
		glBindVertexArrayOES(0);
		return;
	}
	setupAttributes();
}

void bindVertexLayout() {
	if (g_sprite.use_vao) {
		glBindVertexArrayOES(g_sprite.vao);
		return;
	}
	setupAttributes();
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

void writeVertex(uint8_t* dst, float x, float y, uint16_t u, uint16_t v,
					uint16_t z, uint8_t atlas, int8_t weight, uint8_t r,
					uint8_t g, uint8_t b, uint8_t a, int16_t cx,
					int16_t cy) {
	std::memcpy(dst + kPositionOffset, &x, sizeof(float));
	std::memcpy(dst + kPositionOffset + sizeof(float), &y, sizeof(float));
	std::memcpy(dst + kTexcoordOffset, &u, sizeof(uint16_t));
	std::memcpy(dst + kTexcoordOffset + sizeof(uint16_t), &v,
				sizeof(uint16_t));
	std::memcpy(dst + kZOffset, &z, sizeof(uint16_t));
	dst[kAtlasOffset] = atlas;
	dst[kParallaxWeightOffset] = static_cast<uint8_t>(weight);
	dst[kColorOffset + 0] = r;
	dst[kColorOffset + 1] = g;
	dst[kColorOffset + 2] = b;
	dst[kColorOffset + 3] = a;
	std::memcpy(dst + kCenterOffset, &cx, sizeof(int16_t));
	std::memcpy(dst + kCenterOffset + sizeof(int16_t), &cy, sizeof(int16_t));
}

void updateBuffers(size_t spriteCount) {
	const size_t vertexCount = spriteCount * kVerticesPerSprite;
	const size_t byteCount = vertexCount * kVertexStride;
	glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(byteCount),
					g_sprite.vertex_data.data());
}

}  // namespace

void initGLES2(OpenGLES2Backend* backend, GameView* context) {
	(void)backend;
	(void)context;

	GLuint vs = compileShader(GL_VERTEX_SHADER, kSpriteVertexShader);
	GLuint fs = compileShader(GL_FRAGMENT_SHADER, kSpriteFragmentShader);
	g_sprite.program = linkProgram(vs, fs);

	g_sprite.attrib_pos = glGetAttribLocation(g_sprite.program, "a_position");
	g_sprite.attrib_uv = glGetAttribLocation(g_sprite.program, "a_texcoord");
	g_sprite.attrib_z = glGetAttribLocation(g_sprite.program, "a_pos_z");
	g_sprite.attrib_center = glGetAttribLocation(g_sprite.program, "a_center");
	g_sprite.attrib_parallax_weight =
		glGetAttribLocation(g_sprite.program, "a_parallax_weight");
	g_sprite.attrib_color =
		glGetAttribLocation(g_sprite.program, "a_color_override");
	g_sprite.attrib_atlas = glGetAttribLocation(g_sprite.program, "a_atlas_id");

	g_sprite.uniform_resolution =
		glGetUniformLocation(g_sprite.program, "u_resolution");
	g_sprite.uniform_scale = glGetUniformLocation(g_sprite.program, "u_scale");
	g_sprite.uniform_parallax_rig =
		glGetUniformLocation(g_sprite.program, "u_parallax_rig");
	g_sprite.uniform_parallax_rig2 =
		glGetUniformLocation(g_sprite.program, "u_parallax_rig2");
	g_sprite.uniform_parallax_flip_window =
		glGetUniformLocation(g_sprite.program, "u_parallax_flip_window");
	g_sprite.uniform_tex0 = glGetUniformLocation(g_sprite.program, "u_texture0");
	g_sprite.uniform_tex1 = glGetUniformLocation(g_sprite.program, "u_texture1");
	g_sprite.uniform_tex2 = glGetUniformLocation(g_sprite.program, "u_texture2");
	g_sprite.uniform_tex3 = glGetUniformLocation(g_sprite.program, "u_texture3");
	g_sprite.uniform_time = glGetUniformLocation(g_sprite.program, "u_time");

	setupBuffers();
	const char* extensions =
		reinterpret_cast<const char*>(glGetString(GL_EXTENSIONS));
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
	// Re-apply sampler bindings every draw; shared contexts can clobber uniform
	// state. This avoids stale sampler slots after the frontend renders.
	glUniform1i(g_sprite.uniform_tex0, kTexUnitAtlasPrimary);
	glUniform1i(g_sprite.uniform_tex1, kTexUnitAtlasSecondary);
	glUniform1i(g_sprite.uniform_tex2, kTexUnitAtlasEngine);
	glUniform1i(g_sprite.uniform_tex3, kTexUnitAtlasFallback);
	if (kSpritesVerboseLog) {
	std::fprintf(stderr,
					"[BMSX][GLES2][Sprites] init program=%u attribs(pos=%d uv=%d "
					"z=%d color=%d atlas=%d) uniforms(res=%d scale=%d tex0=%d "
					"tex1=%d tex2=%d tex3=%d)\n",
					static_cast<unsigned>(g_sprite.program), g_sprite.attrib_pos,
					g_sprite.attrib_uv, g_sprite.attrib_z, g_sprite.attrib_color,
					g_sprite.attrib_atlas, g_sprite.uniform_resolution,
					g_sprite.uniform_scale, g_sprite.uniform_tex0,
					g_sprite.uniform_tex1, g_sprite.uniform_tex2,
					g_sprite.uniform_tex3);
	}
}

void shutdownGLES2(OpenGLES2Backend* backend) {
	(void)backend;
	if (g_sprite.program != 0) {
	glDeleteProgram(g_sprite.program);
	}
	if (g_sprite.vbo != 0) glDeleteBuffers(1, &g_sprite.vbo);
	if (g_sprite.vao != 0) glDeleteVertexArraysOES(1, &g_sprite.vao);
	g_sprite = SpriteGLES2State{};
}

void renderSpriteBatchGLES2(OpenGLES2Backend* backend, GameView* context,
							const SpritesPipelineState& state) {
	(void)context;
	const bool logFrame = []() {
	if constexpr (kSpritesVerboseLog) {
		static u32 s_frameIndex = 0;
		s_frameIndex++;
		return s_frameIndex <= 3;
	}
	return false;
	}();
	const i32 spriteCount = RenderQueues::beginSpriteQueue();
	if (spriteCount == 0) {
	return;
	}
	// auto& runtime = Runtime::instance();
	// auto& memory = runtime.memory();
	if (kSpritesVerboseLog) {
	auto* primary = OpenGLES2Backend::asTexture(state.atlasPrimaryTex);
	auto* secondary = state.atlasSecondaryTex
							? OpenGLES2Backend::asTexture(state.atlasSecondaryTex)
							: nullptr;
	auto* engine = state.atlasEngineTex
						? OpenGLES2Backend::asTexture(state.atlasEngineTex)
						: nullptr;
	std::fprintf(stderr,
					"[BMSX][GLES2][Sprites] spriteCount=%d atlasPrimary=%u "
					"atlasSecondary=%u atlasEngine=%u\n",
					spriteCount, static_cast<unsigned>(primary->id),
					static_cast<unsigned>(secondary ? secondary->id : 0),
					static_cast<unsigned>(engine ? engine->id : 0));
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
	glUniform1f(g_sprite.uniform_time,
				static_cast<float>(EngineCore::instance().totalTime()));
	const SpriteParallaxRig& parallaxRig = RenderQueues::spriteParallaxRig;
	glUniform4f(g_sprite.uniform_parallax_rig, parallaxRig.vy, parallaxRig.scale,
				parallaxRig.impact, parallaxRig.impact_t);
	glUniform4f(g_sprite.uniform_parallax_rig2, parallaxRig.bias_px,
				parallaxRig.parallax_strength, parallaxRig.scale_strength,
				parallaxRig.flip_strength);
	glUniform1f(g_sprite.uniform_parallax_flip_window, parallaxRig.flip_window);

	const bool ideIsViewport = (state.viewportTypeIde == "viewport");
	const float ideScale =
		ideIsViewport ? 1.0f : (baseWidth / static_cast<float>(state.width));
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
	TextureHandle fallbackTex = nullptr;
	bool fallbackTextureBound = false;

	size_t batchCount = 0;
	auto flush = [&]() {
	if (batchCount == 0) {
		return;
	}
	updateBuffers(batchCount);
	PassEncoder pass;
	backend->draw(pass, 0, static_cast<i32>(batchCount * kVerticesPerSprite));
	batchCount = 0;
	};

	RenderQueues::forEachSprite([&](const SpriteQueueItem& item, size_t index) {
	const auto& options = item.options;
	const ImgMeta* imgmeta = item.imgmeta;
	if (logFrame && index < 4) {
		const auto& tc = imgmeta->texcoords;
		std::fprintf(
			stderr,
			"[BMSX][GLES2][Sprites] item=%zu imgid=%s atlasid=%d size=%dx%d "
			"pos=%.1f,%.1f scale=%.1f,%.1f texcoords={%.3f,%.3f %.3f,%.3f "
			"%.3f,%.3f %.3f,%.3f %.3f,%.3f %.3f,%.3f}\n",
			index, options.imgid.c_str(), imgmeta->atlasid, imgmeta->width,
			imgmeta->height, options.pos.x, options.pos.y, options.scale->x,
			options.scale->y, tc[0], tc[1], tc[2], tc[3], tc[4], tc[5], tc[6],
			tc[7], tc[8], tc[9], tc[10], tc[11]);
	}

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

	const float baseW = static_cast<float>(imgmeta->width);
	const float baseH = static_cast<float>(imgmeta->height);
	const float scaledX0 = pos.x * desiredScale;
	const float scaledY0 = pos.y * desiredScale;
	const float scaledX1 = scaledX0 + baseW * scale.x * desiredScale;
	const float scaledY1 = scaledY0 + baseH * scale.y * desiredScale;
	const float snapX0 = static_cast<float>(static_cast<i32>(scaledX0));
	const float snapY0 = static_cast<float>(static_cast<i32>(scaledY0));
	const float snapX1 = static_cast<float>(static_cast<i32>(scaledX1));
	const float snapY1 = static_cast<float>(static_cast<i32>(scaledY1));
	const float snappedX = snapX0 / desiredScale;
	const float snappedY = snapY0 / desiredScale;
	const float snappedW = (snapX1 - snapX0) / desiredScale;
	const float snappedH = (snapY1 - snapY0) / desiredScale;
	const float centerX = snappedX + (snappedW * 0.5f);
	const float centerY = snappedY + (snappedH * 0.5f);
	const auto& texcoords =
		flip.flip_h
			? (flip.flip_v ? imgmeta->texcoords_fliphv
							: imgmeta->texcoords_fliph)
			: (flip.flip_v ? imgmeta->texcoords_flipv : imgmeta->texcoords);
	const uint16_t zPacked = packUnorm16(zNorm);
	const i32 atlasId = imgmeta->atlasid;
	// Sprite binding selector uses ENGINE_ATLAS_INDEX for engine atlas in the shader.
		uint8_t atlasPacked = static_cast<uint8_t>(ENGINE_ATLAS_INDEX);
		if (item.useFallbackTexture) {
			if (!fallbackTextureBound) {
				fallbackTex = context->textures.at("_atlas_fallback");
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
	const int16_t centerXi = static_cast<int16_t>(std::lround(centerX));
	const int16_t centerYi = static_cast<int16_t>(std::lround(centerY));

	const size_t baseVertex = batchCount * kVerticesPerSprite;
	for (int v = 0; v < kVerticesPerSprite; ++v) {
		const float x = snappedX + kCornerX[v] * snappedW;
		const float y = snappedY + kCornerY[v] * snappedH;
		const float u = texcoords[static_cast<size_t>(v) * 2];
		const float vcoord = texcoords[static_cast<size_t>(v) * 2 + 1];
		uint8_t* dst =
			g_sprite.vertex_data.data() + (baseVertex + static_cast<size_t>(v)) * kVertexStride;
		writeVertex(dst, x, y, packUnorm16(u), packUnorm16(vcoord), zPacked,
					atlasPacked, weightPacked, colorR, colorG, colorB,
					colorA, centerXi, centerYi);
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
