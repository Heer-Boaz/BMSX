#include "vdp.h"
#include "memory_map.h"
#include "../rompack/runtime_assets.h"
#include "../core/engine_core.h"
#include "../render/texturemanager.h"
#include "../vendor/stb_image.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <stdexcept>

namespace bmsx {
namespace {

constexpr uint32_t VDP_RD_SURFACE_ENGINE = 0u;
constexpr uint32_t VDP_RD_SURFACE_PRIMARY = 1u;
constexpr uint32_t VDP_RD_SURFACE_SECONDARY = 2u;
constexpr uint32_t VDP_RD_SURFACE_COUNT = 3u;
constexpr uint32_t VDP_RD_BUDGET_BYTES = 4096u;
constexpr uint32_t VDP_RD_MAX_CHUNK_PIXELS = 256u;
constexpr size_t VRAM_GARBAGE_CHUNK_BYTES = 64u * 1024u;

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

BlockGen initBlockGen(uint32_t biasSeed, uint32_t bootSeedMix, uint32_t blockIndex) {
	const uint32_t pageIndex = blockIndex >> 7u;
	const uint32_t rowIndex = blockIndex >> 3u;

	const uint32_t pageH = fmix32((biasSeed ^ (pageIndex * 0xc2b2ae35U) ^ 0xa5a5a5a5U));
	const uint32_t rowH = fmix32((biasSeed ^ (rowIndex * 0x85ebca6bU) ^ 0x1b873593U));
	const uint32_t blkH = fmix32((biasSeed ^ (blockIndex * 0x9e3779b9U) ^ 0x85ebca77U));

	const int bias =
		signed8FromHash(pageH) * 4 +
		signed8FromHash(rowH) * 2 +
		signed8FromHash(blkH) * 1;

	const int absBias = bias < 0 ? -bias : bias;

	const int forceLevel =
		(absBias < 160) ? 0 :
		(absBias < 360) ? 1 :
		(absBias < 600) ? 2 : 3;

	const int jitterLevel = 3 - forceLevel;

	uint32_t ps = (blkH ^ rowH ^ 0xdeadbeefU) | 1u;
	ps = xorshift32(ps); const uint32_t m1 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t m2 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t prefWord = scramble32(ps);
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
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	if (entry.baseStride == 0 || entry.regionW == 0 || entry.regionH == 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM slot not initialized for writes.");
	}
	ensureVramSlotTextureSize(slot);
	const uint32_t offset = addr - slot.baseAddr;
	const uint32_t stride = entry.baseStride;
	const uint32_t totalBytes = entry.regionH * stride;
	if (offset + length > totalBytes) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM write exceeds slot bounds.");
	}
	if ((offset & 3u) != 0u || (length & 3u) != 0u) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM writes must be 32-bit aligned.");
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
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(dither)));
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
	const RuntimeAssets* fallback = assets.fallback;

	std::vector<std::string> viewAssets;
	viewAssets.reserve(assets.img.size());

	const std::string engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	const ImgAsset* engineAtlasAsset = nullptr;

	for (auto& [id, imgAsset] : assets.img) {
		if (imgAsset.meta.atlassed) {
			viewAssets.push_back(id);
			continue;
		}
		if (id == engineAtlasName) {
			engineAtlasAsset = &imgAsset;
			continue;
		}
		if (!isAtlasName(id)) {
			continue;
		}
		const i32 atlasId = imgAsset.meta.atlasid;
		m_atlasResourceById[atlasId] = id;
	}

	if (fallback) {
		for (const auto& [id, imgAsset] : fallback->img) {
			if (assets.img.find(id) != assets.img.end()) {
				continue;
			}
			if (imgAsset.meta.atlassed) {
				viewAssets.push_back(id);
				continue;
			}
			if (id == engineAtlasName && !engineAtlasAsset) {
				engineAtlasAsset = &imgAsset;
				continue;
			}
			if (!isAtlasName(id)) {
				continue;
			}
			const i32 atlasId = imgAsset.meta.atlasid;
			m_atlasResourceById[atlasId] = id;
		}
	}

	if (!engineAtlasAsset) {
		throw BMSX_RUNTIME_ERROR("[VDP] Engine atlas missing from assets.");
	}
	if (engineAtlasAsset->meta.width <= 0 || engineAtlasAsset->meta.height <= 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] Engine atlas missing dimensions.");
	}
	// NOTE: Atlas priming is not allowed; slot sizing must not derive from atlas metadata.
	auto seedAtlasSlot = [](Memory::AssetEntry& slotEntry) {
		const double maxPixels = static_cast<double>(slotEntry.capacity) / 4.0;
		const uint32_t side = static_cast<uint32_t>(std::floor(std::sqrt(maxPixels)));
		const uint32_t stride = side * 4u;
		slotEntry.baseSize = stride * side;
		slotEntry.baseStride = stride;
		slotEntry.regionX = 0;
		slotEntry.regionY = 0;
		slotEntry.regionW = side;
		slotEntry.regionH = side;
	};
	bool engineEntryCreated = false;
	if (!m_memory.hasAsset(engineAtlasName)) {
		m_memory.registerImageSlotAt(
			engineAtlasName,
			VRAM_ENGINE_ATLAS_BASE,
			VRAM_ENGINE_ATLAS_SIZE,
			0,
			false
		);
		engineEntryCreated = true;
	}
	auto& engineEntry = m_memory.getAssetEntry(engineAtlasName);
	if (engineEntryCreated || engineEntry.regionW == 0 || engineEntry.regionH == 0) {
		seedAtlasSlot(engineEntry);
	}
	registerVramSlot(engineEntry, ENGINE_ATLAS_TEXTURE_KEY, VDP_RD_SURFACE_ENGINE);

	const i32 skyboxFaceSize = assets.manifest.skyboxFaceSize > 0
		? assets.manifest.skyboxFaceSize
		: SKYBOX_FACE_DEFAULT_SIZE;
	if (skyboxFaceSize <= 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] Invalid skybox_face_size: " + std::to_string(skyboxFaceSize));
	}
	const uint32_t skyboxBytes = static_cast<uint32_t>(skyboxFaceSize)
		* static_cast<uint32_t>(skyboxFaceSize)
		* 4u;
	if (!m_memory.hasAsset(SKYBOX_SLOT_POSX_ID)) {
		m_memory.registerImageSlot(SKYBOX_SLOT_POSX_ID, skyboxBytes, 0);
	}
	if (!m_memory.hasAsset(SKYBOX_SLOT_NEGX_ID)) {
		m_memory.registerImageSlot(SKYBOX_SLOT_NEGX_ID, skyboxBytes, 0);
	}
	if (!m_memory.hasAsset(SKYBOX_SLOT_POSY_ID)) {
		m_memory.registerImageSlot(SKYBOX_SLOT_POSY_ID, skyboxBytes, 0);
	}
	if (!m_memory.hasAsset(SKYBOX_SLOT_NEGY_ID)) {
		m_memory.registerImageSlot(SKYBOX_SLOT_NEGY_ID, skyboxBytes, 0);
	}
	if (!m_memory.hasAsset(SKYBOX_SLOT_POSZ_ID)) {
		m_memory.registerImageSlot(SKYBOX_SLOT_POSZ_ID, skyboxBytes, 0);
	}
	if (!m_memory.hasAsset(SKYBOX_SLOT_NEGZ_ID)) {
		m_memory.registerImageSlot(SKYBOX_SLOT_NEGZ_ID, skyboxBytes, 0);
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
		auto* imgAsset = assets.getImg(id);
		if (!imgAsset) {
			throw BMSX_RUNTIME_ERROR("[VDP] Image asset '" + id + "' not found.");
		}
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
		const i32 offsetX = static_cast<i32>(std::floor(minU * static_cast<f32>(atlasWidth)));
		const i32 offsetY = static_cast<i32>(std::floor(minV * static_cast<f32>(atlasHeight)));
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
		}
		m_atlasViewIdsById[atlasId].push_back(id);
	}

	syncRegisters();

	if (!keepDecodedData) {
		for (auto& [id, imgAsset] : assets.img) {
			if (id == engineAtlasName || isAtlasName(id)) {
				continue;
			}
			if (!imgAsset.pixels.empty()) {
				std::vector<u8>().swap(imgAsset.pixels);
			}
		}
	}
}

