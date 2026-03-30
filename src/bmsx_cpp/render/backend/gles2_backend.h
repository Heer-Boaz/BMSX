/*
 * gles2_backend.h - OpenGL ES 2.0 backend for BMSX
 */

#ifndef BMSX_GLES2_BACKEND_H
#define BMSX_GLES2_BACKEND_H

#include "backend.h"
#include <cstdint>
#include <array>

#include <GLES2/gl2.h>

namespace bmsx {

struct GLES2Texture {
	GLuint id = 0;
	i32 width = 0;
	i32 height = 0;
	bool srgb = false;
	bool logicalSrgb = false;
};

class OpenGLES2Backend : public GPUBackend {
public:
	using FramebufferGetter = uintptr_t (*)();

	OpenGLES2Backend(i32 width, i32 height);
	~OpenGLES2Backend() override;

	BackendType type() const override { return BackendType::OpenGLES2; }

	TextureHandle createTexture(const u8* data, i32 width, i32 height, const TextureParams& params) override;
	void updateTexture(TextureHandle handle, const u8* data, i32 width, i32 height, const TextureParams& params) override;
	TextureHandle resizeTexture(TextureHandle handle, i32 width, i32 height, const TextureParams& params) override;
	void updateTextureRegion(TextureHandle handle, const u8* data, i32 width, i32 height, i32 x, i32 y, const TextureParams& params) override;
	void readTextureRegion(TextureHandle handle, u8* out, i32 width, i32 height, i32 x, i32 y, const TextureParams& params) override;
	TextureHandle createSolidTexture2D(i32 width, i32 height, const Color& color) override;
	void destroyTexture(TextureHandle handle) override;
	void copyTexture(TextureHandle source, TextureHandle destination, i32 width, i32 height) override;

	void clear(const Color* color, const f32* depth) override;
	PassEncoder beginRenderPass(const RenderPassDesc& desc) override;
	void endRenderPass(PassEncoder& pass) override;

	void draw(PassEncoder& pass, i32 first, i32 count) override;
	void drawIndexed(PassEncoder& pass, i32 indexCount, i32 firstIndex) override;

	void beginFrame() override;
	void endFrame() override;
	FrameStats getFrameStats() const override { return m_stats; }

	BackendCaps getCaps() const override;
	bool readyForTextureUpload() const override { return m_context_ready; }

	void setViewportSize(i32 width, i32 height);
	void setFramebufferGetter(FramebufferGetter getter);
	void onContextReset();
	void onContextDestroy();

	void setActiveTextureUnit(i32 unit);
	void bindTexture2D(TextureHandle tex);
	void setRenderTarget(GLuint fbo, i32 width, i32 height);
	GLuint backbuffer() const { return m_backbuffer_fbo; }

	static GLES2Texture* asTexture(TextureHandle handle) { return static_cast<GLES2Texture*>(handle); }

private:
	static constexpr i32 kTrackedTextureUnits = 16;
	FramebufferGetter m_get_framebuffer = nullptr;
	GLuint m_current_fbo = 0;
	GLuint m_backbuffer_fbo = 0;
	i32 m_width = 0;
	i32 m_height = 0;
	FrameStats m_stats{};
	i32 m_active_texture_unit = -1;
	std::array<GLuint, kTrackedTextureUnits> m_bound_texture_2d_by_unit{};
	GLuint m_readback_fbo = 0;
	bool m_context_ready = false;
	bool m_supports_srgb_textures = false;
};

} // namespace bmsx

#endif // BMSX_GLES2_BACKEND_H
