/*
 * render_queues.h - Render submission queues
 *
 * Mirrors TypeScript render_queues.ts
 * Sprites use double-buffered machine OAM; mesh/particles still use FeatureQueue.
 */

#ifndef BMSX_RENDER_QUEUES_H
#define BMSX_RENDER_QUEUES_H

#include "../../utils/feature_queue.h"
#include "render_types.h"
#include <functional>

namespace bmsx {
/* ============================================================================
 * Mesh Queue Item (for 3D meshes)
 * ============================================================================ */

// MeshRenderSubmission is defined in render_types.h

/* ============================================================================
 * Particle Queue Item
 * ============================================================================ */

// ParticleRenderSubmission is defined in render_types.h

/* ============================================================================
 * Render Queues Module
 *
 * Global queues for sprite/mesh/particle rendering.
 * Mirrors TypeScript's module-level queues.
 * ============================================================================ */

namespace RenderQueues {

// --- Sprite queue helpers ---

/**
 * Submit a sprite to the queue (resolves image metadata).
 */
void submitSprite(const ImgRenderSubmission& options);

/**
 * Submit a rectangle (filled or outline) using the primitive solid sprite.
 */
void submitRectangle(const RectRenderSubmission& options);

/**
 * Submit a polygon outline using the primitive solid sprite.
 */
void submitDrawPolygon(const PolyRenderSubmission& options);

/**
 * Submit glyphs for rendering (uses sprite + rect submissions).
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
 * Returns whether the back queues contain pending submissions.
 */
bool hasPendingBackQueueContent();

/**
 * Begin sprite queue processing using the currently selected queue source.
 * Returns the number of sprites in the active queue.
 */
i32 beginSpriteQueue();

/**
 * Iterate over all active OAM entries in slot order.
 */
void forEachOamEntry(const std::function<void(const OamEntry&, size_t)>& fn);

/**
 * Clear all back queues and reset submission counters.
 */
void clearBackQueues();

/**
 * Clear both front and back queues and reset VDP queue state to power-on values.
 */
void clearAllQueues();

/**
 * Get sprite queue sizes for debugging.
 */
size_t spriteQueueBackSize();
size_t spriteQueueFrontSize();

/**
 * Copy render queues into a reusable playback buffer.
 */
const std::vector<RenderSubmission>& copyRenderQueueForPlayback();

/**
 * Sprite queue debug counts.
 */
struct QueueDebug { size_t front; size_t back; };
QueueDebug getSpriteQueueDebug();
QueueDebug getMeshQueueDebug();
size_t getQueuedParticleCount();

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
					std::optional<i32> start,
					std::optional<i32> end,
					f32 z,
					BFont* font,
					const std::optional<Color>& color,
					const std::optional<Color>& backgroundColor,
					const std::optional<RenderLayer>& layer);
f32 calculateCenteredBlockX(const std::vector<std::string>& lines, i32 charWidth, i32 blockWidth);
std::vector<std::string> wrapGlyphs(const std::string& text, i32 maxLineLength);

} // namespace RenderQueues

} // namespace bmsx

#endif // BMSX_RENDER_QUEUES_H
