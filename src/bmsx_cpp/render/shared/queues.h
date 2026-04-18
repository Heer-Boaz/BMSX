/*
 * queues.h - Render submission queues
 *
 * 2D submissions are rasterized into the live fantasy framebuffer; mesh/particles still use FeatureQueue.
 */

#ifndef BMSX_RENDER_QUEUES_H
#define BMSX_RENDER_QUEUES_H

#include "common/feature_queue.h"
#include "submissions.h"
#include <functional>

namespace bmsx {
/* ============================================================================
 * Mesh Queue Item (for 3D meshes)
 * ============================================================================ */

// MeshRenderSubmission is defined in submissions.h

/* ============================================================================
 * Particle Queue Item
 * ============================================================================ */

// ParticleRenderSubmission is defined in submissions.h

/* ============================================================================
 * Render Queues Module
 *
 * 2D submissions write straight into the framebuffer path.
 * Only mesh and particle submissions stay queued between frames.
 * ============================================================================ */

namespace RenderQueues {

// --- 2D framebuffer helpers ---

/**
 * Submit one image blit to the framebuffer path.
 */
void submitSprite(const ImgRenderSubmission& options);

/**
 * Submit a rectangle (filled or outline) to the framebuffer path.
 */
void submitRectangle(const RectRenderSubmission& options);

/**
 * Submit a polygon outline to the framebuffer path.
 */
void submitDrawPolygon(const PolyRenderSubmission& options);

/**
 * Submit glyphs for framebuffer text rendering.
 */
void submitGlyphs(const GlyphRenderSubmission& options);

/**
 * Correct area start/end to ensure positive dimensions.
 */
void correctAreaStartEnd(f32& x, f32& y, f32& ex, f32& ey);

/**
 * Prepare completed-frame render queues by committing back -> front.
 */
void prepareCompletedRenderQueues();

/**
 * Prepare partial-frame rendering. Prefer the last committed front queue; only
 * fall back to the live back queue before the first completed frame exists.
 */
void preparePartialRenderQueues();

/**
 * Force live back-queue rendering. Reserved for overlay/live-debug paths.
 */
void prepareOverlayRenderQueues();

/**
 * Hold the last committed front queues without swapping.
 */
void prepareHeldRenderQueues();

/**
 * Returns whether the back queues contain pending submissions.
 */
bool hasPendingBackQueueContent();

/**
 * Clear all back queues and reset submission counters.
 */
void clearBackQueues();

/**
 * Clear both front and back queues and reset VDP queue state to power-on values.
 */
void clearAllQueues();

// --- Mesh queue helpers ---

void submitMesh(const MeshRenderSubmission& item);
i32 beginMeshQueue();
void forEachMeshQueue(const std::function<void(const MeshRenderSubmission&, size_t)>& fn);
size_t meshQueueBackSize();
size_t meshQueueFrontSize();

// --- Particle queue helpers ---

void submit_particle(const ParticleRenderSubmission& item);
i32 beginParticleQueue();
void forEachParticleQueue(const std::function<void(const ParticleRenderSubmission&, size_t)>& fn);
size_t particleQueueBackSize();
size_t particleQueueFrontSize();

// --- Ambient defaults (particles) ---

extern i32 particleAmbientModeDefault;
extern f32 particleAmbientFactorDefault;
void setAmbientDefaults(i32 mode, f32 factor = 1.0f);

extern SpriteParallaxRig spriteParallaxRig;
void setSpriteParallaxRig(f32 vy, f32 scale, f32 impact, f32 impact_t,
							f32 bias_px, f32 parallax_strength, f32 scale_strength,
							f32 flip_strength, f32 flip_window);

// --- Skybox exposure defaults ---

extern std::array<f32, 3> _skyTint;
extern f32 _skyExposure;
void setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure = 1.0f);

// --- Glyph helpers ---

void renderGlyphs(f32 x,
					f32 y,
					const std::vector<std::string>& lines,
					i32 start,
					i32 end,
					f32 z,
					BFont* font,
					const Color& color,
					const std::optional<Color>& backgroundColor,
					RenderLayer layer);
f32 calculateCenteredBlockX(const std::vector<std::string>& lines, i32 charWidth, i32 blockWidth);
std::vector<std::string> wrapGlyphs(const std::string& text, i32 maxLineLength);

} // namespace RenderQueues

} // namespace bmsx

#endif // BMSX_RENDER_QUEUES_H
