#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/runtime/code_lookup.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"

#include <array>
#include <cstdio>
#include <stdexcept>

using namespace bmsx;
namespace {
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
class IdleInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};
struct Result {
	u32 sample, memory, pc, processed, phase;
	i64 now, used, remaining;
};
Result runCase(bool native, bool crossing, bool doorbell = false) {
	constexpr u32 record = (DYNAMIC_RAM_BASE + 0x10000u) + 0x1000u, vertex = (DYNAMIC_RAM_BASE + 0x10000u) + 0x2000u, matrix = (DYNAMIC_RAM_BASE + 0x10000u) + 0x3000u, output = (DYNAMIC_RAM_BASE + 0x10000u) + 0x4000u;
	test::Blua32TestImage image;
	image.text.resize(2u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::STORE_MEM_D), 1, 0, static_cast<u8>(MemoryAccessKind::U32LE), 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0u, .wordCount = 2u, .maxStack = 2u}};
	const u32 publicEnd = (output + GEO_OVERLAP2D_SUMMARY_BYTES + HEAP_PAGE_SIZE - 1u) & ~(HEAP_PAGE_SIZE - 1u);
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image, publicEnd - DYNAMIC_RAM_BASE);
	const u32 entryPc = DYNAMIC_RAM_BASE + 0x8000u + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES;
	IdleInput input;
	Runtime runtime({rom.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input);
	runtime.boot();
	auto& machine = runtime.machine;
	auto& cpu = machine.cpu;
	test::seedManagedFixture(cpu, machine.executionAddressSpace);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (native) cpu.setNativeCompilationProfiling(true);
#endif
	if (!native) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
	auto& frame = *cpu.activeThread()->frameAtDepth(0);
	auto& memory = machine.memory;
	memory.writeBytes(entryPc, image.text.data(), image.text.size());
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], entryPc);
	frame.registers.set(0, valueInteger(DYNAMIC_RAM_BASE + 0x4000u));
	frame.registers.set(1, valueInteger(0u));
	for (int i = 0; i < 30; ++i) cpu.runUntilDepth(0, 128);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (native) test::waitForFixtureWorkerRequests(cpu);
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (native) {
		const auto* sourcePage = frame.executionImage->nativeCodeLookup->find(entryPc, 0u);
		require(sourcePage != nullptr, "STORE page is decoded");
		const auto& page = *sourcePage;
		const u32 entry = (entryPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		test::waitForNativeEntry(cpu, page, entry);
		require(page.words[entry].dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeBlock)
			&& page.nativeBlocks && page.nativeBlocks->entries[entry]
			&& page.nativeBlocks->entries[entry]->admissionCycles == 0 && page.nativeBlocks->entries[entry]->sourceWords == 1,
			"one-instruction STORE entry really compiled and admits grant 1");
	}
