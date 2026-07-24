/*
 * package.h - Decoded ROM package records for BMSX
 */

#ifndef BMSX_ROMPACK_PACKAGE_H
#define BMSX_ROMPACK_PACKAGE_H

#include "common/primitives.h"
#include "machine/cpu/blua32_symbols.h"
#include "rompack/format.h"
#include "rompack/assets.h"
#include "common/serializer/binencoder.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <memory>
#include <optional>
#include <array>
#include <algorithm>
#include <functional>

namespace bmsx {

/* ============================================================================
 * RuntimeRomPackage - decoded ROM package
 * ============================================================================ */

class RuntimeRomPackage {
public:
	RuntimeRomPackage() = default;
	~RuntimeRomPackage() = default;
	RuntimeRomPackage(RuntimeRomPackage&&) = default;
	RuntimeRomPackage& operator=(RuntimeRomPackage&&) = default;

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

struct AssetLoadCallbacks {
	// Return true to keep a copy of pixel data in ImgAsset, false to skip.
	std::function<bool(const std::string& assetId,
					ImgAsset& asset,
					const u8* rgba,
					i32 width,
					i32 height)> onImageDecoded;
};

struct RomImage {
	std::span<const u8> bytes;
	CartRomHeader header;
};

/* ============================================================================
 * ROM loader functions
 * ============================================================================ */

RomImage parseRomImage(const u8* buffer, size_t size, RomImageDomain domain);
auto loadBlua32SymbolsImage(const RomImage& image) -> std::unique_ptr<Blua32SymbolsImage>;

// Load a cart image into RuntimeRomPackage, including cart metadata, machine spec, and entry point.
void loadCartRomPackage(const RomImage& image,
					RuntimeRomPackage& romPackage,
					const AssetLoadCallbacks* callbacks = nullptr,
					const char* payloadId = "cart");

// Load only the ROM package asset payload into RuntimeRomPackage. Does not decode cart metadata.
void loadSystemRomPackage(const RomImage& image,
					RuntimeRomPackage& romPackage,
					const AssetLoadCallbacks* callbacks = nullptr,
					const char* payloadId = "system");

} // namespace bmsx

#endif // BMSX_ROMPACK_PACKAGE_H
