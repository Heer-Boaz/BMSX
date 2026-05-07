#include "machine/program/loader.h"
#include "common/serializer/binencoder.h"
#include <cstring>
#include <stdexcept>

namespace bmsx {

namespace {

struct ConstRelocKindEntry {
	const char* name;
	ProgramImage::ConstRelocKind kind;
};

constexpr ConstRelocKindEntry CONST_RELOC_KIND_ENTRIES[] = {
	{"bx", ProgramImage::ConstRelocKind::Bx},
	{"rk_b", ProgramImage::ConstRelocKind::RkB},
	{"rk_c", ProgramImage::ConstRelocKind::RkC},
	{"const_b", ProgramImage::ConstRelocKind::ConstB},
	{"const_c", ProgramImage::ConstRelocKind::ConstC},
	{"gl", ProgramImage::ConstRelocKind::Gl},
	{"sys", ProgramImage::ConstRelocKind::Sys},
	{"module", ProgramImage::ConstRelocKind::Module},
};

ProgramImage::ConstRelocKind parseConstRelocKind(const std::string& kind) {
	for (const auto& entry : CONST_RELOC_KIND_ENTRIES) {
		if (kind == entry.name) {
			return entry.kind;
		}
	}
	// Lua 5.4-style specialized table ops such as GETFIELD/SETFIELD/GETI/SETI patch a plain
	// const operand in B/C. Treating them as legacy RK relocations corrupts the linked bytecode.
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

std::vector<std::string> readStringArray(const BinValue& value, const std::string& context) {
	if (!value.isArray()) {
		throw BMSX_RUNTIME_ERROR(context + " expected array.");
	}
	const auto& array = value.asArray();
	std::vector<std::string> out;
	out.reserve(array.size());
	for (const auto& entry : array) {
		if (!entry.isString()) {
			throw BMSX_RUNTIME_ERROR(context + " expected string entries.");
		}
		out.push_back(entry.asString());
	}
	return out;
}

EncodedValue binValueToEncodedValue(const BinValue& value) {
	if (value.isNull()) return nullptr;
	if (value.isBool()) return value.asBool();
	if (value.isNumber()) return value.toNumber();
	if (value.isString()) return value.asString();
	throw BMSX_RUNTIME_ERROR("ProgramLoader: unsupported ProgramImage.sections.rodata.constPool value.");
}

Value encodedValueToRuntimeValue(const EncodedValue& value, StringPool& stringPool) {
	if (std::holds_alternative<std::nullptr_t>(value)) return valueNil();
	if (const auto* boolValue = std::get_if<bool>(&value)) return valueBool(*boolValue);
	if (const auto* numberValue = std::get_if<double>(&value)) return valueNumber(*numberValue);
	if (const auto* stringValue = std::get_if<std::string>(&value)) return valueString(stringPool.intern(*stringValue));
	throw BMSX_RUNTIME_ERROR("ProgramLoader: unsupported encoded const pool value.");
}

ProgramTextSection extractTextSection(const BinValue& textObj) {
	ProgramTextSection text;
	const auto& codeBytes = textObj.require("code").asBinary();
	text.code.resize(codeBytes.size());
	std::memcpy(text.code.data(), codeBytes.data(), codeBytes.size());

	const auto& protosArr = textObj.require("protos").asArray();
	text.protos.reserve(protosArr.size());
	for (const auto& protoObj : protosArr) {
		Proto proto;
		proto.maxStack = protoObj.require("maxStack").toI32();
		proto.numParams = protoObj.require("numParams").toI32();
		proto.entryPC = protoObj.require("entryPC").toI32();
		proto.isVararg = protoObj.require("isVararg").asBool();
		proto.staticClosure = protoObj.require("staticClosure").asBool();

		const auto& upvaluesArr = protoObj.require("upvalueDescs").asArray();
		proto.upvalues.reserve(upvaluesArr.size());
		for (const auto& uvObj : upvaluesArr) {
			UpvalueDesc uv;
			uv.isLocal = uvObj.require("inStack").asBool();
			uv.index = uvObj.require("index").toI32();
			proto.upvalues.push_back(uv);
		}

		text.protos.push_back(std::move(proto));
	}
	return text;
}

ProgramRodataSection extractRodataSection(const BinValue& rodataObj) {
	ProgramRodataSection rodata;
	const auto& constPoolArr = rodataObj.require("constPool").asArray();
	rodata.constPool.reserve(constPoolArr.size());
	for (const auto& cv : constPoolArr) {
		rodata.constPool.push_back(binValueToEncodedValue(cv));
	}

	const auto& moduleProtosArr = rodataObj.require("moduleProtos").asArray();
	rodata.moduleProtos.reserve(moduleProtosArr.size());
	for (const auto& mp : moduleProtosArr) {
		std::string path = mp.require("path").asString();
		int protoIndex = mp.require("protoIndex").toI32();
		rodata.moduleProtos.emplace_back(std::move(path), protoIndex);
	}

	rodata.staticModulePaths = readStringArray(rodataObj.require("staticModulePaths"), "ProgramLoader: ProgramImage.sections.rodata.staticModulePaths");
	return rodata;
}

ProgramDataSection extractDataSection(const BinValue& dataObj) {
	ProgramDataSection data;
	const auto& bytes = dataObj.require("bytes").asBinary();
	data.bytes.assign(bytes.begin(), bytes.end());
	return data;
}

ProgramBssSection extractBssSection(const BinValue& bssObj) {
	ProgramBssSection bss;
	bss.byteCount = static_cast<size_t>(bssObj.require("byteCount").toI32());
	return bss;
}

ProgramObjectSections extractProgramObjectSections(const BinValue& sectionsObj) {
	ProgramObjectSections sections;
	sections.text = extractTextSection(sectionsObj.require("text"));
	sections.rodata = extractRodataSection(sectionsObj.require("rodata"));
	sections.data = extractDataSection(sectionsObj.require("data"));
	sections.bss = extractBssSection(sectionsObj.require("bss"));
	return sections;
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
		metadata->upvalueNamesByProto[protoIndex] = readStringArray(upvalueNamesByProtoArr[protoIndex], "ProgramLoader: upvalueNamesByProto entry");
	}
	if (metadata->upvalueNamesByProto.size() != metadata->protoIds.size()) {
		throw BMSX_RUNTIME_ERROR("ProgramLoader: upvalueNamesByProto length does not match protoIds length.");
	}

	metadata->systemGlobalNames = readStringArray(metadataObj.require("systemGlobalNames"), "ProgramLoader: systemGlobalNames");
	metadata->globalNames = readStringArray(metadataObj.require("globalNames"), "ProgramLoader: globalNames");
	return metadata;
}

} // namespace

std::unique_ptr<Program> inflateProgram(const ProgramObjectSections& sections) {
	auto program = std::make_unique<Program>();
	program->code = sections.text.code;
	program->protos = sections.text.protos;
	program->constPool.reserve(sections.rodata.constPool.size());
	for (const EncodedValue& value : sections.rodata.constPool) {
		program->constPool.push_back(encodedValueToRuntimeValue(value, program->stringPool));
	}
	program->constPoolStringPool = &program->stringPool;
	return program;
}

std::unique_ptr<ProgramImage> ProgramLoader::load(const uint8_t* data, size_t size) {
	// Decode binary format using binencoder
	BinValue root = decodeBinary(data, size);

	if (!root.isObject()) {
		throw BMSX_RUNTIME_ERROR("ProgramLoader: expected object at root");
	}

	auto image = std::make_unique<ProgramImage>();

	// Extract entryProtoIndex
	image->entryProtoIndex = root.require("entryProtoIndex").toI32();

	image->sections = extractProgramObjectSections(root.require("sections"));

	// Extract link metadata (required).
	const auto& linkObj = root.require("link");
	const auto& constRelocsArr = linkObj.require("constRelocs").asArray();
	image->link.constRelocs.reserve(constRelocsArr.size());
	for (const auto& relocObj : constRelocsArr) {
		ProgramImage::ConstReloc reloc;
		reloc.wordIndex = relocObj.require("wordIndex").toI32();
		reloc.constIndex = relocObj.require("constIndex").toI32();
		reloc.kind = parseConstRelocKind(relocObj.require("kind").asString());
		image->link.constRelocs.push_back(reloc);
	}

	return image;
}

std::unique_ptr<ProgramMetadata> ProgramLoader::loadSymbols(const uint8_t* data, size_t size) {
	BinValue root = decodeBinary(data, size);

	if (!root.isObject()) {
		throw BMSX_RUNTIME_ERROR("ProgramLoader: expected object at root");
	}

	return extractProgramMetadata(root.require("metadata"));
}

} // namespace bmsx
