#include "vdp.h"
#include "memory_map.h"
#include "../rompack/runtime_assets.h"
#include "../core/engine_core.h"
#include "../core/font.h"
#include "../render/texturemanager.h"
#include "devices/imgdec_controller.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <unordered_set>

namespace bmsx {
namespace {

constexpr uint32_t VDP_RD_SURFACE_ENGINE = 0u;
constexpr uint32_t VDP_RD_SURFACE_PRIMARY = 1u;
constexpr uint32_t VDP_RD_SURFACE_SECONDARY = 2u;
constexpr uint32_t VDP_RD_SURFACE_COUNT = 3u;
constexpr uint32_t VDP_RD_BUDGET_BYTES = 4096u;
constexpr uint32_t VDP_RD_MAX_CHUNK_PIXELS = 256u;
constexpr size_t VRAM_GARBAGE_CHUNK_BYTES = 64u * 1024u;
constexpr uint32_t VRAM_GARBAGE_SPACE_SALT = 0x5652414dU;
constexpr int VRAM_GARBAGE_WEIGHT_BLOCK = 1;
constexpr int VRAM_GARBAGE_WEIGHT_ROW = 2;
constexpr int VRAM_GARBAGE_WEIGHT_PAGE = 4;
constexpr int VRAM_GARBAGE_FORCE_T0 = 120;
constexpr int VRAM_GARBAGE_FORCE_T1 = 280;
constexpr int VRAM_GARBAGE_FORCE_T2 = 480;
constexpr int VRAM_GARBAGE_FORCE_T_DEN = 1000;

struct OctaveSpec {
	uint32_t shift;
	int weight;
	uint32_t mul;
	uint32_t mix;
};

constexpr OctaveSpec VRAM_GARBAGE_OCTAVES[] = {
	{11u, 8, 0x165667b1U, 0xd3a2646cU},
	{15u, 12, 0x27d4eb2fU, 0x6c8e9cf5U},
	{17u, 16, 0x7f4a7c15U, 0x31415926U},
	{19u, 20, 0xa24baed5U, 0x9e3779b9U},
	{21u, 24, 0x6a09e667U, 0xbb67ae85U},
};
uint32_t skyboxFaceBaseByIndex(size_t index) {
	switch (index) {
		case 0: return VRAM_SKYBOX_POSX_BASE;
		case 1: return VRAM_SKYBOX_NEGX_BASE;
		case 2: return VRAM_SKYBOX_POSY_BASE;
		case 3: return VRAM_SKYBOX_NEGY_BASE;
		case 4: return VRAM_SKYBOX_POSZ_BASE;
		case 5: return VRAM_SKYBOX_NEGZ_BASE;
		default: break;
	}
	throw BMSX_RUNTIME_ERROR("[VDP] Skybox face index out of range.");
}

bool isAtlasName(const std::string& name) {
	static constexpr const char* kPrefix = "_atlas_";
	return name.rfind(kPrefix, 0) == 0;
}

uint32_t fmix32(uint32_t h) {
	h ^= h >> 16u;
	h *= 0x85ebca6bU;
	h ^= h >> 13u;
	h *= 0xc2b2ae35U;
	h ^= h >> 16u;
	return h;
}

uint32_t xorshift32(uint32_t x) {
	x ^= x << 13u;
	x ^= x >> 17u;
	x ^= x << 5u;
	return x;
}

uint32_t scramble32(uint32_t x) {
	return x * 0x9e3779bbU;
}

int signed8FromHash(uint32_t h) {
	return static_cast<int>((h >> 24u) & 0xFFu) - 128;
}

struct BlockGen {
	uint32_t forceMask = 0;
	uint32_t prefWord = 0;
	uint32_t weakMask = 0;
	uint32_t baseState = 0;
	uint32_t bootState = 0;
	uint32_t genWordPos = 0;
};

struct BiasConfig {
	uint32_t activeOctaves = 0;
	int threshold0 = 0;
	int threshold1 = 0;
	int threshold2 = 0;
};

BiasConfig makeBiasConfig(uint32_t vramBytes) {
	const uint32_t maxOctaveBytes = vramBytes >> 1u;
	int weightSum = VRAM_GARBAGE_WEIGHT_BLOCK + VRAM_GARBAGE_WEIGHT_ROW + VRAM_GARBAGE_WEIGHT_PAGE;
	uint32_t activeOctaves = 0;
	for (uint32_t i = 0; i < (sizeof(VRAM_GARBAGE_OCTAVES) / sizeof(VRAM_GARBAGE_OCTAVES[0])); ++i) {
		const uint32_t octaveBytes = 1u << (VRAM_GARBAGE_OCTAVES[i].shift + 5u);
		if (octaveBytes > maxOctaveBytes) {
			break;
		}
		weightSum += VRAM_GARBAGE_OCTAVES[i].weight;
		activeOctaves = i + 1u;
	}
	const int maxBias = weightSum * 127;
	BiasConfig config;
	config.activeOctaves = activeOctaves;
	config.threshold0 = (maxBias * VRAM_GARBAGE_FORCE_T0) / VRAM_GARBAGE_FORCE_T_DEN;
	config.threshold1 = (maxBias * VRAM_GARBAGE_FORCE_T1) / VRAM_GARBAGE_FORCE_T_DEN;
	config.threshold2 = (maxBias * VRAM_GARBAGE_FORCE_T2) / VRAM_GARBAGE_FORCE_T_DEN;
	return config;
}

BlockGen initBlockGen(uint32_t biasSeed, uint32_t bootSeedMix, uint32_t blockIndex, const BiasConfig& biasConfig) {
	const uint32_t pageIndex = blockIndex >> 7u;
	const uint32_t rowIndex = blockIndex >> 3u;

	const uint32_t pageH = fmix32((biasSeed ^ (pageIndex * 0xc2b2ae35U) ^ 0xa5a5a5a5U));
	const uint32_t rowH = fmix32((biasSeed ^ (rowIndex * 0x85ebca6bU) ^ 0x1b873593U));
	const uint32_t blkH = fmix32((biasSeed ^ (blockIndex * 0x9e3779b9U) ^ 0x85ebca77U));

	int bias =
		signed8FromHash(pageH) * VRAM_GARBAGE_WEIGHT_PAGE +
		signed8FromHash(rowH) * VRAM_GARBAGE_WEIGHT_ROW +
		signed8FromHash(blkH) * VRAM_GARBAGE_WEIGHT_BLOCK;

	uint32_t macroH = pageH;
	for (uint32_t i = 0; i < biasConfig.activeOctaves; ++i) {
		const OctaveSpec& octave = VRAM_GARBAGE_OCTAVES[i];
		const uint32_t octaveIndex = blockIndex >> octave.shift;
		const uint32_t octaveH = fmix32((biasSeed ^ (octaveIndex * octave.mul) ^ octave.mix));
		bias += signed8FromHash(octaveH) * octave.weight;
		macroH = octaveH;
	}

	const int absBias = bias < 0 ? -bias : bias;

	const int forceLevel =
		(absBias < biasConfig.threshold0) ? 0 :
		(absBias < biasConfig.threshold1) ? 1 :
		(absBias < biasConfig.threshold2) ? 2 : 3;

	const int jitterLevel = 3 - forceLevel;

	uint32_t ps = (blkH ^ rowH ^ 0xdeadbeefU) | 1u;
	ps = xorshift32(ps); const uint32_t m1 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t m2 = scramble32(ps);
	ps = xorshift32(ps);
	const uint32_t prefWord = scramble32(macroH);
	ps = xorshift32(ps); const uint32_t w1 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w2 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w3 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w4 = scramble32(ps);

	uint32_t forceMask = 0;
	switch (forceLevel) {
		case 0: forceMask = 0; break;
		case 1: forceMask = (m1 & m2); break;
		case 2: forceMask = m1; break;
		default: forceMask = (m1 | m2); break;
	}

	uint32_t weak = (w1 & w2 & w3);
	if (jitterLevel <= 2) weak &= w4;
	if (jitterLevel <= 1) weak &= (weak >> 1);
	if (jitterLevel <= 0) weak = 0;
	weak &= ~forceMask;

	const uint32_t baseState = (blkH ^ 0xa1b2c3d4U) | 1u;
	const uint32_t bootState = (fmix32((bootSeedMix ^ (blockIndex * 0x7f4a7c15U) ^ 0x31415926U)) | 1u);

	BlockGen gen;
	gen.forceMask = forceMask;
	gen.prefWord = prefWord;
	gen.weakMask = weak;
	gen.baseState = baseState;
	gen.bootState = bootState;
	gen.genWordPos = 0;
	return gen;
}

uint32_t nextWord(BlockGen& gen) {
	gen.baseState = xorshift32(gen.baseState);
	gen.bootState = xorshift32(gen.bootState);
	gen.genWordPos += 1;

	const uint32_t baseWord = scramble32(gen.baseState);
	const uint32_t bootWord = scramble32(gen.bootState);

	uint32_t word = (baseWord & ~gen.forceMask) | (gen.prefWord & gen.forceMask);
	word ^= (bootWord & gen.weakMask);
	return word;
}

}

VDP::VDP(Memory& memory)
	: m_memory(memory)
	, m_vramStaging(VRAM_STAGING_SIZE)
	, m_vramGarbageScratch(VRAM_GARBAGE_CHUNK_BYTES) {
	m_memory.setVramWriter(this);
	m_memory.setVdpIoHandler(this);
	m_frameBufferCommands.reserve(2048);
	m_vramMachineSeed = nextVramMachineSeed();
	m_vramBootSeed = nextVramBootSeed();
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
}

void VDP::writeVram(uint32_t addr, const u8* data, size_t length) {
	if (addr >= VRAM_STAGING_BASE && addr + length <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		const uint32_t offset = addr - VRAM_STAGING_BASE;
		std::memcpy(m_vramStaging.data() + offset, data, length);
		return;
	}
	auto& slot = findVramSlot(addr, length);
	const uint32_t offset = addr - slot.baseAddr;
	if ((offset & 3u) != 0u || (length & 3u) != 0u) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM writes must be 32-bit aligned.");
	}
	if (slot.kind == VramSlotKind::Skybox) {
		return;
	}
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	if (entry.baseStride == 0 || entry.regionW == 0 || entry.regionH == 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM slot not initialized for writes.");
	}
	syncVramSlotTextureSize(slot);
	const uint32_t stride = entry.baseStride;
	const uint32_t totalBytes = entry.regionH * stride;
	if (offset + length > totalBytes) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM write exceeds slot bounds.");
	}
	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[VDP] TextureManager not configured.");
	}
	size_t remaining = length;
	size_t cursor = 0;
	uint32_t row = offset / stride;
	uint32_t rowOffset = offset - row * stride;
	while (remaining > 0) {
		const uint32_t rowAvailable = stride - rowOffset;
		const uint32_t rowBytes = static_cast<uint32_t>(std::min<size_t>(remaining, rowAvailable));
		const i32 x = static_cast<i32>(rowOffset / 4u);
		const i32 width = static_cast<i32>(rowBytes / 4u);
		texmanager->updateTextureRegionForKey(
			slot.textureKey,
			data + cursor,
			width,
			1,
			x,
			static_cast<i32>(row)
		);
		invalidateReadCache(slot.surfaceId);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1;
		rowOffset = 0;
	}
}

