/*
 * gles2/backend.h - OpenGL ES 2.0 backend for BMSX
 */

#ifndef BMSX_GLES2_BACKEND_H
#define BMSX_GLES2_BACKEND_H

#include "render/backend/backend.h"
#include <cstdint>
#include <array>
#include <memory>

#include <GLES2/gl2.h>

namespace bmsx {

void applyGLES2TextureParams(const TextureParams& params);

struct GLES2Texture {
	GLuint id = 0;
	i32 width = 0;
	i32 height = 0;
	bool srgb = false;
	bool logicalSrgb = false;
};

struct OpenGLES2PostPipelines;

class OpenGLES2Backend : public GPUBackend {
public:
	using FramebufferGetter = uintptr_t (*)();
	using ProcAddress = void (*)();
	using ProcAddressGetter = ProcAddress (*)(const char*);

	OpenGLES2Backend(i32 width, i32 height);
	~OpenGLES2Backend() override;

	BackendType type() const override { return BackendType::OpenGLES2; }

	TextureHandle createTexture(const u8* data, i32 width, i32 height, const TextureParams& params) override;
	void updateTexture(TextureHandle handle, const u8* data, i32 width, i32 height, const TextureParams& params) override;
	TextureHandle resizeTexture(TextureHandle handle, i32 width, i32 height, const TextureParams& params) override;
	void updateTextureRegion(TextureHandle handle, const u8* data, i32 width, i32 height, i32 x, i32 y, const TextureParams& params) override;
	TextureHandle createSolidTexture2D(i32 width, i32 height, u32 color, const TextureParams& params) override;
	void destroyTexture(TextureHandle handle) override;
	TextureHandle createColorTexture(i32 width, i32 height, const std::array<f32, 4>* initialClearColor) override;
	TextureHandle createDepthTexture(i32 width, i32 height) override;
	void destroyDepthTexture(TextureHandle handle) override;
	void* createRenderTarget(TextureHandle color, TextureHandle depth) override;
	void destroyRenderTarget(void* target) override;
	void activateRenderTarget(void* target, i32 width, i32 height) override;
	void activateDefaultRenderTarget() override;
	void registerBuiltinPasses(RenderPassLibrary& registry) override;

	void clear(const std::array<f32, 4>* color, const f32* depth) override;
	PassEncoder beginRenderPass(const RenderPassDesc& desc) override;
	void endRenderPass(PassEncoder& pass) override;

	void draw(PassEncoder& pass, i32 first, i32 count) override;
	void drawIndexed(PassEncoder& pass, i32 indexCount, i32 firstIndex) override;

	void beginFrame() override;
	void endFrame() override;
	FrameStats getFrameStats() const override { return m_stats; }
	void captureGxGpuVramSnapshot(GxGpu& gxGpu) override;

	BackendCaps getCaps() const override;
	bool readyForTextureUpload() const override { return m_context_ready; }

	void setViewportSize(i32 width, i32 height);
	void setContextCallbacks(FramebufferGetter framebufferGetter, ProcAddressGetter procAddressGetter);
	void onContextReset();
	void onContextDestroy();

	void setActiveTextureUnit(i32 unit);
	void bindTexture2D(TextureHandle tex);
	void invalidateTextureBindingCache();
	void setRenderTarget(GLuint fbo, i32 width, i32 height);
	GLuint buildProgram(const char* vertexShaderSource, const char* fragmentShaderSource, const char* label);
	ProcAddress resolveProcAddress(const char* name) const;
	ProcAddress resolveProcAddress(const char* coreName, const char* angleName, const char* extName) const;
	bool supportsUintIndices() const { return m_supports_uint_indices; }
	bool textureBarrierAvailable() const { return m_texture_barrier != nullptr; }
	void textureBarrier() const { m_texture_barrier(); }
	GLuint backbuffer() const { return m_backbuffer_fbo; }
	u32 contextGeneration() const { return m_context_generation; }

	static GLES2Texture* asTexture(TextureHandle handle) { return static_cast<GLES2Texture*>(handle); }

private:
	static constexpr i32 kTrackedTextureUnits = 16;
	FramebufferGetter m_get_framebuffer = nullptr;
	ProcAddressGetter m_get_proc_address = nullptr;
	GLuint m_current_fbo = 0;
	GLuint m_backbuffer_fbo = 0;
	i32 m_default_width = 0;
	i32 m_default_height = 0;
	i32 m_target_width = 0;
	i32 m_target_height = 0;
	FrameStats m_stats{};
	i32 m_active_texture_unit = -1;
	std::array<GLuint, kTrackedTextureUnits> m_bound_texture_2d_by_unit{};
	std::unique_ptr<OpenGLES2PostPipelines> m_post_pipelines;
	GLuint m_readback_fbo = 0;
	u32 m_context_generation = 0;
	bool m_context_ready = false;
	bool m_supports_srgb_textures = false;
	bool m_supports_uint_indices = false;
	ProcAddress m_texture_barrier = nullptr;
};

} // namespace bmsx

#endif // BMSX_GLES2_BACKEND_H
