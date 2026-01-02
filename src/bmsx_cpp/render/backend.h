/*
 * backend.h - GPU Backend interface for BMSX
 *
 * Mirrors TypeScript GPUBackend interface.
 * For libretro, we implement a software framebuffer backend.
 */

#ifndef BMSX_BACKEND_H
#define BMSX_BACKEND_H

#include "render_types.h"
#include <memory>
#include <functional>
#include <unordered_map>

namespace bmsx {

/* ============================================================================
 * Backend type discriminator
 * ============================================================================ */

enum class BackendType {
    Software,   // CPU software renderer (libretro)
    OpenGLES2,  // OpenGL ES 2.0 (libretro HW)
    WebGL2,     // WebGL2 (browser)
    WebGPU,     // WebGPU (browser)
    Headless    // No rendering (testing)
};

/* ============================================================================
 * Backend capabilities
 * ============================================================================ */

struct BackendCaps {
    i32 maxColorAttachments = 1;
    i32 maxTextureSize = 4096;
    bool supportsInstancing = false;
    bool supportsDepthTexture = true;
};

/* ============================================================================
 * Frame statistics
 * ============================================================================ */

struct FrameStats {
    u32 draws = 0;
    u32 drawIndexed = 0;
    u32 drawsInstanced = 0;
    u32 drawIndexedInstanced = 0;
    u64 bytesUploaded = 0;
};

/* ============================================================================
 * Software texture storage
 * ============================================================================ */

struct SoftwareTexture {
    std::vector<u32> data;  // ARGB32 pixels
    i32 width = 0;
    i32 height = 0;
};

/* ============================================================================
 * Render pass description
 * ============================================================================ */

struct ColorAttachmentSpec {
    TextureHandle tex = nullptr;
    std::optional<Color> clear;
    bool discardAfter = false;
};

struct DepthAttachmentSpec {
    TextureHandle tex = nullptr;
    std::optional<f32> clearDepth;
    bool discardAfter = false;
};

struct RenderPassDesc {
    std::optional<std::string> label;
    std::optional<ColorAttachmentSpec> color;
    std::vector<ColorAttachmentSpec> colors;
    std::optional<DepthAttachmentSpec> depth;
};

/* ============================================================================
 * Pass encoder (active render pass)
 * ============================================================================ */

struct PassEncoder {
    void* fbo = nullptr;
    RenderPassDesc desc;
};

/* ============================================================================
 * GPUBackend - Abstract rendering backend interface
 *
 * This interface mirrors TypeScript's GPUBackend.
 * For libretro, we implement SoftwareBackend which renders to a framebuffer.
 * ============================================================================ */

class GPUBackend {
public:
    virtual ~GPUBackend() = default;

    // ─────────────────────────────────────────────────────────────────────────
    // Backend identification
    // ─────────────────────────────────────────────────────────────────────────
    virtual BackendType type() const = 0;

    // ─────────────────────────────────────────────────────────────────────────
    // Texture management
    // ─────────────────────────────────────────────────────────────────────────
    virtual TextureHandle createTexture(const u8* data, i32 width, i32 height, const TextureParams& params) = 0;
    virtual TextureHandle createSolidTexture2D(i32 width, i32 height, const Color& color) = 0;
    virtual void destroyTexture(TextureHandle handle) = 0;

    // ─────────────────────────────────────────────────────────────────────────
    // Render pass management
    // ─────────────────────────────────────────────────────────────────────────
    virtual void clear(const Color* color, const f32* depth) = 0;
    virtual PassEncoder beginRenderPass(const RenderPassDesc& desc) = 0;
    virtual void endRenderPass(PassEncoder& pass) = 0;

    // ─────────────────────────────────────────────────────────────────────────
    // Drawing commands
    // ─────────────────────────────────────────────────────────────────────────
    virtual void draw(PassEncoder& pass, i32 first, i32 count) = 0;
    virtual void drawIndexed(PassEncoder& pass, i32 indexCount, i32 firstIndex) = 0;

    // ─────────────────────────────────────────────────────────────────────────
    // Frame lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    virtual void beginFrame() = 0;
    virtual void endFrame() = 0;
    virtual FrameStats getFrameStats() const = 0;

    // ─────────────────────────────────────────────────────────────────────────
    // Capabilities
    // ─────────────────────────────────────────────────────────────────────────
    virtual BackendCaps getCaps() const = 0;
};

/* ============================================================================
 * SoftwareBackend - CPU-based software renderer for libretro
 *
 * Renders directly to a framebuffer that libretro presents.
 * ============================================================================ */

class SoftwareBackend : public GPUBackend {
public:
    SoftwareBackend(u32* framebuffer, i32 width, i32 height, i32 pitch);
    ~SoftwareBackend() override;

    BackendType type() const override { return BackendType::Software; }

    // Texture management
    TextureHandle createTexture(const u8* data, i32 width, i32 height, const TextureParams& params) override;
    TextureHandle createSolidTexture2D(i32 width, i32 height, const Color& color) override;
    void destroyTexture(TextureHandle handle) override;

    // Render pass management
    void clear(const Color* color, const f32* depth) override;
    PassEncoder beginRenderPass(const RenderPassDesc& desc) override;
    void endRenderPass(PassEncoder& pass) override;

    // Drawing
    void draw(PassEncoder& pass, i32 first, i32 count) override;
    void drawIndexed(PassEncoder& pass, i32 indexCount, i32 firstIndex) override;

    // Frame lifecycle
    void beginFrame() override;
    void endFrame() override;
    FrameStats getFrameStats() const override { return m_stats; }

    // Capabilities
    BackendCaps getCaps() const override;

    // ─────────────────────────────────────────────────────────────────────────
    // Software-specific drawing primitives
    // ─────────────────────────────────────────────────────────────────────────
    void setPixel(i32 x, i32 y, const Color& color);
    void drawLine(i32 x0, i32 y0, i32 x1, i32 y1, const Color& color);
    void fillRect(i32 x, i32 y, i32 w, i32 h, const Color& color);
    void drawRect(i32 x, i32 y, i32 w, i32 h, const Color& color);
    void blitTexture(TextureHandle tex, i32 srcX, i32 srcY, i32 srcW, i32 srcH,
                     i32 dstX, i32 dstY, i32 dstW, i32 dstH, f32 depth,
                     const Color& tint, bool flipH, bool flipV);

    // Framebuffer access
    u32* framebuffer() { return m_framebuffer; }
    i32 width() const { return m_width; }
    i32 height() const { return m_height; }
    i32 pitch() const { return m_pitch; }

    // Update framebuffer pointer (e.g., on resize)
    void setFramebuffer(u32* fb, i32 width, i32 height, i32 pitch);

private:
    u32* m_framebuffer;
    i32 m_width;
    i32 m_height;
    i32 m_pitch;  // Bytes per row

    FrameStats m_stats;

    // Texture storage
    std::vector<std::unique_ptr<SoftwareTexture>> m_textures;

    // Depth buffer (optional)
    std::vector<f32> m_depthBuffer;

    // Helpers
    void blendPixel(i32 x, i32 y, const Color& color);
};

} // namespace bmsx

#endif // BMSX_BACKEND_H
