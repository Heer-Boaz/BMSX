/*
 * render_queues.cpp - Render submission queues implementation
 *
 * Mirrors TypeScript render_queues.ts
 */

#include "render_queues.h"
#include "glyphs.h"
#include "../../rompack/runtime_assets.h"
#include "../../core/engine_core.h"
#include "../../core/font.h"
#include "../../vm/vm_runtime.h"
#include "../../utils/clamp.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace bmsx {
namespace RenderQueues {

// --- Queue instances ---

static FeatureQueue<SpriteQueueItem> s_spriteQueue(256);
static FeatureQueue<MeshRenderSubmission> s_meshQueue(256);
static FeatureQueue<ParticleRenderSubmission> s_particleQueue(1024);
static i32 s_spriteSubmissionCounter = 0;

i32 particleAmbientModeDefault = 0;
f32 particleAmbientFactorDefault = 1.0f;
SpriteParallaxRig spriteParallaxRig{};
std::array<f32, 3> _skyTint = {1.0f, 1.0f, 1.0f};
f32 _skyExposure = 1.0f;

// Default Z coordinate (mirrors TypeScript DEFAULT_ZCOORD)
static constexpr f32 DEFAULT_ZCOORD = 0.0f;
static constexpr f32 ZCOORD_MAX = 10000.0f;

// --- Object pools for sprite queue items ---

static std::vector<SpriteQueueItem> s_spriteItemPoolA;
static std::vector<SpriteQueueItem> s_spriteItemPoolB;
static std::vector<SpriteQueueItem>* s_spriteItemPool = &s_spriteItemPoolA;
static std::vector<SpriteQueueItem>* s_spriteItemPoolAlt = &s_spriteItemPoolB;
static size_t s_spriteItemPoolIndex = 0;
static std::vector<RenderSubmission> s_renderQueuePlaybackBuffer;

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

void submitSprite(const ImgRenderSubmission& options) {
	if (options.imgid == "none") return;

	auto& engine = EngineCore::instance();
	const auto* imgAsset = engine.assets().getImg(options.imgid);
	if (!imgAsset) {
		throw BMSX_RUNTIME_ERROR("[Sprite Queue] submitSprite called with unknown image id '" + options.imgid + "'.");
	}

	const ImgMeta* imgmeta = &imgAsset->meta;
	if (!imgmeta) {
		throw BMSX_RUNTIME_ERROR("[Sprite Queue] Image metadata missing for imgid '" + options.imgid + "'.");
	}

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
	pooled.options.parallax_weight = options.parallax_weight.value_or(0.0f);

	s_spriteQueue.submit(pooled);
}

i32 beginSpriteQueue() {
	s_spriteSubmissionCounter = 0;
	s_spriteQueue.swap();
	// Swap pools.
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

const std::vector<RenderSubmission>& copyRenderQueueForPlayback() {
	size_t count = 0;
	s_spriteQueue.forEachBack([&](const SpriteQueueItem& item, size_t) {
		if (count >= s_renderQueuePlaybackBuffer.size()) {
			s_renderQueuePlaybackBuffer.emplace_back();
		}
		RenderSubmission& op = s_renderQueuePlaybackBuffer[count];
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
		dst.parallax_weight = src.parallax_weight.value_or(0.0f);
		count += 1;
	});
	s_meshQueue.forEachBack([&](const MeshRenderSubmission& item, size_t) {
		if (count >= s_renderQueuePlaybackBuffer.size()) {
			s_renderQueuePlaybackBuffer.emplace_back();
		}
		RenderSubmission& op = s_renderQueuePlaybackBuffer[count];
		op.type = RenderSubmissionType::Mesh;
		op.mesh = item;
		count += 1;
	});
	s_particleQueue.forEachBack([&](const ParticleRenderSubmission& item, size_t) {
		if (count >= s_renderQueuePlaybackBuffer.size()) {
			s_renderQueuePlaybackBuffer.emplace_back();
		}
		RenderSubmission& op = s_renderQueuePlaybackBuffer[count];
		op.type = RenderSubmissionType::Particle;
		op.particle = item;
		count += 1;
	});
	s_renderQueuePlaybackBuffer.resize(count);
	return s_renderQueuePlaybackBuffer;
}

void correctAreaStartEnd(f32& x, f32& y, f32& ex, f32& ey) {
	if (ex < x) std::swap(x, ex);
	if (ey < y) std::swap(y, ey);
}

static i32 snapSpanToInt(f32 span) {
	const f32 snapped = std::round(span);
	if (std::abs(span - snapped) < 0.001f) {
		return static_cast<i32>(snapped);
	}
	return static_cast<i32>(span);
}

void submitRectangle(const RectRenderSubmission& options) {
	f32 x = options.area.left;
	f32 y = options.area.top;
	f32 ex = options.area.right;
	f32 ey = options.area.bottom;
	f32 z = options.area.z;
	const Color& c = options.color;

	correctAreaStartEnd(x, y, ex, ey);

	ImgRenderSubmission sprite;
	sprite.imgid = "whitepixel";
	sprite.pos = {x, y, z};
	sprite.colorize = c;
	sprite.layer = options.layer;

	const i32 width = snapSpanToInt(ex - x);
	const i32 height = snapSpanToInt(ey - y);

	if (options.kind == RectRenderSubmission::Kind::Fill) {
		sprite.scale = Vec2{static_cast<f32>(width),
							static_cast<f32>(height)};
		submitSprite(sprite);
		return;
	}

	const f32 widthF = static_cast<f32>(width);
	const f32 heightF = static_cast<f32>(height);

	sprite.scale = Vec2{widthF, 1.0f};
	submitSprite(sprite);

	sprite.pos = {x, ey, z};
	submitSprite(sprite);

	sprite.pos = {x, y, z};
	sprite.scale = Vec2{1.0f, heightF};
	submitSprite(sprite);

	sprite.pos = {ex, y, z};
	submitSprite(sprite);
}

void submitDrawPolygon(const PolyRenderSubmission& options) {
	const std::vector<f32>& coords = options.points;
	if (coords.size() < 4) return;

	const f32 z = options.z;
	const Color& color = options.color;
	const f32 thickness = options.thickness.value_or(1.0f);
	const std::optional<RenderLayer>& layer = options.layer;
	const std::string imgid = "whitepixel";

	for (size_t i = 0; i < coords.size(); i += 2) {
		size_t next = (i + 2) % coords.size();
		f32 x0 = std::round(coords[i]);
		f32 y0 = std::round(coords[i + 1]);
		f32 x1 = std::round(coords[next]);
		f32 y1 = std::round(coords[next + 1]);

		f32 dx = std::abs(x1 - x0);
		f32 dy = std::abs(y1 - y0);
		f32 sx = x0 < x1 ? 1.0f : -1.0f;
		f32 sy = y0 < y1 ? 1.0f : -1.0f;
		f32 err = dx - dy;

		while (true) {
			ImgRenderSubmission pixel;
			pixel.imgid = imgid;
			pixel.pos = {x0, y0, z};
			pixel.scale = {thickness, thickness};
			pixel.colorize = color;
			pixel.layer = layer;
			submitSprite(pixel);

			if (x0 == x1 && y0 == y1) break;

			f32 e2 = 2.0f * err;
			if (e2 > -dy) {
				err -= dy;
				x0 += sx;
			}
			if (x0 == x1 && y0 == y1) {
				ImgRenderSubmission finalPixel;
				finalPixel.imgid = imgid;
				finalPixel.pos = {x0, y0, z};
				finalPixel.scale = {thickness, thickness};
				finalPixel.colorize = color;
				finalPixel.layer = layer;
				submitSprite(finalPixel);
				break;
			}
			if (e2 < dx) {
				err += dx;
				y0 += sy;
			}
		}
	}
}

void submitGlyphs(const GlyphRenderSubmission& options) {
	GameView* view = EngineCore::instance().view();
	BFont* font = options.font ? options.font : view->default_font;
	if (!font) {
		throw BMSX_RUNTIME_ERROR("No font available for glyph rendering.");
	}

	const std::vector<std::string>* lines = &options.glyphs;
	std::vector<std::string> wrapped;
	if (options.wrap_chars && *options.wrap_chars > 0 && options.glyphs.size() == 1) {
		wrapped = wrapGlyphs(options.glyphs[0], *options.wrap_chars);
		lines = &wrapped;
	}

	f32 x = options.x;
	if (options.center_block_width && *options.center_block_width > 0) {
		x += calculateCenteredBlockX(*lines, font->char_width('a'),
										*options.center_block_width);
	}

	const f32 z = options.z.value_or(950.0f);
	renderGlyphs(x, options.y, *lines, options.glyph_start, options.glyph_end,
					z, font, options.color, options.background_color, options.layer);
}

void renderGlyphs(f32 x,
					f32 y,
					const std::vector<std::string>& lines,
					std::optional<i32> start,
					std::optional<i32> end,
					f32 z,
					BFont* font,
					const std::optional<Color>& color,
					const std::optional<Color>& backgroundColor,
					const std::optional<RenderLayer>& layer) {
	GameView* view = EngineCore::instance().view();
	::bmsx::renderGlyphs(view, x, y, lines, start, end, z, font, color,
							backgroundColor, layer);
}

f32 calculateCenteredBlockX(const std::vector<std::string>& lines, i32 charWidth, i32 blockWidth) {
	return ::bmsx::calculateCenteredBlockX(lines, charWidth, blockWidth);
}

std::vector<std::string> wrapGlyphs(const std::string& text, i32 maxLineLength) {
	return ::bmsx::wrapGlyphs(text, maxLineLength);
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
