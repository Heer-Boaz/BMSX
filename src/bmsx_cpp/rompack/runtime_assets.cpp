/*
 * runtime_assets.cpp - Runtime asset management implementation
 */

#include "runtime_assets.h"
#include "../serializer/binencoder.h"
#include "../emulator/program_loader.h"
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

static const BinValue* findObjectField(const BinObject& obj, const char* key);

static const BinObject& requireObject(const BinObject& obj, const char* key, const char* label) {
	auto it = obj.find(key);
	if (it == obj.end() || !it->second.isObject()) {
		throw std::runtime_error(std::string("[RuntimeAssets] ") + label + " is required.");
	}
	return it->second.asObject();
}

static i64 parseRequiredPositiveI64(const BinObject& obj, const char* key, const char* label) {
	auto it = obj.find(key);
	if (it == obj.end()) {
		throw std::runtime_error(std::string("[RuntimeAssets] ") + label + " is required.");
	}
	const double number = it->second.toNumber();
	const i64 value = static_cast<i64>(number);
	if (number != static_cast<double>(value) || value <= 0) {
		throw std::runtime_error(std::string("[RuntimeAssets] ") + label + " must be a positive integer.");
	}
	return value;
}

static void parseMachineSpecs(const BinObject& machineObj, RomManifest& manifest) {
	manifest.ufpsScaled = parseRequiredPositiveI64(machineObj, "ufps", "machine.ufps");
	const auto& specsObj = requireObject(machineObj, "specs", "machine.specs");
	const auto& cpuObj = requireObject(specsObj, "cpu", "machine.specs.cpu");
	manifest.cpuHz = parseRequiredPositiveI64(cpuObj, "cpu_freq_hz", "machine.specs.cpu.cpu_freq_hz");
	manifest.imgDecBytesPerSec = parseRequiredPositiveI64(cpuObj, "imgdec_bytes_per_sec", "machine.specs.cpu.imgdec_bytes_per_sec");
	const auto& dmaObj = requireObject(specsObj, "dma", "machine.specs.dma");
	manifest.dmaBytesPerSecIso = parseRequiredPositiveI64(dmaObj, "dma_bytes_per_sec_iso", "machine.specs.dma.dma_bytes_per_sec_iso");
	manifest.dmaBytesPerSecBulk = parseRequiredPositiveI64(dmaObj, "dma_bytes_per_sec_bulk", "machine.specs.dma.dma_bytes_per_sec_bulk");

	const BinValue* ramValue = findObjectField(specsObj, "ram");
	if (ramValue && ramValue->isObject()) {
		const auto& ramObj = ramValue->asObject();
		if (ramObj.count("ram_bytes")) {
			manifest.ramBytes = ramObj.at("ram_bytes").toI32();
		}
		if (ramObj.count("string_handle_count")) {
			manifest.stringHandleCount = ramObj.at("string_handle_count").toI32();
		}
		if (ramObj.count("string_heap_bytes")) {
			manifest.stringHeapBytes = ramObj.at("string_heap_bytes").toI32();
		}
		if (ramObj.count("asset_table_bytes")) {
			manifest.assetTableBytes = ramObj.at("asset_table_bytes").toI32();
		}
		if (ramObj.count("asset_data_bytes")) {
			manifest.assetDataBytes = ramObj.at("asset_data_bytes").toI32();
		}
	}
	const BinValue* vramValue = findObjectField(specsObj, "vram");
	if (vramValue && vramValue->isObject()) {
		const auto& vramObj = vramValue->asObject();
		if (vramObj.count("skybox_face_size")) {
			manifest.skyboxFaceSize = vramObj.at("skybox_face_size").toI32();
		}
		if (vramObj.count("skybox_face_bytes")) {
			manifest.skyboxFaceBytes = vramObj.at("skybox_face_bytes").toI32();
		}
		if (vramObj.count("atlas_slot_bytes")) {
			manifest.atlasSlotBytes = vramObj.at("atlas_slot_bytes").toI32();
		}
		if (vramObj.count("engine_atlas_slot_bytes")) {
			manifest.engineAtlasSlotBytes = vramObj.at("engine_atlas_slot_bytes").toI32();
		}
		if (vramObj.count("staging_bytes")) {
			manifest.stagingBytes = vramObj.at("staging_bytes").toI32();
		}
	}
	const BinValue* audioValue = findObjectField(specsObj, "audio");
	if (audioValue && audioValue->isObject()) {
		const auto& audioObj = audioValue->asObject();
		const BinValue* voicesValue = findObjectField(audioObj, "max_voices");
		if (voicesValue && voicesValue->isObject()) {
			const auto& voicesObj = voicesValue->asObject();
			if (voicesObj.count("sfx")) manifest.maxVoicesSfx = voicesObj.at("sfx").toI32();
			if (voicesObj.count("music")) manifest.maxVoicesMusic = voicesObj.at("music").toI32();
			if (voicesObj.count("ui")) manifest.maxVoicesUi = voicesObj.at("ui").toI32();
		}
	}
}

static constexpr u32 ROM_TOC_MAGIC = 0x434f5442; // 'BTOC' little-endian
static constexpr u32 ROM_TOC_VERSION = 2;
static constexpr u32 ROM_TOC_HEADER_SIZE = 48;
static constexpr u32 ROM_TOC_ENTRY_SIZE = 80;
static constexpr u32 ROM_TOC_INVALID_U32 = 0xffffffff;

static std::string assetTypeFromId(u32 id) {
	switch (id) {
		case 1: return "image";
		case 2: return "audio";
		case 3: return "data";
		case 4: return "atlas";
		case 5: return "romlabel";
		case 6: return "model";
		case 7: return "aem";
		case 8: return "lua";
		case 9: return "code";
		default:
			throw BMSX_RUNTIME_ERROR("Unknown asset type id: " + std::to_string(id));
	}
}

static constexpr u64 ASSET_TOKEN_OFFSET_BASIS = 0xcbf29ce484222325ull;
static constexpr u64 ASSET_TOKEN_PRIME = 0x100000001b3ull;

