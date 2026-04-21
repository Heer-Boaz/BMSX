/*
 * gles2_backend.cpp - OpenGL ES 2.0 backend implementation
 */

#include "gles2_backend.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

namespace {
constexpr bool kGLES2VerboseLog = false;
// Use glFinish only when debugging strict GPU completion; glFlush avoids a stall.
constexpr bool kGLES2FinishFrame = false;

#ifndef GL_SRGB_ALPHA_EXT
#define GL_SRGB_ALPHA_EXT 0x8C42
#endif

bool hasExtensionToken(const char* extensions, const char* needle) {
	if (extensions == nullptr || needle == nullptr || *needle == '\0') {
		return false;
	}
	const size_t needleLen = std::strlen(needle);
	if (needleLen == 0 || std::strchr(needle, ' ') != nullptr) {
		return false;
	}
	const char* cursor = extensions;
	while (true) {
		const char* match = std::strstr(cursor, needle);
		if (match == nullptr) {
			return false;
		}
		const char* matchEnd = match + needleLen;
		const bool leftBoundary = (match == extensions) || (match[-1] == ' ');
		const bool rightBoundary = (*matchEnd == '\0') || (*matchEnd == ' ');
		if (leftBoundary && rightBoundary) {
			return true;
		}
		cursor = matchEnd;
	}
}

}  // namespace

namespace bmsx {

/*
	Libretro GLES2 state note:
	- Symptom: live output shows the atlas while RetroArch pause shows the correct frame.
	- Root cause: the core and frontend share the same GL context. If the core leaves
	program/buffer/texture state bound, RetroArch's present blit can inherit that
	state and sample the wrong texture.
	- Fix: reset the bindings we touch at the end of the frame so the frontend starts
	from a clean baseline. This is intentionally minimal to limit overhead.
	- Performance: keep end-of-frame reset minimal and only call glFinish in strict
	debug mode.
*/
OpenGLES2Backend::OpenGLES2Backend(i32 width, i32 height)
	: m_width(width), m_height(height) {}

OpenGLES2Backend::~OpenGLES2Backend() = default;

void OpenGLES2Backend::invalidateTextureBindingCache() {
	m_active_texture_unit = -1;
	m_bound_texture_2d_by_unit.fill(0);
}

TextureHandle OpenGLES2Backend::createTexture(const u8* data, i32 width,
												i32 height,
												const TextureParams& params) {
	if (!m_context_ready) {
		throw std::runtime_error("[GLES2] createTexture called before context reset.");
	}
	auto* tex = new GLES2Texture{};
	tex->width = width;
	tex->height = height;
	tex->logicalSrgb = params.srgb;
	tex->srgb = params.srgb && m_supports_srgb_textures;

	const u8* uploadData = data;
	std::vector<u8> zeroed;
	std::vector<u8> linearized;
	if (uploadData == nullptr) {
		zeroed.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u, 0);
		uploadData = zeroed.data();
	} else if (tex->logicalSrgb && !tex->srgb) {
		convertSrgbToLinear(uploadData, static_cast<size_t>(width) * static_cast<size_t>(height), linearized);
		uploadData = linearized.data();
	}

	const GLint internalFormat = tex->srgb ? static_cast<GLint>(GL_SRGB_ALPHA_EXT) : static_cast<GLint>(GL_RGBA);
	glGenTextures(1, &tex->id);
	glBindTexture(GL_TEXTURE_2D, tex->id);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
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

	const u8* uploadData = data;
	std::vector<u8> linearized;
	if (uploadData != nullptr && logicalSrgb && !useSrgbTexture) {
		convertSrgbToLinear(uploadData, static_cast<size_t>(width) * static_cast<size_t>(height), linearized);
		uploadData = linearized.data();
	}

