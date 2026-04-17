#include "machine/program/loader.h"
#include "common/serializer/binencoder.h"
#include <cstring>
#include <stdexcept>

namespace bmsx {

namespace {

ProgramAsset::ConstRelocKind parseConstRelocKind(const std::string& kind) {
	if (kind == "bx") {
		return ProgramAsset::ConstRelocKind::Bx;
	}
	if (kind == "rk_b") {
		return ProgramAsset::ConstRelocKind::RkB;
	}
	if (kind == "rk_c") {
		return ProgramAsset::ConstRelocKind::RkC;
	}
	// Lua 5.4-style specialized table ops such as GETFIELD/SETFIELD/GETI/SETI patch a plain
	// const operand in B/C. Treating them as legacy RK relocations corrupts the linked bytecode.
	if (kind == "const_b") {
		return ProgramAsset::ConstRelocKind::ConstB;
	}
	if (kind == "const_c") {
		return ProgramAsset::ConstRelocKind::ConstC;
	}
	if (kind == "gl") {
		return ProgramAsset::ConstRelocKind::Gl;
	}
	if (kind == "sys") {
		return ProgramAsset::ConstRelocKind::Sys;
	}
	throw BMSX_RUNTIME_ERROR("ProgramLoader: unknown const reloc kind '" + kind + "'.");
}

SourceRange parseSourceRange(const BinValue& rangeVal) {
	SourceRange range;
	range.path = rangeVal.require("path").asString();
	const auto& startObj = rangeVal.require("start");
	const auto& endObj = rangeVal.require("end");
	range.startLine = startObj.require("line").toI32();
	range.startColumn = startObj.require("column").toI32();
	range.endLine = endObj.require("line").toI32();
	range.endColumn = endObj.require("column").toI32();
	return range;
}

LocalSlotDebug parseLocalSlotDebug(const BinValue& slotVal) {
	LocalSlotDebug slot;
	slot.name = slotVal.require("name").asString();
	slot.reg = slotVal.require("register").toI32();
	slot.definition = parseSourceRange(slotVal.require("definition"));
	slot.scope = parseSourceRange(slotVal.require("scope"));
	return slot;
}

std::vector<std::string> parseStringArray(const BinValue& arrayVal) {
	const auto& array = arrayVal.asArray();
	std::vector<std::string> values;
	values.reserve(array.size());
	for (const auto& entry : array) {
		values.push_back(entry.asString());
	}
	return values;
}

} // namespace

/**
 * Convert BinValue to runtime Value (for const pool).
 */
Value binValueToRuntimeValue(const BinValue& bv, StringPool& stringPool) {
	if (bv.isNull()) return valueNil();
	if (bv.isBool()) return valueBool(bv.asBool());
	if (bv.isNumber()) return valueNumber(bv.toNumber());
	if (bv.isString()) return valueString(stringPool.intern(bv.asString()));
	// Tables/closures not in const pool
	return valueNil();
}

/**
 * Extract Program from decoded ProgramAsset.
 */
std::unique_ptr<Program> extractProgram(const BinValue& programObj) {
	auto program = std::make_unique<Program>();
	program->constPoolStringPool = &program->stringPool;

	// Extract code (Uint8Array stored as binary)
	const auto& codeBytes = programObj.require("code").asBinary();
	program->code.resize(codeBytes.size());
	std::memcpy(program->code.data(), codeBytes.data(), codeBytes.size());

	// Extract constPool
	const auto& constPoolArr = programObj.require("constPool").asArray();
	program->constPool.reserve(constPoolArr.size());
	for (const auto& cv : constPoolArr) {
		program->constPool.push_back(binValueToRuntimeValue(cv, program->stringPool));
	}

	// Extract protos
	const auto& protosArr = programObj.require("protos").asArray();
	program->protos.reserve(protosArr.size());
	for (const auto& protoObj : protosArr) {
		Proto proto;
		proto.maxStack = protoObj.require("maxStack").toI32();
		proto.numParams = protoObj.require("numParams").toI32();
		proto.entryPC = protoObj.require("entryPC").toI32();
		proto.isVararg = protoObj.require("isVararg").asBool();

		const auto& upvaluesArr = protoObj.require("upvalueDescs").asArray();
		proto.upvalues.reserve(upvaluesArr.size());
		for (const auto& uvObj : upvaluesArr) {
			UpvalueDesc uv;
			uv.isLocal = uvObj.require("inStack").asBool();
			uv.index = uvObj.require("index").toI32();
			proto.upvalues.push_back(uv);
		}

		program->protos.push_back(std::move(proto));
	}

	return program;
}

std::unique_ptr<ProgramMetadata> extractProgramMetadata(const BinValue& metadataObj) {
	auto metadata = std::make_unique<ProgramMetadata>();
	const auto& protoIdsArr = metadataObj.require("protoIds").asArray();
	metadata->protoIds.reserve(protoIdsArr.size());
	for (const auto& idVal : protoIdsArr) {
		metadata->protoIds.push_back(idVal.asString());
	}
	const auto& rangesArr = metadataObj.require("debugRanges").asArray();
	metadata->debugRanges.reserve(rangesArr.size());
	for (const auto& rangeVal : rangesArr) {
		if (rangeVal.isNull()) {
			metadata->debugRanges.push_back(std::nullopt);
			continue;
		}
		metadata->debugRanges.push_back(parseSourceRange(rangeVal));
	}

	const auto& slotsByProtoArr = metadataObj.require("localSlotsByProto").asArray();
	metadata->localSlotsByProto.resize(slotsByProtoArr.size());
	for (size_t protoIndex = 0; protoIndex < slotsByProtoArr.size(); ++protoIndex) {
		const auto& protoSlotsArr = slotsByProtoArr[protoIndex].asArray();
		auto& slots = metadata->localSlotsByProto[protoIndex];
		slots.reserve(protoSlotsArr.size());
		for (const auto& slotVal : protoSlotsArr) {
			slots.push_back(parseLocalSlotDebug(slotVal));
		}
	}
	if (metadata->localSlotsByProto.size() != metadata->protoIds.size()) {
		throw BMSX_RUNTIME_ERROR("ProgramLoader: localSlotsByProto length does not match protoIds length.");
	}

	const auto& upvalueNamesByProtoArr = metadataObj.require("upvalueNamesByProto").asArray();
	metadata->upvalueNamesByProto.resize(upvalueNamesByProtoArr.size());
	for (size_t protoIndex = 0; protoIndex < upvalueNamesByProtoArr.size(); ++protoIndex) {
		metadata->upvalueNamesByProto[protoIndex] = parseStringArray(upvalueNamesByProtoArr[protoIndex]);
	}
	if (metadata->upvalueNamesByProto.size() != metadata->protoIds.size()) {
		throw BMSX_RUNTIME_ERROR("ProgramLoader: upvalueNamesByProto length does not match protoIds length.");
	}

	metadata->systemGlobalNames = parseStringArray(metadataObj.require("systemGlobalNames"));
	metadata->globalNames = parseStringArray(metadataObj.require("globalNames"));
	return metadata;
}

std::unique_ptr<ProgramAsset> ProgramLoader::load(const uint8_t* data, size_t size) {
	// Decode binary format using binencoder
	BinValue root = decodeBinary(data, size);

	if (!root.isObject()) {
		throw BMSX_RUNTIME_ERROR("ProgramLoader: expected object at root");
	}

	auto asset = std::make_unique<ProgramAsset>();

	// Extract entryProtoIndex
	asset->entryProtoIndex = root.require("entryProtoIndex").toI32();

	// Extract program
	asset->program = extractProgram(root.require("program"));

	// Extract moduleProtos
	const auto& moduleProtosArr = root.require("moduleProtos").asArray();
	asset->moduleProtos.reserve(moduleProtosArr.size());
	for (const auto& mp : moduleProtosArr) {
		std::string path = mp.require("path").asString();
		int protoIndex = mp.require("protoIndex").toI32();
		asset->moduleProtos.emplace_back(std::move(path), protoIndex);
	}

	// Extract moduleAliases
	const auto& moduleAliasesArr = root.require("moduleAliases").asArray();
	asset->moduleAliases.reserve(moduleAliasesArr.size());
	for (const auto& ma : moduleAliasesArr) {
		std::string alias = ma.require("alias").asString();
		std::string path = ma.require("path").asString();
		asset->moduleAliases.emplace_back(std::move(alias), std::move(path));
	}

	// Extract link metadata (required).
	const auto& linkObj = root.require("link");
	const auto& constRelocsArr = linkObj.require("constRelocs").asArray();
	asset->link.constRelocs.reserve(constRelocsArr.size());
	for (const auto& relocObj : constRelocsArr) {
		ProgramAsset::ConstReloc reloc;
		reloc.wordIndex = relocObj.require("wordIndex").toI32();
		reloc.constIndex = relocObj.require("constIndex").toI32();
		reloc.kind = parseConstRelocKind(relocObj.require("kind").asString());
		asset->link.constRelocs.push_back(reloc);
	}

	return asset;
}

std::unique_ptr<ProgramMetadata> ProgramLoader::loadSymbols(const uint8_t* data, size_t size) {
	BinValue root = decodeBinary(data, size);

	if (!root.isObject()) {
		throw BMSX_RUNTIME_ERROR("ProgramLoader: expected object at root");
	}

	return extractProgramMetadata(root.require("metadata"));
}

} // namespace bmsx
