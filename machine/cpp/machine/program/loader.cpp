#include "machine/program/loader.h"

#include "common/serializer/binencoder.h"
#include <algorithm>
#include <cstring>
#include <utility>

namespace bmsx {

namespace {

SourceRange decodeSourceRange(const BinValue& value) {
	SourceRange range;
	range.path = value.require("path").asString();
	const BinValue& start = value.require("start");
	const BinValue& end = value.require("end");
	range.startLine = start.require("line").toI32();
	range.startColumn = start.require("column").toI32();
	range.endLine = end.require("line").toI32();
	range.endColumn = end.require("column").toI32();
	return range;
}

LocalSlotDebug decodeLocalSlot(const BinValue& value) {
	LocalSlotDebug slot;
	slot.name = value.require("name").asString();
	slot.reg = value.require("register").toI32();
	slot.definition = decodeSourceRange(value.require("definition"));
	slot.scope = decodeSourceRange(value.require("scope"));
	return slot;
}

std::vector<std::string> decodeStringArray(const BinValue& value) {
	const BinArray& values = value.asArray();
	std::vector<std::string> strings;
	strings.reserve(values.size());
	for (const BinValue& entry : values) {
		strings.push_back(entry.asString());
	}
	return strings;
}

std::vector<int> decodeIntArray(const BinValue& value) {
	const BinArray& values = value.asArray();
	std::vector<int> integers;
	integers.reserve(values.size());
	for (const BinValue& entry : values) {
		integers.push_back(entry.toI32());
	}
	return integers;
}

ProgramResumePoint decodeProgramResumePoint(const BinValue& value) {
	ProgramResumePoint point;
	point.wordOffset = value.require("wordOffset").toI32();
	point.range = decodeSourceRange(value.require("range"));
	point.op = value.require("op").toI32();
	point.liveRegisters = decodeIntArray(value.require("liveRegisters"));
	point.uses = decodeIntArray(value.require("uses"));
	point.defs = decodeIntArray(value.require("defs"));
	return point;
}

EncodedValue decodeEncodedValue(const BinValue& value) {
	if (value.isNull()) return nullptr;
	if (value.isBool()) return value.asBool();
	if (value.isNumber()) return value.toNumber();
	return value.asString();
}

BinValue encodeEncodedValue(const EncodedValue& value) {
	if (std::holds_alternative<std::nullptr_t>(value)) return BinValue(nullptr);
	if (const auto* boolean = std::get_if<bool>(&value)) return BinValue(*boolean);
	if (const auto* number = std::get_if<double>(&value)) return BinValue(*number);
	return BinValue(std::get<std::string>(value));
}

Value decodeRuntimeValue(const EncodedValue& value, StringPool& stringPool) {
	if (std::holds_alternative<std::nullptr_t>(value)) return valueNil();
	if (const auto* boolean = std::get_if<bool>(&value)) return valueBool(*boolean);
	if (const auto* number = std::get_if<double>(&value)) return valueNumber(*number);
	return valueString(stringPool.intern(std::get<std::string>(value)));
}

Proto decodeProto(const BinValue& value) {
	Proto proto;
	proto.entryPC = value.require("entryPC").toI32();
	proto.codeLen = value.require("codeLen").toI32();
	proto.numParams = value.require("numParams").toI32();
	proto.isVararg = value.require("isVararg").asBool();
	proto.maxStack = value.require("maxStack").toI32();
	proto.staticClosure = value.require("staticClosure").asBool();
	const BinArray& upvalues = value.require("upvalueDescs").asArray();
	proto.upvalues.reserve(upvalues.size());
	for (const BinValue& upvalueValue : upvalues) {
		UpvalueDesc upvalue;
		upvalue.isLocal = upvalueValue.require("inStack").asBool();
		upvalue.index = upvalueValue.require("index").toI32();
		proto.upvalues.push_back(upvalue);
	}
	return proto;
}

BinValue encodeProto(const Proto& proto) {
	BinArray upvalues;
	upvalues.reserve(proto.upvalues.size());
	for (const UpvalueDesc& upvalue : proto.upvalues) {
		BinObject value;
		value["inStack"] = BinValue(upvalue.isLocal);
		value["index"] = BinValue(upvalue.index);
		upvalues.emplace_back(std::move(value));
	}
	BinObject value;
	value["entryPC"] = BinValue(proto.entryPC);
	value["codeLen"] = BinValue(proto.codeLen);
	value["numParams"] = BinValue(proto.numParams);
	value["isVararg"] = BinValue(proto.isVararg);
	value["maxStack"] = BinValue(proto.maxStack);
	value["upvalueDescs"] = BinValue(std::move(upvalues));
	value["staticClosure"] = BinValue(proto.staticClosure);
	return BinValue(std::move(value));
}

void decodeRuntimeSymbols(const BinValue& value, ProgramRuntimeSymbols& symbols) {
	const BinArray& protoIds = value.require("protoIds").asArray();
	symbols.protoIds.reserve(protoIds.size());
	for (const BinValue& protoId : protoIds) {
		symbols.protoIds.push_back(protoId.asString());
	}
	symbols.systemGlobalNames = decodeStringArray(value.require("systemGlobalNames"));
	symbols.globalNames = decodeStringArray(value.require("globalNames"));
	const BinObject& exports = value.require("exportProtoIdBySlot").asObject();
	symbols.exportProtoIdBySlot.reserve(exports.size());
	for (const auto& entry : exports) {
		symbols.exportProtoIdBySlot.emplace(entry.first, entry.second.asString());
	}
}

BinValue encodeRuntimeSymbols(const ProgramRuntimeSymbols& symbols) {
	BinArray protoIds;
	protoIds.reserve(symbols.protoIds.size());
	for (const std::string& value : symbols.protoIds) {
		protoIds.emplace_back(value);
	}
	BinArray systemGlobalNames;
	systemGlobalNames.reserve(symbols.systemGlobalNames.size());
	for (const std::string& value : symbols.systemGlobalNames) {
		systemGlobalNames.emplace_back(value);
	}
	BinArray globalNames;
	globalNames.reserve(symbols.globalNames.size());
	for (const std::string& value : symbols.globalNames) {
		globalNames.emplace_back(value);
	}
	BinObject exportProtoIdBySlot;
	for (const auto& entry : symbols.exportProtoIdBySlot) {
		exportProtoIdBySlot[entry.first] = BinValue(entry.second);
	}
	BinObject value;
	value["protoIds"] = BinValue(std::move(protoIds));
	value["systemGlobalNames"] = BinValue(std::move(systemGlobalNames));
	value["globalNames"] = BinValue(std::move(globalNames));
	value["exportProtoIdBySlot"] = BinValue(std::move(exportProtoIdBySlot));
	return BinValue(std::move(value));
}

std::unique_ptr<ProgramMetadata> decodeProgramMetadata(const BinValue& value) {
	auto metadata = std::make_unique<ProgramMetadata>();
	decodeRuntimeSymbols(value, *metadata);
	const BinArray& ranges = value.require("debugRanges").asArray();
	metadata->debugRanges.reserve(ranges.size());
	for (const BinValue& range : ranges) {
		if (range.isNull()) {
			metadata->debugRanges.push_back(std::nullopt);
		} else {
			metadata->debugRanges.push_back(decodeSourceRange(range));
		}
	}
	const BinArray& resumePointsByProto = value.require("resumePointsByProto").asArray();
	metadata->resumePointsByProto.resize(resumePointsByProto.size());
	for (size_t protoIndex = 0; protoIndex < resumePointsByProto.size(); ++protoIndex) {
		const BinArray& points = resumePointsByProto[protoIndex].asArray();
		auto& decodedPoints = metadata->resumePointsByProto[protoIndex];
		decodedPoints.reserve(points.size());
		for (const BinValue& point : points) {
			decodedPoints.push_back(decodeProgramResumePoint(point));
		}
	}
	const BinArray& slotsByProto = value.require("localSlotsByProto").asArray();
	metadata->localSlotsByProto.resize(slotsByProto.size());
	for (size_t protoIndex = 0; protoIndex < slotsByProto.size(); ++protoIndex) {
		const BinArray& slots = slotsByProto[protoIndex].asArray();
		auto& decodedSlots = metadata->localSlotsByProto[protoIndex];
		decodedSlots.reserve(slots.size());
		for (const BinValue& slot : slots) {
			decodedSlots.push_back(decodeLocalSlot(slot));
		}
	}
	const BinArray& upvalueNamesByProto = value.require("upvalueNamesByProto").asArray();
	metadata->upvalueNamesByProto.resize(upvalueNamesByProto.size());
	for (size_t protoIndex = 0; protoIndex < upvalueNamesByProto.size(); ++protoIndex) {
		metadata->upvalueNamesByProto[protoIndex] = decodeStringArray(upvalueNamesByProto[protoIndex]);
	}
	return metadata;
}

bool startsWith(std::string_view value, std::string_view prefix) {
	return value.size() >= prefix.size() && value.compare(0, prefix.size(), prefix) == 0;
}

bool hasLuaExtension(std::string_view candidate) {
	if (candidate.size() < 4) return false;
	const size_t dotIndex = candidate.size() - 4;
	return candidate[dotIndex] == '.'
		&& (candidate[dotIndex + 1] == 'l' || candidate[dotIndex + 1] == 'L')
		&& (candidate[dotIndex + 2] == 'u' || candidate[dotIndex + 2] == 'U')
		&& (candidate[dotIndex + 3] == 'a' || candidate[dotIndex + 3] == 'A');
}

} // namespace

std::unique_ptr<ProgramImage> decodeProgramImage(
	std::span<const uint8_t> sectionBytes,
	std::span<const uint8_t> descriptorBytes
) {
	const BinValue descriptor = decodeBinary(descriptorBytes.data(), descriptorBytes.size());
	auto image = std::make_unique<ProgramImage>();
	const BinValue& placement = descriptor.require("placement");
	image->placement.textBasePc = placement.require("textBasePc").toI32();
	image->placement.constBaseIndex = placement.require("constBaseIndex").toI32();
	image->placement.protoBaseIndex = placement.require("protoBaseIndex").toI32();
	image->placement.dataBaseAddress = static_cast<uint32_t>(placement.require("dataBaseAddress").toI32());
	image->placement.bssBaseAddress = static_cast<uint32_t>(placement.require("bssBaseAddress").toI32());
	const BinValue& staticLayoutToken = descriptor.require("staticLayoutToken");
	image->staticLayoutToken.lo = static_cast<uint32_t>(staticLayoutToken.require("lo").toNumber());
	image->staticLayoutToken.hi = static_cast<uint32_t>(staticLayoutToken.require("hi").toNumber());

	const BinValue& vectors = descriptor.require("vectors");
	image->vectors.resetProtoIndex = vectors.require("resetProtoIndex").toI32();
	image->vectors.sectionInitProtoIndex = vectors.require("sectionInitProtoIndex").toI32();
	image->vectors.irqProtoIndex = vectors.require("irqProtoIndex").toI32();
	image->vectors.exceptionProtoIndex = vectors.require("exceptionProtoIndex").toI32();

	const BinValue& sections = descriptor.require("sections");
	const BinValue& text = sections.require("text");
	const size_t textByteCount = static_cast<size_t>(text.require("byteCount").toI32());
	const BinArray& protos = text.require("protos").asArray();
	image->sections.text.protos.reserve(protos.size());
	for (const BinValue& proto : protos) {
		image->sections.text.protos.push_back(decodeProto(proto));
	}

	const BinValue& rodata = sections.require("rodata");
	const size_t rodataByteCount = static_cast<size_t>(rodata.require("byteCount").toI32());
	image->sections.rodata.bytes = sectionBytes.subspan(0, rodataByteCount);
	const BinArray& constPool = rodata.require("constPool").asArray();
	image->sections.rodata.constPool.reserve(constPool.size());
	for (const BinValue& value : constPool) {
		image->sections.rodata.constPool.push_back(decodeEncodedValue(value));
	}
	const BinArray& moduleProtos = rodata.require("moduleProtos").asArray();
	image->sections.rodata.moduleProtos.reserve(moduleProtos.size());
	for (const BinValue& value : moduleProtos) {
		image->sections.rodata.moduleProtos.emplace_back(
			value.require("path").asString(),
			value.require("protoIndex").toI32()
		);
	}
	const BinArray& moduleExports = rodata.require("moduleExports").asArray();
	image->sections.rodata.moduleExports.reserve(moduleExports.size());
	for (const BinValue& value : moduleExports) {
		ProgramModuleExport entry;
		entry.path = value.require("path").asString();
		entry.exportPathKey = value.require("exportPathKey").asString();
		entry.slotName = value.require("slotName").asString();
		image->sections.rodata.moduleExports.push_back(std::move(entry));
	}
	image->sections.rodata.staticModulePaths = decodeStringArray(rodata.require("staticModulePaths"));

	const BinValue& data = sections.require("data");
	const size_t dataByteCount = static_cast<size_t>(data.require("byteCount").toI32());
	image->sections.data.bytes = sectionBytes.subspan(rodataByteCount, dataByteCount);
	image->sections.text.code = sectionBytes.subspan(rodataByteCount + dataByteCount, textByteCount);
	image->sections.bss.byteCount = static_cast<size_t>(sections.require("bss").require("byteCount").toI32());
	decodeRuntimeSymbols(descriptor.require("symbols"), image->symbols);
	return image;
}

EncodedProgramImage encodeProgramImage(const ProgramImage& image) {
	EncodedProgramImage encoded;
	const auto& textBytes = image.sections.text.code;
	const auto& rodataBytes = image.sections.rodata.bytes;
	const auto& dataBytes = image.sections.data.bytes;
	encoded.sections.reserve(textBytes.size() + rodataBytes.size() + dataBytes.size());
	encoded.sections.insert(encoded.sections.end(), rodataBytes.begin(), rodataBytes.end());
	encoded.sections.insert(encoded.sections.end(), dataBytes.begin(), dataBytes.end());
	encoded.sections.insert(encoded.sections.end(), textBytes.begin(), textBytes.end());

	BinArray protos;
	protos.reserve(image.sections.text.protos.size());
	for (const Proto& proto : image.sections.text.protos) {
		protos.push_back(encodeProto(proto));
	}
	BinObject text;
	text["byteCount"] = BinValue(static_cast<i64>(textBytes.size()));
	text["protos"] = BinValue(std::move(protos));

	BinArray constPool;
	constPool.reserve(image.sections.rodata.constPool.size());
	for (const EncodedValue& value : image.sections.rodata.constPool) {
		constPool.push_back(encodeEncodedValue(value));
	}
	BinArray moduleProtos;
	moduleProtos.reserve(image.sections.rodata.moduleProtos.size());
	for (const auto& entry : image.sections.rodata.moduleProtos) {
		BinObject value;
		value["path"] = BinValue(entry.first);
		value["protoIndex"] = BinValue(entry.second);
		moduleProtos.emplace_back(std::move(value));
	}
	BinArray moduleExports;
	moduleExports.reserve(image.sections.rodata.moduleExports.size());
	for (const ProgramModuleExport& entry : image.sections.rodata.moduleExports) {
		BinObject value;
		value["path"] = BinValue(entry.path);
		value["exportPathKey"] = BinValue(entry.exportPathKey);
		value["slotName"] = BinValue(entry.slotName);
		moduleExports.emplace_back(std::move(value));
	}
	BinArray staticModulePaths;
	staticModulePaths.reserve(image.sections.rodata.staticModulePaths.size());
	for (const std::string& path : image.sections.rodata.staticModulePaths) {
		staticModulePaths.emplace_back(path);
	}
	BinObject rodata;
	rodata["byteCount"] = BinValue(static_cast<i64>(rodataBytes.size()));
	rodata["constPool"] = BinValue(std::move(constPool));
	rodata["moduleProtos"] = BinValue(std::move(moduleProtos));
	rodata["moduleExports"] = BinValue(std::move(moduleExports));
	rodata["staticModulePaths"] = BinValue(std::move(staticModulePaths));

	BinObject data;
	data["byteCount"] = BinValue(static_cast<i64>(dataBytes.size()));
	BinObject bss;
	bss["byteCount"] = BinValue(static_cast<i64>(image.sections.bss.byteCount));
	BinObject sections;
	sections["text"] = BinValue(std::move(text));
	sections["rodata"] = BinValue(std::move(rodata));
	sections["data"] = BinValue(std::move(data));
	sections["bss"] = BinValue(std::move(bss));

	BinObject placement;
	placement["textBasePc"] = BinValue(image.placement.textBasePc);
	placement["constBaseIndex"] = BinValue(image.placement.constBaseIndex);
	placement["protoBaseIndex"] = BinValue(image.placement.protoBaseIndex);
	placement["dataBaseAddress"] = BinValue(static_cast<i64>(image.placement.dataBaseAddress));
	placement["bssBaseAddress"] = BinValue(static_cast<i64>(image.placement.bssBaseAddress));
	BinObject staticLayoutToken;
	staticLayoutToken["lo"] = BinValue(static_cast<i64>(image.staticLayoutToken.lo));
	staticLayoutToken["hi"] = BinValue(static_cast<i64>(image.staticLayoutToken.hi));
	BinObject vectors;
	vectors["resetProtoIndex"] = BinValue(image.vectors.resetProtoIndex);
	vectors["sectionInitProtoIndex"] = BinValue(image.vectors.sectionInitProtoIndex);
	vectors["irqProtoIndex"] = BinValue(image.vectors.irqProtoIndex);
	vectors["exceptionProtoIndex"] = BinValue(image.vectors.exceptionProtoIndex);
	BinObject descriptor;
	descriptor["placement"] = BinValue(std::move(placement));
	descriptor["staticLayoutToken"] = BinValue(std::move(staticLayoutToken));
	descriptor["vectors"] = BinValue(std::move(vectors));
	descriptor["sections"] = BinValue(std::move(sections));
	descriptor["symbols"] = encodeRuntimeSymbols(image.symbols);
	encoded.descriptor = encodeBinary(BinValue(std::move(descriptor)));
	return encoded;
}

std::unique_ptr<ProgramSymbolsImage> decodeProgramSymbolsImage(std::span<const uint8_t> bytes) {
	const BinValue root = decodeBinary(bytes.data(), bytes.size());
	return decodeProgramMetadata(root.require("metadata"));
}

std::unique_ptr<Program> assembleProgramImages(const ProgramImage& systemImage, const ProgramImage* cartImage) {
	auto program = std::make_unique<Program>();
	const size_t codeByteCount = cartImage
		? static_cast<size_t>(cartImage->placement.textBasePc) + cartImage->sections.text.code.size()
		: systemImage.sections.text.code.size();
	program->codeBytes.resize(codeByteCount);
	std::copy(
		systemImage.sections.text.code.begin(),
		systemImage.sections.text.code.end(),
		program->codeBytes.begin() + systemImage.placement.textBasePc
	);
	if (cartImage) {
		std::copy(
			cartImage->sections.text.code.begin(),
			cartImage->sections.text.code.end(),
			program->codeBytes.begin() + cartImage->placement.textBasePc
		);
	}

	const size_t constCount = cartImage
		? static_cast<size_t>(cartImage->placement.constBaseIndex) + cartImage->sections.rodata.constPool.size()
		: systemImage.sections.rodata.constPool.size();
	program->constPool.resize(constCount);
	for (size_t index = 0; index < systemImage.sections.rodata.constPool.size(); ++index) {
		program->constPool[static_cast<size_t>(systemImage.placement.constBaseIndex) + index] =
			decodeRuntimeValue(systemImage.sections.rodata.constPool[index], program->stringPool);
	}
	if (cartImage) {
		for (size_t index = 0; index < cartImage->sections.rodata.constPool.size(); ++index) {
			program->constPool[static_cast<size_t>(cartImage->placement.constBaseIndex) + index] =
				decodeRuntimeValue(cartImage->sections.rodata.constPool[index], program->stringPool);
		}
	}
	program->constPoolStringPool = &program->stringPool;

	const size_t protoCount = cartImage
		? static_cast<size_t>(cartImage->placement.protoBaseIndex) + cartImage->sections.text.protos.size()
		: systemImage.sections.text.protos.size();
	program->protos.resize(protoCount);
	std::copy(
		systemImage.sections.text.protos.begin(),
		systemImage.sections.text.protos.end(),
		program->protos.begin() + systemImage.placement.protoBaseIndex
	);
	program->moduleProtos = systemImage.sections.rodata.moduleProtos;
	program->moduleExports = systemImage.sections.rodata.moduleExports;
	if (cartImage) {
		std::copy(
			cartImage->sections.text.protos.begin(),
			cartImage->sections.text.protos.end(),
			program->protos.begin() + cartImage->placement.protoBaseIndex
		);
		program->moduleProtos.insert(
			program->moduleProtos.end(),
			cartImage->sections.rodata.moduleProtos.begin(),
			cartImage->sections.rodata.moduleProtos.end()
		);
		program->moduleExports.insert(
			program->moduleExports.end(),
			cartImage->sections.rodata.moduleExports.begin(),
			cartImage->sections.rodata.moduleExports.end()
		);
	}
	program->moduleProtoMap.reserve(program->moduleProtos.size());
	for (const auto& entry : program->moduleProtos) {
		program->moduleProtoMap.insert_or_assign(entry.first, entry.second);
	}
	return program;
}

std::string stripLuaExtension(std::string_view candidate) {
	if (hasLuaExtension(candidate)) candidate.remove_suffix(4);
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
		if (cartNameEnd != std::string_view::npos) modulePath.remove_prefix(cartNameEnd + 1);
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