static std::string canonicalizeAssetId(const std::string& id) {
	std::string out;
	out.reserve(id.size());
	size_t index = 0;
	if (id.size() >= 2 && id[0] == '.' && (id[1] == '/' || id[1] == '\\')) {
		index = 2;
	}
	bool prevSlash = false;
	for (; index < id.size(); ++index) {
		unsigned char c = static_cast<unsigned char>(id[index]);
		if (c == '\\') {
			c = '/';
		}
		if (c == '/') {
			if (prevSlash) {
				continue;
			}
			prevSlash = true;
			out.push_back('/');
			continue;
		}
		prevSlash = false;
		if (c >= 'A' && c <= 'Z') {
			c = static_cast<unsigned char>(c - 'A' + 'a');
		}
		out.push_back(static_cast<char>(c));
	}
	return out;
}

static AssetToken hashAssetToken(const std::string& id) {
	const std::string canonical = canonicalizeAssetId(id);
	AssetToken hash = ASSET_TOKEN_OFFSET_BASIS;
	for (unsigned char c : canonical) {
		hash ^= static_cast<AssetToken>(c);
		hash *= ASSET_TOKEN_PRIME;
	}
	return hash;
}

static AssetToken makeAssetToken(u32 lo, u32 hi) {
	return (static_cast<AssetToken>(hi) << 32) | static_cast<AssetToken>(lo);
}

static std::optional<i32> optionalI32FromU32(u32 value) {
	if (value == ROM_TOC_INVALID_U32) {
		return std::nullopt;
	}
	return static_cast<i32>(value);
}

static std::optional<i64> optionalI64FromU64(u64 value) {
	if (value == 0) {
		return std::nullopt;
	}
	return static_cast<i64>(value);
}

static std::string readStringFromTable(const u8* table, size_t tableSize, u32 offset, u32 length) {
	if (offset == ROM_TOC_INVALID_U32 || length == 0) {
		return {};
	}
	if (static_cast<size_t>(offset) + static_cast<size_t>(length) > tableSize) {
		throw BMSX_RUNTIME_ERROR("ROM TOC string table entry out of bounds.");
	}
	return std::string(reinterpret_cast<const char*>(table + offset), static_cast<size_t>(length));
}

static void logMemSnapshot(const char* label) {
	const std::string line = memSnapshotLine(label);
	if (!line.empty()) {
		std::cerr << line << std::endl;
	}
}

static const BinValue* findObjectField(const BinObject& obj, const char* key) {
	auto it = obj.find(key);
	if (it == obj.end() || it->second.isNull()) {
		return nullptr;
	}
	return &it->second;
}

static const BinValue& requireObjectField(const BinObject& obj, const std::string& assetId, const char* key) {
	const BinValue* value = findObjectField(obj, key);
	if (!value) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' missing field '" + std::string(key) + "'.");
	}
	return *value;
}

static std::vector<f32> readF32Array(const BinValue& value, const std::string& assetId, const char* field) {
	if (value.isBinary()) {
		const auto& bin = value.asBinary();
		if (bin.size() % sizeof(f32) != 0) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' has invalid float buffer size.");
		}
		std::vector<f32> out(bin.size() / sizeof(f32));
		if (!bin.empty()) {
			std::memcpy(out.data(), bin.data(), bin.size());
		}
		return out;
	}
	if (value.isArray()) {
		const auto& arr = value.asArray();
		std::vector<f32> out;
		out.reserve(arr.size());
		for (const auto& entry : arr) {
			if (!entry.isNumber()) {
				throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' contains non-number entries.");
			}
			out.push_back(static_cast<f32>(entry.toNumber()));
		}
		return out;
	}
	throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected array or binary.");
}

static std::vector<u16> readU16Array(const BinValue& value, const std::string& assetId, const char* field) {
	if (value.isBinary()) {
		const auto& bin = value.asBinary();
		if (bin.size() % sizeof(u16) != 0) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' has invalid uint16 buffer size.");
		}
		std::vector<u16> out(bin.size() / sizeof(u16));
		if (!bin.empty()) {
			std::memcpy(out.data(), bin.data(), bin.size());
		}
		return out;
	}
	if (value.isArray()) {
		const auto& arr = value.asArray();
		std::vector<u16> out;
		out.reserve(arr.size());
		for (const auto& entry : arr) {
			if (!entry.isNumber()) {
				throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' contains non-number entries.");
			}
			out.push_back(static_cast<u16>(entry.toI32()));
		}
		return out;
	}
	throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected array or binary.");
}

static std::vector<u32> readU32Array(const BinValue& value, const std::string& assetId, const char* field) {
	if (value.isBinary()) {
		const auto& bin = value.asBinary();
		if (bin.size() % sizeof(u32) != 0) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' has invalid uint32 buffer size.");
		}
		std::vector<u32> out(bin.size() / sizeof(u32));
		if (!bin.empty()) {
			std::memcpy(out.data(), bin.data(), bin.size());
		}
		return out;
	}
	if (value.isArray()) {
		const auto& arr = value.asArray();
		std::vector<u32> out;
		out.reserve(arr.size());
		for (const auto& entry : arr) {
			if (!entry.isNumber()) {
				throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' contains non-number entries.");
			}
			out.push_back(static_cast<u32>(entry.toI32()));
		}
		return out;
	}
	throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected array or binary.");
}

static std::vector<u8> readU8Array(const BinValue& value, const std::string& assetId, const char* field) {
	if (value.isBinary()) {
		return value.asBinary();
	}
	if (value.isArray()) {
		const auto& arr = value.asArray();
		std::vector<u8> out;
		out.reserve(arr.size());
		for (const auto& entry : arr) {
			if (!entry.isNumber()) {
				throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' contains non-number entries.");
			}
			out.push_back(static_cast<u8>(entry.toI32()));
		}
		return out;
	}
	throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected array or binary.");
}

static std::vector<i32> readI32Array(const BinValue& value, const std::string& assetId, const char* field) {
	if (!value.isArray()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected array.");
	}
	const auto& arr = value.asArray();
	std::vector<i32> out;
	out.reserve(arr.size());
	for (const auto& entry : arr) {
		if (!entry.isNumber()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' contains non-number entries.");
		}
		out.push_back(entry.toI32());
	}
	return out;
}

static std::vector<std::string> readStringArray(const BinValue& value, const std::string& assetId, const char* field) {
	if (!value.isArray()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected array.");
	}
	const auto& arr = value.asArray();
	std::vector<std::string> out;
	out.reserve(arr.size());
	for (const auto& entry : arr) {
		if (!entry.isString()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' contains non-string entries.");
		}
		out.push_back(entry.asString());
	}
	return out;
}

