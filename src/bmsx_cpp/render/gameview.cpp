/*
 * gameview.cpp - GameView implementation
 */

#include "gameview.h"
#include "../core/engine.h"
#include <algorithm>

namespace bmsx {

/* ============================================================================
 * RenderQueue implementation
 * ============================================================================ */

void RenderQueue::submitSprite(const ImgRenderSubmission& submission) {
    m_sprites.push_back(submission);
}

void RenderQueue::submitRect(const RectRenderSubmission& submission) {
    m_rects.push_back(submission);
}

void RenderQueue::submitPoly(const PolyRenderSubmission& submission) {
    m_polys.push_back(submission);
}

void RenderQueue::submitGlyphs(const GlyphRenderSubmission& submission) {
    m_glyphs.push_back(submission);
}

void RenderQueue::clear() {
    m_sprites.clear();
    m_rects.clear();
    m_polys.clear();
    m_glyphs.clear();
}

void RenderQueue::sortByDepth() {
    // Sort sprites by Z (lower Z = drawn first)
    std::stable_sort(m_sprites.begin(), m_sprites.end(),
        [](const ImgRenderSubmission& a, const ImgRenderSubmission& b) {
            // Use pos.y as Z for 2D depth sorting (typical for 2D games)
            return a.pos.y < b.pos.y;
        });

    // Rects are typically UI, sorted by submission order
    // Polys and glyphs similarly
}

/* ============================================================================
 * GameView implementation
 * ============================================================================ */

GameView::GameView(i32 viewportWidth, i32 viewportHeight)
    : m_viewportSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)} {
    initializeRenderer();
}

GameView::~GameView() {
    dispose();
}

void GameView::initializeRenderer() {
    // Set up the renderer submit functions
    renderer.submit.sprite = [this](const ImgRenderSubmission& s) {
        submitSprite(s);
    };
    renderer.submit.rect = [this](const RectRenderSubmission& s) {
        submitRect(s);
    };
    renderer.submit.poly = [this](const PolyRenderSubmission& s) {
        submitPoly(s);
    };
    renderer.submit.glyphs = [this](const GlyphRenderSubmission& s) {
        submitGlyphs(s);
    };
}

void GameView::setBackend(std::unique_ptr<GPUBackend> backend) {
    m_backend = std::move(backend);
}

BackendType GameView::backendType() const {
    return m_backend ? m_backend->type() : BackendType::Headless;
}

void GameView::setViewportSize(i32 width, i32 height) {
    m_viewportSize.x = static_cast<f32>(width);
    m_viewportSize.y = static_cast<f32>(height);
}

void GameView::beginFrame() {
    if (!m_backend) return;

    m_backend->beginFrame();

    // Clear both render queues
    m_worldQueue.clear();
    m_uiQueue.clear();
}

void GameView::drawGame() {
    if (!m_backend) return;

    // Sort queues by depth
    m_worldQueue.sortByDepth();
    m_uiQueue.sortByDepth();

    // Execute render passes
    executeRenderPasses();
}

void GameView::endFrame() {
    if (!m_backend) return;

    m_backend->endFrame();
}

void GameView::executeRenderPasses() {
    // Begin main render pass
    RenderPassDesc mainPass;
    mainPass.label = "main";
    mainPass.color.clear = Color::black();
    mainPass.depth.clearDepth = 1.0f;

    PassEncoder pass = m_backend->beginRenderPass(mainPass);

    // 1. Render world layer (game objects, background)
    renderRects();   // Background rects first
    renderSprites(); // Sprites
    renderPolys();   // Debug polygons

    // 2. Render UI layer
    renderGlyphs();  // Text on top

    m_backend->endRenderPass(pass);

    // Note: In TypeScript, CRT post-processing would be applied here.
    // For libretro software renderer, we skip complex post-processing.
}

void GameView::renderSprites() {
    auto* softBackend = dynamic_cast<SoftwareBackend*>(m_backend.get());
    if (!softBackend) return;

    // World sprites
    for (const auto& sprite : m_worldQueue.sprites()) {
        // TODO: Look up texture from imgid via assets
        // For now, just draw a colored rectangle as placeholder
        i32 x = static_cast<i32>(sprite.pos.x);
        i32 y = static_cast<i32>(sprite.pos.y);
        i32 w = static_cast<i32>(16 * sprite.scale.x);  // Default 16x16 sprite
        i32 h = static_cast<i32>(16 * sprite.scale.y);
        softBackend->fillRect(x, y, w, h, sprite.colorize);
    }

    // UI sprites
    for (const auto& sprite : m_uiQueue.sprites()) {
        i32 x = static_cast<i32>(sprite.pos.x);
        i32 y = static_cast<i32>(sprite.pos.y);
        i32 w = static_cast<i32>(16 * sprite.scale.x);
        i32 h = static_cast<i32>(16 * sprite.scale.y);
        softBackend->fillRect(x, y, w, h, sprite.colorize);
    }
}

