#include "common/endian.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/execution_image.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <memory>
#include <utility>
#include <vector>
#include <iostream>
#include <stdexcept>
#include <string_view>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

class Input final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

struct Fixture {
	test::Blua32TestRom rom;
	Input input;
	Runtime runtime;
	int reads = 0;

	explicit Fixture(test::Blua32TestRom image)
		: rom(std::move(image)), runtime({rom.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input) {
		runtime.boot();
		runtime.machine.memory.mapIoRead(IO_IRQ_FLAGS, &reads,
			[](void* context, u32, MappedBusSignals) {
				++*static_cast<int*>(context);
				return 31u;
			});
	}

};

test::Blua32TestImage program() {
	test::Blua32TestImage image;
	for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	image.text.resize(3u * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::KSMI), 1, 0, 7);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::STORE_MEM), 1, 0, static_cast<u8>(MemoryAccessKind::U32LE));
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOADK), 2, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::LOAD_MEM), 3, 2, static_cast<u8>(MemoryAccessKind::U32LE));
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::ADD), 4, 3, 1);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::CLOSURE), 5, 0, 0);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::CALL), 5, 1, 2);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::ADD), 1, 1, 5);
	writeInstruction(image.text, 10, static_cast<u8>(OpCode::JMP), 0, 63, 55, 255);
	writeInstruction(image.text, 64, static_cast<u8>(OpCode::KSMI), 0, 0, 3);
	writeInstruction(image.text, 65, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, 128, static_cast<u8>(OpCode::RFE), 0, 0, 0);
	writeInstruction(image.text, 192, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 256, static_cast<u8>(OpCode::KSMI), 0, 0, 9);
	writeInstruction(image.text, 257, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.constants = {static_cast<i32>(DYNAMIC_RAM_BASE + 0x4000u), static_cast<i32>(IO_IRQ_FLAGS)};
	image.functions = {{.firstWord=0, .wordCount=11, .maxStack=8},
		{.firstWord=64, .wordCount=2, .maxStack=1}, {.firstWord=128, .wordCount=1},
		{.firstWord=192, .wordCount=1}, {.firstWord=256, .wordCount=2}};
	image.irqFunctionIndex = 2;
	image.exceptionFunctionIndex = 3;
	image.closureRelocations = {{7, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	return image;
}

const NativeBlock* entryAt(CPU& cpu, u32 pc) {
	const auto& pages = cpu.rootThread()->frameAtDepth(0)->executionImage->decodedPages;
	const auto page = pages.find(pc & ~MAPPED_PAGE_BYTE_MASK);
	if (page == pages.end() || !page->second.nativeBlocks) return nullptr;
	return page->second.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
}

void verifiedFunctionControlFlowIsAdmittedBeforeExecution() {
	test::Blua32TestImage image;
	image.mappedCode = false;
	for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
	image.functions = {{.firstWord = 0u, .wordCount = 4u}, {.firstWord = 4u, .wordCount = 1u}};
	const auto layout = test::encodeBlua32TestRom(RomImageDomain::System, image);
	const u32 boundary = (layout.textAddress + MAPPED_PAGE_BYTE_MASK) & ~MAPPED_PAGE_BYTE_MASK;
	const u32 word = (boundary - layout.textAddress) / INSTRUCTION_BYTES - 2u;
	image.functions[0].firstWord = word;
	image.functions[1].firstWord = word + 4u;
	image.exceptionFunctionIndex = image.irqFunctionIndex = 1u;
	writeInstruction(image.text, word, static_cast<u8>(OpCode::K0), 0, 0, 0);
	writeInstruction(image.text, word + 1u, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, word + 2u, static_cast<u8>(OpCode::KSMI), 0, 0, 7);
	writeInstruction(image.text, word + 3u, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, word + 4u, static_cast<u8>(OpCode::RFE), 0, 0, 0);
	auto valid = std::make_unique<Fixture>(test::encodeBlua32TestRom(RomImageDomain::System, image));
	auto& cpu = valid->runtime.machine.cpu;
	const auto& directory = cpu.rootThread()->currentFrame->executionImage->romFunctions;
	require(!directory.mappedCode && directory.instructionHead(boundary - INSTRUCTION_BYTES)
		&& !directory.instructionHead(boundary) && directory.instructionHead(boundary + INSTRUCTION_BYTES),
		"the verified image records the WIDE head across physical pages but not its body");
	require(directory.atPc(boundary) == directory.find(valid->rom.functionAddresses[0])
		&& directory.atPc(boundary + 2u * INSTRUCTION_BYTES) == directory.find(valid->rom.functionAddresses[1]),
		"the code ranges remain independent from the physical page index");
	require(cpu.runUntilDepth(0, 30) == RunResult::Halted && cpu.readCompletionValues().get(0) == valueInteger(7),
		"a verified cross-page WIDE program executes the expected body");

	const auto rejects = [](test::Blua32TestImage source, std::string_view message) {
		try {
			std::make_unique<Fixture>(test::encodeBlua32TestRom(RomImageDomain::System, source));
		} catch (const std::runtime_error& error) {
			require(std::string_view(error.what()) == message, "mount reports the rejected control-flow rule");
			return;
		}
		throw std::runtime_error("mount admitted invalid function control flow");
	};
	for (const u8 displacement : {1u, 3u}) {
		auto invalid = image;
		writeInstruction(invalid.text, word, static_cast<u8>(OpCode::JMP), 0, 0, displacement);
		rejects(std::move(invalid), "BLua32 branch target is not an instruction in its function.");
	}
	auto invalid = image;
	writeInstruction(invalid.text, word + 2u, static_cast<u8>(OpCode::EQ), 0, 0, 0);
	rejects(std::move(invalid), "BLua32 comparison skips past the end of its function.");
	invalid = image;
	writeInstruction(invalid.text, word + 3u, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	rejects(std::move(invalid), "BLua32 function has an incomplete WIDE instruction.");
	invalid = image;
	writeInstruction(invalid.text, word + 3u, static_cast<u8>(OpCode::K1), 0, 0, 0);
	rejects(std::move(invalid), "BLua32 function falls through the end of its TEXT extent.");
	invalid = image;
	invalid.functions[1].firstWord = word + 3u;
	rejects(std::move(invalid), "BLua32 function TEXT extents overlap.");
}

void preparationHasNoGuestEffects() {
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::System, program()));
	auto& cpu = machine.runtime.machine.cpu;
	cpu.setNativeCompilationProfiling(true);
	cpu.instructionBudgetRemaining = 17;
	const auto before = encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime));
	const auto pc = cpu.readCurrentInstructionPc();
	const auto fault = machine.runtime.machine.memory.readBusFaultSequence();
	cpu.prepareSystemNativeCode();
	require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == before && cpu.instructionBudgetRemaining == 17
		&& cpu.readCurrentInstructionPc() == pc && machine.reads == 0
		&& machine.runtime.machine.memory.readBusFaultSequence() == fault,
		"preparation cannot execute instructions, read MMIO, advance time, alter the grant or fault");
	for (const auto word : {0u, 2u, 9u, 64u, 128u, 192u, 256u}) {
		require(entryAt(cpu, machine.rom.textAddress + word * INSTRUCTION_BYTES),
			"preparation publishes BIOS function roots and their branch/helper continuations, not just reset");
	}
	const auto compiled = cpu.readNativeCompilationProfile();
	require(compiled.codeBytes > 0 && compiled.prepareRequests > 0, "preparation installs actual native code");
	cpu.prepareSystemNativeCode();
	const auto repeated = cpu.readNativeCompilationProfile();
	require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == before && repeated.codeBytes == compiled.codeBytes
		&& repeated.prepareRequests == compiled.prepareRequests,
		"repeating preparation does not recompile already installed sources or change guest state");

	const u32 observedPc = machine.rom.textAddress + 64u * INSTRUCTION_BYTES;
	InstructionObserverBinding observer;
	observer.points[0].insert(observedPc);
	observer.observe = [](void*, ExecutionDomainId, u32, ConstValueSpan) {};
	cpu.setInstructionObserver(std::move(observer));
	require(!entryAt(cpu, machine.rom.textAddress), "an observer change retires resident native sources");
	cpu.prepareSystemNativeCode();
	require(entryAt(cpu, machine.rom.textAddress) && !entryAt(cpu, observedPc)
		&& encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == before,
		"explicit system preparation can republish missing roots in the same image without compiling an observed PC");
}