	glBindTexture(GL_TEXTURE_2D, tex->id);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
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
	std::vector<u8> zeroed(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u, 0);
	glBindTexture(GL_TEXTURE_2D, tex->id);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
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

void OpenGLES2Backend::updateTextureRegion(TextureHandle handle, const u8* data, i32 width, i32 height, i32 x, i32 y, const TextureParams&) {
	if (!m_context_ready) {
		throw std::runtime_error("[GLES2] updateTextureRegion called before context reset.");
	}
	auto* tex = static_cast<GLES2Texture*>(handle);
	const u8* uploadData = data;
	std::vector<u8> linearized;
	if (uploadData != nullptr && tex->logicalSrgb && !tex->srgb) {
		convertSrgbToLinear(uploadData, static_cast<size_t>(width) * static_cast<size_t>(height), linearized);
		uploadData = linearized.data();
	}
	glBindTexture(GL_TEXTURE_2D, tex->id);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
	glTexSubImage2D(GL_TEXTURE_2D, 0, x, y, width, height, GL_RGBA, GL_UNSIGNED_BYTE, uploadData);
	invalidateTextureBindingCache();
	if (kGLES2VerboseLog) {
		std::fprintf(stderr,
						"[BMSX][GLES2] updateTextureRegion id=%u size=%dx%d offset=%d,%d data=%p\n",
						static_cast<unsigned>(tex->id), width, height, x, y,
						static_cast<const void*>(data));
	}
}

void OpenGLES2Backend::readTextureRegion(TextureHandle handle, u8* out, i32 width, i32 height, i32 x, i32 y, const TextureParams&) {
	auto* tex = static_cast<GLES2Texture*>(handle);
	if (!tex || tex->id == 0) {
		throw std::runtime_error("[GLES2] Readback texture missing.");
	}
	if (x < 0 || y < 0 || x + width > tex->width || y + height > tex->height) {
		throw std::runtime_error("[GLES2] Readback out of bounds.");
	}
	glBindFramebuffer(GL_FRAMEBUFFER, m_readback_fbo);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex->id, 0);
	const GLint glY = tex->height - y - height;
	if (glY < 0) {
		throw std::runtime_error("[GLES2] Readback Y coordinate out of bounds.");
	}
	std::vector<u8> linearized;
	u8* readTarget = out;
	if (tex->logicalSrgb && !tex->srgb) {
		linearized.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
		readTarget = linearized.data();
	}
	glPixelStorei(GL_PACK_ALIGNMENT, 1);
	glReadPixels(x, glY, width, height, GL_RGBA, GL_UNSIGNED_BYTE, readTarget);
	glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
	if (readTarget != out) {
		std::vector<u8> encoded;
		convertLinearToSrgb(readTarget, static_cast<size_t>(width) * static_cast<size_t>(height), encoded);
		std::memcpy(out, encoded.data(), encoded.size());
	}
}

TextureHandle OpenGLES2Backend::createSolidTexture2D(i32 width, i32 height,
														const Color& color) {
	std::vector<u8> pixels(static_cast<size_t>(width * height * 4));
	const u8 r = static_cast<u8>(color.r * 255.0f);
	const u8 g = static_cast<u8>(color.g * 255.0f);
	const u8 b = static_cast<u8>(color.b * 255.0f);
	const u8 a = static_cast<u8>(color.a * 255.0f);
	for (size_t i = 0; i < pixels.size(); i += 4) {
	pixels[i + 0] = r;
	pixels[i + 1] = g;
	pixels[i + 2] = b;
	pixels[i + 3] = a;
	}
	TextureParams params;
	params.srgb = false;
	return createTexture(pixels.data(), width, height, params);
}

void OpenGLES2Backend::destroyTexture(TextureHandle handle) {
	auto* tex = static_cast<GLES2Texture*>(handle);
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] destroyTexture id=%u\n",
					static_cast<unsigned>(tex->id));
	}
	glDeleteTextures(1, &tex->id);
	invalidateTextureBindingCache();
	delete tex;
}

void OpenGLES2Backend::copyTexture(TextureHandle source, TextureHandle destination, i32 width, i32 height) {
	copyTextureRegion(source, destination, 0, 0, 0, 0, width, height);
}

void OpenGLES2Backend::copyTextureRegion(TextureHandle source, TextureHandle destination, i32 srcX, i32 srcY, i32 dstX, i32 dstY, i32 width, i32 height) {
	auto* src = static_cast<GLES2Texture*>(source);
	auto* dst = static_cast<GLES2Texture*>(destination);
	const i32 prevActiveUnit = m_active_texture_unit;
	const GLuint prevUploadBinding = m_bound_texture_2d_by_unit[0];
	glBindFramebuffer(GL_FRAMEBUFFER, m_readback_fbo);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, src->id, 0);
	glActiveTexture(GL_TEXTURE0);
	glBindTexture(GL_TEXTURE_2D, dst->id);
	m_active_texture_unit = 0;
	m_bound_texture_2d_by_unit[0] = dst->id;
	glCopyTexSubImage2D(GL_TEXTURE_2D, 0, dstX, dstY, srcX, srcY, width, height);
	glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
	glBindTexture(GL_TEXTURE_2D, prevUploadBinding);
	m_bound_texture_2d_by_unit[0] = prevUploadBinding;
	if (prevActiveUnit >= 0) {
		glActiveTexture(GL_TEXTURE0 + prevActiveUnit);
	}
	invalidateTextureBindingCache();
}

