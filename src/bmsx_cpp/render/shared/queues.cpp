/*
 * queues.cpp - Render submission queues implementation
 *
 * 2D submissions are translated into framebuffer blits here; mesh/particles stay queued.
 */

#include "queues.h"
#include "glyphs.h"
#include "hardware/camera.h"
#include "hardware/lighting.h"
#include "core/utf8.h"
#include "core/font.h"
#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/common/word.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/registers.h"
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
std::array<f32, 3> _skyTint = {1.0f, 1.0f, 1.0f};
f32 _skyExposure = 1.0f;

// Default Z coordinate.
static constexpr f32 DEFAULT_ZCOORD = 0.0f;

static void submitResolvedSprite(Runtime& runtime,
									const VdpSlotSource& source,
									f32 x,
									f32 y,
									f32 z,
									f32 scaleX,
									f32 scaleY,
									const Color& color,
									RenderLayer layer,
									const FlipOptions& flip,
									f32 parallaxWeight) {
	auto& vdp = runtime.machine().vdp();
	vdp.writeVdpRegister(VDP_REG_SRC_SLOT, source.slot);
	vdp.writeVdpRegister(VDP_REG_SRC_UV, packLowHigh16(source.u, source.v));
	vdp.writeVdpRegister(VDP_REG_SRC_WH, packLowHigh16(source.w, source.h));
	vdp.writeVdpRegister(VDP_REG_DST_X, toSignedWord(FIX16_SCALE * x));
	vdp.writeVdpRegister(VDP_REG_DST_Y, toSignedWord(FIX16_SCALE * y));
	vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(renderLayerTo2dLayer(layer), z));
	vdp.writeVdpRegister(VDP_REG_DRAW_SCALE_X, toSignedWord(FIX16_SCALE * scaleX));
	vdp.writeVdpRegister(VDP_REG_DRAW_SCALE_Y, toSignedWord(FIX16_SCALE * scaleY));
	vdp.writeVdpRegister(VDP_REG_DRAW_CTRL, encodeVdpDrawCtrl(flip.flip_h, flip.flip_v, 0u, parallaxWeight));
	vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, packFrameBufferColorWord(color));
	vdp.consumeDirectVdpCommand(VDP_CMD_BLIT);
}

static void writeGeometryRegisters(VDP& vdp, f32 x0, f32 y0, f32 x1, f32 y1, f32 z, RenderLayer layer, const Color& color) {
	vdp.writeVdpRegister(VDP_REG_GEOM_X0, toSignedWord(FIX16_SCALE * x0));
	vdp.writeVdpRegister(VDP_REG_GEOM_Y0, toSignedWord(FIX16_SCALE * y0));
	vdp.writeVdpRegister(VDP_REG_GEOM_X1, toSignedWord(FIX16_SCALE * x1));
	vdp.writeVdpRegister(VDP_REG_GEOM_Y1, toSignedWord(FIX16_SCALE * y1));
	vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(renderLayerTo2dLayer(layer), z));
	vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, packFrameBufferColorWord(color));
}

static void submitFillRectDirect(Runtime& runtime, f32 x0, f32 y0, f32 x1, f32 y1, f32 z, RenderLayer layer, const Color& color) {
	auto& vdp = runtime.machine().vdp();
	writeGeometryRegisters(vdp, x0, y0, x1, y1, z, layer, color);
	vdp.consumeDirectVdpCommand(VDP_CMD_FILL_RECT);
}

static void submitLineDirect(Runtime& runtime, f32 x0, f32 y0, f32 x1, f32 y1, f32 z, RenderLayer layer, const Color& color, f32 thickness) {
	auto& vdp = runtime.machine().vdp();
	writeGeometryRegisters(vdp, x0, y0, x1, y1, z, layer, color);
	vdp.writeVdpRegister(VDP_REG_LINE_WIDTH, toSignedWord(FIX16_SCALE * thickness));
	vdp.consumeDirectVdpCommand(VDP_CMD_DRAW_LINE);
}

static u32 resolveAtlasSlot(Runtime& runtime, i32 atlasId) {
	if (atlasId == static_cast<i32>(VDP_SYSTEM_ATLAS_ID)) {
		return VDP_SLOT_SYSTEM;
	}
	const u32 atlas = static_cast<u32>(atlasId);
	if (runtime.machine().memory().readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS) == atlas) {
		return VDP_SLOT_PRIMARY;
	}
	if (runtime.machine().memory().readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS) == atlas) {
		return VDP_SLOT_SECONDARY;
	}
	throw BMSX_RUNTIME_ERROR("atlas " + std::to_string(atlasId) + " is not loaded in a VDP slot.");
}

