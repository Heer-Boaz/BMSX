/*
 * render_queues.h - Render submission queues
 *
 * Mirrors TypeScript render_queues.ts
 * Uses FeatureQueue for double-buffered sprite/mesh/particle submissions.
 */

#ifndef BMSX_RENDER_QUEUES_H
#define BMSX_RENDER_QUEUES_H

#include "../utils/feature_queue.h"
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
 * Submit a sprite to the queue with its image metadata.
 */
void submitSprite(const ImgRenderSubmission& options, const ImgMeta* imgmeta);

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
void forEachSprite(const std::function<void(const SpriteQueueItem&)>& fn);

/**
 * Get sprite queue sizes for debugging.
 */
size_t spriteQueueBackSize();
size_t spriteQueueFrontSize();

// --- Mesh queue helpers ---

void submitMesh(const MeshRenderSubmission& item);
i32 beginMeshQueue();
void forEachMesh(const std::function<void(const MeshRenderSubmission&)>& fn);
size_t meshQueueBackSize();
size_t meshQueueFrontSize();

// --- Particle queue helpers ---

void submitParticle(const ParticleRenderSubmission& item);
i32 beginParticleQueue();
void forEachParticle(const std::function<void(const ParticleRenderSubmission&)>& fn);
size_t particleQueueBackSize();
size_t particleQueueFrontSize();

} // namespace RenderQueues

} // namespace bmsx

#endif // BMSX_RENDER_QUEUES_H
