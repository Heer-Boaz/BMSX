#include "render/backend/gles2/gx_gpu_draw_targets.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/gx_gpu_render_rules.h"
#include <cstdio>

namespace bmsx {

void GxGpuDrawTargets::initialize(OpenGLES2Backend& backend, GxGpuDrawTargetMode mode,
	GLES2Texture& base, GLuint baseFramebuffer, GLES2Texture& baseSample) {
	m_backend = &backend; m_mode = mode; m_base = &base; m_baseFramebuffer = baseFramebuffer; m_baseSample = &baseSample;
	m_baseBounds = {0, 0, base.width, base.height};
	if (!enabled()) return;
	const char* defines[]{"", "#define GX_GPU_CACHE_LOAD_RGB5 1\n", "#define GX_GPU_CACHE_STORE_RGB5 1\n"};
	const GLES2AttributeBinding bindings[]{{0, "a_position"}};
	for (size_t i = 0; i < m_copyPrograms.size(); ++i) {
		auto& program = m_copyPrograms[i];
		program.id = backend.buildProgram(kGxGpuCacheCopyVertexShader, kGxGpuCacheCopyFragmentShader,
			"gx_vram_cache_copy", defines[i], bindings);
		program.region = glGetUniformLocation(program.id, "u_region");
		glUseProgram(program.id); glUniform1i(glGetUniformLocation(program.id, "u_source"), 0);
	}
	const GLfloat vertices[]{-1, -1, 3, -1, -1, 3};
	glGenBuffers(1, &m_vertices); glBindBuffer(GL_ARRAY_BUFFER, m_vertices);
	glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
	for (auto& entry : m_entries) {
		glGenTextures(1, &entry.color.id); glGenTextures(1, &entry.sample.id);
		glGenFramebuffers(1, &entry.framebuffer); glGenFramebuffers(1, &entry.sampleFramebuffer);
		allocate(entry, 1, 1);
	}
}

void GxGpuDrawTargets::allocate(Entry& entry, i32 width, i32 height) {
	m_backend->setRenderTarget(0, m_base->width, m_base->height);
	GLES2Texture* textures[]{&entry.color, &entry.sample};
	const GLuint framebuffers[]{entry.framebuffer, entry.sampleFramebuffer};
	for (size_t i = 0; i < 2; ++i) {
		auto& texture = *textures[i];
		texture.width = width; texture.height = height; texture.generation = m_backend->contextGeneration();
		m_backend->setActiveTextureUnit(0); m_backend->bindTexture2D(&texture);
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA,
			rgb5() ? GL_UNSIGNED_SHORT_5_5_5_1 : GL_UNSIGNED_SHORT_4_4_4_4, nullptr);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
		m_backend->setRenderTarget(framebuffers[i], width, height);
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture.id, 0);
	}
	++m_resizes;
}

void GxGpuDrawTargets::copy(GLES2Texture& source, GLuint framebuffer, i32 targetWidth, i32 targetHeight,
	i32 sourceX, i32 sourceY, i32 targetX, i32 targetY, i32 width, i32 height,
	bool sourceRgb5, bool targetRgb5) {
	const auto& program = m_copyPrograms[sourceRgb5 == targetRgb5 ? 0 : (targetRgb5 ? 1 : 2)];
	m_backend->setRenderTarget(framebuffer, targetWidth, targetHeight);
	m_backend->setActiveTextureUnit(0); m_backend->bindTexture2D(&source);
	glViewport(targetX, targetY, width, height);
	glDisable(GL_SCISSOR_TEST); glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE); glDisable(GL_BLEND); glDisable(GL_DITHER);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glUseProgram(program.id);
	glUniform4f(program.region, static_cast<f32>(sourceX) / source.width, static_cast<f32>(sourceY) / source.height,
		static_cast<f32>(width) / source.width, static_cast<f32>(height) / source.height);
	glBindBuffer(GL_ARRAY_BUFFER, m_vertices); glEnableVertexAttribArray(0);
	glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, 3);
}

