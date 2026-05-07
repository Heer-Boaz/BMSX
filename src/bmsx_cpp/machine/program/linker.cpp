#include "machine/program/linker.h"
#include "machine/cpu/instruction_format.h"
#include <algorithm>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

namespace bmsx {

namespace {

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

// disable-next-line single_line_method_pattern -- WIDE is the named prefix encoder used by relocation rewriting.
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
	const ProgramRodataSection& systemRodata,
	const ProgramRodataSection& cartRodata
) {
	const size_t systemConstCount = systemRodata.constPool.size();
	const size_t cartConstCount = cartRodata.constPool.size();
	MergedConstPool merged;
	merged.values.reserve(systemConstCount + cartConstCount);
	merged.cartRemap.resize(cartConstCount, -1);

	std::unordered_map<std::string, int> keyToIndex;
	keyToIndex.reserve(systemConstCount + cartConstCount);

	for (size_t i = 0; i < systemConstCount; ++i) {
		const EncodedValue& value = systemRodata.constPool[i];
		merged.values.push_back(value);
		const std::string key = makeConstKey(value);
		if (keyToIndex.find(key) == keyToIndex.end()) {
			keyToIndex.emplace(key, static_cast<int>(i));
		}
	}

	for (size_t i = 0; i < cartConstCount; ++i) {
		const EncodedValue& value = cartRodata.constPool[i];
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
	const std::vector<EncodedValue>& mergedConstValues,
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
			const EncodedValue& cv = mergedConstValues[static_cast<size_t>(mappedIndex)];
			const auto* moduleSlotValue = std::get_if<std::string>(&cv);
			if (!moduleSlotValue) {
				throw std::runtime_error("[ProgramLinker] Module reloc must refer to a string const.");
			}
			const std::string& text = *moduleSlotValue;
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
			// disable-next-line repeated_statement_sequence_pattern -- module and direct Bx relocations encode the same operand shape with different source indices.
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
				// disable-next-line repeated_statement_sequence_pattern -- WIDE-B rewrite mirrors direct Bx relocation encoding by instruction ABI.
				wideB = static_cast<uint8_t>(nextWide & 0x3f);
				writeWideInstruction(code, wordIndex - 1, wideA, wideB, wideC);
			}
			writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
			continue;
		}

		if (reloc.kind == ProgramImage::ConstRelocKind::Bx
			|| reloc.kind == ProgramImage::ConstRelocKind::Gl
			|| reloc.kind == ProgramImage::ConstRelocKind::Sys) {
			// disable-next-line repeated_statement_sequence_pattern -- direct Bx relocations share operand encoding with module slot rewrites by ABI contract.
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
				// disable-next-line repeated_statement_sequence_pattern -- WIDE-B rewrite mirrors module slot relocation encoding by instruction ABI.
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
	const ProgramTextSection& systemText = systemImage.sections.text;
	const ProgramTextSection& cartText = cartImage.sections.text;
	const ProgramRodataSection& systemRodata = systemImage.sections.rodata;
	const ProgramRodataSection& cartRodata = cartImage.sections.rodata;
	const int systemCodeBytes = static_cast<int>(systemText.code.size());
	const int cartCodeBytes = static_cast<int>(cartText.code.size());
	const size_t systemProtoSize = systemText.protos.size();
	const int systemProtoCount = static_cast<int>(systemProtoSize);
	ProgramLayout layout = resolveProgramLayout(systemCodeBytes, systemBasePc, cartBasePc);

	std::vector<uint8_t> cartCode = cartText.code;
	rewriteClosureIndices(cartCode, systemProtoCount);

	ProgramObjectSections linkedSections;
	MergedConstPool merged = mergeConstPools(systemRodata, cartRodata);
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
		mergedGlobals.names,
		mergedSystemGlobals.names
	);
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

	const int totalBytes = std::max(layout.systemBasePc + systemCodeBytes, layout.cartBasePc + cartCodeBytes);
	linkedSections.text.code.assign(static_cast<size_t>(totalBytes), 0);
	std::copy(systemText.code.begin(), systemText.code.end(), linkedSections.text.code.begin() + layout.systemBasePc);
	std::copy(cartCode.begin(), cartCode.end(), linkedSections.text.code.begin() + layout.cartBasePc);
	writeInstructionWord(linkedSections.text.code, CART_PROGRAM_VECTOR_PC / INSTRUCTION_BYTES, CART_PROGRAM_VECTOR_VALUE);

	// disable-next-line single_use_local_pattern -- linked output names both entry indices as the ABI result pair.
	const int systemEntryProtoIndex = systemImage.entryProtoIndex;
	const int cartEntryProtoIndex = cartImage.entryProtoIndex + systemProtoCount;
	auto linkedImage = std::make_unique<ProgramImage>();
	linkedImage->entryProtoIndex = cartEntryProtoIndex;
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
	linkedSections.data.bytes.reserve(systemImage.sections.data.bytes.size() + cartImage.sections.data.bytes.size());
	linkedSections.data.bytes.insert(linkedSections.data.bytes.end(), systemImage.sections.data.bytes.begin(), systemImage.sections.data.bytes.end());
	linkedSections.data.bytes.insert(linkedSections.data.bytes.end(), cartImage.sections.data.bytes.begin(), cartImage.sections.data.bytes.end());
	linkedSections.bss.byteCount = systemImage.sections.bss.byteCount + cartImage.sections.bss.byteCount;
	linkedImage->sections = std::move(linkedSections);
	linkedImage->link.constRelocs.clear();

	const int systemInstructionCount = systemCodeBytes / INSTRUCTION_BYTES;
	const int cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	std::unique_ptr<ProgramMetadata> mergedMetadata = mergeMetadata(systemSymbols, cartSymbols, layout, systemInstructionCount, cartInstructionCount);

	LinkedProgramImage output;
	output.programImage = std::move(linkedImage);
	output.metadata = std::move(mergedMetadata);
	output.systemEntryProtoIndex = systemEntryProtoIndex;
	output.cartEntryProtoIndex = cartEntryProtoIndex;
	output.systemStaticModulePaths = systemRodata.staticModulePaths;
	output.cartStaticModulePaths = cartRodata.staticModulePaths;
	return output;
}

} // namespace bmsx
