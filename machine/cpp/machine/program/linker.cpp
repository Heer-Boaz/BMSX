#include "machine/program/linker.h"
#include "machine/cpu/instruction_format.h"
#include "machine/memory/map.h"
#include <algorithm>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

namespace bmsx {

namespace {

struct MergedNamedSlots {
	std::vector<std::string> names;
	std::vector<int> cartRemap;
};

bool relocRequiresSymbolMetadata(const ProgramConstReloc& reloc) {
	return std::holds_alternative<ProgramSymbolicConstReloc>(reloc.target);
}

bool cartRelocRequiresMetadata(const ProgramConstReloc& reloc) {
	if (relocRequiresSymbolMetadata(reloc)) {
		return true;
	}
	const auto& indexed = std::get<ProgramIndexedConstReloc>(reloc.target);
	return indexed.kind == ProgramIndexedConstRelocKind::Gl || indexed.kind == ProgramIndexedConstRelocKind::Sys;
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
		writeInstruction(code, wordIndex - 1, static_cast<uint8_t>(OpCode::WIDE), wideA, wideB, wideC);
	}
	writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
}

std::string makeConstKey(const EncodedValue& value) {
	if (std::holds_alternative<std::nullptr_t>(value)) {
		return "nil";
	}
	if (const auto* boolValue = std::get_if<bool>(&value)) {
		return *boolValue ? "b:1" : "b:0";
	}
	if (const auto* numberValue = std::get_if<double>(&value)) {
		uint64_t bits = VALUE_QNAN_MASK;
		if (*numberValue == *numberValue) {
			std::memcpy(&bits, numberValue, sizeof(bits));
		}
		std::ostringstream out;
		out << "n:0x" << std::hex << std::setw(16) << std::setfill('0') << bits;
		return out.str();
	}
	if (const auto* stringValue = std::get_if<std::string>(&value)) {
		return "s:" + *stringValue;
	}
	throw std::runtime_error("[ProgramLinker] Unsupported const pool value.");
}

MergedNamedSlots mergeNamedSlots(
	const std::vector<std::string>& systemNames,
	const std::vector<std::string>& cartNames
) {
	MergedNamedSlots merged;
	merged.names.reserve(systemNames.size() + cartNames.size());
	merged.names.insert(merged.names.end(), systemNames.begin(), systemNames.end());
	merged.cartRemap.resize(cartNames.size(), -1);

	std::unordered_map<std::string, int> nameToIndex;
	nameToIndex.reserve(systemNames.size() + cartNames.size());
	for (size_t index = 0; index < systemNames.size(); ++index) {
		const std::string& name = systemNames[index];
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
	std::vector<EncodedValue> values;
	std::vector<int> cartRemap;
};

MergedConstPool mergeConstPools(
	const std::vector<EncodedValue>& systemConstPool,
	const std::vector<EncodedValue>& cartConstPool
) {
	const size_t systemConstCount = systemConstPool.size();
	const size_t cartConstCount = cartConstPool.size();
	MergedConstPool merged;
	merged.values.reserve(systemConstCount + cartConstCount);
	merged.cartRemap.resize(cartConstCount, -1);

	std::unordered_map<std::string, int> keyToIndex;
	keyToIndex.reserve(systemConstCount + cartConstCount);

	for (size_t i = 0; i < systemConstCount; ++i) {
		const EncodedValue& value = systemConstPool[i];
		merged.values.push_back(value);
		const std::string key = makeConstKey(value);
		if (keyToIndex.find(key) == keyToIndex.end()) {
			keyToIndex.emplace(key, static_cast<int>(i));
		}
	}

	for (size_t i = 0; i < cartConstCount; ++i) {
		const EncodedValue& value = cartConstPool[i];
		const std::string key = makeConstKey(value);
		const auto existing = keyToIndex.find(key);
		if (existing != keyToIndex.end()) {
			merged.cartRemap[i] = existing->second;
			continue;
		}
		const int newIndex = static_cast<int>(merged.values.size());
		merged.values.push_back(value);
		keyToIndex.emplace(key, newIndex);
		merged.cartRemap[i] = newIndex;
	}

	return merged;
}


void assertStaticRamFits(uint32_t baseAddress, size_t byteCount) {
	if (baseAddress > RAM_END || byteCount > static_cast<size_t>(RAM_END - baseAddress)) {
		throw std::runtime_error("[ProgramLinker] static RAM range " + std::to_string(baseAddress) + "+" + std::to_string(byteCount) + " exceeds RAM end " + std::to_string(RAM_END) + ".");
	}
}

void assertProgramRomFits(size_t byteCount) {
	if (byteCount > PROGRAM_ROM_SIZE) {
		throw std::runtime_error("[ProgramLinker] program ROM range " + std::to_string(byteCount) + " exceeds ROM size " + std::to_string(PROGRAM_ROM_SIZE) + ".");
	}
}

template <typename Symbol>
double resolveStorageSymbolAddress(
	const std::vector<Symbol>& symbols,
	uint32_t baseAddress,
	const std::string& symbolName,
	int addend,
	const char* sectionName
) {
	for (const Symbol& symbol : symbols) {
		if (symbol.name == symbolName) {
			return static_cast<double>(static_cast<int64_t>(baseAddress) + static_cast<int64_t>(symbol.offset) + addend);
		}
	}
	throw std::runtime_error(std::string("[ProgramLinker] Missing ") + sectionName + " symbol '" + symbolName + "'.");
}

std::vector<EncodedValue> resolveConstValueRelocations(
	const std::vector<EncodedValue>& constPool,
	const std::vector<ProgramConstValueReloc>& relocs,
	const std::vector<ProgramDataSection::Symbol>& dataSymbols,
	uint32_t dataBaseAddress,
	uint32_t dataLmaAddress,
	const std::vector<ProgramBssSection::Symbol>& bssSymbols,
	uint32_t bssBaseAddress,
	const std::vector<ProgramRodataSection::Symbol>& rodataSymbols,
	uint32_t rodataBaseAddress
) {
	std::vector<EncodedValue> out = constPool;
	for (const ProgramConstValueReloc& reloc : relocs) {
		switch (reloc.kind) {
			case ProgramConstValueRelocKind::DataAddr:
				out[static_cast<size_t>(reloc.constIndex)] = resolveStorageSymbolAddress(dataSymbols, dataBaseAddress, reloc.symbol, reloc.addend, ".data");
				break;
			case ProgramConstValueRelocKind::DataLmaAddr:
				out[static_cast<size_t>(reloc.constIndex)] = resolveStorageSymbolAddress(dataSymbols, dataLmaAddress, reloc.symbol, reloc.addend, ".data");
				break;
			case ProgramConstValueRelocKind::BssAddr:
				out[static_cast<size_t>(reloc.constIndex)] = resolveStorageSymbolAddress(bssSymbols, bssBaseAddress, reloc.symbol, reloc.addend, ".bss");
				break;
			case ProgramConstValueRelocKind::RodataAddr:
				out[static_cast<size_t>(reloc.constIndex)] = resolveStorageSymbolAddress(rodataSymbols, rodataBaseAddress, reloc.symbol, reloc.addend, ".rodata");
				break;
		}
	}
	return out;
}


struct ResolvedExportSlot {
	OpCode op = OpCode::GETGL;
	int slot = -1;
};

ResolvedExportSlot resolveLinkedExportSlot(
	const std::string& slotName,
	const std::vector<std::string>& mergedGlobalNames,
	const std::vector<std::string>& mergedSystemGlobalNames
) {
	for (size_t index = 0; index < mergedGlobalNames.size(); ++index) {
		if (mergedGlobalNames[index] == slotName) {
			return {OpCode::GETGL, static_cast<int>(index)};
		}
	}
	for (size_t index = 0; index < mergedSystemGlobalNames.size(); ++index) {
		if (mergedSystemGlobalNames[index] == slotName) {
			return {OpCode::GETSYS, static_cast<int>(index)};
		}
	}
	throw std::runtime_error("[ProgramLinker] Missing module export slot '" + slotName + "' in merged globals.");
}

void writeResolvedABx(std::vector<uint8_t>& code, int wordIndex, OpCode targetOp, int value) {
	const uint32_t word = readInstructionWord(code, wordIndex);
	const bool hasWide = wordIndex > 0
		&& static_cast<OpCode>((readInstructionWord(code, wordIndex - 1) >> 18) & 0x3f) == OpCode::WIDE;
	const uint8_t aLow = static_cast<uint8_t>((word >> 12) & 0x3f);
	const uint32_t unsignedValue = static_cast<uint32_t>(value);
	const uint32_t nextWide = unsignedValue >> (MAX_BX_BITS + EXT_BX_BITS);
	if (!hasWide && nextWide != 0) {
		throw std::runtime_error("[ProgramLinker] Const reloc requires WIDE prefix.");
	}
	const uint8_t nextExt = static_cast<uint8_t>((unsignedValue >> MAX_BX_BITS) & 0xff);
	const uint16_t nextLow = static_cast<uint16_t>(unsignedValue & MAX_LOW_BX);
	if (hasWide) {
		const uint32_t wideWord = readInstructionWord(code, wordIndex - 1);
		const uint8_t wideA = static_cast<uint8_t>((wideWord >> 12) & 0x3f);
		const uint8_t wideC = static_cast<uint8_t>(wideWord & 0x3f);
		writeInstruction(code, wordIndex - 1, static_cast<uint8_t>(OpCode::WIDE), wideA, static_cast<uint8_t>(nextWide & 0x3f), wideC);
	}
	writeInstruction(
		code,
		wordIndex,
		static_cast<uint8_t>(targetOp),
		aLow,
		static_cast<uint8_t>((nextLow >> 6) & 0x3f),
		static_cast<uint8_t>(nextLow & 0x3f),
		nextExt
	);
}

struct ResolvedExportProtoTarget {
	OpCode op = OpCode::GETGL;
	int value = -1;
};

ResolvedExportProtoTarget resolveExportProtoRelocTarget(
	const std::string& slotName,
	const std::vector<std::string>& globalNames,
	const std::vector<std::string>& systemGlobalNames,
	const std::unordered_map<std::string, std::string>& exportProtoIdBySlot,
	const std::vector<std::string>& protoIds
) {
	const auto protoIt = exportProtoIdBySlot.find(slotName);
	if (protoIt != exportProtoIdBySlot.end()) {
		const auto protoFound = std::find(protoIds.begin(), protoIds.end(), protoIt->second);
		if (protoFound == protoIds.end()) {
			throw std::runtime_error("[ProgramLinker] export_proto reloc cannot resolve proto '" + protoIt->second + "' for slot '" + slotName + "'.");
		}
		return {OpCode::CLOSURE, static_cast<int>(protoFound - protoIds.begin())};
	}
	const ResolvedExportSlot resolvedSlot = resolveLinkedExportSlot(slotName, globalNames, systemGlobalNames);
	return {resolvedSlot.op, resolvedSlot.slot};
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

void rewriteConstPoolRelocations(
	std::vector<uint8_t>& code,
	const std::vector<ProgramConstReloc>& relocs,
	const std::vector<int>& cartConstRemap
) {
	for (size_t i = 0; i < relocs.size(); ++i) {
		const ProgramConstReloc& reloc = relocs[i];
		const auto* indexed = std::get_if<ProgramIndexedConstReloc>(&reloc.target);
		if (!indexed
			|| indexed->kind == ProgramIndexedConstRelocKind::Gl
			|| indexed->kind == ProgramIndexedConstRelocKind::Sys) {
			continue;
		}
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

		const int mappedIndex = cartConstRemap[static_cast<size_t>(indexed->constIndex)];

		if (indexed->kind == ProgramIndexedConstRelocKind::Bx) {
			writeResolvedABx(code, wordIndex, static_cast<OpCode>(op), mappedIndex);
			continue;
		}

		if (indexed->kind == ProgramIndexedConstRelocKind::ConstB
			|| indexed->kind == ProgramIndexedConstRelocKind::ConstC) {
			// These are direct const operands for specialized opcodes, not signed RK encodings.
			// Rewriting them with the RK path silently mangles the operand bits and only shows up
			// later in release/libretro when the linked program executes the wrong instruction data.
			const bool relocOnB = indexed->kind == ProgramIndexedConstRelocKind::ConstB;
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

		const bool relocOnB = indexed->kind == ProgramIndexedConstRelocKind::RkB;
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

void rewriteNamedSlotRelocations(
	std::vector<uint8_t>& code,
	const std::vector<ProgramConstReloc>& relocs,
	const std::vector<int>& cartGlobalRemap,
	const std::vector<int>& cartSystemGlobalRemap
) {
	for (const ProgramConstReloc& reloc : relocs) {
		const auto* indexed = std::get_if<ProgramIndexedConstReloc>(&reloc.target);
		if (!indexed
			|| (indexed->kind != ProgramIndexedConstRelocKind::Gl
				&& indexed->kind != ProgramIndexedConstRelocKind::Sys)) {
			continue;
		}
		const uint32_t word = readInstructionWord(code, reloc.wordIndex);
		const OpCode op = static_cast<OpCode>((word >> 18) & 0x3f);
		const int mappedIndex = indexed->kind == ProgramIndexedConstRelocKind::Gl
			? cartGlobalRemap[static_cast<size_t>(indexed->constIndex)]
			: cartSystemGlobalRemap[static_cast<size_t>(indexed->constIndex)];
		writeResolvedABx(code, reloc.wordIndex, op, mappedIndex);
	}
}

void rewriteSymbolicConstRelocations(
	std::vector<uint8_t>& code,
	const std::vector<ProgramConstReloc>& relocs,
	const std::vector<std::string>& globalNames,
	const std::vector<std::string>& systemGlobalNames,
	const std::unordered_map<std::string, std::string>& exportProtoIdBySlot,
	const std::vector<std::string>& protoIds
) {
	for (const ProgramConstReloc& reloc : relocs) {
		const auto* symbolic = std::get_if<ProgramSymbolicConstReloc>(&reloc.target);
		if (!symbolic) {
			continue;
		}
		if (symbolic->kind == ProgramSymbolicConstRelocKind::Module) {
			const ResolvedExportSlot resolvedSlot = resolveLinkedExportSlot(symbolic->symbol, globalNames, systemGlobalNames);
			writeResolvedABx(code, reloc.wordIndex, resolvedSlot.op, resolvedSlot.slot);
			continue;
		}
		const ResolvedExportProtoTarget target = resolveExportProtoRelocTarget(
			symbolic->symbol,
			globalNames,
			systemGlobalNames,
			exportProtoIdBySlot,
			protoIds
		);
		writeResolvedABx(code, reloc.wordIndex, target.op, target.value);
	}
}

std::unique_ptr<ProgramMetadata> mergeMetadata(
	const ProgramMetadata* system,
	const ProgramMetadata* cart,
	const ProgramLayout& layout,
	int systemInstructionCount,
	int cartInstructionCount
) {
	if (!system && !cart) {
		return nullptr;
	}
	if (!system || !cart) {
		throw std::runtime_error("[ProgramLinker] Linking requires both system and cart symbols.");
	}
	if (static_cast<int>(system->debugRanges.size()) != systemInstructionCount) {
		throw std::runtime_error("[ProgramLinker] System debug range length mismatch.");
	}
	if (static_cast<int>(cart->debugRanges.size()) != cartInstructionCount) {
		throw std::runtime_error("[ProgramLinker] Cart debug range length mismatch.");
	}
	if (system->localSlotsByProto.size() != system->protoIds.size()) {
		throw std::runtime_error("[ProgramLinker] System local slot metadata length mismatch.");
	}
	if (cart->localSlotsByProto.size() != cart->protoIds.size()) {
		throw std::runtime_error("[ProgramLinker] Cart local slot metadata length mismatch.");
	}
	if (system->upvalueNamesByProto.size() != system->protoIds.size()) {
		throw std::runtime_error("[ProgramLinker] System upvalue name metadata length mismatch.");
	}
	if (cart->upvalueNamesByProto.size() != cart->protoIds.size()) {
		throw std::runtime_error("[ProgramLinker] Cart upvalue name metadata length mismatch.");
	}
	const int systemBaseWord = layout.systemBasePc / INSTRUCTION_BYTES;
	const int cartBaseWord = layout.cartBasePc / INSTRUCTION_BYTES;
	const int totalInstructionCount = std::max(systemBaseWord + systemInstructionCount, cartBaseWord + cartInstructionCount);
	auto merged = std::make_unique<ProgramMetadata>();
	merged->debugRanges.assign(static_cast<size_t>(totalInstructionCount), std::nullopt);
	for (int i = 0; i < systemInstructionCount; ++i) {
		merged->debugRanges[static_cast<size_t>(systemBaseWord + i)] = system->debugRanges[static_cast<size_t>(i)];
	}
	for (int i = 0; i < cartInstructionCount; ++i) {
		merged->debugRanges[static_cast<size_t>(cartBaseWord + i)] = cart->debugRanges[static_cast<size_t>(i)];
	}
	merged->protoIds = system->protoIds;
	merged->protoIds.insert(merged->protoIds.end(), cart->protoIds.begin(), cart->protoIds.end());
	merged->localSlotsByProto = system->localSlotsByProto;
	merged->localSlotsByProto.insert(
		merged->localSlotsByProto.end(),
		cart->localSlotsByProto.begin(),
		cart->localSlotsByProto.end()
	);
	merged->upvalueNamesByProto = system->upvalueNamesByProto;
	merged->upvalueNamesByProto.insert(
		merged->upvalueNamesByProto.end(),
		cart->upvalueNamesByProto.begin(),
		cart->upvalueNamesByProto.end()
	);
	const MergedNamedSlots systemGlobalNames = mergeNamedSlots(system->systemGlobalNames, cart->systemGlobalNames);
	const MergedNamedSlots globalNames = mergeNamedSlots(system->globalNames, cart->globalNames);
	merged->systemGlobalNames = systemGlobalNames.names;
	merged->globalNames = globalNames.names;
	merged->exportProtoIdBySlot = system->exportProtoIdBySlot;
	for (const auto& entry : cart->exportProtoIdBySlot) {
		merged->exportProtoIdBySlot[entry.first] = entry.second;
	}
	return merged;
}

} // namespace

void resolveRuntimeProgramRelocations(
	Program& program,
	const ProgramMetadata& metadata,
	const std::vector<ProgramConstReloc>& relocs
) {
	for (const ProgramConstReloc& reloc : relocs) {
		const auto* symbolic = std::get_if<ProgramSymbolicConstReloc>(&reloc.target);
		if (!symbolic) {
			continue;
		}
		if (symbolic->kind == ProgramSymbolicConstRelocKind::Module) {
			const ResolvedExportSlot resolvedSlot = resolveLinkedExportSlot(symbolic->symbol, metadata.globalNames, metadata.systemGlobalNames);
			writeResolvedABx(program.code, reloc.wordIndex, resolvedSlot.op, resolvedSlot.slot);
			continue;
		}
		const ResolvedExportProtoTarget target = resolveExportProtoRelocTarget(
			symbolic->symbol,
			metadata.globalNames,
			metadata.systemGlobalNames,
			metadata.exportProtoIdBySlot,
			metadata.protoIds
		);
		writeResolvedABx(program.code, reloc.wordIndex, target.op, target.value);
	}
}

std::unique_ptr<Program> inflateExecutableProgramImage(
	const ProgramImage& image,
	const ProgramMetadata* metadata,
	uint32_t dataBaseAddress,
	uint32_t bssBaseAddress
) {
	const size_t textByteCount = image.sections.text.code.size();
	const size_t rodataByteCount = image.sections.rodata.bytes.size();
	const size_t dataByteCount = image.sections.data.bytes.size();
	assertStaticRamFits(dataBaseAddress, dataByteCount + image.sections.bss.byteCount);
	assertProgramRomFits(textByteCount + rodataByteCount + dataByteCount);
	const uint32_t rodataBaseAddress = PROGRAM_ROM_BASE + static_cast<uint32_t>(textByteCount);
	const uint32_t dataLmaAddress = rodataBaseAddress + static_cast<uint32_t>(rodataByteCount);
	ProgramObjectSections executableSections = image.sections;
	executableSections.rodata.constPool = resolveConstValueRelocations(
		image.sections.rodata.constPool,
		image.link.constValueRelocs,
		image.sections.data.symbols,
		dataBaseAddress,
		dataLmaAddress,
		image.sections.bss.symbols,
		bssBaseAddress,
		image.sections.rodata.symbols,
		rodataBaseAddress
	);
	auto program = inflateProgram(executableSections);
	if (!image.link.constRelocs.empty()) {
		if (!metadata) {
			throw std::runtime_error("program image relocations require metadata.");
		}
		resolveRuntimeProgramRelocations(*program, *metadata, image.link.constRelocs);
	}
	return program;
}

/*
	Emulated-machine linking note

	- This codebase targets a emulated-machine ABI where some system ROM modules are compile-time
		descriptors (kept in the program image's static module path list) rather than live Lua
		runtime tables.
	- The compiler enforces that these compile-time modules are not treated as runtime values and
		validates/lowers their uses accordingly (for example rejecting `local m = require('bios')`).
		When the compiler cannot resolve an export it emits an explicit symbolic relocation on the
		instruction word.
	- The linker MUST resolve these records into the appropriate relocated operand, slot access,
		or machine-level instruction. It must not fabricate high-level Lua tables.
	- `rewriteClosureIndices`, `rewriteConstPoolRelocations`, and `rewriteNamedSlotRelocations`
		update indices and operand fields and must preserve encoding semantics when rewriting the
		linked buffer.

*/

LinkedProgramImage linkProgramImages(
	const ProgramImage& systemImage,
	const ProgramMetadata* systemSymbols,
	const ProgramImage& cartImage,
	const ProgramMetadata* cartSymbols,
	int systemBasePc,
	int cartBasePc
) {
	const ProgramTextSection& systemText = systemImage.sections.text;
	const ProgramTextSection& cartText = cartImage.sections.text;
	const ProgramRodataSection& systemRodata = systemImage.sections.rodata;
	const ProgramRodataSection& cartRodata = cartImage.sections.rodata;
	const int systemCodeBytes = static_cast<int>(systemText.code.size());
	const int cartCodeBytes = static_cast<int>(cartText.code.size());
	const size_t systemProtoSize = systemText.protos.size();
	const int systemProtoCount = static_cast<int>(systemProtoSize);
	ProgramLayout layout = resolveProgramLayout(systemCodeBytes, systemBasePc, cartBasePc);
	const size_t systemDataByteCount = systemImage.sections.data.bytes.size();
	const size_t cartDataByteCount = cartImage.sections.data.bytes.size();
	const size_t linkedDataByteCount = systemDataByteCount + cartDataByteCount;
	const size_t linkedBssByteCount = systemImage.sections.bss.byteCount + cartImage.sections.bss.byteCount;
	const uint32_t systemDataBase = PROGRAM_STATIC_RAM_BASE;
	const uint32_t cartDataBase = systemDataBase + static_cast<uint32_t>(systemDataByteCount);
	const uint32_t systemBssBase = PROGRAM_STATIC_RAM_BASE + static_cast<uint32_t>(linkedDataByteCount);
	const uint32_t cartBssBase = systemBssBase + static_cast<uint32_t>(systemImage.sections.bss.byteCount);
	assertStaticRamFits(PROGRAM_STATIC_RAM_BASE, linkedDataByteCount + linkedBssByteCount);

	const int totalBytes = std::max(layout.systemBasePc + systemCodeBytes, layout.cartBasePc + cartCodeBytes);
	const size_t linkedRodataByteCount = systemRodata.bytes.size() + cartRodata.bytes.size();
	assertProgramRomFits(static_cast<size_t>(totalBytes) + linkedRodataByteCount + linkedDataByteCount);
	const uint32_t systemRodataBase = PROGRAM_ROM_BASE + static_cast<uint32_t>(totalBytes);
	const uint32_t cartRodataBase = systemRodataBase + static_cast<uint32_t>(systemRodata.bytes.size());
	const uint32_t systemDataLma = cartRodataBase + static_cast<uint32_t>(cartRodata.bytes.size());
	const uint32_t cartDataLma = systemDataLma + static_cast<uint32_t>(systemDataByteCount);
	std::vector<uint8_t> systemCode = systemText.code;
	std::vector<uint8_t> cartCode = cartText.code;
	rewriteClosureIndices(cartCode, systemProtoCount);

	ProgramObjectSections linkedSections;
	MergedConstPool merged = mergeConstPools(
		resolveConstValueRelocations(
			systemRodata.constPool,
			systemImage.link.constValueRelocs,
			systemImage.sections.data.symbols,
			systemDataBase,
			systemDataLma,
			systemImage.sections.bss.symbols,
			systemBssBase,
			systemRodata.symbols,
			systemRodataBase
		),
		resolveConstValueRelocations(
			cartRodata.constPool,
			cartImage.link.constValueRelocs,
			cartImage.sections.data.symbols,
			cartDataBase,
			cartDataLma,
			cartImage.sections.bss.symbols,
			cartBssBase,
			cartRodata.symbols,
			cartRodataBase
		)
	);
	const bool systemNeedsSymbols = std::any_of(systemImage.link.constRelocs.begin(), systemImage.link.constRelocs.end(), relocRequiresSymbolMetadata);
	const bool cartNeedsSymbols = std::any_of(cartImage.link.constRelocs.begin(), cartImage.link.constRelocs.end(), relocRequiresSymbolMetadata);
	const bool cartNeedsMetadata = std::any_of(cartImage.link.constRelocs.begin(), cartImage.link.constRelocs.end(), cartRelocRequiresMetadata);
	if ((systemNeedsSymbols || cartNeedsMetadata) && !systemSymbols) {
		throw std::runtime_error("[ProgramLinker] Missing system symbols metadata required to resolve relocations.");
	}
	if (cartNeedsMetadata && !cartSymbols) {
		throw std::runtime_error("[ProgramLinker] Missing cart symbols metadata required to resolve cart relocations.");
	}
	if (systemNeedsSymbols) {
		rewriteSymbolicConstRelocations(
			systemCode,
			systemImage.link.constRelocs,
			systemSymbols->globalNames,
			systemSymbols->systemGlobalNames,
			systemSymbols->exportProtoIdBySlot,
			systemSymbols->protoIds
		);
	}
	rewriteConstPoolRelocations(
		cartCode,
		cartImage.link.constRelocs,
		merged.cartRemap
	);
	if (cartNeedsMetadata) {
		const MergedNamedSlots mergedSystemGlobals = mergeNamedSlots(systemSymbols->systemGlobalNames, cartSymbols->systemGlobalNames);
		const MergedNamedSlots mergedGlobals = mergeNamedSlots(systemSymbols->globalNames, cartSymbols->globalNames);
		rewriteNamedSlotRelocations(
			cartCode,
			cartImage.link.constRelocs,
			mergedGlobals.cartRemap,
			mergedSystemGlobals.cartRemap
		);
		if (cartNeedsSymbols) {
			std::vector<std::string> mergedProtoIds;
			mergedProtoIds.reserve(systemSymbols->protoIds.size() + cartSymbols->protoIds.size());
			mergedProtoIds.insert(mergedProtoIds.end(), systemSymbols->protoIds.begin(), systemSymbols->protoIds.end());
			mergedProtoIds.insert(mergedProtoIds.end(), cartSymbols->protoIds.begin(), cartSymbols->protoIds.end());
			std::unordered_map<std::string, std::string> mergedExportProtoIdBySlot = systemSymbols->exportProtoIdBySlot;
			for (const auto& entry : cartSymbols->exportProtoIdBySlot) {
				mergedExportProtoIdBySlot[entry.first] = entry.second;
			}
			rewriteSymbolicConstRelocations(
				cartCode,
				cartImage.link.constRelocs,
				mergedGlobals.names,
				mergedSystemGlobals.names,
				mergedExportProtoIdBySlot,
				mergedProtoIds
			);
		}
	}
	linkedSections.rodata.constPool = std::move(merged.values);

	linkedSections.text.protos.reserve(systemProtoSize + cartText.protos.size());
	for (const auto& proto : systemText.protos) {
		Proto& linkedProto = linkedSections.text.protos.emplace_back(proto);
		linkedProto.entryPC += layout.systemBasePc;
	}
	for (const auto& proto : cartText.protos) {
		Proto& linkedProto = linkedSections.text.protos.emplace_back(proto);
		linkedProto.entryPC += layout.cartBasePc;
	}

	linkedSections.text.code.assign(static_cast<size_t>(totalBytes), 0);
	std::copy(systemCode.begin(), systemCode.end(), linkedSections.text.code.begin() + layout.systemBasePc);
	std::copy(cartCode.begin(), cartCode.end(), linkedSections.text.code.begin() + layout.cartBasePc);
	writeInstructionWord(linkedSections.text.code, CART_PROGRAM_VECTOR_PC / INSTRUCTION_BYTES, CART_PROGRAM_VECTOR_VALUE);

	ProgramVectorTable cartVectors;
	cartVectors.resetProtoIndex = cartImage.vectors.resetProtoIndex + systemProtoCount;
	cartVectors.sectionInitProtoIndex = cartImage.vectors.sectionInitProtoIndex + systemProtoCount;
	cartVectors.irqProtoIndex = cartImage.vectors.irqProtoIndex + systemProtoCount;
	auto linkedImage = std::make_unique<ProgramImage>();
	linkedImage->vectors = cartVectors;
	linkedSections.rodata.moduleProtos.reserve(cartRodata.moduleProtos.size() + systemRodata.moduleProtos.size());
	for (const auto& entry : cartRodata.moduleProtos) {
		linkedSections.rodata.moduleProtos.emplace_back(entry.first, entry.second + systemProtoCount);
	}
	for (const auto& entry : systemRodata.moduleProtos) {
		linkedSections.rodata.moduleProtos.emplace_back(entry.first, entry.second);
	}
	linkedSections.rodata.staticModulePaths.reserve(systemRodata.staticModulePaths.size() + cartRodata.staticModulePaths.size());
	linkedSections.rodata.staticModulePaths.insert(linkedSections.rodata.staticModulePaths.end(), systemRodata.staticModulePaths.begin(), systemRodata.staticModulePaths.end());
	linkedSections.rodata.staticModulePaths.insert(linkedSections.rodata.staticModulePaths.end(), cartRodata.staticModulePaths.begin(), cartRodata.staticModulePaths.end());
	linkedSections.rodata.bytes.reserve(linkedRodataByteCount);
	linkedSections.rodata.bytes.insert(linkedSections.rodata.bytes.end(), systemRodata.bytes.begin(), systemRodata.bytes.end());
	linkedSections.rodata.bytes.insert(linkedSections.rodata.bytes.end(), cartRodata.bytes.begin(), cartRodata.bytes.end());
	linkedSections.rodata.symbols = systemRodata.symbols;
	linkedSections.rodata.symbols.reserve(systemRodata.symbols.size() + cartRodata.symbols.size());
	for (const auto& symbol : cartRodata.symbols) {
		ProgramRodataSection::Symbol linkedSymbol = symbol;
		linkedSymbol.offset += systemRodata.bytes.size();
		linkedSections.rodata.symbols.push_back(std::move(linkedSymbol));
	}
	linkedSections.data.bytes.reserve(linkedDataByteCount);
	linkedSections.data.bytes.insert(linkedSections.data.bytes.end(), systemImage.sections.data.bytes.begin(), systemImage.sections.data.bytes.end());
	linkedSections.data.bytes.insert(linkedSections.data.bytes.end(), cartImage.sections.data.bytes.begin(), cartImage.sections.data.bytes.end());
	linkedSections.data.symbols = systemImage.sections.data.symbols;
	linkedSections.data.symbols.reserve(systemImage.sections.data.symbols.size() + cartImage.sections.data.symbols.size());
	for (const auto& symbol : cartImage.sections.data.symbols) {
		ProgramDataSection::Symbol linkedSymbol = symbol;
		linkedSymbol.offset += systemDataByteCount;
		linkedSections.data.symbols.push_back(std::move(linkedSymbol));
	}
	linkedSections.bss.byteCount = linkedBssByteCount;
	linkedSections.bss.symbols = systemImage.sections.bss.symbols;
	linkedSections.bss.symbols.reserve(systemImage.sections.bss.symbols.size() + cartImage.sections.bss.symbols.size());
	for (const auto& symbol : cartImage.sections.bss.symbols) {
		ProgramBssSection::Symbol linkedSymbol = symbol;
		linkedSymbol.offset += systemImage.sections.bss.byteCount;
		linkedSections.bss.symbols.push_back(std::move(linkedSymbol));
	}
	linkedImage->sections = std::move(linkedSections);
	linkedImage->link.constRelocs.clear();
	linkedImage->link.constValueRelocs.clear();

	const int systemInstructionCount = systemCodeBytes / INSTRUCTION_BYTES;
	const int cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	std::unique_ptr<ProgramMetadata> mergedMetadata = mergeMetadata(systemSymbols, cartSymbols, layout, systemInstructionCount, cartInstructionCount);

	LinkedProgramImage output;
	output.programImage = std::move(linkedImage);
	output.metadata = std::move(mergedMetadata);
	output.systemVectors = systemImage.vectors;
	output.cartVectors = cartVectors;
	output.systemDataBaseAddress = systemDataBase;
	output.cartDataBaseAddress = cartDataBase;
	output.systemBssBaseAddress = systemBssBase;
	output.cartBssBaseAddress = cartBssBase;
	output.systemStaticModulePaths = systemRodata.staticModulePaths;
	output.cartStaticModulePaths = cartRodata.staticModulePaths;
	return output;
}

LinkedBootProgramImage linkBootProgramImages(
	const ProgramImage& systemImage,
	const ProgramMetadata* systemSymbols,
	const ProgramImage& cartImage,
	const ProgramMetadata* cartSymbols,
	ProgramBootTarget bootTarget,
	int systemBasePc,
	int cartBasePc
) {
	LinkedProgramImage linked = linkProgramImages(systemImage, systemSymbols, cartImage, cartSymbols, systemBasePc, cartBasePc);
	LinkedBootProgramImage output;
	output.cartVectors = linked.cartVectors;
	output.cartDataBaseAddress = linked.cartDataBaseAddress;
	output.cartBssBaseAddress = linked.cartBssBaseAddress;
	output.cartStaticModulePaths = std::move(linked.cartStaticModulePaths);
	switch (bootTarget) {
		case ProgramBootTarget::System:
			output.vectors = linked.systemVectors;
			output.dataBaseAddress = linked.systemDataBaseAddress;
			output.bssBaseAddress = linked.systemBssBaseAddress;
			output.staticModulePaths = std::move(linked.systemStaticModulePaths);
			break;
		case ProgramBootTarget::Cart:
			output.vectors = linked.cartVectors;
			output.dataBaseAddress = linked.cartDataBaseAddress;
			output.bssBaseAddress = linked.cartBssBaseAddress;
			output.staticModulePaths = linked.programImage->sections.rodata.staticModulePaths;
			break;
	}
	output.programImage = std::move(linked.programImage);
	output.metadata = std::move(linked.metadata);
	return output;
}

} // namespace bmsx
