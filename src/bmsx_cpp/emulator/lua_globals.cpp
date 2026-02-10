#include "runtime.h"
#include "api.h"
#include "number_format.h"
#include "../core/engine_core.h"
#include "../rompack/rompack.h"
#include "../rompack/runtime_assets.h"
#include "../serializer/binencoder.h"
#include "../input/input.h"
#include "../utils/clamp.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cctype>
#include <cstring>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <limits>
#include <regex>
#include <sstream>

namespace bmsx {
namespace {
inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}

constexpr uint32_t CART_ROM_MAGIC = 0x58534D42u;

size_t utf8_next_index(const std::string& text, size_t index) {
	unsigned char c0 = static_cast<unsigned char>(text[index]);
	if (c0 < 0x80) {
		return index + 1;
	}
	if ((c0 & 0xE0) == 0xC0) {
		return index + 2;
	}
	if ((c0 & 0xF0) == 0xE0) {
		return index + 3;
	}
	return index + 4;
}

size_t utf8_byte_index_from_codepoint(const std::string& text, int codepointIndex) {
	if (codepointIndex <= 1) {
		return 0;
	}
	size_t index = 0;
	int current = 1;
	while (index < text.size()) {
		if (current == codepointIndex) {
			return index;
		}
		index = utf8_next_index(text, index);
		current += 1;
	}
	return index;
}

int utf8_codepoint_index_from_byte(const std::string& text, size_t byteIndex) {
	size_t index = 0;
	int current = 1;
	while (index < text.size()) {
		if (index >= byteIndex) {
			return current;
		}
		index = utf8_next_index(text, index);
		current += 1;
	}
	return current;
}

uint32_t utf8_codepoint_at(const std::string& text, size_t index) {
	unsigned char c0 = static_cast<unsigned char>(text[index]);
	if (c0 < 0x80) {
		return c0;
	}
	if ((c0 & 0xE0) == 0xC0) {
		unsigned char c1 = static_cast<unsigned char>(text[index + 1]);
		return ((c0 & 0x1F) << 6) | (c1 & 0x3F);
	}
	if ((c0 & 0xF0) == 0xE0) {
		unsigned char c1 = static_cast<unsigned char>(text[index + 1]);
		unsigned char c2 = static_cast<unsigned char>(text[index + 2]);
		return ((c0 & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
	}
	unsigned char c1 = static_cast<unsigned char>(text[index + 1]);
	unsigned char c2 = static_cast<unsigned char>(text[index + 2]);
	unsigned char c3 = static_cast<unsigned char>(text[index + 3]);
	return ((c0 & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
}

void utf8_append_codepoint(std::string& out, uint32_t codepoint) {
	if (codepoint <= 0x7F) {
		out.push_back(static_cast<char>(codepoint));
		return;
	}
	if (codepoint <= 0x7FF) {
		out.push_back(static_cast<char>(0xC0 | ((codepoint >> 6) & 0x1F)));
		out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
		return;
	}
	if (codepoint <= 0xFFFF) {
		out.push_back(static_cast<char>(0xE0 | ((codepoint >> 12) & 0x0F)));
		out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
		out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
		return;
	}
	out.push_back(static_cast<char>(0xF0 | ((codepoint >> 18) & 0x07)));
	out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
	out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
	out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
}

std::string utf8_to_upper(const std::string& text) {
	std::string out;
	out.reserve(text.size());
	size_t index = 0;
	while (index < text.size()) {
		uint32_t codepoint = utf8_codepoint_at(text, index);
		if (codepoint < 0x80) {
			char c = static_cast<char>(codepoint);
			char mapped = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
			out.push_back(mapped);
		} else {
			utf8_append_codepoint(out, codepoint);
		}
		index = utf8_next_index(text, index);
	}
	return out;
}

std::string utf8_to_lower(const std::string& text) {
	std::string out;
	out.reserve(text.size());
	size_t index = 0;
	while (index < text.size()) {
		uint32_t codepoint = utf8_codepoint_at(text, index);
		if (codepoint < 0x80) {
			char c = static_cast<char>(codepoint);
			char mapped = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
			out.push_back(mapped);
		} else {
			utf8_append_codepoint(out, codepoint);
		}
		index = utf8_next_index(text, index);
	}
	return out;
}

Table* buildArrayTable(CPU& cpu, const std::array<f32, 12>& values) {
	auto* table = cpu.createTable(static_cast<int>(values.size()), 0);
	for (size_t index = 0; index < values.size(); ++index) {
		table->set(valueNumber(static_cast<double>(index + 1)), valueNumber(static_cast<double>(values[index])));
	}
	return table;
}

template <typename KeyFn>
Table* buildBoundingBoxTable(CPU& cpu, const ImgMeta& meta, const KeyFn& key) {
	auto* table = cpu.createTable(0, 4);
	const double left = static_cast<double>(meta.boundingbox.x);
	const double top = static_cast<double>(meta.boundingbox.y);
	const double right = static_cast<double>(meta.boundingbox.x + meta.boundingbox.width);
	const double bottom = static_cast<double>(meta.boundingbox.y + meta.boundingbox.height);
	const double width = static_cast<double>(meta.width);
	const double height = static_cast<double>(meta.height);

	auto* original = cpu.createTable(0, 6);
	original->set(key("left"), valueNumber(left));
	original->set(key("right"), valueNumber(right));
	original->set(key("top"), valueNumber(top));
	original->set(key("bottom"), valueNumber(bottom));
	original->set(key("width"), valueNumber(static_cast<double>(meta.boundingbox.width)));
	original->set(key("height"), valueNumber(static_cast<double>(meta.boundingbox.height)));

	auto* fliph = cpu.createTable(0, 6);
	fliph->set(key("left"), valueNumber(width - right));
	fliph->set(key("right"), valueNumber(width - left));
	fliph->set(key("top"), valueNumber(top));
	fliph->set(key("bottom"), valueNumber(bottom));
	fliph->set(key("width"), valueNumber(static_cast<double>(meta.boundingbox.width)));
	fliph->set(key("height"), valueNumber(static_cast<double>(meta.boundingbox.height)));

	auto* flipv = cpu.createTable(0, 6);
	flipv->set(key("left"), valueNumber(left));
	flipv->set(key("right"), valueNumber(right));
	flipv->set(key("top"), valueNumber(height - bottom));
	flipv->set(key("bottom"), valueNumber(height - top));
	flipv->set(key("width"), valueNumber(static_cast<double>(meta.boundingbox.width)));
	flipv->set(key("height"), valueNumber(static_cast<double>(meta.boundingbox.height)));

	auto* fliphv = cpu.createTable(0, 6);
	fliphv->set(key("left"), valueNumber(width - right));
	fliphv->set(key("right"), valueNumber(width - left));
	fliphv->set(key("top"), valueNumber(height - bottom));
	fliphv->set(key("bottom"), valueNumber(height - top));
	fliphv->set(key("width"), valueNumber(static_cast<double>(meta.boundingbox.width)));
	fliphv->set(key("height"), valueNumber(static_cast<double>(meta.boundingbox.height)));

	table->set(key("original"), valueTable(original));
	table->set(key("fliph"), valueTable(fliph));
	table->set(key("flipv"), valueTable(flipv));
	table->set(key("fliphv"), valueTable(fliphv));
	return table;
}

template <typename Container>
Table* buildNumericArrayTable(CPU& cpu, const Container& values);

template <typename T, typename BuildFn>
Table* buildTableArray(CPU& cpu, const std::vector<T>& values, const BuildFn& buildFn);

template <typename KeyFn>
Table* buildImgMetaTable(CPU& cpu, const ImgMeta& meta, const KeyFn& key) {
	auto* table = cpu.createTable(0, 12);
	table->set(key("atlassed"), valueBool(meta.atlassed));
	if (meta.atlassed) {
		table->set(key("atlasid"), valueNumber(static_cast<double>(meta.atlasid)));
	}
	table->set(key("width"), valueNumber(static_cast<double>(meta.width)));
	table->set(key("height"), valueNumber(static_cast<double>(meta.height)));
	table->set(key("texcoords"), valueTable(buildArrayTable(cpu, meta.texcoords)));
	table->set(key("texcoords_fliph"), valueTable(buildArrayTable(cpu, meta.texcoords_fliph)));
	table->set(key("texcoords_flipv"), valueTable(buildArrayTable(cpu, meta.texcoords_flipv)));
	table->set(key("texcoords_fliphv"), valueTable(buildArrayTable(cpu, meta.texcoords_fliphv)));
	table->set(key("boundingbox"), valueTable(buildBoundingBoxTable(cpu, meta, key)));

	if (meta.hasCenterpoint) {
		auto* centerpoint = cpu.createTable(2, 0);
		centerpoint->set(valueNumber(1.0), valueNumber(static_cast<double>(meta.centerX)));
		centerpoint->set(valueNumber(2.0), valueNumber(static_cast<double>(meta.centerY)));
		table->set(key("centerpoint"), valueTable(centerpoint));
	}
	if (meta.hitpolygons) {
		auto* hitTable = cpu.createTable(0, 4);
		hitTable->set(key("original"), valueTable(buildTableArray(cpu, meta.hitpolygons->original, [&cpu](const std::vector<f32>& poly) {
			return buildNumericArrayTable(cpu, poly);
		})));
		hitTable->set(key("fliph"), valueTable(buildTableArray(cpu, meta.hitpolygons->fliph, [&cpu](const std::vector<f32>& poly) {
			return buildNumericArrayTable(cpu, poly);
		})));
		hitTable->set(key("flipv"), valueTable(buildTableArray(cpu, meta.hitpolygons->flipv, [&cpu](const std::vector<f32>& poly) {
			return buildNumericArrayTable(cpu, poly);
		})));
		hitTable->set(key("fliphv"), valueTable(buildTableArray(cpu, meta.hitpolygons->fliphv, [&cpu](const std::vector<f32>& poly) {
			return buildNumericArrayTable(cpu, poly);
		})));
		table->set(key("hitpolygons"), valueTable(hitTable));
	}
	return table;
}

template <typename KeyFn>
Table* buildAudioMetaTable(CPU& cpu, const AudioMeta& meta, const KeyFn& key) {
	auto* table = cpu.createTable(0, 4);
	table->set(key("audiotype"), valueString(cpu.internString(audioTypeToString(meta.type))));
	table->set(key("priority"), valueNumber(static_cast<double>(meta.priority)));
	if (meta.loopStart) {
		table->set(key("loop"), valueNumber(static_cast<double>(*meta.loopStart)));
	}
	if (meta.loopEnd) {
		table->set(key("loopEnd"), valueNumber(static_cast<double>(*meta.loopEnd)));
	}
	return table;
}

template <typename Container>
Table* buildNumericArrayTable(CPU& cpu, const Container& values) {
	auto* table = cpu.createTable(static_cast<int>(values.size()), 0);
	for (size_t index = 0; index < values.size(); ++index) {
		table->set(valueNumber(static_cast<double>(index + 1)), valueNumber(static_cast<double>(values[index])));
	}
	return table;
}

Table* buildStringArrayTable(CPU& cpu, const std::vector<std::string>& values) {
	auto* table = cpu.createTable(static_cast<int>(values.size()), 0);
	for (size_t index = 0; index < values.size(); ++index) {
		table->set(valueNumber(static_cast<double>(index + 1)), valueString(cpu.internString(values[index])));
	}
	return table;
}

template <typename T, typename BuildFn>
Table* buildTableArray(CPU& cpu, const std::vector<T>& values, const BuildFn& buildFn) {
	auto* table = cpu.createTable(static_cast<int>(values.size()), 0);
	for (size_t index = 0; index < values.size(); ++index) {
		table->set(valueNumber(static_cast<double>(index + 1)), valueTable(buildFn(values[index])));
	}
	return table;
}

template <typename KeyFn>
Table* buildModelMaterialTable(CPU& cpu, const ModelMaterial& material, const KeyFn& key) {
	auto* table = cpu.createTable(0, 18);
	if (material.baseColorFactor) {
		table->set(key("baseColorFactor"), valueTable(buildNumericArrayTable(cpu, material.baseColorFactor.value())));
	}
	if (material.metallicFactor) {
		table->set(key("metallicFactor"), valueNumber(static_cast<double>(material.metallicFactor.value())));
	}
	if (material.roughnessFactor) {
		table->set(key("roughnessFactor"), valueNumber(static_cast<double>(material.roughnessFactor.value())));
	}
	if (material.baseColorTexture) {
		table->set(key("baseColorTexture"), valueNumber(static_cast<double>(material.baseColorTexture.value())));
	}
	if (material.baseColorTexCoord) {
		table->set(key("baseColorTexCoord"), valueNumber(static_cast<double>(material.baseColorTexCoord.value())));
	}
	if (material.normalTexture) {
		table->set(key("normalTexture"), valueNumber(static_cast<double>(material.normalTexture.value())));
	}
	if (material.normalTexCoord) {
		table->set(key("normalTexCoord"), valueNumber(static_cast<double>(material.normalTexCoord.value())));
	}
	if (material.normalScale) {
		table->set(key("normalScale"), valueNumber(static_cast<double>(material.normalScale.value())));
	}
	if (material.metallicRoughnessTexture) {
		table->set(key("metallicRoughnessTexture"), valueNumber(static_cast<double>(material.metallicRoughnessTexture.value())));
	}
	if (material.metallicRoughnessTexCoord) {
		table->set(key("metallicRoughnessTexCoord"), valueNumber(static_cast<double>(material.metallicRoughnessTexCoord.value())));
	}
	if (material.occlusionTexture) {
		table->set(key("occlusionTexture"), valueNumber(static_cast<double>(material.occlusionTexture.value())));
	}
	if (material.occlusionTexCoord) {
		table->set(key("occlusionTexCoord"), valueNumber(static_cast<double>(material.occlusionTexCoord.value())));
	}
	if (material.occlusionStrength) {
		table->set(key("occlusionStrength"), valueNumber(static_cast<double>(material.occlusionStrength.value())));
	}
	if (material.emissiveTexture) {
		table->set(key("emissiveTexture"), valueNumber(static_cast<double>(material.emissiveTexture.value())));
	}
	if (material.emissiveTexCoord) {
		table->set(key("emissiveTexCoord"), valueNumber(static_cast<double>(material.emissiveTexCoord.value())));
	}
	if (material.emissiveFactor) {
		table->set(key("emissiveFactor"), valueTable(buildNumericArrayTable(cpu, material.emissiveFactor.value())));
	}
	if (material.alphaMode) {
		table->set(key("alphaMode"), valueString(cpu.internString(material.alphaMode.value())));
	}
	if (material.alphaCutoff) {
		table->set(key("alphaCutoff"), valueNumber(static_cast<double>(material.alphaCutoff.value())));
	}
	if (material.doubleSided) {
		table->set(key("doubleSided"), valueBool(material.doubleSided.value()));
	}
	if (material.unlit) {
		table->set(key("unlit"), valueBool(material.unlit.value()));
	}
	return table;
}

template <typename KeyFn>
Table* buildModelMeshTable(CPU& cpu, const ModelMesh& mesh, const KeyFn& key) {
	auto* table = cpu.createTable(0, 14);
	table->set(key("positions"), valueTable(buildNumericArrayTable(cpu, mesh.positions)));
	if (!mesh.texcoords.empty()) {
		table->set(key("texcoords"), valueTable(buildNumericArrayTable(cpu, mesh.texcoords)));
	}
	if (!mesh.texcoords1.empty()) {
		table->set(key("texcoords1"), valueTable(buildNumericArrayTable(cpu, mesh.texcoords1)));
	}
	if (!mesh.normals.empty()) {
		table->set(key("normals"), valueTable(buildNumericArrayTable(cpu, mesh.normals)));
	}
	if (!mesh.tangents.empty()) {
		table->set(key("tangents"), valueTable(buildNumericArrayTable(cpu, mesh.tangents)));
	}
	if (!mesh.indices.empty()) {
		table->set(key("indices"), valueTable(buildNumericArrayTable(cpu, mesh.indices)));
	}
	if (mesh.indexComponentType) {
		table->set(key("indexComponentType"), valueNumber(static_cast<double>(mesh.indexComponentType.value())));
	}
	if (mesh.materialIndex) {
		table->set(key("materialIndex"), valueNumber(static_cast<double>(mesh.materialIndex.value())));
	}
	if (!mesh.morphPositions.empty()) {
		table->set(key("morphPositions"), valueTable(buildTableArray(cpu, mesh.morphPositions, [&cpu](const std::vector<f32>& values) {
			return buildNumericArrayTable(cpu, values);
		})));
	}
	if (!mesh.morphNormals.empty()) {
		table->set(key("morphNormals"), valueTable(buildTableArray(cpu, mesh.morphNormals, [&cpu](const std::vector<f32>& values) {
			return buildNumericArrayTable(cpu, values);
		})));
	}
	if (!mesh.morphTangents.empty()) {
		table->set(key("morphTangents"), valueTable(buildTableArray(cpu, mesh.morphTangents, [&cpu](const std::vector<f32>& values) {
			return buildNumericArrayTable(cpu, values);
		})));
	}
	if (!mesh.weights.empty()) {
		table->set(key("weights"), valueTable(buildNumericArrayTable(cpu, mesh.weights)));
	}
	if (!mesh.jointIndices.empty()) {
		table->set(key("jointIndices"), valueTable(buildNumericArrayTable(cpu, mesh.jointIndices)));
	}
	if (!mesh.jointWeights.empty()) {
		table->set(key("jointWeights"), valueTable(buildNumericArrayTable(cpu, mesh.jointWeights)));
	}
	if (!mesh.colors.empty()) {
		table->set(key("colors"), valueTable(buildNumericArrayTable(cpu, mesh.colors)));
	}
	return table;
}

template <typename KeyFn>
Table* buildModelAnimationSamplerTable(CPU& cpu, const ModelAnimationSampler& sampler, const KeyFn& key) {
	auto* table = cpu.createTable(0, 3);
	table->set(key("interpolation"), valueString(cpu.internString(sampler.interpolation)));
	table->set(key("input"), valueTable(buildNumericArrayTable(cpu, sampler.input)));
	table->set(key("output"), valueTable(buildNumericArrayTable(cpu, sampler.output)));
	return table;
}

template <typename KeyFn>
Table* buildModelAnimationChannelTable(CPU& cpu, const ModelAnimationChannel& channel, const KeyFn& key) {
	auto* table = cpu.createTable(0, 2);
	table->set(key("sampler"), valueNumber(static_cast<double>(channel.sampler)));
	auto* target = cpu.createTable(0, 2);
	if (channel.target.node) {
		target->set(key("node"), valueNumber(static_cast<double>(channel.target.node.value())));
	}
	target->set(key("path"), valueString(cpu.internString(channel.target.path)));
	table->set(key("target"), valueTable(target));
	return table;
}

template <typename KeyFn>
Table* buildModelAnimationTable(CPU& cpu, const ModelAnimation& animation, const KeyFn& key) {
	auto* table = cpu.createTable(0, 3);
	if (animation.name) {
		table->set(key("name"), valueString(cpu.internString(animation.name.value())));
	}
	table->set(key("samplers"), valueTable(buildTableArray(cpu, animation.samplers, [&cpu, &key](const ModelAnimationSampler& sampler) {
		return buildModelAnimationSamplerTable(cpu, sampler, key);
	})));
	table->set(key("channels"), valueTable(buildTableArray(cpu, animation.channels, [&cpu, &key](const ModelAnimationChannel& channel) {
		return buildModelAnimationChannelTable(cpu, channel, key);
	})));
	return table;
}

template <typename KeyFn>
Table* buildModelNodeTable(CPU& cpu, const ModelNode& node, const KeyFn& key) {
	auto* table = cpu.createTable(0, 8);
	if (node.mesh) {
		table->set(key("mesh"), valueNumber(static_cast<double>(node.mesh.value())));
	}
	if (!node.children.empty()) {
		table->set(key("children"), valueTable(buildNumericArrayTable(cpu, node.children)));
	}
	if (node.translation) {
		table->set(key("translation"), valueTable(buildNumericArrayTable(cpu, node.translation.value())));
	}
	if (node.rotation) {
		table->set(key("rotation"), valueTable(buildNumericArrayTable(cpu, node.rotation.value())));
	}
	if (node.scale) {
		table->set(key("scale"), valueTable(buildNumericArrayTable(cpu, node.scale.value())));
	}
	if (node.matrix) {
		table->set(key("matrix"), valueTable(buildNumericArrayTable(cpu, node.matrix.value())));
	}
	if (node.skin) {
		table->set(key("skin"), valueNumber(static_cast<double>(node.skin.value())));
	}
	if (!node.weights.empty()) {
		table->set(key("weights"), valueTable(buildNumericArrayTable(cpu, node.weights)));
	}
	if (node.visible) {
		table->set(key("visible"), valueBool(node.visible.value()));
	}
	return table;
}

template <typename KeyFn>
Table* buildModelSceneTable(CPU& cpu, const ModelScene& scene, const KeyFn& key) {
	auto* table = cpu.createTable(0, 1);
	if (!scene.nodes.empty()) {
		table->set(key("nodes"), valueTable(buildNumericArrayTable(cpu, scene.nodes)));
	}
	return table;
}

template <typename KeyFn>
Table* buildModelSkinTable(CPU& cpu, const ModelSkin& skin, const KeyFn& key) {
	auto* table = cpu.createTable(0, 2);
	table->set(key("joints"), valueTable(buildNumericArrayTable(cpu, skin.joints)));
	if (!skin.inverseBindMatrices.empty()) {
		table->set(key("inverseBindMatrices"), valueTable(buildTableArray(cpu, skin.inverseBindMatrices, [&cpu](const std::array<f32, 16>& matrix) {
			return buildNumericArrayTable(cpu, matrix);
		})));
	}
	return table;
}

template <typename KeyFn>
Table* buildModelImageOffsetTable(CPU& cpu, const ModelImageOffset& offset, const KeyFn& key) {
	auto* table = cpu.createTable(0, 2);
	table->set(key("start"), valueNumber(static_cast<double>(offset.start)));
	table->set(key("end"), valueNumber(static_cast<double>(offset.end)));
	return table;
}

template <typename KeyFn>
Table* buildModelAssetTable(CPU& cpu, const ModelAsset& asset, const KeyFn& key) {
	auto* table = cpu.createTable(0, 10);
	table->set(key("name"), valueString(cpu.internString(asset.id)));
	table->set(key("meshes"), valueTable(buildTableArray(cpu, asset.meshes, [&cpu, &key](const ModelMesh& mesh) {
		return buildModelMeshTable(cpu, mesh, key);
	})));
	if (!asset.materials.empty()) {
		table->set(key("materials"), valueTable(buildTableArray(cpu, asset.materials, [&cpu, &key](const ModelMaterial& material) {
			return buildModelMaterialTable(cpu, material, key);
		})));
	}
	if (!asset.animations.empty()) {
		table->set(key("animations"), valueTable(buildTableArray(cpu, asset.animations, [&cpu, &key](const ModelAnimation& animation) {
			return buildModelAnimationTable(cpu, animation, key);
		})));
	}
	if (!asset.imageOffsets.empty()) {
		table->set(key("imageOffsets"), valueTable(buildTableArray(cpu, asset.imageOffsets, [&cpu, &key](const ModelImageOffset& offset) {
			return buildModelImageOffsetTable(cpu, offset, key);
		})));
	}
	if (!asset.textures.empty()) {
		table->set(key("textures"), valueTable(buildNumericArrayTable(cpu, asset.textures)));
	}
	if (!asset.nodes.empty()) {
		table->set(key("nodes"), valueTable(buildTableArray(cpu, asset.nodes, [&cpu, &key](const ModelNode& node) {
			return buildModelNodeTable(cpu, node, key);
		})));
	}
	if (!asset.scenes.empty()) {
		table->set(key("scenes"), valueTable(buildTableArray(cpu, asset.scenes, [&cpu, &key](const ModelScene& scene) {
			return buildModelSceneTable(cpu, scene, key);
		})));
	}
	if (asset.scene) {
		table->set(key("scene"), valueNumber(static_cast<double>(asset.scene.value())));
	}
	if (!asset.skins.empty()) {
		table->set(key("skins"), valueTable(buildTableArray(cpu, asset.skins, [&cpu, &key](const ModelSkin& skin) {
			return buildModelSkinTable(cpu, skin, key);
		})));
	}
	if (!asset.imageURIs.empty()) {
		table->set(key("imageURIs"), valueTable(buildStringArrayTable(cpu, asset.imageURIs)));
	}
	if (!asset.imageBuffers.empty()) {
		table->set(key("imageBuffers"), valueTable(buildTableArray(cpu, asset.imageBuffers, [&cpu](const std::vector<u8>& buffer) {
			return buildNumericArrayTable(cpu, buffer);
		})));
	}
	return table;
}

Value binValueToRuntimeValue(CPU& cpu, const BinValue& value) {
	if (value.isNull()) {
		return valueNil();
	}
	if (value.isBool()) {
		return valueBool(value.asBool());
	}
	if (value.isNumber()) {
		return valueNumber(static_cast<double>(value.toNumber()));
	}
	if (value.isString()) {
		return valueString(cpu.internString(value.asString()));
	}
	if (value.isArray()) {
		const auto& arr = value.asArray();
		auto* table = cpu.createTable(static_cast<int>(arr.size()), 0);
		for (size_t index = 0; index < arr.size(); ++index) {
			table->set(valueNumber(static_cast<double>(index + 1)), binValueToRuntimeValue(cpu, arr[index]));
		}
		return valueTable(table);
	}
	if (value.isObject()) {
		const auto& obj = value.asObject();
		auto* table = cpu.createTable(0, static_cast<int>(obj.size()));
		for (const auto& [key, entry] : obj) {
			table->set(valueString(cpu.internString(key)), binValueToRuntimeValue(cpu, entry));
		}
		return valueTable(table);
	}
	const auto& bin = value.asBinary();
	auto* table = cpu.createTable(static_cast<int>(bin.size()), 0);
	for (size_t index = 0; index < bin.size(); ++index) {
		table->set(valueNumber(static_cast<double>(index + 1)), valueNumber(static_cast<double>(bin[index])));
	}
	return valueTable(table);
}
}

std::string Runtime::formatLuaString(const std::string& templateStr, const std::vector<Value>& args, size_t argStart) const {
	size_t argumentIndex = argStart;
	std::string output;

	auto takeArgument = [&]() -> Value {
		Value value = argumentIndex < args.size() ? args[argumentIndex] : valueNil();
		argumentIndex += 1;
		return value;
	};

	struct ParsedInt {
		bool found = false;
		int value = 0;
		size_t nextIndex = 0;
	};

	auto readInteger = [&](size_t startIndex) -> ParsedInt {
		size_t cursor = startIndex;
		while (cursor < templateStr.size()) {
			const unsigned char code = static_cast<unsigned char>(templateStr[cursor]);
			if (!std::isdigit(code)) {
				break;
			}
			cursor += 1;
		}
		if (cursor == startIndex) {
			return ParsedInt{false, 0, startIndex};
		}
		return ParsedInt{true, std::stoi(templateStr.substr(startIndex, cursor - startIndex)), cursor};
	};

	for (size_t index = 0; index < templateStr.size(); ++index) {
		const char current = templateStr[index];
		if (current != '%') {
			output.push_back(current);
			continue;
		}
		if (index == templateStr.size() - 1) {
			throw BMSX_RUNTIME_ERROR("string.format incomplete format specifier.");
		}
		if (templateStr[index + 1] == '%') {
			output.push_back('%');
			index += 1;
			continue;
		}

		size_t cursor = index + 1;
		struct {
			bool leftAlign = false;
			bool plus = false;
			bool space = false;
			bool zeroPad = false;
			bool alternate = false;
		} flags;

		while (cursor < templateStr.size()) {
			const char flag = templateStr[cursor];
			if (flag == '-') { flags.leftAlign = true; cursor += 1; continue; }
			if (flag == '+') { flags.plus = true; cursor += 1; continue; }
			if (flag == ' ') { flags.space = true; cursor += 1; continue; }
			if (flag == '0') { flags.zeroPad = true; cursor += 1; continue; }
			if (flag == '#') { flags.alternate = true; cursor += 1; continue; }
			break;
		}

		if (cursor >= templateStr.size()) {
			throw BMSX_RUNTIME_ERROR("string.format incomplete format specifier.");
		}

		std::optional<int> width;
		if (templateStr[cursor] == '*') {
			int widthArg = static_cast<int>(asNumber(takeArgument()));
			if (widthArg < 0) {
				flags.leftAlign = true;
				width = -widthArg;
			} else {
				width = widthArg;
			}
			cursor += 1;
		} else {
			const ParsedInt parsedWidth = readInteger(cursor);
			if (parsedWidth.found) {
				width = parsedWidth.value;
				cursor = parsedWidth.nextIndex;
			}
		}

		std::optional<int> precision;
		if (cursor < templateStr.size() && templateStr[cursor] == '.') {
			cursor += 1;
			if (cursor >= templateStr.size()) {
				throw BMSX_RUNTIME_ERROR("string.format incomplete format specifier.");
			}
			if (templateStr[cursor] == '*') {
				int precisionArg = static_cast<int>(asNumber(takeArgument()));
				if (precisionArg >= 0) {
					precision = precisionArg;
				} else {
					precision.reset();
				}
				cursor += 1;
			} else {
				const ParsedInt parsedPrecision = readInteger(cursor);
				precision = parsedPrecision.found ? parsedPrecision.value : 0;
				cursor = parsedPrecision.nextIndex;
			}
		}

		while (cursor < templateStr.size()) {
			const char mod = templateStr[cursor];
			if (mod != 'l' && mod != 'L' && mod != 'h') {
				break;
			}
			cursor += 1;
		}

		const char specifier = cursor < templateStr.size() ? templateStr[cursor] : '\0';
		if (specifier == '\0') {
			throw BMSX_RUNTIME_ERROR("string.format incomplete format specifier.");
		}

		auto signPrefix = [&](double value) -> std::string {
			if (value < 0) {
				return "-";
			}
			if (flags.plus) {
				return "+";
			}
			if (flags.space) {
				return " ";
			}
			return "";
		};

		auto applyPadding = [&](const std::string& content, const std::string& sign, const std::string& prefix, bool allowZeroPadding) -> std::string {
			const size_t totalLength = sign.size() + prefix.size() + content.size();
			if (width.has_value() && totalLength < static_cast<size_t>(*width)) {
				const size_t paddingLength = static_cast<size_t>(*width) - totalLength;
				if (flags.leftAlign) {
					return sign + prefix + content + std::string(paddingLength, ' ');
				}
				const char padChar = allowZeroPadding ? '0' : ' ';
				if (padChar == '0') {
					return sign + prefix + std::string(paddingLength, '0') + content;
				}
				return std::string(paddingLength, ' ') + sign + prefix + content;
			}
			return sign + prefix + content;
		};

		auto toBase = [](uint64_t value, int base) -> std::string {
			if (value == 0) {
				return "0";
			}
			std::string digits;
			while (value > 0) {
				int digit = static_cast<int>(value % base);
				char c = digit < 10 ? static_cast<char>('0' + digit) : static_cast<char>('a' + (digit - 10));
				digits.push_back(c);
				value /= base;
			}
			std::reverse(digits.begin(), digits.end());
			return digits;
		};

		switch (specifier) {
			case 's': {
				Value value = takeArgument();
				std::string text = valueToString(value);
				if (precision.has_value() && static_cast<size_t>(*precision) < text.size()) {
					text = text.substr(0, static_cast<size_t>(*precision));
				}
				output += applyPadding(text, "", "", false);
				break;
			}
			case 'c': {
				double value = asNumber(takeArgument());
				char character = static_cast<char>(static_cast<int>(std::floor(value)));
				output += applyPadding(std::string(1, character), "", "", false);
				break;
			}
			case 'd':
			case 'i':
			case 'u':
			case 'o':
			case 'x':
			case 'X': {
				double number = asNumber(takeArgument());
				int64_t integerValue = static_cast<int64_t>(std::trunc(number));
				const bool isUnsigned = specifier == 'u' || specifier == 'o' || specifier == 'x' || specifier == 'X';
				if (isUnsigned) {
					integerValue = static_cast<uint32_t>(integerValue);
				}
				const bool negative = !isUnsigned && integerValue < 0;
				const std::string sign = negative ? "-" : (specifier == 'd' || specifier == 'i') ? signPrefix(static_cast<double>(integerValue)) : "";
				uint64_t magnitude = negative ? static_cast<uint64_t>(-integerValue) : static_cast<uint64_t>(integerValue);
				int base = 10;
				if (specifier == 'o') base = 8;
				if (specifier == 'x' || specifier == 'X') base = 16;
				std::string digits = toBase(magnitude, base);
				if (specifier == 'X') {
					for (char& c : digits) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
				}
				if (precision.has_value()) {
					const int required = std::max(0, *precision);
					if (static_cast<int>(digits.size()) < required) {
						digits = std::string(static_cast<size_t>(required) - digits.size(), '0') + digits;
					}
					if (*precision == 0 && magnitude == 0) {
						digits.clear();
					}
				}
				std::string prefix;
				if (flags.alternate) {
					if ((specifier == 'x' || specifier == 'X') && magnitude != 0) {
						prefix = specifier == 'x' ? "0x" : "0X";
					}
					if (specifier == 'o') {
						if (digits.empty()) {
							digits = "0";
						} else if (digits[0] != '0') {
							digits = "0" + digits;
						}
					}
				}
				const bool allowZeroPad = flags.zeroPad && !flags.leftAlign && !precision.has_value();
				output += applyPadding(digits, sign, prefix, allowZeroPad);
				break;
			}
			case 'f':
			case 'F': {
				double number = asNumber(takeArgument());
				const std::string sign = signPrefix(number);
				const int fractionDigits = precision.has_value() ? std::max(0, *precision) : 6;
				std::ostringstream stream;
				stream << std::fixed << std::setprecision(fractionDigits) << std::abs(number);
				std::string text = stream.str();
				if (flags.alternate && fractionDigits == 0 && text.find('.') == std::string::npos) {
					text += '.';
				}
				const bool allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(text, sign, "", allowZeroPad);
				break;
			}
			case 'e':
			case 'E': {
				double number = asNumber(takeArgument());
				const std::string sign = signPrefix(number);
				const int fractionDigits = precision.has_value() ? std::max(0, *precision) : 6;
				std::ostringstream stream;
				stream << std::scientific << std::setprecision(fractionDigits) << std::abs(number);
				std::string text = stream.str();
				if (specifier == 'E') {
					for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
				}
				const bool allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(text, sign, "", allowZeroPad);
				break;
			}
			case 'g':
			case 'G': {
				double number = asNumber(takeArgument());
				const std::string sign = signPrefix(number);
				const int significant = precision.has_value() ? (*precision == 0 ? 1 : *precision) : 6;
				std::ostringstream stream;
				stream << std::setprecision(significant) << std::defaultfloat << std::abs(number);
				std::string text = stream.str();
				if (!flags.alternate) {
					const size_t expPos = text.find_first_of("eE");
					if (expPos != std::string::npos) {
						std::string mantissa = text.substr(0, expPos);
						const std::string exponent = text.substr(expPos + 1);
						const size_t dotPos = mantissa.find('.');
						if (dotPos != std::string::npos) {
							while (!mantissa.empty() && mantissa.back() == '0') {
								mantissa.pop_back();
							}
							if (!mantissa.empty() && mantissa.back() == '.') {
								mantissa.pop_back();
							}
						}
						text = mantissa + "e" + exponent;
					} else if (text.find('.') != std::string::npos) {
						while (!text.empty() && text.back() == '0') {
							text.pop_back();
						}
						if (!text.empty() && text.back() == '.') {
							text.pop_back();
						}
					}
				}
				if (specifier == 'G') {
					for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
				}
				const bool allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(text, sign, "", allowZeroPad);
				break;
			}
			case 'q': {
				Value value = takeArgument();
				std::string raw = valueToString(value);
				std::string escaped = "\"";
				for (size_t charIndex = 0; charIndex < raw.size(); ++charIndex) {
					const unsigned char code = static_cast<unsigned char>(raw[charIndex]);
					switch (code) {
						case 10: escaped += "\\n"; break;
						case 13: escaped += "\\r"; break;
						case 9: escaped += "\\t"; break;
						case 92: escaped += "\\\\"; break;
						case 34: escaped += "\\\""; break;
						default:
							if (code < 32 || code == 127) {
								std::ostringstream oss;
								oss << std::setw(3) << std::setfill('0') << static_cast<int>(code);
								escaped += "\\" + oss.str();
							} else {
								escaped.push_back(raw[charIndex]);
							}
							break;
					}
				}
				escaped += "\"";
				output += applyPadding(escaped, "", "", false);
				break;
			}
			default:
				throw BMSX_RUNTIME_ERROR(std::string("string.format unsupported format specifier '%") + specifier + "'.");
		}

		index = cursor;
	}

	return output;
}

const std::regex& Runtime::buildLuaPatternRegex(const std::string& pattern) {
	auto it = m_luaPatternRegexCache.find(pattern);
	if (it != m_luaPatternRegexCache.end()) {
		return *it->second;
	}

	std::string output;
	output.reserve(pattern.size() * 2);
	bool inClass = false;
	for (size_t index = 0; index < pattern.size(); ++index) {
		char ch = pattern[index];
		if (inClass) {
			if (ch == ']') {
				inClass = false;
				output.push_back(']');
				continue;
			}
			if (ch == '%') {
				++index;
				if (index >= pattern.size()) {
					throw BMSX_RUNTIME_ERROR("string.gmatch invalid pattern.");
				}
				output += translateLuaPatternEscape(pattern[index], true);
				continue;
			}
			if (ch == '\\') {
				output += "\\\\";
				continue;
			}
			output.push_back(ch);
			continue;
		}

		if (ch == '[') {
			inClass = true;
			output.push_back('[');
			continue;
		}
		if (ch == '%') {
			++index;
			if (index >= pattern.size()) {
				throw BMSX_RUNTIME_ERROR("string.gmatch invalid pattern.");
			}
			output += translateLuaPatternEscape(pattern[index], false);
			continue;
		}
		if (ch == '-') {
			output += "*?";
			continue;
		}
		if (ch == '^') {
			output += index == 0 ? "^" : "\\^";
			continue;
		}
		if (ch == '$') {
			output += index == pattern.size() - 1 ? "$" : "\\$";
			continue;
		}
		if (ch == '(' || ch == ')' || ch == '.' || ch == '+' || ch == '*' || ch == '?') {
			output.push_back(ch);
			continue;
		}
		if (ch == '|' || ch == '{' || ch == '}' || ch == '\\') {
			output.push_back('\\');
			output.push_back(ch);
			continue;
		}
		output.push_back(ch);
	}
	if (inClass) {
		throw BMSX_RUNTIME_ERROR("string.gmatch invalid pattern.");
	}
	auto compiled = std::make_unique<std::regex>(
		output,
		std::regex_constants::ECMAScript | std::regex_constants::optimize
	);
	auto insertIt = m_luaPatternRegexCache.emplace(pattern, std::move(compiled)).first;
	return *insertIt->second;
}

std::string Runtime::translateLuaPatternEscape(char token, bool inClass) const {
	switch (token) {
		case 'a':
			return inClass ? "A-Za-z" : "[A-Za-z]";
		case 'd':
			return inClass ? "0-9" : "\\d";
		case 'l':
			return inClass ? "a-z" : "[a-z]";
		case 'u':
			return inClass ? "A-Z" : "[A-Z]";
		case 'w':
			return inClass ? "A-Za-z0-9_" : "[A-Za-z0-9_]";
		case 'x':
			return inClass ? "A-Fa-f0-9" : "[A-Fa-f0-9]";
		case 'z':
			return "\\x00";
		case 'c':
			return inClass ? "\\x00-\\x1F\\x7F" : "[\\x00-\\x1F\\x7F]";
		case 'g':
			return inClass ? "\\x21-\\x7E" : "[\\x21-\\x7E]";
		case 's':
			return "\\s";
		case 'p': {
			std::string punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
			std::string escaped;
			escaped.reserve(punctuation.size() * 2);
			for (char ch : punctuation) {
				if (ch == '\\' || ch == '-' || ch == ']') {
					escaped.push_back('\\');
				}
				escaped.push_back(ch);
			}
			return inClass ? escaped : "[" + escaped + "]";
		}
		case '%':
			return "%";
		default:
			return std::string("\\") + token;
	}
}

std::string Runtime::valueToString(const Value& value) const {
	if (isNil(value)) {
		return "nil";
	}
	if (valueIsBool(value)) {
		return valueToBool(value) ? "true" : "false";
	}
	if (valueIsNumber(value)) {
		double n = valueToNumber(value);
		if (!std::isfinite(n)) {
			return "nan";
		}
		return formatNumber(n);
	}
	if (valueIsString(value)) {
		return m_cpu.stringPool().toString(asStringId(value));
	}
	if (valueIsTable(value)) {
		return "table";
	}
	if (valueIsNativeFunction(value) || valueIsClosure(value)) {
		return "function";
	}
	if (valueIsNativeObject(value)) {
		return "native";
	}
	return "function";
}

double Runtime::nextRandom() {
	m_randomSeedValue = static_cast<uint32_t>((static_cast<uint64_t>(m_randomSeedValue) * 1664525u + 1013904223u) & 0xffffffffu);
	return static_cast<double>(m_randomSeedValue) / 4294967296.0;
}

void Runtime::setupBuiltins() {
	auto logPcallError = [this](const std::string& message) {
		std::cerr << "[Runtime] pcall error: " << message << std::endl;
		logLuaCallStack();
	};
	auto callClosureValue = [this](const Value& callee, const std::vector<Value>& args, std::vector<Value>& out) {
		if (valueIsNativeFunction(callee)) {
			asNativeFunction(callee)->invoke(args, out);
			return;
		}
		if (valueIsClosure(callee)) {
			int depthBefore = m_cpu.getFrameDepth();
			const int previousBudget = m_cpu.instructionBudgetRemaining;
			const int budgetSentinel = std::numeric_limits<int>::max();
			try {
				m_cpu.callExternal(asClosure(callee), args);
				m_cpu.runUntilDepth(depthBefore, budgetSentinel);
			} catch (...) {
				const int remaining = m_cpu.instructionBudgetRemaining;
				m_cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
				throw;
			}
			const int remaining = m_cpu.instructionBudgetRemaining;
			m_cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
			out.clear();
			const auto& results = m_cpu.lastReturnValues;
			out.insert(out.end(), results.begin(), results.end());
			return;
		}
		throw BMSX_RUNTIME_ERROR("Attempted to call a non-function value.");
	};
	auto key = [this](std::string_view name) {
		return canonicalizeIdentifier(name);
	};
	auto str = [this](std::string_view value) {
		return valueString(m_cpu.internString(value));
	};
	auto asText = [this](Value value) -> const std::string& {
		return m_cpu.stringPool().toString(asStringId(value));
	};
	auto clamp01 = [](double value) {
		return clamp(value, 0.0, 1.0);
	};
	auto smoothstep01 = [clamp01](double value) {
		const double x = clamp01(value);
		return x * x * (3.0 - (2.0 * x));
	};
	auto pingpong01 = [](double value) {
		double p = std::fmod(value, 2.0);
		if (p < 0.0) {
			p += 2.0;
		}
		return (p < 1.0) ? p : (2.0 - p);
	};
	const double kPi = 3.14159265358979323846;
	const double radToDeg = 180.0 / kPi;
	const double degToRad = kPi / 180.0;
	const double maxSafeInteger = 9007199254740991.0;

	auto* mathTable = m_cpu.createTable();
	mathTable->set(key("abs"), m_cpu.createNativeFunction("math.abs", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::abs(value)));
	}));
	mathTable->set(key("acos"), m_cpu.createNativeFunction("math.acos", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::acos(value)));
	}));
	mathTable->set(key("asin"), m_cpu.createNativeFunction("math.asin", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::asin(value)));
	}));
	mathTable->set(key("atan"), m_cpu.createNativeFunction("math.atan", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double y = asNumber(args.at(0));
		if (args.size() > 1) {
			double x = asNumber(args.at(1));
			out.push_back(valueNumber(std::atan2(y, x)));
			return;
		}
		out.push_back(valueNumber(std::atan(y)));
	}));
	mathTable->set(key("ceil"), m_cpu.createNativeFunction("math.ceil", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::ceil(value)));
	}));
	mathTable->set(key("cos"), m_cpu.createNativeFunction("math.cos", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::cos(value)));
	}));
	mathTable->set(key("deg"), m_cpu.createNativeFunction("math.deg", [radToDeg](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(value * radToDeg));
	}));
	mathTable->set(key("exp"), m_cpu.createNativeFunction("math.exp", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::exp(value)));
	}));
	mathTable->set(key("floor"), m_cpu.createNativeFunction("math.floor", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::floor(value)));
	}));
	mathTable->set(key("fmod"), m_cpu.createNativeFunction("math.fmod", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		double divisor = asNumber(args.at(1));
		out.push_back(valueNumber(std::fmod(value, divisor)));
	}));
	mathTable->set(key("log"), m_cpu.createNativeFunction("math.log", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		if (args.size() > 1) {
			double base = asNumber(args.at(1));
			out.push_back(valueNumber(std::log(value) / std::log(base)));
			return;
		}
		out.push_back(valueNumber(std::log(value)));
	}));
	mathTable->set(key("max"), m_cpu.createNativeFunction("math.max", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double result = asNumber(args.at(0));
		for (size_t i = 1; i < args.size(); ++i) {
			result = std::max(result, asNumber(args[i]));
		}
		out.push_back(valueNumber(result));
	}));
	mathTable->set(key("min"), m_cpu.createNativeFunction("math.min", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double result = asNumber(args.at(0));
		for (size_t i = 1; i < args.size(); ++i) {
			result = std::min(result, asNumber(args[i]));
		}
		out.push_back(valueNumber(result));
	}));
	mathTable->set(key("modf"), m_cpu.createNativeFunction("math.modf", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		double intPart = 0.0;
		double fracPart = std::modf(value, &intPart);
		out.push_back(valueNumber(intPart));
		out.push_back(valueNumber(fracPart));
	}));
	mathTable->set(key("rad"), m_cpu.createNativeFunction("math.rad", [degToRad](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(value * degToRad));
	}));
	mathTable->set(key("sin"), m_cpu.createNativeFunction("math.sin", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::sin(value)));
	}));
	mathTable->set(key("sqrt"), m_cpu.createNativeFunction("math.sqrt", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::sqrt(value)));
	}));
	mathTable->set(key("tan"), m_cpu.createNativeFunction("math.tan", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::tan(value)));
	}));
	mathTable->set(key("tointeger"), m_cpu.createNativeFunction("math.tointeger", [](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		if (!valueIsNumber(v)) {
			out.push_back(valueNil());
			return;
		}
		double value = valueToNumber(v);
		if (!std::isfinite(value)) {
			out.push_back(valueNil());
			return;
		}
		double intPart = std::trunc(value);
		if (intPart == value) {
			out.push_back(valueNumber(intPart));
			return;
		}
		out.push_back(valueNil());
	}));
	mathTable->set(key("type"), m_cpu.createNativeFunction("math.type", [str](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		if (!valueIsNumber(v)) {
			out.push_back(valueNil());
			return;
		}
		double value = valueToNumber(v);
		if (std::trunc(value) == value) {
			out.push_back(str("integer"));
			return;
		}
		out.push_back(str("float"));
	}));
	mathTable->set(key("ult"), m_cpu.createNativeFunction("math.ult", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double leftValue = asNumber(args.at(0));
		double rightValue = asNumber(args.at(1));
		uint32_t left = static_cast<uint32_t>(static_cast<int64_t>(std::trunc(leftValue)));
		uint32_t right = static_cast<uint32_t>(static_cast<int64_t>(std::trunc(rightValue)));
		out.push_back(valueBool(left < right));
	}));
	mathTable->set(key("random"), m_cpu.createNativeFunction("math.random", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		double randomValue = nextRandom();
		if (args.empty()) {
			out.push_back(valueNumber(randomValue));
			return;
		}
		if (args.size() == 1) {
			int upper = static_cast<int>(std::floor(asNumber(args.at(0))));
			if (upper < 1) {
				throw BMSX_RUNTIME_ERROR("math.random upper bound must be positive.");
			}
			out.push_back(valueNumber(static_cast<double>(static_cast<int>(randomValue * upper) + 1)));
			return;
		}
		int lower = static_cast<int>(std::floor(asNumber(args.at(0))));
		int upper = static_cast<int>(std::floor(asNumber(args.at(1))));
		if (upper < lower) {
			throw BMSX_RUNTIME_ERROR("math.random upper bound must be greater than or equal to lower bound.");
		}
		int span = upper - lower + 1;
		out.push_back(valueNumber(static_cast<double>(lower + static_cast<int>(randomValue * span))));
	}));
	mathTable->set(key("randomseed"), m_cpu.createNativeFunction("math.randomseed", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		double seedValue = args.empty() ? EngineCore::instance().clock()->now() : asNumber(args.at(0));
		uint64_t seed = static_cast<uint64_t>(std::floor(seedValue));
		m_randomSeedValue = static_cast<uint32_t>(seed & 0xffffffffu);
		(void)out;
	}));
	mathTable->set(key("huge"), valueNumber(std::numeric_limits<double>::infinity()));
	mathTable->set(key("maxinteger"), valueNumber(maxSafeInteger));
	mathTable->set(key("mininteger"), valueNumber(-maxSafeInteger));
	mathTable->set(key("pi"), valueNumber(kPi));

	auto* easingTable = m_cpu.createTable();
	easingTable->set(key("linear"), m_cpu.createNativeFunction("easing.linear", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(clamp01(value)));
	}));
	easingTable->set(key("ease_in_quad"), m_cpu.createNativeFunction("easing.ease_in_quad", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double x = clamp01(asNumber(args.at(0)));
		out.push_back(valueNumber(x * x));
	}));
	easingTable->set(key("ease_out_quad"), m_cpu.createNativeFunction("easing.ease_out_quad", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double x = clamp01(1.0 - asNumber(args.at(0)));
		out.push_back(valueNumber(1.0 - (x * x)));
	}));
	easingTable->set(key("ease_in_out_quad"), m_cpu.createNativeFunction("easing.ease_in_out_quad", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double x = clamp01(asNumber(args.at(0)));
		if (x < 0.5) {
			out.push_back(valueNumber(2.0 * x * x));
			return;
		}
		double y = (-2.0 * x) + 2.0;
		out.push_back(valueNumber(1.0 - ((y * y) / 2.0)));
	}));
	easingTable->set(key("ease_out_back"), m_cpu.createNativeFunction("easing.ease_out_back", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double x = clamp01(asNumber(args.at(0)));
		const double c1 = 1.70158;
		const double c3 = c1 + 1.0;
		out.push_back(valueNumber(1.0 + (c3 * std::pow(x - 1.0, 3.0)) + (c1 * std::pow(x - 1.0, 2.0))));
	}));
	easingTable->set(key("smoothstep"), m_cpu.createNativeFunction("easing.smoothstep", [smoothstep01](const std::vector<Value>& args, std::vector<Value>& out) {
		out.push_back(valueNumber(smoothstep01(asNumber(args.at(0)))));
	}));
	easingTable->set(key("pingpong01"), m_cpu.createNativeFunction("easing.pingpong01", [pingpong01](const std::vector<Value>& args, std::vector<Value>& out) {
		out.push_back(valueNumber(pingpong01(asNumber(args.at(0)))));
	}));
	easingTable->set(key("arc01"), m_cpu.createNativeFunction("easing.arc01", [smoothstep01](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		if (value <= 0.5) {
			out.push_back(valueNumber(smoothstep01(value * 2.0)));
			return;
		}
		out.push_back(valueNumber(smoothstep01((1.0 - value) * 2.0)));
	}));

	setGlobal("math", valueTable(mathTable));
	setGlobal("easing", valueTable(easingTable));
	setGlobal("sys_boot_cart", valueNumber(static_cast<double>(IO_SYS_BOOT_CART)));
	setGlobal("sys_cart_bootready", valueNumber(static_cast<double>(IO_SYS_CART_BOOTREADY)));
	setGlobal("sys_cart_magic_addr", valueNumber(static_cast<double>(CART_ROM_MAGIC_ADDR)));
	setGlobal("sys_cart_magic", valueNumber(static_cast<double>(CART_ROM_MAGIC)));
	const uint32_t maxAssets = (ASSET_TABLE_SIZE - ASSET_TABLE_HEADER_SIZE) / ASSET_TABLE_ENTRY_SIZE;
	setGlobal("sys_cart_rom_size", valueNumber(static_cast<double>(CART_ROM_SIZE)));
	setGlobal("sys_ram_size", valueNumber(static_cast<double>(RAM_SIZE)));
	setGlobal("sys_max_assets", valueNumber(static_cast<double>(maxAssets)));
	setGlobal("sys_string_handle_count", valueNumber(static_cast<double>(STRING_HANDLE_COUNT)));
	setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(m_cycleBudgetPerFrame)));
	setGlobal("sys_vdp_dither", valueNumber(static_cast<double>(IO_VDP_DITHER)));
	setGlobal("sys_vdp_primary_atlas_id", valueNumber(static_cast<double>(IO_VDP_PRIMARY_ATLAS_ID)));
	setGlobal("sys_vdp_secondary_atlas_id", valueNumber(static_cast<double>(IO_VDP_SECONDARY_ATLAS_ID)));
	setGlobal("sys_vdp_atlas_none", valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	setGlobal("sys_vdp_rd_surface", valueNumber(static_cast<double>(IO_VDP_RD_SURFACE)));
	setGlobal("sys_vdp_rd_x", valueNumber(static_cast<double>(IO_VDP_RD_X)));
	setGlobal("sys_vdp_rd_y", valueNumber(static_cast<double>(IO_VDP_RD_Y)));
	setGlobal("sys_vdp_rd_mode", valueNumber(static_cast<double>(IO_VDP_RD_MODE)));
	setGlobal("sys_vdp_rd_status", valueNumber(static_cast<double>(IO_VDP_RD_STATUS)));
	setGlobal("sys_vdp_rd_data", valueNumber(static_cast<double>(IO_VDP_RD_DATA)));
	setGlobal("sys_vdp_status", valueNumber(static_cast<double>(IO_VDP_STATUS)));
	setGlobal("sys_vdp_rd_mode_rgba8888", valueNumber(static_cast<double>(VDP_RD_MODE_RGBA8888)));
	setGlobal("sys_vdp_rd_status_ready", valueNumber(static_cast<double>(VDP_RD_STATUS_READY)));
	setGlobal("sys_vdp_rd_status_overflow", valueNumber(static_cast<double>(VDP_RD_STATUS_OVERFLOW)));
	setGlobal("sys_vdp_status_vblank", valueNumber(static_cast<double>(VDP_STATUS_VBLANK)));
	setGlobal("sys_irq_flags", valueNumber(static_cast<double>(IO_IRQ_FLAGS)));
	setGlobal("sys_irq_ack", valueNumber(static_cast<double>(IO_IRQ_ACK)));
	setGlobal("sys_dma_src", valueNumber(static_cast<double>(IO_DMA_SRC)));
	setGlobal("sys_dma_dst", valueNumber(static_cast<double>(IO_DMA_DST)));
	setGlobal("sys_dma_len", valueNumber(static_cast<double>(IO_DMA_LEN)));
	setGlobal("sys_dma_ctrl", valueNumber(static_cast<double>(IO_DMA_CTRL)));
	setGlobal("sys_dma_status", valueNumber(static_cast<double>(IO_DMA_STATUS)));
	setGlobal("sys_dma_written", valueNumber(static_cast<double>(IO_DMA_WRITTEN)));
	setGlobal("sys_img_src", valueNumber(static_cast<double>(IO_IMG_SRC)));
	setGlobal("sys_img_len", valueNumber(static_cast<double>(IO_IMG_LEN)));
	setGlobal("sys_img_dst", valueNumber(static_cast<double>(IO_IMG_DST)));
	setGlobal("sys_img_cap", valueNumber(static_cast<double>(IO_IMG_CAP)));
	setGlobal("sys_img_ctrl", valueNumber(static_cast<double>(IO_IMG_CTRL)));
	setGlobal("sys_img_status", valueNumber(static_cast<double>(IO_IMG_STATUS)));
	setGlobal("sys_img_written", valueNumber(static_cast<double>(IO_IMG_WRITTEN)));
	setGlobal("sys_rom_system_base", valueNumber(static_cast<double>(SYSTEM_ROM_BASE)));
	setGlobal("sys_rom_cart_base", valueNumber(static_cast<double>(CART_ROM_BASE)));
	setGlobal("sys_rom_overlay_base", valueNumber(static_cast<double>(OVERLAY_ROM_BASE)));
	setGlobal("sys_rom_overlay_size", valueNumber(static_cast<double>(m_memory.overlayRomSize())));
	refreshMemoryMapGlobals();
	setGlobal("irq_dma_done", valueNumber(static_cast<double>(IRQ_DMA_DONE)));
	setGlobal("irq_dma_error", valueNumber(static_cast<double>(IRQ_DMA_ERROR)));
	setGlobal("irq_img_done", valueNumber(static_cast<double>(IRQ_IMG_DONE)));
	setGlobal("irq_img_error", valueNumber(static_cast<double>(IRQ_IMG_ERROR)));
	setGlobal("irq_vblank", valueNumber(static_cast<double>(IRQ_VBLANK)));
	setGlobal("irq_reinit", valueNumber(static_cast<double>(IRQ_REINIT)));
	setGlobal("irq_newgame", valueNumber(static_cast<double>(IRQ_NEWGAME)));
	setGlobal("dma_ctrl_start", valueNumber(static_cast<double>(DMA_CTRL_START)));
	setGlobal("dma_ctrl_strict", valueNumber(static_cast<double>(DMA_CTRL_STRICT)));
	setGlobal("dma_status_busy", valueNumber(static_cast<double>(DMA_STATUS_BUSY)));
	setGlobal("dma_status_done", valueNumber(static_cast<double>(DMA_STATUS_DONE)));
	setGlobal("dma_status_error", valueNumber(static_cast<double>(DMA_STATUS_ERROR)));
	setGlobal("dma_status_clipped", valueNumber(static_cast<double>(DMA_STATUS_CLIPPED)));
	setGlobal("img_ctrl_start", valueNumber(static_cast<double>(IMG_CTRL_START)));
	setGlobal("img_status_busy", valueNumber(static_cast<double>(IMG_STATUS_BUSY)));
	setGlobal("img_status_done", valueNumber(static_cast<double>(IMG_STATUS_DONE)));
	setGlobal("img_status_error", valueNumber(static_cast<double>(IMG_STATUS_ERROR)));
	setGlobal("img_status_clipped", valueNumber(static_cast<double>(IMG_STATUS_CLIPPED)));

	registerNativeFunction("peek", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		out.push_back(m_memory.readValue(address));
	});

	registerNativeFunction("peek8", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		out.push_back(valueNumber(static_cast<double>(m_memory.readU8(address))));
	});

	registerNativeFunction("peek16le", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		const uint32_t b0 = static_cast<uint32_t>(m_memory.readU8(address));
		const uint32_t b1 = static_cast<uint32_t>(m_memory.readU8(address + 1));
		const uint32_t value = b0 | (b1 << 8);
		out.push_back(valueNumber(static_cast<double>(value)));
	});

	registerNativeFunction("peek32le", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		const uint32_t b0 = static_cast<uint32_t>(m_memory.readU8(address));
		const uint32_t b1 = static_cast<uint32_t>(m_memory.readU8(address + 1));
		const uint32_t b2 = static_cast<uint32_t>(m_memory.readU8(address + 2));
		const uint32_t b3 = static_cast<uint32_t>(m_memory.readU8(address + 3));
		const uint32_t value = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
		out.push_back(valueNumber(static_cast<double>(value)));
	});

	registerNativeFunction("reader_read_f32", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		const uint32_t b0 = static_cast<uint32_t>(m_memory.readU8(address));
		const uint32_t b1 = static_cast<uint32_t>(m_memory.readU8(address + 1));
		const uint32_t b2 = static_cast<uint32_t>(m_memory.readU8(address + 2));
		const uint32_t b3 = static_cast<uint32_t>(m_memory.readU8(address + 3));
		const uint32_t bits = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
		float value = 0.0f;
		std::memcpy(&value, &bits, sizeof(value));
		out.push_back(valueNumber(static_cast<double>(value)));
	});

	registerNativeFunction("reader_read_f64", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		const uint32_t lo0 = static_cast<uint32_t>(m_memory.readU8(address));
		const uint32_t lo1 = static_cast<uint32_t>(m_memory.readU8(address + 1));
		const uint32_t lo2 = static_cast<uint32_t>(m_memory.readU8(address + 2));
		const uint32_t lo3 = static_cast<uint32_t>(m_memory.readU8(address + 3));
		const uint32_t hi0 = static_cast<uint32_t>(m_memory.readU8(address + 4));
		const uint32_t hi1 = static_cast<uint32_t>(m_memory.readU8(address + 5));
		const uint32_t hi2 = static_cast<uint32_t>(m_memory.readU8(address + 6));
		const uint32_t hi3 = static_cast<uint32_t>(m_memory.readU8(address + 7));
		const uint64_t lo = static_cast<uint64_t>(lo0 | (lo1 << 8) | (lo2 << 16) | (lo3 << 24));
		const uint64_t hi = static_cast<uint64_t>(hi0 | (hi1 << 8) | (hi2 << 16) | (hi3 << 24));
		const uint64_t bits = (hi << 32) | lo;
		double value = 0.0;
		std::memcpy(&value, &bits, sizeof(value));
		out.push_back(valueNumber(value));
	});

	registerNativeFunction("u32_to_f32", [](const std::vector<Value>& args, std::vector<Value>& out) {
		const uint32_t bits = static_cast<uint32_t>(asNumber(args.at(0)));
		float value = 0.0f;
		std::memcpy(&value, &bits, sizeof(value));
		out.push_back(valueNumber(static_cast<double>(value)));
	});

	registerNativeFunction("u64_to_f64", [](const std::vector<Value>& args, std::vector<Value>& out) {
		const uint64_t hi = static_cast<uint64_t>(static_cast<uint32_t>(asNumber(args.at(0))));
		const uint64_t lo = static_cast<uint64_t>(static_cast<uint32_t>(asNumber(args.at(1))));
		const uint64_t bits = (hi << 32) | lo;
		double value = 0.0;
		std::memcpy(&value, &bits, sizeof(value));
		out.push_back(valueNumber(value));
	});

	registerNativeFunction("wait_vblank", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		(void)args;
		(void)out;
		requestWaitForVblank();
	});

	registerNativeFunction("poke", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		m_memory.writeValue(address, args.at(1));
		(void)out;
	});

	registerNativeFunction("type", [str](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		if (isNil(v)) { out.push_back(str("nil")); return; }
		if (valueIsBool(v)) { out.push_back(str("boolean")); return; }
		if (valueIsNumber(v)) { out.push_back(str("number")); return; }
		if (valueIsString(v)) { out.push_back(str("string")); return; }
		if (valueIsTable(v)) { out.push_back(str("table")); return; }
		if (valueIsClosure(v)) { out.push_back(str("function")); return; }
		if (valueIsNativeFunction(v)) { out.push_back(str("function")); return; }
		if (valueIsNativeObject(v)) { out.push_back(str("native")); return; }
		out.push_back(str("function"));
	});

	registerNativeFunction("tostring", [this, str](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		out.push_back(str(valueToString(v)));
	});

	registerNativeFunction("tonumber", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		if (args.empty()) {
			out.push_back(valueNil());
			return;
		}
		const Value& v = args.at(0);
		if (valueIsNumber(v)) {
			out.push_back(v);
			return;
		}
		if (valueIsString(v)) {
			const std::string& text = m_cpu.stringPool().toString(asStringId(v));
			if (args.size() >= 2) {
				int base = static_cast<int>(std::floor(asNumber(args.at(1))));
				if (base >= 2 && base <= 36) {
					std::string trimmed = text;
					size_t start = trimmed.find_first_not_of(" \t\n\r");
					size_t end = trimmed.find_last_not_of(" \t\n\r");
					if (start == std::string::npos) {
						out.push_back(valueNil());
						return;
					}
					trimmed = trimmed.substr(start, end - start + 1);
					char* parseEnd = nullptr;
					long parsed = std::strtol(trimmed.c_str(), &parseEnd, base);
					if (parseEnd == trimmed.c_str()) {
						out.push_back(valueNil());
						return;
					}
					out.push_back(valueNumber(static_cast<double>(parsed)));
					return;
				}
				out.push_back(valueNil());
				return;
			}
			char* end = nullptr;
			double parsed = std::strtod(text.c_str(), &end);
			if (end == text.c_str() || !std::isfinite(parsed)) {
				out.push_back(valueNil());
				return;
			}
			out.push_back(valueNumber(parsed));
			return;
		}
		out.push_back(valueNil());
	});

	registerNativeFunction("assert", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& condition = args.empty() ? valueNil() : args.at(0);
		if (!isTruthy(condition)) {
			const std::string message = args.size() > 1 ? valueToString(args.at(1)) : std::string("assertion failed!");
			throw BMSX_RUNTIME_ERROR(message);
		}
		out.insert(out.end(), args.begin(), args.end());
	});

