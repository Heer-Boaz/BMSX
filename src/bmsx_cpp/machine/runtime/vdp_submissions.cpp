#include "machine/runtime/vdp_submissions.h"

#include "core/font.h"
#include "core/utf8.h"
#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/common/word.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/registers.h"
#include "machine/runtime/runtime.h"
#include "render/shared/glyphs.h"
#include <algorithm>
#include <stdexcept>
#include <utility>

namespace bmsx {
namespace VdpSubmissions {
namespace {

void submitResolvedSprite(Runtime& runtime,
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
	runtime.machine().memory().writeValue(IO_VDP_REG_SRC_SLOT, valueNumber(static_cast<double>(source.slot)));
	runtime.machine().memory().writeValue(IO_VDP_REG_SRC_UV, valueNumber(static_cast<double>(packLowHigh16(source.u, source.v))));
	runtime.machine().memory().writeValue(IO_VDP_REG_SRC_WH, valueNumber(static_cast<double>(packLowHigh16(source.w, source.h))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DST_X, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * x))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DST_Y, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * y))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, valueNumber(static_cast<double>(encodeVdpLayerPriority(renderLayerTo2dLayer(layer), z))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DRAW_SCALE_X, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * scaleX))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DRAW_SCALE_Y, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * scaleY))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DRAW_CTRL, valueNumber(static_cast<double>(encodeVdpDrawCtrl(flip.flip_h, flip.flip_v, 0u, parallaxWeight))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DRAW_COLOR, valueNumber(static_cast<double>(packFrameBufferColorWord(color))));
	runtime.machine().memory().writeValue(IO_VDP_CMD, valueNumber(static_cast<double>(VDP_CMD_BLIT)));
}

void writeGeometryRegisters(Runtime& runtime, f32 x0, f32 y0, f32 x1, f32 y1, f32 z, RenderLayer layer, const Color& color) {
	runtime.machine().memory().writeValue(IO_VDP_REG_GEOM_X0, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * x0))));
	runtime.machine().memory().writeValue(IO_VDP_REG_GEOM_Y0, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * y0))));
	runtime.machine().memory().writeValue(IO_VDP_REG_GEOM_X1, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * x1))));
	runtime.machine().memory().writeValue(IO_VDP_REG_GEOM_Y1, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * y1))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, valueNumber(static_cast<double>(encodeVdpLayerPriority(renderLayerTo2dLayer(layer), z))));
	runtime.machine().memory().writeValue(IO_VDP_REG_DRAW_COLOR, valueNumber(static_cast<double>(packFrameBufferColorWord(color))));
}

void submitFillRectDirect(Runtime& runtime, f32 x0, f32 y0, f32 x1, f32 y1, f32 z, RenderLayer layer, const Color& color) {
	writeGeometryRegisters(runtime, x0, y0, x1, y1, z, layer, color);
	runtime.machine().memory().writeValue(IO_VDP_CMD, valueNumber(static_cast<double>(VDP_CMD_FILL_RECT)));
}

void submitLineDirect(Runtime& runtime, f32 x0, f32 y0, f32 x1, f32 y1, f32 z, RenderLayer layer, const Color& color, f32 thickness) {
	writeGeometryRegisters(runtime, x0, y0, x1, y1, z, layer, color);
	runtime.machine().memory().writeValue(IO_VDP_REG_LINE_WIDTH, valueNumber(static_cast<double>(toSignedWord(FIX16_SCALE * thickness))));
	runtime.machine().memory().writeValue(IO_VDP_CMD, valueNumber(static_cast<double>(VDP_CMD_DRAW_LINE)));
}

uint32_t resolveAtlasSlot(Runtime& runtime, i32 atlasId) {
	if (atlasId == static_cast<i32>(VDP_SYSTEM_ATLAS_ID)) {
		return VDP_SLOT_SYSTEM;
	}
	const uint32_t atlas = static_cast<uint32_t>(atlasId);
	if (runtime.machine().memory().readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS) == atlas) {
		return VDP_SLOT_PRIMARY;
	}
	if (runtime.machine().memory().readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS) == atlas) {
		return VDP_SLOT_SECONDARY;
	}
	throw BMSX_RUNTIME_ERROR("atlas " + std::to_string(atlasId) + " is not loaded in a VDP slot.");
}

void renderGlyphLine(Runtime& runtime, f32 x, f32 y, const std::string& line, i32 start, i32 end, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, RenderLayer layer) {
	f32 cursorX = x;
	size_t byteIndex = 0u;
	i32 glyphIndex = 0;
	FlipOptions flip;
	while (byteIndex < line.size()) {
		const uint32_t codepoint = readUtf8Codepoint(line, byteIndex);
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

void correctAreaStartEnd(f32& x, f32& y, f32& ex, f32& ey) {
	if (ex < x) std::swap(x, ex);
	if (ey < y) std::swap(y, ey);
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
		renderGlyphLine(runtime, x, cursorY, line, start, end, z, font, color, backgroundColor, layer);
		cursorY += static_cast<f32>(font->lineHeight());
	}
}

} // namespace

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
		wrapped = wrapGlyphs(options.glyphs[0], *options.wrap_chars);
		lines = &wrapped;
	}

	f32 x = options.x;
	if (options.center_block_width && *options.center_block_width > 0) {
		x += calculateCenteredBlockX(*lines, options.font->char_width('a'), *options.center_block_width);
	}

	renderGlyphs(runtime, x, options.y, *lines, *options.glyph_start, *options.glyph_end,
		*options.z, options.font, *options.color, options.background_color, *options.layer);
}

} // namespace VdpSubmissions
} // namespace bmsx