static std::vector<std::vector<f32>> readF32ArrayList(const BinValue& value, const std::string& assetId, const char* field) {
	if (!value.isArray()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected array.");
	}
	const auto& arr = value.asArray();
	std::vector<std::vector<f32>> out;
	out.reserve(arr.size());
	for (const auto& entry : arr) {
		out.push_back(readF32Array(entry, assetId, field));
	}
	return out;
}

static std::optional<f32> readOptionalF32(const BinObject& obj, const std::string& assetId, const char* field) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	if (!value->isNumber()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected number.");
	}
	return static_cast<f32>(value->toNumber());
}

static std::optional<i32> readOptionalI32(const BinObject& obj, const std::string& assetId, const char* field) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	if (!value->isNumber()) {
		throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' field '" + std::string(field) + "' expected number.");
	}
	return value->toI32();
}

static std::optional<i64> readOptionalI64(const BinObject& obj, const std::string& assetId, const char* field) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	if (!value->isNumber()) {
		throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' field '" + std::string(field) + "' expected number.");
	}
	return static_cast<i64>(value->toNumber());
}

static std::optional<bool> readOptionalBool(const BinObject& obj, const std::string& assetId, const char* field) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	if (!value->isBool()) {
		throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' field '" + std::string(field) + "' expected bool.");
	}
	return value->asBool();
}

static std::optional<std::string> readOptionalString(const BinObject& obj, const std::string& assetId, const char* field) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	if (!value->isString()) {
		throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' field '" + std::string(field) + "' expected string.");
	}
	return value->asString();
}

static std::optional<std::array<f32, 3>> readOptionalVec3(const BinObject& obj, const std::string& assetId, const char* field) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	const std::vector<f32> data = readF32Array(*value, assetId, field);
	if (data.size() != 3) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected 3 elements.");
	}
	return std::array<f32, 3>{data[0], data[1], data[2]};
}

static std::optional<std::array<f32, 4>> readOptionalVec4(const BinObject& obj, const std::string& assetId, const char* field) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	const std::vector<f32> data = readF32Array(*value, assetId, field);
	if (data.size() != 4) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected 4 elements.");
	}
	return std::array<f32, 4>{data[0], data[1], data[2], data[3]};
}

static std::optional<std::array<f32, 16>> readOptionalMat4(const BinObject& obj, const std::string& assetId, const char* field) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	const std::vector<f32> data = readF32Array(*value, assetId, field);
	if (data.size() != 16) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected 16 elements.");
	}
	return std::array<f32, 16>{
		data[0], data[1], data[2], data[3],
		data[4], data[5], data[6], data[7],
		data[8], data[9], data[10], data[11],
		data[12], data[13], data[14], data[15]
	};
}

static std::optional<std::array<f32, 4>> readOptionalColor(const BinObject& obj, const std::string& assetId, const char* field, bool allowRgb) {
	const BinValue* value = findObjectField(obj, field);
	if (!value) {
		return std::nullopt;
	}
	std::vector<f32> data = readF32Array(*value, assetId, field);
	if (data.size() == 3 && allowRgb) {
		data.push_back(1.0f);
	}
	if (data.size() != 4) {
		const std::string expected = allowRgb ? "3 or 4" : "4";
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field '" + std::string(field) + "' expected " + expected + " elements.");
	}
	return std::array<f32, 4>{data[0], data[1], data[2], data[3]};
}

static std::vector<u32> readIndexArray(const BinValue& value, std::optional<u32>& componentType, const std::string& assetId) {
	if (!componentType.has_value()) {
		if (value.isBinary()) {
			const auto& bin = value.asBinary();
			componentType = (bin.size() % 4 == 0) ? 5125u : 5123u;
		} else if (value.isArray()) {
			componentType = value.asArray().size() > 65535 ? 5125u : 5123u;
		} else {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field 'indices' expected array or binary.");
		}
	}
	switch (componentType.value()) {
		case 5121: {
			const std::vector<u8> raw = readU8Array(value, assetId, "indices");
			std::vector<u32> out;
			out.reserve(raw.size());
			for (u8 entry : raw) {
				out.push_back(static_cast<u32>(entry));
			}
			return out;
		}
		case 5123: {
			const std::vector<u16> raw = readU16Array(value, assetId, "indices");
			std::vector<u32> out;
			out.reserve(raw.size());
			for (u16 entry : raw) {
				out.push_back(static_cast<u32>(entry));
			}
			return out;
		}
		case 5125:
			return readU32Array(value, assetId, "indices");
		default:
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field 'indices' has unsupported component type.");
	}
}

static ModelMaterial parseModelMaterial(const BinValue& value, const std::string& assetId) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' material entry is not an object.");
	}
	const auto& obj = value.asObject();
	ModelMaterial material;
	material.baseColorFactor = readOptionalColor(obj, assetId, "baseColorFactor", false);
	material.metallicFactor = readOptionalF32(obj, assetId, "metallicFactor");
	material.roughnessFactor = readOptionalF32(obj, assetId, "roughnessFactor");
	material.baseColorTexture = readOptionalI32(obj, assetId, "baseColorTexture");
	material.baseColorTexCoord = readOptionalI32(obj, assetId, "baseColorTexCoord");
	material.normalTexture = readOptionalI32(obj, assetId, "normalTexture");
	material.normalTexCoord = readOptionalI32(obj, assetId, "normalTexCoord");
	material.normalScale = readOptionalF32(obj, assetId, "normalScale");
	material.metallicRoughnessTexture = readOptionalI32(obj, assetId, "metallicRoughnessTexture");
	material.metallicRoughnessTexCoord = readOptionalI32(obj, assetId, "metallicRoughnessTexCoord");
	material.occlusionTexture = readOptionalI32(obj, assetId, "occlusionTexture");
	material.occlusionTexCoord = readOptionalI32(obj, assetId, "occlusionTexCoord");
	material.occlusionStrength = readOptionalF32(obj, assetId, "occlusionStrength");
	material.emissiveTexture = readOptionalI32(obj, assetId, "emissiveTexture");
	material.emissiveTexCoord = readOptionalI32(obj, assetId, "emissiveTexCoord");
	material.emissiveFactor = readOptionalColor(obj, assetId, "emissiveFactor", true);
	material.alphaMode = readOptionalString(obj, assetId, "alphaMode");
	material.alphaCutoff = readOptionalF32(obj, assetId, "alphaCutoff");
	material.doubleSided = readOptionalBool(obj, assetId, "doubleSided");
	material.unlit = readOptionalBool(obj, assetId, "unlit");
	return material;
}

