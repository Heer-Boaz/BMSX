/*
 * queues.cpp - Render submission queues implementation
 */

#include "queues.h"
#include "common/clamp.h"
#include <algorithm>
#include <utility>

namespace bmsx {
namespace RenderQueues {

static FeatureQueue<MeshRenderSubmission> s_meshQueue(256);
static FeatureQueue<ParticleRenderSubmission> s_particleQueue(1024);
static FeatureQueue<RenderSubmission> s_host2DQueue(512);
enum class QueueSource : u8 {
	Front = 0,
	Back = 1,
};
static QueueSource s_activeQueueSource = QueueSource::Front;

i32 particleAmbientModeDefault = 0;
f32 particleAmbientFactorDefault = 1.0f;
std::array<f32, 3> _skyTint = {1.0f, 1.0f, 1.0f};
f32 _skyExposure = 1.0f;

static bool hasCommittedFrontQueueContent() {
	return s_meshQueue.sizeFront() > 0
		|| s_particleQueue.sizeFront() > 0
		|| s_host2DQueue.sizeFront() > 0;
}

template<typename T, typename Fn>
static void forEachActiveQueue(FeatureQueue<T>& queue, Fn&& fn) {
	if (s_activeQueueSource == QueueSource::Back) {
		queue.back().forEach(std::forward<Fn>(fn));
		return;
	}
	queue.front().forEach(std::forward<Fn>(fn));
}

void prepareCompletedRenderQueues() {
	s_meshQueue.swap();
	s_particleQueue.swap();
	s_host2DQueue.swap();
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
	return s_meshQueue.sizeBack() > 0
		|| s_particleQueue.sizeBack() > 0
		|| s_host2DQueue.sizeBack() > 0;
}

void clearBackQueues() {
	s_meshQueue.clearBack();
	s_particleQueue.clearBack();
	s_host2DQueue.clearBack();
	s_activeQueueSource = QueueSource::Front;
}

void clearAllQueues() {
	s_meshQueue.clearAll();
	s_particleQueue.clearAll();
	s_host2DQueue.clearAll();
	s_activeQueueSource = QueueSource::Front;
}

void submitSprite(const ImgRenderSubmission& item) {
	RenderSubmission submission;
	submission.type = RenderSubmissionType::Img;
	submission.img = item;
	s_host2DQueue.submit(std::move(submission));
}

void submitRectangle(const RectRenderSubmission& item) {
	RenderSubmission submission;
	submission.type = RenderSubmissionType::Rect;
	submission.rect = item;
	s_host2DQueue.submit(std::move(submission));
}

void submitDrawPolygon(const PolyRenderSubmission& item) {
	RenderSubmission submission;
	submission.type = RenderSubmissionType::Poly;
	submission.poly = item;
	s_host2DQueue.submit(std::move(submission));
}

void submitGlyphs(const GlyphRenderSubmission& item) {
	RenderSubmission submission;
	submission.type = RenderSubmissionType::Glyphs;
	submission.glyphs = item;
	s_host2DQueue.submit(std::move(submission));
}

i32 beginHost2DQueue() {
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_host2DQueue.sizeBack() : s_host2DQueue.sizeFront());
}

void forEachHost2DQueue(const std::function<void(const RenderSubmission&, size_t)>& fn) {
	forEachActiveQueue(s_host2DQueue, [&fn](const RenderSubmission& item, size_t index) {
		fn(item, index);
	});
}

size_t host2DQueueBackSize() { return s_host2DQueue.sizeBack(); }
size_t host2DQueueFrontSize() { return s_host2DQueue.sizeFront(); }

void submitMesh(const MeshRenderSubmission& item) {
	s_meshQueue.submit(item);
}

i32 beginMeshQueue() {
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_meshQueue.sizeBack() : s_meshQueue.sizeFront());
}

void forEachMeshQueue(const std::function<void(const MeshRenderSubmission&, size_t)>& fn) {
	forEachActiveQueue(s_meshQueue, [&fn](const MeshRenderSubmission& item, size_t index) {
		fn(item, index);
	});
}

size_t meshQueueBackSize() { return s_meshQueue.sizeBack(); }
size_t meshQueueFrontSize() { return s_meshQueue.sizeFront(); }

void submit_particle(const ParticleRenderSubmission& item) {
	s_particleQueue.submit(item);
}

i32 beginParticleQueue() {
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_particleQueue.sizeBack() : s_particleQueue.sizeFront());
}

void forEachParticleQueue(const std::function<void(const ParticleRenderSubmission&, size_t)>& fn) {
	forEachActiveQueue(s_particleQueue, [&fn](const ParticleRenderSubmission& item, size_t index) {
		fn(item, index);
	});
}

size_t particleQueueBackSize() { return s_particleQueue.sizeBack(); }
size_t particleQueueFrontSize() { return s_particleQueue.sizeFront(); }

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
