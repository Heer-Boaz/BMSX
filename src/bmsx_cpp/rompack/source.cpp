#include "rompack/source.h"

#include <unordered_set>


namespace bmsx {
namespace {

bool romEntryDeletes(const RomSourceEntry& entry) {
	return entry.rom.op.has_value() && *entry.rom.op == "delete";
}

const std::vector<u8>& payloadForEntry(const std::unordered_map<std::string, const std::vector<u8>*>& payloads, const RomAssetInfo& entry) {
	const auto it = payloads.find(*entry.payloadId);
	return *it->second;
}

} // namespace

RomSourceStack::RomSourceStack(std::vector<RomSourceLayer> layers)
	: m_layers(std::move(layers)) {
	m_idMaps.reserve(m_layers.size());
	m_pathMaps.reserve(m_layers.size());
	for (const RomSourceLayer& layer : m_layers) {
		std::unordered_map<std::string, size_t> idMap;
		std::unordered_map<std::string, size_t> pathMap;
		idMap.reserve(layer.index.entries.size());
		pathMap.reserve(layer.index.entries.size());
		for (size_t index = 0; index < layer.index.entries.size(); ++index) {
			const RomSourceEntry& entry = layer.index.entries[index];
			idMap[entry.resid] = index;
			if (entry.rom.sourcePath.has_value()) {
				pathMap[*entry.rom.sourcePath] = index;
			}
		}
		m_idMaps.push_back(std::move(idMap));
		m_pathMaps.push_back(std::move(pathMap));
		m_payloads[cartridgeLayerIdString(layer.id)] = layer.payload;
	}
}

std::optional<RomSourceEntry> RomSourceStack::getEntry(std::string_view id) const {
	for (size_t layerIndex = 0; layerIndex < m_layers.size(); ++layerIndex) {
		const auto assetIt = m_idMaps[layerIndex].find(std::string(id));
		if (assetIt == m_idMaps[layerIndex].end()) {
			continue;
		}
		const RomSourceEntry& asset = m_layers[layerIndex].index.entries[assetIt->second];
		if (romEntryDeletes(asset)) {
			return std::nullopt;
		}
		return attachPayloadId(asset, m_layers[layerIndex].id);
	}
	return std::nullopt;
}

std::optional<RomSourceEntry> RomSourceStack::getEntryByPath(std::string_view path) const {
	for (size_t layerIndex = 0; layerIndex < m_layers.size(); ++layerIndex) {
		const auto assetIt = m_pathMaps[layerIndex].find(std::string(path));
		if (assetIt == m_pathMaps[layerIndex].end()) {
			continue;
		}
		const RomSourceEntry& asset = m_layers[layerIndex].index.entries[assetIt->second];
		if (romEntryDeletes(asset)) {
			return std::nullopt;
		}
		return attachPayloadId(asset, m_layers[layerIndex].id);
	}
	return std::nullopt;
}

std::vector<RomSourceEntry> RomSourceStack::list(std::optional<std::string_view> type) const {
	std::vector<RomSourceEntry> out;
	std::unordered_set<std::string> blocked;
	for (const RomSourceLayer& layer : m_layers) {
		for (const RomSourceEntry& entry : layer.index.entries) {
			if (type.has_value() && entry.rom.type != *type) {
				continue;
			}
			if (blocked.find(entry.resid) != blocked.end()) {
				continue;
			}
			if (romEntryDeletes(entry)) {
				blocked.insert(entry.resid);
				continue;
			}
			out.push_back(attachPayloadId(entry, layer.id));
			blocked.insert(entry.resid);
		}
	}
	return out;
}

std::vector<u8> RomSourceStack::getBytes(const RomSourceEntry& entry) const {
	return getBytes(entry.rom);
}

std::vector<u8> RomSourceStack::getBytes(const RomAssetInfo& entry) const {
	std::span<const u8> view = getBytesView(entry);
	return std::vector<u8>(view.begin(), view.end());
}

std::span<const u8> RomSourceStack::getBytesView(const RomSourceEntry& entry) const {
	return getBytesView(entry.rom);
}

std::span<const u8> RomSourceStack::getBytesView(const RomAssetInfo& entry) const {
	const std::vector<u8>& payload = payloadForEntry(m_payloads, entry);
	return std::span<const u8>(payload.data() + static_cast<size_t>(*entry.start), static_cast<size_t>(*entry.end - *entry.start));
}

RomSourceEntry RomSourceStack::attachPayloadId(const RomSourceEntry& asset, CartridgeLayerId payloadId) const {
	RomSourceEntry copy = asset;
	copy.rom.payloadId = cartridgeLayerIdString(payloadId);
	return copy;
}

const char* cartridgeLayerIdName(CartridgeLayerId id) {
	switch (id) {
		case CartridgeLayerId::System: return "system";
		case CartridgeLayerId::Cart: return "cart";
		case CartridgeLayerId::Overlay: return "overlay";
	}
	throw BMSX_RUNTIME_ERROR("Invalid cartridge layer id.");
}

std::string cartridgeLayerIdString(CartridgeLayerId id) {
	return cartridgeLayerIdName(id);
}

CartridgeLayerId cartridgeLayerIdFromString(std::string_view id) {
	if (id == "system") return CartridgeLayerId::System;
	if (id == "overlay") return CartridgeLayerId::Overlay;
	return CartridgeLayerId::Cart;
}

const u8* romSourceLayerBytes(const RomSourceLayer& layer, const RomAssetInfo& entry) {
	return layer.payload->data() + static_cast<size_t>(*entry.start);
}

size_t romSourceLayerByteLength(const RomAssetInfo& entry) {
	return static_cast<size_t>(*entry.end - *entry.start);
}

} // namespace bmsx