static ModelMesh parseModelMesh(const BinValue& value, const std::string& assetId) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' mesh entry is not an object.");
	}
	const auto& obj = value.asObject();
	ModelMesh mesh;
	mesh.positions = readF32Array(requireObjectField(obj, assetId, "positions"), assetId, "positions");
	if (const BinValue* texcoords = findObjectField(obj, "texcoords")) {
		mesh.texcoords = readF32Array(*texcoords, assetId, "texcoords");
	}
	if (const BinValue* texcoords1 = findObjectField(obj, "texcoords1")) {
		mesh.texcoords1 = readF32Array(*texcoords1, assetId, "texcoords1");
	}
	if (const BinValue* normals = findObjectField(obj, "normals")) {
		mesh.normals = readF32Array(*normals, assetId, "normals");
	}
	if (const BinValue* tangents = findObjectField(obj, "tangents")) {
		mesh.tangents = readF32Array(*tangents, assetId, "tangents");
	}
	if (const BinValue* colors = findObjectField(obj, "colors")) {
		mesh.colors = readF32Array(*colors, assetId, "colors");
	}
	mesh.materialIndex = readOptionalI32(obj, assetId, "materialIndex");
	if (const BinValue* weights = findObjectField(obj, "weights")) {
		mesh.weights = readF32Array(*weights, assetId, "weights");
	}
	if (const BinValue* joints = findObjectField(obj, "jointIndices")) {
		mesh.jointIndices = readU16Array(*joints, assetId, "jointIndices");
	}
	if (const BinValue* jointWeights = findObjectField(obj, "jointWeights")) {
		mesh.jointWeights = readF32Array(*jointWeights, assetId, "jointWeights");
	}
	if (const BinValue* morphPositions = findObjectField(obj, "morphPositions")) {
		mesh.morphPositions = readF32ArrayList(*morphPositions, assetId, "morphPositions");
	}
	if (const BinValue* morphNormals = findObjectField(obj, "morphNormals")) {
		mesh.morphNormals = readF32ArrayList(*morphNormals, assetId, "morphNormals");
	}
	if (const BinValue* morphTangents = findObjectField(obj, "morphTangents")) {
		mesh.morphTangents = readF32ArrayList(*morphTangents, assetId, "morphTangents");
	}
	if (const BinValue* indexType = findObjectField(obj, "indexComponentType")) {
		if (!indexType->isNumber()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' field 'indexComponentType' expected number.");
		}
		mesh.indexComponentType = static_cast<u32>(indexType->toI32());
	}
	if (const BinValue* indices = findObjectField(obj, "indices")) {
		mesh.indices = readIndexArray(*indices, mesh.indexComponentType, assetId);
	}
	return mesh;
}

static ModelAnimationSampler parseModelAnimationSampler(const BinValue& value, const std::string& assetId) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation sampler is not an object.");
	}
	const auto& obj = value.asObject();
	ModelAnimationSampler sampler;
	const BinValue& interpolation = requireObjectField(obj, assetId, "interpolation");
	if (!interpolation.isString()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation sampler interpolation expected string.");
	}
	sampler.interpolation = interpolation.asString();
	sampler.input = readF32Array(requireObjectField(obj, assetId, "input"), assetId, "input");
	sampler.output = readF32Array(requireObjectField(obj, assetId, "output"), assetId, "output");
	return sampler;
}

static ModelAnimationChannel parseModelAnimationChannel(const BinValue& value, const std::string& assetId) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation channel is not an object.");
	}
	const auto& obj = value.asObject();
	ModelAnimationChannel channel;
	const BinValue& samplerVal = requireObjectField(obj, assetId, "sampler");
	if (!samplerVal.isNumber()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation channel sampler expected number.");
	}
	channel.sampler = samplerVal.toI32();
	const BinValue& targetVal = requireObjectField(obj, assetId, "target");
	if (!targetVal.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation channel target is not an object.");
	}
	const auto& targetObj = targetVal.asObject();
	const BinValue& pathVal = requireObjectField(targetObj, assetId, "path");
	if (!pathVal.isString()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation channel target path expected string.");
	}
	channel.target.path = pathVal.asString();
	if (const BinValue* nodeVal = findObjectField(targetObj, "node")) {
		if (!nodeVal->isNumber()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation channel target node expected number.");
		}
		channel.target.node = nodeVal->toI32();
	}
	return channel;
}

static ModelAnimation parseModelAnimation(const BinValue& value, const std::string& assetId) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation entry is not an object.");
	}
	const auto& obj = value.asObject();
	ModelAnimation animation;
	if (const BinValue* nameVal = findObjectField(obj, "name")) {
		if (!nameVal->isString()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation name expected string.");
		}
		animation.name = nameVal->asString();
	}
	const BinValue& samplersVal = requireObjectField(obj, assetId, "samplers");
	if (!samplersVal.isArray()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation samplers expected array.");
	}
	for (const auto& samplerVal : samplersVal.asArray()) {
		animation.samplers.push_back(parseModelAnimationSampler(samplerVal, assetId));
	}
	const BinValue& channelsVal = requireObjectField(obj, assetId, "channels");
	if (!channelsVal.isArray()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animation channels expected array.");
	}
	for (const auto& channelVal : channelsVal.asArray()) {
		animation.channels.push_back(parseModelAnimationChannel(channelVal, assetId));
	}
	return animation;
}

static ModelNode parseModelNode(const BinValue& value, const std::string& assetId) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' node entry is not an object.");
	}
	const auto& obj = value.asObject();
	ModelNode node;
	node.mesh = readOptionalI32(obj, assetId, "mesh");
	if (const BinValue* childrenVal = findObjectField(obj, "children")) {
		node.children = readI32Array(*childrenVal, assetId, "children");
	}
	node.translation = readOptionalVec3(obj, assetId, "translation");
	node.rotation = readOptionalVec4(obj, assetId, "rotation");
	node.scale = readOptionalVec3(obj, assetId, "scale");
	node.matrix = readOptionalMat4(obj, assetId, "matrix");
	node.skin = readOptionalI32(obj, assetId, "skin");
	if (const BinValue* weights = findObjectField(obj, "weights")) {
		node.weights = readF32Array(*weights, assetId, "weights");
	}
	node.visible = readOptionalBool(obj, assetId, "visible");
	return node;
}