void coldLazyWritesAndRestoreAgree() {
	const auto image = test::encodeBlua32TestRom(RomImageDomain::System, program());
	Fixture prepared(image), lazy(image);
	auto& fast = prepared.runtime.machine.cpu;
	auto& reference = lazy.runtime.machine.cpu;
	fast.prepareSystemNativeCode();
	for (const int grant : {0, 1, 2, 3, 5, 7, 17, 64, 257, 4096}) {
		test::runCpuParity(fast, reference, grant);
		require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime)) == encodeRuntimeSaveState(captureRuntimeSaveState(lazy.runtime)) && prepared.reads == lazy.reads,
			"cold native and ordinary lazy execution retain complete state, exact cycles and MMIO reads");
	}
	for (auto* machine : {&prepared, &lazy}) {
		machine->runtime.machine.memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 0x4000u, 1234u);
	}
	test::runCpuParity(fast, reference, 83);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime)) == encodeRuntimeSaveState(captureRuntimeSaveState(lazy.runtime)), "host RAM writes are consumed identically after preparation");
	const auto checkpoint = captureRuntimeSaveState(prepared.runtime);
	// Both passes begin at the normal restore boundary: restoring VRAM also
	// publishes a replacement for presentation, independently of CPU execution.
	applyRuntimeSaveState(prepared.runtime, checkpoint);
	applyRuntimeSaveState(lazy.runtime, checkpoint);
	for (const int grant : {1, 3, 19, 97}) test::runCpuParity(fast, reference, grant);
	const auto expected = encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime));
	applyRuntimeSaveState(prepared.runtime, checkpoint);
	applyRuntimeSaveState(lazy.runtime, checkpoint);
	fast.prepareSystemNativeCode();
	for (const int grant : {1, 3, 19, 97}) test::runCpuParity(fast, reference, grant);
	const auto replayPrepared = encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime));
	const auto replayLazy = encodeRuntimeSaveState(captureRuntimeSaveState(lazy.runtime));
	require(replayPrepared == expected && replayLazy == expected && prepared.reads == lazy.reads,
		"restore retires host metadata and replay remains identical with or without repreparation");
}

