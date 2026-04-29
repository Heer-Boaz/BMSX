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
	int systemBasePc;
	int cartBasePc;
};

struct MergedNamedSlots {
	std::vector<std::string> names;
	std::vector<int> cartRemap;
};

ProgramLayout resolveProgramLayout(int systemCodeBytes, int systemBasePc, int cartBasePc) {
	if (systemBasePc < 0) {
		throw std::runtime_error("[ProgramLinker] System base PC must be >= 0.");
	}
	if (cartBasePc < 0) {
		throw std::runtime_error("[ProgramLinker] Cart base PC must be >= 0.");
	}
	if (systemBasePc % INSTRUCTION_BYTES != 0) {
		throw std::runtime_error("[ProgramLinker] System base PC must align to instruction bytes.");
	}
	if (cartBasePc % INSTRUCTION_BYTES != 0) {
		throw std::runtime_error("[ProgramLinker] Cart base PC must align to instruction bytes.");
	}
	if (cartBasePc <= CART_PROGRAM_VECTOR_PC) {
		throw std::runtime_error("[ProgramLinker] Cart base PC must leave room for the cart program vector.");
	}
	if (systemBasePc + systemCodeBytes > cartBasePc) {
		throw std::runtime_error("[ProgramLinker] System program overlaps cart base PC.");
	}
	return {systemBasePc, cartBasePc};
}

uint32_t readInstructionWord(const std::vector<uint8_t>& code, int index) {
	size_t offset = static_cast<size_t>(index) * INSTRUCTION_BYTES;
	return (static_cast<uint32_t>(code[offset]) << 24)
		| (static_cast<uint32_t>(code[offset + 1]) << 16)
		| (static_cast<uint32_t>(code[offset + 2]) << 8)
		| static_cast<uint32_t>(code[offset + 3]);
}

void writeInstructionWord(std::vector<uint8_t>& code, int index, uint32_t word) {
	size_t offset = static_cast<size_t>(index) * INSTRUCTION_BYTES;
	code[offset] = static_cast<uint8_t>((word >> 24) & 0xff);
	code[offset + 1] = static_cast<uint8_t>((word >> 16) & 0xff);
	code[offset + 2] = static_cast<uint8_t>((word >> 8) & 0xff);
	code[offset + 3] = static_cast<uint8_t>(word & 0xff);
}

void writeInstruction(std::vector<uint8_t>& code, int index, uint8_t op, uint8_t a, uint8_t b, uint8_t c, uint8_t ext = 0) {
	uint32_t word = (static_cast<uint32_t>(ext) << 24)
		| (static_cast<uint32_t>(op & 0x3f) << 18)
		| (static_cast<uint32_t>(a & 0x3f) << 12)
		| (static_cast<uint32_t>(b & 0x3f) << 6)
		| static_cast<uint32_t>(c & 0x3f);
	writeInstructionWord(code, index, word);
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
	std::vector<Value> values;
	std::vector<int> cartRemap;
};