void GxGpuDrawTargets::materialize(Entry& entry, GxGpuVramCopyRect& globalDirty) {
	const auto& dirty = entry.dirty;
	if (dirty.right <= dirty.left || dirty.bottom <= dirty.top) return;
	copy(entry.color, m_baseFramebuffer, m_base->width, m_base->height,
		dirty.left - entry.bounds.left, dirty.top - entry.bounds.top, dirty.left, dirty.top,
		dirty.right - dirty.left, dirty.bottom - dirty.top, rgb5(), false);
	includeGxGpuVramCopyRect(globalDirty, dirty);
	entry.dirty = {};
	++m_resolves;
}

void GxGpuDrawTargets::select(const GxGpuVramCopyRect& bounds, GxGpuVramCopyRect& globalDirty) {
	if (!enabled()) return;
	++m_selections;
	for (size_t i = 0; i < m_entries.size(); ++i) {
		auto& entry = m_entries[i];
		if (entry.valid && bounds.left >= entry.bounds.left && bounds.right <= entry.bounds.right
			&& bounds.top >= entry.bounds.top && bounds.bottom <= entry.bounds.bottom) {
			m_current = i; entry.used = ++m_clock; return;
		}
	}
	// Allocation granularity, not a guest-coordinate conversion. Physical
	// extents remain within the installed, 64-pixel-aligned storage domain.
	const GxGpuVramCopyRect region{bounds.left & ~63, bounds.top & ~63,
		(bounds.right + 63) & ~63, (bounds.bottom + 63) & ~63};
	resolve(region, globalDirty, true);
	m_current = !m_entries[0].valid ? 0 : (!m_entries[1].valid ? 1 : (m_entries[0].used <= m_entries[1].used ? 0 : 1));
	auto& entry = m_entries[m_current];
	materialize(entry, globalDirty);
	const i32 width = region.right - region.left, height = region.bottom - region.top;
	if (entry.color.width != width || entry.color.height != height) allocate(entry, width, height);
	entry.bounds = region; entry.valid = true; entry.used = ++m_clock;
	entry.dirty = {}; entry.sampleDirty = region;
	copy(*m_base, entry.framebuffer, width, height, region.left, region.top, 0, 0, width, height, false, rgb5());
	++m_revision;
}

void GxGpuDrawTargets::markDrawn(const GxGpuVramCopyRect& bounds) {
	auto& entry = m_entries[m_current];
	includeGxGpuVramCopyRect(entry.dirty, bounds);
	includeGxGpuVramCopyRect(entry.sampleDirty, bounds);
}

void GxGpuDrawTargets::synchronizeDestination(const GxGpuVramCopyRect& bounds) {
	auto& entry = m_entries[m_current];
	if (!gxGpuPhysicalVramRectsOverlap(bounds, entry.sampleDirty)) return;
	const auto& dirty = entry.sampleDirty;
	const i32 x = dirty.left - entry.bounds.left, y = dirty.top - entry.bounds.top;
	copy(entry.color, entry.sampleFramebuffer, entry.sample.width, entry.sample.height,
		x, y, x, y, dirty.right - dirty.left, dirty.bottom - dirty.top, rgb5(), rgb5());
	entry.sampleDirty = {};
	++m_sampleCopies;
}

void GxGpuDrawTargets::resolve(const GxGpuVramCopyRect& bounds, GxGpuVramCopyRect& globalDirty, bool invalidate) {
	if (!enabled()) return;
	for (auto& entry : m_entries) if (entry.valid && gxGpuPhysicalVramRectsOverlap(entry.bounds, bounds)) {
		materialize(entry, globalDirty);
		if (invalidate) { entry.valid = false; ++m_revision; }
	}
}

