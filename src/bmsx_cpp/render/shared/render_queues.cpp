/*
 * render_queues.cpp - Render submission queues implementation
 *
 * Mirrors TypeScript render_queues.ts.
 * Sprites are translated into machine OAM here and consumed mechanically by renderers.
 */

#include "render_queues.h"
#include "glyphs.h"
#include "../../rompack/runtime_assets.h"
#include "../../core/engine_core.h"
#include "../../core/font.h"
#include "../../emulator/runtime.h"
#include "../../utils/clamp.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

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

// Default Z coordinate (mirrors TypeScript DEFAULT_ZCOORD)
static constexpr f32 DEFAULT_ZCOORD = 0.0f;

static const Memory::AssetEntry& resolveImageBaseEntry(Memory& memory, const Memory::AssetEntry& entry, const std::string& context) {
	if ((entry.flags & ASSET_FLAG_VIEW) == 0u) {
		return entry;
	}
	try {
		return memory.getAssetEntryByHandle(entry.ownerIndex);
	} catch (const std::exception& e) {
		throw BMSX_RUNTIME_ERROR("[" + context + "] View asset '" + entry.id + "' has invalid ownerIndex "
			+ std::to_string(entry.ownerIndex) + ": " + e.what());
	}
}

static std::vector<RenderSubmission> s_renderQueuePlaybackBuffer;

static u32 packColor8888(const std::optional<Color>& color) {
	const Color c = color.value_or(Color{1.0f, 1.0f, 1.0f, 1.0f});
	const u32 r = static_cast<u32>(std::round(clamp(c.r, 0.0f, 1.0f) * 255.0f));
	const u32 g = static_cast<u32>(std::round(clamp(c.g, 0.0f, 1.0f) * 255.0f));
	const u32 b = static_cast<u32>(std::round(clamp(c.b, 0.0f, 1.0f) * 255.0f));
	const u32 a = static_cast<u32>(std::round(clamp(c.a, 0.0f, 1.0f) * 255.0f));
	return r | (g << 8u) | (b << 16u) | (a << 24u);
}

