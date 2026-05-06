/*
 * queues.cpp - Render submission queues implementation
 */

#include "queues.h"
#include "common/clamp.h"
#include <array>
#include <algorithm>

namespace bmsx {
namespace RenderQueues {

namespace {
enum class QueueSource : u8 {
	Front = 0,
	Back = 1,
};

FeatureQueue<MeshRenderSubmission> s_meshQueue(256);
FeatureQueue<ParticleRenderSubmission> s_particleQueue(1024);
QueueSource s_activeQueueSource = QueueSource::Front;

struct RenderQueueLifecycle {
	bool (*hasFront)();
	bool (*hasBack)();
	void (*swap)();
	void (*clearBack)();
	void (*clearAll)();
};

bool meshHasFront() { return s_meshQueue.sizeFront() > 0; }
bool meshHasBack() { return s_meshQueue.sizeBack() > 0; }
void meshSwap() { s_meshQueue.swap(); }
void meshClearBack() { s_meshQueue.clearBack(); }
void meshClearAll() { s_meshQueue.clearAll(); }

bool particleHasFront() { return s_particleQueue.sizeFront() > 0; }
bool particleHasBack() { return s_particleQueue.sizeBack() > 0; }
void particleSwap() { s_particleQueue.swap(); }
void particleClearBack() { s_particleQueue.clearBack(); }
void particleClearAll() { s_particleQueue.clearAll(); }

const std::array<RenderQueueLifecycle, 2> s_renderQueueLifecycles{{
	{meshHasFront, meshHasBack, meshSwap, meshClearBack, meshClearAll},
	{particleHasFront, particleHasBack, particleSwap, particleClearBack, particleClearAll},
}};

template<typename T>
const ScratchBatch<T>& activeQueue(FeatureQueue<T>& queue) {
	return s_activeQueueSource == QueueSource::Back ? queue.back() : queue.front();
}

} // namespace

i32 particleAmbientModeDefault = 0;
f32 particleAmbientFactorDefault = 1.0f;
std::array<f32, 3> _skyTint = {1.0f, 1.0f, 1.0f};
f32 _skyExposure = 1.0f;

static bool hasCommittedFrontQueueContent() {
	for (const RenderQueueLifecycle& lifecycle : s_renderQueueLifecycles) {
		if (lifecycle.hasFront()) return true;
	}
	return false;
}

void prepareCompletedRenderQueues() {
	for (const RenderQueueLifecycle& lifecycle : s_renderQueueLifecycles) {
		lifecycle.swap();
	}
	s_activeQueueSource = QueueSource::Front;
}

void preparePartialRenderQueues() {
	s_activeQueueSource = hasCommittedFrontQueueContent()
		? QueueSource::Front
		: (hasPendingBackQueueContent() ? QueueSource::Back : QueueSource::Front);
}

void prepareOverlayRenderQueues() {
	s_activeQueueSource = QueueSource::Back;
}

void prepareHeldRenderQueues() {
	s_activeQueueSource = QueueSource::Front;
}

bool hasPendingBackQueueContent() {
	for (const RenderQueueLifecycle& lifecycle : s_renderQueueLifecycles) {
		if (lifecycle.hasBack()) return true;
	}
	return false;
}

void clearBackQueues() {
	for (const RenderQueueLifecycle& lifecycle : s_renderQueueLifecycles) {
		lifecycle.clearBack();
	}
	s_activeQueueSource = QueueSource::Front;
}

void clearAllQueues() {
	for (const RenderQueueLifecycle& lifecycle : s_renderQueueLifecycles) {
		lifecycle.clearAll();
	}
	s_activeQueueSource = QueueSource::Front;
}

void submit_mesh(const MeshRenderSubmission& item) {
	s_meshQueue.submit(item);
}

i32 beginMeshQueue() {
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_meshQueue.sizeBack() : s_meshQueue.sizeFront());
}

const MeshRenderSubmission& meshQueueEntry(size_t index) {
	return activeQueue(s_meshQueue).get(index);
}


void submit_particle(const ParticleRenderSubmission& item) {
	s_particleQueue.submit(item);
}

i32 beginParticleQueue() {
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_particleQueue.sizeBack() : s_particleQueue.sizeFront());
}

const ParticleRenderSubmission& particleQueueEntry(size_t index) {
	return activeQueue(s_particleQueue).get(index);
}


void setAmbientDefaults(i32 mode, f32 factor) {
	particleAmbientModeDefault = mode;
	particleAmbientFactorDefault = clamp(factor, 0.0f, 1.0f);
}

void setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure) {
	_skyTint = {std::max(0.0f, tint[0]), std::max(0.0f, tint[1]), std::max(0.0f, tint[2])};
	_skyExposure = std::max(0.0f, exposure);
}

} // namespace RenderQueues
} // namespace bmsx