static ModelScene parseModelScene(const BinValue& value, const std::string& assetId) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' scene entry is not an object.");
	}
	const auto& obj = value.asObject();
	ModelScene scene;
	if (const BinValue* nodesVal = findObjectField(obj, "nodes")) {
		scene.nodes = readI32Array(*nodesVal, assetId, "nodes");
	}
	return scene;
}

static ModelSkin parseModelSkin(const BinValue& value, const std::string& assetId) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' skin entry is not an object.");
	}
	const auto& obj = value.asObject();
	ModelSkin skin;
	const BinValue& jointsVal = requireObjectField(obj, assetId, "joints");
	skin.joints = readI32Array(jointsVal, assetId, "joints");
	if (const BinValue* matricesVal = findObjectField(obj, "inverseBindMatrices")) {
		if (!matricesVal->isArray()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' inverseBindMatrices expected array.");
		}
		for (const auto& entry : matricesVal->asArray()) {
			const std::vector<f32> data = readF32Array(entry, assetId, "inverseBindMatrices");
			if (data.size() != 16) {
				throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' inverseBindMatrices entry expected 16 elements.");
			}
			skin.inverseBindMatrices.push_back(std::array<f32, 16>{
				data[0], data[1], data[2], data[3],
				data[4], data[5], data[6], data[7],
				data[8], data[9], data[10], data[11],
				data[12], data[13], data[14], data[15]
			});
		}
	}
	return skin;
}

static void remapMaterialTextureIndex(std::optional<i32>& value, const std::vector<i32>& textures, const std::string& assetId, const char* field) {
	if (!value.has_value()) {
		return;
	}
	const i32 index = value.value();
	if (index < 0 || static_cast<size_t>(index) >= textures.size()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' material " + std::string(field) + " index out of range.");
	}
	value = textures[static_cast<size_t>(index)];
}

static ModelAsset parseModelAsset(const std::string& assetId, const BinValue& value, const u8* textureData, size_t textureSize) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' payload is not an object.");
	}
	const auto& obj = value.asObject();
	ModelAsset model;
	model.id = assetId;

	const BinValue& meshesVal = requireObjectField(obj, assetId, "meshes");
	if (!meshesVal.isArray()) {
		throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' meshes expected array.");
	}
	for (const auto& meshVal : meshesVal.asArray()) {
		model.meshes.push_back(parseModelMesh(meshVal, assetId));
	}

	if (const BinValue* materialsVal = findObjectField(obj, "materials")) {
		if (!materialsVal->isArray()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' materials expected array.");
		}
		for (const auto& matVal : materialsVal->asArray()) {
			model.materials.push_back(parseModelMaterial(matVal, assetId));
		}
	}

	if (const BinValue* animationsVal = findObjectField(obj, "animations")) {
		if (!animationsVal->isArray()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' animations expected array.");
		}
		for (const auto& animVal : animationsVal->asArray()) {
			model.animations.push_back(parseModelAnimation(animVal, assetId));
		}
	}

	if (const BinValue* nodesVal = findObjectField(obj, "nodes")) {
		if (!nodesVal->isArray()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' nodes expected array.");
		}
		for (const auto& nodeVal : nodesVal->asArray()) {
			model.nodes.push_back(parseModelNode(nodeVal, assetId));
		}
	}

	if (const BinValue* scenesVal = findObjectField(obj, "scenes")) {
		if (!scenesVal->isArray()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' scenes expected array.");
		}
		for (const auto& sceneVal : scenesVal->asArray()) {
			model.scenes.push_back(parseModelScene(sceneVal, assetId));
		}
	}

	if (const BinValue* sceneVal = findObjectField(obj, "scene")) {
		if (!sceneVal->isNumber()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' scene expected number.");
		}
		model.scene = sceneVal->toI32();
	}

	if (const BinValue* skinsVal = findObjectField(obj, "skins")) {
		if (!skinsVal->isArray()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' skins expected array.");
		}
		for (const auto& skinVal : skinsVal->asArray()) {
			model.skins.push_back(parseModelSkin(skinVal, assetId));
		}
	}

	if (const BinValue* texturesVal = findObjectField(obj, "textures")) {
		model.textures = readI32Array(*texturesVal, assetId, "textures");
	}

	if (const BinValue* imageOffsetsVal = findObjectField(obj, "imageOffsets")) {
		if (!imageOffsetsVal->isArray()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' imageOffsets expected array.");
		}
		for (const auto& entry : imageOffsetsVal->asArray()) {
			if (!entry.isObject()) {
				throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' imageOffsets entry is not an object.");
			}
			const auto& offsetObj = entry.asObject();
			const BinValue& startVal = requireObjectField(offsetObj, assetId, "start");
			const BinValue& endVal = requireObjectField(offsetObj, assetId, "end");
			if (!startVal.isNumber() || !endVal.isNumber()) {
				throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' imageOffsets expected numeric start/end.");
			}
			ModelImageOffset offset;
			offset.start = startVal.toI32();
			offset.end = endVal.toI32();
			model.imageOffsets.push_back(offset);
		}
	}

	if (const BinValue* imageBuffersVal = findObjectField(obj, "imageBuffers")) {
		if (!imageBuffersVal->isArray()) {
			throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' imageBuffers expected array.");
		}
		for (const auto& entry : imageBuffersVal->asArray()) {
			model.imageBuffers.push_back(readU8Array(entry, assetId, "imageBuffers"));
		}
	}

	if (const BinValue* imageURIsVal = findObjectField(obj, "imageURIs")) {
		model.imageURIs = readStringArray(*imageURIsVal, assetId, "imageURIs");
	}

	if (model.imageBuffers.empty() && textureData && textureSize > 0 && !model.imageOffsets.empty()) {
		for (const auto& offset : model.imageOffsets) {
			if (offset.start < 0 || offset.end < offset.start || static_cast<size_t>(offset.end) > textureSize) {
				throw BMSX_RUNTIME_ERROR("Model asset '" + assetId + "' imageOffsets out of range.");
			}
			const size_t start = static_cast<size_t>(offset.start);
			const size_t end = static_cast<size_t>(offset.end);
			std::vector<u8> slice(textureData + start, textureData + end);
			model.imageBuffers.push_back(std::move(slice));
		}
	}

	if (!model.textures.empty() && !model.materials.empty()) {
		for (auto& material : model.materials) {
			remapMaterialTextureIndex(material.baseColorTexture, model.textures, assetId, "baseColorTexture");
			remapMaterialTextureIndex(material.normalTexture, model.textures, assetId, "normalTexture");
			remapMaterialTextureIndex(material.metallicRoughnessTexture, model.textures, assetId, "metallicRoughnessTexture");
			remapMaterialTextureIndex(material.occlusionTexture, model.textures, assetId, "occlusionTexture");
			remapMaterialTextureIndex(material.emissiveTexture, model.textures, assetId, "emissiveTexture");
		}
	}

	return model;
}

