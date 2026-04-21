/*
 * queues.cpp - Render submission queues implementation
 *
 * 2D submissions are translated into framebuffer blits here; mesh/particles stay queued.
 */

#include "queues.h"
#include "glyphs.h"
#include "rompack/assets.h"
#include "core/engine.h"
#include "core/font.h"
#include "../../machine/runtime/runtime.h"
#include "common/clamp.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace bmsx {
namespace RenderQueues {

// --- Queue instances ---

static FeatureQueue<MeshRenderSubmission> s_meshQueue(256);
static FeatureQueue<ParticleRenderSubmission> s_particleQueue(1024);
enum class QueueSource : u8 {
	Front = 0,
	Back = 1,
};
static QueueSource s_activeQueueSource = QueueSource::Front;

i32 particleAmbientModeDefault = 0;
f32 particleAmbientFactorDefault = 1.0f;
SpriteParallaxRig spriteParallaxRig{};
std::array<f32, 3> _skyTint = {1.0f, 1.0f, 1.0f};
f32 _skyExposure = 1.0f;

// Default Z coordinate.
static constexpr f32 DEFAULT_ZCOORD = 0.0f;

struct ResolvedSpriteAsset {
	u32 handle = 0u;
};

static ResolvedSpriteAsset resolveSpriteAsset(Memory& memory, const std::string& imgId, const char* context) {
	const u32 handle = memory.resolveAssetHandle(imgId);
	const auto& entry = memory.getAssetEntryByHandle(handle);
	if (entry.type != Memory::AssetType::Image) {
		throw BMSX_RUNTIME_ERROR("[" + std::string(context) + "] Asset '" + imgId + "' is not an image.");
	}
	if (entry.regionW == 0 || entry.regionH == 0) {
		throw BMSX_RUNTIME_ERROR("[" + std::string(context) + "] Image '" + imgId + "' has invalid region size.");
	}
	return ResolvedSpriteAsset{
		handle,
	};
}

static void submitResolvedSprite(Runtime& runtime,
									const ResolvedSpriteAsset& resolved,
									f32 x,
									f32 y,
									f32 z,
									f32 scaleX,
									f32 scaleY,
									const Color& color,
									RenderLayer layer,
									const FlipOptions& flip,
									f32 parallaxWeight) {
	(void)parallaxWeight;
	runtime.machine().vdp().enqueueBlit(resolved.handle, x, y, z, renderLayerTo2dLayer(layer), scaleX, scaleY, flip.flip_h, flip.flip_v, color);
}

static bool hasCommittedFrontQueueContent() {
	return s_meshQueue.sizeFront() > 0
		|| s_particleQueue.sizeFront() > 0;
}

template<typename T, typename Fn>
static void forEachActiveQueue(FeatureQueue<T>& queue, Fn&& fn) {
	if (s_activeQueueSource == QueueSource::Back) {
		queue.forEachBack(std::forward<Fn>(fn));
		return;
	}
	queue.forEachFront(std::forward<Fn>(fn));
}

// --- 2D framebuffer API ---

void submitSprite(const ImgRenderSubmission& options) {
	if (!options.scale.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitSprite requires scale.");
	}
	if (!options.flip.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitSprite requires flip.");
	}
	if (!options.colorize.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitSprite requires colorize.");
	}
	if (!options.layer.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitSprite requires layer.");
	}
	auto& runtime = Runtime::instance();
	auto& memory = runtime.machine().memory();
	const ResolvedSpriteAsset resolved = resolveSpriteAsset(memory, options.imgid, "Sprite Queue");
	submitResolvedSprite(
		runtime,
		resolved,
		options.pos.x,
		options.pos.y,
		options.pos.z,
		options.scale->x,
		options.scale->y,
		*options.colorize,
		*options.layer,
		*options.flip,
		options.parallax_weight.has_value() ? *options.parallax_weight : 0.0f
	);
}

void prepareCompletedRenderQueues() {
	s_meshQueue.swap();
	s_particleQueue.swap();
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
		|| s_particleQueue.sizeBack() > 0;
}

void clearBackQueues() {
	s_meshQueue.clearBack();
	s_particleQueue.clearBack();
	s_activeQueueSource = QueueSource::Front;
}

void clearAllQueues() {
	Runtime::instance().machine().vdp().initializeRegisters();
	s_meshQueue.clearAll();
	s_particleQueue.clearAll();
	s_activeQueueSource = QueueSource::Front;
}

void correctAreaStartEnd(f32& x, f32& y, f32& ex, f32& ey) {
	if (ex < x) std::swap(x, ex);
	if (ey < y) std::swap(y, ey);
}

void submitRectangle(const RectRenderSubmission& options) {
	if (!options.layer.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitRectangle requires layer.");
	}
	f32 x = options.area.left;
	f32 y = options.area.top;
	f32 ex = options.area.right;
	f32 ey = options.area.bottom;
	f32 z = options.area.z;
	const Color& c = options.color;

	correctAreaStartEnd(x, y, ex, ey);
	if (options.kind == RectRenderSubmission::Kind::Fill) {
		Runtime::instance().machine().vdp().enqueueFillRect(x, y, ex, ey, z, renderLayerTo2dLayer(*options.layer), c);
		return;
	}
	Runtime::instance().machine().vdp().enqueueDrawRect(x, y, ex, ey, z, renderLayerTo2dLayer(*options.layer), c);
}

void submitDrawPolygon(const PolyRenderSubmission& options) {
	if (!options.thickness.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitDrawPolygon requires thickness.");
	}
	if (!options.layer.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitDrawPolygon requires layer.");
	}
	Runtime::instance().machine().vdp().enqueueDrawPoly(options.points, options.z, options.color, *options.thickness, renderLayerTo2dLayer(*options.layer));
}

void submitGlyphs(const GlyphRenderSubmission& options) {
	if (!options.font) {
		throw BMSX_RUNTIME_ERROR("submitGlyphs requires font.");
	}
	if (!options.color.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitGlyphs requires color.");
	}
	if (!options.layer.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitGlyphs requires layer.");
	}
	if (!options.z.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitGlyphs requires z.");
	}
	if (!options.glyph_start.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitGlyphs requires glyph_start.");
	}
	if (!options.glyph_end.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitGlyphs requires glyph_end.");
	}

	const std::vector<std::string>* lines = &options.glyphs;
	std::vector<std::string> wrapped;
	if (options.wrap_chars && *options.wrap_chars > 0 && options.glyphs.size() == 1) {
		wrapped = ::bmsx::wrapGlyphs(options.glyphs[0], *options.wrap_chars);
		lines = &wrapped;
	}

	f32 x = options.x;
	if (options.center_block_width && *options.center_block_width > 0) {
		x += ::bmsx::calculateCenteredBlockX(*lines, options.font->char_width('a'),
										*options.center_block_width);
	}

	renderGlyphs(x, options.y, *lines, *options.glyph_start, *options.glyph_end,
					*options.z, options.font, *options.color, options.background_color, *options.layer);
}

void renderGlyphs(f32 x,
					f32 y,
					const std::vector<std::string>& lines,
					i32 start,
					i32 end,
					f32 z,
					BFont* font,
					const Color& color,
					const std::optional<Color>& backgroundColor,
					RenderLayer layer) {
	Runtime::instance().machine().vdp().enqueueGlyphRun(lines, x, y, z, font, color, backgroundColor, start, end, renderLayerTo2dLayer(layer));
}

// --- Mesh queue API ---

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

// --- Particle queue API ---

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

void setSpriteParallaxRig(f32 vy, f32 scale, f32 impact, f32 impact_t,
							f32 bias_px, f32 parallax_strength, f32 scale_strength,
							f32 flip_strength, f32 flip_window) {
	if (flip_window <= 0.0f) {
		throw BMSX_RUNTIME_ERROR("[RenderQueues] setSpriteParallaxRig requires flip_window > 0.");
	}
	spriteParallaxRig.vy = vy;
	spriteParallaxRig.scale = scale;
	spriteParallaxRig.impact = impact;
	spriteParallaxRig.impact_t = impact_t;
	spriteParallaxRig.bias_px = bias_px;
	spriteParallaxRig.parallax_strength = parallax_strength;
	spriteParallaxRig.scale_strength = scale_strength;
	spriteParallaxRig.flip_strength = flip_strength;
	spriteParallaxRig.flip_window = flip_window;
}

void setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure) {
	_skyTint = {std::max(0.0f, tint[0]), std::max(0.0f, tint[1]), std::max(0.0f, tint[2])};
	_skyExposure = std::max(0.0f, exposure);
}

} // namespace RenderQueues
} // namespace bmsx