void VDP::beginFrame() {
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
	m_readOverflow = false;
}

VDP::FrameBufferColor VDP::packFrameBufferColor(const Color& color) const {
	return FrameBufferColor{
		static_cast<u8>(std::round(color.r * 255.0f)),
		static_cast<u8>(std::round(color.g * 255.0f)),
		static_cast<u8>(std::round(color.b * 255.0f)),
		static_cast<u8>(std::round(color.a * 255.0f)),
	};
}

void VDP::resetFrameBufferCommands() {
	m_frameBufferCommands.clear();
	m_frameBufferClearRequested = false;
	m_frameBufferSourceIndex = 0;
}

void VDP::ensureFrameBufferSurface() {
	auto* view = EngineCore::instance().view();
	auto* texmanager = EngineCore::instance().texmanager();
	if (!view) {
		throw BMSX_RUNTIME_ERROR("[BmsxVDP] GameView not configured.");
	}
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[BmsxVDP] TextureManager not configured.");
	}
	const uint32_t width = static_cast<uint32_t>(view->viewportSize.x);
	const uint32_t height = static_cast<uint32_t>(view->viewportSize.y);
	if (width == 0 || height == 0) {
		throw BMSX_RUNTIME_ERROR("[BmsxVDP] Invalid framebuffer dimensions.");
	}
	if (m_frameBufferWidth == width && m_frameBufferHeight == height && !m_frameBufferPixels.empty()) {
		return;
	}
	m_frameBufferWidth = width;
	m_frameBufferHeight = height;
	m_frameBufferPixels.assign(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u, 0u);
	TextureParams params;
	TextureHandle handle = texmanager->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY, params);
	if (!handle) {
		handle = texmanager->getOrCreateTexture(texmanager->makeKey(FRAMEBUFFER_TEXTURE_KEY, params), m_frameBufferPixels.data(), static_cast<i32>(width), static_cast<i32>(height), params);
	} else {
		handle = texmanager->resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, static_cast<i32>(width), static_cast<i32>(height));
		texmanager->updateTexture(handle, m_frameBufferPixels.data(), static_cast<i32>(width), static_cast<i32>(height), params);
	}
	view->textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
}

void VDP::discardFrameBufferOps() {
	resetFrameBufferCommands();
}

void VDP::clearFrameBuffer(const Color& color) {
	m_frameBufferClearColor = packFrameBufferColor(color);
	m_frameBufferClearRequested = true;
}

void VDP::queueFrameBufferSpriteHandle(u32 handle, f32 x, f32 y, f32 z, Layer2D layer, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const Color& color) {
	FrameBufferCommand command;
	command.type = FrameBufferCommandType::Sprite;
	command.handle = handle;
	command.x0 = x;
	command.y0 = y;
	command.z = z;
	command.layer = layer;
	command.scaleX = scaleX;
	command.scaleY = scaleY;
	command.flipH = flipH;
	command.flipV = flipV;
	command.sourceIndex = m_frameBufferSourceIndex++;
	command.color = packFrameBufferColor(color);
	m_frameBufferCommands.push_back(command);
}

void VDP::queueFrameBufferRect(bool fill, f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color) {
	if (fill) {
		FrameBufferCommand command;
		command.type = FrameBufferCommandType::Fill;
		command.x0 = x0;
		command.y0 = y0;
		command.x1 = x1;
		command.y1 = y1;
		command.z = z;
		command.layer = layer;
		command.sourceIndex = m_frameBufferSourceIndex++;
		command.color = packFrameBufferColor(color);
		m_frameBufferCommands.push_back(command);
		return;
	}
	queueFrameBufferLine(x0, y0, x1, y0, z, layer, color, 1.0f);
	queueFrameBufferLine(x0, y1, x1, y1, z, layer, color, 1.0f);
	queueFrameBufferLine(x0, y0, x0, y1, z, layer, color, 1.0f);
	queueFrameBufferLine(x1, y0, x1, y1, z, layer, color, 1.0f);
}

void VDP::queueFrameBufferLine(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color, f32 thickness) {
	FrameBufferCommand command;
	command.type = FrameBufferCommandType::Line;
	command.x0 = x0;
	command.y0 = y0;
	command.x1 = x1;
	command.y1 = y1;
	command.z = z;
	command.layer = layer;
	command.thickness = thickness;
	command.sourceIndex = m_frameBufferSourceIndex++;
	command.color = packFrameBufferColor(color);
	m_frameBufferCommands.push_back(command);
}

void VDP::queueFrameBufferPoly(const std::vector<f32>& points, f32 z, const Color& color, f32 thickness, Layer2D layer) {
	if (points.size() < 4u) {
		return;
	}
	for (size_t index = 0; index < points.size(); index += 2u) {
		const size_t next = (index + 2u) % points.size();
		queueFrameBufferLine(points[index], points[index + 1u], points[next], points[next + 1u], z, layer, color, thickness);
	}
}

void VDP::queueFrameBufferGlyphs(const std::vector<std::string>& lines, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, RenderLayer layer) {
	if (!font) {
		throw BMSX_RUNTIME_ERROR("[BmsxVDP] No font available for glyph rendering.");
	}
	const Layer2D targetLayer = renderLayerTo2dLayer(layer);
	f32 cursorY = y;
	for (const auto& line : lines) {
		if (line.empty()) {
			cursorY += static_cast<f32>(font->lineHeight());
			continue;
		}
		f32 cursorX = x;
		for (i32 glyphIndex = start; glyphIndex < static_cast<i32>(line.size()) && glyphIndex < end; glyphIndex += 1) {
			const FontGlyph& glyph = font->getGlyph(line[glyphIndex]);
			if (backgroundColor.has_value()) {
				queueFrameBufferRect(true, cursorX, cursorY, cursorX + static_cast<f32>(glyph.advance), cursorY + static_cast<f32>(font->lineHeight()), z, targetLayer, *backgroundColor);
			}
			queueFrameBufferSpriteHandle(m_memory.resolveAssetHandle(glyph.imgid), cursorX, cursorY, z, targetLayer, 1.0f, 1.0f, false, false, color);
			cursorX += static_cast<f32>(glyph.advance);
		}
		cursorY += static_cast<f32>(font->lineHeight());
	}
}

