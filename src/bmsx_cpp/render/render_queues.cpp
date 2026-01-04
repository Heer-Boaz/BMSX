/*
 * render_queues.cpp - Render submission queues implementation
 *
 * Mirrors TypeScript render_queues.ts
 */

#include "render_queues.h"
#include "../core/assets.h"

namespace bmsx {
namespace RenderQueues {

// --- Queue instances ---

static FeatureQueue<SpriteQueueItem> s_spriteQueue(256);
static FeatureQueue<MeshRenderSubmission> s_meshQueue(256);
static FeatureQueue<ParticleRenderSubmission> s_particleQueue(1024);
static i32 s_spriteSubmissionCounter = 0;

// Default Z coordinate (mirrors TypeScript DEFAULT_ZCOORD)
static constexpr f32 DEFAULT_ZCOORD = 0.0f;
static constexpr f32 ZCOORD_MAX = 10000.0f;

// --- Object pools for sprite queue items ---

static std::vector<SpriteQueueItem> s_spriteItemPoolA;
static std::vector<SpriteQueueItem> s_spriteItemPoolB;
static std::vector<SpriteQueueItem>* s_spriteItemPool = &s_spriteItemPoolA;
static std::vector<SpriteQueueItem>* s_spriteItemPoolAlt = &s_spriteItemPoolB;
static size_t s_spriteItemPoolIndex = 0;
static std::vector<RenderSubmission> s_spriteQueuePlaybackBuffer;

static SpriteQueueItem& acquireSpriteQueueItem() {
	size_t index = s_spriteItemPoolIndex++;
	if (index >= s_spriteItemPool->size()) {
		s_spriteItemPool->emplace_back();
	}
	return (*s_spriteItemPool)[index];
}

// --- Layer weight for sorting ---

static i32 renderLayerWeight(const std::optional<RenderLayer>& layer) {
	if (!layer) return 0;
	switch (*layer) {
		case RenderLayer::IDE:   return 2;
		case RenderLayer::UI:    return 1;
		case RenderLayer::World: return 0;
	}
	return 0;
}

// --- Sprite queue sorting ---

static void sortSpriteQueueForRendering() {
	s_spriteQueue.sortFront([](const SpriteQueueItem& a, const SpriteQueueItem& b) {
		// First: sort by layer (world < ui < ide)
		i32 la = renderLayerWeight(a.options.layer);
		i32 lb = renderLayerWeight(b.options.layer);
		if (la != lb) return la < lb;

		// Second: sort by Z coordinate (lower Z = drawn first)
		f32 za = a.options.pos.z;
		f32 zb = b.options.pos.z;
		if (za != zb) return za < zb;

		// Third: stable sort by submission order
		return a.submissionIndex < b.submissionIndex;
	});
}

// --- Sprite queue API ---

void submitSprite(const ImgRenderSubmission& options, const ImgMeta* imgmeta) {
	i32 submissionIndex = s_spriteSubmissionCounter++;
	SpriteQueueItem& pooled = acquireSpriteQueueItem();

	pooled.submissionIndex = submissionIndex;
	pooled.imgmeta = imgmeta;

	// Copy options (integer truncation for positions like TS)
	pooled.options.imgid = options.imgid;
	pooled.options.layer = options.layer;
	pooled.options.ambient_affected = options.ambient_affected;
	pooled.options.ambient_factor = options.ambient_factor;

	// Truncate position to integers (matches TS: ~~src.pos.x)
	pooled.options.pos.x = static_cast<f32>(static_cast<i32>(options.pos.x));
	pooled.options.pos.y = static_cast<f32>(static_cast<i32>(options.pos.y));
	pooled.options.pos.z = static_cast<f32>(static_cast<i32>(options.pos.z));

	// Scale
	const Vec2 defaultScale{1.0f, 1.0f};
	pooled.options.scale = options.scale ? *options.scale : defaultScale;

	// Flip
	const FlipOptions defaultFlip{};
	pooled.options.flip = options.flip ? *options.flip : defaultFlip;

	// Colorize
	const Color defaultColor{1.0f, 1.0f, 1.0f, 1.0f};
	pooled.options.colorize = options.colorize ? *options.colorize : defaultColor;

	s_spriteQueue.submit(pooled);
}

i32 beginSpriteQueue() {
	s_spriteQueue.swap();
	s_spriteSubmissionCounter = 0;

	// Swap pools
	std::swap(s_spriteItemPool, s_spriteItemPoolAlt);
	s_spriteItemPoolIndex = 0;

	sortSpriteQueueForRendering();
	return static_cast<i32>(s_spriteQueue.sizeFront());
}

void forEachSprite(const std::function<void(const SpriteQueueItem&, size_t)>& fn) {
	s_spriteQueue.forEachFront([&fn](const SpriteQueueItem& item, size_t index) {
		fn(item, index);
	});
}

size_t spriteQueueBackSize() { return s_spriteQueue.sizeBack(); }
size_t spriteQueueFrontSize() { return s_spriteQueue.sizeFront(); }

void sortSpriteQueue(const std::function<bool(const SpriteQueueItem&, const SpriteQueueItem&)>& compare) {
	s_spriteQueue.sortFront(compare);
}

const std::vector<RenderSubmission>& copySpriteQueueForPlayback() {
	size_t count = 0;
	s_spriteQueue.forEachBack([&](const SpriteQueueItem& item, size_t) {
		if (count >= s_spriteQueuePlaybackBuffer.size()) {
			RenderSubmission created;
			created.type = RenderSubmissionType::Img;
			created.img.imgid = "none";
			created.img.pos = {0.0f, 0.0f, DEFAULT_ZCOORD};
			created.img.scale = Vec2{1.0f, 1.0f};
			created.img.flip = FlipOptions{};
			created.img.colorize = Color{1.0f, 1.0f, 1.0f, 1.0f};
			s_spriteQueuePlaybackBuffer.push_back(created);
		}
		RenderSubmission& op = s_spriteQueuePlaybackBuffer[count];
		op.type = RenderSubmissionType::Img;
		const ImgRenderSubmission& src = item.options;
		ImgRenderSubmission& dst = op.img;
		dst.imgid = src.imgid;
		dst.layer = src.layer;
		dst.ambient_affected = src.ambient_affected;
		dst.ambient_factor = src.ambient_factor;
		dst.pos.x = src.pos.x;
		dst.pos.y = src.pos.y;
		dst.pos.z = src.pos.z;
		dst.scale = src.scale;
		dst.flip = src.flip;
		dst.colorize = src.colorize;
		count += 1;
	});
	s_spriteQueuePlaybackBuffer.resize(count);
	return s_spriteQueuePlaybackBuffer;
}

// --- Mesh queue API ---

void submitMesh(const MeshRenderSubmission& item) {
	s_meshQueue.submit(item);
}

i32 beginMeshQueue() {
	s_meshQueue.swap();
	return static_cast<i32>(s_meshQueue.sizeFront());
}

void forEachMeshQueue(const std::function<void(const MeshRenderSubmission&, size_t)>& fn) {
	s_meshQueue.forEachFront([&fn](const MeshRenderSubmission& item, size_t index) {
		fn(item, index);
	});
}

size_t meshQueueBackSize() { return s_meshQueue.sizeBack(); }
size_t meshQueueFrontSize() { return s_meshQueue.sizeFront(); }

// --- Particle queue API ---

void submit_particle(const ParticleRenderSubmission& item) {
	s_particleQueue.submit(item);
}

i32 beginParticleQueue() {
	s_particleQueue.swap();
	return static_cast<i32>(s_particleQueue.sizeFront());
}

void forEachParticleQueue(const std::function<void(const ParticleRenderSubmission&, size_t)>& fn) {
	s_particleQueue.forEachFront([&fn](const ParticleRenderSubmission& item, size_t index) {
		fn(item, index);
	});
}

size_t particleQueueBackSize() { return s_particleQueue.sizeBack(); }
size_t particleQueueFrontSize() { return s_particleQueue.sizeFront(); }

} // namespace RenderQueues
} // namespace bmsx
