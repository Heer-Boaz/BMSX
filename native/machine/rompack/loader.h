/*
 * package.h - Decoded ROM package records for BMSX
 */

#ifndef BMSX_ROMPACK_PACKAGE_H
#define BMSX_ROMPACK_PACKAGE_H

#include "common/primitives.h"
#include "rompack/format.h"
#include "rompack/assets.h"
#include "common/serializer/binencoder.h"
#include "../machine/program/loader.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <memory>
#include <optional>
#include <array>
#include <algorithm>
#include <functional>

namespace bmsx {

constexpr i64 DEFAULT_VDP_WORK_UNITS_PER_SEC = 25'600;
constexpr i64 DEFAULT_GEO_WORK_UNITS_PER_SEC = 16'384'000;

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

	// Pre-compiled program image loaded from the ROM package.
	std::unique_ptr<ProgramImage> programImage;
	// Optional program symbols loaded from the ROM package.
	std::unique_ptr<ProgramMetadata> programSymbols;

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
	bool hasProgram() const { return programImage != nullptr; }
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

/* ============================================================================
 * ROM loader functions
 * ============================================================================ */

// Load a cart ROM into RuntimeRomPackage, including cart metadata, machine spec, and entry point.
bool loadCartRomPackageFromRom(const u8* buffer,
				size_t size,
				RuntimeRomPackage& romPackage,
				const AssetLoadCallbacks* callbacks = nullptr,
				const char* payloadId = "cart");

// Load only the ROM package/program payload into RuntimeRomPackage. Does not decode cart metadata.
bool loadSystemRomPackageFromRom(const u8* buffer,
				size_t size,
				RuntimeRomPackage& romPackage,
				const AssetLoadCallbacks* callbacks = nullptr,
				const char* payloadId = "system");

// Parse only the cart manifest (machine specs, viewport size) without loading assets.
// Equivalent to TypeScript's parseCartridgeIndex — lightweight, no asset allocation.
MachineManifest peekCartMachineManifest(const u8* buffer, size_t size);

ImageAtlasRect resolveImageAtlasRectFromPackage(const RuntimeRomPackage& romPackage, const std::string& imgId);

} // namespace bmsx

#endif // BMSX_ROMPACK_PACKAGE_H
