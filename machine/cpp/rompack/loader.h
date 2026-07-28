/*
 * loader.h - Decoded ROM tooling package records
 */

#ifndef BMSX_ROMPACK_LOADER_H
#define BMSX_ROMPACK_LOADER_H

#include "common/primitives.h"
#include "rompack/format.h"
#include "rompack/image.h"
#include "rompack/assets.h"
#include "common/serializer/binencoder.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <optional>

namespace bmsx {

/* ============================================================================
 * RomToolingPackage - decoded ROM package
 * ============================================================================ */

class RomToolingPackage {
public:
	RomToolingPackage() = default;
	~RomToolingPackage() = default;
	RomToolingPackage(RomToolingPackage&&) = default;
	RomToolingPackage& operator=(RomToolingPackage&&) = default;

	// Decoded ROM record storage.
	std::unordered_map<AssetToken, ImgAsset> img;
	std::unordered_map<AssetToken, AudioAsset> audio;
	std::unordered_map<AssetToken, ModelAsset> model;
	std::unordered_map<AssetToken, DataAsset> data;
	std::unordered_map<AssetToken, BinAsset> bin;
	std::unordered_map<AssetToken, AudioEventAsset> audioevents;

	u32 cartridgeBoardWord = 0;
	u32 cartridgeRamByteCount = 0;

	// Project metadata
	std::string projectRootPath;
	std::optional<CartManifest> cartManifest;
	MachineManifest machine;
	std::string entryPoint;

	// ROM record access.
	ImgAsset* getImg(const AssetId& id);
	const ImgAsset* getImg(const AssetId& id) const;
	AudioAsset* getAudio(const AssetId& id);
	const AudioAsset* getAudio(const AssetId& id) const;

	ModelAsset* getModel(const AssetId& id);
	const ModelAsset* getModel(const AssetId& id) const;

	const BinValue* getData(const AssetId& id) const;

	BinAsset* getBin(const AssetId& id);
	const BinAsset* getBin(const AssetId& id) const;

	const LuaSourceAsset* getLuaModule(const AssetId& modulePath) const;
	const LuaSourceAsset* getLuaSource(const AssetId& sourcePath) const;
	const std::unordered_map<AssetToken, LuaSourceAsset>& luaSources() const;
	void insertLuaSource(LuaSourceAsset asset);

	const BinValue* getAudioEvent(const AssetId& id) const;

	// Clear all decoded ROM records.
	void clear();

	// Check if a decoded ROM record exists.
	bool hasImg(const AssetId& id) const;
	bool hasModel(const AssetId& id) const;
	bool hasData(const AssetId& id) const;
	bool hasBin(const AssetId& id) const;
	bool hasLuaModule(const AssetId& modulePath) const;
	bool hasLuaSource(const AssetId& sourcePath) const;
	bool hasAudioEvent(const AssetId& id) const;
	bool hasAnyImg() const { return !img.empty(); }

private:
	std::unordered_map<AssetToken, LuaSourceAsset> m_lua;
	std::unordered_map<AssetToken, AssetToken> m_luaSourceToModule;
};

/* ============================================================================
 * ROM loader functions
 * ============================================================================ */

// Load a cart image into RomToolingPackage, including cart metadata, machine spec, and entry point.
void loadCartRomToolingPackage(const RomImage& image,
					RomToolingPackage& romPackage,
					const char* payloadId = "cart");

// Load only the ROM package asset payload into RomToolingPackage. Does not decode cart metadata.
void loadSystemRomToolingPackage(const RomImage& image,
					RomToolingPackage& romPackage,
					const char* payloadId = "system");

} // namespace bmsx

#endif // BMSX_ROMPACK_LOADER_H
