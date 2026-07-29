/*
 * gles2/backend.cpp - OpenGL ES 2.0 backend implementation
 */

#include "backend.h"
#include "render/post/crt/gles2/pipeline.h"
#include "render/post/device_quantize/gles2/pipeline.h"
#include "render/host_overlay/pass_registration.h"
#include "render/host_overlay/gles2/pipeline.h"
#include "render/backend/pass/library.h"
#include "render/backend/gles2/gx_gpu.h"
#include "render/backend/gles2/texture_units.h"
#include "render/shared/solid_pixels.h"
#include "spec/gx/vram.h"

#include <array>
#include <bit>
#include <cmath>
#include <cstdio>
#include <string_view>
#include <vector>
#if defined(__unix__) || defined(__APPLE__)
#include <dlfcn.h>
#endif

namespace {
constexpr bool kGLES2VerboseLog = false;
// Use glFinish only when debugging strict GPU completion; glFlush avoids a stall.
constexpr bool kGLES2FinishFrame = false;

#ifndef GL_SRGB_ALPHA_EXT
#define GL_SRGB_ALPHA_EXT 0x8C42
#endif

}


namespace {

GLuint compileGLES2Shader(GLenum type, const char* source, const char* shaderDefines, const char* label, const char* stage) {
	const GLuint shader = glCreateShader(type);
	if (shaderDefines != nullptr) {
		const char* sources[] = {shaderDefines, source};
		glShaderSource(shader, 2, sources, nullptr);
	} else {
		glShaderSource(shader, 1, &source, nullptr);
	}
	glCompileShader(shader);
	GLint ok = GL_FALSE;
	glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
	if (ok == GL_TRUE) {
		return shader;
	}
	char log[1024];
	glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
	glDeleteShader(shader);
	throw BMSX_RUNTIME_ERROR(std::string("[GLES2] shader compile failed ") + label + ":" + stage + ": " + log);
}

GLuint linkGLES2Program(
	GLuint vertexShader,
	GLuint fragmentShader,
	const char* label,
	std::span<const bmsx::GLES2AttributeBinding> attributeBindings) {
	const GLuint program = glCreateProgram();
	glAttachShader(program, vertexShader);
	glAttachShader(program, fragmentShader);
	for (const bmsx::GLES2AttributeBinding& binding : attributeBindings) {
		glBindAttribLocation(program, binding.location, binding.name);
	}
	glLinkProgram(program);
	GLint ok = GL_FALSE;
	glGetProgramiv(program, GL_LINK_STATUS, &ok);
	if (ok == GL_TRUE) {
		return program;
	}
	char log[1024];
	glGetProgramInfoLog(program, sizeof(log), nullptr, log);
	glDeleteProgram(program);
	throw BMSX_RUNTIME_ERROR(std::string("[GLES2] program link failed ") + label + ": " + log);
}

bool hasExtensionToken(const char* extensions, const char* needle) {
	if (extensions == nullptr || needle == nullptr || *needle == '\0') {
		return false;
	}
	const std::string_view extensionTokens(extensions);
	const std::string_view token(needle);
	if (token.empty() || token.find(' ') != std::string_view::npos) {
		return false;
	}
	size_t position = 0u;
	while (position < extensionTokens.size()) {
		const size_t match = extensionTokens.find(token, position);
		if (match == std::string_view::npos) {
			break;
		}
		const size_t matchEnd = match + token.size();
		const bool leftBoundary = match == 0u || extensionTokens[match - 1u] == ' ';
		const bool rightBoundary = matchEnd == extensionTokens.size() || extensionTokens[matchEnd] == ' ';
		if (leftBoundary && rightBoundary) {
			return true;
		}
		position = matchEnd;
	}
	return false;
}

}  // namespace

namespace bmsx {

void applyGLES2TextureParams(const TextureParams& params) {
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, static_cast<GLint>(params.minFilter));
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, static_cast<GLint>(params.magFilter));
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, static_cast<GLint>(params.wrapS));
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, static_cast<GLint>(params.wrapT));
}

