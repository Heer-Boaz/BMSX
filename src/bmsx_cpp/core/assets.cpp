/*
 * assets.cpp - Runtime asset management implementation
 */

#include "assets.h"
#include "binencoder.h"
#include "../vm/program_loader.h"
#include "../utils/mem_snapshot.h"
#include <cstring>
#include <stdexcept>
#if BMSX_ENABLE_ZLIB
#include <zlib.h>
#endif
#include <iostream>

// stb_image for PNG decoding
#include "../vendor/stb_image.h"

namespace bmsx {

static void updateFlippedTexcoords(ImgMeta& meta) {
	const f32 left = meta.texcoords[0];
	const f32 top = meta.texcoords[1];
	const f32 bottom = meta.texcoords[3];
	const f32 right = meta.texcoords[4];

	meta.texcoords_fliph = {right, top, right, bottom, left, top, left, top, right, bottom, left, bottom};
	meta.texcoords_flipv = {left, bottom, left, top, right, bottom, right, bottom, left, top, right, top};
	meta.texcoords_fliphv = {right, bottom, right, top, left, bottom, left, bottom, right, top, left, top};
}

static CanonicalizationType parseCanonicalization(const std::string& value) {
	if (value == "none") return CanonicalizationType::None;
	if (value == "upper") return CanonicalizationType::Upper;
	if (value == "lower") return CanonicalizationType::Lower;
	throw BMSX_RUNTIME_ERROR("Unknown canonicalization value: " + value);
}

static void logMemSnapshot(const char* label) {
	const std::string line = memSnapshotLine(label);
	if (!line.empty()) {
		std::cerr << line << std::endl;
	}
}

/* ============================================================================
 * RuntimeAssets implementation
 * ============================================================================ */

ImgAsset* RuntimeAssets::getImg(const AssetId& id) {
	auto it = img.find(id);
	if (it != img.end()) {
		return &it->second;
	}
	if (fallback) {
		return const_cast<ImgAsset*>(fallback->getImg(id));
	}
	return nullptr;
}

const ImgAsset* RuntimeAssets::getImg(const AssetId& id) const {
	auto it = img.find(id);
	if (it != img.end()) {
		return &it->second;
	}
	return fallback ? fallback->getImg(id) : nullptr;
}

AudioAsset* RuntimeAssets::getAudio(const AssetId& id) {
	auto it = audio.find(id);
	if (it != audio.end()) {
		return &it->second;
	}
	if (fallback) {
		return const_cast<AudioAsset*>(fallback->getAudio(id));
	}
	return nullptr;
}

const AudioAsset* RuntimeAssets::getAudio(const AssetId& id) const {
	auto it = audio.find(id);
	if (it != audio.end()) {
		return &it->second;
	}
	return fallback ? fallback->getAudio(id) : nullptr;
}

ModelAsset* RuntimeAssets::getModel(const AssetId& id) {
	auto it = model.find(id);
	if (it != model.end()) {
		return &it->second;
	}
	if (fallback) {
		return const_cast<ModelAsset*>(fallback->getModel(id));
	}
	return nullptr;
}

const ModelAsset* RuntimeAssets::getModel(const AssetId& id) const {
	auto it = model.find(id);
	if (it != model.end()) {
		return &it->second;
	}
	return fallback ? fallback->getModel(id) : nullptr;
}

const BinValue* RuntimeAssets::getData(const AssetId& id) const {
	auto it = data.find(id);
	if (it != data.end()) {
		return &it->second;
	}
	return fallback ? fallback->getData(id) : nullptr;
}

const BinValue* RuntimeAssets::getAudioEvent(const AssetId& id) const {
	auto it = audioevents.find(id);
	if (it != audioevents.end()) {
		return &it->second;
	}
	return fallback ? fallback->getAudioEvent(id) : nullptr;
}

void RuntimeAssets::clear() {
	img.clear();
	audio.clear();
	model.clear();
	data.clear();
	audioevents.clear();
	atlasTextures.clear();
	vmProgram.reset();
	vmProgramSymbols.reset();
	projectRootPath.clear();
	manifest = RomManifest{};
	canonicalization = CanonicalizationType::None;
	fallback = nullptr;
}

/* ============================================================================
 * ROM loading
 * ============================================================================ */

struct CartRomHeader {
	u32 headerSize = 0;
	u32 manifestOffset = 0;
	u32 manifestLength = 0;
	u32 tocOffset = 0;
	u32 tocLength = 0;
	u32 dataOffset = 0;
	u32 dataLength = 0;
};

static constexpr u8 CART_ROM_MAGIC[4] = { 0x42, 0x4d, 0x53, 0x58 };
static constexpr size_t CART_ROM_HEADER_SIZE = 32;

static u32 readLE32(const u8* data);

static bool hasCartHeader(const u8* data, size_t size) {
	if (size < CART_ROM_HEADER_SIZE) {
		return false;
	}
	if (std::memcmp(data, CART_ROM_MAGIC, sizeof(CART_ROM_MAGIC)) != 0) {
		return false;
	}
	const u32 headerSize = readLE32(data + 4);
	return headerSize >= CART_ROM_HEADER_SIZE && headerSize <= size;
}

static void assertSectionRange(u32 offset, u32 length, size_t total, const char* label) {
	if (static_cast<size_t>(offset) + static_cast<size_t>(length) > total) {
		throw BMSX_RUNTIME_ERROR(std::string("Invalid ROM ") + label + " range.");
	}
}

static CartRomHeader parseCartHeader(const u8* data, size_t size) {
	if (size < CART_ROM_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM payload is too small for cart header.");
	}
	if (std::memcmp(data, CART_ROM_MAGIC, sizeof(CART_ROM_MAGIC)) != 0) {
		throw BMSX_RUNTIME_ERROR("Invalid ROM cart header.");
	}
	CartRomHeader header{};
	header.headerSize = readLE32(data + 4);
	if (header.headerSize < CART_ROM_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM header size is too small.");
	}
	if (header.headerSize > size) {
		throw BMSX_RUNTIME_ERROR("ROM header size exceeds payload length.");
	}
	header.manifestOffset = readLE32(data + 8);
	header.manifestLength = readLE32(data + 12);
	header.tocOffset = readLE32(data + 16);
	header.tocLength = readLE32(data + 20);
	header.dataOffset = readLE32(data + 24);
	header.dataLength = readLE32(data + 28);

	assertSectionRange(header.manifestOffset, header.manifestLength, size, "manifest");
	assertSectionRange(header.tocOffset, header.tocLength, size, "toc");
	assertSectionRange(header.dataOffset, header.dataLength, size, "data");

	return header;
}

// Check if buffer has PNG signature
static bool isPNG(const u8* data, size_t size) {
	if (size < 8) return false;
	return data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 &&
		   data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A;
}

// Find end of PNG file (returns size of PNG, or 0 if not valid)
static size_t findPNGEnd(const u8* data, size_t size) {
	if (!isPNG(data, size)) return 0;

	size_t pos = 8;
	while (pos + 8 <= size) {
		u32 len = (data[pos] << 24) | (data[pos+1] << 16) | (data[pos+2] << 8) | data[pos+3];
		pos += 4;
		u32 type = (data[pos] << 24) | (data[pos+1] << 16) | (data[pos+2] << 8) | data[pos+3];
		pos += 4;
		size_t chunkEnd = pos + len + 4;  // +4 for CRC
		if (chunkEnd > size) return 0;
		if (type == 0x49454E44) {  // IEND
			return chunkEnd;
		}
		pos = chunkEnd;
	}
	return 0;
}

static bool looksZlibCompressed(const u8* data, size_t size) {
	if (size < 2) return false;
	if (data[0] == 0x1F && data[1] == 0x8B) {
		return true;
	}
	if (data[0] == 0x78) {
		const u32 cmf = data[0];
		const u32 flg = data[1];
		return ((cmf << 8) + flg) % 31 == 0;
	}
	return false;
}

static u16 readLE16(const u8* data) {
	return static_cast<u16>(data[0]) | (static_cast<u16>(data[1]) << 8);
}

static u32 readLE32(const u8* data) {
	return static_cast<u32>(data[0])
		| (static_cast<u32>(data[1]) << 8)
		| (static_cast<u32>(data[2]) << 16)
		| (static_cast<u32>(data[3]) << 24);
}

struct WavInfo {
	i32 channels = 0;
	i32 sampleRate = 0;
	i32 bitsPerSample = 0;
	const u8* data = nullptr;
	size_t dataSize = 0;
};

static WavInfo parseWav(const u8* data, size_t size) {
	if (size < 12) {
		throw BMSX_RUNTIME_ERROR("WAV data too small");
	}
	if (std::memcmp(data, "RIFF", 4) != 0 || std::memcmp(data + 8, "WAVE", 4) != 0) {
		throw BMSX_RUNTIME_ERROR("Invalid WAV header");
	}

	size_t pos = 12;
	bool hasFmt = false;
	bool hasData = false;
	WavInfo info;
	u16 audioFormat = 0;

	while (pos + 8 <= size) {
		const u8* chunkId = data + pos;
		const u32 chunkSize = readLE32(data + pos + 4);
		pos += 8;
		size_t chunkEnd = pos + chunkSize;
		if (chunkEnd > size) {
			throw BMSX_RUNTIME_ERROR("Invalid WAV chunk size");
		}

		if (std::memcmp(chunkId, "fmt ", 4) == 0) {
			if (chunkSize < 16) {
				throw BMSX_RUNTIME_ERROR("Invalid WAV fmt chunk size");
			}
			audioFormat = readLE16(data + pos);
			info.channels = static_cast<i32>(readLE16(data + pos + 2));
			info.sampleRate = static_cast<i32>(readLE32(data + pos + 4));
			info.bitsPerSample = static_cast<i32>(readLE16(data + pos + 14));
			hasFmt = true;
		} else if (std::memcmp(chunkId, "data", 4) == 0) {
			info.data = data + pos;
			info.dataSize = chunkSize;
			hasData = true;
		}

		pos = chunkEnd;
		if ((chunkSize & 1) != 0) {
			pos += 1;
		}
	}

	if (!hasFmt || !hasData) {
		throw BMSX_RUNTIME_ERROR("WAV file missing fmt or data chunk");
	}
	if (audioFormat != 1) {
		throw BMSX_RUNTIME_ERROR("Unsupported WAV encoding (expected PCM)");
	}
	if (info.bitsPerSample != 16 && info.bitsPerSample != 8) {
		throw BMSX_RUNTIME_ERROR("Unsupported WAV bit depth");
	}
	if (info.channels <= 0 || info.sampleRate <= 0) {
		throw BMSX_RUNTIME_ERROR("Invalid WAV channels or sample rate");
	}

	return info;
}

// Decompress zlib data
#if BMSX_ENABLE_ZLIB
static std::vector<u8> zlibDecompress(const u8* data, size_t size) {
	// Start with estimate of 4x compression ratio
	std::vector<u8> output(size * 4);
	uLongf outputLen = output.size();

	while (true) {
		int result = uncompress(output.data(), &outputLen, data, static_cast<uLong>(size));
		if (result == Z_OK) {
			output.resize(outputLen);
			return output;
		}
		if (result == Z_BUF_ERROR) {
			// Need more space
			output.resize(output.size() * 2);
			outputLen = output.size();
		} else {
			throw BMSX_RUNTIME_ERROR("zlib decompression failed");
		}
	}
}
#endif

bool loadAssetsFromRom(const u8* buffer,
					   size_t size,
					   RuntimeAssets& assets,
					   const AssetLoadCallbacks* callbacks) {
	assets.clear();

	// Step 1: Check for optional PNG label at start, skip it if present
	const u8* romData = buffer;
	size_t romSize = size;

	size_t pngEnd = findPNGEnd(buffer, size);
	if (pngEnd > 0) {
		const u8* candidate = buffer + pngEnd;
		const size_t candidateSize = size - pngEnd;
		if (hasCartHeader(candidate, candidateSize) || looksZlibCompressed(candidate, candidateSize)) {
			romData = candidate;
			romSize = candidateSize;
		}
	}

	// Step 2: Check if data is compressed
	std::vector<u8> decompressed;
	if (!hasCartHeader(romData, romSize)) {
		#if BMSX_ENABLE_ZLIB
		if (!looksZlibCompressed(romData, romSize)) {
			throw BMSX_RUNTIME_ERROR("ROM payload is missing cart header.");
		}
		decompressed = zlibDecompress(romData, romSize);
		#else
		throw BMSX_RUNTIME_ERROR("ROM payload is compressed but zlib support is disabled.");
		#endif
		romData = decompressed.data();
		romSize = decompressed.size();

		if (!hasCartHeader(romData, romSize)) {
			throw BMSX_RUNTIME_ERROR("Invalid ROM payload after decompression.");
		}
	}
	const CartRomHeader header = parseCartHeader(romData, romSize);

	// Step 3: Parse metadata to get asset list
	const u8* metaData = romData + header.tocOffset;
	size_t metaSize = header.tocLength;

	BinValue assetListPayload = decodeBinary(metaData, metaSize);
	if (!assetListPayload.isObject()) {
		throw BMSX_RUNTIME_ERROR("ROM asset list is not an object");
	}

	const auto& payload = assetListPayload.asObject();

	// Get project root path
	if (payload.count("projectRootPath")) {
		assets.projectRootPath = payload.at("projectRootPath").asString();
	}

	// Get manifest
	if (payload.count("manifest") && payload.at("manifest").isObject()) {
		const auto& manifestObj = payload.at("manifest").asObject();
		if (manifestObj.count("name")) assets.manifest.name = manifestObj.at("name").asString();
		if (manifestObj.count("title")) assets.manifest.title = manifestObj.at("title").asString();
		if (manifestObj.count("short_name")) assets.manifest.shortName = manifestObj.at("short_name").asString();
		if (manifestObj.count("rom_name")) assets.manifest.romName = manifestObj.at("rom_name").asString();
		if (manifestObj.count("version")) assets.manifest.version = manifestObj.at("version").asString();
		if (manifestObj.count("author")) assets.manifest.author = manifestObj.at("author").asString();
		if (manifestObj.count("description")) assets.manifest.description = manifestObj.at("description").asString();

		if (manifestObj.count("vm") && manifestObj.at("vm").isObject()) {
			const auto& vmObj = manifestObj.at("vm").asObject();
			if (vmObj.count("namespace")) assets.manifest.namespaceName = vmObj.at("namespace").asString();
			assets.manifest.canonicalization = parseCanonicalization(vmObj.at("canonicalization").asString());
			assets.canonicalization = assets.manifest.canonicalization;
			if (vmObj.count("skybox_face_size")) {
				assets.manifest.skyboxFaceSize = vmObj.at("skybox_face_size").toI32();
			}
			if (vmObj.count("viewport") && vmObj.at("viewport").isObject()) {
				const auto& vpObj = vmObj.at("viewport").asObject();
				if (vpObj.count("width")) assets.manifest.viewportWidth = vpObj.at("width").toI32();
				if (vpObj.count("height")) assets.manifest.viewportHeight = vpObj.at("height").toI32();
			}
		}

		if (manifestObj.count("lua") && manifestObj.at("lua").isObject()) {
			const auto& luaObj = manifestObj.at("lua").asObject();
			if (luaObj.count("entry_path")) assets.manifest.entryPoint = luaObj.at("entry_path").asString();
		}
	}

	// Step 4: Load assets
	if (!payload.count("assets") || !payload.at("assets").isArray()) {
		return true;  // No assets, but valid ROM
	}

	const auto& assetArray = payload.at("assets").asArray();
	logMemSnapshot("assets:begin");
	std::cerr << "[BMSX] Loading " << assetArray.size() << " assets from ROM" << std::endl;

	for (const auto& assetValue : assetArray) {
		if (!assetValue.isObject()) continue;

		const auto& asset = assetValue.asObject();

		// ROM format uses 'resid' for asset ID, not 'id'
		std::string assetId = asset.count("resid") ? asset.at("resid").asString() : "";
		std::string assetType = asset.count("type") ? asset.at("type").asString() : "";

		// ROM format uses 'start'/'end', not 'buffer_start'/'buffer_end'
		i32 bufStart = asset.count("start") ? asset.at("start").toI32() : -1;
		i32 bufEnd = asset.count("end") ? asset.at("end").toI32() : -1;
		i32 metaBufStart = asset.count("metabuffer_start") ? asset.at("metabuffer_start").toI32() : -1;
		i32 metaBufEnd = asset.count("metabuffer_end") ? asset.at("metabuffer_end").toI32() : -1;

		if (assetType == "image" || assetType == "atlas") {
			ImgAsset imgAsset;
			imgAsset.id = assetId;

			// Load image metadata
			if (metaBufStart >= 0 && metaBufEnd > metaBufStart) {
				BinValue metaVal = decodeBinary(romData + metaBufStart, metaBufEnd - metaBufStart);
				if (metaVal.isObject()) {
					const auto& imgMeta = metaVal.asObject();
					imgAsset.meta.width = imgMeta.count("width") ? imgMeta.at("width").toI32() : 0;
					imgAsset.meta.height = imgMeta.count("height") ? imgMeta.at("height").toI32() : 0;
					imgAsset.meta.atlassed = imgMeta.count("atlassed") && imgMeta.at("atlassed").isBool() && imgMeta.at("atlassed").asBool();
					imgAsset.meta.atlasid = imgMeta.count("atlasid") ? imgMeta.at("atlasid").toI32() : 0;

					// Load texcoords
					if (imgMeta.count("texcoords")) {
						const auto& tcVal = imgMeta.at("texcoords");
						if (tcVal.isArray()) {
							const auto& tc = tcVal.asArray();
							for (size_t i = 0; i < 12; ++i) {
								imgAsset.meta.texcoords[i] = static_cast<f32>(tc.at(i).toNumber());
							}
							updateFlippedTexcoords(imgAsset.meta);
						} else if (tcVal.isBinary()) {
							const auto& tc = tcVal.asBinary();
							std::memcpy(imgAsset.meta.texcoords.data(), tc.data(), sizeof(imgAsset.meta.texcoords));
							updateFlippedTexcoords(imgAsset.meta);
						}
					}

					// Load bounding box
					if (imgMeta.count("boundingbox") && imgMeta.at("boundingbox").isObject()) {
						const auto& bbObj = imgMeta.at("boundingbox").asObject();
						if (bbObj.count("original") && bbObj.at("original").isObject()) {
							const auto& origBB = bbObj.at("original").asObject();
							imgAsset.meta.boundingbox.x = origBB.count("left") ? origBB.at("left").toI32() : 0;
							imgAsset.meta.boundingbox.y = origBB.count("top") ? origBB.at("top").toI32() : 0;
							imgAsset.meta.boundingbox.width = (origBB.count("right") ? origBB.at("right").toI32() : 0) - imgAsset.meta.boundingbox.x;
							imgAsset.meta.boundingbox.height = (origBB.count("bottom") ? origBB.at("bottom").toI32() : 0) - imgAsset.meta.boundingbox.y;
						}
					}
				}
			}

			// Load image pixel data
			if (bufStart >= 0 && bufEnd > bufStart &&
				(assetType == "atlas" || !imgAsset.meta.atlassed)) {
				const u8* imgData = romData + bufStart;
				size_t imgSize = bufEnd - bufStart;

				int width, height, channels;
				u8* pixels = stbi_load_from_memory(imgData, static_cast<int>(imgSize),
												   &width, &height, &channels, 4);  // Force RGBA

				if (pixels) {
					if (imgAsset.meta.width <= 0) {
						imgAsset.meta.width = width;
					}
					if (imgAsset.meta.height <= 0) {
						imgAsset.meta.height = height;
					}
					bool keepPixels = true;
					if (callbacks && callbacks->onImageDecoded) {
						keepPixels = callbacks->onImageDecoded(assetId, imgAsset, pixels, width, height);
					}
					if (keepPixels) {
						imgAsset.pixels.assign(pixels, pixels + width * height * 4);
					}
					stbi_image_free(pixels);
				}
			}

			// Store atlas assets as regular images (matches TypeScript runtime)
			assets.img[assetId] = std::move(imgAsset);
		}
		else if (assetType == "audio") {
			AudioAsset audioAsset;
			audioAsset.id = assetId;

			// Load audio metadata
			if (metaBufStart < 0 || metaBufEnd <= metaBufStart) {
				throw BMSX_RUNTIME_ERROR("Audio asset missing metadata: " + assetId);
			}
			BinValue metaVal = decodeBinary(romData + metaBufStart, metaBufEnd - metaBufStart);
			const auto& audioMeta = metaVal.asObject();
			audioAsset.meta.type = audioTypeFromString(audioMeta.at("audiotype").asString());
			audioAsset.meta.priority = audioMeta.at("priority").toI32();
			if (audioMeta.count("loop") && !audioMeta.at("loop").isNull()) {
				audioAsset.meta.loopStart = static_cast<f32>(audioMeta.at("loop").toNumber());
			}
			if (audioMeta.count("loopEnd") && !audioMeta.at("loopEnd").isNull()) {
				audioAsset.meta.loopEnd = static_cast<f32>(audioMeta.at("loopEnd").toNumber());
			}

			if (bufStart < 0 || bufEnd <= bufStart) {
				throw BMSX_RUNTIME_ERROR("Audio asset missing payload: " + assetId);
			}

			const u8* audioData = romData + bufStart;
			size_t audioSize = bufEnd - bufStart;
			WavInfo wav = parseWav(audioData, audioSize);
			audioAsset.sampleRate = wav.sampleRate;
			audioAsset.channels = wav.channels;
			audioAsset.bitsPerSample = wav.bitsPerSample;
			audioAsset.dataOffset = static_cast<size_t>(wav.data - audioData);
			audioAsset.dataSize = wav.dataSize;
			const size_t bytesPerSample = static_cast<size_t>(wav.bitsPerSample / 8);
			const size_t totalSamples = wav.dataSize / bytesPerSample;
			audioAsset.frames = totalSamples / static_cast<size_t>(wav.channels);
			audioAsset.bytes.assign(audioData, audioData + audioSize);

			assets.audio[assetId] = std::move(audioAsset);
		}
		else if (assetType == "aem") {
			if (bufStart < 0 || bufEnd <= bufStart) {
				throw BMSX_RUNTIME_ERROR("Audio event asset missing payload: " + assetId);
			}
			BinValue audioEvents = decodeBinary(romData + bufStart, bufEnd - bufStart);
			assets.audioevents[assetId] = std::move(audioEvents);
		}
		else if (assetType == "data") {
			std::cerr << "[BMSX] Data asset found: id='" << assetId << "' bufStart=" << bufStart << " bufEnd=" << bufEnd << std::endl;
			if (bufStart >= 0 && bufEnd > bufStart) {
				// Check if this is the VM program asset
				if (assetId == VM_PROGRAM_ASSET_ID) {
					std::cerr << "[BMSX] Loading VM program asset (" << (bufEnd - bufStart) << " bytes)" << std::endl;
					try {
						// Load pre-compiled Lua bytecode program
						assets.vmProgram = ProgramLoader::load(romData + bufStart, bufEnd - bufStart);
						if (assets.vmProgram) {
							std::cerr << "[BMSX] VM program loaded successfully!" << std::endl;
						} else {
							std::cerr << "[BMSX] VM program load returned nullptr!" << std::endl;
						}
					} catch (const std::exception& e) {
						std::cerr << "[BMSX] VM program load FAILED: " << e.what() << std::endl;
					}
				} else if (assetId == VM_PROGRAM_SYMBOLS_ASSET_ID) {
					std::cerr << "[BMSX] Loading VM program symbols asset (" << (bufEnd - bufStart) << " bytes)" << std::endl;
					try {
						assets.vmProgramSymbols = ProgramLoader::loadSymbols(romData + bufStart, bufEnd - bufStart);
						if (assets.vmProgramSymbols) {
							std::cerr << "[BMSX] VM program symbols loaded successfully!" << std::endl;
						} else {
							std::cerr << "[BMSX] VM program symbols load returned nullptr!" << std::endl;
						}
					} catch (const std::exception& e) {
						std::cerr << "[BMSX] VM program symbols load FAILED: " << e.what() << std::endl;
					}
				} else {
					BinValue dataValue = decodeBinary(romData + bufStart, bufEnd - bufStart);
					assets.data[assetId] = std::move(dataValue);
				}
			}
		}
	}

	if (!assets.vmProgram && assets.vmProgramSymbols) {
		throw BMSX_RUNTIME_ERROR("VM program symbols asset requires the program asset.");
	}

	logMemSnapshot("assets:end");
	return true;
}

} // namespace bmsx
