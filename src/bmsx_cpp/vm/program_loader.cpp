#include "program_loader.h"
#include "../core/binencoder.h"
#include <cstring>
#include <stdexcept>

namespace bmsx {

/**
 * Convert BinValue to VM Value (for const pool).
 */
Value binValueToVmValue(const BinValue& bv, StringPool& stringPool) {
	if (bv.isNull()) return valueNil();
	if (bv.isBool()) return valueBool(bv.asBool());
	if (bv.isNumber()) return valueNumber(bv.toNumber());
	if (bv.isString()) return valueString(stringPool.intern(bv.asString()));
	// Tables/closures not in const pool
	return valueNil();
}

/**
 * Extract Program from decoded VmProgramAsset.
 */
std::unique_ptr<Program> extractProgram(const BinValue& programObj) {
	auto program = std::make_unique<Program>();

	// Extract code (Uint8Array stored as binary)
	const auto& codeBytes = programObj["code"].asBinary();
	program->code.resize(codeBytes.size());
	std::memcpy(program->code.data(), codeBytes.data(), codeBytes.size());

	// Extract constPool
	const auto& constPoolArr = programObj["constPool"].asArray();
	program->constPool.reserve(constPoolArr.size());
	for (const auto& cv : constPoolArr) {
		program->constPool.push_back(binValueToVmValue(cv, program->stringPool));
	}

	// Extract protos
	const auto& protosArr = programObj["protos"].asArray();
	program->protos.reserve(protosArr.size());
	for (const auto& protoObj : protosArr) {
		Proto proto;
		proto.maxStack = protoObj["maxStack"].toI32();
		proto.numParams = protoObj["numParams"].toI32();
		proto.entryPC = protoObj["entryPC"].toI32();
		proto.isVararg = protoObj["isVararg"].asBool();

		const auto& upvaluesArr = protoObj["upvalueDescs"].asArray();
		proto.upvalues.reserve(upvaluesArr.size());
		for (const auto& uvObj : upvaluesArr) {
			UpvalueDesc uv;
			uv.isLocal = uvObj["inStack"].asBool();
			uv.index = uvObj["index"].toI32();
			proto.upvalues.push_back(uv);
		}

		program->protos.push_back(std::move(proto));
	}

	return program;
}

std::unique_ptr<ProgramMetadata> extractProgramMetadata(const BinValue& metadataObj) {
	auto metadata = std::make_unique<ProgramMetadata>();
	const auto& protoIdsArr = metadataObj["protoIds"].asArray();
	metadata->protoIds.reserve(protoIdsArr.size());
	for (const auto& idVal : protoIdsArr) {
		metadata->protoIds.push_back(idVal.asString());
	}
	const auto& rangesArr = metadataObj["debugRanges"].asArray();
	metadata->debugRanges.reserve(rangesArr.size());
	for (const auto& rangeVal : rangesArr) {
		if (rangeVal.isNull()) {
			metadata->debugRanges.push_back(std::nullopt);
			continue;
		}
		SourceRange range;
		range.path = rangeVal["path"].asString();
		const auto& startObj = rangeVal["start"];
		const auto& endObj = rangeVal["end"];
		range.startLine = startObj["line"].toI32();
		range.startColumn = startObj["column"].toI32();
		range.endLine = endObj["line"].toI32();
		range.endColumn = endObj["column"].toI32();
		metadata->debugRanges.push_back(range);
	}
	return metadata;
}

std::unique_ptr<VmProgramAsset> ProgramLoader::load(const uint8_t* data, size_t size) {
	// Decode binary format using binencoder
	BinValue root = decodeBinary(data, size);

	if (!root.isObject()) {
		throw std::runtime_error("ProgramLoader: expected object at root");
	}

	auto asset = std::make_unique<VmProgramAsset>();

	// Extract entryProtoIndex
	asset->entryProtoIndex = root["entryProtoIndex"].toI32();

	// Extract program
	asset->program = extractProgram(root["program"]);

	if (root.has("metadata")) {
		asset->metadata = extractProgramMetadata(root["metadata"]);
	}

	// Extract moduleProtos
	const auto& moduleProtosArr = root["moduleProtos"].asArray();
	asset->moduleProtos.reserve(moduleProtosArr.size());
	for (const auto& mp : moduleProtosArr) {
		std::string path = mp["path"].asString();
		int protoIndex = mp["protoIndex"].toI32();
		asset->moduleProtos.emplace_back(std::move(path), protoIndex);
	}

	// Extract moduleAliases
	const auto& moduleAliasesArr = root["moduleAliases"].asArray();
	asset->moduleAliases.reserve(moduleAliasesArr.size());
	for (const auto& ma : moduleAliasesArr) {
		std::string alias = ma["alias"].asString();
		std::string path = ma["path"].asString();
		asset->moduleAliases.emplace_back(std::move(alias), std::move(path));
	}

	return asset;
}

} // namespace bmsx