const u8* VDP::getFrameBufferSourcePixels(const Memory::AssetEntry& entry) const {
	if (!m_memory.isVramRange(entry.baseAddr, std::max<size_t>(1u, entry.baseSize))) {
		return m_memory.getImagePixels(entry);
	}
	const ImgAsset* asset = EngineCore::instance().resolveImgAsset(entry.id);
	if (!asset || asset->pixels.empty()) {
		throw BMSX_RUNTIME_ERROR("[BmsxVDP] Missing CPU image pixels for '" + entry.id + "'.");
	}
	return asset->pixels.data();
}

VDP::FrameBufferImageSource VDP::resolveFrameBufferImageSource(u32 handle) const {
	const auto& entry = m_memory.getAssetEntryByHandle(handle);
	if (entry.type != Memory::AssetType::Image) {
		throw BMSX_RUNTIME_ERROR("[BmsxVDP] Asset handle is not an image.");
	}
	if ((entry.flags & ASSET_FLAG_VIEW) != 0u) {
		const auto& base = m_memory.getAssetEntryByHandle(entry.ownerIndex);
		if (base.type != Memory::AssetType::Image) {
			throw BMSX_RUNTIME_ERROR("[BmsxVDP] View owner is not an image.");
		}
		return FrameBufferImageSource{
			getFrameBufferSourcePixels(base),
			entry.regionX,
			entry.regionY,
			base.baseStride,
			entry.regionW,
			entry.regionH,
		};
	}
	return FrameBufferImageSource{
		getFrameBufferSourcePixels(entry),
		0u,
		0u,
		entry.baseStride,
		entry.regionW,
		entry.regionH,
	};
}

void VDP::blendFrameBufferPixel(size_t index, u8 r, u8 g, u8 b, u8 a) {
	if (a == 0u) {
		return;
	}
	if (a == 255u) {
		m_frameBufferPixels[index + 0u] = r;
		m_frameBufferPixels[index + 1u] = g;
		m_frameBufferPixels[index + 2u] = b;
		m_frameBufferPixels[index + 3u] = 255u;
		return;
	}
	const u32 inverse = 255u - a;
	m_frameBufferPixels[index + 0u] = static_cast<u8>(((static_cast<u32>(r) * a) + (static_cast<u32>(m_frameBufferPixels[index + 0u]) * inverse) + 127u) / 255u);
	m_frameBufferPixels[index + 1u] = static_cast<u8>(((static_cast<u32>(g) * a) + (static_cast<u32>(m_frameBufferPixels[index + 1u]) * inverse) + 127u) / 255u);
	m_frameBufferPixels[index + 2u] = static_cast<u8>(((static_cast<u32>(b) * a) + (static_cast<u32>(m_frameBufferPixels[index + 2u]) * inverse) + 127u) / 255u);
	m_frameBufferPixels[index + 3u] = static_cast<u8>(a + ((static_cast<u32>(m_frameBufferPixels[index + 3u]) * inverse) + 127u) / 255u);
}

void VDP::rasterizeFrameBufferFill(const FrameBufferCommand& command) {
	i32 left = static_cast<i32>(std::round(command.x0));
	i32 top = static_cast<i32>(std::round(command.y0));
	i32 right = static_cast<i32>(std::round(command.x1));
	i32 bottom = static_cast<i32>(std::round(command.y1));
	if (right < left) {
		std::swap(left, right);
	}
	if (bottom < top) {
		std::swap(top, bottom);
	}
	left = std::max(0, left);
	top = std::max(0, top);
	right = std::min(static_cast<i32>(m_frameBufferWidth), right);
	bottom = std::min(static_cast<i32>(m_frameBufferHeight), bottom);
	for (i32 y = top; y < bottom; ++y) {
		size_t index = (static_cast<size_t>(y) * static_cast<size_t>(m_frameBufferWidth) + static_cast<size_t>(left)) * 4u;
		for (i32 x = left; x < right; ++x) {
			blendFrameBufferPixel(index, command.color.r, command.color.g, command.color.b, command.color.a);
			index += 4u;
		}
	}
}

void VDP::rasterizeFrameBufferLine(const FrameBufferCommand& command) {
	i32 x0 = static_cast<i32>(std::round(command.x0));
	i32 y0 = static_cast<i32>(std::round(command.y0));
	const i32 x1 = static_cast<i32>(std::round(command.x1));
	const i32 y1 = static_cast<i32>(std::round(command.y1));
	const i32 dx = std::abs(x1 - x0);
	const i32 dy = std::abs(y1 - y0);
	const i32 sx = x0 < x1 ? 1 : -1;
	const i32 sy = y0 < y1 ? 1 : -1;
	i32 err = dx - dy;
	const i32 thickness = std::max(1, static_cast<i32>(std::round(command.thickness)));
	while (true) {
		const i32 half = thickness >> 1;
		for (i32 yy = y0 - half; yy < y0 - half + thickness; ++yy) {
			if (yy < 0 || yy >= static_cast<i32>(m_frameBufferHeight)) {
				continue;
			}
			for (i32 xx = x0 - half; xx < x0 - half + thickness; ++xx) {
				if (xx < 0 || xx >= static_cast<i32>(m_frameBufferWidth)) {
					continue;
				}
				const size_t index = (static_cast<size_t>(yy) * static_cast<size_t>(m_frameBufferWidth) + static_cast<size_t>(xx)) * 4u;
				blendFrameBufferPixel(index, command.color.r, command.color.g, command.color.b, command.color.a);
			}
		}
		if (x0 == x1 && y0 == y1) {
			return;
		}
		const i32 e2 = err << 1;
		if (e2 > -dy) {
			err -= dy;
			x0 += sx;
		}
		if (e2 < dx) {
			err += dx;
			y0 += sy;
		}
	}
}

void VDP::rasterizeFrameBufferSprite(const FrameBufferCommand& command) {
	const FrameBufferImageSource source = resolveFrameBufferImageSource(command.handle);
	const i32 dstW = std::max(1, static_cast<i32>(std::round(static_cast<f32>(source.width) * command.scaleX)));
	const i32 dstH = std::max(1, static_cast<i32>(std::round(static_cast<f32>(source.height) * command.scaleY)));
	const i32 dstX = static_cast<i32>(std::round(command.x0));
	const i32 dstY = static_cast<i32>(std::round(command.y0));
	for (i32 y = 0; y < dstH; ++y) {
		const i32 targetY = dstY + y;
		if (targetY < 0 || targetY >= static_cast<i32>(m_frameBufferHeight)) {
			continue;
		}
		const i32 srcY = command.flipV
			? static_cast<i32>(source.height) - 1 - ((y * static_cast<i32>(source.height)) / dstH)
			: ((y * static_cast<i32>(source.height)) / dstH);
		for (i32 x = 0; x < dstW; ++x) {
			const i32 targetX = dstX + x;
			if (targetX < 0 || targetX >= static_cast<i32>(m_frameBufferWidth)) {
				continue;
			}
			const i32 srcX = command.flipH
				? static_cast<i32>(source.width) - 1 - ((x * static_cast<i32>(source.width)) / dstW)
				: ((x * static_cast<i32>(source.width)) / dstW);
			const size_t srcIndex = (static_cast<size_t>(source.regionY + static_cast<uint32_t>(srcY)) * static_cast<size_t>(source.stride))
				+ (static_cast<size_t>(source.regionX + static_cast<uint32_t>(srcX)) * 4u);
			const u8 srcA = source.pixels[srcIndex + 3u];
			if (srcA == 0u) {
				continue;
			}
			const u8 outA = static_cast<u8>((static_cast<u32>(srcA) * static_cast<u32>(command.color.a) + 127u) / 255u);
			const u8 outR = static_cast<u8>((static_cast<u32>(source.pixels[srcIndex + 0u]) * static_cast<u32>(command.color.r) + 127u) / 255u);
			const u8 outG = static_cast<u8>((static_cast<u32>(source.pixels[srcIndex + 1u]) * static_cast<u32>(command.color.g) + 127u) / 255u);
			const u8 outB = static_cast<u8>((static_cast<u32>(source.pixels[srcIndex + 2u]) * static_cast<u32>(command.color.b) + 127u) / 255u);
			const size_t dstIndex = (static_cast<size_t>(targetY) * static_cast<size_t>(m_frameBufferWidth) + static_cast<size_t>(targetX)) * 4u;
			blendFrameBufferPixel(dstIndex, outR, outG, outB, outA);
		}
	}
}