void GxGpuDrawTargets::resolveLogical(u32 x, u32 y, u32 width, u32 height, u32 yAddressWord,
	GxGpuVramCopyRect& globalDirty, bool invalidate) {
	if (!enabled()) return;
	for (auto& entry : m_entries) if (entry.valid && gxGpuVramLogicalAreaOverlapsBounds(x, y, width, height,
		entry.bounds.left, entry.bounds.top, entry.bounds.right, entry.bounds.bottom,
		yAddressWord, static_cast<u32>(m_base->height - 1))) {
		materialize(entry, globalDirty);
		if (invalidate) { entry.valid = false; ++m_revision; }
	}
}

void GxGpuDrawTargets::resolveAll(GxGpuVramCopyRect& globalDirty) {
	if (!enabled()) return;
	for (auto& entry : m_entries) if (entry.valid) materialize(entry, globalDirty);
}

void GxGpuDrawTargets::replace() {
	for (auto& entry : m_entries) { entry.valid = false; entry.dirty = {}; entry.sampleDirty = {}; }
	++m_revision;
}

const GxGpuVramCopyRect& GxGpuDrawTargets::bounds() const { return enabled() ? m_entries[m_current].bounds : m_baseBounds; }
GLES2Texture& GxGpuDrawTargets::destinationSample() { return enabled() ? m_entries[m_current].sample : *m_baseSample; }
GLES2Texture& GxGpuDrawTargets::color() { return enabled() ? m_entries[m_current].color : *m_base; }
void GxGpuDrawTargets::bind() {
	if (!enabled()) { m_backend->setRenderTarget(m_baseFramebuffer, m_base->width, m_base->height); return; }
	auto& entry = m_entries[m_current];
	m_backend->setRenderTarget(entry.framebuffer, entry.color.width, entry.color.height);
	glViewport(-entry.bounds.left, -entry.bounds.top, GX_GPU_VRAM_X_ADDRESS_PERIOD, GX_GPU_VRAM_Y_ADDRESS_PERIOD);
}

void GxGpuDrawTargets::bindHardwareBlend(u32 mode) {
	glEnable(GL_BLEND);
	glBlendEquationSeparate(mode == 2u ? GL_FUNC_REVERSE_SUBTRACT : GL_FUNC_ADD, GL_FUNC_ADD);
	if (mode == 0u) {
		// Validated Mali-400 RGB5_A1 quantization profile. Quarter-foreground
		// truncation is performed on the source in the fragment datapath.
		constexpr GLfloat half = 0.5f - 1.0f / 256.0f;
		m_backend->setBlendColor(half, half, half, half);
		glBlendFuncSeparate(GL_CONSTANT_COLOR, GL_CONSTANT_COLOR, GL_ONE, GL_ZERO);
	} else glBlendFuncSeparate(GL_ONE, GL_ONE, GL_ONE, GL_ZERO);
}

void GxGpuDrawTargets::shutdown() {
	if (!enabled()) return;
	if (m_backend->profilesGxUploads()) std::fprintf(stderr,
		"[gx-cache] format=%s hardware_blending=%d selections=%llu resizes=%llu resolves=%llu sample_copies=%llu\n",
		rgb5() ? "rgb5" : "nibbles", hardwareBlending() ? 1 : 0,
		static_cast<unsigned long long>(m_selections), static_cast<unsigned long long>(m_resizes),
		static_cast<unsigned long long>(m_resolves), static_cast<unsigned long long>(m_sampleCopies));
	for (auto& entry : m_entries) {
		glDeleteTextures(1, &entry.color.id); glDeleteTextures(1, &entry.sample.id);
		glDeleteFramebuffers(1, &entry.framebuffer); glDeleteFramebuffers(1, &entry.sampleFramebuffer);
	}
	for (const auto& program : m_copyPrograms) glDeleteProgram(program.id);
	glDeleteBuffers(1, &m_vertices);
}

} // namespace bmsx