struct OpenGLES2PostPipelines {
	DeviceQuantizePipeline::GLES2::State deviceQuantize;
	CRTPipeline::PresentGLES2State present;
	CRTPipeline::CRTGLES2State crt;
};

struct GLES2DepthTexture {
	GLuint id = 0;
	u32 generation = 0;
	i32 width = 0;
	i32 height = 0;
};

struct GLES2RenderTarget {
	GLuint id = 0;
	u32 generation = 0;
};

static size_t rgba8ByteCount(i32 width, i32 height) {
	return static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
}

static const u8* prepareGLES2UploadData(const u8* data, i32 width, i32 height, bool logicalSrgb, bool srgbTexture, std::vector<u8>& linearized) {
	if (data != nullptr && logicalSrgb && !srgbTexture) {
		convertSrgbToLinear(data, static_cast<size_t>(width) * static_cast<size_t>(height), linearized);
		return linearized.data();
	}
	return data;
}

static const u8* prepareGLES2TextureStorageData(const u8* data, i32 width, i32 height, bool logicalSrgb, bool srgbTexture, std::vector<u8>& linearized) {
	if (data == nullptr) {
		return nullptr;
	}
	return prepareGLES2UploadData(data, width, height, logicalSrgb, srgbTexture, linearized);
}

/*
	Libretro GLES2 state note:
	- Symptom: live output shows the slot while RetroArch pause shows the correct frame.
	- Root cause: the core and frontend share the same GL context. If the core leaves
	program/buffer/texture state bound, RetroArch's present blit can inherit that
	state and sample the wrong texture.
	- Fix: reset the bindings we touch at the end of the frame so the frontend starts
	from a clean baseline. This is intentionally minimal to limit overhead.
	- Performance: keep end-of-frame reset minimal and only call glFinish in strict
	debug mode.
*/

void OpenGLES2Backend::registerBuiltinPasses(RenderPassLibrary& registry) {
	registerFrameResolvePass(registry);

	registerGxGpuPass(registry);
	DeviceQuantizePipeline::GLES2::registerPass(registry, m_post_pipelines->deviceQuantize);

	CRTPipeline::registerPresentationHistoryGLES2Passes(registry, m_post_pipelines->present);
	CRTPipeline::registerPresentGLES2Pass(registry, m_post_pipelines->present);
	CRTPipeline::registerCRTGLES2Pass(registry, m_post_pipelines->crt);

	registerHostOverlayBackendPassesWithLifecycle<OpenGLES2Backend, bootstrapHostOverlayGLES2, shutdownHostOverlayGLES2, beginHostOverlayGLES2, renderHost2DEntryGLES2, endHostOverlayGLES2>(registry);
}

OpenGLES2Backend::ProcAddress OpenGLES2Backend::resolveProcAddress(const char* name) const {
	if (m_get_proc_address != nullptr) {
		return m_get_proc_address(name);
	}
#if defined(__unix__) || defined(__APPLE__)
	void* proc = dlsym(RTLD_DEFAULT, name);
	if (proc) {
		return reinterpret_cast<ProcAddress>(proc);
	}
	void* eglProc = dlsym(RTLD_DEFAULT, "eglGetProcAddress");
	if (eglProc) {
		using EglGetProcAddress = ProcAddress (*)(const char*);
		auto getProcAddress = reinterpret_cast<EglGetProcAddress>(eglProc);
		return getProcAddress(name);
	}
#else
	(void)name;
#endif
	return nullptr;
}

OpenGLES2Backend::ProcAddress OpenGLES2Backend::resolveProcAddress(const char* coreName, const char* angleName, const char* extName) const {
	ProcAddress proc = resolveProcAddress(coreName);
	if (proc) {
		return proc;
	}
	proc = resolveProcAddress(angleName);
	if (proc) {
		return proc;
	}
	return resolveProcAddress(extName);
}

OpenGLES2Backend::OpenGLES2Backend(
	i32 width,
	i32 height,
	bool profileGxUploads,
	u32 gxGpuVramByteCount)
	: m_default_width(width)
	, m_default_height(height)
	, m_target_width(width)
	, m_target_height(height)
	, m_profile_gx_uploads(profileGxUploads)
	, m_gx_gpu_vram_texture_rows(gxGpuVramByteCount / GX_GPU_VRAM_ADDRESS_ROW_BYTE_COUNT)
	, m_post_pipelines(std::make_unique<OpenGLES2PostPipelines>()) {}