registerNativeFunction("error", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string message = args.empty() ? std::string("error") : valueToString(args.at(0));
	(void)out;
	throw BMSX_RUNTIME_ERROR(message);
});

	registerNativeFunction("setmetatable", [](const std::vector<Value>& args, std::vector<Value>& out) {
		if (args.empty() || (!valueIsTable(args.at(0)) && !valueIsNativeObject(args.at(0)))) {
			throw BMSX_RUNTIME_ERROR("setmetatable expects a table or native value as the first argument.");
		}
		Table* metatable = nullptr;
		if (args.size() >= 2 && !isNil(args.at(1))) {
			if (!valueIsTable(args.at(1))) {
				throw BMSX_RUNTIME_ERROR("setmetatable expects a table or nil as the second argument.");
			}
			metatable = asTable(args.at(1));
		}

		const Value target = args.at(0);
		if (valueIsTable(target)) {
			asTable(target)->setMetatable(metatable);
			out.push_back(target);
			return;
		}

		auto* native = asNativeObject(target);
		native->metatable = metatable;
		out.push_back(target);
	});

	registerNativeFunction("getmetatable", [](const std::vector<Value>& args, std::vector<Value>& out) {
		if (args.empty() || (!valueIsTable(args.at(0)) && !valueIsNativeObject(args.at(0)))) {
			throw BMSX_RUNTIME_ERROR("getmetatable expects a table or native value as the first argument.");
		}
		const Value target = args.at(0);
		if (valueIsTable(target)) {
			auto* mt = asTable(target)->getMetatable();
			out.push_back(mt ? valueTable(mt) : valueNil());
			return;
		}
		auto* mt = asNativeObject(target)->metatable;
		out.push_back(mt ? valueTable(mt) : valueNil());
	});

	registerNativeFunction("rawequal", [](const std::vector<Value>& args, std::vector<Value>& out) {
		out.push_back(valueBool(args.at(0) == args.at(1)));
	});

	registerNativeFunction("rawget", [](const std::vector<Value>& args, std::vector<Value>& out) {
		auto* tbl = asTable(args.at(0));
		Value key = args.size() > 1 ? args.at(1) : valueNil();
		out.push_back(tbl->get(key));
	});

	registerNativeFunction("rawset", [](const std::vector<Value>& args, std::vector<Value>& out) {
		auto* tbl = asTable(args.at(0));
		Value key = args.at(1);
		Value value = args.size() > 2 ? args.at(2) : valueNil();
		tbl->set(key, value);
		out.push_back(valueTable(tbl));
	});

	registerNativeFunction("select", [](const std::vector<Value>& args, std::vector<Value>& out) {
		if (valueIsString(args.at(0)) && Runtime::instance().cpu().stringPool().toString(asStringId(args.at(0))) == "#") {
			out.push_back(valueNumber(static_cast<double>(args.size() - 1)));
			return;
		}
		int count = static_cast<int>(args.size()) - 1;
		int start = static_cast<int>(asNumber(args.at(0)));
		if (start < 0) {
			start = count + start + 1;
		}
		for (int i = start; i <= count; ++i) {
			if (i >= 1 && static_cast<size_t>(i) < args.size()) {
				out.push_back(args[static_cast<size_t>(i)]);
			}
		}
	});

	registerNativeFunction("pcall", [callClosureValue, logPcallError, str](const std::vector<Value>& args, std::vector<Value>& out) {
		Value fn = args.at(0);
		std::vector<Value> callArgs;
		for (size_t i = 1; i < args.size(); ++i) {
			callArgs.push_back(args[i]);
		}
		try {
			callClosureValue(fn, callArgs, out);
			out.insert(out.begin(), valueBool(true));
		} catch (const std::exception& e) {
			logPcallError(e.what());
			out.clear();
			out.push_back(valueBool(false));
			out.push_back(str(e.what()));
		} catch (...) {
			logPcallError("error");
			out.clear();
			out.push_back(valueBool(false));
			out.push_back(str("error"));
		}
	});

	registerNativeFunction("xpcall", [callClosureValue, logPcallError, str](const std::vector<Value>& args, std::vector<Value>& out) {
		Value fn = args.at(0);
		Value handler = args.at(1);
		std::vector<Value> callArgs;
		for (size_t i = 2; i < args.size(); ++i) {
			callArgs.push_back(args[i]);
		}
		try {
			callClosureValue(fn, callArgs, out);
			out.insert(out.begin(), valueBool(true));
		} catch (const std::exception& e) {
			logPcallError(e.what());
			std::vector<Value> handlerArgs;
			handlerArgs.push_back(str(e.what()));
			callClosureValue(handler, handlerArgs, out);
			out.insert(out.begin(), valueBool(false));
		} catch (...) {
			logPcallError("error");
			std::vector<Value> handlerArgs;
			handlerArgs.push_back(str("error"));
			callClosureValue(handler, handlerArgs, out);
			out.insert(out.begin(), valueBool(false));
		}
	});

	registerNativeFunction("require", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const std::string& moduleName = m_cpu.stringPool().toString(asStringId(args.at(0)));
		size_t start = moduleName.find_first_not_of(" \t\n\r");
		if (start == std::string::npos) {
			out.push_back(requireModule(""));
			return;
		}
		size_t end = moduleName.find_last_not_of(" \t\n\r");
		out.push_back(requireModule(moduleName.substr(start, end - start + 1)));
	});

	const Value lengthKey = key("length");
	const StringId lengthId = asStringId(lengthKey);
	registerNativeFunction("array", [this, lengthId](const std::vector<Value>& args, std::vector<Value>& out) {
		struct NativeArray {
			std::vector<Value> values;
			std::unordered_map<StringId, Value> props;
			std::vector<StringId> propOrder;
		};

		auto data = std::make_shared<NativeArray>();
		if (args.size() == 1 && valueIsTable(args.at(0))) {
			const auto* tbl = asTable(args.at(0));
			const auto entries = tbl->entries();
			for (const auto& [key, value] : entries) {
				if (valueIsNumber(key)) {
					double n = valueToNumber(key);
					double intpart = 0.0;
					if (std::modf(n, &intpart) == 0.0 && n >= 1.0) {
						int index = static_cast<int>(n) - 1;
						if (index >= static_cast<int>(data->values.size())) {
							data->values.resize(static_cast<size_t>(index + 1));
						}
						data->values[static_cast<size_t>(index)] = value;
						continue;
					}
				}
				data->values.push_back(value);
			}
		} else {
			data->values.assign(args.begin(), args.end());
		}

		auto native = m_cpu.createNativeObject(
			data.get(),
			[data, lengthId](const Value& key) -> Value {
				if (valueIsNumber(key)) {
					double n = valueToNumber(key);
					double intpart = 0.0;
					if (std::modf(n, &intpart) == 0.0 && n >= 1.0) {
						int index = static_cast<int>(n) - 1;
						if (index >= static_cast<int>(data->values.size())) {
							return valueNil();
						}
						return data->values[static_cast<size_t>(index)];
					}
				}
				if (valueIsString(key)) {
					StringId id = asStringId(key);
					if (id == lengthId) {
						return valueNumber(static_cast<double>(data->values.size()));
					}
					const auto it = data->props.find(id);
					if (it != data->props.end()) {
						return it->second;
					}
					return valueNil();
				}
				throw BMSX_RUNTIME_ERROR("Attempted to index native array with unsupported key.");
			},
			[data](const Value& key, const Value& value) {
				if (valueIsNumber(key)) {
					double n = valueToNumber(key);
					double intpart = 0.0;
					if (std::modf(n, &intpart) == 0.0 && n >= 1.0) {
						int index = static_cast<int>(n) - 1;
						if (index >= static_cast<int>(data->values.size())) {
							data->values.resize(static_cast<size_t>(index + 1));
						}
						data->values[static_cast<size_t>(index)] = value;
						return;
					}
				}
				if (valueIsString(key)) {
					StringId id = asStringId(key);
					if (!data->props.count(id)) {
						data->propOrder.push_back(id);
					}
					data->props[id] = value;
					return;
				}
				throw BMSX_RUNTIME_ERROR("Attempted to index native array with unsupported key.");
			},
			[data]() -> int {
				return static_cast<int>(data->values.size());
			},
			[data](const Value& after) -> std::optional<std::pair<Value, Value>> {
				std::vector<Value> keys;
				for (size_t i = 0; i < data->values.size(); ++i) {
					if (!isNil(data->values[i])) {
						keys.emplace_back(valueNumber(static_cast<double>(i + 1)));
					}
				}
				for (const auto& id : data->propOrder) {
					const auto it = data->props.find(id);
					if (it == data->props.end()) {
						continue;
					}
					if (isNil(it->second)) {
						continue;
					}
					keys.emplace_back(valueString(id));
				}
				if (keys.empty()) {
					return std::nullopt;
				}
				size_t nextIndex = 0;
				if (!isNil(after)) {
					nextIndex = static_cast<size_t>(-1);
					for (size_t i = 0; i < keys.size(); ++i) {
						if (keys[i] == after) {
							nextIndex = i + 1;
							break;
						}
					}
					if (nextIndex == static_cast<size_t>(-1) || nextIndex >= keys.size()) {
						return std::nullopt;
					}
				}
				const Value key = keys[nextIndex];
				if (valueIsNumber(key)) {
					int index = static_cast<int>(valueToNumber(key)) - 1;
					return std::make_pair(key, data->values[static_cast<size_t>(index)]);
				}
				StringId id = asStringId(key);
				return std::make_pair(key, data->props[id]);
			},
			[data](GcHeap& heap) {
				for (const auto& value : data->values) {
					heap.markValue(value);
				}
				for (const auto& entry : data->props) {
					heap.markValue(entry.second);
				}
			}
		);

		out.push_back(native);
	});

	registerNativeFunction("print", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		std::string text;
		for (size_t i = 0; i < args.size(); ++i) {
			if (i > 0) {
				text += '\t';
			}
			text += valueToString(args[i]);
		}
		std::cerr << text << std::endl;
		EngineCore::instance().log(LogLevel::Info, "%s", text.c_str());
		(void)out;
	});

