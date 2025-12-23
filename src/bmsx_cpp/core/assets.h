/*
 * assets.h - Runtime asset management for BMSX
 *
 * This mirrors the TypeScript RuntimeAssets structure where:
 * - img: Image/texture assets
 * - audio: Audio assets
 * - model: 3D model assets
 * - data: Generic data assets (JSON, etc.)
 * - audioevents: Audio event definitions
 */

#ifndef BMSX_ASSETS_H
#define BMSX_ASSETS_H

#include "types.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <memory>
#include <optional>

namespace bmsx {

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
    i32 atlasX = 0;       // Position in atlas
    i32 atlasY = 0;
    std::string atlasId;  // Which atlas this image belongs to
    bool isAtlased = false;

    // Bounding box (for sprites with transparency)
    i32 bbX = 0;
    i32 bbY = 0;
    i32 bbWidth = 0;
    i32 bbHeight = 0;

    // UV coordinates (normalized 0-1)
    f32 u0 = 0.0f;
    f32 v0 = 0.0f;
    f32 u1 = 1.0f;
    f32 v1 = 1.0f;
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
    u32 textureHandle = 0;
    bool uploaded = false;
};

/* ============================================================================
 * Audio metadata
 * ============================================================================ */

struct AudioMeta {
    f32 duration = 0.0f;      // Duration in seconds
    i32 sampleRate = 44100;
    i32 channels = 2;
    bool isMusic = false;
    f32 loopStart = 0.0f;     // Loop point start (seconds)
    f32 loopEnd = 0.0f;       // Loop point end (0 = no loop)
};

/* ============================================================================
 * Audio asset
 * ============================================================================ */

struct AudioAsset {
    AssetId id;
    AudioMeta meta;

    // Decoded PCM data (16-bit signed, interleaved)
    std::vector<i16> samples;
};

/* ============================================================================
 * Audio event entry
 * ============================================================================ */

struct AudioEventEntry {
    AssetId id;
    AudioId audioId;        // Reference to AudioAsset
    f32 volume = 1.0f;
    f32 pitch = 1.0f;
    bool loop = false;
    std::string category;   // "sfx", "music", "voice", etc.
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

    i32 viewportWidth = 256;
    i32 viewportHeight = 224;

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
    std::unordered_map<AssetId, std::vector<u8>> data;  // Generic binary data
    std::unordered_map<AssetId, AudioEventEntry> audioevents;

    // Project metadata
    std::string projectRootPath;
    RomManifest manifest;

    // Asset access
    ImgAsset* getImg(const AssetId& id);
    const ImgAsset* getImg(const AssetId& id) const;

    AudioAsset* getAudio(const AssetId& id);
    const AudioAsset* getAudio(const AssetId& id) const;

    ModelAsset* getModel(const AssetId& id);
    const ModelAsset* getModel(const AssetId& id) const;

    const std::vector<u8>* getData(const AssetId& id) const;

    const AudioEventEntry* getAudioEvent(const AssetId& id) const;

    // Clear all assets
    void clear();

    // Check if asset exists
    bool hasImg(const AssetId& id) const { return img.find(id) != img.end(); }
    bool hasAudio(const AssetId& id) const { return audio.find(id) != audio.end(); }
    bool hasModel(const AssetId& id) const { return model.find(id) != model.end(); }
    bool hasData(const AssetId& id) const { return data.find(id) != data.end(); }
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