void GameView::renderRects() {
    auto* softBackend = dynamic_cast<SoftwareBackend*>(m_backend.get());
    if (!softBackend) return;

    // World rects
    for (const auto& rect : m_worldQueue.rects()) {
        i32 x = static_cast<i32>(rect.area.left);
        i32 y = static_cast<i32>(rect.area.top);
        i32 w = static_cast<i32>(rect.area.width());
        i32 h = static_cast<i32>(rect.area.height());

        if (rect.kind == RectRenderSubmission::Kind::Fill) {
            softBackend->fillRect(x, y, w, h, rect.color);
        } else {
            softBackend->drawRect(x, y, w, h, rect.color);
        }
    }

    // UI rects
    for (const auto& rect : m_uiQueue.rects()) {
        i32 x = static_cast<i32>(rect.area.left);
        i32 y = static_cast<i32>(rect.area.top);
        i32 w = static_cast<i32>(rect.area.width());
        i32 h = static_cast<i32>(rect.area.height());

        if (rect.kind == RectRenderSubmission::Kind::Fill) {
            softBackend->fillRect(x, y, w, h, rect.color);
        } else {
            softBackend->drawRect(x, y, w, h, rect.color);
        }
    }
}

void GameView::renderPolys() {
    auto* softBackend = dynamic_cast<SoftwareBackend*>(m_backend.get());
    if (!softBackend) return;

    // World polys
    for (const auto& poly : m_worldQueue.polys()) {
        if (poly.points.size() < 2) continue;

        for (size_t i = 0; i < poly.points.size() - 1; ++i) {
            softBackend->drawLine(
                static_cast<i32>(poly.points[i].x),
                static_cast<i32>(poly.points[i].y),
                static_cast<i32>(poly.points[i + 1].x),
                static_cast<i32>(poly.points[i + 1].y),
                poly.color
            );
        }
        // Close the polygon
        if (poly.points.size() > 2) {
            softBackend->drawLine(
                static_cast<i32>(poly.points.back().x),
                static_cast<i32>(poly.points.back().y),
                static_cast<i32>(poly.points[0].x),
                static_cast<i32>(poly.points[0].y),
                poly.color
            );
        }
    }
}

void GameView::renderGlyphs() {
    // TODO: Font rendering
    // For now, skip - would need a font atlas and glyph renderer
}

void GameView::submitSprite(const ImgRenderSubmission& submission) {
    if (submission.layer == RenderLayer::UI || submission.layer == RenderLayer::IDE) {
        m_uiQueue.submitSprite(submission);
    } else {
        m_worldQueue.submitSprite(submission);
    }
}

void GameView::submitRect(const RectRenderSubmission& submission) {
    if (submission.layer == RenderLayer::UI || submission.layer == RenderLayer::IDE) {
        m_uiQueue.submitRect(submission);
    } else {
        m_worldQueue.submitRect(submission);
    }
}

void GameView::submitPoly(const PolyRenderSubmission& submission) {
    if (submission.layer == RenderLayer::UI || submission.layer == RenderLayer::IDE) {
        m_uiQueue.submitPoly(submission);
    } else {
        m_worldQueue.submitPoly(submission);
    }
}

void GameView::submitGlyphs(const GlyphRenderSubmission& submission) {
    if (submission.layer == RenderLayer::UI || submission.layer == RenderLayer::IDE) {
        m_uiQueue.submitGlyphs(submission);
    } else {
        m_worldQueue.submitGlyphs(submission);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience methods
// ─────────────────────────────────────────────────────────────────────────────

void GameView::fillRectangle(const RectBounds& area, const Color& color) {
    RectRenderSubmission submission;
    submission.kind = RectRenderSubmission::Kind::Fill;
    submission.area = area;
    submission.color = color;
    submission.layer = RenderLayer::World;
    submitRect(submission);
}

void GameView::drawRectangle(const RectBounds& area, const Color& color) {
    RectRenderSubmission submission;
    submission.kind = RectRenderSubmission::Kind::Rect;
    submission.area = area;
    submission.color = color;
    submission.layer = RenderLayer::World;
    submitRect(submission);
}

void GameView::drawLine(i32 x0, i32 y0, i32 x1, i32 y1, const Color& color) {
    PolyRenderSubmission submission;
    submission.points.push_back({static_cast<f32>(x0), static_cast<f32>(y0)});
    submission.points.push_back({static_cast<f32>(x1), static_cast<f32>(y1)});
    submission.z = 0.0f;
    submission.color = color;
    submission.thickness = 1.0f;
    submission.layer = RenderLayer::World;
    submitPoly(submission);
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
    m_backend.reset();
}

void GameView::reset() {
    m_worldQueue.clear();
    m_uiQueue.clear();
}

} // namespace bmsx
