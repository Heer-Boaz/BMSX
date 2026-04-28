/*
 * package.h - Decoded ROM package records for BMSX
 */

#ifndef BMSX_ROMPACK_PACKAGE_H
#define BMSX_ROMPACK_PACKAGE_H

#include "core/primitives.h"
#include "rompack/format.h"
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

// Program asset IDs emitted by the ROM compiler.
constexpr const char* PROGRAM_ASSET_ID = "__program__";
constexpr const char* PROGRAM_SYMBOLS_ASSET_ID = "__program_symbols__";

/* ============================================================================
 * Asset identifiers
 * ============================================================================ */

using AssetId = std::string;
using BitmapId = AssetId;
using AudioId = AssetId;
using ModelId = AssetId;
using DataId = AssetId;
using AssetToken = uint64_t;

inline AssetToken hashAssetToken(const std::string& id) {
	AssetToken hash = 0xcbf29ce484222325ull;
	for (unsigned char c : id) {
		hash ^= static_cast<AssetToken>(c);
		hash *= 0x100000001b3ull;
	}
	return hash;
}

/* ============================================================================
 * ROM asset metadata
 * ============================================================================ */

struct RomAssetInfo {
	std::string type;
	std::optional<std::string> op;
	std::optional<i32> start;
	std::optional<i32> end;
	std::optional<i32> compiledStart;
	std::optional<i32> compiledEnd;
	std::optional<i32> metabufferStart;
	std::optional<i32> metabufferEnd;
	std::optional<i32> textureStart;
	std::optional<i32> textureEnd;
	std::optional<i32> collisionBinStart;
	std::optional<i32> collisionBinEnd;
	std::optional<std::string> sourcePath;
	std::optional<std::string> normalizedSourcePath;
	std::optional<i64> updateTimestamp;
	std::optional<std::string> payloadId;
};

/* ============================================================================
 * Image metadata
 * ============================================================================ */

struct ImgMeta {
	i32 width = 0;
	i32 height = 0;
	std::optional<i32> atlasid;

	// Texture coordinates for sprite rendering.
	// Each array is [u0, v0, u1, v1, u2, v2, u3, v3] for quad vertices
	std::array<f32, 12> texcoords{0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1};       // Normal
	std::array<f32, 12> texcoords_fliph{1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1};  // Flipped horizontal
	std::array<f32, 12> texcoords_flipv{0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0};  // Flipped vertical
	std::array<f32, 12> texcoords_fliphv{1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0}; // Flipped both

	// Bounding box (for sprites with transparency, collision)
	struct BoundingRect {
		i32 x = 0;
		i32 y = 0;
		i32 width = 0;
		i32 height = 0;
	};

	struct BoundingBox {
		BoundingRect original;
		BoundingRect fliph;
		BoundingRect flipv;
		BoundingRect fliphv;
	} boundingbox;

	struct HitPolygons {
		std::vector<std::vector<f32>> original;
		std::vector<std::vector<f32>> fliph;
		std::vector<std::vector<f32>> flipv;
		std::vector<std::vector<f32>> fliphv;
	};

	// Center point for rotation/positioning
	f32 centerX = 0.0f;
	f32 centerY = 0.0f;
	bool hasCenterpoint = false;

	std::optional<HitPolygons> hitpolygons;
	std::optional<std::string> collisionBlobId;

