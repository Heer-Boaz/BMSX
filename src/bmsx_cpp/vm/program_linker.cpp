#include "program_linker.h"
#include <algorithm>
#include <cmath>
#include <sstream>
#include <stdexcept>

namespace bmsx {

namespace {

constexpr int MAX_LOW_BX = (1 << MAX_BX_BITS) - 1;
constexpr int MAX_WIDE = (1 << MAX_OPERAND_BITS) - 1;
constexpr int MAX_BASE_BX = (1 << (MAX_BX_BITS + EXT_BX_BITS)) - 1;
constexpr int MAX_EXT_BX = (MAX_WIDE << (MAX_BX_BITS + EXT_BX_BITS)) | MAX_BASE_BX;

struct ProgramLayout {
	int engineBasePc;
	int cartBasePc;
};

ProgramLayout resolveProgramLayout(int engineCodeBytes, int engineBasePc, int cartBasePc) {
	if (engineBasePc < 0) {
		throw std::runtime_error("[ProgramLinker] Engine base PC must be >= 0.");
	}
	if (cartBasePc < 0) {
		throw std::runtime_error("[ProgramLinker] Cart base PC must be >= 0.");
	}
	if (engineBasePc % INSTRUCTION_BYTES != 0) {
		throw std::runtime_error("[ProgramLinker] Engine base PC must align to instruction bytes.");
	}
	if (cartBasePc % INSTRUCTION_BYTES != 0) {
		throw std::runtime_error("[ProgramLinker] Cart base PC must align to instruction bytes.");
	}
	if (engineBasePc + engineCodeBytes > cartBasePc) {
		throw std::runtime_error("[ProgramLinker] Engine program overlaps cart base PC.");
	}
	return {engineBasePc, cartBasePc};
}

uint32_t readInstructionWord(const std::vector<uint8_t>& code, int index) {
	size_t offset = static_cast<size_t>(index) * INSTRUCTION_BYTES;
	return (static_cast<uint32_t>(code[offset]) << 24)
		| (static_cast<uint32_t>(code[offset + 1]) << 16)
		| (static_cast<uint32_t>(code[offset + 2]) << 8)
		| static_cast<uint32_t>(code[offset + 3]);
}

void writeInstruction(std::vector<uint8_t>& code, int index, uint8_t op, uint8_t a, uint8_t b, uint8_t c, uint8_t ext = 0) {
	uint32_t word = (static_cast<uint32_t>(ext) << 24)
		| (static_cast<uint32_t>(op & 0x3f) << 18)
		| (static_cast<uint32_t>(a & 0x3f) << 12)
		| (static_cast<uint32_t>(b & 0x3f) << 6)
		| static_cast<uint32_t>(c & 0x3f);
	size_t offset = static_cast<size_t>(index) * INSTRUCTION_BYTES;
	code[offset] = static_cast<uint8_t>((word >> 24) & 0xff);
	code[offset + 1] = static_cast<uint8_t>((word >> 16) & 0xff);
	code[offset + 2] = static_cast<uint8_t>((word >> 8) & 0xff);
	code[offset + 3] = static_cast<uint8_t>(word & 0xff);
}

void rewriteClosureIndices(std::vector<uint8_t>& code, int protoOffset) {
	if (protoOffset == 0) {
		return;
	}
	int instructionCount = static_cast<int>(code.size() / INSTRUCTION_BYTES);
	int wideIndex = -1;
	uint8_t wideA = 0;
	uint8_t wideB = 0;
	uint8_t wideC = 0;
	for (int index = 0; index < instructionCount; ++index) {
		uint32_t word = readInstructionWord(code, index);
		uint8_t ext = static_cast<uint8_t>(word >> 24);
		uint8_t op = static_cast<uint8_t>((word >> 18) & 0x3f);
		if (static_cast<OpCode>(op) == OpCode::WIDE) {
			wideIndex = index;
			wideA = static_cast<uint8_t>((word >> 12) & 0x3f);
			wideB = static_cast<uint8_t>((word >> 6) & 0x3f);
			wideC = static_cast<uint8_t>(word & 0x3f);
			continue;
		}
		if (static_cast<OpCode>(op) != OpCode::CLOSURE) {
			wideIndex = -1;
			wideA = 0;
			wideB = 0;
			wideC = 0;
			continue;
		}
		uint8_t aLow = static_cast<uint8_t>((word >> 12) & 0x3f);
		uint8_t bLow = static_cast<uint8_t>((word >> 6) & 0x3f);
		uint8_t cLow = static_cast<uint8_t>(word & 0x3f);
		uint32_t bxLow = (static_cast<uint32_t>(bLow) << 6) | static_cast<uint32_t>(cLow);
		uint32_t bx = (static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS))
			| (static_cast<uint32_t>(ext) << MAX_BX_BITS)
			| bxLow;
		uint32_t nextBx = bx + static_cast<uint32_t>(protoOffset);
		if (nextBx > static_cast<uint32_t>(MAX_EXT_BX)) {
			throw std::runtime_error("[ProgramLinker] Proto index exceeds range.");
		}
		uint32_t nextWide = nextBx >> (MAX_BX_BITS + EXT_BX_BITS);
		if (nextWide != 0 && wideIndex < 0) {
			throw std::runtime_error("[ProgramLinker] Proto index requires WIDE prefix.");
		}
		uint8_t nextExt = static_cast<uint8_t>((nextBx >> MAX_BX_BITS) & 0xff);
		uint16_t nextLow = static_cast<uint16_t>(nextBx & MAX_LOW_BX);
		writeInstruction(code, index, op, aLow, static_cast<uint8_t>((nextLow >> 6) & 0x3f), static_cast<uint8_t>(nextLow & 0x3f), nextExt);
		if (wideIndex >= 0) {
			writeInstruction(code, wideIndex, static_cast<uint8_t>(OpCode::WIDE), wideA, static_cast<uint8_t>(nextWide & 0x3f), wideC, 0);
		}
		wideIndex = -1;
		wideA = 0;
		wideB = 0;
		wideC = 0;
	}
}

bool constValuesEqual(const StringPool& engineStrings, const StringPool& cartStrings, Value engineValue, Value cartValue) {
	if (isNil(engineValue) && isNil(cartValue)) {
		return true;
	}
	if (valueIsNumber(engineValue) && valueIsNumber(cartValue)) {
		return valueToNumber(engineValue) == valueToNumber(cartValue);
	}
	if (valueIsBool(engineValue) && valueIsBool(cartValue)) {
		return valueToBool(engineValue) == valueToBool(cartValue);
	}
	if (valueIsString(engineValue) && valueIsString(cartValue)) {
		const std::string& engineText = engineStrings.toString(asStringId(engineValue));
		const std::string& cartText = cartStrings.toString(asStringId(cartValue));
		return engineText == cartText;
	}
	return false;
}

std::string formatConstValue(const StringPool& strings, Value value) {
	if (isNil(value)) {
		return "nil";
	}
	if (valueIsBool(value)) {
		return valueToBool(value) ? "true" : "false";
	}
	if (valueIsNumber(value)) {
		const double number = valueToNumber(value);
		if (std::isnan(number)) {
			return "nan";
		}
		if (std::isinf(number)) {
			return number > 0.0 ? "inf" : "-inf";
		}
		std::ostringstream out;
		out.precision(17);
		out << number;
		return out.str();
	}
	if (valueIsString(value)) {
		const std::string& text = strings.toString(asStringId(value));
		return "\"" + text + "\"";
	}
	return "<unknown>";
}

Value copyConstValue(const StringPool& sourceStrings, Value value, StringPool& outPool) {
	if (isNil(value) || valueIsNumber(value) || valueIsBool(value)) {
		return value;
	}
	if (valueIsString(value)) {
		const std::string& text = sourceStrings.toString(asStringId(value));
		return valueString(outPool.intern(text));
	}
	throw std::runtime_error("[ProgramLinker] Unsupported const pool value.");
}

Proto cloneProto(const Proto& proto, int entryOffset) {
	Proto next = proto;
	next.entryPC = proto.entryPC + entryOffset;
	return next;
}

std::unique_ptr<ProgramMetadata> mergeMetadata(
	const ProgramMetadata* engine,
	const ProgramMetadata* cart,
	const ProgramLayout& layout,
	int engineInstructionCount,
	int cartInstructionCount
) {
	if (!engine && !cart) {
		return nullptr;
	}
	if (!engine || !cart) {
		throw std::runtime_error("[ProgramLinker] Linking requires both engine and cart symbols.");
	}
	if (static_cast<int>(engine->debugRanges.size()) != engineInstructionCount) {
		throw std::runtime_error("[ProgramLinker] Engine debug range length mismatch.");
	}
	if (static_cast<int>(cart->debugRanges.size()) != cartInstructionCount) {
		throw std::runtime_error("[ProgramLinker] Cart debug range length mismatch.");
	}
	int engineBaseWord = layout.engineBasePc / INSTRUCTION_BYTES;
	int cartBaseWord = layout.cartBasePc / INSTRUCTION_BYTES;
	int totalInstructionCount = std::max(engineBaseWord + engineInstructionCount, cartBaseWord + cartInstructionCount);
	auto merged = std::make_unique<ProgramMetadata>();
	merged->debugRanges.assign(static_cast<size_t>(totalInstructionCount), std::nullopt);
	for (int i = 0; i < engineInstructionCount; ++i) {
		merged->debugRanges[static_cast<size_t>(engineBaseWord + i)] = engine->debugRanges[static_cast<size_t>(i)];
	}
	for (int i = 0; i < cartInstructionCount; ++i) {
		merged->debugRanges[static_cast<size_t>(cartBaseWord + i)] = cart->debugRanges[static_cast<size_t>(i)];
	}
	merged->protoIds = engine->protoIds;
	merged->protoIds.insert(merged->protoIds.end(), cart->protoIds.begin(), cart->protoIds.end());
	return merged;
}

} // namespace

