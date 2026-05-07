#pragma once

#include "rompack/assets.h"
#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace bmsx {

enum class CartridgeLayerId {
	System,
	Cart,
	Overlay,
};

struct RomSourceEntry {
	AssetId resid;
	RomAssetInfo rom;
};

struct CartridgeIndex {
	std::vector<RomSourceEntry> entries;
	std::string projectRootPath;
};

struct RomSourceLayer {
	CartridgeLayerId id = CartridgeLayerId::Cart;
	CartridgeIndex index;
	const std::vector<u8>* payload = nullptr;
};

class RomSourceStack {
public:
	explicit RomSourceStack(std::vector<RomSourceLayer> layers);

	std::optional<RomSourceEntry> getEntry(std::string_view id) const;
	std::optional<RomSourceEntry> getEntryByPath(std::string_view path) const;
	std::vector<RomSourceEntry> list(std::optional<std::string_view> type = std::nullopt) const;
	std::vector<u8> getBytes(const RomSourceEntry& entry) const;
	std::vector<u8> getBytes(const RomAssetInfo& entry) const;
	std::span<const u8> getBytesView(const RomSourceEntry& entry) const;
	std::span<const u8> getBytesView(const RomAssetInfo& entry) const;

private:
	std::vector<RomSourceLayer> m_layers;
	std::vector<std::unordered_map<std::string, size_t>> m_idMaps;
	std::vector<std::unordered_map<std::string, size_t>> m_pathMaps;
	std::unordered_map<std::string, const std::vector<u8>*> m_payloads;

	std::optional<RomSourceEntry> findEntry(std::string_view key, const std::vector<std::unordered_map<std::string, size_t>>& maps) const;
	RomSourceEntry attachPayloadId(const RomSourceEntry& asset, CartridgeLayerId payloadId) const;
};

const char* cartridgeLayerIdName(CartridgeLayerId id);
std::string cartridgeLayerIdString(CartridgeLayerId id);
CartridgeLayerId cartridgeLayerIdFromString(std::string_view id);
const u8* romSourceLayerBytes(const RomSourceLayer& layer, const RomAssetInfo& entry);
size_t romSourceLayerByteLength(const RomAssetInfo& entry);

} // namespace bmsx
