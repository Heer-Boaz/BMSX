#include "vdp.h"
#include "../core/assets.h"
#include "../core/engine.h"
#include "../render/texturemanager.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace bmsx {
namespace {

bool isAtlasName(const std::string& name) {
	static constexpr const char* kPrefix = "_atlas_";
	return name.rfind(kPrefix, 0) == 0;
}

}

VDP::VDP(VmMemory& memory)
	: m_memory(memory) {}

void VDP::initializeRegisters() {
	const auto dither = static_cast<i32>(EngineCore::instance().view()->dither_type);
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(dither)));
	m_lastDitherType = dither;
}

void VDP::syncRegisters() {
	const i32 dither = static_cast<i32>(asNumber(m_memory.readValue(IO_VDP_DITHER)));
	if (dither == m_lastDitherType) {
		return;
	}
	m_lastDitherType = dither;
	EngineCore::instance().view()->dither_type = static_cast<GameView::DitherType>(dither);
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
	if (engineAtlasAsset->pixels.empty() || engineAtlasAsset->meta.width <= 0 || engineAtlasAsset->meta.height <= 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] Engine atlas missing pixel data.");
	}
	auto& engineEntry = m_memory.registerImageBuffer(
		engineAtlasName,
		engineAtlasAsset->pixels.data(),
		static_cast<uint32_t>(engineAtlasAsset->meta.width),
		static_cast<uint32_t>(engineAtlasAsset->meta.height),
		0
	);

	const i32 skyboxFaceSize = assets.manifest.skyboxFaceSize > 0
		? assets.manifest.skyboxFaceSize
		: SKYBOX_FACE_DEFAULT_SIZE;
	if (skyboxFaceSize <= 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] Invalid skybox_face_size: " + std::to_string(skyboxFaceSize));
	}
	const uint32_t skyboxBytes = static_cast<uint32_t>(skyboxFaceSize)
		* static_cast<uint32_t>(skyboxFaceSize)
		* 4u;
	m_memory.registerImageSlot(SKYBOX_SLOT_POSX_ID, skyboxBytes, 0);
	m_memory.registerImageSlot(SKYBOX_SLOT_NEGX_ID, skyboxBytes, 0);
	m_memory.registerImageSlot(SKYBOX_SLOT_POSY_ID, skyboxBytes, 0);
	m_memory.registerImageSlot(SKYBOX_SLOT_NEGY_ID, skyboxBytes, 0);
	m_memory.registerImageSlot(SKYBOX_SLOT_POSZ_ID, skyboxBytes, 0);
	m_memory.registerImageSlot(SKYBOX_SLOT_NEGZ_ID, skyboxBytes, 0);

	uint32_t maxAtlasBytes = 0;
	for (const auto& entry : m_atlasResourceById) {
		const auto* atlasAsset = assets.getImg(entry.second);
		if (!atlasAsset || atlasAsset->pixels.empty()) {
			throw BMSX_RUNTIME_ERROR("[VDP] Atlas '" + entry.second + "' missing pixel data.");
		}
		const uint32_t width = static_cast<uint32_t>(atlasAsset->meta.width);
		const uint32_t height = static_cast<uint32_t>(atlasAsset->meta.height);
		const uint32_t bytes = width * height * 4u;
		if (bytes > maxAtlasBytes) {
			maxAtlasBytes = bytes;
		}
	}
	if (maxAtlasBytes == 0) {
		throw BMSX_RUNTIME_ERROR("[VDP] No atlas resources available for slot allocation.");
	}

	m_memory.registerImageSlot(ATLAS_PRIMARY_SLOT_ID, maxAtlasBytes, 0);
	m_memory.registerImageSlot(ATLAS_SECONDARY_SLOT_ID, maxAtlasBytes, 0);

	std::vector<i32> atlasIds;
	atlasIds.reserve(m_atlasResourceById.size());
	for (const auto& [atlasId, _] : m_atlasResourceById) {
		atlasIds.push_back(atlasId);
	}
	std::sort(atlasIds.begin(), atlasIds.end());
	if (!atlasIds.empty()) {
		m_atlasSlotById[atlasIds[0]] = 0;
		m_slotAtlasIds[0] = atlasIds[0];
	}
	if (atlasIds.size() > 1) {
		m_atlasSlotById[atlasIds[1]] = 1;
		m_slotAtlasIds[1] = atlasIds[1];
	}

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
		const VmMemory::AssetEntry* baseEntry = nullptr;
		i32 atlasWidth = 0;
		i32 atlasHeight = 0;
		if (atlasId == ENGINE_ATLAS_INDEX) {
			baseEntry = &engineEntry;
			atlasWidth = static_cast<i32>(engineEntry.regionW);
			atlasHeight = static_cast<i32>(engineEntry.regionH);
		} else {
			const auto atlasNameIt = m_atlasResourceById.find(atlasId);
			if (atlasNameIt == m_atlasResourceById.end()) {
				throw BMSX_RUNTIME_ERROR("[VDP] Atlas " + std::to_string(atlasId) + " missing for image '" + id + "'.");
			}
			const auto* atlasAsset = assets.getImg(atlasNameIt->second);
			atlasWidth = atlasAsset->meta.width;
			atlasHeight = atlasAsset->meta.height;
			const auto slotIt = m_atlasSlotById.find(atlasId);
			const bool useSecondary = (slotIt != m_atlasSlotById.end() && slotIt->second == 1);
			const std::string& slotId = useSecondary ? ATLAS_SECONDARY_SLOT_ID : ATLAS_PRIMARY_SLOT_ID;
			baseEntry = &m_memory.getAssetEntry(slotId);
		}
		const i32 offsetX = static_cast<i32>(std::floor(minU * static_cast<f32>(atlasWidth)));
		const i32 offsetY = static_cast<i32>(std::floor(minV * static_cast<f32>(atlasHeight)));
		const i32 regionW = std::max(1, std::min(atlasWidth - offsetX,
			static_cast<i32>(std::round((maxU - minU) * static_cast<f32>(atlasWidth)))));
		const i32 regionH = std::max(1, std::min(atlasHeight - offsetY,
			static_cast<i32>(std::round((maxV - minV) * static_cast<f32>(atlasHeight)))));
		m_memory.registerImageView(
			id,
			*baseEntry,
			static_cast<uint32_t>(offsetX),
			static_cast<uint32_t>(offsetY),
			static_cast<uint32_t>(regionW),
			static_cast<uint32_t>(regionH),
			0
		);
		m_atlasViewIdsById[atlasId].push_back(id);
	}

	if (m_slotAtlasIds[0] >= 0) {
		loadAtlasIntoSlot(assets, 0, m_slotAtlasIds[0]);
	}
	if (m_slotAtlasIds[1] >= 0) {
		loadAtlasIntoSlot(assets, 1, m_slotAtlasIds[1]);
	}

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

