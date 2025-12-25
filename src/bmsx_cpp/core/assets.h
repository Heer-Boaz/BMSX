/*
 * assets.h - Runtime asset management for BMSX
 *
 * This mirrors the TypeScript RuntimeAssets structure where:
 * - img: Image/texture assets
 * - audio: Audio assets
 * - model: 3D model assets
 * - data: Generic data assets (JSON, etc.)
 * - audioevents: Audio event definitions
 * - vmProgram: Pre-compiled Lua bytecode program
 */

#ifndef BMSX_ASSETS_H
#define BMSX_ASSETS_H

#include "types.h"
#include "binencoder.h"
#include "../vm/program_loader.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <memory>
#include <optional>
#include <array>
#include <algorithm>

namespace bmsx {

// VM program asset ID (matches TypeScript VM_PROGRAM_ASSET_ID)
constexpr const char* VM_PROGRAM_ASSET_ID = "__vm_program__";

/* ============================================================================
 * Asset identifiers (string-based, like TypeScript)
 * ============================================================================ */

using AssetId = std::string;
using BitmapId = AssetId;
using AudioId = AssetId;
using ModelId = AssetId;
using DataId = AssetId;

/* ============================================================================
 * Image metadata
 * ============================================================================ */

struct ImgMeta {
    i32 width = 0;
    i32 height = 0;
    bool atlassed = false;           // Whether this image is part of an atlas
    i32 atlasid = -1;                 // Which atlas this image belongs to (0=primary, 1=secondary, 254=engine)

    // Texture coordinates for sprite rendering (matches TypeScript ImgMeta)
    // Each array is [u0, v0, u1, v1, u2, v2, u3, v3] for quad vertices
    std::array<f32, 12> texcoords{0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1};       // Normal
    std::array<f32, 12> texcoords_fliph{1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1};  // Flipped horizontal
    std::array<f32, 12> texcoords_flipv{0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0};  // Flipped vertical
    std::array<f32, 12> texcoords_fliphv{1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0}; // Flipped both

    // Bounding box (for sprites with transparency, collision)
    struct BoundingBox {
        i32 x = 0;
        i32 y = 0;
        i32 width = 0;
        i32 height = 0;
    } boundingbox;

    // Center point for rotation/positioning
    f32 centerX = 0.0f;
    f32 centerY = 0.0f;

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

    // Raw pixel data (RGBA8888)
    std::vector<u8> pixels;

    // GPU texture handle (set by renderer)
    uintptr_t textureHandle = 0;
    bool uploaded = false;
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

    // Decoded PCM data (16-bit signed, interleaved)
    std::vector<i16> samples;
    i32 sampleRate = 44100;
    i32 channels = 2;
};

/* ============================================================================
 * 3D Model (simplified GLTF-like structure)
 * ============================================================================ */

struct ModelMesh {
    std::vector<f32> positions;   // xyz interleaved
    std::vector<f32> normals;     // xyz interleaved
    std::vector<f32> uvs;         // uv interleaved
    std::vector<u32> indices;
    AssetId textureId;            // Reference to ImgAsset
};

struct ModelAsset {
    AssetId id;
    std::vector<ModelMesh> meshes;
};

/* ============================================================================
 * ROM manifest (cartridge metadata)
 * ============================================================================ */

struct RomManifest {
    std::string name;
    std::string version;
    std::string author;
    std::string description;

    i32 viewportWidth = 0;
    i32 viewportHeight = 0;
	CanonicalizationType canonicalization = CanonicalizationType::None;

    std::string entryPoint;  // Main Lua file
};

/* ============================================================================
 * RuntimeAssets - Main asset container (mirrors TypeScript RuntimeAssets)
 * ============================================================================ */

class RuntimeAssets {
public:
    RuntimeAssets() = default;
    ~RuntimeAssets() = default;

    // Asset storage
    std::unordered_map<AssetId, ImgAsset> img;
    std::unordered_map<AssetId, AudioAsset> audio;
    std::unordered_map<AssetId, ModelAsset> model;
    std::unordered_map<AssetId, BinValue> data;  // Generic decoded data assets
    std::unordered_map<AssetId, BinValue> audioevents;

    // Atlas textures (atlasid -> ImgAsset with full texture data)
    std::unordered_map<i32, ImgAsset> atlasTextures;

    // Pre-compiled VM program (loaded from __vm_program__ asset)
    std::unique_ptr<VmProgramAsset> vmProgram;

    // Project metadata
    std::string projectRootPath;
    RomManifest manifest;
	CanonicalizationType canonicalization = CanonicalizationType::None;

    // Asset access
    ImgAsset* getImg(const AssetId& id);
    const ImgAsset* getImg(const AssetId& id) const;

    AudioAsset* getAudio(const AssetId& id);
    const AudioAsset* getAudio(const AssetId& id) const;

    ModelAsset* getModel(const AssetId& id);
    const ModelAsset* getModel(const AssetId& id) const;

    const BinValue* getData(const AssetId& id) const;

    const BinValue* getAudioEvent(const AssetId& id) const;

    // Clear all assets
    void clear();

    // Check if asset exists
    bool hasImg(const AssetId& id) const { return img.find(id) != img.end(); }
    bool hasAudio(const AssetId& id) const { return audio.find(id) != audio.end(); }
    bool hasModel(const AssetId& id) const { return model.find(id) != model.end(); }
    bool hasData(const AssetId& id) const { return data.find(id) != data.end(); }
    bool hasVmProgram() const { return vmProgram != nullptr; }
};

/* ============================================================================
 * ROM loader functions
 * ============================================================================ */

// Parse ROM metadata from buffer
struct RomMeta {
    size_t start = 0;
    size_t end = 0;
};

RomMeta parseRomMeta(const u8* buffer, size_t size);

// Load assets from ROM buffer into RuntimeAssets
bool loadAssetsFromRom(const u8* buffer, size_t size, RuntimeAssets& assets);

} // namespace bmsx

#endif // BMSX_ASSETS_H
