/*
 * queues.h - Render submission queues
 *
 * Host/editor feature queues only. Fantasy-console VDP submissions enter the
 * machine through VDP MMIO/FIFO/DMA, not through render/shared.
 */

#ifndef BMSX_RENDER_QUEUES_H
#define BMSX_RENDER_QUEUES_H

#include "common/feature_queue.h"
#include "render/shared/host_2d_commands.h"
#include "submissions.h"

namespace bmsx {

namespace RenderQueues {

void prepareCompletedRenderQueues();
void preparePartialRenderQueues();
void prepareOverlayRenderQueues();
void prepareHeldRenderQueues();
bool hasPendingBackQueueContent();
void clearBackQueues();
void clearAllQueues();

void submitImage(HostImageRenderSubmission item);
void submitRectangle(RectRenderSubmission item);
void submitDrawPolygon(PolyRenderSubmission item);
void submitGlyphs(GlyphRenderSubmission item);
size_t beginHost2DQueue();
Host2DKind host2DQueueKind(size_t index);
Host2DRef host2DQueueRef(size_t index);

void submitMesh(const MeshRenderSubmission& item);
i32 beginMeshQueue();
const MeshRenderSubmission& meshQueueEntry(size_t index);

void submit_particle(const ParticleRenderSubmission& item);
i32 beginParticleQueue();
const ParticleRenderSubmission& particleQueueEntry(size_t index);

extern i32 particleAmbientModeDefault;
extern f32 particleAmbientFactorDefault;
void setAmbientDefaults(i32 mode, f32 factor = 1.0f);

extern std::array<f32, 3> _skyTint;
extern f32 _skyExposure;
void setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure = 1.0f);

} // namespace RenderQueues

} // namespace bmsx

#endif // BMSX_RENDER_QUEUES_H