OpenGLES2Backend::~OpenGLES2Backend() = default;

void OpenGLES2Backend::invalidateTextureBindingCache() {
	m_active_texture_unit = -1;
	m_bound_texture_2d_by_unit.fill(0);
}

void OpenGLES2Backend::bindTextureForUpload(GLuint texture, const TextureParams& params) {
	setActiveTextureUnit(GLES2_TEXTURE_UNIT_UPLOAD);
	if (m_bound_texture_2d_by_unit[GLES2_TEXTURE_UNIT_UPLOAD] != texture) {
		glBindTexture(GL_TEXTURE_2D, texture);
		m_bound_texture_2d_by_unit[GLES2_TEXTURE_UNIT_UPLOAD] = texture;
		m_touched_texture_units |= 1u << static_cast<u32>(GLES2_TEXTURE_UNIT_UPLOAD);
	}
	applyGLES2TextureParams(params);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
}

TextureHandle OpenGLES2Backend::createTexture(const u8* data, i32 width,
												i32 height,
												const TextureParams& params) {
	if (!m_context_ready) {
		throw std::runtime_error("[GLES2] createTexture called before context reset.");
	}
	auto* tex = new GLES2Texture{};
	tex->generation = m_context_generation;
	tex->width = width;
	tex->height = height;
	tex->logicalSrgb = params.srgb;
	tex->srgb = params.srgb && m_supports_srgb_textures;

	std::vector<u8> linearized;
	const u8* uploadData = prepareGLES2TextureStorageData(data, width, height, tex->logicalSrgb, tex->srgb, linearized);

	const GLint internalFormat = tex->srgb ? static_cast<GLint>(GL_SRGB_ALPHA_EXT) : static_cast<GLint>(GL_RGBA);
	glGenTextures(1, &tex->id);
	bindTextureForUpload(tex->id, params);
	glTexImage2D(GL_TEXTURE_2D, 0, internalFormat, width, height, 0, GL_RGBA,
					GL_UNSIGNED_BYTE, uploadData);
	invalidateTextureBindingCache();
	if (kGLES2VerboseLog) {
	std::fprintf(stderr,
					"[BMSX][GLES2] createTexture id=%u size=%dx%d data=%p\n",
					static_cast<unsigned>(tex->id), width, height,
					static_cast<const void*>(data));
	}

	return static_cast<TextureHandle>(tex);
}

void OpenGLES2Backend::updateTexture(TextureHandle handle, const u8* data, i32 width,
										i32 height,
										const TextureParams& params) {
	if (!m_context_ready) {
		throw std::runtime_error("[GLES2] updateTexture called before context reset.");
	}
	auto* tex = static_cast<GLES2Texture*>(handle);
	const bool needsResize = tex->width != width || tex->height != height;
	const bool logicalSrgb = params.srgb;
	const bool useSrgbTexture = logicalSrgb && m_supports_srgb_textures;
	const bool needsRecreate = needsResize || (tex->srgb != useSrgbTexture);

	std::vector<u8> linearized;
	const u8* uploadData = prepareGLES2UploadData(data, width, height, logicalSrgb, useSrgbTexture, linearized);

	bindTextureForUpload(tex->id, params);
	if (needsRecreate) {
		const GLint internalFormat = useSrgbTexture ? static_cast<GLint>(GL_SRGB_ALPHA_EXT) : static_cast<GLint>(GL_RGBA);
		glTexImage2D(GL_TEXTURE_2D, 0, internalFormat, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, uploadData);
	} else {
		glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, uploadData);
	}
	tex->width = width;
	tex->height = height;
	tex->logicalSrgb = logicalSrgb;
	tex->srgb = useSrgbTexture;
	invalidateTextureBindingCache();
	if (kGLES2VerboseLog) {
	std::fprintf(stderr,
					"[BMSX][GLES2] updateTexture id=%u size=%dx%d data=%p\n",
					static_cast<unsigned>(tex->id), width, height,
					static_cast<const void*>(data));
	}
}