#endif
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], entryPc);
	frame.registers.set(0, valueInteger(vertex)); frame.registers.set(1, valueInteger(0x10000u));
	memory.writeU32(vertex, 0u); memory.writeU32(vertex + 4u, 0u);
	for (u32 i = 0; i < 12u; ++i) memory.writeU32(record + i * 4u, 0u);
	memory.writeU32(record + GEO_XFORM2_RECORD_BYTES + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, 1u);
	memory.writeU32(record + GEO_XFORM2_RECORD_BYTES + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, GEO_INDEX_NONE);
	for (const auto [i, word] : std::array<std::pair<u32, u32>, 6>{{{0, 0x10000u}, {1, 0}, {2, 0}, {3, 0}, {4, 0x10000u}, {5, 0}}}) memory.writeU32(matrix + i * 4u, word);
	machine.scheduler.reset();
	machine.geometryController.setTiming(PSX_CPU_FREQ_HZ, PSX_GEO_WORK_UNITS_PER_SEC);
	for (const auto [addr, word] : std::array<std::pair<u32, u32>, 9>{{
		{IO_GEO_SRC0, record}, {IO_GEO_SRC1, vertex}, {IO_GEO_SRC2, matrix}, {IO_GEO_DST0, output}, {IO_GEO_DST1, 0},
		{IO_GEO_COUNT, 2}, {IO_GEO_STRIDE0, GEO_XFORM2_RECORD_BYTES}, {IO_GEO_STRIDE1, GEO_VERTEX2_BYTES}, {IO_GEO_STRIDE2, GEO_XFORM2_MATRIX_BYTES},
	}}) memory.writeMappedWord(addr, word);
	if (doorbell) {
		memory.writeU32(output, 0xdeadbeefu);
		memory.writeMappedWord(IO_GEO_DST1, output);
		memory.writeMappedWord(IO_GEO_COUNT, 0u);
		memory.writeMappedWord(IO_GEO_PARAM0, GEO_OVERLAP2D_MODE_FULL_PASS);
		frame.registers.set(0, valueInteger(IO_GEO_CMD));
		frame.registers.set(1, valueInteger(IO_CMD_GEO_OVERLAP2D_PASS));
		FrameState budget; budget.cycleBudgetRemaining = 100;
		require(runtime.cpuExecution.runInstruction(runtime, budget) == InstructionStepResult::Executed, "CPU actually rings GEO's doorbell");
		require(machine.scheduler.nowCycles() == 3, "STORE completes at its charged edge");
		require(machine.geometryController.captureState().pendingCycles == 4, "GEO charge begins at the doorbell, not the start of the CPU grant");
		advanceRuntimeTime(runtime, 3);
		require(memory.readU32(output) == 0xdeadbeefu && memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_BUSY,
			"the summary is not published one cycle before the full write charge");
		advanceRuntimeTime(runtime, 1);
		require(memory.readU32(output) == 0u && memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_DONE
			&& (memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GEO_DONE) != 0u, "the exact paid edge publishes the summary and IRQ");
		return {memory.readU32(output), memory.readIoU32(IO_GEO_STATUS), frame.readControl(FrameField::Pc),
			memory.readIoU32(IO_GEO_PROCESSED), machine.geometryController.captureState().overlap.phase,
			machine.scheduler.nowCycles(), budget.activeCpuUsedCycles, budget.cycleBudgetRemaining};
	}
	memory.writeMappedWord(IO_GEO_CMD, IO_CMD_GEO_XFORM2_BATCH);
	runDueRuntimeTimers(runtime);
	require(machine.geometryController.captureState().pendingCycles == 6, "first empty record pays six reads");
	advanceRuntimeTime(runtime, crossing ? 5 : 6);
	if (!crossing) require(machine.geometryController.captureState().xform.vertices[0] == 0u, "control samples old input before CPU store");
	FrameState budget; budget.cycleBudgetRemaining = 100;
	require(runtime.cpuExecution.runInstruction(runtime, budget) == InstructionStepResult::Executed, "runtime executes STORE");
	const auto state = machine.geometryController.captureState();
	require(state.pendingCycles == (crossing ? 17 : 16), "GEO second record started at its actual deadline");
	return {state.xform.vertices[0], memory.readU32(vertex), frame.readControl(bmsx::FrameField::Pc), memory.readIoU32(IO_GEO_PROCESSED), state.xform.phase,
		machine.scheduler.nowCycles(), budget.activeCpuUsedCycles, budget.cycleBudgetRemaining};
}
}
int main() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	std::puts("native-enabled=1");
#else
	std::puts("native-enabled=0 (both routes are scalar)");
#endif
	for (const bool native : {false, true}) require(runCase(native, false, true).now == 7, "MMIO launch ends after four paid cycles");
	for (const bool crossing : {false, true}) {
		const auto scalar = runCase(false, crossing), native = runCase(true, crossing);
		std::printf("case=%s scalar=%08x native=%08x memory=%08x cycles=%lld/%lld remaining=%lld/%lld geo_phase=%u/%u processed=%u/%u pc=%08x/%08x now=%lld/%lld\n",
			crossing ? "deadline-inside-store" : "sample-before-store", scalar.sample, native.sample, scalar.memory,
			static_cast<long long>(scalar.used), static_cast<long long>(native.used), static_cast<long long>(scalar.remaining), static_cast<long long>(native.remaining),
			scalar.phase, native.phase, scalar.processed, native.processed, scalar.pc, native.pc, static_cast<long long>(scalar.now), static_cast<long long>(native.now));
		require(scalar.sample == native.sample && scalar.memory == native.memory && scalar.pc == native.pc && scalar.processed == native.processed
			&& scalar.phase == native.phase && scalar.now == native.now && scalar.used == native.used && scalar.remaining == native.remaining,
			"scalar and native agree on the actual scheduler boundary and shared memory");
		require(scalar.memory == 0x10000u && scalar.used == 3 && scalar.remaining == 97, "internal one-cycle CPU grant admits the STORE and consumes three cycles");
		if (!crossing) require(scalar.sample == 0u, "GEO already sampled the old value");
	}
}
