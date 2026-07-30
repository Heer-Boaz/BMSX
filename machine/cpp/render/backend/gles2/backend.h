/*
 * gles2/backend.h - OpenGL ES 2.0 backend for BMSX
 */

#ifndef BMSX_GLES2_BACKEND_H
#define BMSX_GLES2_BACKEND_H

#include "render/backend/backend.h"
#include <array>
#include <cstdint>
#include <memory>
#include <span>

#include <GLES2/gl2.h>

namespace bmsx {

void applyGLES2TextureParams(const TextureParams& params);

struct GLES2Texture {
	GLuint id = 0;
	u32 generation = 0;
	i32 width = 0;
	i32 height = 0;
	bool srgb = false;
	bool logicalSrgb = false;
};

struct OpenGLES2GxGpuState;
struct OpenGLES2GxGpuStateDeleter {
	void operator()(OpenGLES2GxGpuState* state) const noexcept;
};
struct OpenGLES2Pipelines;
struct RenderPassStateStorage;
class VideoPresenter;

struct GLES2AttributeBinding {
	GLuint location;
	const char* name;
};

struct GxCpuToVramProfileFrame {
	u64 renderFrameSerial;
	u64 commands;
	u64 logicalBytes;
	u64 hostCalls;
	u64 hostBytes;
	u64 cpuNanoseconds;
	u64 maxCommandNanoseconds;
};

class OpenGLES2Backend : public GPUBackend {
public:
	using FramebufferGetter = uintptr_t (*)();
	using ProcAddress = void (*)();
	using ProcAddressGetter = ProcAddress (*)(const char*);

	OpenGLES2Backend(i32 width, i32 height, bool profileGxUploads, u32 gxGpuVramByteCount);
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
	void resizePresentationTarget(i32 width, i32 height) override;

	void clear(const std::array<f32, 4>* color, const f32* depth) override;
	PassEncoder beginRenderPass(const RenderPassDesc& desc) override;
	void endRenderPass(PassEncoder& pass) override;

	void draw(PassEncoder& pass, i32 first, i32 count) override;
	void drawIndexed(PassEncoder& pass, i32 indexCount, i32 firstIndex) override;

	void beginFrame() override;
	void endFrame() override;
	FrameStats getFrameStats() const override { return m_stats; }
	void executeGxGpuReadback(GxGpu& gxGpu) override;
	void captureGxGpuVramSnapshot(GxGpu& gxGpu) override;

	BackendCaps getCaps() const override;
	bool readyForTextureUpload() const override { return m_context_ready; }

	void setContextCallbacks(FramebufferGetter framebufferGetter, ProcAddressGetter procAddressGetter);
	void onContextReset();
	void onContextDestroy();
	void onContextLost();

	void setActiveTextureUnit(i32 unit);
	void bindTexture2D(TextureHandle tex);
	void invalidateTextureBindingCache();
	void setBlendColor(GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha);
	GLuint framebufferName(void* target) const;
	void setRenderTarget(GLuint fbo, i32 width, i32 height);
	GLuint compileShader(
		GLenum type,
		const char* source,
		const char* label,
		const char* stage,
		const char* shaderDefines = nullptr);
	// Program linking borrows both shader names; the compiling build operation owns deletion.
	GLuint linkProgram(
		GLuint vertexShader,
		GLuint fragmentShader,
		const char* label,
		std::span<const GLES2AttributeBinding> attributeBindings = {});
	// Shared-vertex builds borrow the vertex shader and own the fragment shader they compile.
	GLuint buildProgramWithVertexShader(
		GLuint vertexShader,
		const char* fragmentShaderSource,
		const char* label,
		const char* shaderDefines = nullptr,
		std::span<const GLES2AttributeBinding> attributeBindings = {});
	GLuint buildProgram(
		const char* vertexShaderSource,
		const char* fragmentShaderSource,
		const char* label,
		const char* shaderDefines = nullptr,
		std::span<const GLES2AttributeBinding> attributeBindings = {});
	ProcAddress resolveProcAddress(const char* name) const;
	ProcAddress resolveProcAddress(const char* coreName, const char* angleName, const char* extName) const;
	bool supportsUintIndices() const { return m_supports_uint_indices; }
	bool armFramebufferFetchAvailable() const { return m_arm_framebuffer_fetch_available; }
	bool textureBarrierAvailable() const { return m_texture_barrier != nullptr; }
	void textureBarrier() const { m_texture_barrier(); }
	GLuint backbuffer() const { return m_backbuffer_fbo; }
	u32 contextGeneration() const { return m_context_generation; }
	bool profilesGxUploads() const { return m_profile_gx_uploads; }
	u32 gxGpuVramTextureRows() const { return m_gx_gpu_vram_texture_rows; }
	bool readGxCpuToVramProfileFrame(u64 afterRenderFrameSerial, GxCpuToVramProfileFrame& frame) const;
	void recordGxCpuToVramUpload(u64 logicalBytes, u64 hostCalls, u64 hostBytes, u64 cpuNanoseconds);

	static GLES2Texture* asTexture(TextureHandle handle) { return static_cast<GLES2Texture*>(handle); }

private:
	friend void initGxGpu(OpenGLES2Backend& backend);
	friend void shutdownGxGpu(OpenGLES2Backend& backend);
	friend void executeGxGpuPass(
		GPUBackend* backend,
		VideoPresenter* presenter,
		void* framebuffer,
		RenderPassStateStorage& state,
		void* context,
		const GxGpuDeviceOutput& output);

	static constexpr i32 kTrackedTextureUnits = 16;
	void bindTextureForUpload(GLuint texture, const TextureParams& params);
	FramebufferGetter m_get_framebuffer = nullptr;
	ProcAddressGetter m_get_proc_address = nullptr;
	GLuint m_current_fbo = 0;
	GLuint m_backbuffer_fbo = 0;
	i32 m_default_width = 0;
	i32 m_default_height = 0;
	i32 m_target_width = 0;
	i32 m_target_height = 0;
	FrameStats m_stats{};
	bool m_profile_gx_uploads = false;
	u32 m_gx_gpu_vram_texture_rows = 0u;
	GxCpuToVramProfileFrame m_gx_cpu_to_vram_profile_frame{};
	i32 m_active_texture_unit = -1;
	std::array<GLuint, kTrackedTextureUnits> m_bound_texture_2d_by_unit{};
	u32 m_touched_texture_units = 0u;
	GLfloat m_blend_red = 0.0f;
	GLfloat m_blend_green = 0.0f;
	GLfloat m_blend_blue = 0.0f;
	GLfloat m_blend_alpha = 0.0f;
	bool m_blend_color_valid = false;
	std::unique_ptr<OpenGLES2Pipelines> m_pipelines;
	GLuint m_readback_fbo = 0;
	u32 m_context_generation = 0;
	bool m_context_ready = false;
	bool m_supports_srgb_textures = false;
	bool m_supports_uint_indices = false;
	bool m_arm_framebuffer_fetch_available = false;
	ProcAddress m_texture_barrier = nullptr;
	std::unique_ptr<OpenGLES2GxGpuState, OpenGLES2GxGpuStateDeleter> m_gx_gpu;
};

} // namespace bmsx

#endif // BMSX_GLES2_BACKEND_H