auto* stringTable = m_cpu.createTable();
	const bool packNativeLittleEndian = []() {
		uint16_t value = 1;
		return *reinterpret_cast<uint8_t*>(&value) == 1;
	}();
	const int packDefaultAlign = 8;
	const int packIntSize = 4;
	const int packLongSize = 4;
	const int packSizeTSize = 4;
	const int packLuaIntegerSize = 8;
	const int packLuaNumberSize = 8;
	enum class PackTokenKind { Pad, Align, Int, Float, Fixed, Z, Len };
	struct PackToken {
		PackTokenKind kind = PackTokenKind::Pad;
		int size = 0;
		bool isSigned = false;
		bool littleEndian = true;
		int align = 1;
		int lenSize = 0;
	};
	auto packParseFormat = [this, packNativeLittleEndian, packDefaultAlign, packIntSize, packLongSize, packSizeTSize, packLuaIntegerSize, packLuaNumberSize](const std::string& format) {
		std::vector<PackToken> tokens;
		size_t index = 0;
		bool littleEndian = packNativeLittleEndian;
		int maxAlign = packDefaultAlign;
		auto readNumber = [&](size_t start, bool& found) -> std::pair<int, size_t> {
			size_t cursor = start;
			int value = 0;
			found = false;
			while (cursor < format.size()) {
				unsigned char ch = static_cast<unsigned char>(format[cursor]);
				if (ch < '0' || ch > '9') {
					break;
				}
				found = true;
				value = value * 10 + (ch - '0');
				cursor += 1;
			}
			return {value, cursor};
		};
		auto pushInt = [&](int size, bool isSigned) {
			if (size < 1 || size > 8) {
				throw BMSX_RUNTIME_ERROR("string.pack invalid integer size " + std::to_string(size) + ".");
			}
			PackToken token;
			token.kind = PackTokenKind::Int;
			token.size = size;
			token.isSigned = isSigned;
			token.littleEndian = littleEndian;
			token.align = std::min(size, maxAlign);
			tokens.push_back(token);
		};
		auto pushFloat = [&](int size) {
			PackToken token;
			token.kind = PackTokenKind::Float;
			token.size = size;
			token.littleEndian = littleEndian;
			token.align = std::min(size, maxAlign);
			tokens.push_back(token);
		};
		while (index < format.size()) {
			char ch = format[index];
			if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') {
				index += 1;
				continue;
			}
			if (ch == '<') {
				littleEndian = true;
				index += 1;
				continue;
			}
			if (ch == '>') {
				littleEndian = false;
				index += 1;
				continue;
			}
			if (ch == '=') {
				littleEndian = packNativeLittleEndian;
				index += 1;
				continue;
			}
			if (ch == '!') {
				bool found = false;
				auto [value, next] = readNumber(index + 1, found);
				if (!found || value <= 0) {
					throw BMSX_RUNTIME_ERROR("string.pack alignment must be a positive integer.");
				}
				maxAlign = value;
				index = next;
				continue;
			}
			if (ch == 'x') {
				PackToken token;
				token.kind = PackTokenKind::Pad;
				tokens.push_back(token);
				index += 1;
				continue;
			}
			if (ch == 'X') {
				PackToken token;
				token.kind = PackTokenKind::Align;
				tokens.push_back(token);
				index += 1;
				continue;
			}
			if (ch == 'b') {
				pushInt(1, true);
				index += 1;
				continue;
			}
			if (ch == 'B') {
				pushInt(1, false);
				index += 1;
				continue;
			}
			if (ch == 'h') {
				pushInt(2, true);
				index += 1;
				continue;
			}
			if (ch == 'H') {
				pushInt(2, false);
				index += 1;
				continue;
			}
			if (ch == 'l') {
				pushInt(packLongSize, true);
				index += 1;
				continue;
			}
			if (ch == 'L') {
				pushInt(packLongSize, false);
				index += 1;
				continue;
			}
			if (ch == 'j') {
				pushInt(packLuaIntegerSize, true);
				index += 1;
				continue;
			}
			if (ch == 'J') {
				pushInt(packLuaIntegerSize, false);
				index += 1;
				continue;
			}
			if (ch == 'T') {
				pushInt(packSizeTSize, false);
				index += 1;
				continue;
			}
			if (ch == 'i' || ch == 'I') {
				bool found = false;
				auto [value, next] = readNumber(index + 1, found);
				const int size = found ? value : packIntSize;
				pushInt(size, ch == 'i');
				index = next;
				continue;
			}
			if (ch == 'f') {
				pushFloat(4);
				index += 1;
				continue;
			}
			if (ch == 'd') {
				pushFloat(8);
				index += 1;
				continue;
			}
			if (ch == 'n') {
				pushFloat(packLuaNumberSize);
				index += 1;
				continue;
			}
			if (ch == 'c') {
				bool found = false;
				auto [value, next] = readNumber(index + 1, found);
				if (!found) {
					throw BMSX_RUNTIME_ERROR("string.pack expected a size for c format.");
				}
				PackToken token;
				token.kind = PackTokenKind::Fixed;
				token.size = value;
				tokens.push_back(token);
				index = next;
				continue;
			}
			if (ch == 'z') {
				PackToken token;
				token.kind = PackTokenKind::Z;
				tokens.push_back(token);
				index += 1;
				continue;
			}
			if (ch == 's') {
				bool found = false;
				auto [value, next] = readNumber(index + 1, found);
				const int lenSize = found ? value : packSizeTSize;
				if (lenSize < 1 || lenSize > 8) {
					throw BMSX_RUNTIME_ERROR("string.pack invalid length size " + std::to_string(lenSize) + ".");
				}
				PackToken token;
				token.kind = PackTokenKind::Len;
				token.lenSize = lenSize;
				token.littleEndian = littleEndian;
				token.align = std::min(lenSize, maxAlign);
				tokens.push_back(token);
				index = next;
				continue;
			}
			throw BMSX_RUNTIME_ERROR(std::string("string.pack unsupported format option '") + ch + "'.");
		}
		return tokens;
	};
	auto packGetNextAlign = [](const std::vector<PackToken>& tokens, size_t startIndex) {
		for (size_t i = startIndex + 1; i < tokens.size(); ++i) {
			const auto& token = tokens[i];
			if (token.kind == PackTokenKind::Pad || token.kind == PackTokenKind::Align) {
				continue;
			}
			if (token.align > 0) {
				return token.align;
			}
			return 1;
		}
		return 1;
	};
	auto packPadToAlign = [](std::vector<uint8_t>& bytes, size_t offset, int align) -> size_t {
		if (align <= 1) {
			return offset;
		}
		const size_t padding = (static_cast<size_t>(align) - (offset % static_cast<size_t>(align))) % static_cast<size_t>(align);
		bytes.insert(bytes.end(), padding, 0);
		return offset + padding;
	};
	auto packReadInteger = [maxSafeInteger](const Value& value) -> int64_t {
		double num = asNumber(value);
		if (!std::isfinite(num) || std::floor(num) != num) {
			throw BMSX_RUNTIME_ERROR("string.pack integer value must be a finite integer.");
		}
		if (std::abs(num) > maxSafeInteger) {
			throw BMSX_RUNTIME_ERROR("string.pack integer value exceeds safe integer range.");
		}
		return static_cast<int64_t>(num);
	};
	auto packWriteInt = [](int64_t value, int size, bool isSigned, bool littleEndian, std::vector<uint8_t>& bytes) {
		if (size < 1 || size > 8) {
			throw BMSX_RUNTIME_ERROR("string.pack invalid integer size.");
		}
		if (isSigned) {
			int64_t minValue = 0;
			int64_t maxValue = 0;
			if (size == 8) {
				minValue = std::numeric_limits<int64_t>::min();
				maxValue = std::numeric_limits<int64_t>::max();
			} else {
				const int shift = size * 8 - 1;
				minValue = -(int64_t(1) << shift);
				maxValue = (int64_t(1) << shift) - 1;
			}
			if (value < minValue || value > maxValue) {
				throw BMSX_RUNTIME_ERROR("string.pack integer value out of range.");
			}
		} else {
			if (value < 0) {
				throw BMSX_RUNTIME_ERROR("string.pack unsigned integer value out of range.");
			}
			uint64_t maxValue = 0;
			if (size == 8) {
				maxValue = std::numeric_limits<uint64_t>::max();
			} else {
				maxValue = (uint64_t(1) << (size * 8)) - 1;
			}
			if (static_cast<uint64_t>(value) > maxValue) {
				throw BMSX_RUNTIME_ERROR("string.pack unsigned integer value out of range.");
			}
		}
		uint64_t unsignedValue = static_cast<uint64_t>(value);
		if (littleEndian) {
			for (int i = 0; i < size; ++i) {
				bytes.push_back(static_cast<uint8_t>((unsignedValue >> (8 * i)) & 0xff));
			}
			return;
		}
		for (int i = size - 1; i >= 0; --i) {
			bytes.push_back(static_cast<uint8_t>((unsignedValue >> (8 * i)) & 0xff));
		}
	};
	auto packReadInt = [maxSafeInteger](const std::string& source, size_t offset, int size, bool isSigned, bool littleEndian) -> int64_t {
		uint64_t value = 0;
		const uint8_t* data = reinterpret_cast<const uint8_t*>(source.data());
		if (littleEndian) {
			for (int i = 0; i < size; ++i) {
				value |= uint64_t(data[offset + static_cast<size_t>(i)]) << (8 * i);
			}
		} else {
			for (int i = 0; i < size; ++i) {
				value = (value << 8) | data[offset + static_cast<size_t>(i)];
			}
		}
		int64_t signedValue = 0;
		if (isSigned) {
			if (size == 8) {
				signedValue = static_cast<int64_t>(value);
			} else {
				const uint64_t signBit = uint64_t(1) << (size * 8 - 1);
				if (value & signBit) {
					const uint64_t mask = ~((uint64_t(1) << (size * 8)) - 1);
					signedValue = static_cast<int64_t>(value | mask);
				} else {
					signedValue = static_cast<int64_t>(value);
				}
			}
		} else {
			if (value > static_cast<uint64_t>(maxSafeInteger)) {
				throw BMSX_RUNTIME_ERROR("string.unpack integer exceeds safe integer range.");
			}
			return static_cast<int64_t>(value);
		}
		if (std::abs(static_cast<double>(signedValue)) > maxSafeInteger) {
			throw BMSX_RUNTIME_ERROR("string.unpack integer exceeds safe integer range.");
		}
		return signedValue;
	};
	auto packWriteFloat = [](double value, int size, bool littleEndian, std::vector<uint8_t>& bytes) {
		uint8_t buffer[8] = {};
		if (size == 4) {
			float f = static_cast<float>(value);
			std::memcpy(buffer, &f, sizeof(float));
		} else {
			std::memcpy(buffer, &value, sizeof(double));
		}
		if (littleEndian) {
			bytes.insert(bytes.end(), buffer, buffer + size);
		} else {
			for (int i = size - 1; i >= 0; --i) {
				bytes.push_back(buffer[i]);
			}
		}
	};
	auto packReadFloat = [](const std::string& source, size_t offset, int size, bool littleEndian) -> double {
		uint8_t buffer[8] = {};
		const uint8_t* data = reinterpret_cast<const uint8_t*>(source.data());
		if (littleEndian) {
			std::memcpy(buffer, data + offset, static_cast<size_t>(size));
		} else {
			for (int i = 0; i < size; ++i) {
				buffer[i] = data[offset + static_cast<size_t>(size - 1 - i)];
			}
		}
		if (size == 4) {
			float value = 0.0f;
			std::memcpy(&value, buffer, sizeof(float));
			return static_cast<double>(value);
		}
		double value = 0.0;
		std::memcpy(&value, buffer, sizeof(double));
		return value;
	};