void unusedOperandsRemainUnobserved() {
	auto image = program();
	writeInstruction(image.text, 256, static_cast<u8>(OpCode::GETGL), 0, 63, 63, 255);
	writeInstruction(image.text, 300, static_cast<u8>(OpCode::LOADK), 0, 0, 2);
	writeInstruction(image.text, 304, static_cast<u8>(OpCode::ADD), 0, 61, 1, 56);
	writeInstruction(image.text, 308, static_cast<u8>(OpCode::GETFIELD), 0, 1, 2);
	for (const u32 word : {300u, 304u, 308u}) image.functions.push_back({.firstWord=word, .wordCount=1});
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::System, image));
	const auto before = encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime));
	const auto fault = machine.runtime.machine.memory.readBusFaultSequence();
	machine.runtime.machine.cpu.prepareSystemNativeCode();
	require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == before && machine.reads == 0
		&& machine.runtime.machine.memory.readBusFaultSequence() == fault,
		"unused invalid name/constant operands cannot manufacture early guest faults or reads");
	require(entryAt(machine.runtime.machine.cpu, machine.rom.textAddress),
		"ineligible unused instructions do not prevent supported BIOS roots from compiling");
}

void publishedDirectoryRequiresBackedRomExtents() {
	for (const bool corruptTable : {false, true}) {
		auto rom = test::encodeBlua32TestRom(RomImageDomain::System, program());
		if (corruptTable) {
			writeLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET,
				SYSTEM_ROM_BASE + static_cast<u32>(rom.bytes.size()) + MAPPED_PAGE_BYTE_SIZE);
		} else {
			writeLE32(rom.bytes.data() + rom.functionAddresses.back() - SYSTEM_ROM_BASE + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
				static_cast<u32>(rom.bytes.size()));
		}
		bool rejected = false;
		try {
			Fixture machine(std::move(rom));
		} catch (const std::runtime_error& e) {
			rejected = std::string_view(e.what()) == (corruptTable
				? "BLua32 function directory is not backed by the image's ROM."
				: "BLua32 published function has an invalid TEXT extent.");
		}
		require(rejected, "boot rejects a published directory or function that leaves its backed ROM section");
	}
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, program());
	writeLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET, 0u);
	writeLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET, IO_IRQ_FLAGS);
	Fixture machine(std::move(rom));
	auto& cpu = machine.runtime.machine.cpu;
	cpu.setNativeCompilationProfiling(true);
	const auto before = encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime));
	cpu.prepareSystemNativeCode();
	require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == before
		&& machine.reads == 0 && cpu.readNativeCompilationProfile().codeBytes == 0,
		"an image without a published directory leaves the address field unused");
}

