/*
 * gameview.h - GameView for BMSX
 *
 * Mirrors TypeScript GameView class.
 * Manages viewport, render submissions, and presentation.
 */

#ifndef BMSX_GAMEVIEW_H
#define BMSX_GAMEVIEW_H

#include "backend.h"
#include "render_types.h"
#include "../core/registry.h"
#include "../subscription.h"
#include <memory>
#include <vector>
#include <functional>

namespace bmsx {

/* ============================================================================
 * Render submission queue
 *
 * Collects render commands during a frame, sorted by layer and Z-order.
 * ============================================================================ */

class RenderQueue {
public:
    void submitSprite(const ImgRenderSubmission& submission);
    void submitRect(const RectRenderSubmission& submission);
    void submitPoly(const PolyRenderSubmission& submission);
    void submitGlyphs(const GlyphRenderSubmission& submission);

    void clear();
    void sortByDepth();

    // Access for rendering
    const std::vector<ImgRenderSubmission>& sprites() const { return m_sprites; }
    const std::vector<RectRenderSubmission>& rects() const { return m_rects; }
    const std::vector<PolyRenderSubmission>& polys() const { return m_polys; }
    const std::vector<GlyphRenderSubmission>& glyphs() const { return m_glyphs; }

private:
    std::vector<ImgRenderSubmission> m_sprites;
    std::vector<RectRenderSubmission> m_rects;
    std::vector<PolyRenderSubmission> m_polys;
    std::vector<GlyphRenderSubmission> m_glyphs;
};

/* ============================================================================
 * Atmosphere parameters (fog, etc.)
 * ============================================================================ */

struct AtmosphereParams {
    f32 fogD50 = 320.0f;
    f32 fogStart = 120.0f;
    std::array<f32, 3> fogColorLow = {0.90f, 0.95f, 1.00f};
    std::array<f32, 3> fogColorHigh = {1.05f, 1.02f, 0.95f};
    f32 fogYMin = 0.0f;
    f32 fogYMax = 200.0f;
    f32 progressFactor = 0.0f;
    bool enableAutoAnimation = false;
};

/* ============================================================================
 * CRT post-processing options
 * ============================================================================ */

struct CRTOptions {
    bool applyNoise = true;
    f32 noiseIntensity = 0.4f;
    bool applyColorBleed = true;
    std::array<f32, 3> colorBleed = {0.02f, 0.0f, 0.0f};
    bool applyScanlines = true;
    bool applyBlur = true;
    bool applyGlow = true;
    bool applyFringing = true;
    bool applyAperture = true;
    f32 blurIntensity = 0.6f;
    std::array<f32, 3> glowColor = {0.12f, 0.10f, 0.09f};
};

/* ============================================================================
 * GameView - Main rendering view
 *
 * IMPORTANT: Unlike TypeScript, we don't have separate canvas/offscreen sizes.
 * For libretro, viewportSize IS the framebuffer size.
 * ============================================================================ */

class GameView : public Registerable {
public:
    GameView(i32 viewportWidth, i32 viewportHeight);
    ~GameView();

    // ─────────────────────────────────────────────────────────────────────────
    // Registerable interface
    // ─────────────────────────────────────────────────────────────────────────
    const Identifier& registryId() const override {
        static const Identifier viewId = "view";
        return viewId;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Backend management
    // ─────────────────────────────────────────────────────────────────────────
    void setBackend(std::unique_ptr<GPUBackend> backend);
    GPUBackend* backend() { return m_backend.get(); }
    BackendType backendType() const;

    // ─────────────────────────────────────────────────────────────────────────
    // Viewport
    // ─────────────────────────────────────────────────────────────────────────
    Vec2 viewportSize() const { return m_viewportSize; }
    void setViewportSize(i32 width, i32 height);

    // ─────────────────────────────────────────────────────────────────────────
    // Frame rendering
    // ─────────────────────────────────────────────────────────────────────────
    void beginFrame();
    void drawGame();
    void endFrame();

    // ─────────────────────────────────────────────────────────────────────────
    // Render submission (mirrors TypeScript renderer.submit)
    // ─────────────────────────────────────────────────────────────────────────
    struct Renderer {
        struct Submit {
            std::function<void(const ImgRenderSubmission&)> sprite;
            std::function<void(const RectRenderSubmission&)> rect;
            std::function<void(const PolyRenderSubmission&)> poly;
            std::function<void(const GlyphRenderSubmission&)> glyphs;
        } submit;
    };
    Renderer renderer;

    // Direct submission methods (used internally and by components)
    void submitSprite(const ImgRenderSubmission& submission);
    void submitRect(const RectRenderSubmission& submission);
    void submitPoly(const PolyRenderSubmission& submission);
    void submitGlyphs(const GlyphRenderSubmission& submission);

    // Convenience methods (mirror TypeScript)
    void fillRectangle(const RectBounds& area, const Color& color);
    void drawRectangle(const RectBounds& area, const Color& color);
    void drawLine(i32 x0, i32 y0, i32 x1, i32 y1, const Color& color);

    // ─────────────────────────────────────────────────────────────────────────
    // Post-processing settings
    // ─────────────────────────────────────────────────────────────────────────
    CRTOptions crtOptions;
    bool crt_postprocessing_enabled = true;
    bool psx_dither_2d_enabled = true;
    f32 psx_dither2d_intensity = 1.0f;

    // ─────────────────────────────────────────────────────────────────────────
    // Sprite ambient settings
    // ─────────────────────────────────────────────────────────────────────────
    bool spriteAmbientEnabledDefault = false;
    f32 spriteAmbientFactorDefault = 1.0f;

    // ─────────────────────────────────────────────────────────────────────────
    // Atmosphere
    // ─────────────────────────────────────────────────────────────────────────
    AtmosphereParams atmosphere;

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    void bind();
    void unbind();
    void dispose();
    void reset();

private:
    void initializeRenderer();
    void executeRenderPasses();
    void renderSprites();
    void renderRects();
    void renderPolys();
    void renderGlyphs();

    std::unique_ptr<GPUBackend> m_backend;
    Vec2 m_viewportSize;

    RenderQueue m_worldQueue;
    RenderQueue m_uiQueue;
};

} // namespace bmsx

#endif // BMSX_GAMEVIEW_H