stringTable->set(key("len"), m_cpu.createNativeFunction("string.len", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	StringId textId = asStringId(args.at(0));
	out.push_back(valueNumber(static_cast<double>(m_cpu.stringPool().codepointCount(textId))));
}));
stringTable->set(key("upper"), m_cpu.createNativeFunction("string.upper", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	out.push_back(str(utf8_to_upper(asText(args.at(0)))));
}));
stringTable->set(key("lower"), m_cpu.createNativeFunction("string.lower", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	out.push_back(str(utf8_to_lower(asText(args.at(0)))));
}));
stringTable->set(key("rep"), m_cpu.createNativeFunction("string.rep", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	int count = args.size() > 1 ? static_cast<int>(std::floor(asNumber(args.at(1)))) : 1;
	if (count <= 0) {
		out.push_back(str(""));
		return;
	}
	bool hasSeparator = args.size() > 2 && !isNil(args.at(2));
	std::string separator = hasSeparator ? std::string(asText(args.at(2))) : std::string();
	std::string result;
	if (hasSeparator) {
		for (int i = 0; i < count; ++i) {
			if (i > 0) {
				result += separator;
			}
			result += text;
		}
	} else {
		result.reserve(text.size() * static_cast<size_t>(count));
		for (int i = 0; i < count; ++i) {
			result += text;
		}
	}
	out.push_back(str(result));
}));
stringTable->set(key("sub"), m_cpu.createNativeFunction("string.sub", [this, str](const std::vector<Value>& args, std::vector<Value>& out) {
	StringId textId = asStringId(args.at(0));
	const std::string& text = m_cpu.stringPool().toString(textId);
	int length = m_cpu.stringPool().codepointCount(textId);
		auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
		};
	int startIndex = args.size() > 1 ? normalizeIndex(asNumber(args.at(1))) : 1;
	int endIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2))) : length;
		if (startIndex < 1) startIndex = 1;
		if (endIndex > length) endIndex = length;
		if (endIndex < startIndex) {
		out.push_back(str(""));
		return;
	}
	size_t startByte = utf8_byte_index_from_codepoint(text, startIndex);
	size_t endByte = utf8_byte_index_from_codepoint(text, endIndex + 1);
	out.push_back(str(text.substr(startByte, endByte - startByte)));
}));
stringTable->set(key("find"), m_cpu.createNativeFunction("string.find", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	StringId sourceId = asStringId(args.at(0));
	const std::string& source = m_cpu.stringPool().toString(sourceId);
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	int length = m_cpu.stringPool().codepointCount(sourceId);
		auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
		};
	int startIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2))) : 1;
	if (startIndex > length) {
		out.push_back(valueNil());
		return;
	}
	size_t startByte = utf8_byte_index_from_codepoint(source, startIndex);
	bool plain = args.size() > 3 && valueIsBool(args.at(3)) && valueToBool(args.at(3)) == true;
	if (plain) {
		size_t position = source.find(pattern, startByte);
		if (position == std::string::npos) {
			out.push_back(valueNil());
			return;
		}
		int first = utf8_codepoint_index_from_byte(source, position);
		int last = utf8_codepoint_index_from_byte(source, position + pattern.length()) - 1;
		out.push_back(valueNumber(static_cast<double>(first)));
		out.push_back(valueNumber(static_cast<double>(last)));
		return;
	}
		const std::regex& regex = buildLuaPatternRegex(pattern);
		std::smatch match;
		auto begin = source.cbegin() + static_cast<std::string::difference_type>(startByte);
		if (!std::regex_search(begin, source.cend(), match, regex)) {
			out.push_back(valueNil());
			return;
		}
	size_t matchStartByte = startByte + static_cast<size_t>(match.position());
	size_t matchEndByte = matchStartByte + static_cast<size_t>(match.length());
	int first = utf8_codepoint_index_from_byte(source, matchStartByte);
	int last = utf8_codepoint_index_from_byte(source, matchEndByte) - 1;
	if (match.size() > 1) {
		out.push_back(valueNumber(static_cast<double>(first)));
		out.push_back(valueNumber(static_cast<double>(last)));
		for (size_t i = 1; i < match.size(); ++i) {
			if (!match[i].matched) {
				out.push_back(valueNil());
			} else {
				out.push_back(str(match[i].str()));
			}
		}
		return;
	}
	out.push_back(valueNumber(static_cast<double>(first)));
	out.push_back(valueNumber(static_cast<double>(last)));
}));
stringTable->set(key("match"), m_cpu.createNativeFunction("string.match", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	StringId sourceId = asStringId(args.at(0));
	const std::string& source = m_cpu.stringPool().toString(sourceId);
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	int length = m_cpu.stringPool().codepointCount(sourceId);
	auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
	};
	int startIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2))) : 1;
	if (startIndex > length) {
		out.push_back(valueNil());
		return;
	}
	const std::regex& regex = buildLuaPatternRegex(pattern);
	size_t startByte = utf8_byte_index_from_codepoint(source, startIndex);
	std::smatch match;
	auto begin = source.cbegin() + static_cast<std::string::difference_type>(startByte);
	if (!std::regex_search(begin, source.cend(), match, regex)) {
		out.push_back(valueNil());
		return;
	}
	if (match.size() > 1) {
		for (size_t i = 1; i < match.size(); ++i) {
			if (!match[i].matched) {
				out.push_back(valueNil());
			} else {
				out.push_back(str(match[i].str()));
			}
		}
		return;
	}
	out.push_back(str(match[0].str()));
}));
stringTable->set(key("gsub"), m_cpu.createNativeFunction("string.gsub", [this, callClosureValue, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& source = asText(args.at(0));
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	const Value replacement = args.size() > 2 ? args.at(2) : str("");
	int maxReplacements = args.size() > 3 && !isNil(args.at(3)) ? std::max(0, static_cast<int>(std::floor(asNumber(args.at(3))))) : std::numeric_limits<int>::max();

	const std::regex& regex = buildLuaPatternRegex(pattern);
	size_t count = 0;
	size_t searchIndex = 0;
	size_t lastIndex = 0;
	std::string result;
	std::vector<Value> fnArgs = acquireValueScratch();
	std::vector<Value> fnResults = acquireValueScratch();

	auto renderReplacement = [&](const std::smatch& match) -> std::string {
		if (valueIsString(replacement) || valueIsNumber(replacement)) {
			const std::string templateStr = valueToString(replacement);
			std::string output;
				for (size_t i = 0; i < templateStr.size(); ++i) {
					if (templateStr[i] == '%' && i + 1 < templateStr.size()) {
						char token = templateStr[i + 1];
						if (token == '%') {
							output.push_back('%');
							++i;
							continue;
						}
						if (token >= '0' && token <= '9') {
							int index = token - '0';
							if (index == 0) {
								output += match[0].str();
							} else if (static_cast<size_t>(index) < match.size() && match[index].matched) {
								output += match[index].str();
							}
							++i;
							continue;
						}
					}
					output.push_back(templateStr[i]);
				}
				return output;
		}
		if (valueIsTable(replacement)) {
			if (match.size() > 1 && !match[1].matched) {
				return match[0].str();
			}
			Value key = match.size() > 1 ? str(match[1].str()) : str(match[0].str());
			Value mapped = asTable(replacement)->get(key);
			if (isNil(mapped)) {
				return match[0].str();
			}
			return valueToString(mapped);
		}
			if (valueIsNativeFunction(replacement) || valueIsClosure(replacement)) {
				fnArgs.clear();
				fnResults.clear();
				if (match.size() > 1) {
					for (size_t i = 1; i < match.size(); ++i) {
						if (match[i].matched) {
							fnArgs.emplace_back(str(match[i].str()));
						} else {
							fnArgs.emplace_back(valueNil());
						}
					}
				} else {
					fnArgs.emplace_back(str(match[0].str()));
				}
				callClosureValue(replacement, fnArgs, fnResults);
				Value value = fnResults.empty() ? valueNil() : fnResults[0];
				if (isNil(value) || (valueIsBool(value) && !valueToBool(value))) {
					return match[0].str();
				}
				return valueToString(value);
			}
			throw BMSX_RUNTIME_ERROR("string.gsub replacement must be a string, number, function, or table.");
		};

		while (count < static_cast<size_t>(maxReplacements)) {
			std::smatch match;
			auto begin = source.begin() + static_cast<std::string::difference_type>(searchIndex);
			if (!std::regex_search(begin, source.end(), match, regex)) {
				break;
			}
			size_t matchStart = searchIndex + static_cast<size_t>(match.position());
			size_t matchEnd = matchStart + static_cast<size_t>(match.length());
			result += source.substr(lastIndex, matchStart - lastIndex);
			result += renderReplacement(match);
			lastIndex = matchEnd;
			count += 1;
			if (match.length() == 0) {
				searchIndex = matchEnd + 1;
				if (searchIndex > source.length()) {
					break;
				}
			} else {
				searchIndex = matchEnd;
			}
	}

	result += source.substr(lastIndex);
	out.push_back(str(result));
	out.push_back(valueNumber(static_cast<double>(count)));
	releaseValueScratch(std::move(fnResults));
	releaseValueScratch(std::move(fnArgs));
}));
stringTable->set(key("gmatch"), m_cpu.createNativeFunction("string.gmatch", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	struct GMatchState {
		const std::regex* regex = nullptr;
		std::string source;
		size_t index = 0;
	};
	const std::string& source = asText(args.at(0));
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	const std::regex& regex = buildLuaPatternRegex(pattern);
	auto state = std::make_shared<GMatchState>();
	state->regex = &regex;
	state->source = source;
	state->index = 0;
	auto iterator = m_cpu.createNativeFunction("string.gmatch.iterator", [state, str](const std::vector<Value>& args, std::vector<Value>& out) {
		(void)args;
		if (state->index > state->source.size()) {
			out.push_back(valueNil());
			return;
		}
		std::smatch match;
		auto begin = state->source.cbegin() + static_cast<std::string::difference_type>(state->index);
		if (!std::regex_search(begin, state->source.cend(), match, *state->regex)) {
			out.push_back(valueNil());
			return;
		}
		size_t matchStart = state->index + static_cast<size_t>(match.position());
		size_t matchEnd = matchStart + static_cast<size_t>(match.length());
			if (match.length() == 0) {
				state->index = matchEnd + 1;
			} else {
				state->index = matchEnd;
			}
			if (match.size() > 1) {
				for (size_t i = 1; i < match.size(); ++i) {
					if (match[i].matched) {
						out.emplace_back(str(match[i].str()));
					} else {
						out.emplace_back(valueNil());
					}
				}
				return;
			}
			out.push_back(str(match[0].str()));
		});
		out.push_back(iterator);
	}));