void VDP::flushFrameBufferOps() {
	ensureFrameBufferSurface();
	const FrameBufferColor clearColor = m_frameBufferClearRequested
		? m_frameBufferClearColor
		: FrameBufferColor{0u, 0u, 0u, 0u};
	for (size_t index = 0; index < m_frameBufferPixels.size(); index += 4u) {
		m_frameBufferPixels[index + 0u] = clearColor.r;
		m_frameBufferPixels[index + 1u] = clearColor.g;
		m_frameBufferPixels[index + 2u] = clearColor.b;
		m_frameBufferPixels[index + 3u] = clearColor.a;
	}
	if (m_frameBufferCommands.size() > 1u) {
		std::sort(m_frameBufferCommands.begin(), m_frameBufferCommands.end(), [](const FrameBufferCommand& a, const FrameBufferCommand& b) {
			if (a.layer != b.layer) {
				return static_cast<i32>(a.layer) < static_cast<i32>(b.layer);
			}
			if (a.z != b.z) {
				return a.z < b.z;
			}
			return a.sourceIndex < b.sourceIndex;
		});
	}
	for (const auto& command : m_frameBufferCommands) {
		switch (command.type) {
			case FrameBufferCommandType::Fill:
				rasterizeFrameBufferFill(command);
				break;
			case FrameBufferCommandType::Line:
				rasterizeFrameBufferLine(command);
				break;
			case FrameBufferCommandType::Sprite:
				rasterizeFrameBufferSprite(command);
				break;
		}
	}
	TextureParams params;
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = EngineCore::instance().view()->textures[FRAMEBUFFER_TEXTURE_KEY];
	texmanager->updateTexture(handle, m_frameBufferPixels.data(), static_cast<i32>(m_frameBufferWidth), static_cast<i32>(m_frameBufferHeight), params);
	resetFrameBufferCommands();
}

void VDP::ensureFrameBufferSurfaceReady() {
	ensureFrameBufferSurface();
}

uint32_t VDP::readVdpStatus() {
	uint32_t status = 0;
	if (m_readBudgetBytes >= 4u) {
		status |= VDP_RD_STATUS_READY;
	}
	if (m_readOverflow) {
		status |= VDP_RD_STATUS_OVERFLOW;
	}
	return status;
}

uint32_t VDP::readVdpData() {
	const uint32_t surfaceId = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_VDP_RD_SURFACE)));
	const uint32_t x = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_VDP_RD_X)));
	const uint32_t y = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_VDP_RD_Y)));
	const uint32_t mode = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_VDP_RD_MODE)));
	if (mode != VDP_RD_MODE_RGBA8888) {
		throw BMSX_RUNTIME_ERROR("[VDP] Unsupported VDP read mode.");
	}
	const auto& surface = getReadSurface(surfaceId);
	auto& entry = m_memory.getAssetEntry(surface.assetId);
	const uint32_t width = entry.regionW;
	const uint32_t height = entry.regionH;
	if (x >= width || y >= height) {
		throw BMSX_RUNTIME_ERROR("[VDP] VDP read out of bounds.");
	}
	if (m_readBudgetBytes < 4u) {
		m_readOverflow = true;
		return 0u;
	}
	auto& cache = getReadCache(surfaceId, surface, x, y);
	const uint32_t localX = x - cache.x0;
	const size_t byteIndex = static_cast<size_t>(localX) * 4u;
	const u32 r = cache.data[byteIndex + 0];
	const u32 g = cache.data[byteIndex + 1];
	const u32 b = cache.data[byteIndex + 2];
	const u32 a = cache.data[byteIndex + 3];
	m_readBudgetBytes -= 4u;
	uint32_t nextX = x + 1u;
	uint32_t nextY = y;
	if (nextX >= width) {
		nextX = 0u;
		nextY = y + 1u;
	}
	m_memory.writeValue(IO_VDP_RD_X, valueNumber(static_cast<double>(nextX)));
	m_memory.writeValue(IO_VDP_RD_Y, valueNumber(static_cast<double>(nextY)));
	return (r | (g << 8u) | (b << 16u) | (a << 24u));
}

void VDP::initializeRegisters() {
	const i32 dither = 0;
	m_frameBufferWidth = 0;
	m_frameBufferHeight = 0;
	m_frameBufferPixels.clear();
	resetFrameBufferCommands();
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(dither)));
	m_memory.writeValue(IO_VDP_LEGACY_CMD, valueNumber(0.0));
	m_lastDitherType = dither;
	EngineCore::instance().view()->dither_type = static_cast<GameView::DitherType>(dither);
}

void VDP::syncRegisters() {
	const i32 dither = static_cast<i32>(asNumber(m_memory.readValue(IO_VDP_DITHER)));
	if (dither != m_lastDitherType) {
		m_lastDitherType = dither;
		EngineCore::instance().view()->dither_type = static_cast<GameView::DitherType>(dither);
	}
	const uint32_t primaryRaw = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_VDP_PRIMARY_ATLAS_ID)));
	const uint32_t secondaryRaw = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_VDP_SECONDARY_ATLAS_ID)));
	const i32 primary = primaryRaw == VDP_ATLAS_ID_NONE ? -1 : static_cast<i32>(primaryRaw);
	const i32 secondary = secondaryRaw == VDP_ATLAS_ID_NONE ? -1 : static_cast<i32>(secondaryRaw);
	if (primary != m_slotAtlasIds[0] || secondary != m_slotAtlasIds[1]) {
		applyAtlasSlotMapping({{primary, secondary}});
	}
	const uint32_t command = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_VDP_LEGACY_CMD)));
	if (command != 0u) {
		throw BMSX_RUNTIME_ERROR("[VDP] Legacy VDP command register was removed. Got " + std::to_string(command) + ".");
	}
}

void VDP::setDitherType(i32 type) {
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(type)));
	syncRegisters();
}