void OpenGLES2Backend::clear(const Color* color, const f32* depth) {
	GLbitfield mask = 0;
	if (color) {
	glClearColor(color->r, color->g, color->b, color->a);
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

	const Color* clearColor = nullptr;
	Color colorValue;
	if (colorSpec && colorSpec->clear) {
	colorValue = *colorSpec->clear;
	clearColor = &colorValue;
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
	// RetroArch can mutate GL state between frames; reset caches so bindings are
	// refreshed.
	invalidateTextureBindingCache();
	m_backbuffer_fbo = static_cast<GLuint>(m_get_framebuffer());
	if (kGLES2VerboseLog) {
	static u32 frameIndex = 0;
	frameIndex++;
	std::fprintf(
		stderr, "[BMSX][GLES2] beginFrame #%u backbuffer_fbo=%u size=%dx%d\n",
		frameIndex, static_cast<unsigned>(m_backbuffer_fbo), m_width, m_height);
	}
	m_current_fbo = m_backbuffer_fbo;
	glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
	glViewport(0, 0, m_width, m_height);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_STENCIL_TEST);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
}

void OpenGLES2Backend::endFrame() {
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] endFrame\n");
	}
	// Reset the core state we touched so frontend present paths don't inherit it.
	glUseProgram(0);
	glBindBuffer(GL_ARRAY_BUFFER, 0);
	glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
	for (int unit = 0; unit <= 3; ++unit) {
		glActiveTexture(GL_TEXTURE0 + unit);
		glBindTexture(GL_TEXTURE_2D, 0);
	}
	glActiveTexture(GL_TEXTURE0);
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
	m_width = width;
	m_height = height;
}

void OpenGLES2Backend::setFramebufferGetter(FramebufferGetter getter) {
	m_get_framebuffer = getter;
}

void OpenGLES2Backend::onContextReset() {
	m_context_ready = true;
	invalidateTextureBindingCache();
	const char* extensions = reinterpret_cast<const char*>(glGetString(GL_EXTENSIONS));
	m_supports_srgb_textures = hasExtensionToken(extensions, "GL_EXT_sRGB");
	glGenFramebuffers(1, &m_readback_fbo);
	if (kGLES2VerboseLog) {
		std::fprintf(stderr, "[BMSX][GLES2] EXT_sRGB=%d\n", m_supports_srgb_textures ? 1 : 0);
	}
}

void OpenGLES2Backend::onContextDestroy() {
	m_context_ready = false;
	invalidateTextureBindingCache();
	m_supports_srgb_textures = false;
	if (m_readback_fbo != 0) {
		glDeleteFramebuffers(1, &m_readback_fbo);
		m_readback_fbo = 0;
	}
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

void OpenGLES2Backend::bindTexture2D(TextureHandle tex) {
	auto* gltex = static_cast<GLES2Texture*>(tex);
	if (!gltex) {
		throw std::runtime_error("[GLES2] bindTexture2D called with null texture.");
	}
	const i32 unit = m_active_texture_unit;
	if (m_bound_texture_2d_by_unit[unit] == gltex->id) return;
	glBindTexture(GL_TEXTURE_2D, gltex->id);
	m_bound_texture_2d_by_unit[unit] = gltex->id;
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] bindTexture2D unit=%d id=%u\n", unit,
					static_cast<unsigned>(gltex->id));
	}
}

void OpenGLES2Backend::setRenderTarget(GLuint fbo, i32 width, i32 height) {
	const bool fboChanged = (m_current_fbo != fbo);
	const bool sizeChanged = (m_width != width) || (m_height != height);
	m_current_fbo = fbo;
	m_width = width;
	m_height = height;
	if (fboChanged) {
		glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
	}
	// CRITICAL FIX: Always update viewport when FBO changes OR size changes
	// Previously, viewport was only updated on size change, which broke rendering
	// when switching between FBOs of same size (e.g., framebuffer text rendering)
	if (fboChanged || sizeChanged) {
		glViewport(0, 0, m_width, m_height);
	}
	if (kGLES2VerboseLog) {
	std::fprintf(stderr, "[BMSX][GLES2] setRenderTarget fbo=%u size=%dx%d%s\n",
					static_cast<unsigned>(fbo), width, height,
					fboChanged ? " (FBO changed)" : sizeChanged ? " (size changed)" : "");
	}
}

}  // namespace bmsx
