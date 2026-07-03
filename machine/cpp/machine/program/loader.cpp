#include "machine/program/loader.h"
#include "common/serializer/binencoder.h"
#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <utility>

namespace bmsx {

namespace {

struct ConstRelocKindEntry {
	const char* name;
	std::variant<ProgramIndexedConstRelocKind, ProgramSymbolicConstRelocKind> kind;
};

struct ConstValueRelocKindEntry {
	const char* name;
	ProgramConstValueRelocKind kind;
};

constexpr ConstRelocKindEntry CONST_RELOC_KIND_ENTRIES[] = {
	{"bx", ProgramIndexedConstRelocKind::Bx},
	{"rk_b", ProgramIndexedConstRelocKind::RkB},
	{"rk_c", ProgramIndexedConstRelocKind::RkC},
	{"const_b", ProgramIndexedConstRelocKind::ConstB},
	{"const_c", ProgramIndexedConstRelocKind::ConstC},
	{"gl", ProgramIndexedConstRelocKind::Gl},
	{"sys", ProgramIndexedConstRelocKind::Sys},
	{"module", ProgramSymbolicConstRelocKind::Module},
	{"export_proto", ProgramSymbolicConstRelocKind::ExportProto},
};

constexpr ConstValueRelocKindEntry CONST_VALUE_RELOC_KIND_ENTRIES[] = {
	{"bss_addr", ProgramConstValueRelocKind::BssAddr},
	{"data_addr", ProgramConstValueRelocKind::DataAddr},
	{"data_lma_addr", ProgramConstValueRelocKind::DataLmaAddr},
	{"rodata_addr", ProgramConstValueRelocKind::RodataAddr},
};

std::variant<ProgramIndexedConstRelocKind, ProgramSymbolicConstRelocKind> parseConstRelocKind(const std::string& kind) {
	for (const auto& entry : CONST_RELOC_KIND_ENTRIES) {
		if (kind == entry.name) {
			return entry.kind;
		}
	}
	// Lua 5.4-style specialized table ops such as GETFIELD/SETFIELD/GETI/SETI patch a plain
	// const operand in B/C. Treating them as legacy RK relocations corrupts the linked bytecode.
	throw BMSX_RUNTIME_ERROR("ProgramImage: unknown const reloc kind '" + kind + "'.");
}

ProgramConstValueRelocKind parseConstValueRelocKind(const std::string& kind) {
	for (const auto& entry : CONST_VALUE_RELOC_KIND_ENTRIES) {
		if (kind == entry.name) {
			return entry.kind;
		}
	}
	throw BMSX_RUNTIME_ERROR("ProgramImage.link.constValueRelocs kind must be bss_addr, data_addr, data_lma_addr or rodata_addr.");
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

template <typename Symbol>
void readStorageSymbols(const BinArray& values, std::vector<Symbol>& symbols) {
	symbols.reserve(values.size());
	for (const auto& symbolValue : values) {
		Symbol symbol;
		symbol.name = symbolValue.require("name").asString();
		symbol.offset = static_cast<size_t>(symbolValue.require("offset").toI32());
		symbol.byteCount = static_cast<size_t>(symbolValue.require("byteCount").toI32());
		symbol.alignment = static_cast<size_t>(symbolValue.require("alignment").toI32());
		symbols.push_back(std::move(symbol));
	}
}

template <typename Symbol>
BinArray encodeStorageSymbols(const std::vector<Symbol>& symbols) {
	BinArray values;
	values.reserve(symbols.size());
	for (const auto& symbol : symbols) {
		BinObject object;
		object["name"] = BinValue(symbol.name);
		object["offset"] = BinValue(static_cast<i64>(symbol.offset));
		object["byteCount"] = BinValue(static_cast<i64>(symbol.byteCount));
		object["alignment"] = BinValue(static_cast<i64>(symbol.alignment));
		values.push_back(BinValue(std::move(object)));
	}
	return values;
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
	throw BMSX_RUNTIME_ERROR("ProgramImage: unsupported ProgramImage.sections.rodata.constPool value.");
}

BinValue encodedValueToBinValue(const EncodedValue& value) {
	if (std::holds_alternative<std::nullptr_t>(value)) return BinValue(nullptr);
	if (const auto* boolValue = std::get_if<bool>(&value)) return BinValue(*boolValue);
	if (const auto* numberValue = std::get_if<double>(&value)) return BinValue(*numberValue);
	if (const auto* stringValue = std::get_if<std::string>(&value)) return BinValue(*stringValue);
	throw BMSX_RUNTIME_ERROR("ProgramImage: unsupported encoded const pool value.");
}

Value encodedValueToRuntimeValue(const EncodedValue& value, StringPool& stringPool) {
	if (std::holds_alternative<std::nullptr_t>(value)) return valueNil();
	if (const auto* boolValue = std::get_if<bool>(&value)) return valueBool(*boolValue);
	if (const auto* numberValue = std::get_if<double>(&value)) return valueNumber(*numberValue);
	if (const auto* stringValue = std::get_if<std::string>(&value)) return valueString(stringPool.intern(*stringValue));
	throw BMSX_RUNTIME_ERROR("ProgramImage: unsupported encoded const pool value.");
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
		proto.codeLen = protoObj.require("codeLen").toI32();
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

BinValue encodeProto(const Proto& proto) {
	BinObject object;
	object["maxStack"] = BinValue(proto.maxStack);
	object["numParams"] = BinValue(proto.numParams);
	object["entryPC"] = BinValue(proto.entryPC);
	object["codeLen"] = BinValue(proto.codeLen);
	object["isVararg"] = BinValue(proto.isVararg);
	object["staticClosure"] = BinValue(proto.staticClosure);
	BinArray upvalues;
	upvalues.reserve(proto.upvalues.size());
	for (const UpvalueDesc& upvalue : proto.upvalues) {
		BinObject uv;
		uv["inStack"] = BinValue(upvalue.isLocal);
		uv["index"] = BinValue(upvalue.index);
		upvalues.push_back(BinValue(std::move(uv)));
	}
	object["upvalueDescs"] = BinValue(std::move(upvalues));
	return BinValue(std::move(object));
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

	const auto& moduleExportsArr = rodataObj.require("moduleExports").asArray();
	rodata.moduleExports.reserve(moduleExportsArr.size());
	for (const auto& value : moduleExportsArr) {
		ProgramModuleExport moduleExport;
		moduleExport.path = value.require("path").asString();
		moduleExport.exportPathKey = value.require("exportPathKey").asString();
		moduleExport.slotName = value.require("slotName").asString();
		rodata.moduleExports.push_back(std::move(moduleExport));
	}

	rodata.staticModulePaths = readStringArray(rodataObj.require("staticModulePaths"), "ProgramImage: ProgramImage.sections.rodata.staticModulePaths");
	const auto& bytes = rodataObj.require("bytes").asBinary();
	rodata.bytes.assign(bytes.begin(), bytes.end());
	readStorageSymbols(rodataObj.require("symbols").asArray(), rodata.symbols);
	return rodata;
}

BinValue encodeModuleProto(const std::pair<std::string, int>& entry) {
	BinObject object;
	object["path"] = BinValue(entry.first);
	object["protoIndex"] = BinValue(entry.second);
	return BinValue(std::move(object));
}

BinValue encodeModuleExport(const ProgramModuleExport& entry) {
	BinObject object;
	object["path"] = BinValue(entry.path);
	object["exportPathKey"] = BinValue(entry.exportPathKey);
	object["slotName"] = BinValue(entry.slotName);
	return BinValue(std::move(object));
}

ProgramDataSection extractDataSection(const BinValue& dataObj) {
	ProgramDataSection data;
	const auto& bytes = dataObj.require("bytes").asBinary();
	data.bytes.assign(bytes.begin(), bytes.end());
	readStorageSymbols(dataObj.require("symbols").asArray(), data.symbols);
	return data;
}

ProgramBssSection extractBssSection(const BinValue& bssObj) {
	ProgramBssSection bss;
	bss.byteCount = static_cast<size_t>(bssObj.require("byteCount").toI32());
	readStorageSymbols(bssObj.require("symbols").asArray(), bss.symbols);
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

void extractProgramRuntimeSymbols(const BinValue& symbolsObj, ProgramRuntimeSymbols& symbols, const std::string& context) {
	const auto& protoIdsArr = symbolsObj.require("protoIds").asArray();
	symbols.protoIds.reserve(protoIdsArr.size());
	for (const auto& idVal : protoIdsArr) {
		symbols.protoIds.push_back(idVal.asString());
	}
	symbols.systemGlobalNames = readStringArray(symbolsObj.require("systemGlobalNames"), context + ".systemGlobalNames");
	symbols.globalNames = readStringArray(symbolsObj.require("globalNames"), context + ".globalNames");
	const BinObject& exportObj = symbolsObj.require("exportProtoIdBySlot").asObject();
	symbols.exportProtoIdBySlot.reserve(exportObj.size());
	for (const auto& entry : exportObj) {
		symbols.exportProtoIdBySlot.emplace(entry.first, entry.second.asString());
	}
}

std::unique_ptr<ProgramMetadata> extractProgramMetadata(const BinValue& metadataObj) {
	auto metadata = std::make_unique<ProgramMetadata>();
	extractProgramRuntimeSymbols(metadataObj, *metadata, "ProgramImage.metadata");
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
		throw BMSX_RUNTIME_ERROR("ProgramImage: localSlotsByProto length does not match protoIds length.");
	}

	const auto& upvalueNamesByProtoArr = metadataObj.require("upvalueNamesByProto").asArray();
	metadata->upvalueNamesByProto.resize(upvalueNamesByProtoArr.size());
	for (size_t protoIndex = 0; protoIndex < upvalueNamesByProtoArr.size(); ++protoIndex) {
		metadata->upvalueNamesByProto[protoIndex] = readStringArray(upvalueNamesByProtoArr[protoIndex], "ProgramImage: upvalueNamesByProto entry");
	}
	if (metadata->upvalueNamesByProto.size() != metadata->protoIds.size()) {
		throw BMSX_RUNTIME_ERROR("ProgramImage: upvalueNamesByProto length does not match protoIds length.");
	}

	return metadata;
}

bool startsWith(std::string_view value, std::string_view prefix) {
	return value.size() >= prefix.size() && value.compare(0, prefix.size(), prefix) == 0;
}

bool hasLuaExtension(std::string_view candidate) {
	if (candidate.size() < 4) {
		return false;
	}
	const size_t dotIndex = candidate.size() - 4;
	return candidate[dotIndex] == '.'
		&& (candidate[dotIndex + 1] == 'l' || candidate[dotIndex + 1] == 'L')
		&& (candidate[dotIndex + 2] == 'u' || candidate[dotIndex + 2] == 'U')
		&& (candidate[dotIndex + 3] == 'a' || candidate[dotIndex + 3] == 'A');
}

const char* constRelocKindName(ProgramIndexedConstRelocKind kind) {
	switch (kind) {
		case ProgramIndexedConstRelocKind::Bx: return "bx";
		case ProgramIndexedConstRelocKind::RkB: return "rk_b";
		case ProgramIndexedConstRelocKind::RkC: return "rk_c";
		case ProgramIndexedConstRelocKind::ConstB: return "const_b";
		case ProgramIndexedConstRelocKind::ConstC: return "const_c";
		case ProgramIndexedConstRelocKind::Gl: return "gl";
		case ProgramIndexedConstRelocKind::Sys: return "sys";
	}
	throw BMSX_RUNTIME_ERROR("ProgramImage: unsupported indexed const reloc kind.");
}

const char* constRelocKindName(ProgramSymbolicConstRelocKind kind) {
	switch (kind) {
		case ProgramSymbolicConstRelocKind::Module: return "module";
		case ProgramSymbolicConstRelocKind::ExportProto: return "export_proto";
	}
	throw BMSX_RUNTIME_ERROR("ProgramImage: unsupported symbolic const reloc kind.");
}

BinValue encodeConstReloc(const ProgramConstReloc& reloc) {
	BinObject object;
	object["wordIndex"] = BinValue(reloc.wordIndex);
	if (const auto* symbolic = std::get_if<ProgramSymbolicConstReloc>(&reloc.target)) {
		object["kind"] = BinValue(constRelocKindName(symbolic->kind));
		object["symbol"] = BinValue(symbolic->symbol);
	} else {
		const auto& indexed = std::get<ProgramIndexedConstReloc>(reloc.target);
		object["kind"] = BinValue(constRelocKindName(indexed.kind));
		object["constIndex"] = BinValue(indexed.constIndex);
	}
	return BinValue(std::move(object));
}

BinValue encodeRuntimeSymbols(const ProgramRuntimeSymbols& symbols) {
	BinArray protoIds;
	protoIds.reserve(symbols.protoIds.size());
	for (const std::string& protoId : symbols.protoIds) {
		protoIds.push_back(BinValue(protoId));
	}
	BinArray globalNames;
	globalNames.reserve(symbols.globalNames.size());
	for (const std::string& name : symbols.globalNames) {
		globalNames.push_back(BinValue(name));
	}
	BinArray systemGlobalNames;
	systemGlobalNames.reserve(symbols.systemGlobalNames.size());
	for (const std::string& name : symbols.systemGlobalNames) {
		systemGlobalNames.push_back(BinValue(name));
	}
	BinObject exportProtoIdBySlot;
	for (const auto& entry : symbols.exportProtoIdBySlot) {
		exportProtoIdBySlot[entry.first] = BinValue(entry.second);
	}
	BinObject out;
	out["protoIds"] = BinValue(std::move(protoIds));
	out["globalNames"] = BinValue(std::move(globalNames));
	out["systemGlobalNames"] = BinValue(std::move(systemGlobalNames));
	out["exportProtoIdBySlot"] = BinValue(std::move(exportProtoIdBySlot));
	return BinValue(std::move(out));
}

} // namespace

std::unique_ptr<Program> inflateProgram(const ProgramObjectSections& sections) {
	auto program = std::make_unique<Program>();
	std::vector<uint8_t>& programRom = program->programRom;
	programRom.reserve(sections.text.code.size() + sections.rodata.bytes.size() + sections.data.bytes.size());
	programRom.insert(programRom.end(), sections.text.code.begin(), sections.text.code.end());
	programRom.insert(programRom.end(), sections.rodata.bytes.begin(), sections.rodata.bytes.end());
	programRom.insert(programRom.end(), sections.data.bytes.begin(), sections.data.bytes.end());
	program->programRomTextByteLength = sections.text.code.size();
	program->protos = sections.text.protos;
	program->moduleProtos = sections.rodata.moduleProtos;
	program->moduleExports = sections.rodata.moduleExports;
	program->moduleProtoMap.reserve(program->moduleProtos.size());
	for (const auto& entry : program->moduleProtos) {
		program->moduleProtoMap.emplace(entry.first, entry.second);
	}
	program->constPool.reserve(sections.rodata.constPool.size());
	for (const EncodedValue& value : sections.rodata.constPool) {
		program->constPool.push_back(encodedValueToRuntimeValue(value, program->stringPool));
	}
	program->constPoolStringPool = &program->stringPool;
	return program;
}

std::unique_ptr<ProgramImage> decodeProgramImage(const uint8_t* data, size_t size) {
	// Decode binary format using binencoder
	BinValue root = decodeBinary(data, size);

	if (!root.isObject()) {
		throw BMSX_RUNTIME_ERROR("ProgramImage: expected object at root");
	}

	auto image = std::make_unique<ProgramImage>();

	const auto& vectors = root.require("vectors");
	image->vectors.resetProtoIndex = vectors.require("resetProtoIndex").toI32();
	image->vectors.sectionInitProtoIndex = vectors.require("sectionInitProtoIndex").toI32();
	image->vectors.irqProtoIndex = vectors.require("irqProtoIndex").toI32();

	image->sections = extractProgramObjectSections(root.require("sections"));

	// Extract link metadata (required).
	const auto& linkObj = root.require("link");
	const auto& constRelocsArr = linkObj.require("constRelocs").asArray();
	image->link.constRelocs.reserve(constRelocsArr.size());
	for (const auto& relocObj : constRelocsArr) {
		ProgramConstReloc reloc;
		reloc.wordIndex = relocObj.require("wordIndex").toI32();
		auto kind = parseConstRelocKind(relocObj.require("kind").asString());
		if (const auto* symbolicKind = std::get_if<ProgramSymbolicConstRelocKind>(&kind)) {
			reloc.target = ProgramSymbolicConstReloc{*symbolicKind, relocObj.require("symbol").asString()};
		} else {
			reloc.target = ProgramIndexedConstReloc{std::get<ProgramIndexedConstRelocKind>(kind), relocObj.require("constIndex").toI32()};
		}
		image->link.constRelocs.push_back(std::move(reloc));
	}
	const auto& constValueRelocsArr = linkObj.require("constValueRelocs").asArray();
	image->link.constValueRelocs.reserve(constValueRelocsArr.size());
	for (const auto& relocObj : constValueRelocsArr) {
		ProgramConstValueReloc reloc;
		reloc.constIndex = relocObj.require("constIndex").toI32();
		reloc.kind = parseConstValueRelocKind(relocObj.require("kind").asString());
		reloc.symbol = relocObj.require("symbol").asString();
		reloc.addend = relocObj.require("addend").toI32();
		image->link.constValueRelocs.push_back(std::move(reloc));
	}
	extractProgramRuntimeSymbols(linkObj.require("symbols"), image->link.symbols, "ProgramImage.link.symbols");

	return image;
}

std::vector<uint8_t> encodeProgramImage(const ProgramImage& asset) {
	BinArray protos;
	protos.reserve(asset.sections.text.protos.size());
	for (const Proto& proto : asset.sections.text.protos) {
		protos.push_back(encodeProto(proto));
	}

	BinObject text;
	text["code"] = BinValue(BinBinary(asset.sections.text.code.begin(), asset.sections.text.code.end()));
	text["protos"] = BinValue(std::move(protos));

	BinArray constPool;
	constPool.reserve(asset.sections.rodata.constPool.size());
	for (const EncodedValue& value : asset.sections.rodata.constPool) {
		constPool.push_back(encodedValueToBinValue(value));
	}
	BinArray moduleProtos;
	moduleProtos.reserve(asset.sections.rodata.moduleProtos.size());
	for (const auto& entry : asset.sections.rodata.moduleProtos) {
		moduleProtos.push_back(encodeModuleProto(entry));
	}
	BinArray moduleExports;
	moduleExports.reserve(asset.sections.rodata.moduleExports.size());
	for (const auto& entry : asset.sections.rodata.moduleExports) {
		moduleExports.push_back(encodeModuleExport(entry));
	}
	BinArray staticModulePaths;
	staticModulePaths.reserve(asset.sections.rodata.staticModulePaths.size());
	for (const std::string& path : asset.sections.rodata.staticModulePaths) {
		staticModulePaths.push_back(BinValue(path));
	}

	BinObject rodata;
	rodata["constPool"] = BinValue(std::move(constPool));
	rodata["moduleProtos"] = BinValue(std::move(moduleProtos));
	rodata["moduleExports"] = BinValue(std::move(moduleExports));
	rodata["staticModulePaths"] = BinValue(std::move(staticModulePaths));
	rodata["bytes"] = BinValue(BinBinary(asset.sections.rodata.bytes.begin(), asset.sections.rodata.bytes.end()));
	rodata["symbols"] = BinValue(encodeStorageSymbols(asset.sections.rodata.symbols));

	BinObject data;
	data["bytes"] = BinValue(BinBinary(asset.sections.data.bytes.begin(), asset.sections.data.bytes.end()));
	data["symbols"] = BinValue(encodeStorageSymbols(asset.sections.data.symbols));

	BinObject bss;
	bss["byteCount"] = BinValue(static_cast<i64>(asset.sections.bss.byteCount));
	bss["symbols"] = BinValue(encodeStorageSymbols(asset.sections.bss.symbols));

	BinObject sections;
	sections["text"] = BinValue(std::move(text));
	sections["rodata"] = BinValue(std::move(rodata));
	sections["data"] = BinValue(std::move(data));
	sections["bss"] = BinValue(std::move(bss));

	BinArray constRelocs;
	constRelocs.reserve(asset.link.constRelocs.size());
	for (const ProgramConstReloc& reloc : asset.link.constRelocs) {
		constRelocs.push_back(encodeConstReloc(reloc));
	}
	BinArray constValueRelocs;
	constValueRelocs.reserve(asset.link.constValueRelocs.size());
	for (const ProgramConstValueReloc& reloc : asset.link.constValueRelocs) {
		BinObject object;
		object["constIndex"] = BinValue(reloc.constIndex);
		switch (reloc.kind) {
			case ProgramConstValueRelocKind::BssAddr:
				object["kind"] = BinValue("bss_addr");
				break;
			case ProgramConstValueRelocKind::DataAddr:
				object["kind"] = BinValue("data_addr");
				break;
			case ProgramConstValueRelocKind::DataLmaAddr:
				object["kind"] = BinValue("data_lma_addr");
				break;
			case ProgramConstValueRelocKind::RodataAddr:
				object["kind"] = BinValue("rodata_addr");
				break;
		}
		object["symbol"] = BinValue(reloc.symbol);
		object["addend"] = BinValue(reloc.addend);
		constValueRelocs.push_back(BinValue(std::move(object)));
	}
	BinObject link;
	link["constRelocs"] = BinValue(std::move(constRelocs));
	link["constValueRelocs"] = BinValue(std::move(constValueRelocs));
	link["symbols"] = encodeRuntimeSymbols(asset.link.symbols);

	BinObject vectors;
	vectors["resetProtoIndex"] = BinValue(asset.vectors.resetProtoIndex);
	vectors["sectionInitProtoIndex"] = BinValue(asset.vectors.sectionInitProtoIndex);
	vectors["irqProtoIndex"] = BinValue(asset.vectors.irqProtoIndex);

	BinObject root;
	root["vectors"] = BinValue(std::move(vectors));
	root["sections"] = BinValue(std::move(sections));
	root["link"] = BinValue(std::move(link));
	return encodeBinary(BinValue(std::move(root)));
}

std::unique_ptr<ProgramMetadata> decodeProgramSymbolsImage(const uint8_t* data, size_t size) {
	BinValue root = decodeBinary(data, size);

	if (!root.isObject()) {
		throw BMSX_RUNTIME_ERROR("ProgramImage: expected object at root");
	}

	return extractProgramMetadata(root.require("metadata"));
}

std::string stripLuaExtension(std::string_view candidate) {
	if (hasLuaExtension(candidate)) {
		candidate.remove_suffix(4);
	}
	return std::string(candidate);
}

std::string toLuaModulePath(std::string_view sourcePath) {
	static constexpr std::string_view CART_SOURCE_PREFIX = "carts/";
	static constexpr std::string_view MODULE_PATH_SOURCE_PREFIXES[] = {
		"machine/firmware/res/",
		"machine/firmware/",
		"res/",
	};
	std::string path = stripLuaExtension(sourcePath);
	std::replace(path.begin(), path.end(), '\\', '/');
	std::string_view modulePath = path;
	if (startsWith(path, CART_SOURCE_PREFIX)) {
		modulePath.remove_prefix(CART_SOURCE_PREFIX.size());
		const size_t cartNameEnd = modulePath.find('/');
		if (cartNameEnd != std::string_view::npos) {
			modulePath.remove_prefix(cartNameEnd + 1);
		}
	} else {
		for (const std::string_view prefix : MODULE_PATH_SOURCE_PREFIXES) {
			if (startsWith(path, prefix)) {
				modulePath.remove_prefix(prefix.size());
				break;
			}
		}
	}
	return std::string(modulePath);
}

} // namespace bmsx