LinkedProgramAsset linkProgramAssets(
	const VmProgramAsset& engineAsset,
	const ProgramMetadata* engineSymbols,
	const VmProgramAsset& cartAsset,
	const ProgramMetadata* cartSymbols,
	int engineBasePc,
	int cartBasePc
) {
	if (!engineAsset.program || !cartAsset.program) {
		throw std::runtime_error("[ProgramLinker] Missing program asset.");
	}
	const Program& engineProgram = *engineAsset.program;
	const Program& cartProgram = *cartAsset.program;
	const StringPool& engineStrings = *engineProgram.constPoolStringPool;
	const StringPool& cartStrings = *cartProgram.constPoolStringPool;

	const size_t engineConstCount = engineProgram.constPool.size();
	if (cartProgram.constPool.size() < engineConstCount) {
		throw std::runtime_error("[ProgramLinker] Cart const pool does not include engine prefix.");
	}
	for (size_t i = 0; i < engineConstCount; ++i) {
		if (!constValuesEqual(engineStrings, cartStrings, engineProgram.constPool[i], cartProgram.constPool[i])) {
			std::ostringstream message;
			message << "[ProgramLinker] Cart const pool differs at index " << i
				<< " (engine=" << formatConstValue(engineStrings, engineProgram.constPool[i])
				<< ", cart=" << formatConstValue(cartStrings, cartProgram.constPool[i]) << ").";
			throw std::runtime_error(message.str());
		}
	}

	const int engineCodeBytes = static_cast<int>(engineProgram.code.size());
	const int cartCodeBytes = static_cast<int>(cartProgram.code.size());
	ProgramLayout layout = resolveProgramLayout(engineCodeBytes, engineBasePc, cartBasePc);

	std::vector<uint8_t> cartCode = cartProgram.code;
	rewriteClosureIndices(cartCode, static_cast<int>(engineProgram.protos.size()));

	auto linkedProgram = std::make_unique<Program>();
	linkedProgram->constPoolStringPool = &linkedProgram->stringPool;
	linkedProgram->constPool.reserve(engineConstCount + (cartProgram.constPool.size() - engineConstCount));
	for (size_t i = 0; i < engineConstCount; ++i) {
		linkedProgram->constPool.push_back(copyConstValue(engineStrings, engineProgram.constPool[i], linkedProgram->stringPool));
	}
	for (size_t i = engineConstCount; i < cartProgram.constPool.size(); ++i) {
		linkedProgram->constPool.push_back(copyConstValue(cartStrings, cartProgram.constPool[i], linkedProgram->stringPool));
	}

	linkedProgram->protos.reserve(engineProgram.protos.size() + cartProgram.protos.size());
	for (const auto& proto : engineProgram.protos) {
		linkedProgram->protos.push_back(cloneProto(proto, layout.engineBasePc));
	}
	for (const auto& proto : cartProgram.protos) {
		linkedProgram->protos.push_back(cloneProto(proto, layout.cartBasePc));
	}

	int totalBytes = std::max(layout.engineBasePc + engineCodeBytes, layout.cartBasePc + cartCodeBytes);
	linkedProgram->code.assign(static_cast<size_t>(totalBytes), 0);
	std::copy(engineProgram.code.begin(), engineProgram.code.end(), linkedProgram->code.begin() + layout.engineBasePc);
	std::copy(cartCode.begin(), cartCode.end(), linkedProgram->code.begin() + layout.cartBasePc);
	linkedProgram->constPoolCanonicalized = false;

	auto linkedAsset = std::make_unique<VmProgramAsset>();
	linkedAsset->entryProtoIndex = cartAsset.entryProtoIndex + static_cast<int>(engineProgram.protos.size());
	linkedAsset->program = std::move(linkedProgram);
	linkedAsset->moduleProtos.reserve(cartAsset.moduleProtos.size() + engineAsset.moduleProtos.size());
	for (const auto& entry : cartAsset.moduleProtos) {
		linkedAsset->moduleProtos.emplace_back(entry.first, entry.second + static_cast<int>(engineProgram.protos.size()));
	}
	for (const auto& entry : engineAsset.moduleProtos) {
		linkedAsset->moduleProtos.emplace_back(entry.first, entry.second);
	}
	linkedAsset->moduleAliases.reserve(cartAsset.moduleAliases.size() + engineAsset.moduleAliases.size());
	linkedAsset->moduleAliases.insert(linkedAsset->moduleAliases.end(), cartAsset.moduleAliases.begin(), cartAsset.moduleAliases.end());
	linkedAsset->moduleAliases.insert(linkedAsset->moduleAliases.end(), engineAsset.moduleAliases.begin(), engineAsset.moduleAliases.end());

	int engineInstructionCount = engineCodeBytes / INSTRUCTION_BYTES;
	int cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	std::unique_ptr<ProgramMetadata> mergedMetadata = mergeMetadata(engineSymbols, cartSymbols, layout, engineInstructionCount, cartInstructionCount);

	LinkedProgramAsset output;
	output.program = std::move(linkedAsset);
	output.metadata = std::move(mergedMetadata);
	return output;
}

} // namespace bmsx
