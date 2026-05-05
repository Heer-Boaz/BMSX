/*
 * queues.cpp - Render submission queues implementation
 */

#include "queues.h"
#include "common/clamp.h"
#include <array>
#include <algorithm>
#include <utility>

namespace bmsx {
namespace RenderQueues {

namespace {
struct Host2DRef {
	size_t index = 0;
};

enum class QueueSource : u8 {
	Front = 0,
	Back = 1,
};

FeatureQueue<MeshRenderSubmission> s_meshQueue(256);
FeatureQueue<ParticleRenderSubmission> s_particleQueue(1024);
QueueSource s_activeQueueSource = QueueSource::Front;

class Host2DQueue {
public:
	explicit Host2DQueue(size_t capacity)
		: m_kindQueue(capacity)
		, m_refQueue(capacity)
		, m_imgQueue(capacity)
		, m_polyQueue(capacity)
		, m_rectQueue(capacity)
		, m_glyphsQueue(capacity) {}

	void swap() {
		m_kindQueue.swap();
		m_refQueue.swap();
		m_imgQueue.swap();
		m_polyQueue.swap();
		m_rectQueue.swap();
		m_glyphsQueue.swap();
	}

	void clearBack() {
		m_kindQueue.clearBack();
		m_refQueue.clearBack();
		m_imgQueue.clearBack();
		m_polyQueue.clearBack();
		m_rectQueue.clearBack();
		m_glyphsQueue.clearBack();
	}

	void clearAll() {
		m_kindQueue.clearAll();
		m_refQueue.clearAll();
		m_imgQueue.clearAll();
		m_polyQueue.clearAll();
		m_rectQueue.clearAll();
		m_glyphsQueue.clearAll();
	}

	bool hasFront() const { return m_refQueue.sizeFront() > 0; }
	bool hasBack() const { return m_refQueue.sizeBack() > 0; }
	size_t activeSize() const { return activeRefs().size(); }

	void submit(HostImageRenderSubmission item) {
		const Host2DRef ref{m_imgQueue.sizeBack()};
		m_imgQueue.submit(std::move(item));
		submitRef(Host2DKind::Img, ref);
	}

	void submit(RectRenderSubmission item) {
		const Host2DRef ref{m_rectQueue.sizeBack()};
		m_rectQueue.submit(std::move(item));
		submitRef(Host2DKind::Rect, ref);
	}

	void submit(PolyRenderSubmission item) {
		const Host2DRef ref{m_polyQueue.sizeBack()};
		m_polyQueue.submit(std::move(item));
		submitRef(Host2DKind::Poly, ref);
	}

	void submit(GlyphRenderSubmission item) {
		const Host2DRef ref{m_glyphsQueue.sizeBack()};
		m_glyphsQueue.submit(std::move(item));
		submitRef(Host2DKind::Glyphs, ref);
	}

	Host2DEntry at(size_t index) const {
		Host2DEntry entry;
		entry.kind = activeKinds().get(index);
		const Host2DRef& ref = activeRefs().get(index);
		switch (entry.kind) {
			case Host2DKind::Img:
				entry.img = &activeQueue(m_imgQueue).get(ref.index);
				return entry;
			case Host2DKind::Poly:
				entry.poly = &activeQueue(m_polyQueue).get(ref.index);
				return entry;
			case Host2DKind::Rect:
				entry.rect = &activeQueue(m_rectQueue).get(ref.index);
				return entry;
			case Host2DKind::Glyphs:
				entry.glyphs = &activeQueue(m_glyphsQueue).get(ref.index);
				return entry;
		}
		return entry;
	}

private:
	FeatureQueue<Host2DKind> m_kindQueue;
	FeatureQueue<Host2DRef> m_refQueue;
	FeatureQueue<HostImageRenderSubmission> m_imgQueue;
	FeatureQueue<PolyRenderSubmission> m_polyQueue;
	FeatureQueue<RectRenderSubmission> m_rectQueue;
	FeatureQueue<GlyphRenderSubmission> m_glyphsQueue;

	template<typename T>
	const ScratchBatch<T>& activeQueue(const FeatureQueue<T>& queue) const {
		return s_activeQueueSource == QueueSource::Back ? queue.back() : queue.front();
	}

	const ScratchBatch<Host2DKind>& activeKinds() const { return activeQueue(m_kindQueue); }
	const ScratchBatch<Host2DRef>& activeRefs() const { return activeQueue(m_refQueue); }

	void submitRef(Host2DKind kind, Host2DRef ref) {
		m_kindQueue.submit(kind);
		m_refQueue.submit(ref);
	}
};

Host2DQueue s_host2dQueue(512);

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

bool host2DHasFront() { return s_host2dQueue.hasFront(); }
bool host2DHasBack() { return s_host2dQueue.hasBack(); }
void host2DSwap() { s_host2dQueue.swap(); }
void host2DClearBack() { s_host2dQueue.clearBack(); }
void host2DClearAll() { s_host2dQueue.clearAll(); }

const std::array<RenderQueueLifecycle, 3> s_renderQueueLifecycles{{
	{meshHasFront, meshHasBack, meshSwap, meshClearBack, meshClearAll},
	{particleHasFront, particleHasBack, particleSwap, particleClearBack, particleClearAll},
	{host2DHasFront, host2DHasBack, host2DSwap, host2DClearBack, host2DClearAll},
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

void submitImage(HostImageRenderSubmission item) {
	s_host2dQueue.submit(std::move(item));
}

void submitRectangle(RectRenderSubmission item) {
	s_host2dQueue.submit(std::move(item));
}

void submitDrawPolygon(PolyRenderSubmission item) {
	s_host2dQueue.submit(std::move(item));
}

void submitGlyphs(GlyphRenderSubmission item) {
	s_host2dQueue.submit(std::move(item));
}

size_t beginHost2DQueue() {
	return s_host2dQueue.activeSize();
}

Host2DEntry host2DQueueEntry(size_t index) {
	return s_host2dQueue.at(index);
}

void submitMesh(const MeshRenderSubmission& item) {
	s_meshQueue.submit(item);
}

i32 beginMeshQueue() {
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_meshQueue.sizeBack() : s_meshQueue.sizeFront());
}

const MeshRenderSubmission& meshQueueEntry(size_t index) {
	return activeQueue(s_meshQueue).get(index);
}

size_t meshQueueBackSize() { return s_meshQueue.sizeBack(); }
size_t meshQueueFrontSize() { return s_meshQueue.sizeFront(); }

void submit_particle(const ParticleRenderSubmission& item) {
	s_particleQueue.submit(item);
}

i32 beginParticleQueue() {
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_particleQueue.sizeBack() : s_particleQueue.sizeFront());
}

const ParticleRenderSubmission& particleQueueEntry(size_t index) {
	return activeQueue(s_particleQueue).get(index);
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
