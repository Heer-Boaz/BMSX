#include "machine/runtime/runtime.h"
#include "machine/firmware/system_globals.h"
#include "machine/common/number_format.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include "common/time.h"
#include "rompack/format.h"
#include "rompack/loader.h"
#include "common/serializer/binencoder.h"
#include "common/clamp.h"
#include <array>
#include <cmath>

namespace bmsx {
namespace {
struct LuaBootPrimitive {
	std::string_view name;
	BuiltinFunctionId id;
};

constexpr std::array<LuaBootPrimitive, 12> LUA_BOOT_PRIMITIVES{{
	{ "__bmsx_next", BuiltinFunctionId::Next },
	{ "__bmsx_type", BuiltinFunctionId::Type },
	{ "__bmsx_setmetatable", BuiltinFunctionId::SetMetatable },
	{ "__bmsx_getmetatable", BuiltinFunctionId::GetMetatable },
	{ "__bmsx_rawget", BuiltinFunctionId::RawGet },
	{ "__bmsx_rawset", BuiltinFunctionId::RawSet },
	{ "__bmsx_select", BuiltinFunctionId::Select },
	{ "__bmsx_string_byte", BuiltinFunctionId::StringByte },
	{ "__bmsx_string_char", BuiltinFunctionId::StringChar },
	{ "__bmsx_error", BuiltinFunctionId::Error },
	{ "__bmsx_pcall", BuiltinFunctionId::PCall },
	{ "__bmsx_xpcall", BuiltinFunctionId::XPCall },
}};

template <typename Container>
Table* buildNumericArrayTable(CPU& cpu, const Container& values);

template <typename T, typename BuildFn>
Table* buildTableArray(CPU& cpu, const std::vector<T>& values, const BuildFn& buildFn);

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
		table->set(valueNumber(static_cast<double>(index + 1)), valueString(cpu.stringPool().intern(values[index])));
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

const char* modelMaterialAlphaModeName(ModelMaterialAlphaMode alphaMode) {
	static constexpr std::array<const char*, 3> names{"OPAQUE", "MASK", "BLEND"};
	return names[static_cast<size_t>(alphaMode)];
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
	table->set(key("alphaMode"), valueString(cpu.stringPool().intern(modelMaterialAlphaModeName(material.alphaMode))));
	table->set(key("alphaCutoff"), valueNumber(static_cast<double>(material.alphaCutoff)));
	table->set(key("doubleSided"), valueBool(material.doubleSided));
	table->set(key("unlit"), valueBool(material.unlit));
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
	table->set(key("interpolation"), valueString(cpu.stringPool().intern(sampler.interpolation)));
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
	target->set(key("path"), valueString(cpu.stringPool().intern(channel.target.path)));
	table->set(key("target"), valueTable(target));
	return table;
}

template <typename KeyFn>
Table* buildModelAnimationTable(CPU& cpu, const ModelAnimation& animation, const KeyFn& key) {
	auto* table = cpu.createTable(0, 3);
	if (animation.name) {
		table->set(key("name"), valueString(cpu.stringPool().intern(animation.name.value())));
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
	table->set(key("name"), valueString(cpu.stringPool().intern(asset.id)));
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

}

std::string Runtime::valueToString(const Value& value) const {
	if (isNil(value)) {
		return "nil";
	}
	if (valueIsBool(value)) {
		return valueToBool(value) ? "true" : "false";
	}
	if (valueIsNumber(value)) {
		double n = asNumber(value);
		if (!std::isfinite(n)) {
			return "nan";
		}
		return formatNumber(n);
	}
	if (valueIsString(value)) {
		return machine.cpu.stringPool().toString(asStringId(value));
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


void Runtime::setupBuiltins() {
	CPU& cpu = machine.cpu;
	cpu.suspendGc();
	struct ResumeBuiltinGc {
		CPU& cpu;
		~ResumeBuiltinGc() {
			cpu.resumeGc();
		}
	} resumeBuiltinGc{ cpu };

	auto key = [this](std::string_view name) {
		return internString(name);
	};
	auto str = [&cpu](std::string_view value) {
		return valueString(cpu.stringPool().intern(value));
	};
	seedSystemGlobals(*this);

	setGlobal("sys_print_char", valueNumber(static_cast<double>(IO_SYS_PRINT_CHAR)));
	setGlobal("sys_print_flush", valueNumber(static_cast<double>(IO_SYS_PRINT_FLUSH)));

	for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
		setGlobal(primitive.name, cpu.createBuiltinFunction(primitive.id));
	}
	auto* stringTable = cpu.createTable();

	machine.cpu.setStringIndexTable(stringTable);
	setGlobal("string", valueTable(stringTable));

	auto* tableLib = cpu.createTable();
	setGlobal("table", valueTable(tableLib));

	auto* osTable = cpu.createTable();
	setGlobal("os", valueTable(osTable));

	auto buildMachineManifestTable = [&cpu, key, str](const MachineManifest& manifest) -> Table* {
		auto* machineTable = cpu.createTable(0, 2);
		if (!manifest.namespaceName.empty()) {
			machineTable->set(key("namespace"), str(manifest.namespaceName));
		}
		machineTable->set(key("vdp_class"), str("psx"));
		return machineTable;
	};
	auto buildCartManifestTable = [&cpu, key, str, buildMachineManifestTable](const CartManifest& manifest, const MachineManifest& machine, const std::string& entryPath) -> Table* {
		auto* manifestTable = cpu.createTable();
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
		manifestTable->set(key("machine"), valueTable(buildMachineManifestTable(machine)));
		auto* luaTable = cpu.createTable(0, 1);
		luaTable->set(key("entry_path"), str(entryPath));
		manifestTable->set(key("lua"), valueTable(luaTable));
		return manifestTable;
	};
	const CartManifest* cartManifest = this->cartManifest();
	const std::string* cartEntryPath = this->cartEntryPath();
	setGlobal("cart_manifest", cartManifest ? valueTable(buildCartManifestTable(*cartManifest, machineManifest(), *cartEntryPath)) : valueNil());
	setGlobal("machine_manifest", valueTable(buildMachineManifestTable(machineManifest())));


}

void Runtime::clearLuaBootPrimitives() {
	for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
		setGlobal(primitive.name, valueNil());
	}
}

} // namespace bmsx