void preparationPreservesConfiguredObservation() {
	for (const u32 word : {0u, 1u}) {
		Fixture machine(test::encodeBlua32TestRom(RomImageDomain::System, program()));
		auto& cpu = machine.runtime.machine.cpu;
		struct Observation { u32 pc; int count = 0; } observation{machine.rom.textAddress + word * INSTRUCTION_BYTES};
		InstructionObserverBinding binding;
		binding.context = &observation;
		binding.points[0].insert(observation.pc);
		binding.observe = [](void* context, ExecutionDomainId domain, u32 pc, ConstValueSpan) {
			auto& observation = *static_cast<Observation*>(context);
			require(domain == SYSTEM_EXECUTION_DOMAIN_ID && pc == observation.pc,
				"the configured observer retains its exact execution domain and physical PC");
			++observation.count;
		};
		cpu.setInstructionObserver(std::move(binding));
		const auto before = encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime));
		cpu.prepareSystemNativeCode();
		require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == before && observation.count == 0
			&& !entryAt(cpu, observation.pc), "cold preparation neither observes nor compiles through an observed instruction");
		const int grant = BASE_CYCLES[static_cast<u8>(OpCode::LOADK)]
			+ (word == 1u ? BASE_CYCLES[static_cast<u8>(OpCode::KSMI)] : 0);
		require(cpu.runUntilDepth(0, grant) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0 && observation.count == 1,
			"execution after preparation observes each configured root or interior instruction exactly once at its own grant");
	}
}

void preparationLeavesFetchFaultsAtExecution() {
	auto image = program();
	const auto initial = test::encodeBlua32TestRom(RomImageDomain::System, image);
	constexpr u32 target = IO_IRQ_FLAGS;
	const u32 displacement = (target - initial.textAddress - 2u * INSTRUCTION_BYTES) / INSTRUCTION_BYTES;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, displacement >> 20u, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0,
		(displacement >> 6u) & 63u, displacement & 63u, displacement >> 12u);
	image.functions[0].wordCount = 2;
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	Fixture prepared(rom), lazy(rom);
	auto& fast = prepared.runtime.machine.cpu;
	auto& reference = lazy.runtime.machine.cpu;
	const auto fault = prepared.runtime.machine.memory.readBusFaultSequence();
	fast.prepareSystemNativeCode();
	test::runCpuParity(fast, reference, BASE_CYCLES[static_cast<u8>(OpCode::JMP)]);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime)) == encodeRuntimeSaveState(captureRuntimeSaveState(lazy.runtime))
		&& fast.readFramePc(0) == target && fast.readCauseWord() == 0u
		&& prepared.runtime.machine.memory.readBusFaultSequence() == fault,
		"a compiled branch completes its own exact grant without fetching or faulting its MMIO successor");
	test::runCpuParity(fast, reference, 1);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime)) == encodeRuntimeSaveState(captureRuntimeSaveState(lazy.runtime))
		&& fast.readCauseWord() == CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR && fast.readEpcWord() == target
		&& prepared.runtime.machine.memory.readBusFaultSequence() == fault + 1u
		&& prepared.reads == 0 && lazy.reads == 0
		&& prepared.runtime.machine.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == target,
		"the following execution grant alone raises the original instruction-bus fault at its exact EPC");
	test::runCpuParity(fast, reference, BASE_CYCLES[static_cast<u8>(OpCode::HALT)]);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime)) == encodeRuntimeSaveState(captureRuntimeSaveState(lazy.runtime))
		&& fast.isHaltedUntilIrq(), "the prepared exception root retains its normal handler and HALT lifecycle");
}