TextureHandle OpenGLES2Backend::resizeTexture(TextureHandle handle, i32 width, i32 height, const TextureParams& params) {
	if (!m_context_ready) {
		throw std::runtime_error("[GLES2] resizeTexture called before context reset.");
	}
	auto* tex = static_cast<GLES2Texture*>(handle);
	const bool logicalSrgb = params.srgb;
	const bool useSrgbTexture = logicalSrgb && m_supports_srgb_textures;
	std::vector<u8> zeroed(rgba8ByteCount(width, height), 0);
	bindTextureForUpload(tex->id, params);
	const GLint internalFormat = useSrgbTexture ? static_cast<GLint>(GL_SRGB_ALPHA_EXT) : static_cast<GLint>(GL_RGBA);
	glTexImage2D(GL_TEXTURE_2D, 0, internalFormat, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, zeroed.data());
	tex->width = width;
	tex->height = height;
	tex->logicalSrgb = logicalSrgb;
	tex->srgb = useSrgbTexture;
	invalidateTextureBindingCache();
	if (kGLES2VerboseLog) {
	std::fprintf(stderr,
					"[BMSX][GLES2] resizeTexture id=%u size=%dx%d\n",
					static_cast<unsigned>(tex->id), width, height);
	}
	return handle;
}

void OpenGLES2Backend::updateTextureRegion(TextureHandle handle, const u8* data, i32 width, i32 height, i32 x, i32 y, const TextureParams& params) {
	if (!m_context_ready) {
		throw std::runtime_error("[GLES2] updateTextureRegion called before context reset.");
	}
	auto* tex = static_cast<GLES2Texture*>(handle);
	std::vector<u8> linearized;
	const u8* uploadData = prepareGLES2UploadData(data, width, height, tex->logicalSrgb, tex->srgb, linearized);
	bindTextureForUpload(tex->id, params);
	glTexSubImage2D(GL_TEXTURE_2D, 0, x, y, width, height, GL_RGBA, GL_UNSIGNED_BYTE, uploadData);
	invalidateTextureBindingCache();
	if (kGLES2VerboseLog) {
		std::fprintf(stderr,
						"[BMSX][GLES2] updateTextureRegion id=%u size=%dx%d offset=%d,%d data=%p\n",
						static_cast<unsigned>(tex->id), width, height, x, y,
						static_cast<const void*>(data));
	}
}


TextureHandle OpenGLES2Backend::createSolidTexture2D(i32 width, i32 height, u32 color, const TextureParams& params) {
	auto pixels = createSolidRgba8Pixels(width, height, color);
	TextureParams solidParams = params;
	solidParams.srgb = false;
	return createTexture(pixels.data(), width, height, solidParams);
}

void OpenGLES2Backend::destroyTexture(TextureHandle handle) {
	auto* tex = static_cast<GLES2Texture*>(handle);
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] destroyTexture id=%u\n",
					static_cast<unsigned>(tex->id));
	}
	if (tex->generation == m_context_generation) {
		glDeleteTextures(1, &tex->id);
	}
	invalidateTextureBindingCache();
	delete tex;
}

TextureHandle OpenGLES2Backend::createColorTexture(i32 width, i32 height, const std::array<f32, 4>* initialClearColor) {
	TextureHandle handle = createTexture(nullptr, width, height, RGBA8_LINEAR_TEXTURE_PARAMS);
	if (initialClearColor != nullptr) {
		void* target = createRenderTarget(handle, nullptr);
		activateRenderTarget(target, width, height);
		glDisable(GL_SCISSOR_TEST);
		clear(initialClearColor, nullptr);
		destroyRenderTarget(target);
	}
	return handle;
}

TextureHandle OpenGLES2Backend::createDepthTexture(i32 width, i32 height) {
	auto* depth = new GLES2DepthTexture{};
	depth->generation = m_context_generation;
	depth->width = width;
	depth->height = height;
	glGenRenderbuffers(1, &depth->id);
	glBindRenderbuffer(GL_RENDERBUFFER, depth->id);
	glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT16, depth->width, depth->height);
	return static_cast<TextureHandle>(depth);
}