/* ============================================================================
 * RuntimeAssets implementation
 * ============================================================================ */

ImgAsset* RuntimeAssets::getImg(const AssetId& id) {
	const AssetToken token = hashAssetToken(id);
	auto it = img.find(token);
	if (it != img.end()) {
		return &it->second;
	}
	if (fallback) {
		return const_cast<ImgAsset*>(fallback->getImg(id));
	}
	return nullptr;
}

const ImgAsset* RuntimeAssets::getImg(const AssetId& id) const {
	const AssetToken token = hashAssetToken(id);
	auto it = img.find(token);
	if (it != img.end()) {
		return &it->second;
	}
	return fallback ? fallback->getImg(id) : nullptr;
}

AudioAsset* RuntimeAssets::getAudio(const AssetId& id) {
	const AssetToken token = hashAssetToken(id);
	auto it = audio.find(token);
	if (it != audio.end()) {
		return &it->second;
	}
	if (fallback) {
		return const_cast<AudioAsset*>(fallback->getAudio(id));
	}
	return nullptr;
}

const AudioAsset* RuntimeAssets::getAudio(const AssetId& id) const {
	const AssetToken token = hashAssetToken(id);
	auto it = audio.find(token);
	if (it != audio.end()) {
		return &it->second;
	}
	return fallback ? fallback->getAudio(id) : nullptr;
}

ModelAsset* RuntimeAssets::getModel(const AssetId& id) {
	const AssetToken token = hashAssetToken(id);
	auto it = model.find(token);
	if (it != model.end()) {
		return &it->second;
	}
	if (fallback) {
		return const_cast<ModelAsset*>(fallback->getModel(id));
	}
	return nullptr;
}

const ModelAsset* RuntimeAssets::getModel(const AssetId& id) const {
	const AssetToken token = hashAssetToken(id);
	auto it = model.find(token);
	if (it != model.end()) {
		return &it->second;
	}
	return fallback ? fallback->getModel(id) : nullptr;
}

const BinValue* RuntimeAssets::getData(const AssetId& id) const {
	const AssetToken token = hashAssetToken(id);
	auto it = data.find(token);
	if (it != data.end()) {
		return &it->second.value;
	}
	return fallback ? fallback->getData(id) : nullptr;
}

const BinValue* RuntimeAssets::getAudioEvent(const AssetId& id) const {
	const AssetToken token = hashAssetToken(id);
	auto it = audioevents.find(token);
	if (it != audioevents.end()) {
		return &it->second.value;
	}
	return fallback ? fallback->getAudioEvent(id) : nullptr;
}

bool RuntimeAssets::hasImg(const AssetId& id) const {
	return getImg(id) != nullptr;
}

bool RuntimeAssets::hasAudio(const AssetId& id) const {
	return getAudio(id) != nullptr;
}

bool RuntimeAssets::hasModel(const AssetId& id) const {
	return getModel(id) != nullptr;
}

bool RuntimeAssets::hasData(const AssetId& id) const {
	return getData(id) != nullptr;
}

bool RuntimeAssets::hasAudioEvent(const AssetId& id) const {
	return getAudioEvent(id) != nullptr;
}

