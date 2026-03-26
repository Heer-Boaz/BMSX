/*
 * sprites_pipeline.h - 2D Sprite rendering pipeline
 *
 * Mirrors TypeScript sprites_pipeline.ts
 * Provides batched 2D sprite + primitive rendering.
 */

#ifndef BMSX_SPRITES_PIPELINE_H
#define BMSX_SPRITES_PIPELINE_H

#include "../shared/render_types.h"
#include "../shared/render_queues.h"
#include "../backend/backend.h"
#include <vector>

namespace bmsx {

// Forward declarations
class GameView;
struct Sort2DPipelineState;
struct SpritesPipelineState;

/* ============================================================================
 * SpritesPipeline
 *
 * Mirrors TypeScript SpritesPipeline module.
 * All functions are static - this is a procedural module, not a class.
 * ============================================================================ */

namespace SpritesPipeline {

/**
 * Submit an image/sprite for rendering.
 * Mirrors TypeScript render_queues.submitSprite().
 */
void drawImg(const ImgRenderSubmission& options);

/**
 * Draw a filled rectangle using the primitive solid sprite.
 * Mirrors TypeScript render_queues.submitRectangle().
 */
void fillRectangle(const RectRenderSubmission& options);

/**
 * Draw a rectangle outline using the primitive solid sprite.
 * Mirrors TypeScript render_queues.submitRectangle().
 */
void drawRectangle(const RectRenderSubmission& options);

/**
 * Draw a polygon outline using the primitive solid sprite (Bresenham line).
 * Mirrors TypeScript render_queues.submitDrawPolygon().
 */
void drawPolygon(const std::vector<f32>& coords, f32 z, const Color& color, f32 thickness = 1.0f, std::optional<RenderLayer> layer = std::nullopt);

/**
 * Flatten and sort the active 2D draw list.
 * Mirrors the TypeScript sort_2d render pass.
 */
Sort2DPipelineState buildSorted2DPipelineState();

/**
 * Render the sprite batch from a pre-sorted 2D draw list.
 * Called by the render graph to execute sprite rendering.
 * Mirrors TypeScript renderSpriteBatch().
 */
void renderSpriteBatch(GPUBackend* backend, GameView* context, const SpritesPipelineState& spriteState, const Sort2DPipelineState& sortState, OamLayer layer, bool useDepth);

/**
 * Get sprite queue debug counts.
 */
struct SpriteQueueDebug { size_t front; size_t back; };
SpriteQueueDebug getSpriteQueueDebug();

} // namespace SpritesPipeline

} // namespace bmsx

#endif // BMSX_SPRITES_PIPELINE_H
