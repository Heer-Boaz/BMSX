/*
 * queues.h - Render submission queues
 *
 * Host/editor feature queues only. Fantasy-console VDP submissions enter the
 * machine through VDP MMIO/FIFO/DMA, not through render/shared.
 */

#ifndef BMSX_RENDER_QUEUES_H
#define BMSX_RENDER_QUEUES_H

#include "common/feature_queue.h"
#include "submissions.h"
#include <functional>

namespace bmsx {

namespace RenderQueues {

void prepareCompletedRenderQueues();
void preparePartialRenderQueues();
void prepareOverlayRenderQueues();
void prepareHeldRenderQueues();
bool hasPendingBackQueueContent();
void clearBackQueues();
void clearAllQueues();

void submitSprite(const ImgRenderSubmission& item);
void submitRectangle(const RectRenderSubmission& item);
void submitDrawPolygon(const PolyRenderSubmission& item);
void submitGlyphs(const GlyphRenderSubmission& item);
i32 beginHost2DQueue();
void forEachHost2DQueue(const std::function<void(const RenderSubmission&, size_t)>& fn);
size_t host2DQueueBackSize();
size_t host2DQueueFrontSize();

void submitMesh(const MeshRenderSubmission& item);
i32 beginMeshQueue();
void forEachMeshQueue(const std::function<void(const MeshRenderSubmission&, size_t)>& fn);
size_t meshQueueBackSize();
size_t meshQueueFrontSize();

void submit_particle(const ParticleRenderSubmission& item);
i32 beginParticleQueue();
void forEachParticleQueue(const std::function<void(const ParticleRenderSubmission&, size_t)>& fn);
size_t particleQueueBackSize();
size_t particleQueueFrontSize();

extern i32 particleAmbientModeDefault;
extern f32 particleAmbientFactorDefault;
void setAmbientDefaults(i32 mode, f32 factor = 1.0f);

extern std::array<f32, 3> _skyTint;
extern f32 _skyExposure;
void setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure = 1.0f);

} // namespace RenderQueues

} // namespace bmsx

#endif // BMSX_RENDER_QUEUES_H
