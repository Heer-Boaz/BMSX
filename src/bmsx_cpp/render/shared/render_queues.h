/*
 * render_queues.h - Render submission queues
 *
 * Mirrors TypeScript render_queues.ts
 * Uses FeatureQueue for double-buffered sprite/mesh/particle submissions.
 */

#ifndef BMSX_RENDER_QUEUES_H
#define BMSX_RENDER_QUEUES_H

#include "../../utils/feature_queue.h"
#include "render_types.h"
#include <functional>

namespace bmsx {

// Forward declarations
struct ImgMeta;

/* ============================================================================
 * Sprite Queue Item
 *
 * Mirrors TypeScript SpriteQueueItem interface.
 * ============================================================================ */

struct SpriteQueueItem {
	ImgRenderSubmission options;
	const ImgMeta* imgmeta = nullptr;
	i32 submissionIndex = 0;
};

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
 * Submit a rectangle (filled or outline) using the whitepixel sprite.
 */
void submitRectangle(const RectRenderSubmission& options);

/**
 * Submit a polygon outline using the whitepixel sprite.
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
 * Begin sprite queue processing:
 * - Swaps back to front
 * - Resets submission counter
 * - Sorts front queue
 * Returns the number of sprites in the front queue.
 */
i32 beginSpriteQueue();

/**
 * Iterate over all sprites in the front queue.
 */
void forEachSprite(const std::function<void(const SpriteQueueItem&, size_t)>& fn);

/**
 * Custom sort for the sprite queue front buffer.
 */
void sortSpriteQueue(const std::function<bool(const SpriteQueueItem&, const SpriteQueueItem&)>& compare);

/**
 * Clear all back queues and reset submission counters.
 */
void clearBackQueues();

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