void crossPageWideDependenciesRemainOwned() {
	auto image = program();
	const auto initial = test::encodeBlua32TestRom(RomImageDomain::System, image);
	const u32 word = ((initial.textAddress + MAPPED_PAGE_BYTE_SIZE - 1u) & ~MAPPED_PAGE_BYTE_MASK)
		/ INSTRUCTION_BYTES - initial.textAddress / INSTRUCTION_BYTES - 1u;
	image.functions[4] = {.firstWord=word, .wordCount=7};
	writeInstruction(image.text, word, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, word + 1u, static_cast<u8>(OpCode::KSMI), 0, 0, 11);
	for (u32 next = 2; next < 6; ++next)
		writeInstruction(image.text, word + next, static_cast<u8>(OpCode::MOV), 0, 0, 0);
	writeInstruction(image.text, word + 6u, static_cast<u8>(OpCode::RET), 0, 2, 0);
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::System, image));
	auto& cpu = machine.runtime.machine.cpu;
	const auto before = encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime));
	cpu.prepareSystemNativeCode();
	const u32 pc = machine.rom.textAddress + word * INSTRUCTION_BYTES;
	require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == before && entryAt(cpu, pc) && entryAt(cpu, pc)->sourceWords >= 2u,
		"a backed WIDE body across the physical ROM page remains a cold native source dependency");
	const auto* second = entryAt(cpu, pc + 2u * INSTRUCTION_BYTES);
	require(second && second->region == entryAt(cpu, pc)->region, "one native region contains both physical pages of the ROM function");
	cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[4]);
	require(cpu.runUntilDepth(1, 32) == RunResult::Halted && cpu.readCompletionValues().get(0) == valueInteger(11),
		"the prepared cross-page function executes its complete raw WIDE operand");
	const u32 nextPage = (pc + INSTRUCTION_BYTES) & ~MAPPED_PAGE_BYTE_MASK;
	cpu.invalidateMappedWords(nextPage, 5, 6);
	require(!entryAt(cpu, pc) && !entryAt(cpu, pc + 2u * INSTRUCTION_BYTES),
		"retiring a word deep in the second page withdraws every entry into the region");

	Fixture adaptive(test::encodeBlua32TestRom(RomImageDomain::System, image));
	auto& warmed = adaptive.runtime.machine.cpu;
	for (u32 visit = 0; visit <= NATIVE_BLOCK_COMPILATION_THRESHOLD; ++visit) {
		warmed.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, adaptive.rom.functionAddresses[4]);
		require(warmed.runUntilDepth(1, 32) == RunResult::Halted && warmed.readCompletionValues().get(0) == valueInteger(11),
			"adaptive executions keep the same WIDE and return result");
	}
	warmed.runUntilDepth(0, 0);
	const auto& page = warmed.rootThread()->frameAtDepth(0)->executionImage->decodedPages.at(pc & ~MAPPED_PAGE_BYTE_MASK);
	test::waitForNativeEntry(warmed, page, (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto* continuation = entryAt(warmed, pc + 2u * INSTRUCTION_BYTES);
	require(continuation && continuation->region == entryAt(warmed, pc)->region,
		"the adaptive compilation worker also publishes both pages in one region");
}

void descriptiveHintsAreBudgetedBeforeDiscovery() {
	test::Blua32TestImage image;
	for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 0, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions.resize(NATIVE_IMAGE_WARMUP_MAX_HINTS, {.firstWord = 0, .wordCount = 2, .maxStack = 2});
	image.functions.push_back({.firstWord = DECODED_PAGE_WORDS, .wordCount = 1});
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::System, image));
	auto& cpu = machine.runtime.machine.cpu;
	auto& registers = cpu.rootThread()->frameAtDepth(0)->registers;
	registers.set(0, valueInteger(0));
	registers.set(1, valueInteger(1));
	cpu.setNativeCompilationProfiling(true);
	const auto before = encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime));
	cpu.prepareSystemNativeCode();
	const auto profile = cpu.readNativeCompilationProfile();
	const u32 root = machine.rom.textAddress;
	require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == before && profile.codeBytes > 0 && profile.capacityEvictedRegions == 0
		&& entryAt(cpu, root) && !entryAt(cpu, root + MAPPED_PAGE_BYTE_SIZE),
		"descriptive records outside the startup budget do not become eager native roots");
	require(cpu.runUntilDepth(0, 1) == RunResult::Yielded && cpu.instructionBudgetRemaining == -1,
		"the bounded hint selection does not change first-instruction admission or charge");
}
} // namespace

int main() {
	try {
		verifiedFunctionControlFlowIsAdmittedBeforeExecution();
		preparationHasNoGuestEffects();
		coldLazyWritesAndRestoreAgree();
		unusedOperandsRemainUnobserved();
		publishedDirectoryRequiresBackedRomExtents();
		preparationPreservesConfiguredObservation();
		preparationLeavesFetchFaultsAtExecution();
		crossPageWideDependenciesRemainOwned();
		descriptiveHintsAreBudgetedBeforeDiscovery();
		std::cout << "NATIVE-PRECOMPILE:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
