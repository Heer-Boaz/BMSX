#include "vdp.h"
#include "../rompack/runtime_assets.h"
#include "../core/engine_core.h"
#include "../render/texturemanager.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>

namespace bmsx {
namespace {

bool isAtlasName(const std::string& name) {
	static constexpr const char* kPrefix = "_atlas_";
	return name.rfind(kPrefix, 0) == 0;
}

}

VDP::VDP(Memory& memory)
	: m_memory(memory)
	, m_vramStaging(VRAM_STAGING_SIZE) {
	m_memory.setVramWriter(this);
}

void VDP::writeVram(uint32_t addr, const u8* data, size_t length) {
	if (addr >= VRAM_STAGING_BASE && addr + length <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		const uint32_t offset = addr - VRAM_STAGING_BASE;
		std::memcpy(m_vramStaging.data() + offset, data, length);
		return;
	}
	const auto& slot = findVramSlot(addr, length);
	auto* entry = slot.entry;
	if (!entry || entry->baseStride == 0 || entry->regionW == 0 || entry->regionH == 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] VRAM slot not initialized for writes.");
	}
	const uint32_t offset = addr - slot.baseAddr;
	const uint32_t stride = entry->baseStride;
	const uint32_t totalBytes = entry->regionH * stride;
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
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1;
		rowOffset = 0;
	}
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
	m_dirtyAtlasBindings = true;
	m_dirtySkybox = true;
	m_skyboxFaceIds = {};
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
	Memory::AssetEntry* engineEntry = nullptr;
	bool engineEntryCreated = false;
	if (m_memory.hasAsset(engineAtlasName)) {
		engineEntry = &m_memory.getAssetEntry(engineAtlasName);
	} else {
		auto& slotEntry = m_memory.registerImageSlotAt(
			engineAtlasName,
			VRAM_ENGINE_ATLAS_BASE,
			VRAM_ENGINE_ATLAS_SIZE,
			0,
			false
		);
		engineEntry = &slotEntry;
		engineEntryCreated = true;
	}
	if (engineEntryCreated) {
		seedAtlasSlot(*engineEntry);
	}
	registerVramSlot(*engineEntry, ENGINE_ATLAS_TEXTURE_KEY);

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

	Memory::AssetEntry* primarySlotEntry = nullptr;
	if (m_memory.hasAsset(ATLAS_PRIMARY_SLOT_ID)) {
		primarySlotEntry = &m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	} else {
		primarySlotEntry = &m_memory.registerImageSlotAt(
			ATLAS_PRIMARY_SLOT_ID,
			VRAM_PRIMARY_ATLAS_BASE,
			VRAM_PRIMARY_ATLAS_SIZE,
			0,
			false
		);
	}
	Memory::AssetEntry* secondarySlotEntry = nullptr;
	if (m_memory.hasAsset(ATLAS_SECONDARY_SLOT_ID)) {
		secondarySlotEntry = &m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	} else {
		secondarySlotEntry = &m_memory.registerImageSlotAt(
			ATLAS_SECONDARY_SLOT_ID,
			VRAM_SECONDARY_ATLAS_BASE,
			VRAM_SECONDARY_ATLAS_SIZE,
			0,
			false
		);
	}
	seedAtlasSlot(*primarySlotEntry);
	seedAtlasSlot(*secondarySlotEntry);
	registerVramSlot(*primarySlotEntry, ATLAS_PRIMARY_SLOT_ID);
	registerVramSlot(*secondarySlotEntry, ATLAS_SECONDARY_SLOT_ID);

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
		i32 atlasWidth = 0;
		i32 atlasHeight = 0;
		if (atlasId == ENGINE_ATLAS_INDEX) {
			baseEntry = engineEntry;
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
			baseEntry = primarySlotEntry;
			const auto slotIt = m_atlasSlotById.find(atlasId);
			if (slotIt != m_atlasSlotById.end()) {
				baseEntry = slotIt->second == 1 ? secondarySlotEntry : primarySlotEntry;
			}
		}
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

	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[VDP] TextureManager not configured.");
	}
	auto* view = EngineCore::instance().view();
	if (!view) {
		throw BMSX_RUNTIME_ERROR("[VDP] GameView not configured.");
	}
	if (engineAtlasAsset->pixels.empty()) {
		throw BMSX_RUNTIME_ERROR("[VDP] Engine atlas pixels missing.");
	}
	TextureHandle engineHandle = texmanager->getOrCreateTexture(
		ENGINE_ATLAS_TEXTURE_KEY,
		engineAtlasAsset->pixels.data(),
		engineAtlasAsset->meta.width,
		engineAtlasAsset->meta.height,
		{}
	);
	view->textures[ENGINE_ATLAS_TEXTURE_KEY] = engineHandle;
	view->loadEngineAtlasTexture();

	const i32 primaryW = static_cast<i32>(primarySlotEntry->regionW);
	const i32 primaryH = static_cast<i32>(primarySlotEntry->regionH);
	std::vector<u8> blankPrimary(static_cast<size_t>(primaryW) * static_cast<size_t>(primaryH) * 4u);
	TextureHandle primaryHandle = texmanager->getOrCreateTexture(
		ATLAS_PRIMARY_SLOT_ID,
		blankPrimary.data(),
		primaryW,
		primaryH,
		{}
	);
	view->textures[ATLAS_PRIMARY_SLOT_ID] = primaryHandle;

	const i32 secondaryW = static_cast<i32>(secondarySlotEntry->regionW);
	const i32 secondaryH = static_cast<i32>(secondarySlotEntry->regionH);
	std::vector<u8> blankSecondary(static_cast<size_t>(secondaryW) * static_cast<size_t>(secondaryH) * 4u);
	TextureHandle secondaryHandle = texmanager->getOrCreateTexture(
		ATLAS_SECONDARY_SLOT_ID,
		blankSecondary.data(),
		secondaryW,
		secondaryH,
		{}
	);
	view->textures[ATLAS_SECONDARY_SLOT_ID] = secondaryHandle;

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

void VDP::registerVramSlot(Memory::AssetEntry& entry, const std::string& textureKey) {
	VramSlot slot;
	slot.baseAddr = entry.baseAddr;
	slot.capacity = entry.capacity;
	slot.entry = &entry;
	slot.textureKey = textureKey;
	m_vramSlots.push_back(std::move(slot));
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