void VDP::registerImageAssets(RuntimeAssets& assets, bool keepDecodedData) {
	m_atlasResourceById.clear();
	m_atlasViewIdsById.clear();
	m_atlasSlotById.clear();
	m_slotAtlasIds = {{-1, -1}};
	m_vramSlots.clear();
	if (!m_imgDecController) {
		throw BMSX_RUNTIME_ERROR("[VDP] ImgDecController not attached.");
	}
	m_imgDecController->clearExternalSlots();
	m_readSurfaces = {};
	for (auto& cache : m_readCaches) {
		cache.width = 0;
		cache.data.clear();
	}
	m_dirtyAtlasBindings = true;
	m_dirtySkybox = true;
	m_skyboxFaceIds = {};
	m_hasSkybox = false;
	m_vramBootSeed = nextVramBootSeed();
	seedVramStaging();

	std::vector<std::string> viewAssets;
	viewAssets.reserve(assets.img.size());
	std::unordered_set<std::string> viewAssetIds;
	viewAssetIds.reserve(EngineCore::instance().systemAssets().img.size() + assets.img.size());
	std::unordered_map<std::string, ImgAsset*> viewAssetById;
	viewAssetById.reserve(EngineCore::instance().systemAssets().img.size() + assets.img.size());

	const std::string engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	RuntimeAssets& systemAssets = EngineCore::instance().systemAssets();
	const ImgAsset* engineAtlasAsset = systemAssets.getImg(engineAtlasName);

	if (!engineAtlasAsset) {
		throw BMSX_RUNTIME_ERROR("[VDP] Engine atlas missing from system assets.");
	}

	for (auto& entry : systemAssets.img) {
		auto& imgAsset = entry.second;
		if (!imgAsset.meta.atlassed || imgAsset.meta.atlasid != ENGINE_ATLAS_INDEX) {
			continue;
		}
		if (viewAssetIds.insert(imgAsset.id).second) {
			viewAssets.push_back(imgAsset.id);
		}
		viewAssetById[imgAsset.id] = &imgAsset;
	}

	for (auto& entry : assets.img) {
		auto& imgAsset = entry.second;
		const std::string& id = imgAsset.id;
		if (imgAsset.meta.atlassed) {
			if (viewAssetIds.insert(id).second) {
				viewAssets.push_back(id);
			}
			viewAssetById[id] = &imgAsset;
			continue;
		}
		if (id == engineAtlasName) {
			continue;
		}
		if (!isAtlasName(id)) {
			continue;
		}
		const i32 atlasId = imgAsset.meta.atlasid;
		m_atlasResourceById[atlasId] = id;
	}

	if (engineAtlasAsset->meta.width <= 0 || engineAtlasAsset->meta.height <= 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] Engine atlas missing dimensions.");
	}
	auto setAtlasEntryDimensions = [](Memory::AssetEntry& slotEntry, uint32_t width, uint32_t height) {
		const uint32_t size = width * height * 4u;
		if (size > slotEntry.capacity) {
			throw BMSX_RUNTIME_ERROR("[VDP] Atlas entry '" + slotEntry.id + "' exceeds capacity.");
		}
		slotEntry.baseSize = size;
		slotEntry.baseStride = width * 4u;
		slotEntry.regionX = 0;
		slotEntry.regionY = 0;
		slotEntry.regionW = width;
		slotEntry.regionH = height;
	};
	auto seedAtlasSlot = [&](Memory::AssetEntry& slotEntry) {
		const double maxPixels = static_cast<double>(slotEntry.capacity) / 4.0;
		const uint32_t side = static_cast<uint32_t>(std::floor(std::sqrt(maxPixels)));
		setAtlasEntryDimensions(slotEntry, side, side);
	};
	if (!m_memory.hasAsset(engineAtlasName)) {
		m_memory.registerImageSlotAt(
			engineAtlasName,
			VRAM_SYSTEM_ATLAS_BASE,
			VRAM_SYSTEM_ATLAS_SIZE,
			0,
			false
		);
	}
	auto& engineEntry = m_memory.getAssetEntry(engineAtlasName);
	setAtlasEntryDimensions(engineEntry, static_cast<uint32_t>(engineAtlasAsset->meta.width), static_cast<uint32_t>(engineAtlasAsset->meta.height));
	registerVramSlot(engineEntry, ENGINE_ATLAS_TEXTURE_KEY, VDP_RD_SURFACE_ENGINE);

	const uint32_t skyboxBytes = VRAM_SKYBOX_FACE_BYTES;
	for (size_t index = 0; index < m_skyboxSlots.size(); ++index) {
		auto& slot = m_skyboxSlots[index];
		slot.baseAddr = skyboxFaceBaseByIndex(index);
		slot.capacity = skyboxBytes;
		slot.baseSize = 0;
		slot.baseStride = 0;
		slot.regionX = 0;
		slot.regionY = 0;
		slot.regionW = 0;
		slot.regionH = 0;
		m_imgDecController->registerExternalSlot(slot.baseAddr, &slot);
		VramSlot vramSlot;
		vramSlot.kind = VramSlotKind::Skybox;
		vramSlot.baseAddr = slot.baseAddr;
		vramSlot.capacity = slot.capacity;
		m_vramSlots.push_back(std::move(vramSlot));
	}

	if (!m_memory.hasAsset(ATLAS_PRIMARY_SLOT_ID)) {
		m_memory.registerImageSlotAt(
			ATLAS_PRIMARY_SLOT_ID,
			VRAM_PRIMARY_ATLAS_BASE,
			VRAM_PRIMARY_ATLAS_SIZE,
			0,
			false
		);
	}
	auto& primarySlotEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	seedAtlasSlot(primarySlotEntry);
	if (!m_memory.hasAsset(ATLAS_SECONDARY_SLOT_ID)) {
		m_memory.registerImageSlotAt(
			ATLAS_SECONDARY_SLOT_ID,
			VRAM_SECONDARY_ATLAS_BASE,
			VRAM_SECONDARY_ATLAS_SIZE,
			0,
			false
		);
	}
	auto& secondarySlotEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	seedAtlasSlot(secondarySlotEntry);
	registerVramSlot(primarySlotEntry, ATLAS_PRIMARY_SLOT_ID, VDP_RD_SURFACE_PRIMARY);
	registerVramSlot(secondarySlotEntry, ATLAS_SECONDARY_SLOT_ID, VDP_RD_SURFACE_SECONDARY);

	std::sort(viewAssets.begin(), viewAssets.end());
	for (const auto& id : viewAssets) {
		const auto viewAssetIt = viewAssetById.find(id);
		if (viewAssetIt == viewAssetById.end()) {
			throw BMSX_RUNTIME_ERROR("[VDP] Image asset '" + id + "' not found.");
		}
		ImgAsset* imgAsset = viewAssetIt->second;
		if (!imgAsset->meta.atlassed) {
			throw BMSX_RUNTIME_ERROR("[VDP] Image asset '" + id + "' expected to be atlassed.");
		}
		const i32 atlasId = imgAsset->meta.atlasid;
		const auto& tc = imgAsset->meta.texcoords;
		const f32 minU = std::min({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 maxU = std::max({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 minV = std::min({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		const f32 maxV = std::max({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		const Memory::AssetEntry* baseEntry = nullptr;
		std::string baseEntryId;
		i32 atlasWidth = 0;
		i32 atlasHeight = 0;
		if (atlasId == ENGINE_ATLAS_INDEX) {
			baseEntryId = engineAtlasName;
			atlasWidth = engineAtlasAsset->meta.width;
			atlasHeight = engineAtlasAsset->meta.height;
		} else {
			const auto atlasNameIt = m_atlasResourceById.find(atlasId);
			if (atlasNameIt == m_atlasResourceById.end()) {
				throw BMSX_RUNTIME_ERROR("[VDP] Atlas " + std::to_string(atlasId) + " missing for image '" + id + "'.");
			}
			const auto* atlasAsset = assets.getImg(atlasNameIt->second);
			atlasWidth = atlasAsset->meta.width;
			atlasHeight = atlasAsset->meta.height;
			baseEntryId = ATLAS_PRIMARY_SLOT_ID;
			const auto slotIt = m_atlasSlotById.find(atlasId);
			if (slotIt != m_atlasSlotById.end()) {
				baseEntryId = slotIt->second == 1 ? ATLAS_SECONDARY_SLOT_ID : ATLAS_PRIMARY_SLOT_ID;
			}
		}
		baseEntry = &m_memory.getAssetEntry(baseEntryId);
		// Texcoords are stored as float32, so round back to the source texel grid.
		const i32 offsetX = static_cast<i32>(std::round(minU * static_cast<f32>(atlasWidth)));
		const i32 offsetY = static_cast<i32>(std::round(minV * static_cast<f32>(atlasHeight)));
		const i32 regionW = std::max(1, std::min(atlasWidth - offsetX,
			static_cast<i32>(std::round((maxU - minU) * static_cast<f32>(atlasWidth)))));
		const i32 regionH = std::max(1, std::min(atlasHeight - offsetY,
			static_cast<i32>(std::round((maxV - minV) * static_cast<f32>(atlasHeight)))));
		if (!m_memory.hasAsset(id)) {
			m_memory.registerImageView(
				id,
				*baseEntry,
				static_cast<uint32_t>(offsetX),
				static_cast<uint32_t>(offsetY),
				static_cast<uint32_t>(regionW),
				static_cast<uint32_t>(regionH),
				0
			);
		} else {
			auto& viewEntry = m_memory.getAssetEntry(id);
			m_memory.updateImageView(
				viewEntry,
				*baseEntry,
				static_cast<uint32_t>(offsetX),
				static_cast<uint32_t>(offsetY),
				static_cast<uint32_t>(regionW),
				static_cast<uint32_t>(regionH),
				0
			);
		}
		m_atlasViewIdsById[atlasId].push_back(id);
	}

	syncRegisters();

	if (!keepDecodedData) {
		for (auto& entry : assets.img) {
			auto& imgAsset = entry.second;
			const std::string& id = imgAsset.id;
			if (id == engineAtlasName || isAtlasName(id)) {
				continue;
			}
			if (!imgAsset.pixels.empty()) {
				std::vector<u8>().swap(imgAsset.pixels);
			}
		}
	}
}

void VDP::restoreVramSlotTextures() {
	const auto& engineEntry = m_memory.getAssetEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
	restoreVramSlotTexture(engineEntry, ENGINE_ATLAS_TEXTURE_KEY);
	auto* view = EngineCore::instance().view();
	if (!view) {
		throw BMSX_RUNTIME_ERROR("[VDP] GameView not configured.");
	}
	view->loadEngineAtlasTexture();
	const auto& primaryEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	const auto& secondaryEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	restoreVramSlotTexture(primaryEntry, ATLAS_PRIMARY_SLOT_ID);
	restoreVramSlotTexture(secondaryEntry, ATLAS_SECONDARY_SLOT_ID);
	m_dirtyAtlasBindings = true;
}

void VDP::captureVramTextureSnapshots() {
	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[VDP] TextureManager not configured.");
	}
	auto* backend = texmanager->backend();
	if (!backend) {
		throw BMSX_RUNTIME_ERROR("[VDP] Backend not configured.");
	}
	for (auto& slot : m_vramSlots) {
		if (slot.kind != VramSlotKind::Asset) {
			continue;
		}
		auto& entry = m_memory.getAssetEntry(slot.assetId);
		if (entry.regionW == 0 || entry.regionH == 0) {
			throw BMSX_RUNTIME_ERROR("[VDP] Snapshot capture slot missing dimensions for '" + slot.textureKey + "'.");
		}
		const size_t bytes = static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u;
		slot.contextSnapshot.resize(bytes);
		TextureHandle handle = texmanager->getTextureByUri(slot.textureKey);
		if (!handle) {
			throw BMSX_RUNTIME_ERROR("[VDP] Snapshot capture texture missing for '" + slot.textureKey + "'.");
		}
		backend->readTextureRegion(
			handle,
			slot.contextSnapshot.data(),
			static_cast<i32>(entry.regionW),
			static_cast<i32>(entry.regionH),
			0,
			0,
			{}
		);
	}
}

void VDP::flushAssetEdits() {
	auto dirty = m_memory.consumeDirtyAssets();
	if (dirty.empty()) {
		return;
	}
	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[VDP] TextureManager not configured.");
	}
	auto* view = EngineCore::instance().view();
	if (!view) {
		throw BMSX_RUNTIME_ERROR("[VDP] GameView not configured.");
	}
	const std::string engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	for (const auto* entry : dirty) {
		if (entry->type == Memory::AssetType::Image) {
			if (entry->regionW == 0 || entry->regionH == 0) {
				continue;
			}
			const uint32_t span = entry->capacity > 0 ? entry->capacity : 1u;
			if (m_memory.isVramRange(entry->baseAddr, span)) {
				continue;
			}
			const u8* pixels = m_memory.getImagePixels(*entry);
			const i32 width = static_cast<i32>(entry->regionW);
			const i32 height = static_cast<i32>(entry->regionH);
			const bool isEngineAtlas = entry->id == engineAtlasName;
			const bool isAtlasSlot = (entry->id == ATLAS_PRIMARY_SLOT_ID || entry->id == ATLAS_SECONDARY_SLOT_ID);
			const std::string& textureKey = isEngineAtlas ? ENGINE_ATLAS_TEXTURE_KEY : entry->id;
			if (isAtlasSlot || isEngineAtlas) {
				TextureParams params;
				const TextureKey key = texmanager->makeKey(textureKey, params);
				TextureHandle handle = texmanager->getTexture(key);
				if (!handle) {
					handle = texmanager->getOrCreateTexture(key, pixels, width, height, params);
				} else {
					texmanager->updateTexture(handle, pixels, width, height, params);
				}
				view->textures[textureKey] = handle;
				if (isEngineAtlas) {
					ImgAsset* engineAsset = EngineCore::instance().systemAssets().getImg(engineAtlasName);
					if (!engineAsset) {
						throw BMSX_RUNTIME_ERROR("[VDP] Engine atlas asset missing during texture upload.");
					}
					engineAsset->textureHandle = reinterpret_cast<uintptr_t>(handle);
					engineAsset->uploaded = true;
				}
			} else {
				texmanager->updateTexturesForAsset(textureKey, pixels, width, height);
			}
		}
	}
}

uint32_t VDP::trackedUsedVramBytes() const {
	uint32_t usedBytes = 0;
	for (const auto& slot : m_vramSlots) {
		if (slot.kind == VramSlotKind::Skybox) {
			continue;
		}
		const auto& entry = m_memory.getAssetEntry(slot.assetId);
		usedBytes += entry.baseSize;
	}
	return usedBytes;
}

uint32_t VDP::trackedTotalVramBytes() const {
	return VRAM_SYSTEM_ATLAS_SIZE + VRAM_PRIMARY_ATLAS_SIZE + VRAM_SECONDARY_ATLAS_SIZE + VRAM_STAGING_SIZE;
}

void VDP::applyAtlasSlotMapping(const std::array<i32, 2>& slots) {
	auto configureSlotEntry = [this](Memory::AssetEntry& slotEntry, i32 atlasId) {
		if (atlasId < 0) {
			const uint32_t maxPixels = slotEntry.capacity / 4u;
			const uint32_t side = static_cast<uint32_t>(std::floor(std::sqrt(static_cast<double>(maxPixels))));
			slotEntry.baseSize = side * side * 4u;
			slotEntry.baseStride = side * 4u;
			slotEntry.regionX = 0u;
			slotEntry.regionY = 0u;
			slotEntry.regionW = side;
			slotEntry.regionH = side;
			return;
		}
		const auto atlasIt = m_atlasResourceById.find(atlasId);
		if (atlasIt == m_atlasResourceById.end()) {
			throw BMSX_RUNTIME_ERROR("[VDP] Atlas " + std::to_string(atlasId) + " not registered.");
		}
		ImgAsset* atlasAsset = EngineCore::instance().resolveImgAsset(atlasIt->second);
		if (!atlasAsset) {
			throw BMSX_RUNTIME_ERROR("[VDP] Atlas asset '" + atlasIt->second + "' not found.");
		}
		const uint32_t width = static_cast<uint32_t>(atlasAsset->meta.width);
		const uint32_t height = static_cast<uint32_t>(atlasAsset->meta.height);
		const uint32_t size = width * height * 4u;
		if (size > slotEntry.capacity) {
			throw BMSX_RUNTIME_ERROR("[VDP] Atlas " + std::to_string(atlasId) + " exceeds slot capacity.");
		}
		slotEntry.baseSize = size;
		slotEntry.baseStride = width * 4u;
		slotEntry.regionX = 0u;
		slotEntry.regionY = 0u;
		slotEntry.regionW = width;
		slotEntry.regionH = height;
	};
	auto& primaryEntryForMetrics = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	auto& secondaryEntryForMetrics = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	configureSlotEntry(primaryEntryForMetrics, slots[0]);
	configureSlotEntry(secondaryEntryForMetrics, slots[1]);
	m_atlasSlotById.clear();
	m_slotAtlasIds = slots;
	if (slots[0] >= 0) {
		m_atlasSlotById[slots[0]] = 0;
	}
	if (slots[1] >= 0) {
		m_atlasSlotById[slots[1]] = 1;
	}
	m_dirtyAtlasBindings = true;
	auto& primaryEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	auto& secondaryEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	if (slots[0] >= 0) {
		const auto viewIt = m_atlasViewIdsById.find(slots[0]);
		if (viewIt != m_atlasViewIdsById.end()) {
			for (const auto& viewId : viewIt->second) {
				auto& viewEntry = m_memory.getAssetEntry(viewId);
				m_memory.updateImageViewBase(viewEntry, primaryEntry);
			}
		}
	}
	if (slots[1] >= 0) {
		const auto viewIt = m_atlasViewIdsById.find(slots[1]);
		if (viewIt != m_atlasViewIdsById.end()) {
			for (const auto& viewId : viewIt->second) {
				auto& viewEntry = m_memory.getAssetEntry(viewId);
				m_memory.updateImageViewBase(viewEntry, secondaryEntry);
			}
		}
	}
}

void VDP::attachImgDecController(ImgDecController& controller) {
	m_imgDecController = &controller;
}

void VDP::setSkyboxImages(const SkyboxImageIds& ids) {
	if (!m_imgDecController) {
		throw BMSX_RUNTIME_ERROR("[VDP] ImgDecController not attached.");
	}
	const std::array<const std::string*, 6> faces = {{&ids.posx, &ids.negx, &ids.posy, &ids.negy, &ids.posz, &ids.negz}};
	for (size_t index = 0; index < faces.size(); ++index) {
		const std::string& assetId = *faces[index];
		auto* asset = EngineCore::instance().resolveImgAsset(assetId);
		if (!asset) {
			throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + assetId + "' not found.");
		}
		if (asset->meta.atlassed) {
			throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + assetId + "' must not be atlassed.");
		}
		if (!asset->rom.start || !asset->rom.end) {
			throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + assetId + "' missing ROM range.");
		}
		const i32 start = *asset->rom.start;
		const i32 end = *asset->rom.end;
		if (end <= start) {
			throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + assetId + "' has invalid ROM range.");
		}
		uint32_t base = CART_ROM_BASE;
		if (asset->rom.payloadId.has_value()) {
			const auto& payload = *asset->rom.payloadId;
			if (payload == "system") {
				base = SYSTEM_ROM_BASE;
			} else if (payload == "overlay") {
				base = OVERLAY_ROM_BASE;
			} else if (payload == "cart") {
				base = CART_ROM_BASE;
			} else {
				throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + assetId + "' has unsupported payload_id " + payload + ".");
			}
		}
		const size_t len = static_cast<size_t>(end - start);
		std::vector<u8> buffer(len);
		m_memory.readBytes(base + static_cast<uint32_t>(start), buffer.data(), len);
		auto& slot = m_skyboxSlots[index];
		if (slot.capacity == 0) {
			throw BMSX_RUNTIME_ERROR("[VDP] Skybox slot not initialized.");
		}
		m_imgDecController->decodeToVram(std::move(buffer), slot.baseAddr, slot.capacity,
			[asset](uint32_t width, uint32_t height, bool clipped) {
				(void)clipped;
				if (asset->meta.width <= 0) {
					asset->meta.width = static_cast<i32>(width);
				}
				if (asset->meta.height <= 0) {
					asset->meta.height = static_cast<i32>(height);
				}
			});
	}
	m_skyboxFaceIds = ids;
	m_hasSkybox = true;
	m_dirtySkybox = true;
}