MergedConstPool mergeConstPools(
	const Program& systemProgram,
	const Program& cartProgram,
	StringPool& outPool
) {
	const StringPool& systemStrings = *systemProgram.constPoolStringPool;
	const StringPool& cartStrings = *cartProgram.constPoolStringPool;
	const size_t systemConstCount = systemProgram.constPool.size();
	const size_t cartConstCount = cartProgram.constPool.size();
	MergedConstPool merged;
	merged.values.reserve(systemConstCount + cartConstCount);
	merged.cartRemap.resize(cartConstCount, -1);

	std::unordered_map<std::string, int> keyToIndex;
	keyToIndex.reserve(systemConstCount + cartConstCount);

	for (size_t i = 0; i < systemConstCount; ++i) {
		const Value value = systemProgram.constPool[i];
		const Value copied = copyConstValue(systemStrings, value, outPool);
		merged.values.push_back(copied);
		const std::string key = makeConstKey(systemStrings, value);
		if (keyToIndex.find(key) == keyToIndex.end()) {
			keyToIndex.emplace(key, static_cast<int>(i));
		}
	}

	for (size_t i = 0; i < cartConstCount; ++i) {
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
	const std::vector<ProgramImage::ConstReloc>& relocs,
	const std::vector<int>& cartConstRemap,
	const std::vector<int>& cartGlobalRemap,
	const std::vector<int>& cartSystemGlobalRemap,
	const std::vector<Value>& mergedConstValues,
	const StringPool& mergedConstStrings,
	const std::vector<std::string>& mergedGlobalNames,
	const std::vector<std::string>& mergedSystemGlobalNames
) {
	for (size_t i = 0; i < relocs.size(); ++i) {
		const ProgramImage::ConstReloc& reloc = relocs[i];
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

		const int mappedIndex = reloc.kind == ProgramImage::ConstRelocKind::Gl
			? cartGlobalRemap[static_cast<size_t>(reloc.constIndex)]
			: reloc.kind == ProgramImage::ConstRelocKind::Sys
				? cartSystemGlobalRemap[static_cast<size_t>(reloc.constIndex)]
				: cartConstRemap[static_cast<size_t>(reloc.constIndex)];

		// Handle module-placeholder relocations emitted by the TS compiler.
		// These store a string sentinel in the merged const pool of the form
		// "modslot:<slotName>". Resolve that string to a merged global/system
		// global slot index and rewrite the instruction into GETSYS/GETGL.
		if (reloc.kind == ProgramImage::ConstRelocKind::Module) {
			if (mappedIndex < 0 || static_cast<size_t>(mappedIndex) >= mergedConstValues.size()) {
				throw std::runtime_error("[ProgramLinker] Module const index out of range.");
			}
			const Value cv = mergedConstValues[static_cast<size_t>(mappedIndex)];
			if (!valueIsString(cv)) {
				throw std::runtime_error("[ProgramLinker] Module reloc must refer to a string const.");
			}
			const std::string text = mergedConstStrings.toString(asStringId(cv));
			const std::string prefix = "modslot:";
			std::string slotName = text;
			if (text.rfind(prefix, 0) == 0) {
				slotName = text.substr(prefix.size());
			}
			int foundIndex = -1;
			bool system = false;
			for (size_t j = 0; j < mergedSystemGlobalNames.size(); ++j) {
				if (mergedSystemGlobalNames[j] == slotName) {
					foundIndex = static_cast<int>(j);
					system = true;
					break;
				}
			}
			if (foundIndex < 0) {
				for (size_t j = 0; j < mergedGlobalNames.size(); ++j) {
					if (mergedGlobalNames[j] == slotName) {
						foundIndex = static_cast<int>(j);
						break;
					}
				}
			}
			if (foundIndex < 0) {
				throw std::runtime_error("[ProgramLinker] Missing module export slot '" + slotName + "' in merged globals.");
			}
			const uint32_t nextWide = static_cast<uint32_t>(foundIndex) >> (MAX_BX_BITS + EXT_BX_BITS);
			if (!hasWide && nextWide != 0) {
				throw std::runtime_error("[ProgramLinker] Const reloc requires WIDE prefix.");
			}
			const uint8_t nextExt = static_cast<uint8_t>((static_cast<uint32_t>(foundIndex) >> MAX_BX_BITS) & 0xff);
			const uint16_t nextLow = static_cast<uint16_t>(static_cast<uint32_t>(foundIndex) & MAX_LOW_BX);
			bLow = static_cast<uint8_t>((nextLow >> 6) & 0x3f);
			cLow = static_cast<uint8_t>(nextLow & 0x3f);
			ext = nextExt;
			op = static_cast<uint8_t>(system ? OpCode::GETSYS : OpCode::GETGL);
			if (hasWide) {
				wideB = static_cast<uint8_t>(nextWide & 0x3f);
				writeWideInstruction(code, wordIndex - 1, wideA, wideB, wideC);
			}
			writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
			continue;
		}

		if (reloc.kind == ProgramImage::ConstRelocKind::Bx
			|| reloc.kind == ProgramImage::ConstRelocKind::Gl
			|| reloc.kind == ProgramImage::ConstRelocKind::Sys) {
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

		if (reloc.kind == ProgramImage::ConstRelocKind::ConstB
			|| reloc.kind == ProgramImage::ConstRelocKind::ConstC) {
			// These are direct const operands for specialized opcodes, not signed RK encodings.
			// Rewriting them with the RK path silently mangles the operand bits and only shows up
			// later in release/libretro when the linked program executes the wrong instruction data.
			const bool relocOnB = reloc.kind == ProgramImage::ConstRelocKind::ConstB;
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

		const bool relocOnB = reloc.kind == ProgramImage::ConstRelocKind::RkB;
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
	return merged;
}

} // namespace


/*
	Fantasy-console linking note

	- This codebase targets a fantasy-console ABI where some system ROM modules are compile-time
	  descriptors (kept in metadata like `staticModulePaths` / `staticExternalModulePaths`) rather
	  than live Lua runtime tables.
	- The compiler enforces that these compile-time modules are not treated as runtime values and
	  validates/lowers their uses accordingly (for example rejecting `local m = require('bios')`).
	  When the compiler cannot resolve an export it emits an explicit link-time placeholder into the
	  instruction stream (the current implementation uses a nil-load sentinel).
	- The linker MUST detect and resolve these placeholders: replace placeholder loads with the
	  appropriate relocated operand, slot access, or machine-level instruction. It must not leave
	  placeholders as runtime `nil` values or fabricate high-level Lua tables.
	- `rewriteClosureIndices` and `rewriteConstRelocations` update indices and operand fields and must
	  preserve encoding semantics when rewriting the linked buffer.

*/

LinkedProgramImage linkProgramImages(
	const ProgramImage& systemImage,
	const ProgramMetadata* systemSymbols,
	const ProgramImage& cartImage,
	const ProgramMetadata* cartSymbols,
	int systemBasePc,
	int cartBasePc
) {
	if (!systemImage.program || !cartImage.program) {
		throw std::runtime_error("[ProgramLinker] Missing program image.");
	}
	const Program& systemProgram = *systemImage.program;
	const Program& cartProgram = *cartImage.program;
	const int systemCodeBytes = static_cast<int>(systemProgram.code.size());
	const int cartCodeBytes = static_cast<int>(cartProgram.code.size());
	const size_t systemProtoSize = systemProgram.protos.size();
	const int systemProtoCount = static_cast<int>(systemProtoSize);
	ProgramLayout layout = resolveProgramLayout(systemCodeBytes, systemBasePc, cartBasePc);

	std::vector<uint8_t> cartCode = cartProgram.code;
	rewriteClosureIndices(cartCode, systemProtoCount);

	auto linkedProgram = std::make_unique<Program>();
	linkedProgram->constPoolStringPool = &linkedProgram->stringPool;
	MergedConstPool merged = mergeConstPools(systemProgram, cartProgram, linkedProgram->stringPool);
	const MergedNamedSlots mergedSystemGlobals = mergeNamedSlots(
		systemSymbols ? systemSymbols->systemGlobalNames : std::vector<std::string>{},
		cartSymbols ? cartSymbols->systemGlobalNames : std::vector<std::string>{}
	);
	const MergedNamedSlots mergedGlobals = mergeNamedSlots(
		systemSymbols ? systemSymbols->globalNames : std::vector<std::string>{},
		cartSymbols ? cartSymbols->globalNames : std::vector<std::string>{}
		);
	rewriteConstRelocations(
		cartCode,
		cartImage.link.constRelocs,
		merged.cartRemap,
		mergedGlobals.cartRemap,
		mergedSystemGlobals.cartRemap,
		merged.values,
		linkedProgram->stringPool,
		mergedGlobals.names,
		mergedSystemGlobals.names
	);
	linkedProgram->constPool = std::move(merged.values);

	linkedProgram->protos.reserve(systemProtoSize + cartProgram.protos.size());
	for (const auto& proto : systemProgram.protos) {
		Proto& linkedProto = linkedProgram->protos.emplace_back(proto);
		linkedProto.entryPC += layout.systemBasePc;
	}
	for (const auto& proto : cartProgram.protos) {
		Proto& linkedProto = linkedProgram->protos.emplace_back(proto);
		linkedProto.entryPC += layout.cartBasePc;
	}

	const int totalBytes = std::max(layout.systemBasePc + systemCodeBytes, layout.cartBasePc + cartCodeBytes);
	linkedProgram->code.assign(static_cast<size_t>(totalBytes), 0);
	std::copy(systemProgram.code.begin(), systemProgram.code.end(), linkedProgram->code.begin() + layout.systemBasePc);
	std::copy(cartCode.begin(), cartCode.end(), linkedProgram->code.begin() + layout.cartBasePc);
	writeInstructionWord(linkedProgram->code, CART_PROGRAM_VECTOR_PC / INSTRUCTION_BYTES, CART_PROGRAM_VECTOR_VALUE);
	linkedProgram->constPoolCanonicalized = false;

	const int systemEntryProtoIndex = systemImage.entryProtoIndex;
	const int cartEntryProtoIndex = cartImage.entryProtoIndex + systemProtoCount;
	auto linkedImage = std::make_unique<ProgramImage>();
	linkedImage->entryProtoIndex = cartEntryProtoIndex;
	linkedImage->program = std::move(linkedProgram);
	linkedImage->moduleProtos.reserve(cartImage.moduleProtos.size() + systemImage.moduleProtos.size());
	for (const auto& entry : cartImage.moduleProtos) {
		linkedImage->moduleProtos.emplace_back(entry.first, entry.second + systemProtoCount);
	}
	for (const auto& entry : systemImage.moduleProtos) {
		linkedImage->moduleProtos.emplace_back(entry.first, entry.second);
	}
	linkedImage->staticModulePaths.reserve(systemImage.staticModulePaths.size() + cartImage.staticModulePaths.size());
	linkedImage->staticModulePaths.insert(linkedImage->staticModulePaths.end(), systemImage.staticModulePaths.begin(), systemImage.staticModulePaths.end());
	linkedImage->staticModulePaths.insert(linkedImage->staticModulePaths.end(), cartImage.staticModulePaths.begin(), cartImage.staticModulePaths.end());
	linkedImage->link.constRelocs.clear();

	const int systemInstructionCount = systemCodeBytes / INSTRUCTION_BYTES;
	const int cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	std::unique_ptr<ProgramMetadata> mergedMetadata = mergeMetadata(systemSymbols, cartSymbols, layout, systemInstructionCount, cartInstructionCount);

	LinkedProgramImage output;
	output.program = std::move(linkedImage);
	output.metadata = std::move(mergedMetadata);
	output.systemEntryProtoIndex = systemEntryProtoIndex;
	output.cartEntryProtoIndex = cartEntryProtoIndex;
	output.systemStaticModulePaths = systemImage.staticModulePaths;
	output.cartStaticModulePaths = cartImage.staticModulePaths;
	return output;
}

} // namespace bmsx