void OpenGLES2Backend::destroyDepthTexture(TextureHandle handle) {
	auto* depth = static_cast<GLES2DepthTexture*>(handle);
	if (depth->generation == m_context_generation) {
		glDeleteRenderbuffers(1, &depth->id);
	}
	delete depth;
}

void* OpenGLES2Backend::createRenderTarget(TextureHandle color, TextureHandle depth) {
	auto* target = new GLES2RenderTarget{};
	target->generation = m_context_generation;
	glGenFramebuffers(1, &target->id);
	glBindFramebuffer(GL_FRAMEBUFFER, target->id);
	if (color != nullptr) {
		auto* texture = static_cast<GLES2Texture*>(color);
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture->id, 0);
	}
	if (depth != nullptr) {
		auto* depthTexture = static_cast<GLES2DepthTexture*>(depth);
		glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depthTexture->id);
	}
	return target;
}

void OpenGLES2Backend::destroyRenderTarget(void* target) {
	auto* renderTarget = static_cast<GLES2RenderTarget*>(target);
	if (renderTarget->generation == m_context_generation) {
		glDeleteFramebuffers(1, &renderTarget->id);
	}
	delete renderTarget;
}

void OpenGLES2Backend::activateRenderTarget(void* target, i32 width, i32 height) {
	setRenderTarget(framebufferName(target), width, height);
}

void OpenGLES2Backend::activateDefaultRenderTarget() {
	const bool fboChanged = (m_current_fbo != m_backbuffer_fbo);
	const bool sizeChanged = (m_target_width != m_default_width) || (m_target_height != m_default_height);
	m_current_fbo = m_backbuffer_fbo;
	m_target_width = m_default_width;
	m_target_height = m_default_height;
	if (fboChanged) {
		glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
	}
	if (fboChanged || sizeChanged) {
		glViewport(0, 0, m_target_width, m_target_height);
	}
}

void OpenGLES2Backend::clear(const std::array<f32, 4>* color, const f32* depth) {
	GLbitfield mask = 0;
	if (color) {
	glClearColor((*color)[0], (*color)[1], (*color)[2], (*color)[3]);
	mask |= GL_COLOR_BUFFER_BIT;
	}
	if (depth) {
	glClearDepthf(*depth);
	mask |= GL_DEPTH_BUFFER_BIT;
	}
	if (mask == 0) {
	return;
	}
	glClear(mask);
}

PassEncoder OpenGLES2Backend::beginRenderPass(const RenderPassDesc& desc) {
	const ColorAttachmentSpec* colorSpec = nullptr;
	if (desc.color) {
	colorSpec = &*desc.color;
	} else if (!desc.colors.empty()) {
	colorSpec = &desc.colors.front();
	}

	const std::array<f32, 4>* clearColor = nullptr;
	if (colorSpec && colorSpec->clear) {
	clearColor = &*colorSpec->clear;
	}

	const f32* clearDepth = nullptr;
	f32 depthValue = 1.0f;
	if (desc.depth && desc.depth->clearDepth) {
	depthValue = *desc.depth->clearDepth;
	clearDepth = &depthValue;
	}

	clear(clearColor, clearDepth);
	PassEncoder pass;
	pass.fbo = reinterpret_cast<void*>(static_cast<uintptr_t>(m_current_fbo));
	pass.desc = desc;
	return pass;
}

void OpenGLES2Backend::endRenderPass(PassEncoder& pass) { (void)pass; }

void OpenGLES2Backend::draw(PassEncoder& pass, i32 first, i32 count) {
	(void)pass;
	glDrawArrays(GL_TRIANGLES, first, count);
	m_stats.draws++;
}

void OpenGLES2Backend::drawIndexed(PassEncoder& pass, i32 indexCount,
									i32 firstIndex) {
	(void)pass;
	const auto* offset = reinterpret_cast<const void*>(
		static_cast<uintptr_t>(firstIndex * sizeof(u16)));
	glDrawElements(GL_TRIANGLES, indexCount, GL_UNSIGNED_SHORT, offset);
	m_stats.drawIndexed++;
}