void VDP::clearSkybox() {
	m_skyboxFaceIds = {};
	m_hasSkybox = false;
	m_dirtySkybox = true;
}

std::optional<SkyboxImageIds> VDP::skyboxFaceIds() const {
	if (!m_hasSkybox) {
		return std::nullopt;
	}
	return m_skyboxFaceIds;
}

void VDP::registerVramSlot(const Memory::AssetEntry& entry, const std::string& textureKey, uint32_t surfaceId) {
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->getTextureByUri(textureKey);
	const bool isEngineAtlas = textureKey == ENGINE_ATLAS_TEXTURE_KEY;
	const bool preserveEngineAtlasTexture = isEngineAtlas && handle;
	if (!handle) {
		auto* backend = texmanager->backend();
		if (backend && backend->readyForTextureUpload()) {
			VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
			fillVramGarbageScratch(m_vramSeedPixel.data(), m_vramSeedPixel.size(), stream);
			TextureParams params;
			const TextureKey key = texmanager->makeKey(textureKey, params);
			handle = texmanager->getOrCreateTexture(
				key,
				m_vramSeedPixel.data(),
				1,
				1,
				params
			);
		}
	}
	auto* view = EngineCore::instance().view();
	if (!view) {
		throw BMSX_RUNTIME_ERROR("[VDP] GameView not configured.");
	}
	if (handle) {
		if (!preserveEngineAtlasTexture) {
			handle = texmanager->resizeTextureForKey(textureKey, static_cast<i32>(entry.regionW), static_cast<i32>(entry.regionH));
		}
		view->textures[textureKey] = handle;
	} else {
		view->textures[textureKey] = nullptr;
	}
	VramSlot slot;
	slot.kind = VramSlotKind::Asset;
	slot.baseAddr = entry.baseAddr;
	slot.capacity = entry.capacity;
	slot.assetId = entry.id;
	slot.textureKey = textureKey;
	slot.surfaceId = surfaceId;
	slot.textureWidth = entry.regionW;
	slot.textureHeight = entry.regionH;
	m_vramSlots.push_back(std::move(slot));
	registerReadSurface(surfaceId, entry.id, textureKey);
	if (handle && !isEngineAtlas) {
		seedVramSlotTexture(m_vramSlots.back());
	}
}