static u32 readUtf8Codepoint(const std::string& text, size_t& index) {
	u8 c0 = static_cast<u8>(text.at(index++));
	if (c0 < 0x80) {
		return c0;
	}
	if ((c0 & 0xE0) == 0xC0) {
		u8 c1 = static_cast<u8>(text.at(index++));
		return ((c0 & 0x1F) << 6) | (c1 & 0x3F);
	}
	if ((c0 & 0xF0) == 0xE0) {
		u8 c1 = static_cast<u8>(text.at(index++));
		u8 c2 = static_cast<u8>(text.at(index++));
		return ((c0 & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
	}
	u8 c1 = static_cast<u8>(text.at(index++));
	u8 c2 = static_cast<u8>(text.at(index++));
	u8 c3 = static_cast<u8>(text.at(index++));
	return ((c0 & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
}

static bool hasCommittedFrontQueueContent() {
	return Runtime::instance().vdp().hasFront2dContent()
		|| s_meshQueue.sizeFront() > 0
		|| s_particleQueue.sizeFront() > 0;
}

// --- Sprite queue API ---

void submitSprite(const ImgRenderSubmission& options) {
	if (options.imgid == "none") return;

	auto& runtime = Runtime::instance();
	auto& memory = runtime.memory();
	const u32 handle = memory.resolveAssetHandle(options.imgid);
	const auto& entry = memory.getAssetEntryByHandle(handle);
	if (entry.type != Memory::AssetType::Image) {
		throw BMSX_RUNTIME_ERROR("[Sprite Queue] Asset '" + options.imgid + "' is not an image.");
	}
	const auto* imgAsset = EngineCore::instance().resolveImgAsset(entry.id);
	if (!imgAsset) {
		throw BMSX_RUNTIME_ERROR("[Sprite Queue] Missing image metadata for '" + options.imgid + "'.");
	}
	const ImgMeta& meta = imgAsset->meta;
	const auto baseEntry = resolveImageBaseEntry(memory, entry, "Sprite Queue");
	if (entry.regionW == 0 || entry.regionH == 0) {
		throw BMSX_RUNTIME_ERROR("[Sprite Queue] Image '" + options.imgid + "' has invalid region size.");
	}
	if (baseEntry.regionW == 0 || baseEntry.regionH == 0) {
		throw BMSX_RUNTIME_ERROR("[Sprite Queue] Atlas backing entry for '" + options.imgid + "' is missing dimensions.");
	}

	f32 u0 = static_cast<f32>(entry.regionX) / static_cast<f32>(baseEntry.regionW);
	f32 v0 = static_cast<f32>(entry.regionY) / static_cast<f32>(baseEntry.regionH);
	f32 u1 = static_cast<f32>(entry.regionX + entry.regionW) / static_cast<f32>(baseEntry.regionW);
	f32 v1 = static_cast<f32>(entry.regionY + entry.regionH) / static_cast<f32>(baseEntry.regionH);
	const FlipOptions flip = options.flip.value_or(FlipOptions{});
	if (flip.flip_h) {
		std::swap(u0, u1);
	}
	if (flip.flip_v) {
		std::swap(v0, v1);
	}

	const Vec2 scale = options.scale.value_or(Vec2{1.0f, 1.0f});
	const Color color = options.colorize.value_or(Color{1.0f, 1.0f, 1.0f, 1.0f});
	OamEntry oam;
	oam.atlasId = meta.atlasid;
	oam.flags = OAM_FLAG_ENABLED;
	oam.assetHandle = handle;
	oam.x = static_cast<f32>(static_cast<i32>(options.pos.x));
	oam.y = static_cast<f32>(static_cast<i32>(options.pos.y));
	oam.z = static_cast<f32>(static_cast<i32>(options.pos.z));
	oam.w = static_cast<f32>(entry.regionW) * scale.x;
	oam.h = static_cast<f32>(entry.regionH) * scale.y;
	oam.u0 = u0;
	oam.v0 = v0;
	oam.u1 = u1;
	oam.v1 = v1;
	oam.r = color.r;
	oam.g = color.g;
	oam.b = color.b;
	oam.a = color.a;
	oam.layer = renderLayerToOamLayer(options.layer);
	oam.parallaxWeight = oam.layer == OamLayer::World ? options.parallax_weight.value_or(0.0f) : 0.0f;
	runtime.vdp().submitOamEntry(oam);
}

void prepareCompletedRenderQueues() {
	Runtime::instance().vdp().swapBgMapBuffers();
	Runtime::instance().vdp().swapPatBuffers();
	Runtime::instance().vdp().swapOamBuffers();
	Runtime::instance().vdp().setOamReadSource(false);
	s_meshQueue.swap();
	s_particleQueue.swap();
	s_activeQueueSource = QueueSource::Front;
}

void preparePartialRenderQueues() {
	s_activeQueueSource = hasCommittedFrontQueueContent()
		? QueueSource::Front
		: (hasPendingBackQueueContent() ? QueueSource::Back : QueueSource::Front);
	Runtime::instance().vdp().setOamReadSource(s_activeQueueSource == QueueSource::Back);
}

void prepareOverlayRenderQueues() {
	s_activeQueueSource = QueueSource::Back;
	Runtime::instance().vdp().setOamReadSource(true);
}

bool hasPendingBackQueueContent() {
	return Runtime::instance().vdp().hasBack2dContent()
		|| s_meshQueue.sizeBack() > 0
		|| s_particleQueue.sizeBack() > 0;
}

i32 beginSpriteQueue() {
	return Runtime::instance().vdp().begin2dRead();
}

void clearBackQueues() {
	Runtime::instance().vdp().clearBackBgMap();
	Runtime::instance().vdp().clearBackPatBuffer();
	Runtime::instance().vdp().clearBackOamBuffer();
	s_meshQueue.clearBack();
	s_particleQueue.clearBack();
	s_activeQueueSource = QueueSource::Front;
	Runtime::instance().vdp().setOamReadSource(false);
}

void clearAllQueues() {
	Runtime::instance().vdp().initializeRegisters();
	s_meshQueue.clearAll();
	s_particleQueue.clearAll();
	s_activeQueueSource = QueueSource::Front;
}

void forEachOamEntry(const std::function<void(const OamEntry&, size_t)>& fn) {
	Runtime::instance().vdp().forEachOamEntry(fn);
}

size_t spriteQueueBackSize() { return static_cast<size_t>(Runtime::instance().vdp().backOamCount()); }
size_t spriteQueueFrontSize() { return static_cast<size_t>(Runtime::instance().vdp().frontOamCount()); }

const std::vector<RenderSubmission>& copyRenderQueueForPlayback() {
	auto& memory = Runtime::instance().memory();
	size_t count = 0;
	const auto copySpriteEntries = [&]() {
		Runtime::instance().vdp().forEach2dEntry([&](const OamEntry& src, size_t) {
			if (count >= s_renderQueuePlaybackBuffer.size()) {
				s_renderQueuePlaybackBuffer.emplace_back();
			}
			RenderSubmission& op = s_renderQueuePlaybackBuffer[count];
			op.type = RenderSubmissionType::Img;
			ImgRenderSubmission& dst = op.img;
			const auto& asset = memory.getAssetEntryByHandle(src.assetHandle);
			if (asset.type != Memory::AssetType::Image) {
				throw BMSX_RUNTIME_ERROR("[Render Queue Playback] OAM entry references non-image asset.");
			}
			if (asset.regionW == 0 || asset.regionH == 0) {
				throw BMSX_RUNTIME_ERROR("[Render Queue Playback] OAM entry references zero-sized image asset '" + asset.id + "'.");
			}
			dst.imgid = asset.id;
			dst.layer = oamLayerToRenderLayer(src.layer);
			dst.ambient_affected.reset();
			dst.ambient_factor.reset();
			dst.pos = {src.x, src.y, src.z};
			dst.scale = Vec2{src.w / static_cast<f32>(asset.regionW), src.h / static_cast<f32>(asset.regionH)};
			dst.flip = FlipOptions{src.u0 > src.u1, src.v0 > src.v1};
			dst.colorize = Color{src.r, src.g, src.b, src.a};
			dst.parallax_weight = src.parallaxWeight;
			count += 1;
		});
	};
	const auto copyMesh = [&](const MeshRenderSubmission& item, size_t) {
		if (count >= s_renderQueuePlaybackBuffer.size()) {
			s_renderQueuePlaybackBuffer.emplace_back();
		}
		RenderSubmission& op = s_renderQueuePlaybackBuffer[count];
		op.type = RenderSubmissionType::Mesh;
		op.mesh = item;
		count += 1;
	};
	const auto copyParticle = [&](const ParticleRenderSubmission& item, size_t) {
		if (count >= s_renderQueuePlaybackBuffer.size()) {
			s_renderQueuePlaybackBuffer.emplace_back();
		}
		RenderSubmission& op = s_renderQueuePlaybackBuffer[count];
		op.type = RenderSubmissionType::Particle;
		op.particle = item;
		count += 1;
	};
	if (s_activeQueueSource == QueueSource::Back) {
		copySpriteEntries();
		s_meshQueue.forEachBack(copyMesh);
		s_particleQueue.forEachBack(copyParticle);
	} else {
		copySpriteEntries();
		s_meshQueue.forEachFront(copyMesh);
		s_particleQueue.forEachFront(copyParticle);
	}
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
	if (!font) {
		throw BMSX_RUNTIME_ERROR("No font or default font available for renderGlyphs");
	}
	Runtime& runtime = Runtime::instance();
	Memory& memory = runtime.memory();
	const f32 startX = x;
	f32 stepY = 0.0f;
	const i32 startIndex = start.value_or(0);
	const i32 endIndex = end.value_or(std::numeric_limits<i32>::max());
	const u32 packedColor = packColor8888(color);
	const u32 packedBackgroundColor = packColor8888(backgroundColor);
	u32 backgroundHandle = 0u;
	Memory::AssetEntry backgroundEntry{};
	Memory::AssetEntry backgroundBaseEntry{};
	const ImgAsset* backgroundImgAsset = nullptr;
	if (backgroundColor.has_value()) {
		backgroundHandle = memory.resolveAssetHandle("whitepixel");
		backgroundEntry = memory.getAssetEntryByHandle(backgroundHandle);
		if (backgroundEntry.type != Memory::AssetType::Image) {
			throw BMSX_RUNTIME_ERROR("[Glyph Queue] Asset 'whitepixel' is not an image.");
		}
		backgroundImgAsset = EngineCore::instance().resolveImgAsset(backgroundEntry.id);
		if (!backgroundImgAsset) {
			throw BMSX_RUNTIME_ERROR("[Glyph Queue] Missing image metadata for 'whitepixel'.");
		}
		backgroundBaseEntry = resolveImageBaseEntry(memory, backgroundEntry, "Glyph Queue");
	}

	for (const auto& line : lines) {
		if (line.empty()) {
			y += static_cast<f32>(font->lineHeight());
			stepY = 0.0f;
			continue;
		}

		size_t byteIndex = 0;
		i32 glyphIndex = 0;
		while (byteIndex < line.size()) {
			const u32 codepoint = readUtf8Codepoint(line, byteIndex);
			if (glyphIndex < startIndex) {
				++glyphIndex;
				continue;
			}
			if (glyphIndex >= endIndex) {
				break;
			}

			const FontGlyph& glyph = font->getGlyph(codepoint);
			const f32 stepX = static_cast<f32>(glyph.advance);
			const f32 glyphHeight = static_cast<f32>(glyph.height);
			if (glyphHeight > stepY) {
				stepY = glyphHeight;
			}
			if (backgroundImgAsset) {
				PatEntry backgroundPat;
				backgroundPat.atlasId = backgroundImgAsset->meta.atlasid;
				backgroundPat.flags = PAT_FLAG_ENABLED;
				backgroundPat.assetHandle = backgroundHandle;
				backgroundPat.layer = renderLayerToOamLayer(layer);
				backgroundPat.x = static_cast<f32>(static_cast<i32>(x));
				backgroundPat.y = static_cast<f32>(static_cast<i32>(y));
				backgroundPat.z = static_cast<f32>(static_cast<i32>(z));
				backgroundPat.glyphW = stepX;
				backgroundPat.glyphH = static_cast<f32>(font->lineHeight());
				backgroundPat.bgW = 0.0f;
				backgroundPat.bgH = 0.0f;
				backgroundPat.u0 = static_cast<f32>(backgroundEntry.regionX) / static_cast<f32>(backgroundBaseEntry.regionW);
				backgroundPat.v0 = static_cast<f32>(backgroundEntry.regionY) / static_cast<f32>(backgroundBaseEntry.regionH);
				backgroundPat.u1 = static_cast<f32>(backgroundEntry.regionX + backgroundEntry.regionW) / static_cast<f32>(backgroundBaseEntry.regionW);
				backgroundPat.v1 = static_cast<f32>(backgroundEntry.regionY + backgroundEntry.regionH) / static_cast<f32>(backgroundBaseEntry.regionH);
				backgroundPat.fgColor = packedBackgroundColor;
				backgroundPat.bgColor = 0u;
				runtime.vdp().submitPatEntry(backgroundPat);
			}

			const u32 handle = memory.resolveAssetHandle(glyph.imgid);
			const auto& entry = memory.getAssetEntryByHandle(handle);
			if (entry.type != Memory::AssetType::Image) {
				throw BMSX_RUNTIME_ERROR("[Glyph Queue] Asset '" + glyph.imgid + "' is not an image.");
			}
			const ImgAsset* imgAsset = EngineCore::instance().resolveImgAsset(entry.id);
			if (!imgAsset) {
				throw BMSX_RUNTIME_ERROR("[Glyph Queue] Missing image metadata for '" + glyph.imgid + "'.");
			}
			const auto baseEntry = resolveImageBaseEntry(memory, entry, "Glyph Queue");

			PatEntry pat;
			pat.atlasId = imgAsset->meta.atlasid;
			pat.flags = PAT_FLAG_ENABLED;
			pat.assetHandle = handle;
			pat.layer = renderLayerToOamLayer(layer);
			pat.x = static_cast<f32>(static_cast<i32>(x));
			pat.y = static_cast<f32>(static_cast<i32>(y));
			pat.z = static_cast<f32>(static_cast<i32>(z));
			pat.glyphW = static_cast<f32>(glyph.width);
			pat.glyphH = static_cast<f32>(glyph.height);
			pat.bgW = 0.0f;
			pat.bgH = 0.0f;
			pat.u0 = static_cast<f32>(entry.regionX) / static_cast<f32>(baseEntry.regionW);
			pat.v0 = static_cast<f32>(entry.regionY) / static_cast<f32>(baseEntry.regionH);
			pat.u1 = static_cast<f32>(entry.regionX + entry.regionW) / static_cast<f32>(baseEntry.regionW);
			pat.v1 = static_cast<f32>(entry.regionY + entry.regionH) / static_cast<f32>(baseEntry.regionH);
			pat.fgColor = packedColor;
			pat.bgColor = 0u;
			runtime.vdp().submitPatEntry(pat);

			x += stepX;
			++glyphIndex;
		}

		x = startX;
		y += stepY;
		stepY = 0.0f;
	}
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
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_meshQueue.sizeBack() : s_meshQueue.sizeFront());
}

void forEachMeshQueue(const std::function<void(const MeshRenderSubmission&, size_t)>& fn) {
	if (s_activeQueueSource == QueueSource::Back) {
		s_meshQueue.forEachBack([&fn](const MeshRenderSubmission& item, size_t index) {
			fn(item, index);
		});
		return;
	}
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
	return static_cast<i32>(s_activeQueueSource == QueueSource::Back ? s_particleQueue.sizeBack() : s_particleQueue.sizeFront());
}

void forEachParticleQueue(const std::function<void(const ParticleRenderSubmission&, size_t)>& fn) {
	if (s_activeQueueSource == QueueSource::Back) {
		s_particleQueue.forEachBack([&fn](const ParticleRenderSubmission& item, size_t index) {
			fn(item, index);
		});
		return;
	}
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
