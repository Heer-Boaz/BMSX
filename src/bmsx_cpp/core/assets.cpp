/*
 * assets.cpp - Runtime asset management implementation
 */

#include "assets.h"
#include <cstring>
#include <stdexcept>

namespace bmsx {

/* ============================================================================
 * RuntimeAssets implementation
 * ============================================================================ */

ImgAsset* RuntimeAssets::getImg(const AssetId& id) {
    auto it = img.find(id);
    return it != img.end() ? &it->second : nullptr;
}

const ImgAsset* RuntimeAssets::getImg(const AssetId& id) const {
    auto it = img.find(id);
    return it != img.end() ? &it->second : nullptr;
}

AudioAsset* RuntimeAssets::getAudio(const AssetId& id) {
    auto it = audio.find(id);
    return it != audio.end() ? &it->second : nullptr;
}

const AudioAsset* RuntimeAssets::getAudio(const AssetId& id) const {
    auto it = audio.find(id);
    return it != audio.end() ? &it->second : nullptr;
}

ModelAsset* RuntimeAssets::getModel(const AssetId& id) {
    auto it = model.find(id);
    return it != model.end() ? &it->second : nullptr;
}

const ModelAsset* RuntimeAssets::getModel(const AssetId& id) const {
    auto it = model.find(id);
    return it != model.end() ? &it->second : nullptr;
}

const std::vector<u8>* RuntimeAssets::getData(const AssetId& id) const {
    auto it = data.find(id);
    return it != data.end() ? &it->second : nullptr;
}

const AudioEventEntry* RuntimeAssets::getAudioEvent(const AssetId& id) const {
    auto it = audioevents.find(id);
    return it != audioevents.end() ? &it->second : nullptr;
}

void RuntimeAssets::clear() {
    img.clear();
    audio.clear();
    model.clear();
    data.clear();
    audioevents.clear();
    projectRootPath.clear();
    manifest = RomManifest{};
}

/* ============================================================================
 * ROM loading
 * ============================================================================ */

RomMeta parseRomMeta(const u8* buffer, size_t size) {
    if (size < 16) {
        throw std::runtime_error("ROM file too small for footer");
    }

    // Footer is last 16 bytes: 8 bytes offset + 8 bytes length (little endian)
    const u8* footer = buffer + size - 16;

    u64 metaOffset = 0;
    u64 metaLength = 0;

    // Read little-endian u64
    for (int i = 0; i < 8; i++) {
        metaOffset |= static_cast<u64>(footer[i]) << (i * 8);
    }
    for (int i = 0; i < 8; i++) {
        metaLength |= static_cast<u64>(footer[8 + i]) << (i * 8);
    }

    if (metaOffset + metaLength > size) {
        throw std::runtime_error("Invalid ROM metadata footer");
    }

    return RomMeta{
        static_cast<size_t>(metaOffset),
        static_cast<size_t>(metaOffset + metaLength)
    };
}

bool loadAssetsFromRom(const u8* buffer, size_t size, RuntimeAssets& assets) {
    // TODO: Implement full ROM parsing
    // This is a stub that needs to match the TypeScript romloader.ts

    // For now, just parse the meta to validate the ROM
    RomMeta meta = parseRomMeta(buffer, size);

    // The metadata section contains JSON with asset list
    // Parse it and load assets from the ROM buffer

    // This is where you'd:
    // 1. Decompress if needed (pako/zlib in TS)
    // 2. Parse asset list JSON
    // 3. Extract each asset from the ROM buffer
    // 4. Decode images (PNG), audio (WAV/MP3), etc.

    (void)meta;
    (void)assets;

    return true;
}

} // namespace bmsx
