#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/budget.h"
#include "render/texture_manager.h"

#include <array>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void testMemoryGolden() {
	const std::array<bmsx::u8, 4> systemRom{0x11u, 0x22u, 0x33u, 0x44u};
	bmsx::Memory memory(bmsx::MemoryInit{{systemRom.data(), systemRom.size()}, {}, {}});
	require(memory.readU8(bmsx::SYSTEM_ROM_BASE) == 0x11u, "system ROM byte should be readable");
	memory.writeU32(bmsx::RAM_BASE, 0x12345678u);
	require(memory.readU32(bmsx::RAM_BASE) == 0x12345678u, "RAM u32 should round-trip");
	memory.writeValue(bmsx::IO_DMA_STATUS, bmsx::valueNumber(static_cast<double>(0xfeedcafeu)));
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == 0xfeedcafeu, "numeric I/O word should round-trip");
}

void testBudgetAndFixed16Golden() {
	require(bmsx::cyclesUntilBudgetUnits(60, 7, 0, 1) == 9, "budget helper should round up to next unit");
	require(bmsx::cyclesUntilBudgetUnits(60, 7, 59, 1) == 1, "budget helper should honor carry");
	struct TransformCase {
		bmsx::i32 m0;
		bmsx::i32 m1;
		bmsx::i32 tx;
		bmsx::i32 x;
		bmsx::i32 y;
		bmsx::i32 expected;
	};
	const std::array<TransformCase, 7> cases{{
		{0, 0, 0, 0, 0, 0},
		{65536, 0, 0, 131072, 0, 131072},
		{0x7fffffff, 0, 0, 0x7fffffff, 0, 0x7fffffff},
		{static_cast<bmsx::i32>(0x80000000u), 0, 0, 0x7fffffff, 0, static_cast<bmsx::i32>(0x80000000u)},
		{0x7fffffff, -0x7fffffff, 0, 0x7fffffff, 0x7fffffff, 0},
		{0, 0, -65536, 0, 0, -65536},
		{0x40000000, 0x40000000, 0x7fffffff, 0x40000000, 0x40000000, 0x7fffffff},
	}};
	for (const auto& testCase : cases) {
		require(
			bmsx::transformFixed16(testCase.m0, testCase.m1, testCase.tx, testCase.x, testCase.y) == testCase.expected,
			"fixed16 transform should match golden integer output"
		);
	}
}

void testTextureKeyGolden() {
	bmsx::TextureManager manager(nullptr);
	bmsx::TextureParams params;
	params.size = {16.0f, 8.0f};
	params.srgb = false;
	params.wrapS = 1;
	params.wrapT = 2;
	params.minFilter = 3;
	params.magFilter = 4;
	require(
		manager.makeKey("atlas/main", params) == "atlas/main|size=16.000x8.000|srgb=0|wrapS=1|wrapT=2|minFilter=3|magFilter=4",
		"texture key should use canonical direct string format"
	);
}

} // namespace

int main() {
	const std::array<std::pair<const char*, void (*)()>, 3> tests{{
		{"memory", testMemoryGolden},
		{"budget and fixed16", testBudgetAndFixed16Golden},
		{"texture key", testTextureKeyGolden},
	}};
	for (const auto& test : tests) {
		test.second();
	}
	return 0;
}