void VDP::uploadAtlasTextures() {
	const auto& engineEntry = m_memory.getAssetEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
	ensureAtlasSlotTexture(engineEntry, ENGINE_ATLAS_TEXTURE_KEY);
	auto* view = EngineCore::instance().view();
	if (!view) {
		throw BMSX_RUNTIME_ERROR("[VDP] GameView not configured.");
	}
	view->loadEngineAtlasTexture();
	const auto& primaryEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	const auto& secondaryEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	ensureAtlasSlotTexture(primaryEntry, ATLAS_PRIMARY_SLOT_ID);
	ensureAtlasSlotTexture(secondaryEntry, ATLAS_SECONDARY_SLOT_ID);
	m_dirtyAtlasBindings = true;
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
					ImgAsset* engineAsset = EngineCore::instance().assets().getImg(engineAtlasName);
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

void VDP::applyAtlasSlotMapping(const std::array<i32, 2>& slots) {
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

void VDP::setSkyboxImages(const SkyboxImageIds& ids) {
	auto& assets = EngineCore::instance().assets();
	loadSkyboxFaceIntoSlot(SKYBOX_SLOT_POSX_ID, ids.posx, assets);
	loadSkyboxFaceIntoSlot(SKYBOX_SLOT_NEGX_ID, ids.negx, assets);
	loadSkyboxFaceIntoSlot(SKYBOX_SLOT_POSY_ID, ids.posy, assets);
	loadSkyboxFaceIntoSlot(SKYBOX_SLOT_NEGY_ID, ids.negy, assets);
	loadSkyboxFaceIntoSlot(SKYBOX_SLOT_POSZ_ID, ids.posz, assets);
	loadSkyboxFaceIntoSlot(SKYBOX_SLOT_NEGZ_ID, ids.negz, assets);
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
	VramSlot slot;
	slot.baseAddr = entry.baseAddr;
	slot.capacity = entry.capacity;
	slot.assetId = entry.id;
	slot.textureKey = textureKey;
	slot.surfaceId = surfaceId;
	slot.textureWidth = entry.regionW;
	slot.textureHeight = entry.regionH;
	m_vramSlots.push_back(std::move(slot));
	registerReadSurface(surfaceId, entry.id, textureKey);
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

void VDP::ensureVramSlotTextureSize(VramSlot& slot) {
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	const uint32_t width = entry.regionW;
	const uint32_t height = entry.regionH;
	if (slot.textureWidth == width && slot.textureHeight == height) {
		return;
	}
	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[VDP] TextureManager not configured.");
	}
	TextureHandle handle = texmanager->resizeTextureForKey(slot.textureKey,
		static_cast<i32>(width),
		static_cast<i32>(height));
	auto* view = EngineCore::instance().view();
	if (!view) {
		throw BMSX_RUNTIME_ERROR("[VDP] GameView not configured.");
	}
	view->textures[slot.textureKey] = handle;
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

uint32_t VDP::vramSlotSalt(const VramSlot& slot) const {
	return slot.baseAddr;
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

		BlockGen gen = initBlockGen(biasSeed, bootSeedMix, blockIndex);

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
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_STAGING_BASE, 0u};
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
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, vramSlotSalt(slot), 0u};
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

void VDP::ensureAtlasSlotTexture(const Memory::AssetEntry& entry, const std::string& textureKey) {
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
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, vramSlotSalt(slot), 0u};
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
	seedVramSlotTexture(slot);
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

void VDP::loadSkyboxFaceIntoSlot(const std::string& slotId, const std::string& assetId, RuntimeAssets& assets) {
	auto* asset = assets.getImg(assetId);
	if (!asset) {
		throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + assetId + "' not found.");
	}
	if (asset->meta.atlassed) {
		throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + assetId + "' must not be atlassed.");
	}
	i32 width = asset->meta.width;
	i32 height = asset->meta.height;
	std::vector<u8> decoded;
	const u8* pixels = nullptr;
	size_t pixelBytes = 0;
	if (!asset->pixels.empty() && width > 0 && height > 0) {
		pixels = asset->pixels.data();
		pixelBytes = asset->pixels.size();
	} else {
		decoded = decodeImageFromRom(*asset, width, height);
		pixels = decoded.data();
		pixelBytes = decoded.size();
		if (asset->meta.width <= 0) {
			asset->meta.width = width;
		}
		if (asset->meta.height <= 0) {
			asset->meta.height = height;
		}
	}
	const i32 faceSize = assets.manifest.skyboxFaceSize > 0
		? assets.manifest.skyboxFaceSize
		: SKYBOX_FACE_DEFAULT_SIZE;
	auto& slotEntry = m_memory.getAssetEntry(slotId);
	m_memory.writeImageSlot(slotEntry,
		pixels,
		pixelBytes,
		static_cast<uint32_t>(faceSize),
		static_cast<uint32_t>(faceSize),
		slotEntry.capacity
	);
}

