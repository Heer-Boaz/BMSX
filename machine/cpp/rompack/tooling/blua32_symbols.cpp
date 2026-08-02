#include "rompack/tooling/blua32_symbols.h"

#include "common/serializer/binencoder.h"
#include "spec/blua32/instruction_format.h"

#include <utility>

namespace bmsx {
namespace {

auto decodeSourceRange(const BinValue& value) -> SourceRange {
	const BinValue& start = value.require("start");
	const BinValue& end = value.require("end");
	return SourceRange{
		value.require("path").asString(),
		SourcePosition{
			start.require("line").toI32(),
			start.require("column").toI32(),
		},
		SourcePosition{
			end.require("line").toI32(),
			end.require("column").toI32(),
		},
	};
}

auto encodeSourceRange(const SourceRange& range) -> BinValue {
	BinObject start;
	start["line"] = BinValue(range.start.line);
	start["column"] = BinValue(range.start.column);
	BinObject end;
	end["line"] = BinValue(range.end.line);
	end["column"] = BinValue(range.end.column);
	BinObject value;
	value["path"] = BinValue(range.path);
	value["start"] = BinValue(std::move(start));
	value["end"] = BinValue(std::move(end));
	return BinValue(std::move(value));
}

auto decodeStringArray(const BinValue& value) -> std::vector<std::string> {
	const BinArray& values = value.asArray();
	std::vector<std::string> result;
	result.reserve(values.size());
	for (const BinValue& entry : values) {
		result.push_back(entry.asString());
	}
	return result;
}

auto encodeStringArray(const std::vector<std::string>& values) -> BinValue {
	BinArray result;
	result.reserve(values.size());
	for (const std::string& value : values) {
		result.emplace_back(value);
	}
	return BinValue(std::move(result));
}

auto decodeI32Array(const BinValue& value) -> std::vector<i32> {
	const BinArray& values = value.asArray();
	std::vector<i32> result;
	result.reserve(values.size());
	for (const BinValue& entry : values) {
		result.push_back(entry.toI32());
	}
	return result;
}

auto encodeI32Array(const std::vector<i32>& values) -> BinValue {
	BinArray result;
	result.reserve(values.size());
	for (i32 value : values) {
		result.emplace_back(value);
	}
	return BinValue(std::move(result));
}

auto decodeLocalSlot(const BinValue& value) -> Blua32LocalSlotDebug {
	return Blua32LocalSlotDebug{
		value.require("name").asString(),
		value.require("registerIndex").toI32(),
		decodeSourceRange(value.require("definition")),
		decodeSourceRange(value.require("scope")),
	};
}

auto encodeLocalSlot(const Blua32LocalSlotDebug& slot) -> BinValue {
	BinObject value;
	value["name"] = BinValue(slot.name);
	value["registerIndex"] = BinValue(slot.registerIndex);
	value["definition"] = encodeSourceRange(slot.definition);
	value["scope"] = encodeSourceRange(slot.scope);
	return BinValue(std::move(value));
}

auto decodeStatementPoint(const BinValue& value) -> Blua32StatementPoint {
	return Blua32StatementPoint{
		value.require("wordOffset").toI32(),
		value.require("inlineDepth").toI32(),
		decodeSourceRange(value.require("range")),
	};
}

auto encodeStatementPoint(const Blua32StatementPoint& point) -> BinValue {
	BinObject value;
	value["wordOffset"] = BinValue(point.wordOffset);
	value["inlineDepth"] = BinValue(point.inlineDepth);
	value["range"] = encodeSourceRange(point.range);
	return BinValue(std::move(value));
}

auto decodeResumePoint(const BinValue& value) -> Blua32ResumePoint {
	return Blua32ResumePoint{
		value.require("wordOffset").toI32(),
		decodeSourceRange(value.require("range")),
		static_cast<OpCode>(value.require("op").toI32()),
		decodeI32Array(value.require("liveRegisters")),
		decodeI32Array(value.require("uses")),
		decodeI32Array(value.require("defs")),
	};
}

auto encodeResumePoint(const Blua32ResumePoint& point) -> BinValue {
	BinObject value;
	value["wordOffset"] = BinValue(point.wordOffset);
	value["range"] = encodeSourceRange(point.range);
	value["op"] = BinValue(static_cast<i32>(point.op));
	value["liveRegisters"] = encodeI32Array(point.liveRegisters);
	value["uses"] = encodeI32Array(point.uses);
	value["defs"] = encodeI32Array(point.defs);
	return BinValue(std::move(value));
}

auto decodeMetadata(const BinValue& value) -> Blua32DebugMetadata {
	Blua32DebugMetadata metadata;
	metadata.functionIds = decodeStringArray(value.require("functionIds"));
	metadata.globalNames = decodeStringArray(value.require("globalNames"));
	metadata.systemGlobalNames = decodeStringArray(value.require("systemGlobalNames"));
	for (const auto& [slot, functionId] : value.require("staticFunctionIdBySlot").asObject()) {
		metadata.staticFunctionIdBySlot.emplace(slot, functionId.asString());
	}

	const BinArray& debugRanges = value.require("debugRanges").asArray();
	metadata.debugRanges.reserve(debugRanges.size());
	for (const BinValue& range : debugRanges) {
		if (range.isNull()) {
			metadata.debugRanges.push_back(std::nullopt);
		} else {
			metadata.debugRanges.push_back(decodeSourceRange(range));
		}
	}

	const BinArray& statementPoints = value.require("statementPointsByFunction").asArray();
	metadata.statementPointsByFunction.resize(statementPoints.size());
	for (size_t functionIndex = 0; functionIndex < statementPoints.size(); ++functionIndex) {
		const BinArray& encodedPoints = statementPoints[functionIndex].asArray();
		std::vector<Blua32StatementPoint>& decodedPoints = metadata.statementPointsByFunction[functionIndex];
		decodedPoints.reserve(encodedPoints.size());
		for (const BinValue& point : encodedPoints) {
			decodedPoints.push_back(decodeStatementPoint(point));
		}
	}

	const BinArray& resumePoints = value.require("resumePointsByFunction").asArray();
	metadata.resumePointsByFunction.resize(resumePoints.size());
	for (size_t functionIndex = 0; functionIndex < resumePoints.size(); ++functionIndex) {
		const BinArray& encodedPoints = resumePoints[functionIndex].asArray();
		std::vector<Blua32ResumePoint>& decodedPoints = metadata.resumePointsByFunction[functionIndex];
		decodedPoints.reserve(encodedPoints.size());
		for (const BinValue& point : encodedPoints) {
			decodedPoints.push_back(decodeResumePoint(point));
		}
	}

	const BinArray& localSlots = value.require("localSlotsByFunction").asArray();
	metadata.localSlotsByFunction.resize(localSlots.size());
	for (size_t functionIndex = 0; functionIndex < localSlots.size(); ++functionIndex) {
		const BinArray& encodedSlots = localSlots[functionIndex].asArray();
		std::vector<Blua32LocalSlotDebug>& decodedSlots = metadata.localSlotsByFunction[functionIndex];
		decodedSlots.reserve(encodedSlots.size());
		for (const BinValue& slot : encodedSlots) {
			decodedSlots.push_back(decodeLocalSlot(slot));
		}
	}

	const BinArray& upvalueNames = value.require("upvalueNamesByFunction").asArray();
	metadata.upvalueNamesByFunction.resize(upvalueNames.size());
	for (size_t functionIndex = 0; functionIndex < upvalueNames.size(); ++functionIndex) {
		metadata.upvalueNamesByFunction[functionIndex] = decodeStringArray(upvalueNames[functionIndex]);
	}
	return metadata;
}

auto encodeMetadata(const Blua32DebugMetadata& metadata) -> BinValue {
	BinObject value;
	value["functionIds"] = encodeStringArray(metadata.functionIds);
	value["globalNames"] = encodeStringArray(metadata.globalNames);
	value["systemGlobalNames"] = encodeStringArray(metadata.systemGlobalNames);

	BinObject staticFunctionIdBySlot;
	for (const auto& [slot, functionId] : metadata.staticFunctionIdBySlot) {
		staticFunctionIdBySlot[slot] = BinValue(functionId);
	}
	value["staticFunctionIdBySlot"] = BinValue(std::move(staticFunctionIdBySlot));

	BinArray debugRanges;
	debugRanges.reserve(metadata.debugRanges.size());
	for (const std::optional<SourceRange>& range : metadata.debugRanges) {
		if (range) {
			debugRanges.push_back(encodeSourceRange(*range));
		} else {
			debugRanges.emplace_back(nullptr);
		}
	}
	value["debugRanges"] = BinValue(std::move(debugRanges));

	BinArray statementPoints;
	statementPoints.reserve(metadata.statementPointsByFunction.size());
	for (const std::vector<Blua32StatementPoint>& functionPoints : metadata.statementPointsByFunction) {
		BinArray points;
		points.reserve(functionPoints.size());
		for (const Blua32StatementPoint& point : functionPoints) {
			points.push_back(encodeStatementPoint(point));
		}
		statementPoints.emplace_back(std::move(points));
	}
	value["statementPointsByFunction"] = BinValue(std::move(statementPoints));

	BinArray resumePoints;
	resumePoints.reserve(metadata.resumePointsByFunction.size());
	for (const std::vector<Blua32ResumePoint>& functionPoints : metadata.resumePointsByFunction) {
		BinArray points;
		points.reserve(functionPoints.size());
		for (const Blua32ResumePoint& point : functionPoints) {
			points.push_back(encodeResumePoint(point));
		}
		resumePoints.emplace_back(std::move(points));
	}
	value["resumePointsByFunction"] = BinValue(std::move(resumePoints));

	BinArray localSlots;
	localSlots.reserve(metadata.localSlotsByFunction.size());
	for (const std::vector<Blua32LocalSlotDebug>& functionSlots : metadata.localSlotsByFunction) {
		BinArray slots;
		slots.reserve(functionSlots.size());
		for (const Blua32LocalSlotDebug& slot : functionSlots) {
			slots.push_back(encodeLocalSlot(slot));
		}
		localSlots.emplace_back(std::move(slots));
	}
	value["localSlotsByFunction"] = BinValue(std::move(localSlots));

	BinArray upvalueNames;
	upvalueNames.reserve(metadata.upvalueNamesByFunction.size());
	for (const std::vector<std::string>& functionNames : metadata.upvalueNamesByFunction) {
		upvalueNames.push_back(encodeStringArray(functionNames));
	}
	value["upvalueNamesByFunction"] = BinValue(std::move(upvalueNames));
	return BinValue(std::move(value));
}

auto decodeU32Array(const BinValue& value) -> std::vector<u32> {
	const BinArray& values = value.asArray();
	std::vector<u32> result;
	result.reserve(values.size());
	for (const BinValue& entry : values) {
		result.push_back(static_cast<u32>(entry.toNumber()));
	}
	return result;
}

auto encodeU32Array(const std::vector<u32>& values) -> BinValue {
	BinArray result;
	result.reserve(values.size());
	for (u32 value : values) {
		result.emplace_back(static_cast<i64>(value));
	}
	return BinValue(std::move(result));
}

} // namespace

auto decodeBlua32SymbolsImage(std::span<const u8> bytes) -> Blua32SymbolsImage {
	const BinValue root = decodeBinary(bytes.data(), bytes.size());
	Blua32SymbolsImage symbols;
	symbols.version = static_cast<u32>(root.require("version").toNumber());
	if (symbols.version != BLUA32_SYMBOLS_VERSION) {
		throw BMSX_RUNTIME_ERROR("BLua32 symbols version is unsupported.");
	}
	symbols.imageAddress = static_cast<u32>(root.require("imageAddress").toNumber());
	symbols.functionAddresses = decodeU32Array(root.require("functionAddresses"));
	for (const BinValue& value : root.require("moduleFunctions").asArray()) {
		symbols.moduleFunctions.push_back(Blua32ModuleFunction{
			value.require("path").asString(),
			static_cast<u32>(value.require("address").toNumber()),
		});
	}
	const BinValue& staticLayoutToken = root.require("staticLayoutToken");
	symbols.staticLayoutToken.lo = static_cast<u32>(staticLayoutToken.require("lo").toNumber());
	symbols.staticLayoutToken.hi = static_cast<u32>(staticLayoutToken.require("hi").toNumber());
	symbols.metadata = decodeMetadata(root.require("metadata"));
	return symbols;
}

auto encodeBlua32SymbolsImage(const Blua32SymbolsImage& symbols) -> std::vector<u8> {
	BinArray moduleFunctions;
	moduleFunctions.reserve(symbols.moduleFunctions.size());
	for (const Blua32ModuleFunction& function : symbols.moduleFunctions) {
		BinObject value;
		value["path"] = BinValue(function.path);
		value["address"] = BinValue(static_cast<i64>(function.address));
		moduleFunctions.emplace_back(std::move(value));
	}
	BinObject staticLayoutToken;
	staticLayoutToken["lo"] = BinValue(static_cast<i64>(symbols.staticLayoutToken.lo));
	staticLayoutToken["hi"] = BinValue(static_cast<i64>(symbols.staticLayoutToken.hi));
	BinObject root;
	root["version"] = BinValue(static_cast<i64>(symbols.version));
	root["imageAddress"] = BinValue(static_cast<i64>(symbols.imageAddress));
	root["functionAddresses"] = encodeU32Array(symbols.functionAddresses);
	root["moduleFunctions"] = BinValue(std::move(moduleFunctions));
	root["staticLayoutToken"] = BinValue(std::move(staticLayoutToken));
	root["metadata"] = encodeMetadata(symbols.metadata);
	return encodeBinary(BinValue(std::move(root)));
}

auto blua32SourceRangeAtPc(
	const Blua32SymbolsImage& symbols,
	u32 textAddress,
	u32 pc
) -> std::optional<SourceRange> {
	const size_t wordIndex = static_cast<size_t>((pc - textAddress) / INSTRUCTION_BYTES);
	return symbols.metadata.debugRanges[wordIndex];
}

} // namespace bmsx