VDP::VramSlot& VDP::findVramSlot(uint32_t addr, size_t length) {
	for (auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return slot;
		}
	}
	throw BMSX_RUNTIME_ERROR("[VDP] VRAM write has no mapped slot.");
}

const VDP::VramSlot& VDP::findVramSlot(uint32_t addr, size_t length) const {
	for (const auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return slot;
		}
	}
	throw BMSX_RUNTIME_ERROR("[VDP] VRAM write has no mapped slot.");
}

void VDP::syncVramSlotTextureSize(VramSlot& slot) {
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	const uint32_t width = entry.regionW;
	const uint32_t height = entry.regionH;
	if (slot.textureWidth == width && slot.textureHeight == height) {
		return;
	}
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->resizeTextureForKey(slot.textureKey,
		static_cast<i32>(width),
		static_cast<i32>(height));
	EngineCore::instance().view()->textures[slot.textureKey] = handle;
	slot.textureWidth = width;
	slot.textureHeight = height;
	invalidateReadCache(slot.surfaceId);
	seedVramSlotTexture(slot);
}

VDP::VramSlot& VDP::getVramSlotByTextureKey(const std::string& textureKey) {
	for (auto& slot : m_vramSlots) {
		if (slot.textureKey == textureKey) {
			return slot;
		}
	}
	throw BMSX_RUNTIME_ERROR("[VDP] VRAM slot not registered for texture '" + textureKey + "'.");
}

uint32_t VDP::nextVramMachineSeed() const {
	const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
	const uint64_t mixed = static_cast<uint64_t>(now) ^ static_cast<uint64_t>(reinterpret_cast<uintptr_t>(this));
	return static_cast<uint32_t>(mixed ^ (mixed >> 32));
}

uint32_t VDP::nextVramBootSeed() const {
	static uint32_t counter = 0;
	counter += 1;
	const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
	const uint64_t mixed = static_cast<uint64_t>(now)
		^ static_cast<uint64_t>(reinterpret_cast<uintptr_t>(this))
		^ (static_cast<uint64_t>(counter) << 1u);
	return static_cast<uint32_t>(mixed ^ (mixed >> 32) ^ (mixed >> 17));
}

void VDP::fillVramGarbageScratch(u8* buffer, size_t length, VramGarbageStream& s) const {
	const size_t total = length;
	const uint32_t startAddr = s.addr;

	const uint32_t biasSeed = s.machineSeed ^ s.slotSalt;
	const uint32_t bootSeedMix = s.bootSeed ^ s.slotSalt;
	const uint32_t vramBytes = (VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) - VRAM_STAGING_BASE;
	const BiasConfig biasConfig = makeBiasConfig(vramBytes);

	const size_t BLOCK_BYTES = 32u;
	const uint32_t BLOCK_SHIFT = 5u;

	size_t out = 0;
	const bool aligned4 = (((startAddr | static_cast<uint32_t>(total)) & 3u) == 0u);

	while (out < total) {
		const uint32_t addr = startAddr + static_cast<uint32_t>(out);
		const uint32_t blockIndex = addr >> BLOCK_SHIFT;
		const uint32_t blockBase = blockIndex << BLOCK_SHIFT;

		const uint32_t startOff = addr - blockBase;
		const size_t maxBytesThisBlock = std::min<size_t>(BLOCK_BYTES - startOff, total - out);

		BlockGen gen = initBlockGen(biasSeed, bootSeedMix, blockIndex, biasConfig);

		if (aligned4 && startOff == 0u && maxBytesThisBlock == BLOCK_BYTES) {
			for (uint32_t w = 0; w < 8u; ++w) {
				const uint32_t word = nextWord(gen);
				const size_t p = out + (static_cast<size_t>(w) << 2u);
				buffer[p] = static_cast<u8>(word & 0xFFu);
				buffer[p + 1] = static_cast<u8>((word >> 8u) & 0xFFu);
				buffer[p + 2] = static_cast<u8>((word >> 16u) & 0xFFu);
				buffer[p + 3] = static_cast<u8>((word >> 24u) & 0xFFu);
			}
		} else {
			const uint32_t rangeStart = startOff;
			const uint32_t rangeEnd = startOff + static_cast<uint32_t>(maxBytesThisBlock);

			for (uint32_t w = 0; w < 8u; ++w) {
				const uint32_t word = nextWord(gen);
				const uint32_t wordByteStart = w << 2u;
				const uint32_t wordByteEnd = wordByteStart + 4u;
				const uint32_t a0 = std::max<uint32_t>(wordByteStart, rangeStart);
				const uint32_t a1 = std::min<uint32_t>(wordByteEnd, rangeEnd);
				if (a0 >= a1) {
					continue;
				}
				uint32_t tmp = word >> ((a0 - wordByteStart) << 3u);
				for (uint32_t k = a0; k < a1; ++k) {
					buffer[out + static_cast<size_t>(k - rangeStart)] = static_cast<u8>(tmp & 0xFFu);
					tmp >>= 8u;
				}
			}
		}

		out += maxBytesThisBlock;
	}

	s.addr = startAddr + static_cast<uint32_t>(total);
}