std::vector<u8> VDP::decodeImageFromRom(const ImgAsset& asset, i32& outWidth, i32& outHeight) {
	if (!asset.rom.start || !asset.rom.end) {
		throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + asset.id + "' missing ROM range.");
	}
	const i32 start = *asset.rom.start;
	const i32 end = *asset.rom.end;
	if (end <= start) {
		throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + asset.id + "' has invalid ROM range.");
	}
	uint32_t base = CART_ROM_BASE;
	if (asset.rom.payloadId.has_value()) {
		const auto& payload = *asset.rom.payloadId;
		if (payload == "system") {
			base = ENGINE_ROM_BASE;
		} else if (payload == "overlay") {
			base = OVERLAY_ROM_BASE;
		} else if (payload == "cart") {
			base = CART_ROM_BASE;
		} else {
			throw BMSX_RUNTIME_ERROR("[VDP] Skybox image '" + asset.id + "' has unsupported payload_id " + payload + ".");
		}
	}
	const size_t len = static_cast<size_t>(end - start);
	std::vector<u8> buffer(len);
	m_memory.readBytes(base + static_cast<uint32_t>(start), buffer.data(), len);
	int width = 0;
	int height = 0;
	int comp = 0;
	unsigned char* pixels = stbi_load_from_memory(buffer.data(), static_cast<int>(buffer.size()), &width, &height, &comp, STBI_rgb_alpha);
	(void)comp;
	if (!pixels || width <= 0 || height <= 0) {
		if (pixels) {
			stbi_image_free(pixels);
		}
		throw BMSX_RUNTIME_ERROR("[VDP] Failed to decode skybox image '" + asset.id + "'.");
	}
	const size_t byteCount = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
	std::vector<u8> out(byteCount);
	std::memcpy(out.data(), pixels, byteCount);
	stbi_image_free(pixels);
	outWidth = width;
	outHeight = height;
	return out;
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
	if (m_dirtyAtlasBindings) {
		view.primaryAtlasIdInSlot = m_slotAtlasIds[0];
		view.secondaryAtlasIdInSlot = m_slotAtlasIds[1];
		m_dirtyAtlasBindings = false;
	}
	if (m_dirtySkybox) {
		view.skyboxFaceIds = m_skyboxFaceIds;
		m_dirtySkybox = false;
	}
}

} // namespace bmsx