void OpenGLES2Backend::beginFrame() {
	m_stats = FrameStats{};
	m_blend_color_valid = false;
	if (m_profile_gx_uploads) {
		const u64 renderFrameSerial =
			m_gx_cpu_to_vram_profile_frame.renderFrameSerial + 1u;
		m_gx_cpu_to_vram_profile_frame = GxCpuToVramProfileFrame{};
		m_gx_cpu_to_vram_profile_frame.renderFrameSerial = renderFrameSerial;
	}
	// RetroArch can mutate GL state between frames; reset caches so bindings are
	// refreshed.
	invalidateTextureBindingCache();
	m_backbuffer_fbo = static_cast<GLuint>(m_get_framebuffer());
	if (kGLES2VerboseLog) {
	static u32 frameIndex = 0;
	frameIndex++;
	std::fprintf(
			stderr, "[BMSX][GLES2] beginFrame #%u backbuffer_fbo=%u size=%dx%d\n",
			frameIndex, static_cast<unsigned>(m_backbuffer_fbo), m_default_width, m_default_height);
		}
	m_current_fbo = m_backbuffer_fbo;
	glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
	m_target_width = m_default_width;
	m_target_height = m_default_height;
	glViewport(0, 0, m_target_width, m_target_height);
	glDisable(GL_DITHER);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_STENCIL_TEST);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
}

bool OpenGLES2Backend::readGxCpuToVramProfileFrame(
		u64 afterRenderFrameSerial,
		GxCpuToVramProfileFrame& frame) const {
	if (m_gx_cpu_to_vram_profile_frame.renderFrameSerial <= afterRenderFrameSerial) {
		return false;
	}
	frame = m_gx_cpu_to_vram_profile_frame;
	return true;
}

void OpenGLES2Backend::recordGxCpuToVramUpload(
		u64 logicalBytes,
		u64 hostCalls,
		u64 hostBytes,
		u64 cpuNanoseconds) {
	m_gx_cpu_to_vram_profile_frame.commands += 1u;
	m_gx_cpu_to_vram_profile_frame.logicalBytes += logicalBytes;
	m_gx_cpu_to_vram_profile_frame.hostCalls += hostCalls;
	m_gx_cpu_to_vram_profile_frame.hostBytes += hostBytes;
	m_gx_cpu_to_vram_profile_frame.cpuNanoseconds += cpuNanoseconds;
	if (m_gx_cpu_to_vram_profile_frame.maxCommandNanoseconds < cpuNanoseconds) {
		m_gx_cpu_to_vram_profile_frame.maxCommandNanoseconds = cpuNanoseconds;
	}
}

void OpenGLES2Backend::endFrame() {
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] endFrame\n");
	}
	// Reset the core state we touched so frontend present paths don't inherit it.
	glUseProgram(0);
	glBindBuffer(GL_ARRAY_BUFFER, 0);
	glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
	u32 touchedTextureUnits = m_touched_texture_units;
	while (touchedTextureUnits != 0u) {
		const i32 unit = static_cast<i32>(std::countr_zero(touchedTextureUnits));
		if (m_active_texture_unit != unit) {
			glActiveTexture(GL_TEXTURE0 + unit);
			m_active_texture_unit = unit;
		}
		glBindTexture(GL_TEXTURE_2D, 0);
		touchedTextureUnits &= touchedTextureUnits - 1u;
	}
	if (m_touched_texture_units != 0u && m_active_texture_unit != 0) {
		glActiveTexture(GL_TEXTURE0);
	}
	m_touched_texture_units = 0u;
	invalidateTextureBindingCache();
	if constexpr (kGLES2FinishFrame) {
	glFinish();
	}
}

BackendCaps OpenGLES2Backend::getCaps() const {
	BackendCaps caps;
	caps.supportsDepthTexture = false;
	return caps;
}

void OpenGLES2Backend::setViewportSize(i32 width, i32 height) {
	m_default_width = width;
	m_default_height = height;
}

