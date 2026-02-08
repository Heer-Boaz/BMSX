#include "program_loader.h"
#include "../serializer/binencoder.h"
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
	throw BMSX_RUNTIME_ERROR("ProgramLoader: unknown const reloc kind '" + kind + "'.");
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
		SourceRange range;
		range.path = rangeVal.require("path").asString();
		const auto& startObj = rangeVal.require("start");
		const auto& endObj = rangeVal.require("end");
		range.startLine = startObj.require("line").toI32();
		range.startColumn = startObj.require("column").toI32();
		range.endLine = endObj.require("line").toI32();
		range.endColumn = endObj.require("column").toI32();
		metadata->debugRanges.push_back(range);
	}
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