void VDP::loadAtlasIntoSlot(RuntimeAssets& assets, i32 slot, i32 atlasId) {
	const auto atlasNameIt = m_atlasResourceById.find(atlasId);
	if (atlasNameIt == m_atlasResourceById.end()) {
		throw BMSX_RUNTIME_ERROR("[VDP] Atlas " + std::to_string(atlasId) + " not found in assets.");
	}
	const std::string& atlasName = atlasNameIt->second;
	auto* atlasAsset = assets.getImg(atlasName);
	if (!atlasAsset || atlasAsset->pixels.empty()) {
		throw BMSX_RUNTIME_ERROR("[VDP] Atlas '" + atlasName + "' missing pixel data.");
	}
	const std::string& slotId = (slot == 1) ? ATLAS_SECONDARY_SLOT_ID : ATLAS_PRIMARY_SLOT_ID;
	auto& slotEntry = m_memory.getAssetEntry(slotId);
	m_memory.writeImageSlot(
		slotEntry,
		atlasAsset->pixels.data(),
		atlasAsset->pixels.size(),
		static_cast<uint32_t>(atlasAsset->meta.width),
		static_cast<uint32_t>(atlasAsset->meta.height)
	);
	const auto existingSlot = m_atlasSlotById.find(atlasId);
	if (existingSlot != m_atlasSlotById.end() && existingSlot->second != slot) {
		m_slotAtlasIds[existingSlot->second] = -1;
	}
	const i32 previousAtlasId = m_slotAtlasIds[slot];
	if (previousAtlasId >= 0) {
		m_atlasSlotById.erase(previousAtlasId);
	}
	m_atlasSlotById[atlasId] = slot;
	m_slotAtlasIds[slot] = atlasId;
	m_dirtyAtlasBindings = true;
	const auto viewIt = m_atlasViewIdsById.find(atlasId);
	if (viewIt != m_atlasViewIdsById.end()) {
		for (const auto& viewId : viewIt->second) {
			auto& viewEntry = m_memory.getAssetEntry(viewId);
			m_memory.updateImageViewBase(viewEntry, slotEntry);
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
	const std::string engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	for (const auto* entry : dirty) {
		if (entry->type == VmMemory::AssetType::Image) {
			if (entry->regionW == 0 || entry->regionH == 0) {
				continue;
			}
			const u8* pixels = m_memory.getImagePixels(*entry);
			const i32 width = static_cast<i32>(entry->regionW);
			const i32 height = static_cast<i32>(entry->regionH);
			const std::string& textureKey = (entry->id == engineAtlasName) ? ENGINE_ATLAS_TEXTURE_KEY : entry->id;
			texmanager->updateTexturesForAsset(textureKey, pixels, width, height);
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