static void renderGlyphLineDirect(Runtime& runtime, f32 x, f32 y, const std::string& line, i32 start, i32 end, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, RenderLayer layer) {
	f32 cursorX = x;
	size_t byteIndex = 0u;
	i32 glyphIndex = 0;
	FlipOptions flip;
	while (byteIndex < line.size()) {
		const u32 codepoint = readUtf8Codepoint(line, byteIndex);
		if (glyphIndex >= end) {
			break;
		}
		const FontGlyph& glyph = font->getGlyph(codepoint);
		if (glyphIndex >= start) {
			if (backgroundColor.has_value()) {
				submitFillRectDirect(runtime, cursorX, y, cursorX + static_cast<f32>(glyph.rect.w), y + static_cast<f32>(glyph.rect.h), z, layer, *backgroundColor);
			}
			const VdpSlotSource source{
				resolveAtlasSlot(runtime, glyph.rect.atlasId),
				glyph.rect.u,
				glyph.rect.v,
				glyph.rect.w,
				glyph.rect.h,
			};
			submitResolvedSprite(runtime, source, cursorX, y, z, 1.0f, 1.0f, color, layer, flip, 0.0f);
		}
		cursorX += static_cast<f32>(glyph.advance);
		glyphIndex += 1;
	}
}

static bool hasCommittedFrontQueueContent() {
	return s_meshQueue.sizeFront() > 0
		|| s_particleQueue.sizeFront() > 0;
}

template<typename T, typename Fn>
static void forEachActiveQueue(FeatureQueue<T>& queue, Fn&& fn) {
	if (s_activeQueueSource == QueueSource::Back) {
		queue.back().forEach(std::forward<Fn>(fn));
		return;
	}
	queue.front().forEach(std::forward<Fn>(fn));
}

// --- 2D framebuffer API ---

void submitSprite(Runtime& runtime, const ImgRenderSubmission& options) {
	if (!options.slot.has_value() || !options.u.has_value() || !options.v.has_value() || !options.w.has_value() || !options.h.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitSprite requires slot/u/v/w/h.");
	}
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
	const VdpSlotSource source{*options.slot, *options.u, *options.v, *options.w, *options.h};
	submitResolvedSprite(
		runtime,
		source,
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

void clearAllQueues(Runtime& runtime) {
	auto& vdp = runtime.machine().vdp();
	vdp.initializeRegisters();
	s_meshQueue.clearAll();
	s_particleQueue.clearAll();
	s_activeQueueSource = QueueSource::Front;
}

void correctAreaStartEnd(f32& x, f32& y, f32& ex, f32& ey) {
	if (ex < x) std::swap(x, ex);
	if (ey < y) std::swap(y, ey);
}

void submitRectangle(Runtime& runtime, const RectRenderSubmission& options) {
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
		submitFillRectDirect(runtime, x, y, ex, ey, z, *options.layer, c);
		return;
	}
	submitLineDirect(runtime, x, y, ex, y, z, *options.layer, c, 1.0f);
	submitLineDirect(runtime, ex, y, ex, ey, z, *options.layer, c, 1.0f);
	submitLineDirect(runtime, ex, ey, x, ey, z, *options.layer, c, 1.0f);
	submitLineDirect(runtime, x, ey, x, y, z, *options.layer, c, 1.0f);
}

void submitDrawPolygon(Runtime& runtime, const PolyRenderSubmission& options) {
	if (!options.thickness.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitDrawPolygon requires thickness.");
	}
	if (!options.layer.has_value()) {
		throw BMSX_RUNTIME_ERROR("submitDrawPolygon requires layer.");
	}
	for (size_t index = 0; index + 3u < options.points.size(); index += 2u) {
		submitLineDirect(runtime, options.points[index], options.points[index + 1u], options.points[index + 2u], options.points[index + 3u], options.z, *options.layer, options.color, *options.thickness);
	}
}

void submitGlyphs(Runtime& runtime, const GlyphRenderSubmission& options) {
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

	renderGlyphs(runtime, x, options.y, *lines, *options.glyph_start, *options.glyph_end,
					*options.z, options.font, *options.color, options.background_color, *options.layer);
}

void renderGlyphs(Runtime& runtime,
					f32 x,
					f32 y,
					const std::vector<std::string>& lines,
					i32 start,
					i32 end,
					f32 z,
					BFont* font,
					const Color& color,
					const std::optional<Color>& backgroundColor,
					RenderLayer layer) {
	f32 cursorY = y;
	for (const auto& line : lines) {
		renderGlyphLineDirect(runtime, x, cursorY, line, start, end, z, font, color, backgroundColor, layer);
		cursorY += static_cast<f32>(font->lineHeight());
	}
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

void setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure) {
	_skyTint = {std::max(0.0f, tint[0]), std::max(0.0f, tint[1]), std::max(0.0f, tint[2])};
	_skyExposure = std::max(0.0f, exposure);
}

} // namespace RenderQueues
} // namespace bmsx