stringTable->set(key("byte"), m_cpu.createNativeFunction("string.byte", [asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& source = asText(args.at(0));
	int position = args.size() > 1 ? static_cast<int>(std::floor(asNumber(args.at(1)))) : 1;
	if (position < 1) {
		out.push_back(valueNil());
		return;
	}
	size_t byteIndex = utf8_byte_index_from_codepoint(source, position);
	if (byteIndex >= source.size()) {
		out.push_back(valueNil());
		return;
	}
	uint32_t codepoint = utf8_codepoint_at(source, byteIndex);
	out.push_back(valueNumber(static_cast<double>(codepoint)));
}));
stringTable->set(key("char"), m_cpu.createNativeFunction("string.char", [str](const std::vector<Value>& args, std::vector<Value>& out) {
	if (args.empty()) {
		out.push_back(str(""));
		return;
	}
	std::string result;
	result.reserve(args.size());
	for (const auto& arg : args) {
		uint32_t codepoint = static_cast<uint32_t>(std::floor(asNumber(arg)));
		utf8_append_codepoint(result, codepoint);
	}
	out.push_back(str(result));
}));
stringTable->set(key("format"), m_cpu.createNativeFunction("string.format", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& templateStr = asText(args.at(0));
	out.push_back(str(formatLuaString(templateStr, args, 1)));
}));
stringTable->set(key("pack"), m_cpu.createNativeFunction("string.pack", [str, asText, packParseFormat, packGetNextAlign, packPadToAlign, packReadInteger, packWriteInt, packWriteFloat](const std::vector<Value>& args, std::vector<Value>& out) {
	if (args.empty()) {
		throw BMSX_RUNTIME_ERROR("string.pack expects a format string.");
	}
	const std::string& format = asText(args.at(0));
	const std::vector<PackToken> tokens = packParseFormat(format);
	std::vector<uint8_t> bytes;
	size_t offset = 0;
	size_t argIndex = 1;
	auto takeArg = [&]() -> const Value& {
		if (argIndex >= args.size()) {
			throw BMSX_RUNTIME_ERROR("string.pack missing value for format.");
		}
		return args[argIndex++];
	};
	for (size_t i = 0; i < tokens.size(); ++i) {
		const auto& token = tokens[i];
		switch (token.kind) {
			case PackTokenKind::Pad:
				bytes.push_back(0);
				offset += 1;
				break;
			case PackTokenKind::Align: {
				const int align = packGetNextAlign(tokens, i);
				offset = packPadToAlign(bytes, offset, align);
				break;
			}
			case PackTokenKind::Int: {
				offset = packPadToAlign(bytes, offset, token.align);
				const int64_t value = packReadInteger(takeArg());
				packWriteInt(value, token.size, token.isSigned, token.littleEndian, bytes);
				offset += static_cast<size_t>(token.size);
				break;
			}
			case PackTokenKind::Float: {
				offset = packPadToAlign(bytes, offset, token.align);
				const double value = asNumber(takeArg());
				packWriteFloat(value, token.size, token.littleEndian, bytes);
				offset += static_cast<size_t>(token.size);
				break;
			}
			case PackTokenKind::Fixed: {
				const std::string& text = asText(takeArg());
				const size_t length = static_cast<size_t>(token.size);
				for (size_t j = 0; j < length; ++j) {
					bytes.push_back(j < text.size() ? static_cast<uint8_t>(text[j]) : 0);
				}
				offset += length;
				break;
			}
			case PackTokenKind::Z: {
				const std::string& text = asText(takeArg());
				for (size_t j = 0; j < text.size(); ++j) {
					const uint8_t b = static_cast<uint8_t>(text[j]);
					if (b == 0) {
						throw BMSX_RUNTIME_ERROR("string.pack z strings must not contain zero bytes.");
					}
					bytes.push_back(b);
				}
				bytes.push_back(0);
				offset += text.size() + 1;
				break;
			}
			case PackTokenKind::Len: {
				offset = packPadToAlign(bytes, offset, token.align);
				const std::string& text = asText(takeArg());
				const int64_t length = static_cast<int64_t>(text.size());
				packWriteInt(length, token.lenSize, false, token.littleEndian, bytes);
				offset += static_cast<size_t>(token.lenSize);
				for (size_t j = 0; j < text.size(); ++j) {
					bytes.push_back(static_cast<uint8_t>(text[j]));
				}
				offset += text.size();
				break;
			}
			default:
				throw BMSX_RUNTIME_ERROR("string.pack invalid format token.");
		}
	}
	std::string packed;
	packed.resize(bytes.size());
	if (!bytes.empty()) {
		std::memcpy(packed.data(), bytes.data(), bytes.size());
	}
	out.push_back(str(packed));
}));
stringTable->set(key("packsize"), m_cpu.createNativeFunction("string.packsize", [asText, packParseFormat, packGetNextAlign](const std::vector<Value>& args, std::vector<Value>& out) {
	if (args.empty()) {
		throw BMSX_RUNTIME_ERROR("string.packsize expects a format string.");
	}
	const std::string& format = asText(args.at(0));
	const std::vector<PackToken> tokens = packParseFormat(format);
	size_t offset = 0;
	for (size_t i = 0; i < tokens.size(); ++i) {
		const auto& token = tokens[i];
		switch (token.kind) {
			case PackTokenKind::Pad:
				offset += 1;
				break;
			case PackTokenKind::Align: {
				const int align = packGetNextAlign(tokens, i);
				const size_t padding = (static_cast<size_t>(align) - (offset % static_cast<size_t>(align))) % static_cast<size_t>(align);
				offset += padding;
				break;
			}
			case PackTokenKind::Int: {
				const size_t padding = (static_cast<size_t>(token.align) - (offset % static_cast<size_t>(token.align))) % static_cast<size_t>(token.align);
				offset += padding + static_cast<size_t>(token.size);
				break;
			}
			case PackTokenKind::Float: {
				const size_t padding = (static_cast<size_t>(token.align) - (offset % static_cast<size_t>(token.align))) % static_cast<size_t>(token.align);
				offset += padding + static_cast<size_t>(token.size);
				break;
			}
			case PackTokenKind::Fixed:
				offset += static_cast<size_t>(token.size);
				break;
			case PackTokenKind::Z:
			case PackTokenKind::Len:
				throw BMSX_RUNTIME_ERROR("string.packsize format is variable-length.");
			default:
				throw BMSX_RUNTIME_ERROR("string.packsize invalid format token.");
		}
	}
	out.push_back(valueNumber(static_cast<double>(offset)));
}));
stringTable->set(key("unpack"), m_cpu.createNativeFunction("string.unpack", [str, asText, packParseFormat, packGetNextAlign, packReadInt, packReadFloat](const std::vector<Value>& args, std::vector<Value>& out) {
	if (args.size() < 2) {
		throw BMSX_RUNTIME_ERROR("string.unpack expects a format string and source string.");
	}
	const std::string& format = asText(args.at(0));
	const std::string& source = asText(args.at(1));
	const double startValue = args.size() > 2 ? asNumber(args.at(2)) : 1.0;
	const int startIndex = static_cast<int>(std::floor(startValue));
	if (startIndex < 1 || startIndex > static_cast<int>(source.size()) + 1) {
		throw BMSX_RUNTIME_ERROR("string.unpack start index out of range.");
	}
	const std::vector<PackToken> tokens = packParseFormat(format);
	size_t offset = static_cast<size_t>(startIndex - 1);
	auto ensure = [&](size_t length) {
		if (offset + length > source.size()) {
			throw BMSX_RUNTIME_ERROR("string.unpack string is too short.");
		}
	};
	for (size_t i = 0; i < tokens.size(); ++i) {
		const auto& token = tokens[i];
		switch (token.kind) {
			case PackTokenKind::Pad:
				ensure(1);
				offset += 1;
				break;
			case PackTokenKind::Align: {
				const int align = packGetNextAlign(tokens, i);
				const size_t padding = (static_cast<size_t>(align) - (offset % static_cast<size_t>(align))) % static_cast<size_t>(align);
				ensure(padding);
				offset += padding;
				break;
			}
			case PackTokenKind::Int: {
				const size_t padding = (static_cast<size_t>(token.align) - (offset % static_cast<size_t>(token.align))) % static_cast<size_t>(token.align);
				ensure(padding + static_cast<size_t>(token.size));
				offset += padding;
				const int64_t value = packReadInt(source, offset, token.size, token.isSigned, token.littleEndian);
				out.push_back(valueNumber(static_cast<double>(value)));
				offset += static_cast<size_t>(token.size);
				break;
			}
			case PackTokenKind::Float: {
				const size_t padding = (static_cast<size_t>(token.align) - (offset % static_cast<size_t>(token.align))) % static_cast<size_t>(token.align);
				ensure(padding + static_cast<size_t>(token.size));
				offset += padding;
				const double value = packReadFloat(source, offset, token.size, token.littleEndian);
				out.push_back(valueNumber(value));
				offset += static_cast<size_t>(token.size);
				break;
			}
			case PackTokenKind::Fixed: {
				ensure(static_cast<size_t>(token.size));
				out.push_back(str(std::string(source.data() + offset, static_cast<size_t>(token.size))));
				offset += static_cast<size_t>(token.size);
				break;
			}
			case PackTokenKind::Z: {
				size_t end = offset;
				while (end < source.size() && source[end] != '\0') {
					end += 1;
				}
				if (end >= source.size()) {
					throw BMSX_RUNTIME_ERROR("string.unpack zero-terminated string not found.");
				}
				out.push_back(str(std::string(source.data() + offset, end - offset)));
				offset = end + 1;
				break;
			}
			case PackTokenKind::Len: {
				const size_t padding = (static_cast<size_t>(token.align) - (offset % static_cast<size_t>(token.align))) % static_cast<size_t>(token.align);
				ensure(padding + static_cast<size_t>(token.lenSize));
				offset += padding;
				const int64_t length = packReadInt(source, offset, token.lenSize, false, token.littleEndian);
				if (length < 0) {
					throw BMSX_RUNTIME_ERROR("string.unpack invalid length.");
				}
				offset += static_cast<size_t>(token.lenSize);
				ensure(static_cast<size_t>(length));
				out.push_back(str(std::string(source.data() + offset, static_cast<size_t>(length))));
				offset += static_cast<size_t>(length);
				break;
			}
			default:
				throw BMSX_RUNTIME_ERROR("string.unpack invalid format token.");
		}
	}
	out.push_back(valueNumber(static_cast<double>(offset + 1)));
}));

	m_cpu.setStringIndexTable(stringTable);
	setGlobal("string", valueTable(stringTable));

	auto* tableLib = m_cpu.createTable();