void VDP::seedVramStaging() {
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, VRAM_STAGING_BASE};
	fillVramGarbageScratch(m_vramStaging.data(), m_vramStaging.size(), stream);
}

void VDP::seedVramSlotTexture(VramSlot& slot) {
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	if (entry.regionW == 0 || entry.regionH == 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM slot missing dimensions for seeding.");
	}
	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[VDP] TextureManager not configured.");
	}
	const size_t rowPixels = static_cast<size_t>(entry.regionW);
	const size_t maxPixels = m_vramGarbageScratch.size() / 4u;
	if (maxPixels == 0u) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM garbage scratch buffer is empty.");
	}
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
	const size_t rowBytes = rowPixels * 4u;
	const uint32_t height = entry.regionH;
	if (rowBytes <= m_vramGarbageScratch.size()) {
		const size_t rowsPerChunk = std::max<size_t>(1u, m_vramGarbageScratch.size() / rowBytes);
		for (uint32_t y = 0; y < height; ) {
			const size_t rows = std::min<size_t>(rowsPerChunk, height - y);
			const size_t chunkBytes = rowBytes * rows;
			fillVramGarbageScratch(m_vramGarbageScratch.data(), chunkBytes, stream);
			texmanager->updateTextureRegionForKey(
				slot.textureKey,
				m_vramGarbageScratch.data(),
				static_cast<i32>(rowPixels),
				static_cast<i32>(rows),
				0,
				static_cast<i32>(y)
			);
			y += static_cast<uint32_t>(rows);
		}
	} else {
		for (uint32_t y = 0; y < height; ++y) {
			for (uint32_t x = 0; x < entry.regionW; ) {
				const size_t segmentWidth = std::min<size_t>(maxPixels, entry.regionW - x);
				const size_t segmentBytes = segmentWidth * 4u;
				fillVramGarbageScratch(m_vramGarbageScratch.data(), segmentBytes, stream);
				texmanager->updateTextureRegionForKey(
					slot.textureKey,
					m_vramGarbageScratch.data(),
					static_cast<i32>(segmentWidth),
					1,
					static_cast<i32>(x),
					static_cast<i32>(y)
				);
				x += static_cast<uint32_t>(segmentWidth);
			}
		}
	}
	invalidateReadCache(slot.surfaceId);
}

void VDP::restoreVramSlotTexture(const Memory::AssetEntry& entry, const std::string& textureKey) {
	const bool isEngineAtlas = textureKey == ENGINE_ATLAS_TEXTURE_KEY;
	if (entry.regionW == 0 || entry.regionH == 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM slot missing dimensions for seeding.");
	}
	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[VDP] TextureManager not configured.");
	}
	auto* view = EngineCore::instance().view();
	if (!view) {
		throw BMSX_RUNTIME_ERROR("[VDP] GameView not configured.");
	}
	auto& slot = getVramSlotByTextureKey(textureKey);
	const size_t snapshotBytes = static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u;
	const bool restoreSnapshot = slot.contextSnapshot.size() == snapshotBytes;
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
	fillVramGarbageScratch(m_vramSeedPixel.data(), m_vramSeedPixel.size(), stream);
	TextureParams params;
	const TextureKey key = texmanager->makeKey(textureKey, params);
	TextureHandle handle = texmanager->getOrCreateTexture(
		key,
		m_vramSeedPixel.data(),
		1,
		1,
		params
	);
	handle = texmanager->resizeTextureForKey(
		textureKey,
		static_cast<i32>(entry.regionW),
		static_cast<i32>(entry.regionH)
	);
	view->textures[textureKey] = handle;
	setSlotTextureSize(textureKey, entry.regionW, entry.regionH);
	if (restoreSnapshot) {
		texmanager->updateTexture(
			handle,
			slot.contextSnapshot.data(),
			static_cast<i32>(entry.regionW),
			static_cast<i32>(entry.regionH),
			params
		);
		slot.contextSnapshot.clear();
		invalidateReadCache(slot.surfaceId);
		return;
	}
	if (!isEngineAtlas) {
		seedVramSlotTexture(slot);
	}
}

void VDP::setSlotTextureSize(const std::string& textureKey, uint32_t width, uint32_t height) {
	for (auto& slot : m_vramSlots) {
		if (slot.textureKey == textureKey) {
			slot.textureWidth = width;
			slot.textureHeight = height;
			return;
		}
	}
}

void VDP::registerReadSurface(uint32_t surfaceId, const std::string& assetId, const std::string& textureKey) {
	if (surfaceId >= VDP_RD_SURFACE_COUNT) {
		throw BMSX_RUNTIME_ERROR("[VDP] Invalid read surface.");
	}
	m_readSurfaces[surfaceId].assetId = assetId;
	m_readSurfaces[surfaceId].textureKey = textureKey;
	invalidateReadCache(surfaceId);
}

const VDP::ReadSurface& VDP::getReadSurface(uint32_t surfaceId) const {
	if (surfaceId >= VDP_RD_SURFACE_COUNT) {
		throw BMSX_RUNTIME_ERROR("[VDP] Invalid read surface.");
	}
	const auto& surface = m_readSurfaces[surfaceId];
	if (surface.assetId.empty()) {
		throw BMSX_RUNTIME_ERROR("[VDP] Read surface not registered.");
	}
	return surface;
}

void VDP::invalidateReadCache(uint32_t surfaceId) {
	if (surfaceId >= VDP_RD_SURFACE_COUNT) {
		return;
	}
	m_readCaches[surfaceId].width = 0;
}

VDP::ReadCache& VDP::getReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y) {
	if (surfaceId >= VDP_RD_SURFACE_COUNT) {
		throw BMSX_RUNTIME_ERROR("[VDP] Invalid read surface.");
	}
	auto& cache = m_readCaches[surfaceId];
	if (cache.width == 0 || cache.y != y || x < cache.x0 || x >= cache.x0 + cache.width) {
		prefetchReadCache(surfaceId, surface, x, y);
	}
	return cache;
}

void VDP::prefetchReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y) {
	auto& entry = m_memory.getAssetEntry(surface.assetId);
	const uint32_t width = entry.regionW;
	const uint32_t height = entry.regionH;
	if (x >= width || y >= height) {
		throw BMSX_RUNTIME_ERROR("[VDP] Read cache prefetch out of bounds.");
	}
	const uint32_t maxPixelsByBudget = m_readBudgetBytes / 4u;
	if (maxPixelsByBudget == 0) {
		m_readOverflow = true;
		m_readCaches[surfaceId].width = 0;
		return;
	}
	const uint32_t chunkW = std::min(VDP_RD_MAX_CHUNK_PIXELS, std::min(width - x, maxPixelsByBudget));
	auto data = readSurfacePixels(surface, x, y, chunkW, 1);
	auto& cache = m_readCaches[surfaceId];
	cache.x0 = x;
	cache.y = y;
	cache.width = chunkW;
	cache.data = std::move(data);
}

std::vector<u8> VDP::readSurfacePixels(const ReadSurface& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height) {
	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[VDP] TextureManager not configured.");
	}
	auto* backend = texmanager->backend();
	if (!backend) {
		throw BMSX_RUNTIME_ERROR("[VDP] Backend not configured.");
	}
	TextureHandle handle = texmanager->getTextureByUri(surface.textureKey);
	if (!handle) {
		throw BMSX_RUNTIME_ERROR("[VDP] Readback texture missing.");
	}
	std::vector<u8> out(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	backend->readTextureRegion(handle, out.data(), static_cast<i32>(width), static_cast<i32>(height),
								static_cast<i32>(x), static_cast<i32>(y), {});
	return out;
}

void VDP::commitViewSnapshot(GameView& view) {
	view.primaryAtlasIdInSlot = m_slotAtlasIds[0];
	view.secondaryAtlasIdInSlot = m_slotAtlasIds[1];
	m_dirtyAtlasBindings = false;
	if (m_dirtySkybox) {
		view.skyboxFaceIds = m_skyboxFaceIds;
		m_dirtySkybox = false;
	}
}

} // namespace bmsx