void RuntimeAssets::clear() {
	img.clear();
	audio.clear();
	model.clear();
	data.clear();
	audioevents.clear();
	atlasTextures.clear();
	programAsset.reset();
	programSymbols.reset();
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

static void assertSectionRange(size_t offset, size_t length, size_t total, const char* label) {
	if (offset + length > total) {
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

	assertSectionRange(static_cast<size_t>(header.manifestOffset), static_cast<size_t>(header.manifestLength), size, "manifest");
	assertSectionRange(static_cast<size_t>(header.tocOffset), static_cast<size_t>(header.tocLength), size, "toc");
	assertSectionRange(static_cast<size_t>(header.dataOffset), static_cast<size_t>(header.dataLength), size, "data");

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
						const AssetLoadCallbacks* callbacks,
						const char* payloadId) {
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

	// Step 3: Parse manifest from header section
	if (header.manifestLength == 0) {
		throw BMSX_RUNTIME_ERROR("ROM header is missing manifest payload.");
	}
	BinValue manifestValue = decodeBinary(romData + header.manifestOffset, header.manifestLength);
	if (!manifestValue.isObject()) {
		throw BMSX_RUNTIME_ERROR("ROM manifest payload is not an object.");
	}
	const auto& manifestObj = manifestValue.asObject();
	if (manifestObj.count("name")) assets.manifest.name = manifestObj.at("name").asString();
	if (manifestObj.count("title")) assets.manifest.title = manifestObj.at("title").asString();
	if (manifestObj.count("short_name")) assets.manifest.shortName = manifestObj.at("short_name").asString();
	if (manifestObj.count("rom_name")) assets.manifest.romName = manifestObj.at("rom_name").asString();
	if (manifestObj.count("version")) assets.manifest.version = manifestObj.at("version").asString();
	if (manifestObj.count("author")) assets.manifest.author = manifestObj.at("author").asString();
	if (manifestObj.count("description")) assets.manifest.description = manifestObj.at("description").asString();

	if (manifestObj.count("machine") && manifestObj.at("machine").isObject()) {
		const auto& machineObj = manifestObj.at("machine").asObject();
		if (machineObj.count("namespace")) assets.manifest.namespaceName = machineObj.at("namespace").asString();
		assets.manifest.canonicalization = parseCanonicalization(machineObj.at("canonicalization").asString());
		assets.canonicalization = assets.manifest.canonicalization;
		parseMachineSpecs(machineObj, assets.manifest);
		if (machineObj.count("viewport") && machineObj.at("viewport").isObject()) {
			const auto& vpObj = machineObj.at("viewport").asObject();
			if (vpObj.count("width")) assets.manifest.viewportWidth = vpObj.at("width").toI32();
			if (vpObj.count("height")) assets.manifest.viewportHeight = vpObj.at("height").toI32();
		}
	}

	if (manifestObj.count("lua") && manifestObj.at("lua").isObject()) {
		const auto& luaObj = manifestObj.at("lua").asObject();
		if (luaObj.count("entry_path")) assets.manifest.entryPoint = luaObj.at("entry_path").asString();
	}

	// Step 4: Parse runtime TOC
	const u8* tocData = romData + header.tocOffset;
	const size_t tocSize = header.tocLength;
	if (tocSize < ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM TOC is too small.");
	}
	const u32 tocMagic = readLE32(tocData + 0);
	if (tocMagic != ROM_TOC_MAGIC) {
		throw BMSX_RUNTIME_ERROR("Invalid ROM TOC magic.");
	}
	const u32 tocVersion = readLE32(tocData + 4);
	if (tocVersion != ROM_TOC_VERSION) {
		throw BMSX_RUNTIME_ERROR("Unsupported ROM TOC version.");
	}
	const u32 entryCount = readLE32(tocData + 8);
	const u32 entrySize = readLE32(tocData + 12);
	if (entrySize != ROM_TOC_ENTRY_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC entry size.");
	}
	const u32 stringTableOffset = readLE32(tocData + 16);
	const u32 stringTableLength = readLE32(tocData + 20);
	const u32 projectRootOffset = readLE32(tocData + 32);
	const u32 projectRootLength = readLE32(tocData + 36);
	const u32 tocHeaderSize = readLE32(tocData + 40);
	const u32 entryOffset = readLE32(tocData + 44);
	if (tocHeaderSize != ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC header size.");
	}
	if (entryOffset != ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC entry offset.");
	}
	const size_t entriesBytes = static_cast<size_t>(entryCount) * static_cast<size_t>(entrySize);
	const size_t expectedStringOffset = static_cast<size_t>(entryOffset) + entriesBytes;
	if (static_cast<size_t>(stringTableOffset) != expectedStringOffset) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC string table offset.");
	}

	assertSectionRange(static_cast<size_t>(entryOffset), entriesBytes, tocSize, "toc entries");
	assertSectionRange(static_cast<size_t>(stringTableOffset), static_cast<size_t>(stringTableLength), tocSize, "toc string table");

	const u8* stringTable = tocData + stringTableOffset;
	const size_t stringTableSize = stringTableLength;
	const std::string projectRootPath = readStringFromTable(stringTable, stringTableSize, projectRootOffset, projectRootLength);
	if (!projectRootPath.empty()) {
		assets.projectRootPath = projectRootPath;
	}

	// Step 5: Load assets
	if (entryCount == 0) {
		return true;
	}

	logMemSnapshot("assets:begin");
	std::cerr << "[BMSX] Loading " << entryCount << " assets from ROM" << std::endl;

	for (u32 index = 0; index < entryCount; index += 1) {
		const u8* entry = tocData + entryOffset + (index * entrySize);
		const u32 tokenLo = readLE32(entry + 0);
		const u32 tokenHi = readLE32(entry + 4);
		const AssetToken assetToken = makeAssetToken(tokenLo, tokenHi);
		const u32 typeId = readLE32(entry + 8);
		const u32 opId = readLE32(entry + 12);
		const u32 residOffset = readLE32(entry + 16);
		const u32 residLength = readLE32(entry + 20);
		const u32 sourceOffset = readLE32(entry + 24);
		const u32 sourceLength = readLE32(entry + 28);
		const u32 normalizedOffset = readLE32(entry + 32);
		const u32 normalizedLength = readLE32(entry + 36);
		const u32 bufStartRaw = readLE32(entry + 40);
		const u32 bufEndRaw = readLE32(entry + 44);
		const u32 compiledStartRaw = readLE32(entry + 48);
		const u32 compiledEndRaw = readLE32(entry + 52);
		const u32 metaBufStartRaw = readLE32(entry + 56);
		const u32 metaBufEndRaw = readLE32(entry + 60);
		const u32 textureBufStartRaw = readLE32(entry + 64);
		const u32 textureBufEndRaw = readLE32(entry + 68);
		const u32 updateLo = readLE32(entry + 72);
		const u32 updateHi = readLE32(entry + 76);

		const std::string assetId = readStringFromTable(stringTable, stringTableSize, residOffset, residLength);
		if (assetId.empty()) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry missing asset id.");
		}
		const AssetToken expectedToken = hashAssetToken(assetId);
		if (expectedToken != assetToken) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry token mismatch for asset '" + assetId + "'.");
		}
		const std::string assetType = assetTypeFromId(typeId);

		RomAssetInfo romInfo;
		romInfo.type = assetType;
		if (opId == 1) {
			romInfo.op = std::string("delete");
		}
		romInfo.start = optionalI32FromU32(bufStartRaw);
		romInfo.end = optionalI32FromU32(bufEndRaw);
		romInfo.compiledStart = optionalI32FromU32(compiledStartRaw);
		romInfo.compiledEnd = optionalI32FromU32(compiledEndRaw);
		romInfo.metabufferStart = optionalI32FromU32(metaBufStartRaw);
		romInfo.metabufferEnd = optionalI32FromU32(metaBufEndRaw);
		romInfo.textureStart = optionalI32FromU32(textureBufStartRaw);
		romInfo.textureEnd = optionalI32FromU32(textureBufEndRaw);
		const std::string sourcePath = readStringFromTable(stringTable, stringTableSize, sourceOffset, sourceLength);
		if (!sourcePath.empty()) {
			romInfo.sourcePath = sourcePath;
		}
		const std::string normalizedSourcePath = readStringFromTable(stringTable, stringTableSize, normalizedOffset, normalizedLength);
		if (!normalizedSourcePath.empty()) {
			romInfo.normalizedSourcePath = normalizedSourcePath;
		}
		const u64 updateTimestampRaw = (static_cast<u64>(updateHi) << 32) | updateLo;
		romInfo.updateTimestamp = optionalI64FromU64(updateTimestampRaw);
		if (payloadId && payloadId[0] != '\0') {
			romInfo.payloadId = std::string(payloadId);
		}

		const i32 bufStart = romInfo.start ? *romInfo.start : -1;
		const i32 bufEnd = romInfo.end ? *romInfo.end : -1;
		const i32 metaBufStart = romInfo.metabufferStart ? *romInfo.metabufferStart : -1;
		const i32 metaBufEnd = romInfo.metabufferEnd ? *romInfo.metabufferEnd : -1;
		const i32 textureBufStart = romInfo.textureStart ? *romInfo.textureStart : -1;
		const i32 textureBufEnd = romInfo.textureEnd ? *romInfo.textureEnd : -1;

		if (assetType == "image" || assetType == "atlas") {
			ImgAsset imgAsset;
			imgAsset.id = assetId;
			imgAsset.rom = romInfo;

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

					if (imgMeta.count("centerpoint")) {
						const auto center = readF32Array(imgMeta.at("centerpoint"), assetId, "centerpoint");
						if (center.size() < 2) {
							throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' field 'centerpoint' expected 2 elements.");
						}
						imgAsset.meta.centerX = center[0];
						imgAsset.meta.centerY = center[1];
						imgAsset.meta.hasCenterpoint = true;
					}

					if (imgMeta.count("hitpolygons") && imgMeta.at("hitpolygons").isObject()) {
						const auto& hpObj = imgMeta.at("hitpolygons").asObject();
						if (!hpObj.count("original") || !hpObj.count("fliph") || !hpObj.count("flipv") || !hpObj.count("fliphv")) {
							throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' field 'hitpolygons' expected original/fliph/flipv/fliphv.");
						}
						ImgMeta::HitPolygons hitpolygons{};
						hitpolygons.original = readF32ArrayList(hpObj.at("original"), assetId, "hitpolygons.original");
						hitpolygons.fliph = readF32ArrayList(hpObj.at("fliph"), assetId, "hitpolygons.fliph");
						hitpolygons.flipv = readF32ArrayList(hpObj.at("flipv"), assetId, "hitpolygons.flipv");
						hitpolygons.fliphv = readF32ArrayList(hpObj.at("fliphv"), assetId, "hitpolygons.fliphv");
						imgAsset.meta.hitpolygons = std::move(hitpolygons);
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
			assets.img[assetToken] = std::move(imgAsset);
		}
		else if (assetType == "audio") {
			AudioAsset audioAsset;
			audioAsset.id = assetId;
			audioAsset.rom = romInfo;

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

			assets.audio[assetToken] = std::move(audioAsset);
		}
		else if (assetType == "model") {
			if (bufStart < 0 || bufEnd <= bufStart) {
				throw BMSX_RUNTIME_ERROR("Model asset missing payload: " + assetId);
			}
			const u8* modelData = romData + bufStart;
			const size_t modelSize = static_cast<size_t>(bufEnd - bufStart);
			BinValue modelValue = decodeBinary(modelData, modelSize);
			const u8* textureData = nullptr;
			size_t textureSize = 0;
			if (textureBufStart >= 0 && textureBufEnd > textureBufStart) {
				textureData = romData + textureBufStart;
				textureSize = static_cast<size_t>(textureBufEnd - textureBufStart);
			}
			ModelAsset modelAsset = parseModelAsset(assetId, modelValue, textureData, textureSize);
			assets.model[assetToken] = std::move(modelAsset);
		}
		else if (assetType == "aem") {
			if (bufStart < 0 || bufEnd <= bufStart) {
				throw BMSX_RUNTIME_ERROR("Audio event asset missing payload: " + assetId);
			}
			BinValue audioEvents = decodeBinary(romData + bufStart, bufEnd - bufStart);
			AudioEventAsset audioEventAsset;
			audioEventAsset.id = assetId;
			audioEventAsset.rom = romInfo;
			audioEventAsset.value = std::move(audioEvents);
			assets.audioevents[assetToken] = std::move(audioEventAsset);
		}
		else if (assetType == "data") {
			std::cerr << "[BMSX] Data asset found: id='" << assetId << "' bufStart=" << bufStart << " bufEnd=" << bufEnd << std::endl;
			if (bufStart >= 0 && bufEnd > bufStart) {
				// Check if this is the program asset
				if (assetId == PROGRAM_ASSET_ID) {
					std::cerr << "[BMSX] Loading program asset (" << (bufEnd - bufStart) << " bytes)" << std::endl;
					try {
						// Load pre-compiled Lua bytecode program
						assets.programAsset = ProgramLoader::load(romData + bufStart, bufEnd - bufStart);
						if (assets.programAsset) {
							std::cerr << "[BMSX] Program loaded successfully!" << std::endl;
						} else {
							std::cerr << "[BMSX] Program load returned nullptr!" << std::endl;
						}
					} catch (const std::exception& e) {
						std::cerr << "[BMSX] Program load FAILED: " << e.what() << std::endl;
					}
				} else if (assetId == PROGRAM_SYMBOLS_ASSET_ID) {
					std::cerr << "[BMSX] Loading program symbols asset (" << (bufEnd - bufStart) << " bytes)" << std::endl;
					try {
						assets.programSymbols = ProgramLoader::loadSymbols(romData + bufStart, bufEnd - bufStart);
						if (assets.programSymbols) {
							std::cerr << "[BMSX] Program symbols loaded successfully!" << std::endl;
						} else {
							std::cerr << "[BMSX] Program symbols load returned nullptr!" << std::endl;
						}
					} catch (const std::exception& e) {
						std::cerr << "[BMSX] Program symbols load FAILED: " << e.what() << std::endl;
					}
				} else {
					BinValue dataValue = decodeBinary(romData + bufStart, bufEnd - bufStart);
					DataAsset dataAsset;
					dataAsset.id = assetId;
					dataAsset.rom = romInfo;
					dataAsset.value = std::move(dataValue);
					assets.data[assetToken] = std::move(dataAsset);
				}
			}
		}
	}

	if (!assets.programAsset && assets.programSymbols) {
		throw BMSX_RUNTIME_ERROR("Program symbols asset requires the program asset.");
	}

	logMemSnapshot("assets:end");
	return true;
}

} // namespace bmsx