tableLib->set(key("insert"), m_cpu.createNativeFunction("table.insert", [](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	int position = 0;
	Value value;
	if (args.size() == 2) {
			value = args.at(1);
			position = tbl->length() + 1;
		} else {
			position = static_cast<int>(std::floor(asNumber(args.at(1))));
			value = args.at(2);
		}
		int length = tbl->length();
	for (int i = length; i >= position; --i) {
		tbl->set(valueNumber(static_cast<double>(i + 1)), tbl->get(valueNumber(static_cast<double>(i))));
	}
	tbl->set(valueNumber(static_cast<double>(position)), value);
	(void)out;
}));
tableLib->set(key("remove"), m_cpu.createNativeFunction("table.remove", [](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	int position = args.size() > 1 ? static_cast<int>(std::floor(asNumber(args.at(1)))) : tbl->length();
	int length = tbl->length();
	Value removed = tbl->get(valueNumber(static_cast<double>(position)));
		for (int i = position; i < length; ++i) {
			tbl->set(valueNumber(static_cast<double>(i)), tbl->get(valueNumber(static_cast<double>(i + 1))));
	}
	tbl->set(valueNumber(static_cast<double>(length)), valueNil());
	if (isNil(removed)) {
		return;
	}
	out.push_back(removed);
}));
tableLib->set(key("concat"), m_cpu.createNativeFunction("table.concat", [this, str](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	const std::string separator = args.size() > 1 ? valueToString(args.at(1)) : std::string("");
	int length = tbl->length();
	auto normalizeIndex = [length](double value, int fallback) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return fallback;
		};
	int startIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2)), 1) : 1;
	int endIndex = args.size() > 3 ? normalizeIndex(asNumber(args.at(3)), length) : length;
	if (endIndex < startIndex) {
		out.push_back(str(""));
		return;
	}
	std::string output;
	for (int i = startIndex; i <= endIndex; ++i) {
		if (i > startIndex) {
				output += separator;
			}
			Value value = tbl->get(valueNumber(static_cast<double>(i)));
		if (!isNil(value)) {
			output += valueToString(value);
		}
	}
	out.push_back(str(output));
}));
const Value packCountKey = key("n");
tableLib->set(key("pack"), m_cpu.createNativeFunction("table.pack", [this, packCountKey](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = m_cpu.createTable(static_cast<int>(args.size()), 1);
	for (size_t i = 0; i < args.size(); ++i) {
		tbl->set(valueNumber(static_cast<double>(i + 1)), args[i]);
	}
	tbl->set(packCountKey, valueNumber(static_cast<double>(args.size())));
	out.push_back(valueTable(tbl));
}));
tableLib->set(key("unpack"), m_cpu.createNativeFunction("table.unpack", [](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	int length = tbl->length();
	auto normalizeIndex = [length](double value, int fallback) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return fallback;
		};
	int startIndex = args.size() > 1 ? normalizeIndex(asNumber(args.at(1)), 1) : 1;
	int endIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2)), length) : length;
	if (endIndex < startIndex) {
		return;
	}
	for (int i = startIndex; i <= endIndex; ++i) {
		out.push_back(tbl->get(valueNumber(static_cast<double>(i))));
	}
}));
tableLib->set(key("sort"), m_cpu.createNativeFunction("table.sort", [this, callClosureValue](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	Value comparator = args.size() > 1 ? args.at(1) : valueNil();
	int length = tbl->length();
	std::vector<Value> values = acquireValueScratch();
	values.resize(static_cast<size_t>(length));
	for (int i = 1; i <= length; ++i) {
		values[static_cast<size_t>(i - 1)] = tbl->get(valueNumber(static_cast<double>(i)));
	}
	std::vector<Value> comparatorArgs = acquireValueScratch();
	comparatorArgs.resize(2);
	std::vector<Value> comparatorResults = acquireValueScratch();
	std::sort(values.begin(), values.end(), [&](const Value& left, const Value& right) -> bool {
		if (!isNil(comparator)) {
			comparatorArgs[0] = left;
			comparatorArgs[1] = right;
			comparatorResults.clear();
			callClosureValue(comparator, comparatorArgs, comparatorResults);
			return !comparatorResults.empty() && valueIsBool(comparatorResults[0]) && valueToBool(comparatorResults[0]) == true;
		}
		if (valueIsNumber(left) && valueIsNumber(right)) {
			return valueToNumber(left) < valueToNumber(right);
		}
		if (valueIsString(left) && valueIsString(right)) {
			return Runtime::instance().cpu().stringPool().toString(asStringId(left))
				< Runtime::instance().cpu().stringPool().toString(asStringId(right));
		}
		throw BMSX_RUNTIME_ERROR("table.sort comparison expects numbers or strings.");
	});
	for (int i = 1; i <= length; ++i) {
		tbl->set(valueNumber(static_cast<double>(i)), values[static_cast<size_t>(i - 1)]);
	}
	out.push_back(valueTable(tbl));
	releaseValueScratch(std::move(comparatorResults));
	releaseValueScratch(std::move(comparatorArgs));
	releaseValueScratch(std::move(values));
}));

	setGlobal("table", valueTable(tableLib));

