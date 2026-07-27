#include "common/endian.h"
#include "spec/blua32/instruction_format.h"
#include "spec/bmsx/memory_map.h"
#include "rompack/loader.h"
#include "support/blua32_test_rom.h"

#include <algorithm>
#include <array>
#include <span>
#include <stdexcept>

int main() {
	const bmsx::u32 instructionWord = bmsx::packInstructionWord(0x3fu, 0x3fu, 0x3fu, 0x3fu, 0xffu);
	if (instructionWord != 0xffffffffu) {
		throw std::runtime_error("BLua32 instruction fields did not pack to one raw word");
	}
	std::array<bmsx::u8, bmsx::INSTRUCTION_BYTES> instructionBytes{};
	bmsx::writeInstructionWord(instructionBytes, 0, instructionWord);
	if (instructionBytes != std::array<bmsx::u8, bmsx::INSTRUCTION_BYTES>{0xffu, 0xffu, 0xffu, 0xffu}) {
		throw std::runtime_error("BLua32 instruction word was not written big-endian");
	}
	if (bmsx::readInstructionWord(instructionBytes, 0) != instructionWord) {
		throw std::runtime_error("BLua32 instruction word did not round-trip");
	}

	std::array<bmsx::u8, bmsx::CART_ROM_HEADER_SIZE - 1u> truncated{};
	for (const size_t size : {size_t{32}, size_t{76}, truncated.size()}) {
		bool rejected = false;
		try {
			bmsx::parseCartHeader(truncated.data(), size);
		} catch (const std::runtime_error&) {
			rejected = true;
		}
		if (!rejected) {
			throw std::runtime_error("Truncated ROM header was accepted");
		}
	}

	std::array<bmsx::u8, bmsx::BLUA32_IMAGE_HEADER_SIZE> unsupportedBlua32{};
	bmsx::writeLE32(unsupportedBlua32.data(), bmsx::BLUA32_IMAGE_MAGIC);
	bmsx::writeLE32(unsupportedBlua32.data() + 4u, bmsx::BLUA32_IMAGE_VERSION + 1u);
	bool unsupportedRejected = false;
	try {
		bmsx::decodeBlua32Image(unsupportedBlua32, bmsx::SYSTEM_ROM_BASE);
	} catch (const std::runtime_error&) {
		unsupportedRejected = true;
	}
	if (!unsupportedRejected) {
		throw std::runtime_error("Unsupported BLua32 image version was accepted");
	}

	bmsx::test::Blua32TestImage functionRangeSource;
	functionRangeSource.text.resize(bmsx::INSTRUCTION_BYTES);
	functionRangeSource.functions = {{.firstWord = 0u, .wordCount = 1u}};
	bmsx::test::Blua32TestRom functionRangeRom = bmsx::test::encodeBlua32TestRom(
		bmsx::RomImageDomain::System,
		functionRangeSource
	);
	std::span<bmsx::u8> functionRangeImage(
		functionRangeRom.bytes.data() + bmsx::test::BLUA32_TEST_IMAGE_OFFSET,
		functionRangeRom.boot.imageByteCount
	);
	const bmsx::u32 functionRecordOffset = functionRangeRom.functionAddresses[0]
		- (bmsx::SYSTEM_ROM_BASE + bmsx::test::BLUA32_TEST_IMAGE_OFFSET);
	bmsx::writeLE32(
		functionRangeImage.data() + functionRecordOffset,
		functionRangeRom.textAddress + 2u * bmsx::INSTRUCTION_BYTES
	);
	bool functionRangeRejected = false;
	try {
		bmsx::decodeBlua32Image(
			functionRangeImage,
			bmsx::SYSTEM_ROM_BASE + bmsx::test::BLUA32_TEST_IMAGE_OFFSET
		);
	} catch (const std::runtime_error&) {
		functionRangeRejected = true;
	}
	if (!functionRangeRejected) {
		throw std::runtime_error("BLua32 function text above the image text span was accepted");
	}

	const bmsx::u8 payload = 0u;
	try {
		bmsx::parseRomImage(
			&payload,
			static_cast<size_t>(bmsx::CART_ROM_SIZE) + 1u,
			bmsx::RomImageDomain::Cartridge);
	} catch (const std::runtime_error&) {
		return 0;
	}
	throw std::runtime_error("ROM payload beyond the cartridge aperture was accepted");
}