	// Helper to get UV rect (u0, v0, u1, v1) for simple blitting
	void getUVRect(f32& u0, f32& v0, f32& u1, f32& v1, bool flipH = false, bool flipV = false) const {
		const auto& tc = flipH ? (flipV ? texcoords_fliphv : texcoords_fliph)
								: (flipV ? texcoords_flipv : texcoords);
		const f32 umin = std::min({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 umax = std::max({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 vmin = std::min({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		const f32 vmax = std::max({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		u0 = umin; v0 = vmin;
		u1 = umax; v1 = vmax;
	}
};

/* ============================================================================
 * Image asset
 * ============================================================================ */

struct ImgAsset {
	AssetId id;
	ImgMeta meta;
	RomAssetInfo rom;

	// Raw pixel data (RGBA8888)
	std::vector<u8> pixels;

	// GPU texture handle (set by renderer)
	uintptr_t textureHandle = 0;
	bool uploaded = false;
};

struct ImageAtlasRect {
	i32 atlasId = 0;
	u32 u = 0;
	u32 v = 0;
	u32 w = 0;
	u32 h = 0;
};

/* ============================================================================
 * Audio metadata
 * ============================================================================ */

enum class AudioType {
	Sfx,
	Music,
	Ui,
};

inline AudioType audioTypeFromString(const std::string& value) {
	if (value == "music") return AudioType::Music;
	if (value == "ui") return AudioType::Ui;
	return AudioType::Sfx;
}

inline const char* audioTypeToString(AudioType type) {
	switch (type) {
		case AudioType::Music: return "music";
		case AudioType::Ui: return "ui";
		case AudioType::Sfx: return "sfx";
	}
	return "sfx";
}

struct AudioMeta {
	AudioType type = AudioType::Sfx;
	i32 priority = 0;
	std::optional<f32> loopStart;
	std::optional<f32> loopEnd;
};

/* ============================================================================
 * Audio asset
 * ============================================================================ */

struct AudioAsset {
	AssetId id;
	AudioMeta meta;
	RomAssetInfo rom;
	std::vector<u8> bytes;
	i32 sampleRate = 44100;
	i32 channels = 2;
	i32 bitsPerSample = 16;
	size_t frames = 0;
	size_t dataOffset = 0;
	size_t dataSize = 0;
	std::vector<u32> badpSeekFrames;
	std::vector<u32> badpSeekOffsets;
};

/* ============================================================================
 * Data asset
 * ============================================================================ */

struct DataAsset {
	AssetId id;
	RomAssetInfo rom;
	BinValue value;
};

struct BinAsset {
	AssetId id;
	RomAssetInfo rom;
};

struct LuaSourceAsset {
	AssetId id;
	std::string path;
	std::string modulePath;
	RomAssetInfo rom;
	std::string source;
};

/* ============================================================================
 * Audio event asset
 * ============================================================================ */

struct AudioEventAsset {
	AssetId id;
	RomAssetInfo rom;
	BinValue value;
};

/* ============================================================================
 * 3D Model (GLTF-like structure)
 * ============================================================================ */

struct ModelImageOffset {
	i32 start = 0;
	i32 end = 0;
};

struct ModelMaterial {
	std::optional<std::array<f32, 4>> baseColorFactor;
	std::optional<f32> metallicFactor;
	std::optional<f32> roughnessFactor;
	std::optional<i32> baseColorTexture;
	std::optional<i32> baseColorTexCoord;
	std::optional<i32> normalTexture;
	std::optional<i32> normalTexCoord;
	std::optional<f32> normalScale;
	std::optional<i32> metallicRoughnessTexture;
	std::optional<i32> metallicRoughnessTexCoord;
	std::optional<i32> occlusionTexture;
	std::optional<i32> occlusionTexCoord;
	std::optional<f32> occlusionStrength;
	std::optional<i32> emissiveTexture;
	std::optional<i32> emissiveTexCoord;
	std::optional<std::array<f32, 4>> emissiveFactor;
	std::optional<std::string> alphaMode;
	std::optional<f32> alphaCutoff;
	std::optional<bool> doubleSided;
	std::optional<bool> unlit;
};

struct ModelAnimationSampler {
	std::string interpolation;
	std::vector<f32> input;
	std::vector<f32> output;
};

struct ModelAnimationChannelTarget {
	std::optional<i32> node;
	std::string path;
};

struct ModelAnimationChannel {
	i32 sampler = 0;
	ModelAnimationChannelTarget target;
};

struct ModelAnimation {
	std::optional<std::string> name;
	std::vector<ModelAnimationSampler> samplers;
	std::vector<ModelAnimationChannel> channels;
};

struct ModelNode {
	std::optional<i32> mesh;
	std::vector<i32> children;
	std::optional<std::array<f32, 3>> translation;
	std::optional<std::array<f32, 4>> rotation;
	std::optional<std::array<f32, 3>> scale;
	std::optional<std::array<f32, 16>> matrix;
	std::optional<i32> skin;
	std::vector<f32> weights;
	std::optional<bool> visible;
};

struct ModelScene {
	std::vector<i32> nodes;
};

struct ModelSkin {
	std::vector<i32> joints;
	std::vector<std::array<f32, 16>> inverseBindMatrices;
};

struct ModelMesh {
	std::vector<f32> positions;
	std::vector<f32> texcoords;
	std::vector<f32> texcoords1;
	std::vector<f32> normals;
	std::vector<f32> tangents;
	std::vector<u32> indices;
	std::optional<u32> indexComponentType;
	std::optional<i32> materialIndex;
	std::vector<std::vector<f32>> morphPositions;
	std::vector<std::vector<f32>> morphNormals;
	std::vector<std::vector<f32>> morphTangents;
	std::vector<f32> weights;
	std::vector<u16> jointIndices;
	std::vector<f32> jointWeights;
	std::vector<f32> colors;
};

struct ModelAsset {
	AssetId id;
	std::vector<ModelMesh> meshes;
	std::vector<ModelMaterial> materials;
	std::vector<ModelAnimation> animations;
	std::vector<ModelImageOffset> imageOffsets;
	std::vector<i32> textures;
	std::vector<ModelNode> nodes;
	std::vector<ModelScene> scenes;
	std::optional<i32> scene;
	std::vector<ModelSkin> skins;
	std::vector<std::string> imageURIs;
	std::vector<std::vector<u8>> imageBuffers;
};

/* ============================================================================
 * RuntimeRomPackage - decoded ROM package
 * ============================================================================ */

class RuntimeRomPackage {
public:
	RuntimeRomPackage() = default;
	~RuntimeRomPackage() = default;

	// Decoded ROM record storage.
	std::unordered_map<AssetToken, ImgAsset> img;
	std::unordered_map<AssetToken, AudioAsset> audio;
	std::unordered_map<AssetToken, ModelAsset> model;
	std::unordered_map<AssetToken, DataAsset> data;
	std::unordered_map<AssetToken, BinAsset> bin;
	std::unordered_map<AssetToken, LuaSourceAsset> lua;
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

	LuaSourceAsset* getLua(const AssetId& path);
	const LuaSourceAsset* getLua(const AssetId& path) const;

	const BinValue* getAudioEvent(const AssetId& id) const;

	// Clear all decoded ROM records.
	void clear();

	// Check if a decoded ROM record exists.
	bool hasImg(const AssetId& id) const;
	bool hasModel(const AssetId& id) const;
	bool hasData(const AssetId& id) const;
	bool hasBin(const AssetId& id) const;
	bool hasLua(const AssetId& path) const;
	bool hasAudioEvent(const AssetId& id) const;
	bool hasProgram() const { return programImage != nullptr; }
	bool hasAnyImg() const { return !img.empty(); }
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

ImageAtlasRect resolveImageAtlasRectFromPackage(const RuntimeRomPackage& romPackage, const std::string& imgId);

} // namespace bmsx

#endif // BMSX_ROMPACK_PACKAGE_H
