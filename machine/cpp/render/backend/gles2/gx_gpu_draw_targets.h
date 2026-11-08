#pragma once

#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/gx_gpu_vram_rect.h"

namespace bmsx {

// Cached regions are disjoint. The base word texture owns all other addresses;
// dirty regions retain newer words until a base-texture consumer observes them.
class GxGpuDrawTargets {
public:
	void initialize(OpenGLES2Backend& backend, GxGpuDrawTargetMode mode,
		GLES2Texture& base, GLuint baseFramebuffer, GLES2Texture& baseSample);
	void shutdown();
	bool enabled() const { return m_mode != GxGpuDrawTargetMode::FullVram; }
	bool rgb5() const { return m_mode == GxGpuDrawTargetMode::SmallRgb5 || hardwareBlending(); }
	bool hardwareBlending() const { return m_mode == GxGpuDrawTargetMode::SmallRgb5Mali; }
	void bindHardwareBlend(u32 mode);
	void select(const GxGpuVramCopyRect& bounds, GxGpuVramCopyRect& globalDirty);
	void markDrawn(const GxGpuVramCopyRect& bounds);
	void synchronizeDestination(const GxGpuVramCopyRect& bounds);
	void resolve(const GxGpuVramCopyRect& bounds, GxGpuVramCopyRect& globalDirty, bool invalidate);
	void resolveLogical(u32 x, u32 y, u32 width, u32 height, u32 yAddressWord,
		GxGpuVramCopyRect& globalDirty, bool invalidate);
	void resolveAll(GxGpuVramCopyRect& globalDirty);
	void replace();
	void bind();
	const GxGpuVramCopyRect& bounds() const;
	GLES2Texture& destinationSample();
	GLES2Texture& color();
	const GxGpuVramCopyRect& scanoutBounds(size_t index) const { return m_entries[index].bounds; }
	bool valid(size_t index) const { return m_entries[index].valid; }
	GLES2Texture& scanoutTexture(size_t index) { return m_entries[index].color; }
	u64 revision() const { return m_revision; }

private:
	struct Entry {
		GLES2Texture color{}, sample{};
		GLuint framebuffer = 0, sampleFramebuffer = 0;
		GxGpuVramCopyRect bounds{}, dirty{}, sampleDirty{};
		u64 used = 0;
		bool valid = false;
	};
	struct CopyProgram { GLuint id = 0; GLint region = -1; };
	void allocate(Entry& entry, i32 width, i32 height);
	void materialize(Entry& entry, GxGpuVramCopyRect& globalDirty);
	void copy(GLES2Texture& source, GLuint framebuffer, i32 targetWidth, i32 targetHeight,
		i32 sourceX, i32 sourceY, i32 targetX, i32 targetY, i32 width, i32 height,
		bool sourceRgb5, bool targetRgb5);

	OpenGLES2Backend* m_backend = nullptr;
	GxGpuDrawTargetMode m_mode = GxGpuDrawTargetMode::FullVram;
	GLES2Texture* m_base = nullptr;
	GLES2Texture* m_baseSample = nullptr;
	GLuint m_baseFramebuffer = 0, m_vertices = 0;
	GxGpuVramCopyRect m_baseBounds{};
	std::array<Entry, 2> m_entries{};
	std::array<CopyProgram, 3> m_copyPrograms{};
	size_t m_current = 0;
	u64 m_clock = 0, m_revision = 1;
	u64 m_selections = 0, m_resizes = 0, m_resolves = 0, m_sampleCopies = 0;
};

} // namespace bmsx