void OpenGLES2Backend::setContextCallbacks(FramebufferGetter framebufferGetter, ProcAddressGetter procAddressGetter) {
	m_get_framebuffer = framebufferGetter;
	m_get_proc_address = procAddressGetter;
}

void OpenGLES2Backend::onContextReset() {
	m_context_ready = true;
	m_context_generation += 1u;
	m_current_fbo = 0;
	m_backbuffer_fbo = 0;
	m_target_width = m_default_width;
	m_target_height = m_default_height;
	m_readback_fbo = 0;
	*m_post_pipelines = OpenGLES2PostPipelines{};
	m_touched_texture_units = 0u;
	m_blend_color_valid = false;
	invalidateTextureBindingCache();
	glDisable(GL_DITHER);
	const char* extensions = reinterpret_cast<const char*>(glGetString(GL_EXTENSIONS));
	m_supports_srgb_textures = hasExtensionToken(extensions, "GL_EXT_sRGB");
	m_supports_uint_indices = hasExtensionToken(extensions, "GL_OES_element_index_uint");
	m_arm_framebuffer_fetch_available = hasExtensionToken(extensions, "GL_ARM_shader_framebuffer_fetch");
	m_texture_barrier = !m_arm_framebuffer_fetch_available && hasExtensionToken(extensions, "GL_NV_texture_barrier")
		? resolveProcAddress("glTextureBarrierNV")
		: nullptr;
	glGenFramebuffers(1, &m_readback_fbo);
	DeviceQuantizePipeline::GLES2::init(*this, m_post_pipelines->deviceQuantize);
	CRTPipeline::initPresentGLES2(*this, m_post_pipelines->present);
	CRTPipeline::initCRTGLES2(*this, m_post_pipelines->crt);
	if (kGLES2VerboseLog) {
		std::fprintf(stderr, "[BMSX][GLES2] EXT_sRGB=%d OES_element_index_uint=%d ARM_framebuffer_fetch=%d NV_texture_barrier=%d\n",
			m_supports_srgb_textures ? 1 : 0,
			m_supports_uint_indices ? 1 : 0,
			m_arm_framebuffer_fetch_available ? 1 : 0,
			m_texture_barrier != nullptr ? 1 : 0);
	}
}

void OpenGLES2Backend::onContextDestroy() {
	CRTPipeline::shutdownCRTGLES2(m_post_pipelines->crt);
	CRTPipeline::shutdownPresentGLES2(m_post_pipelines->present);
	DeviceQuantizePipeline::GLES2::shutdown(*this, m_post_pipelines->deviceQuantize);
	if (m_readback_fbo != 0) {
		glDeleteFramebuffers(1, &m_readback_fbo);
	}
	onContextLost();
}

void OpenGLES2Backend::onContextLost() {
	m_context_ready = false;
	m_context_generation += 1u;
	DeviceQuantizePipeline::GLES2::releaseLostTextureHandles(*this, m_post_pipelines->deviceQuantize);
	m_current_fbo = 0;
	m_backbuffer_fbo = 0;
	m_target_width = m_default_width;
	m_target_height = m_default_height;
	m_readback_fbo = 0;
	*m_post_pipelines = OpenGLES2PostPipelines{};
	m_touched_texture_units = 0u;
	m_blend_color_valid = false;
	invalidateTextureBindingCache();
	m_supports_srgb_textures = false;
	m_supports_uint_indices = false;
	m_arm_framebuffer_fetch_available = false;
	m_texture_barrier = nullptr;
}

GLuint OpenGLES2Backend::framebufferName(void* target) const {
	return target ? static_cast<GLES2RenderTarget*>(target)->id : 0;
}

void OpenGLES2Backend::setActiveTextureUnit(i32 unit) {
	if (unit == m_active_texture_unit) {
	return;
	}
	glActiveTexture(GL_TEXTURE0 + unit);
	m_active_texture_unit = unit;
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] activeTexture unit=%d\n", unit);
	}
}

