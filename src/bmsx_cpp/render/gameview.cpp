/*
 * gameview.cpp - GameView implementation
 *
 * Mirrors TypeScript GameView class.
 * Uses RenderQueues for sprite/mesh/particle submission.
 */

#include "gameview.h"
#include "sprites_pipeline.h"
#if BMSX_ENABLE_GLES2
#include "gles2_backend.h"
#endif
#include "renderpasslib.h"
#include "rendergraph.h"
#include "glyphs.h"
#include "../core/engine.h"
#include "../core/font.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>

namespace bmsx {

/* ============================================================================
 * GameView implementation
 * ============================================================================ */

GameView::GameView(i32 viewportWidth, i32 viewportHeight)
    : viewportSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
    , canvasSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
    , offscreenCanvasSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
    , windowSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
    , availableWindowSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
{
    initializeRenderer();
}

GameView::~GameView() {
    dispose();
}

/**
 * Initialize the renderer submit functions.
 *
 * Mirrors TypeScript GameView.renderer.submit structure.
 * Each submit function routes to the appropriate pipeline.
 */
void GameView::initializeRenderer() {
    // sprite -> SpritesPipeline.drawImg
    renderer.submit.sprite = [](const ImgRenderSubmission& s) {
        SpritesPipeline::drawImg(s);
    };

    // rect -> SpritesPipeline.fillRectangle / drawRectangle
    renderer.submit.rect = [](const RectRenderSubmission& s) {
        if (s.kind == RectRenderSubmission::Kind::Fill) {
            SpritesPipeline::fillRectangle(s);
        } else {
            SpritesPipeline::drawRectangle(s);
        }
    };

    // poly -> SpritesPipeline.drawPolygon
    renderer.submit.poly = [](const PolyRenderSubmission& s) {
        const f32 thickness = s.thickness.value_or(1.0f);
        SpritesPipeline::drawPolygon(s.points, s.z, s.color, thickness, s.layer);
    };

    // glyphs -> renderGlyphs (uses font + sprite rendering)
    renderer.submit.glyphs = [this](const GlyphRenderSubmission& s) {
        BFont* font = s.font ? s.font : default_font;
        if (!font) {
            throw std::runtime_error("[GameView] No font available for glyph rendering.");
        }
        std::vector<std::string> lines = s.glyphs;
        if (s.wrap_chars && *s.wrap_chars > 0 && lines.size() == 1) {
            lines = wrapGlyphs(lines[0], *s.wrap_chars);
        }
        f32 x = s.x;
        if (s.center_block_width && *s.center_block_width > 0) {
            x += calculateCenteredBlockX(lines, font->char_width('a'), *s.center_block_width);
        }
        const f32 z = s.z.value_or(950.0f);
        renderGlyphs(this, x, s.y, lines, s.glyph_start, s.glyph_end, z, font, s.color, s.background_color, s.layer);
    };

    // particle -> ParticlesPipeline (TODO)
    renderer.submit.particle = [](const ParticleRenderSubmission& s) {
        RenderQueues::submit_particle(s);
    };

    // mesh -> MeshPipeline (TODO)
    renderer.submit.mesh = [](const MeshRenderSubmission& s) {
        RenderQueues::submitMesh(s);
    };
}

void GameView::setBackend(std::unique_ptr<GPUBackend> backend) {
    m_backend = std::move(backend);
}

BackendType GameView::backendType() const {
    return m_backend ? m_backend->type() : BackendType::Headless;
}

void GameView::setViewportSize(i32 width, i32 height) {
    viewportSize.x = static_cast<f32>(width);
    viewportSize.y = static_cast<f32>(height);
}

void GameView::configureRenderTargets(const Vec2* viewport, const Vec2* canvas, const Vec2* offscreen) {
    bool viewportChanged = false;
    bool canvasChanged = false;
    bool offscreenChanged = false;

    if (viewport) {
        viewportChanged = (viewportSize.x != viewport->x || viewportSize.y != viewport->y);
        viewportSize = *viewport;
    }
    if (canvas) {
        canvasChanged = (canvasSize.x != canvas->x || canvasSize.y != canvas->y);
        canvasSize = *canvas;
    }
    if (offscreen) {
        offscreenChanged = (offscreenCanvasSize.x != offscreen->x || offscreenCanvasSize.y != offscreen->y);
        offscreenCanvasSize = *offscreen;
    }

    if (!(viewportChanged || canvasChanged || offscreenChanged)) {
        return;
    }

    rebuildGraph();
}

void GameView::init() {
    // Backend resources are configured externally via setBackend()
    rebuildGraph();
}

void GameView::beginFrame() {
    if (!m_backend) return;
    m_backend->beginFrame();
}

/**
 * Main render loop - executes the render graph.
 *
 * Mirrors TypeScript GameView.drawgame().
 * The render graph calls individual pipelines (sprites, meshes, particles, CRT, etc.)
 * in the correct order.
 */
void GameView::drawGame() {
    if (!m_backend) return;

    // Increment frame timing
    m_renderFrameIndex++;

#if !BMSX_ENABLE_GLES2
    if (m_backend->type() == BackendType::OpenGLES2) {
        throw std::runtime_error("[GameView] OpenGLES2 backend disabled at compile time.");
    }
#else
    if (m_backend->type() == BackendType::OpenGLES2) {
        FrameData frame;
        frame.frameIndex = static_cast<u32>(m_renderFrameIndex);
        frame.time = EngineCore::instance().totalTime();
        frame.delta = EngineCore::instance().deltaTime();
        m_renderGraph->execute(&frame);
        return;
    }
#endif

    // Begin main render pass
    RenderPassDesc mainPass;
    mainPass.label = "main";
    ColorAttachmentSpec colorSpec;
    colorSpec.clear = Color::black();
    mainPass.color = colorSpec;
    DepthAttachmentSpec depthSpec;
    depthSpec.clearDepth = 1.0f;
    mainPass.depth = depthSpec;

    PassEncoder pass = m_backend->beginRenderPass(mainPass);

    // Execute sprite pipeline (includes rects, polys via whitepixel sprite)
    SpritesPipeline::renderSpriteBatch(m_backend.get(), this);

    m_backend->endRenderPass(pass);

    // Apply CRT post-processing effects (software implementation)
    if (crt_postprocessing_enabled) {
        applyCRTPostProcessing();
    }
}

void GameView::endFrame() {
    if (!m_backend) return;
    m_backend->endFrame();
}

// ─────────────────────────────────────────────────────────────────────────────
// Atlas management (mirrors TypeScript setAtlasIndex)
// ─────────────────────────────────────────────────────────────────────────────

void GameView::setAtlasIndex(bool isPrimary, i32 index) {
    i32& currentIndex = isPrimary ? m_primaryAtlasIndex : m_secondaryAtlasIndex;
    if (currentIndex == index) return;

    const char* atlasId = isPrimary ? "_atlas_primary" : "_atlas_secondary";

    if (index < 0) {
        currentIndex = -1;
        auto fallbackIt = textures.find("_atlas_fallback");
        if (fallbackIt != textures.end()) {
            textures[atlasId] = fallbackIt->second;
        }
        return;
    }

    // TODO: Generate atlas name and load from assets
    // const std::string atlasName = generateAtlasName(index);
    // const auto* atlas = EngineCore::instance().assets().getImg(atlasName);
    // textures[atlasId] = m_backend->createTexture(...);
    currentIndex = index;
}

void GameView::setPrimaryAtlas(i32 index) {
    setAtlasIndex(true, index);
}

void GameView::setSecondaryAtlas(i32 index) {
    setAtlasIndex(false, index);
}

void GameView::setPipelineRegistry(std::unique_ptr<RenderPassLibrary> registry) {
    m_pipelineRegistry = std::move(registry);
}

// ─────────────────────────────────────────────────────────────────────────────
// Texture binding helpers (mirrors TypeScript)
// ─────────────────────────────────────────────────────────────────────────────

void GameView::setActiveTexUnit(i32 unit) {
    if (backendType() != BackendType::OpenGLES2) return;
#if !BMSX_ENABLE_GLES2
    throw std::runtime_error("[GameView] OpenGLES2 backend disabled at compile time.");
#else
    m_activeTexUnit = unit;
    static_cast<OpenGLES2Backend*>(m_backend.get())->setActiveTextureUnit(unit);
#endif
}

void GameView::bind2DTex(TextureHandle tex) {
    if (backendType() != BackendType::OpenGLES2) return;
    if (m_activeTexture2D == tex) return;
#if !BMSX_ENABLE_GLES2
    throw std::runtime_error("[GameView] OpenGLES2 backend disabled at compile time.");
#else
    static_cast<OpenGLES2Backend*>(m_backend.get())->bindTexture2D(tex);
    m_activeTexture2D = tex;
#endif
}

void GameView::bindCubemapTex(TextureHandle tex) {
    if (backendType() != BackendType::OpenGLES2) return;
#if !BMSX_ENABLE_GLES2
    throw std::runtime_error("[GameView] OpenGLES2 backend disabled at compile time.");
#else
    if (m_activeCubemap == tex) return;
    m_activeCubemap = tex;
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambient control API (mirrors TypeScript)
// ─────────────────────────────────────────────────────────────────────────────

void GameView::setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure) {
    // TODO: SkyboxPipeline::setSkyboxTintExposure(tint, exposure);
    (void)tint; (void)exposure;
}

void GameView::setParticlesAmbient(i32 mode, f32 factor) {
    // TODO: ParticlesPipeline::setAmbientDefaults(mode, factor);
    (void)mode; (void)factor;
}

void GameView::setSpritesAmbient(bool enabled, f32 factor) {
    spriteAmbientEnabledDefault = enabled;
    spriteAmbientFactorDefault = factor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience methods for drawing primitives
//
// These use renderer.submit internally, matching TypeScript behavior.
// ─────────────────────────────────────────────────────────────────────────────

void GameView::fillRectangle(const RectBounds& area, const Color& color, RenderLayer layer) {
    RectRenderSubmission submission;
    submission.kind = RectRenderSubmission::Kind::Fill;
    submission.area = area;
    submission.color = color;
    submission.layer = layer;
    renderer.submit.rect(submission);
}

void GameView::drawRectangle(const RectBounds& area, const Color& color, RenderLayer layer) {
    RectRenderSubmission submission;
    submission.kind = RectRenderSubmission::Kind::Rect;
    submission.area = area;
    submission.color = color;
    submission.layer = layer;
    renderer.submit.rect(submission);
}

void GameView::drawLine(i32 x0, i32 y0, i32 x1, i32 y1, const Color& color, RenderLayer layer) {
    PolyRenderSubmission submission;
    submission.points.push_back(static_cast<f32>(x0));
    submission.points.push_back(static_cast<f32>(y0));
    submission.points.push_back(static_cast<f32>(x1));
    submission.points.push_back(static_cast<f32>(y1));
    submission.z = 0.0f;
    submission.color = color;
    submission.thickness = 1.0f;
    submission.layer = layer;
    renderer.submit.poly(submission);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render graph (mirrors TypeScript rebuildGraph)
// ─────────────────────────────────────────────────────────────────────────────

void GameView::rebuildGraph() {
    if (!m_pipelineRegistry) {
        // No pipeline registry yet - this is OK during early init
        return;
    }
    m_renderGraph = m_pipelineRegistry->buildRenderGraph(this, nullptr);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRT Post-processing (software implementation)
//
// This is a simplified software CRT effect for the libretro backend.
// The TypeScript version uses GPU shaders via crt_pipeline.ts.
// ─────────────────────────────────────────────────────────────────────────────

void GameView::applyCRTPostProcessing() {
    auto* softBackend = dynamic_cast<SoftwareBackend*>(m_backend.get());
    if (!softBackend) return;

    u32* fb = softBackend->framebuffer();
    i32 width = softBackend->width();
    i32 height = softBackend->height();
    i32 pitch = softBackend->pitch();
    i32 pixelsPerRow = pitch / sizeof(u32);

    // Ensure scratch buffer is large enough
    if (m_crtScratchBuffer.size() < static_cast<size_t>(width * height)) {
        m_crtScratchBuffer.resize(width * height);
    }

    // Copy framebuffer to scratch for effects that need source pixels
    std::memcpy(m_crtScratchBuffer.data(), fb, width * height * sizeof(u32));

    // Time-based noise seed
    static u32 noiseState = 12345;

    for (i32 y = 0; y < height; ++y) {
        for (i32 x = 0; x < width; ++x) {
            i32 idx = y * pixelsPerRow + x;
            i32 scratchIdx = y * width + x;
            u32 pixel = m_crtScratchBuffer[scratchIdx];

            u8 r = (pixel >> 16) & 0xFF;
            u8 g = (pixel >> 8) & 0xFF;
            u8 b = pixel & 0xFF;

            f32 rf = r / 255.0f;
            f32 gf = g / 255.0f;
            f32 bf = b / 255.0f;

            // 1. Scanlines: darken every other row
            if (applyScanlines) {
                if (y % 2 == 1) {
                    rf *= 0.85f;
                    gf *= 0.85f;
                    bf *= 0.85f;
                }
            }

            // 2. Color bleed: shift red channel slightly
            if (applyColorBleed) {
                if (x > 0) {
                    u32 leftPixel = m_crtScratchBuffer[scratchIdx - 1];
                    f32 leftR = ((leftPixel >> 16) & 0xFF) / 255.0f;
                    rf = rf * (1.0f - colorBleed[0]) + leftR * colorBleed[0];
                }
            }

            // 3. Noise
            if (applyNoise) {
                noiseState ^= noiseState << 13;
                noiseState ^= noiseState >> 17;
                noiseState ^= noiseState << 5;

                f32 noise = (static_cast<f32>(noiseState & 0xFF) / 255.0f - 0.5f) * noiseIntensity * 0.1f;
                rf += noise;
                gf += noise;
                bf += noise;
            }

            // 4. Subtle glow/brightness boost based on luminance
            if (applyGlow) {
                f32 lum = 0.299f * rf + 0.587f * gf + 0.114f * bf;
                if (lum > 0.5f) {
                    f32 glowFactor = (lum - 0.5f) * 0.2f;
                    rf += glowColor[0] * glowFactor;
                    gf += glowColor[1] * glowFactor;
                    bf += glowColor[2] * glowFactor;
                }
            }

            // 5. Aperture grille simulation (subtle RGB subpixel pattern)
            if (applyAperture) {
                i32 subpixel = x % 3;
                if (subpixel == 0) { rf *= 1.05f; gf *= 0.98f; bf *= 0.98f; }
                else if (subpixel == 1) { rf *= 0.98f; gf *= 1.05f; bf *= 0.98f; }
                else { rf *= 0.98f; gf *= 0.98f; bf *= 1.05f; }
            }

            // Clamp and convert back to u8
            r = static_cast<u8>(std::max(0.0f, std::min(1.0f, rf)) * 255.0f);
            g = static_cast<u8>(std::max(0.0f, std::min(1.0f, gf)) * 255.0f);
            b = static_cast<u8>(std::max(0.0f, std::min(1.0f, bf)) * 255.0f);

            fb[idx] = (0xFF << 24) | (r << 16) | (g << 8) | b;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

void GameView::bind() {
    Registry::instance().registerObject(this);
}

void GameView::unbind() {
    Registry::instance().deregister(this);
}

void GameView::dispose() {
    unbind();
    m_renderGraph.reset();
    m_pipelineRegistry.reset();
    m_backend.reset();
}

void GameView::reset() {
    // Nothing to reset - queues are managed by RenderQueues module
}

} // namespace bmsx
