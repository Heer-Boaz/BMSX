#include "machine/program/linker.h"
#include <algorithm>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

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

struct MergedNamedSlots {
	std::vector<std::string> names;
	std::vector<int> cartRemap;
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

void writeWideInstruction(std::vector<uint8_t>& code, int index, uint8_t a, uint8_t b, uint8_t c) {
	writeInstruction(code, index, static_cast<uint8_t>(OpCode::WIDE), a, b, c);
}

uint32_t encodeSignedRaw(int value, int bits) {
	const uint32_t mask = static_cast<uint32_t>((1 << bits) - 1);
	return static_cast<uint32_t>(value) & mask;
}

bool fitsSignedRaw(int value, int bits) {
	const int min = -(1 << (bits - 1));
	const int max = (1 << (bits - 1)) - 1;
	return value >= min && value <= max;
}

void writeBcRelocatedInstruction(
	std::vector<uint8_t>& code,
	int wordIndex,
	uint8_t op,
	uint8_t aLow,
	uint8_t bLow,
	uint8_t cLow,
	uint8_t ext,
	bool hasWide,
	uint8_t wideA,
	uint8_t wideB,
	uint8_t wideC,
	bool relocOnB,
	uint32_t raw,
	int extBits
) {
	const uint8_t low = static_cast<uint8_t>(raw & 0x3f);
	const uint32_t extMask = static_cast<uint32_t>((1 << extBits) - 1);
	const uint8_t extPart = static_cast<uint8_t>((raw >> MAX_OPERAND_BITS) & extMask);
	const uint32_t widePart = raw >> (MAX_OPERAND_BITS + extBits);
	const uint8_t extA = static_cast<uint8_t>((ext >> 6) & 0x3);
	uint8_t extB = static_cast<uint8_t>((ext >> 3) & 0x7);
	uint8_t extC = static_cast<uint8_t>(ext & 0x7);
	if (relocOnB) {
		bLow = low;
		extB = extPart;
		if (hasWide) {
			wideB = static_cast<uint8_t>(widePart & 0x3f);
		}
	} else {
		cLow = low;
		extC = extPart;
		if (hasWide) {
			wideC = static_cast<uint8_t>(widePart & 0x3f);
		}
	}
	ext = static_cast<uint8_t>((extA << 6) | (extB << 3) | extC);
	if (hasWide) {
		writeWideInstruction(code, wordIndex - 1, wideA, wideB, wideC);
	}
	writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
}

std::string makeConstKey(const StringPool& strings, Value value) {
	if (isNil(value)) {
		return "nil";
	}
	if (valueIsBool(value)) {
		return valueToBool(value) ? "b:1" : "b:0";
	}
	if (valueIsNumber(value)) {
		std::ostringstream out;
		out << "n:0x" << std::hex << std::setw(16) << std::setfill('0') << value;
		return out.str();
	}
	if (valueIsString(value)) {
		return "s:" + strings.toString(asStringId(value));
	}
	throw std::runtime_error("[ProgramLinker] Unsupported const pool value.");
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

MergedNamedSlots mergeNamedSlots(
	const std::vector<std::string>& engineNames,
	const std::vector<std::string>& cartNames
) {
	MergedNamedSlots merged;
	merged.names.reserve(engineNames.size() + cartNames.size());
	merged.names.insert(merged.names.end(), engineNames.begin(), engineNames.end());
	merged.cartRemap.resize(cartNames.size(), -1);

	std::unordered_map<std::string, int> nameToIndex;
	nameToIndex.reserve(engineNames.size() + cartNames.size());
	for (size_t index = 0; index < engineNames.size(); ++index) {
		const std::string& name = engineNames[index];
		if (nameToIndex.find(name) == nameToIndex.end()) {
			nameToIndex.emplace(name, static_cast<int>(index));
		}
	}
	for (size_t index = 0; index < cartNames.size(); ++index) {
		const std::string& name = cartNames[index];
		const auto found = nameToIndex.find(name);
		if (found != nameToIndex.end()) {
			merged.cartRemap[index] = found->second;
			continue;
		}
		const int mergedIndex = static_cast<int>(merged.names.size());
		merged.names.push_back(name);
		nameToIndex.emplace(name, mergedIndex);
		merged.cartRemap[index] = mergedIndex;
	}
	return merged;
}

struct MergedConstPool {
	std::vector<Value> values;
	std::vector<int> cartRemap;
};

MergedConstPool mergeConstPools(
	const Program& engineProgram,
	const Program& cartProgram,
	StringPool& outPool
) {
	const StringPool& engineStrings = *engineProgram.constPoolStringPool;
	const StringPool& cartStrings = *cartProgram.constPoolStringPool;
	MergedConstPool merged;
	merged.values.reserve(engineProgram.constPool.size() + cartProgram.constPool.size());
	merged.cartRemap.resize(cartProgram.constPool.size(), -1);

	std::unordered_map<std::string, int> keyToIndex;
	keyToIndex.reserve(engineProgram.constPool.size() + cartProgram.constPool.size());

	for (size_t i = 0; i < engineProgram.constPool.size(); ++i) {
		const Value value = engineProgram.constPool[i];
		const Value copied = copyConstValue(engineStrings, value, outPool);
		merged.values.push_back(copied);
		const std::string key = makeConstKey(engineStrings, value);
		if (keyToIndex.find(key) == keyToIndex.end()) {
			keyToIndex.emplace(key, static_cast<int>(i));
		}
	}

	for (size_t i = 0; i < cartProgram.constPool.size(); ++i) {
		const Value value = cartProgram.constPool[i];
		const std::string key = makeConstKey(cartStrings, value);
		const auto existing = keyToIndex.find(key);
		if (existing != keyToIndex.end()) {
			merged.cartRemap[i] = existing->second;
			continue;
		}
		const int newIndex = static_cast<int>(merged.values.size());
		merged.values.push_back(copyConstValue(cartStrings, value, outPool));
		keyToIndex.emplace(key, newIndex);
		merged.cartRemap[i] = newIndex;
	}

	return merged;
}

void rewriteClosureIndices(std::vector<uint8_t>& code, int protoOffset) {
	if (protoOffset == 0) {
		return;
	}
	const int instructionCount = static_cast<int>(code.size() / INSTRUCTION_BYTES);
	int wideIndex = -1;
	uint8_t wideA = 0;
	uint8_t wideB = 0;
	uint8_t wideC = 0;
	for (int index = 0; index < instructionCount; ++index) {
		const uint32_t word = readInstructionWord(code, index);
		const uint8_t ext = static_cast<uint8_t>(word >> 24);
		const uint8_t op = static_cast<uint8_t>((word >> 18) & 0x3f);
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
		const uint8_t aLow = static_cast<uint8_t>((word >> 12) & 0x3f);
		const uint8_t bLow = static_cast<uint8_t>((word >> 6) & 0x3f);
		const uint8_t cLow = static_cast<uint8_t>(word & 0x3f);
		const uint32_t bxLow = (static_cast<uint32_t>(bLow) << 6) | static_cast<uint32_t>(cLow);
		const uint32_t bx = (static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS))
			| (static_cast<uint32_t>(ext) << MAX_BX_BITS)
			| bxLow;
		const uint32_t nextBx = bx + static_cast<uint32_t>(protoOffset);
		if (nextBx > static_cast<uint32_t>(MAX_EXT_BX)) {
			throw std::runtime_error("[ProgramLinker] Proto index exceeds range.");
		}
		const uint32_t nextWide = nextBx >> (MAX_BX_BITS + EXT_BX_BITS);
		if (nextWide != 0 && wideIndex < 0) {
			throw std::runtime_error("[ProgramLinker] Proto index requires WIDE prefix.");
		}
		const uint8_t nextExt = static_cast<uint8_t>((nextBx >> MAX_BX_BITS) & 0xff);
		const uint16_t nextLow = static_cast<uint16_t>(nextBx & MAX_LOW_BX);
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

void rewriteConstRelocations(
	std::vector<uint8_t>& code,
	const std::vector<ProgramAsset::ConstReloc>& relocs,
	const std::vector<int>& cartConstRemap,
	const std::vector<int>& cartGlobalRemap,
	const std::vector<int>& cartSystemGlobalRemap
) {
	for (size_t i = 0; i < relocs.size(); ++i) {
		const ProgramAsset::ConstReloc& reloc = relocs[i];
		const int wordIndex = reloc.wordIndex;
		uint32_t word = readInstructionWord(code, wordIndex);
		uint8_t op = static_cast<uint8_t>((word >> 18) & 0x3f);
		const bool hasWide = wordIndex > 0
			&& static_cast<OpCode>((readInstructionWord(code, wordIndex - 1) >> 18) & 0x3f) == OpCode::WIDE;
		uint8_t wideA = 0;
		uint8_t wideB = 0;
		uint8_t wideC = 0;
		if (hasWide) {
			const uint32_t wideWord = readInstructionWord(code, wordIndex - 1);
			wideA = static_cast<uint8_t>((wideWord >> 12) & 0x3f);
			wideB = static_cast<uint8_t>((wideWord >> 6) & 0x3f);
			wideC = static_cast<uint8_t>(wideWord & 0x3f);
		}
		const uint8_t aLow = static_cast<uint8_t>((word >> 12) & 0x3f);
		uint8_t bLow = static_cast<uint8_t>((word >> 6) & 0x3f);
		uint8_t cLow = static_cast<uint8_t>(word & 0x3f);
		uint8_t ext = static_cast<uint8_t>(word >> 24);

		const int mappedIndex = reloc.kind == ProgramAsset::ConstRelocKind::Gl
			? cartGlobalRemap[static_cast<size_t>(reloc.constIndex)]
			: reloc.kind == ProgramAsset::ConstRelocKind::Sys
				? cartSystemGlobalRemap[static_cast<size_t>(reloc.constIndex)]
				: cartConstRemap[static_cast<size_t>(reloc.constIndex)];

		if (reloc.kind == ProgramAsset::ConstRelocKind::Bx
			|| reloc.kind == ProgramAsset::ConstRelocKind::Gl
			|| reloc.kind == ProgramAsset::ConstRelocKind::Sys) {
			const uint32_t nextWide = static_cast<uint32_t>(mappedIndex) >> (MAX_BX_BITS + EXT_BX_BITS);
			if (!hasWide && nextWide != 0) {
				throw std::runtime_error("[ProgramLinker] Const reloc requires WIDE prefix.");
			}
			const uint8_t nextExt = static_cast<uint8_t>((static_cast<uint32_t>(mappedIndex) >> MAX_BX_BITS) & 0xff);
			const uint16_t nextLow = static_cast<uint16_t>(static_cast<uint32_t>(mappedIndex) & MAX_LOW_BX);
			bLow = static_cast<uint8_t>((nextLow >> 6) & 0x3f);
			cLow = static_cast<uint8_t>(nextLow & 0x3f);
				ext = nextExt;
				if (hasWide) {
					wideB = static_cast<uint8_t>(nextWide & 0x3f);
					writeWideInstruction(code, wordIndex - 1, wideA, wideB, wideC);
				}
				writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
				continue;
		}

		if (reloc.kind == ProgramAsset::ConstRelocKind::ConstB
			|| reloc.kind == ProgramAsset::ConstRelocKind::ConstC) {
			// These are direct const operands for specialized opcodes, not signed RK encodings.
			// Rewriting them with the RK path silently mangles the operand bits and only shows up
			// later in release/libretro when the linked program executes the wrong instruction data.
			const bool relocOnB = reloc.kind == ProgramAsset::ConstRelocKind::ConstB;
			const int extBits = relocOnB ? EXT_B_BITS : EXT_C_BITS;
			const int baseBits = MAX_OPERAND_BITS + extBits;
			const uint32_t maxBase = (1u << baseBits) - 1u;
			if (!hasWide && static_cast<uint32_t>(mappedIndex) > maxBase) {
				throw std::runtime_error("[ProgramLinker] Const reloc requires WIDE prefix.");
			}
			const int totalBits = MAX_OPERAND_BITS + extBits + (hasWide ? MAX_OPERAND_BITS : 0);
			const uint32_t maxValue = (1u << totalBits) - 1u;
			if (static_cast<uint32_t>(mappedIndex) > maxValue) {
				throw std::runtime_error("[ProgramLinker] Const reloc exceeds operand range.");
			}
			writeBcRelocatedInstruction(
				code,
				wordIndex,
				op,
				aLow,
				bLow,
				cLow,
				ext,
				hasWide,
				wideA,
				wideB,
				wideC,
				relocOnB,
				static_cast<uint32_t>(mappedIndex),
				extBits
			);
			continue;
		}

		const bool relocOnB = reloc.kind == ProgramAsset::ConstRelocKind::RkB;
		const int rkValue = -mappedIndex - 1;
		const int extBits = relocOnB ? EXT_B_BITS : EXT_C_BITS;
		const int baseBits = MAX_OPERAND_BITS + extBits;
		if (!hasWide && !fitsSignedRaw(rkValue, baseBits)) {
			throw std::runtime_error("[ProgramLinker] Const reloc requires WIDE prefix.");
		}
		const int totalBits = MAX_OPERAND_BITS + extBits + (hasWide ? MAX_OPERAND_BITS : 0);
		const uint32_t raw = encodeSignedRaw(rkValue, totalBits);
		writeBcRelocatedInstruction(
			code,
			wordIndex,
			op,
			aLow,
			bLow,
			cLow,
			ext,
			hasWide,
			wideA,
			wideB,
			wideC,
			relocOnB,
			raw,
			extBits
		);
	}
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
	if (engine->localSlotsByProto.size() != engine->protoIds.size()) {
		throw std::runtime_error("[ProgramLinker] Engine local slot metadata length mismatch.");
	}
	if (cart->localSlotsByProto.size() != cart->protoIds.size()) {
		throw std::runtime_error("[ProgramLinker] Cart local slot metadata length mismatch.");
	}
	if (engine->upvalueNamesByProto.size() != engine->protoIds.size()) {
		throw std::runtime_error("[ProgramLinker] Engine upvalue name metadata length mismatch.");
	}
	if (cart->upvalueNamesByProto.size() != cart->protoIds.size()) {
		throw std::runtime_error("[ProgramLinker] Cart upvalue name metadata length mismatch.");
	}
	const int engineBaseWord = layout.engineBasePc / INSTRUCTION_BYTES;
	const int cartBaseWord = layout.cartBasePc / INSTRUCTION_BYTES;
	const int totalInstructionCount = std::max(engineBaseWord + engineInstructionCount, cartBaseWord + cartInstructionCount);
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
	merged->localSlotsByProto = engine->localSlotsByProto;
	merged->localSlotsByProto.insert(
		merged->localSlotsByProto.end(),
		cart->localSlotsByProto.begin(),
		cart->localSlotsByProto.end()
	);
	merged->upvalueNamesByProto = engine->upvalueNamesByProto;
	merged->upvalueNamesByProto.insert(
		merged->upvalueNamesByProto.end(),
		cart->upvalueNamesByProto.begin(),
		cart->upvalueNamesByProto.end()
	);
	const MergedNamedSlots systemGlobalNames = mergeNamedSlots(engine->systemGlobalNames, cart->systemGlobalNames);
	const MergedNamedSlots globalNames = mergeNamedSlots(engine->globalNames, cart->globalNames);
	merged->systemGlobalNames = systemGlobalNames.names;
	merged->globalNames = globalNames.names;
	return merged;
}

} // namespace

LinkedProgramAsset linkProgramAssets(
	const ProgramAsset& engineAsset,
	const ProgramMetadata* engineSymbols,
	const ProgramAsset& cartAsset,
	const ProgramMetadata* cartSymbols,
	int engineBasePc,
	int cartBasePc
) {
	if (!engineAsset.program || !cartAsset.program) {
		throw std::runtime_error("[ProgramLinker] Missing program asset.");
	}
	const Program& engineProgram = *engineAsset.program;
	const Program& cartProgram = *cartAsset.program;
	const int engineCodeBytes = static_cast<int>(engineProgram.code.size());
	const int cartCodeBytes = static_cast<int>(cartProgram.code.size());
	ProgramLayout layout = resolveProgramLayout(engineCodeBytes, engineBasePc, cartBasePc);

	std::vector<uint8_t> cartCode = cartProgram.code;
	rewriteClosureIndices(cartCode, static_cast<int>(engineProgram.protos.size()));

	auto linkedProgram = std::make_unique<Program>();
	linkedProgram->constPoolStringPool = &linkedProgram->stringPool;
	MergedConstPool merged = mergeConstPools(engineProgram, cartProgram, linkedProgram->stringPool);
	const MergedNamedSlots mergedSystemGlobals = mergeNamedSlots(
		engineSymbols ? engineSymbols->systemGlobalNames : std::vector<std::string>{},
		cartSymbols ? cartSymbols->systemGlobalNames : std::vector<std::string>{}
	);
	const MergedNamedSlots mergedGlobals = mergeNamedSlots(
		engineSymbols ? engineSymbols->globalNames : std::vector<std::string>{},
		cartSymbols ? cartSymbols->globalNames : std::vector<std::string>{}
	);
	rewriteConstRelocations(
		cartCode,
		cartAsset.link.constRelocs,
		merged.cartRemap,
		mergedGlobals.cartRemap,
		mergedSystemGlobals.cartRemap
	);
	linkedProgram->constPool = std::move(merged.values);

	linkedProgram->protos.reserve(engineProgram.protos.size() + cartProgram.protos.size());
	for (const auto& proto : engineProgram.protos) {
		linkedProgram->protos.push_back(cloneProto(proto, layout.engineBasePc));
	}
	for (const auto& proto : cartProgram.protos) {
		linkedProgram->protos.push_back(cloneProto(proto, layout.cartBasePc));
	}

	const int totalBytes = std::max(layout.engineBasePc + engineCodeBytes, layout.cartBasePc + cartCodeBytes);
	linkedProgram->code.assign(static_cast<size_t>(totalBytes), 0);
	std::copy(engineProgram.code.begin(), engineProgram.code.end(), linkedProgram->code.begin() + layout.engineBasePc);
	std::copy(cartCode.begin(), cartCode.end(), linkedProgram->code.begin() + layout.cartBasePc);
	linkedProgram->constPoolCanonicalized = false;

	auto linkedAsset = std::make_unique<ProgramAsset>();
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
	linkedAsset->link.constRelocs.clear();

	const int engineInstructionCount = engineCodeBytes / INSTRUCTION_BYTES;
	const int cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	std::unique_ptr<ProgramMetadata> mergedMetadata = mergeMetadata(engineSymbols, cartSymbols, layout, engineInstructionCount, cartInstructionCount);

	LinkedProgramAsset output;
	output.program = std::move(linkedAsset);
	output.metadata = std::move(mergedMetadata);
	return output;
}

} // namespace bmsx
