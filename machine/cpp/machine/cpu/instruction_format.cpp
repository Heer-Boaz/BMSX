#include "machine/cpu/instruction_format.h"
#include <cstddef>

namespace bmsx {

int signExtend(uint32_t value, int bits) {
	const int shift = 32 - bits;
	return static_cast<int>(value << shift) >> shift;
}

uint32_t packInstructionWord(uint8_t op, uint8_t a, uint8_t b, uint8_t c, uint8_t ext) {
	return (static_cast<uint32_t>(ext) << 24)
		| (static_cast<uint32_t>(op & 0x3f) << 18)
		| (static_cast<uint32_t>(a & 0x3f) << 12)
		| (static_cast<uint32_t>(b & 0x3f) << 6)
		| static_cast<uint32_t>(c & 0x3f);
}

void writeInstruction(std::vector<uint8_t>& code, int index, uint8_t op, uint8_t a, uint8_t b, uint8_t c, uint8_t ext) {
	const uint32_t word = (static_cast<uint32_t>(ext) << 24)
		| (static_cast<uint32_t>(op & 0x3f) << 18)
		| (static_cast<uint32_t>(a & 0x3f) << 12)
		| (static_cast<uint32_t>(b & 0x3f) << 6)
		| static_cast<uint32_t>(c & 0x3f);
	writeInstructionWord(code, index, word);
}

void writeInstructionWord(std::vector<uint8_t>& code, int index, uint32_t word) {
	const size_t offset = static_cast<size_t>(index) * INSTRUCTION_BYTES;
	code[offset] = static_cast<uint8_t>((word >> 24) & 0xff);
	code[offset + 1] = static_cast<uint8_t>((word >> 16) & 0xff);
	code[offset + 2] = static_cast<uint8_t>((word >> 8) & 0xff);
	code[offset + 3] = static_cast<uint8_t>(word & 0xff);
}

uint32_t readInstructionWord(const std::vector<uint8_t>& code, int index) {
	const size_t offset = static_cast<size_t>(index) * INSTRUCTION_BYTES;
	return (static_cast<uint32_t>(code[offset]) << 24)
		| (static_cast<uint32_t>(code[offset + 1]) << 16)
		| (static_cast<uint32_t>(code[offset + 2]) << 8)
		| static_cast<uint32_t>(code[offset + 3]);
}

} // namespace bmsx