void OpenGLES2Backend::setBlendColor(GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha) {
	if (m_blend_color_valid
		&& m_blend_red == red
		&& m_blend_green == green
		&& m_blend_blue == blue
		&& m_blend_alpha == alpha) {
		return;
	}
	glBlendColor(red, green, blue, alpha);
	m_blend_red = red;
	m_blend_green = green;
	m_blend_blue = blue;
	m_blend_alpha = alpha;
	m_blend_color_valid = true;
}

void OpenGLES2Backend::bindTexture2D(TextureHandle tex) {
	auto* gltex = static_cast<GLES2Texture*>(tex);
	if (!gltex) {
		throw std::runtime_error("[GLES2] bindTexture2D called with null texture.");
	}
	const i32 unit = m_active_texture_unit;
	if (m_bound_texture_2d_by_unit[unit] == gltex->id) return;
	glBindTexture(GL_TEXTURE_2D, gltex->id);
	m_bound_texture_2d_by_unit[unit] = gltex->id;
	m_touched_texture_units |= 1u << static_cast<u32>(unit);
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] bindTexture2D unit=%d id=%u\n", unit,
					static_cast<unsigned>(gltex->id));
	}
}

void OpenGLES2Backend::setRenderTarget(GLuint fbo, i32 width, i32 height) {
	const bool fboChanged = (m_current_fbo != fbo);
	const bool sizeChanged = (m_target_width != width) || (m_target_height != height);
	m_current_fbo = fbo;
	m_target_width = width;
	m_target_height = height;
	if (fboChanged) {
		glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
	}
	// CRITICAL FIX: Always update viewport when FBO changes OR size changes
	// Previously, viewport was only updated on size change, which broke rendering
	// when switching between FBOs of same size (e.g., framebuffer text rendering)
	if (fboChanged || sizeChanged) {
		glViewport(0, 0, m_target_width, m_target_height);
	}
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] setRenderTarget fbo=%u size=%dx%d%s\n",
					static_cast<unsigned>(fbo), width, height,
					fboChanged ? " (FBO changed)" : sizeChanged ? " (size changed)" : "");
	}
}

GLuint OpenGLES2Backend::buildProgram(
	const char* vertexShaderSource,
	const char* fragmentShaderSource,
	const char* label,
	const char* shaderDefines,
	std::span<const GLES2AttributeBinding> attributeBindings) {
	const GLuint vertexShader = compileShader(GL_VERTEX_SHADER, vertexShaderSource, label, "vertex", shaderDefines);
	try {
		const GLuint fragmentShader = compileShader(GL_FRAGMENT_SHADER, fragmentShaderSource, label, "fragment", shaderDefines);
		try {
			const GLuint program = linkProgram(vertexShader, fragmentShader, label, attributeBindings);
			glDeleteShader(fragmentShader);
			glDeleteShader(vertexShader);
			return program;
		} catch (...) {
			glDeleteShader(fragmentShader);
			throw;
		}
	} catch (...) {
		glDeleteShader(vertexShader);
		throw;
	}
}

GLuint OpenGLES2Backend::compileShader(
	GLenum type,
	const char* source,
	const char* label,
	const char* stage,
	const char* shaderDefines) {
	return compileGLES2Shader(type, source, shaderDefines, label, stage);
}

GLuint OpenGLES2Backend::linkProgram(
	GLuint vertexShader,
	GLuint fragmentShader,
	const char* label,
	std::span<const GLES2AttributeBinding> attributeBindings) {
	return linkGLES2Program(vertexShader, fragmentShader, label, attributeBindings);
}

GLuint OpenGLES2Backend::buildProgramWithVertexShader(
	GLuint vertexShader,
	const char* fragmentShaderSource,
	const char* label,
	const char* shaderDefines,
	std::span<const GLES2AttributeBinding> attributeBindings) {
	const GLuint fragmentShader = compileShader(
		GL_FRAGMENT_SHADER, fragmentShaderSource, label, "fragment", shaderDefines);
	try {
		const GLuint program = linkProgram(vertexShader, fragmentShader, label, attributeBindings);
		glDeleteShader(fragmentShader);
		return program;
	} catch (...) {
		glDeleteShader(fragmentShader);
		throw;
	}
}

}  // namespace bmsx