auto* osTable = m_cpu.createTable();
const Value yearKey = key("year");
const Value monthKey = key("month");
const Value dayKey = key("day");
const Value hourKey = key("hour");
const Value minuteKey = key("min");
const Value secondKey = key("sec");
const Value wdayKey = key("wday");
const Value ydayKey = key("yday");
const Value isdstKey = key("isdst");
osTable->set(key("clock"), m_cpu.createNativeFunction("os.clock", [](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(EngineCore::instance().clock()->now() / 1000.0));
}));
osTable->set(key("time"), m_cpu.createNativeFunction("os.time", [yearKey, monthKey, dayKey, hourKey, minuteKey, secondKey](const std::vector<Value>& args, std::vector<Value>& out) {
	if (!args.empty() && !isNil(args.at(0))) {
		auto* table = asTable(args.at(0));
		std::tm timeInfo{};
		timeInfo.tm_year = static_cast<int>(asNumber(table->get(yearKey))) - 1900;
		timeInfo.tm_mon = static_cast<int>(asNumber(table->get(monthKey))) - 1;
		timeInfo.tm_mday = static_cast<int>(asNumber(table->get(dayKey)));
		timeInfo.tm_hour = static_cast<int>(asNumber(table->get(hourKey)));
		timeInfo.tm_min = static_cast<int>(asNumber(table->get(minuteKey)));
		timeInfo.tm_sec = static_cast<int>(asNumber(table->get(secondKey)));
		timeInfo.tm_isdst = -1;
		out.push_back(valueNumber(static_cast<double>(std::mktime(&timeInfo))));
		return;
	}
	out.push_back(valueNumber(static_cast<double>(std::time(nullptr))));
}));
osTable->set(key("difftime"), m_cpu.createNativeFunction("os.difftime", [](const std::vector<Value>& args, std::vector<Value>& out) {
	double t2 = asNumber(args.at(0));
	double t1 = asNumber(args.at(1));
	out.push_back(valueNumber(t2 - t1));
}));
osTable->set(key("date"), m_cpu.createNativeFunction("os.date", [str, yearKey, monthKey, dayKey, hourKey, minuteKey, secondKey, wdayKey, ydayKey, isdstKey](const std::vector<Value>& args, std::vector<Value>& out) {
	std::string format = args.empty() || isNil(args.at(0)) ? std::string("%c") : Runtime::instance().cpu().stringPool().toString(asStringId(args.at(0)));
	std::time_t timeValue = args.size() > 1 && !isNil(args.at(1))
		? static_cast<std::time_t>(asNumber(args.at(1)))
		: std::time(nullptr);
	std::tm timeInfo = *std::localtime(&timeValue);
	if (format == "*t") {
		auto* table = Runtime::instance().cpu().createTable(0, 9);
		table->set(yearKey, valueNumber(static_cast<double>(timeInfo.tm_year + 1900)));
		table->set(monthKey, valueNumber(static_cast<double>(timeInfo.tm_mon + 1)));
		table->set(dayKey, valueNumber(static_cast<double>(timeInfo.tm_mday)));
		table->set(hourKey, valueNumber(static_cast<double>(timeInfo.tm_hour)));
		table->set(minuteKey, valueNumber(static_cast<double>(timeInfo.tm_min)));
		table->set(secondKey, valueNumber(static_cast<double>(timeInfo.tm_sec)));
		table->set(wdayKey, valueNumber(static_cast<double>(timeInfo.tm_wday + 1)));
		table->set(ydayKey, valueNumber(static_cast<double>(timeInfo.tm_yday + 1)));
		table->set(isdstKey, valueBool(timeInfo.tm_isdst > 0));
		out.push_back(valueTable(table));
		return;
	}
	char buffer[256];
	size_t size = std::strftime(buffer, sizeof(buffer), format.c_str(), &timeInfo);
	out.push_back(str(std::string(buffer, size)));
}));
	setGlobal("os", valueTable(osTable));

auto nextFn = m_cpu.createNativeFunction("next", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const Value& target = args.at(0);
	const Value key = args.size() > 1 ? args.at(1) : valueNil();
	if (valueIsTable(target)) {
		auto entry = asTable(target)->nextEntry(key);
		if (!entry.has_value()) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(entry->first);
		out.push_back(entry->second);
		return;
	}
	if (valueIsNativeObject(target)) {
		auto* obj = asNativeObject(target);
		if (!obj->nextEntry) {
			throw BMSX_RUNTIME_ERROR("next expects a native object with iteration.");
		}
		auto entry = obj->nextEntry(key);
		if (!entry.has_value()) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(entry->first);
		out.push_back(entry->second);
		return;
	}
	throw BMSX_RUNTIME_ERROR("next expects a table or native object.");
});

