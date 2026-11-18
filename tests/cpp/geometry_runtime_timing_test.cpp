#include "common/float32.h"
#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/scheduler/frame.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <array>
#include <stdexcept>

using namespace bmsx;

namespace {
constexpr u32 instances = GEO_SCRATCH_BASE;
constexpr u32 shapes = GEO_SCRATCH_BASE + 0x100u;
constexpr u32 vertices = GEO_SCRATCH_BASE + 0x200u;
constexpr u32 result = GEO_SCRATCH_BASE + 0x400u;
constexpr u32 summary = GEO_SCRATCH_BASE + 0x500u;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

class IdleInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

void launchOverlap(Memory& memory) {
	const std::array<u32, 10> instanceWords = {shapes, 0u, 0u, 1u, 1u, shapes + 32u, 0u, 0u, 1u, 1u};
	for (u32 i = 0; i < instanceWords.size(); ++i) memory.writeU32(instances + i * IO_WORD_SIZE, instanceWords[i]);
	const std::array<u32, 16> shapeWords = {
		GEO_PRIMITIVE_CONVEX_POLY, 4u, vertices - shapes, 16u, 0u, 0u, 0u, 0u,
		GEO_PRIMITIVE_CONVEX_POLY, 4u, vertices - shapes, 16u, 0u, 0u, 0u, 0u,
	};
	for (u32 i = 0; i < shapeWords.size(); ++i) memory.writeU32(shapes + i * IO_WORD_SIZE, shapeWords[i]);
	const std::array<float, 16> coordinates = {0, 0, 4, 0, 4, 4, 0, 4, 1, 1, 5, 1, 5, 5, 1, 5};
	for (u32 i = 0; i < coordinates.size(); ++i) memory.writeU32(vertices + i * IO_WORD_SIZE, numberToF32Bits(coordinates[i]));
	memory.writeMappedWord(IO_GEO_SRC0, instances);
	memory.writeMappedWord(IO_GEO_DST0, result);
	memory.writeMappedWord(IO_GEO_DST1, summary);
	memory.writeMappedWord(IO_GEO_COUNT, 2u);
	memory.writeMappedWord(IO_GEO_PARAM0, GEO_OVERLAP2D_MODE_FULL_PASS);
	memory.writeMappedWord(IO_GEO_PARAM1, 1u);
	memory.writeMappedWord(IO_GEO_STRIDE0, GEO_OVERLAP2D_INSTANCE_BYTES);
	memory.writeMappedWord(IO_GEO_CMD, IO_CMD_GEO_OVERLAP2D_PASS);
}

void testOverrun(bool scalar, bool restore) {
	test::Blua32TestImage image;
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 0, 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions.push_back({.firstWord = 0, .wordCount = 2});
	for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, image);
	IdleInput input;
	Runtime runtime({system.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input);
	runtime.boot();
	if (scalar) runtime.machine.cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
	runtime.frameScheduler.runCyclesToNextLogicalTick(runtime, 512);
	auto& frame = *runtime.machine.cpu.activeThread()->frameAtDepth(0);
	require(frame.pc == system.textAddress, "the MOV/JMP warmup ends at the actual MOV");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (!scalar) {
		const auto& page = *frame.decodedPage;
		const u32 word = (system.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2u;
		test::waitForNativeEntry(runtime.machine.cpu, page, word);
		require(page.nativeBlocks && page.nativeBlocks->entries[word] && page.nativeCode[word], "native entry is installed before the short grant");
	}
#endif
	launchOverlap(runtime.machine.memory);
	runDueRuntimeTimers(runtime);
	auto& geo = runtime.machine.geometryController;
	require(geo.captureState().pendingCycles == 4, "initial summary has four cycles of debt");
	advanceRuntimeTime(runtime, 3);
	require(geo.captureState().pendingCycles == 1, "the GEO deadline is one cycle away");
	if (restore) {
		const auto saved = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
		const auto decoded = decodeRuntimeSaveState(saved, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		applyRuntimeSaveState(runtime, decoded);
		require(geo.captureState().pendingCycles == 1, "runtime restore preserves GEO debt");
	}
	const auto before = runtime.machine.scheduler.nowCycles();
	runtime.frameScheduler.runCyclesToNextLogicalTick(runtime, 1);
	require(runtime.machine.scheduler.nowCycles() - before == 2, "register-only MOV completes despite one-cycle grant");
	require(geo.captureState().pendingCycles == 25, "the subsequent 26-cycle header has already advanced one cycle");
}
} // namespace

int main() {
	for (const bool scalar : {true, false}) for (const bool restore : {false, true}) testOverrun(scalar, restore);
}