m_ipairsIterator = m_cpu.createNativeFunction("ipairs.iterator", [](const std::vector<Value>& args, std::vector<Value>& out) {
	const Value& target = args.at(0);
	double index = 0.0;
	if (args.size() > 1 && valueIsNumber(args.at(1))) {
		index = valueToNumber(args.at(1));
	}
	double nextIndex = index + 1.0;
	if (valueIsTable(target)) {
		Value value = asTable(target)->get(valueNumber(nextIndex));
		if (isNil(value)) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(valueNumber(nextIndex));
		out.push_back(value);
		return;
	}
	if (valueIsNativeObject(target)) {
		Value value = asNativeObject(target)->get(valueNumber(nextIndex));
		if (isNil(value)) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(valueNumber(nextIndex));
		out.push_back(value);
		return;
	}
	throw BMSX_RUNTIME_ERROR("ipairs expects a table or native object.");
});

	setGlobal("next", nextFn);
	registerNativeFunction("pairs", [nextFn](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& target = args.at(0);
		if (!valueIsTable(target) && !valueIsNativeObject(target)) {
			throw BMSX_RUNTIME_ERROR("pairs expects a table or native object.");
		}
		out.push_back(nextFn);
		out.push_back(target);
		out.push_back(valueNil());
	});
	registerNativeFunction("ipairs", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& target = args.at(0);
		if (!valueIsTable(target) && !valueIsNativeObject(target)) {
			throw BMSX_RUNTIME_ERROR("ipairs expects a table or native object.");
		}
		out.push_back(m_ipairsIterator);
		out.push_back(target);
		out.push_back(valueNumber(0.0));
	});

	const RuntimeAssets& assets = EngineCore::instance().assets();
	auto* assetsTable = m_cpu.createTable();
	auto formatAssetKeyNumber = [](double value) -> std::string {
		if (value == 0.0) {
			return "0";
		}
		std::ostringstream oss;
		oss << std::fixed << std::setprecision(0) << value;
		return oss.str();
	};
	auto formatAssetTokenKey = [](AssetToken token) -> std::string {
		const uint32_t hi = static_cast<uint32_t>((token >> 32) & 0xffffffffu);
		const uint32_t lo = static_cast<uint32_t>(token & 0xffffffffu);
		std::ostringstream oss;
		oss << std::hex << std::nouppercase << std::setfill('0')
			<< std::setw(8) << hi
			<< std::setw(8) << lo;
		return oss.str();
	};
	auto makeAssetMapNativeObject = [this, formatAssetKeyNumber](Table* mapTable) -> Value {
		return m_cpu.createNativeObject(
			mapTable,
			[this, mapTable, formatAssetKeyNumber](const Value& keyValue) -> Value {
				if (valueIsString(keyValue)) {
					Value value = mapTable->get(keyValue);
					if (isNil(value)) {
						const std::string& keyName = m_cpu.stringPool().toString(asStringId(keyValue));
						throw BMSX_RUNTIME_ERROR("Asset '" + keyName + "' does not exist.");
					}
					return value;
				}
				if (valueIsNumber(keyValue)) {
					double n = valueToNumber(keyValue);
					double intpart = 0.0;
					if (std::isfinite(n) && std::modf(n, &intpart) == 0.0) {
						std::string keyName = formatAssetKeyNumber(n);
						Value resolvedKey = valueString(m_cpu.internString(keyName));
						Value value = mapTable->get(resolvedKey);
						if (isNil(value)) {
							throw BMSX_RUNTIME_ERROR("Asset '" + keyName + "' does not exist.");
						}
						return value;
					}
				}
				throw BMSX_RUNTIME_ERROR("Attempted to retrieve an asset that did not use a string or integer key.");
			},
			[this, mapTable, formatAssetKeyNumber](const Value& keyValue, const Value& value) {
				if (valueIsString(keyValue)) {
					mapTable->set(keyValue, value);
					return;
				}
				if (valueIsNumber(keyValue)) {
					double n = valueToNumber(keyValue);
					double intpart = 0.0;
					if (std::isfinite(n) && std::modf(n, &intpart) == 0.0) {
						std::string keyName = formatAssetKeyNumber(n);
						Value resolvedKey = valueString(m_cpu.internString(keyName));
						mapTable->set(resolvedKey, value);
						return;
					}
				}
				throw BMSX_RUNTIME_ERROR("Attempted to index native object with unsupported key. Asset maps and methods require string or integer keys.");
			},
			nullptr,
			[mapTable](const Value& after) -> std::optional<std::pair<Value, Value>> {
				return mapTable->nextEntry(after);
			},
			[mapTable](GcHeap& heap) {
				heap.markValue(valueTable(mapTable));
			}
		);
	};
	auto appendRomAssetFields = [key, str](Table* table, const RomAssetInfo& info, std::string_view resid) {
		table->set(key("resid"), str(resid));
		if (!info.type.empty()) {
			table->set(key("type"), str(info.type));
		}
		if (info.op) {
			table->set(key("op"), str(*info.op));
		}
		if (info.start) {
			table->set(key("start"), valueNumber(static_cast<double>(*info.start)));
		}
		if (info.end) {
			table->set(key("end"), valueNumber(static_cast<double>(*info.end)));
		}
		if (info.compiledStart) {
			table->set(key("compiled_start"), valueNumber(static_cast<double>(*info.compiledStart)));
		}
		if (info.compiledEnd) {
			table->set(key("compiled_end"), valueNumber(static_cast<double>(*info.compiledEnd)));
		}
		if (info.metabufferStart) {
			table->set(key("metabuffer_start"), valueNumber(static_cast<double>(*info.metabufferStart)));
		}
		if (info.metabufferEnd) {
			table->set(key("metabuffer_end"), valueNumber(static_cast<double>(*info.metabufferEnd)));
		}
		if (info.textureStart) {
			table->set(key("texture_start"), valueNumber(static_cast<double>(*info.textureStart)));
		}
		if (info.textureEnd) {
			table->set(key("texture_end"), valueNumber(static_cast<double>(*info.textureEnd)));
		}
		if (info.sourcePath) {
			table->set(key("source_path"), str(*info.sourcePath));
		}
		if (info.normalizedSourcePath) {
			table->set(key("normalized_source_path"), str(*info.normalizedSourcePath));
		}
		if (info.updateTimestamp) {
			table->set(key("update_timestamp"), valueNumber(static_cast<double>(*info.updateTimestamp)));
		}
		if (info.payloadId) {
			table->set(key("payload_id"), str(*info.payloadId));
		}
	};
	auto appendBinEntry = [this, str, formatAssetTokenKey](Table* table, AssetToken token, const BinValue& value) {
		table->set(str(formatAssetTokenKey(token)), binValueToRuntimeValue(m_cpu, value));
	};
	const int imgCapacity = static_cast<int>(assets.img.size() + (assets.fallback ? assets.fallback->img.size() : 0));
	auto* imgTable = m_cpu.createTable(0, imgCapacity);
	auto appendImgEntry = [this, imgTable, key, str, appendRomAssetFields, formatAssetTokenKey](AssetToken token, const ImgAsset& imgAsset) {
		auto* imgEntry = m_cpu.createTable(0, 8);
		appendRomAssetFields(imgEntry, imgAsset.rom, imgAsset.id);
		imgEntry->set(key("imgmeta"), valueTable(buildImgMetaTable(m_cpu, imgAsset.meta, key)));
		imgTable->set(str(formatAssetTokenKey(token)), valueTable(imgEntry));
	};
	if (assets.fallback) {
		for (const auto& entry : assets.fallback->img) {
			appendImgEntry(entry.first, entry.second);
		}
	}
	for (const auto& entry : assets.img) {
		appendImgEntry(entry.first, entry.second);
	}
	assetsTable->set(key("img"), makeAssetMapNativeObject(imgTable));

	const int dataCapacity = static_cast<int>(assets.data.size() + (assets.fallback ? assets.fallback->data.size() : 0));
	auto* dataTable = m_cpu.createTable(0, dataCapacity);
	if (assets.fallback) {
		for (const auto& entry : assets.fallback->data) {
			appendBinEntry(dataTable, entry.first, entry.second.value);
		}
	}
	for (const auto& entry : assets.data) {
		appendBinEntry(dataTable, entry.first, entry.second.value);
	}
	assetsTable->set(key("data"), makeAssetMapNativeObject(dataTable));
	const int audioCapacity = static_cast<int>(assets.audio.size() + (assets.fallback ? assets.fallback->audio.size() : 0));
	auto* audioTable = m_cpu.createTable(0, audioCapacity);
	auto appendAudioEntry = [this, audioTable, key, str, appendRomAssetFields, formatAssetTokenKey](AssetToken token, const AudioAsset& audioAsset) {
		auto* audioEntry = m_cpu.createTable(0, 6);
		appendRomAssetFields(audioEntry, audioAsset.rom, audioAsset.id);
		audioEntry->set(key("audiometa"), valueTable(buildAudioMetaTable(m_cpu, audioAsset.meta, key)));
		audioTable->set(str(formatAssetTokenKey(token)), valueTable(audioEntry));
	};
	if (assets.fallback) {
		for (const auto& entry : assets.fallback->audio) {
			appendAudioEntry(entry.first, entry.second);
		}
	}
	for (const auto& entry : assets.audio) {
		appendAudioEntry(entry.first, entry.second);
	}
	assetsTable->set(key("audio"), makeAssetMapNativeObject(audioTable));
	const int audioEventCapacity = static_cast<int>(assets.audioevents.size() + (assets.fallback ? assets.fallback->audioevents.size() : 0));
	auto* audioEventsTable = m_cpu.createTable(0, audioEventCapacity);
	if (assets.fallback) {
		for (const auto& entry : assets.fallback->audioevents) {
			appendBinEntry(audioEventsTable, entry.first, entry.second.value);
		}
	}
	for (const auto& entry : assets.audioevents) {
		appendBinEntry(audioEventsTable, entry.first, entry.second.value);
	}
	assetsTable->set(key("audioevents"), makeAssetMapNativeObject(audioEventsTable));
	const int modelCapacity = static_cast<int>(assets.model.size() + (assets.fallback ? assets.fallback->model.size() : 0));
	auto* modelTable = m_cpu.createTable(0, modelCapacity);
	auto appendModelEntry = [this, modelTable, key, str, formatAssetTokenKey](AssetToken token, const ModelAsset& modelAsset) {
		modelTable->set(str(formatAssetTokenKey(token)), valueTable(buildModelAssetTable(m_cpu, modelAsset, key)));
	};
	if (assets.fallback) {
		for (const auto& entry : assets.fallback->model) {
			appendModelEntry(entry.first, entry.second);
		}
	}
	for (const auto& entry : assets.model) {
		appendModelEntry(entry.first, entry.second);
	}
	assetsTable->set(key("model"), makeAssetMapNativeObject(modelTable));
	assetsTable->set(key("project_root_path"), str(assets.projectRootPath));
	auto assetsNative = m_cpu.createNativeObject(
		assetsTable,
		[this, assetsTable, formatAssetKeyNumber](const Value& keyValue) -> Value {
			if (valueIsString(keyValue)) {
				Value value = assetsTable->get(keyValue);
				if (isNil(value)) {
					const std::string& keyName = m_cpu.stringPool().toString(asStringId(keyValue));
					throw BMSX_RUNTIME_ERROR("Asset '" + keyName + "' does not exist.");
				}
				return value;
			}
			if (valueIsNumber(keyValue)) {
				double n = valueToNumber(keyValue);
				double intpart = 0.0;
				if (std::isfinite(n) && std::modf(n, &intpart) == 0.0) {
					std::string keyName = formatAssetKeyNumber(n);
					Value resolvedKey = valueString(m_cpu.internString(keyName));
					Value value = assetsTable->get(resolvedKey);
					if (isNil(value)) {
						throw BMSX_RUNTIME_ERROR("Asset '" + keyName + "' does not exist.");
					}
					return value;
				}
			}
			throw BMSX_RUNTIME_ERROR("Attempted to retrieve an asset that did not use a string or integer key.");
		},
		[this, assetsTable, formatAssetKeyNumber](const Value& keyValue, const Value& value) {
			if (valueIsString(keyValue)) {
				assetsTable->set(keyValue, value);
				return;
			}
			if (valueIsNumber(keyValue)) {
				double n = valueToNumber(keyValue);
				double intpart = 0.0;
				if (std::isfinite(n) && std::modf(n, &intpart) == 0.0) {
					std::string keyName = formatAssetKeyNumber(n);
					Value resolvedKey = valueString(m_cpu.internString(keyName));
					assetsTable->set(resolvedKey, value);
					return;
				}
			}
			throw BMSX_RUNTIME_ERROR("Attempted to index native object with unsupported key. Asset maps and methods require string or integer keys.");
		},
		nullptr,
		[assetsTable](const Value& after) -> std::optional<std::pair<Value, Value>> {
			return assetsTable->nextEntry(after);
		},
		[assetsTable](GcHeap& heap) {
			heap.markValue(valueTable(assetsTable));
		}
	);
	setGlobal("assets", assetsNative);

	auto canonicalizationLabel = [](CanonicalizationType value) -> const char* {
		switch (value) {
			case CanonicalizationType::Upper:
				return "upper";
			case CanonicalizationType::Lower:
				return "lower";
			case CanonicalizationType::None:
			default:
				return "none";
		}
	};
	auto buildManifestTable = [this, key, str, canonicalizationLabel](const RuntimeAssets& source) -> Table* {
		const RomManifest& manifest = source.manifest;
		auto* manifestTable = m_cpu.createTable();
		const std::string_view title = manifest.title.empty() ? manifest.name : manifest.title;
		if (!title.empty()) {
			manifestTable->set(key("title"), str(title));
		}
		const std::string_view romName = manifest.romName.empty() ? manifest.name : manifest.romName;
		if (!romName.empty()) {
			manifestTable->set(key("rom_name"), str(romName));
		}
		const std::string_view shortName = manifest.shortName.empty() ? romName : manifest.shortName;
		if (!shortName.empty()) {
			manifestTable->set(key("short_name"), str(shortName));
		}
		auto* machineTable = m_cpu.createTable(0, 3);
		if (!manifest.namespaceName.empty()) {
			machineTable->set(key("namespace"), str(manifest.namespaceName));
		}
		machineTable->set(key("canonicalization"), str(canonicalizationLabel(manifest.canonicalization)));
		if (manifest.ufpsScaled) {
			machineTable->set(key("ufps"), valueNumber(static_cast<double>(*manifest.ufpsScaled)));
		}
		if (manifest.viewportWidth > 0 && manifest.viewportHeight > 0) {
			auto* viewportTable = m_cpu.createTable(0, 2);
			viewportTable->set(key("width"), valueNumber(static_cast<double>(manifest.viewportWidth)));
			viewportTable->set(key("height"), valueNumber(static_cast<double>(manifest.viewportHeight)));
			machineTable->set(key("viewport"), valueTable(viewportTable));
		}
		auto* specsTable = m_cpu.createTable(0, 4);
		auto* cpuTable = m_cpu.createTable(0, 2);
		if (manifest.cpuHz) {
			cpuTable->set(key("cpu_freq_hz"), valueNumber(static_cast<double>(*manifest.cpuHz)));
		}
		if (manifest.imgDecBytesPerSec) {
			cpuTable->set(key("imgdec_bytes_per_sec"), valueNumber(static_cast<double>(*manifest.imgDecBytesPerSec)));
		}
		specsTable->set(key("cpu"), valueTable(cpuTable));
		auto* dmaTable = m_cpu.createTable(0, 2);
		if (manifest.dmaBytesPerSecIso) {
			dmaTable->set(key("dma_bytes_per_sec_iso"), valueNumber(static_cast<double>(*manifest.dmaBytesPerSecIso)));
		}
		if (manifest.dmaBytesPerSecBulk) {
			dmaTable->set(key("dma_bytes_per_sec_bulk"), valueNumber(static_cast<double>(*manifest.dmaBytesPerSecBulk)));
		}
		specsTable->set(key("dma"), valueTable(dmaTable));
		if (manifest.ramBytes || manifest.stringHandleCount || manifest.stringHeapBytes || manifest.assetTableBytes || manifest.assetDataBytes) {
			auto* ramTable = m_cpu.createTable(0, 5);
			if (manifest.ramBytes) {
				ramTable->set(key("ram_bytes"), valueNumber(static_cast<double>(*manifest.ramBytes)));
			}
			if (manifest.stringHandleCount) {
				ramTable->set(key("string_handle_count"), valueNumber(static_cast<double>(*manifest.stringHandleCount)));
			}
			if (manifest.stringHeapBytes) {
				ramTable->set(key("string_heap_bytes"), valueNumber(static_cast<double>(*manifest.stringHeapBytes)));
			}
			if (manifest.assetTableBytes) {
				ramTable->set(key("asset_table_bytes"), valueNumber(static_cast<double>(*manifest.assetTableBytes)));
			}
			if (manifest.assetDataBytes) {
				ramTable->set(key("asset_data_bytes"), valueNumber(static_cast<double>(*manifest.assetDataBytes)));
			}
			specsTable->set(key("ram"), valueTable(ramTable));
		}
		if (manifest.atlasSlotBytes || manifest.engineAtlasSlotBytes || manifest.stagingBytes || manifest.skyboxFaceSize > 0 || manifest.skyboxFaceBytes) {
			auto* vramTable = m_cpu.createTable(0, 5);
			if (manifest.atlasSlotBytes) {
				vramTable->set(key("atlas_slot_bytes"), valueNumber(static_cast<double>(*manifest.atlasSlotBytes)));
			}
			if (manifest.engineAtlasSlotBytes) {
				vramTable->set(key("system_atlas_slot_bytes"), valueNumber(static_cast<double>(*manifest.engineAtlasSlotBytes)));
			}
			if (manifest.stagingBytes) {
				vramTable->set(key("staging_bytes"), valueNumber(static_cast<double>(*manifest.stagingBytes)));
			}
			if (manifest.skyboxFaceSize > 0) {
				vramTable->set(key("skybox_face_size"), valueNumber(static_cast<double>(manifest.skyboxFaceSize)));
			}
			if (manifest.skyboxFaceBytes) {
				vramTable->set(key("skybox_face_bytes"), valueNumber(static_cast<double>(*manifest.skyboxFaceBytes)));
			}
			specsTable->set(key("vram"), valueTable(vramTable));
		}
		if (manifest.vblankCycles) {
			auto* vdpTable = m_cpu.createTable(0, 1);
			vdpTable->set(key("vblank_cycles"), valueNumber(static_cast<double>(*manifest.vblankCycles)));
			specsTable->set(key("vdp"), valueTable(vdpTable));
		}
		if (manifest.maxVoicesSfx || manifest.maxVoicesMusic || manifest.maxVoicesUi) {
			auto* audioTable = m_cpu.createTable(0, 1);
			auto* voicesTable = m_cpu.createTable(0, 3);
			if (manifest.maxVoicesSfx) {
				voicesTable->set(key("sfx"), valueNumber(static_cast<double>(*manifest.maxVoicesSfx)));
			}
			if (manifest.maxVoicesMusic) {
				voicesTable->set(key("music"), valueNumber(static_cast<double>(*manifest.maxVoicesMusic)));
			}
			if (manifest.maxVoicesUi) {
				voicesTable->set(key("ui"), valueNumber(static_cast<double>(*manifest.maxVoicesUi)));
			}
			audioTable->set(key("max_voices"), valueTable(voicesTable));
			specsTable->set(key("audio"), valueTable(audioTable));
		}
		machineTable->set(key("specs"), valueTable(specsTable));
		manifestTable->set(key("machine"), valueTable(machineTable));
		auto* luaTable = m_cpu.createTable(0, 1);
		luaTable->set(key("entry_path"), str(manifest.entryPoint));
		manifestTable->set(key("lua"), valueTable(luaTable));
		return manifestTable;
	};
	const RuntimeAssets* engineAssets = assets.fallback ? assets.fallback : &assets;
	assetsTable->set(key("manifest"), valueTable(buildManifestTable(assets)));
	assetsTable->set(key("canonicalization"), str(canonicalizationLabel(assets.canonicalization)));
	setGlobal("cart_manifest", valueTable(buildManifestTable(assets)));
	setGlobal("sys_manifest", valueTable(buildManifestTable(*engineAssets)));

	auto viewSize = EngineCore::instance().view()->viewportSize;
	auto* viewportTable = m_cpu.createTable(0, 2);
	viewportTable->set(key("x"), valueNumber(static_cast<double>(viewSize.x)));
	viewportTable->set(key("y"), valueNumber(static_cast<double>(viewSize.y)));
	auto* view = EngineCore::instance().view();
	auto* viewTable = m_cpu.createTable(0, 8);
	viewTable->set(key("crt_postprocessing_enabled"), valueBool(view->crt_postprocessing_enabled));
	viewTable->set(key("enable_noise"), valueBool(view->applyNoise));
	viewTable->set(key("enable_colorbleed"), valueBool(view->applyColorBleed));
	viewTable->set(key("enable_scanlines"), valueBool(view->applyScanlines));
	viewTable->set(key("enable_blur"), valueBool(view->applyBlur));
	viewTable->set(key("enable_glow"), valueBool(view->applyGlow));
	viewTable->set(key("enable_fringing"), valueBool(view->applyFringing));
	viewTable->set(key("enable_aperture"), valueBool(view->applyAperture));

auto clockNowFn = m_cpu.createNativeFunction("platform.clock.now", [](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(EngineCore::instance().clock()->now()));
});
auto clockPerfNowFn = m_cpu.createNativeFunction("platform.clock.perf_now", [](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(to_ms(std::chrono::steady_clock::now().time_since_epoch())));
});
	auto* clockTable = m_cpu.createTable(0, 2);
	clockTable->set(key("now"), clockNowFn);
	clockTable->set(key("perf_now"), clockPerfNowFn);
	auto* platformTable = m_cpu.createTable(0, 1);
	platformTable->set(key("clock"), valueTable(clockTable));

	auto makeActionStateTable = [this, key, str](const ActionState& state) -> Table* {
		auto* table = m_cpu.createTable(0, 18);
		table->set(key("action"), str(state.action));
		table->set(key("pressed"), valueBool(state.pressed));
		table->set(key("justpressed"), valueBool(state.justpressed));
		table->set(key("justreleased"), valueBool(state.justreleased));
		table->set(key("waspressed"), valueBool(state.waspressed));
		table->set(key("wasreleased"), valueBool(state.wasreleased));
		table->set(key("consumed"), valueBool(state.consumed));
		table->set(key("alljustpressed"), valueBool(state.alljustpressed));
		table->set(key("allwaspressed"), valueBool(state.allwaspressed));
		table->set(key("alljustreleased"), valueBool(state.alljustreleased));
		if (state.guardedjustpressed.has_value()) {
			table->set(key("guardedjustpressed"), valueBool(state.guardedjustpressed.value()));
		}
		if (state.repeatpressed.has_value()) {
			table->set(key("repeatpressed"), valueBool(state.repeatpressed.value()));
		}
		if (state.repeatcount.has_value()) {
			table->set(key("repeatcount"), valueNumber(static_cast<double>(state.repeatcount.value())));
		}
		if (state.presstime.has_value()) {
			table->set(key("presstime"), valueNumber(static_cast<double>(state.presstime.value())));
		}
		if (state.timestamp.has_value()) {
			table->set(key("timestamp"), valueNumber(static_cast<double>(state.timestamp.value())));
		}
		if (state.pressedAtMs.has_value()) {
			table->set(key("pressedAtMs"), valueNumber(static_cast<double>(state.pressedAtMs.value())));
		}
		if (state.releasedAtMs.has_value()) {
			table->set(key("releasedAtMs"), valueNumber(static_cast<double>(state.releasedAtMs.value())));
		}
		if (state.pressId.has_value()) {
			table->set(key("pressId"), valueNumber(static_cast<double>(state.pressId.value())));
		}
		table->set(key("value"), valueNumber(static_cast<double>(state.value)));
		if (state.value2d.has_value()) {
			auto* value2d = m_cpu.createTable(0, 2);
			value2d->set(key("x"), valueNumber(static_cast<double>(state.value2d->x)));
			value2d->set(key("y"), valueNumber(static_cast<double>(state.value2d->y)));
			table->set(key("value2d"), valueTable(value2d));
		}
		return table;
	};

auto getActionStateFn = m_cpu.createNativeFunction("game.get_action_state", [this, makeActionStateTable](const std::vector<Value>& args, std::vector<Value>& out) {
	int playerIndex = m_playerIndex;
	std::string action;
	std::optional<f64> windowMs;
	if (args.size() == 1) {
			action = m_cpu.stringPool().toString(asStringId(args.at(0)));
		} else {
			playerIndex = static_cast<int>(std::floor(asNumber(args.at(0))));
			action = m_cpu.stringPool().toString(asStringId(args.at(1)));
			if (args.size() > 2 && !isNil(args.at(2))) {
				windowMs = asNumber(args.at(2));
			}
	}
	PlayerInput* input = Input::instance().getPlayerInput(playerIndex);
	ActionState state = input->getActionState(action, windowMs);
	out.push_back(valueTable(makeActionStateTable(state)));
});

auto consumeActionFn = m_cpu.createNativeFunction("game.consume_action", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int playerIndex = m_playerIndex;
	std::string action;
	if (args.size() == 1) {
		action = m_cpu.stringPool().toString(asStringId(args.at(0)));
		} else {
			playerIndex = static_cast<int>(std::floor(asNumber(args.at(0))));
		action = m_cpu.stringPool().toString(asStringId(args.at(1)));
	}
	Input::instance().getPlayerInput(playerIndex)->consumeAction(action);
	(void)out;
});

auto emitFn = m_cpu.createNativeFunction("game.emit", [](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	(void)out;
});

auto getFrameDeltaMsFn = m_cpu.createNativeFunction("game.get_frame_delta_ms", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(frameDeltaMs()));
});

	auto* gameTable = m_cpu.createTable(0, 11);
	gameTable->set(key("platform"), valueTable(platformTable));
	gameTable->set(key("viewportsize"), valueTable(viewportTable));
	gameTable->set(key("view"), valueTable(viewTable));
	gameTable->set(key("emit"), emitFn);
	gameTable->set(key("get_frame_delta_ms"), getFrameDeltaMsFn);
	gameTable->set(key("get_action_state"), getActionStateFn);
	gameTable->set(key("consume_action"), consumeActionFn);
	setGlobal("game", valueTable(gameTable));
	setGlobal("$", valueTable(gameTable));

}

} // namespace bmsx
