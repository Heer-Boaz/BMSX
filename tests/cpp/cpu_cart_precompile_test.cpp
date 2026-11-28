#include "common/endian.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/execution_image.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/rom_header.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
#include "support/table_allocation_reference.h"

#include <iostream>
#include <stdexcept>
#include <string_view>
#include <utility>

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

test::Blua32TestRom systemProgram(bool warmLoop = false) {
	test::Blua32TestImage image;
	image.constants = {static_cast<i32>(test::blua32TestFunctionAddress(RomImageDomain::Cartridge, 0))};
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
	image.functions = {{.firstWord=0, .wordCount=2, .maxStack=1}};
	if (warmLoop) {
		writeInstruction(image.text, 64, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		image.functions.push_back({.firstWord=64, .wordCount=1});
		image.startupFunctionIndex = 1;
	}
	return test::encodeBlua32TestRom(RomImageDomain::System, image);
}

test::Blua32TestImage cartridgeProgram(const std::string& text) {
	test::Blua32TestImage image;
	image.text.resize(3u * MAPPED_PAGE_BYTE_SIZE);
	image.constants = {text, static_cast<i32>(IO_IRQ_FLAGS)};
	image.globalNames = {"cartResult"};
	// The preparation grant executes one branch, not the load whose operand
	// the physical-slot cases deliberately observe after socket selection.
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMP), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOADK), 1, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::LOAD_MEM), 2, 1, static_cast<u8>(MemoryAccessKind::U32LE));
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 64, static_cast<u8>(OpCode::KSMI), 0, 0, 11);
	writeInstruction(image.text, 65, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::KSMI), 0, 0, 23);
	writeInstruction(image.text, DECODED_PAGE_WORDS + 1u, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord=0, .wordCount=6, .maxStack=3},
		{.firstWord=64, .wordCount=2}, {.firstWord=DECODED_PAGE_WORDS, .wordCount=2}};
	return image;
}

enum class OperandFixture { Prepared, Absent };

struct Fixture {
	test::Blua32TestRom system;
	test::Blua32TestRom cart;
	test::Blua32TestRom other;
	Input input;
	Runtime runtime;
	int reads = 0;

	explicit Fixture(test::Blua32TestRom cartridge, u32 slot = 0, bool warmSystem = false,
		OperandFixture operands = OperandFixture::Prepared)
		: system(systemProgram(warmSystem)), cart(std::move(cartridge)),
		other(test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("other-slot"))),
		runtime({system.bytes, slot == 0 ? test::cartridgeSlots(cart.bytes, other.bytes)
			: test::cartridgeSlots(other.bytes, cart.bytes), PSX_MACHINE_SPEC}, input) {
		runtime.boot();
		test::seedManagedFixture(runtime.machine.cpu, runtime.machine.executionAddressSpace);
		// Bind operands before measuring the exact EXEC grant; do not execute or decode the cart.
		if (operands == OperandFixture::Prepared)
			runtime.machine.cpu.replaceExecutionImage(*runtime.machine.executionAddressSpace.resolveDomain(slot));
		runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, slot);
		runtime.machine.memory.mapIoRead(IO_IRQ_FLAGS, &reads,
			[](void* context, u32, MappedBusSignals) {
				++*static_cast<int*>(context);
				return 31u;
			});
		runtime.machine.cpu.setNativeCompilationProfiling(true);
	}

	CPU& cpu() { return runtime.machine.cpu; }

	void execute() {
		const int grant = BASE_CYCLES[static_cast<u8>(OpCode::LOADK)]
			+ BASE_CYCLES[static_cast<u8>(OpCode::MTC0)];
		const auto requests = cpu().readNativeCompilationProfile().prepareRequests;
		require(cpu().runUntilDepth(0, grant) == RunResult::Yielded && cpu().instructionBudgetRemaining == 0
			&& cpu().isCartridgeExecutionActive() && cpu().readFramePc(0) == cart.textAddress,
			"EXEC completes its own exact grant before the first cartridge instruction");
		require(cpu().readNativeCompilationProfile().prepareRequests == requests,
			"EXEC commits without running native preparation inside the guest instruction");
	}

	void prepareAtGrantBoundary(OpCode step = OpCode::JMP) {
		const u32 successor = cpu().readFramePc(0) + INSTRUCTION_BYTES;
		require(cpu().runUntilDepth(0, BASE_CYCLES[static_cast<u8>(step)]) == RunResult::Yielded
			&& cpu().instructionBudgetRemaining == 0 && cpu().readFramePc(0) == successor,
			"the positive preparation grant executes exactly the fixture's one-word probe");
	}
};

const NativeBlock* entryAt(CPU& cpu, u32 pc, u32 slot) {
	const auto& image = *cpu.rootThread()->currentFrame->executionImage;
	if (!image.nativeCodeLookup) return nullptr;
	const auto* page = image.nativeCodeLookup->find(pc, slot);
	return page && page->nativeBlocks
		? page->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get() : nullptr;
}

void deferredWarmupRequiresAnAdmittedGrant() {
	auto image = cartridgeProgram("admitted");
	image.mappedCode = false;
	writeInstruction(image.text, image.functions.front().wordCount++, static_cast<u8>(OpCode::RET), 0, 1, 0);
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	Fixture machine(rom), scalar(rom);
	auto& cpu = machine.cpu();
	auto& reference = scalar.cpu();
	reference.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	machine.execute();
	scalar.execute();

	const auto& cart = *cpu.rootThread()->currentFrame->executionImage;
	const u32 entry = rom.textAddress, previousPc = cpu.readCurrentInstructionPc(), previousLastPc = cpu.lastPc;
	const auto before = cpu.readNativeCompilationProfile();
	const int jumpCycles = BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	const auto requireColdFrontier = [&] {
		const auto profile = cpu.readNativeCompilationProfile();
		require(profile.prepareRequests == before.prepareRequests && profile.regionsPublished == before.regionsPublished
			&& profile.codeBytes == before.codeBytes && cart.decodedPages.entries().empty() && !entryAt(cpu, entry, 0),
			"an unadmitted grant must not decode or prepare any of the pending cartridge");
		require(cpu.readFramePc(0) == entry && cpu.readCurrentInstructionPc() == previousPc
			&& cpu.lastPc == previousLastPc && machine.reads == 0,
			"an unadmitted grant leaves the cartridge at its exact EXEC frontier");
	};
	require(cpu.runUntilDepth(0, 0) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0,
		"a zero grant executes nothing");
	requireColdFrontier();
	require(cpu.runUntilDepth(1, jumpCycles) == RunResult::Halted && cpu.instructionBudgetRemaining == jumpCycles,
		"the already reached target depth leaves the positive grant untouched");
	requireColdFrontier();
	cpu.haltUntilIrq();
	require(cpu.runUntilDepth(0, jumpCycles) == RunResult::Halted && cpu.instructionBudgetRemaining == jumpCycles,
		"the HALT latch leaves the positive grant untouched");
	requireColdFrontier();
	cpu.clearHaltUntilIrq();
	cpu.requestYield();
	require(cpu.runUntilDepth(0, jumpCycles) == RunResult::Yielded && cpu.instructionBudgetRemaining == jumpCycles,
		"the requested yield executes nothing and is consumed once");
	requireColdFrontier();

	cpu.requestNonMaskableInterrupt();
	reference.requestNonMaskableInterrupt();
	machine.execute();
	scalar.execute();
	requireColdFrontier(); // The NMI handler used this grant, not the pending cartridge.

	require(test::runCpuParity(cpu, reference, jumpCycles) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0
		&& cpu.readFramePc(0) == entry + INSTRUCTION_BYTES && cpu.readCurrentInstructionPc() == entry && cpu.lastPc == entry,
		"the first admitted grant executes exactly the cartridge entry jump");
	const auto* installed = entryAt(cpu, entry, 0);
	const auto prepared = cpu.readNativeCompilationProfile();
	require(installed && prepared.prepareRequests > before.prepareRequests && prepared.regionsPublished > before.regionsPublished,
		"the first admitted grant publishes the retained cartridge warmup request");
	const int setupCycles = BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::SETGL)];
	require(test::runCpuParity(cpu, reference, setupCycles) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0
		&& entryAt(cpu, entry, 0) == installed && cpu.readNativeCompilationProfile().prepareRequests == prepared.prepareRequests
		&& cpu.readFrameRegister(0, 0) == cart.constPool.get(0)
		&& encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime))
			== encodeRuntimeSaveState(captureRuntimeSaveState(scalar.runtime))
		&& machine.reads == 0 && scalar.reads == 0,
		"the next grant uses the same publication with identical guest state and no MMIO");
}

#if defined(BMSX_NATIVE_COMPILER_WORKER)
void cartridgePreparationFollowsWorkerPublication() {
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("worker")), 0, true);
	require(machine.cpu().runUntilDepth(0, 2 * NATIVE_BLOCK_COMPILATION_THRESHOLD) == RunResult::Yielded
		&& machine.cpu().readNativeCompilationProfile().prepareRequests == 1,
		"the real BIOS warm loop submits one ordinary compiler-worker job");
	const auto* systemPage = machine.cpu().rootThread()->currentFrame->decodedPage;
	const auto systemWord = (machine.cpu().readFramePc(0) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	machine.cpu().beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, machine.system.functionAddresses[0]);
	machine.execute();
	require(!entryAt(machine.cpu(), machine.cart.textAddress, 0), "the exact EXEC grant does not install cartridge code");
	test::waitForNativeEntry(machine.cpu(), *systemPage, systemWord);
	require(!entryAt(machine.cpu(), machine.cart.textAddress, 0),
		"publishing an ordinary worker result on an exhausted grant does not prepare the cartridge");
	machine.prepareAtGrantBoundary();
	const auto profile = machine.cpu().readNativeCompilationProfile();
	require(profile.backgroundCompleted == 1 && profile.backgroundCancelled == 0
		&& entryAt(machine.cpu(), machine.cart.textAddress, 0),
		"cartridge preparation follows ordinary worker publication at the grant boundary");
}
#endif

test::Blua32TestRom withoutHints(test::Blua32TestRom rom) {
	// Only this descriptive header word differs. Executable instructions, records,
	// constants and names remain identical; neither program reads that header word.
	writeLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET, 0u);
	return rom;
}

void coldExecPreservesGuestStateAndBanks() {
	for (const u32 slot : {0u, 1u}) {
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("chosen-slot"));
		Fixture prepared(rom, slot), ordinary(withoutHints(rom), slot);
		prepared.cpu().prepareSystemNativeCode();
		ordinary.cpu().prepareSystemNativeCode();
		prepared.execute();
		ordinary.execute();
		require(!entryAt(prepared.cpu(), rom.textAddress, slot), "exact EXEC does not prepare its target");
		prepared.prepareAtGrantBoundary();
		ordinary.prepareAtGrantBoundary();
		require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
			== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime))
			&& prepared.reads == 0 && ordinary.reads == 0,
			"cold compilation adds no guest heap/names/registers, clock, MMIO, fault or scheduler changes to ordinary EXEC");
		for (const u32 word : {0u, 1u, 5u, 64u, static_cast<u32>(DECODED_PAGE_WORDS)}) {
			require(entryAt(prepared.cpu(), rom.textAddress + word * INSTRUCTION_BYTES, slot),
					"native preparation publishes cartridge roots and continuations in their physical slot");
		}
		require(!entryAt(ordinary.cpu(), rom.textAddress, slot), "the no-hint control remains ordinary cold execution");
		if (slot == 1u) {
			prepared.runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0u);
			ordinary.runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0u);
		}
		for (const int grant : {1, 2, 3, 7, 19}) {
			test::runCpuParity(prepared.cpu(), ordinary.cpu(), grant);
			require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
				== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime)) && prepared.reads == ordinary.reads,
				"prepared and ordinary cartridge execution retain exact state, cycles and device reads");
		}
		const auto key = prepared.cpu().stringPool().intern("cartResult");
		require(prepared.cpu().stringPool().toString(asStringId(prepared.cpu().getGlobalByKey(key))) == "chosen-slot",
			"slot-one code and constants cannot be borrowed from the other installed cartridge");
	}
}

void preparedCodeUsesItsImageConstants() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 4}};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMP), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LOADKR), 1, 2, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::SETI), 3, 1, 63, 7); // RK(C) = K[0].
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	int grant = 0;
	for (const auto op : {OpCode::LOADK, OpCode::LOADKR, OpCode::SETI, OpCode::JMP})
		grant += BASE_CYCLES[static_cast<u8>(op)];
	for (const auto& [literal, value] : {
		std::pair<Blua32EncodedConstant, Value>{i32{13}, valueInteger(13)},
		std::pair<Blua32EncodedConstant, Value>{Blua32FloatConstant{0xffa12345u}, valueFloatBits(0xffa12345u)},
		std::pair<Blua32EncodedConstant, Value>{false, valueBool(false)},
	}) {
		image.constants = {literal};
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
		Fixture prepared(rom), scalar(withoutHints(rom));
		prepared.execute();
		scalar.execute();
		prepared.prepareAtGrantBoundary();
		scalar.prepareAtGrantBoundary();
		const u32 body = rom.textAddress + INSTRUCTION_BYTES;
		require(entryAt(prepared.cpu(), body, 0) && !entryAt(scalar.cpu(), body, 0),
			"only the prepared CPU has installed this entry");
		for (auto* machine : {&prepared, &scalar}) {
			auto& frame = *machine->cpu().activeThread()->frameAtDepth(0);
			auto table = bmsx::test::allocateTableReference(machine->cpu(), 1);
			table.setInteger(1, valueInteger(0));
			frame.registers.set(2, valueInteger(0));
			frame.registers.set(3, valueTable(table.address()));
		}
		test::runCpuParity(prepared.cpu(), scalar.cpu(), grant);
		for (auto* machine : {&prepared, &scalar}) {
			const auto& frame = *machine->cpu().activeThread()->frameAtDepth(0);
			const auto table = TableRecord(machine->cpu().memory(), valuePayload(frame.registers.get(3)));
			require(frame.registers.get(0) == value && frame.registers.get(1) == value && table.getInteger(1) == value
					&& machine->cpu().readFramePc(0) == body && machine->cpu().instructionBudgetRemaining == 0,
				"LOADK, LOADKR and an RK store preserve the same image value and exact frontier");
		}
	}
}

void coldExecRecordsNumericFieldFeedback() {
	test::Blua32TestImage image;
	image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 5}, {.firstWord = 65, .wordCount = 1}};
	image.constants = {std::string("x"), Blua32FloatConstant{0u}};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMP), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 4, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETFIELD), 2, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::SUB), 3, 2, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::LT), 0, 3, 62, 7); // RK(C) = K[1].
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	writeInstruction(image.text, 65, static_cast<u8>(OpCode::HALT), 0, 0, 0);

	const int readCycles = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)];
	const int compareGrant = readCycles + BASE_CYCLES[static_cast<u8>(OpCode::SUB)] + BASE_CYCLES[static_cast<u8>(OpCode::LT)];
	const int loopCycles = compareGrant + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	for (const bool inherited : {false, true}) {
		Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, image));
		machine.execute();
		machine.prepareAtGrantBoundary();
		auto& cpu = machine.cpu();
		const u32 root = machine.cart.textAddress + INSTRUCTION_BYTES, pc = root + INSTRUCTION_BYTES;
		const auto* cold = entryAt(cpu, root, 0);
		require(cold && cold->terminal.currentPc == pc && entryAt(cpu, pc + INSTRUCTION_BYTES, 0)
			&& entryAt(cpu, root + 64u * INSTRUCTION_BYTES, 0),
			"cold code prepares the field read, its generic continuation and the other function");
		const auto coldRegion = cold->region;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		auto receiver = bmsx::test::allocateTableReference(cpu, 0, 1);
		auto holder = receiver;
		if (inherited) {
			holder = bmsx::test::allocateTableReference(cpu, 0, 1);
			auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
			meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(holder.address()));
			receiver.setMetatableAddress(meta.address());
		}
		const auto key = cpu.stringPool().intern("x");
		holder.setStringKey(key, valueFloat(4.0f));
		frame.registers.set(0, valueTable(receiver.address()));
		frame.registers.set(1, valueFloat(0.5f));
		frame.setTop(5);
		const int completeLoop = loopCycles + BASE_CYCLES[static_cast<u8>(OpCode::K1)]
			+ (inherited ? TABLE_INDEX_VISIT_CYCLES : 0);
		if (!inherited) {
			// The original ROM star positions first contain integers, then
			// ordinary movement settles on Float. Exercise the same startup
			// type change through real bytecode, not seeded compiler hints.
			holder.setStringKey(key, valueInteger(4));
			require(cpu.runUntilDepth(0, 2 * completeLoop) == RunResult::Yielded,
				"the cold Float step first consumes an Integer field");
			holder.setStringKey(key, valueFloat(4.0f));
		}
		const u32 word = (root & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		for (int sample = 0; sample < 16; ++sample) {
			require(cpu.runUntilDepth(0, completeLoop) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0,
				"each generic or specialized traversal consumes exactly one completed loop");
		}
		auto& page = *frame.decodedPage;
		require(entryAt(cpu, root, 0) == cold && cold->region == coldRegion
			&& page.words[word + 2u].nativeNumericTypes().stable(),
			"completed generic operations train both routes without replacing their published entries");
		if (inherited) continue;

		// An independent cache withdrawal, not learning a pair, permits a
		// later compilation to consume the field and arithmetic feedback.
		coldRegion->retire(NativeRetirement::Capacity);
		require(cpu.runUntilDepth(0, NATIVE_BLOCK_COMPILATION_THRESHOLD * completeLoop) == RunResult::Yielded,
			"the live loop reaches readmission after a cache withdrawal");
		test::waitForNativeEntry(cpu, page, word);
		const auto* entry = entryAt(cpu, root, 0);
		require(entry->hasFusedJump && entry->terminal.currentPc == pc + 3 * INSTRUCTION_BYTES,
			"readmission can use existing feedback to specialize the own read and its consumers");
		const auto prefixCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
		NativeBlockRunState grant{.constants = frame.executionImage->constPool, .memory = &cpu.memory(),
			.globalValues = {}, .systemGlobalValues = {}, .remainingCycles = prefixCycles + loopCycles};
		const auto* exit = entry->run(frame.registers, grant);
		require(exit->nextPc == root && grant.remainingCycles == 0 && frame.registers.get(3) == valueFloat(3.5f),
			"the warmed Float path executes through the comparison and fused jump at the exact guest cost");

		holder.setStringKey(key, valueFloat(0.25f));
		grant.remainingCycles = prefixCycles + compareGrant;
		exit = entry->run(frame.registers, grant);
		require(exit->nextPc == pc + 4 * INSTRUCTION_BYTES && grant.remainingCycles == 0
			&& frame.registers.get(3) == valueFloat(-0.25f),
			"negative motion branches to the wrap continuation even when no grant remains for a jump");

		frame.registers.set(1, valueInteger(1));
		frame.registers.set(3, valueInteger(99));
		grant.remainingCycles = prefixCycles + compareGrant;
		exit = entry->run(frame.registers, grant);
		require(exit->exit == NativeBlockExit::ScalarBoundary && exit->nextPc == pc + INSTRUCTION_BYTES
			&& grant.remainingCycles == compareGrant - readCycles && frame.registers.get(2) == valueFloat(0.25f)
			&& frame.registers.get(3) == valueInteger(99),
			"a change in the step's tag publishes the read but leaves the arithmetic at its original guest PC");
	}
}

void repeatExecAndRestoreHaveDistinctPolicies() {
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("repeat")));
	machine.cpu().prepareSystemNativeCode();
	machine.execute();
	machine.prepareAtGrantBoundary();
	const auto first = machine.cpu().readNativeCompilationProfile();
	machine.cpu().requestNonMaskableInterrupt();
	require(machine.cpu().enterPendingInterrupt(), "NMI enters the system EXEC handler");
	machine.execute();
	machine.prepareAtGrantBoundary();
	const auto repeated = machine.cpu().readNativeCompilationProfile();
	require(first.codeBytes == repeated.codeBytes && first.prepareRequests == repeated.prepareRequests,
		"repeated EXEC reuses installed cartridge entries without accumulating duplicate native code");
	const auto checkpoint = captureRuntimeSaveState(machine.runtime);
	applyRuntimeSaveState(machine.runtime, checkpoint);
	require(machine.cpu().readNativeCompilationProfile().prepareRequests == repeated.prepareRequests
		&& !entryAt(machine.cpu(), machine.cart.textAddress, 0),
		"restore reactivates resident images without triggering cartridge cold compilation");
	// Normal restore publishes replacement VRAM for presentation. Compare two
	// restores, rather than confusing that existing publication with JIT effects.
	const auto restored = encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime));
	applyRuntimeSaveState(machine.runtime, checkpoint);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime)) == restored
		&& machine.cpu().readNativeCompilationProfile().prepareRequests == repeated.prepareRequests,
		"repeated restore preserves the ordinary restored state without cold compilation");
}

void instrumentedGrantsDoNotPrepareNativeCode() {
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("instrumented")));
	auto& cpu = machine.cpu();
	cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	machine.execute();
	machine.prepareAtGrantBoundary();
	require(cpu.readNativeCompilationProfile().prepareRequests == 0 && !entryAt(cpu, machine.cart.textAddress, 0),
		"the instrumented interpreter does not service native startup work");
	cpu.setExecutionHook({});
	machine.prepareAtGrantBoundary(OpCode::LOADK);
	require(entryAt(cpu, machine.cart.textAddress, 0), "the normal grant boundary owns queued native startup work");
}

void residentExecDoesNotReopenTheBootHeader() {
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("resident")));
	machine.execute();
	const auto* image = machine.cpu().rootThread()->currentFrame->executionImage;
	auto replacement = machine.cart.bytes;
	// Replace the physical ROM without activating another execution image.
	// EXEC still has a backed static target; only the absent boot image differs.
	writeLE32(replacement.data() + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, CART_ROM_SIZE - INSTRUCTION_BYTES);
	writeInstruction(replacement, (machine.cart.textAddress - CART_ROM_BASE) / INSTRUCTION_BYTES,
		static_cast<u8>(OpCode::K1), 0, 0, 0);
	machine.runtime.machine.memory.cartridgeController().installRom(0, replacement);
	machine.cpu().requestNonMaskableInterrupt();
	require(machine.cpu().enterPendingInterrupt(), "NMI enters the system EXEC handler after replacement");
	machine.execute();
	require(machine.cpu().rootThread()->currentFrame->executionImage == image,
		"EXEC uses the resident image rather than requiring another boot header");
	machine.prepareAtGrantBoundary(OpCode::K1);
	require(entryAt(machine.cpu(), machine.cart.textAddress, 0),
		"resident hints select native source from the newly installed physical ROM");
	require(machine.cpu().readFrameRegister(0, 0) == valueInteger(1),
		"the resident image fetches the installed replacement instruction");
}

void invalidDirectoryAndNonStaticEntryPreventCompilation() {
	for (const u32 table : {IO_IRQ_FLAGS, CART_ROM_BASE + CART_ROM_SIZE - 32u}) {
		auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("no-backed-hints"));
		writeLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET, table);
		Fixture machine(std::move(rom), 0, false, OperandFixture::Absent);
		const auto fault = machine.runtime.machine.memory.readBusFaultSequence();
		bool rejected = false;
		try {
			machine.cpu().runUntilDepth(0, 32);
		} catch (const std::runtime_error& e) {
			rejected = std::string_view(e.what()) == "BLua32 function directory is not backed by the image's ROM.";
		}
		require(rejected && machine.cpu().readNativeCompilationProfile().prepareRequests == 0 && machine.reads == 0
			&& machine.runtime.machine.memory.readBusFaultSequence() == fault,
			"EXEC rejects a directory outside backed cartridge ROM without reading through the bus");
	}
	auto image = cartridgeProgram("non-static");
	image.functions[0].staticClosure = false;
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, image));
	require(machine.cpu().runUntilDepth(0, 32) == RunResult::Halted
		&& machine.cpu().readNativeCompilationProfile().prepareRequests == 0,
		"a rejected non-STATIC EXEC never starts cartridge cold compilation");
}

void hintsDoNotBoundReachableCode() {
	auto image = cartridgeProgram("branch");
	const u32 displacement = DECODED_PAGE_WORDS - 1u;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMP), 0, displacement >> 6u, displacement & 63u);
	image.functions.resize(1);
	image.functions[0].wordCount = 1;
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, image));
	machine.execute();
	require(machine.cpu().runUntilDepth(0, 1) == RunResult::Yielded
		&& machine.cpu().readFramePc(0) == machine.cart.textAddress + MAPPED_PAGE_BYTE_SIZE,
		"the cross-page branch consumes its own grant without fetching its successor");
	require(entryAt(machine.cpu(), machine.cart.textAddress + MAPPED_PAGE_BYTE_SIZE, 0),
		"cold discovery follows backed cross-page branches beyond descriptive function extents");
}

void crossPageWideSourceUsesItsPhysicalSlot() {
	auto image = cartridgeProgram("wide-chosen");
	const auto initial = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	const u32 word = ((initial.textAddress + MAPPED_PAGE_BYTE_SIZE - 1u) & ~MAPPED_PAGE_BYTE_MASK)
		/ INSTRUCTION_BYTES - initial.textAddress / INSTRUCTION_BYTES - 1u;
	image.functions[1] = {.firstWord=word, .wordCount=3};
	writeInstruction(image.text, word, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, word + 1u, static_cast<u8>(OpCode::KSMI), 0, 0, 37);
	writeInstruction(image.text, word + 2u, static_cast<u8>(OpCode::RET), 0, 2, 0);
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, image), 1u);
	machine.execute();
	machine.prepareAtGrantBoundary();
	const auto* block = entryAt(machine.cpu(), machine.cart.textAddress + word * INSTRUCTION_BYTES, 1u);
	require(block && block->sourceWords >= 2u,
		"cold cartridge discovery owns a WIDE body's dependency across its physical ROM page");
	machine.runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0u);
	machine.cpu().beginCompletionCallInExecutionDomain(1, machine.cart.functionAddresses[1]);
	require(machine.cpu().runUntilDepth(1, 32) == RunResult::Halted
		&& machine.cpu().readCompletionValues().get(0) == valueInteger(37),
		"the prepared cross-page function and operands stay pinned to slot one after socket selection changes");
}

void boundedWarmupLeavesDistantBranchesToHotCompilation() {
	test::Blua32TestImage image;
	constexpr u32 pages = NATIVE_IMAGE_WARMUP_MAX_PAGES + 7u;
	image.text.resize(pages * MAPPED_PAGE_BYTE_SIZE);
	image.functions = {{.firstWord = 0, .wordCount = 1}};
	for (u32 page = 0; page < pages; ++page) {
		const u32 displacement = page + 1u == pages ? 0x000fffffu : DECODED_PAGE_WORDS - 1u;
		writeInstruction(image.text, page * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::JMP), 0,
			(displacement >> 6u) & 63u, displacement & 63u, displacement >> 12u);
	}
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	Fixture prepared(rom), ordinary(withoutHints(rom));
	prepared.cpu().prepareSystemNativeCode();
	ordinary.cpu().prepareSystemNativeCode();
	const auto* biosEntry = entryAt(prepared.cpu(), prepared.system.textAddress, 0);
	require(biosEntry, "EXEC is entered through actual prepared system code");
	prepared.execute();
	ordinary.execute();
	require(prepared.cpu().rootThread()->currentFrame->executionImage->decodedPages.entries().empty(),
		"EXEC does not decode the target graph");
	const int jumpCycles = BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	require(test::runCpuParity(prepared.cpu(), ordinary.cpu(), jumpCycles) == RunResult::Yielded
		&& prepared.cpu().instructionBudgetRemaining == 0
		&& prepared.cpu().readFramePc(0) == rom.textAddress + MAPPED_PAGE_BYTE_SIZE,
		"the positive warmup grant executes just the first real cross-page branch");
	const auto profile = prepared.cpu().readNativeCompilationProfile();
	const u32 distant = rom.textAddress + (pages - 1u) * MAPPED_PAGE_BYTE_SIZE;
	require(prepared.cpu().rootThread()->currentFrame->executionImage->decodedPages.entries().size() == NATIVE_IMAGE_WARMUP_MAX_PAGES
		&& entryAt(prepared.cpu(), rom.textAddress, 0) && !entryAt(prepared.cpu(), distant, 0)
		&& profile.capacityEvictedRegions == 0u,
		"startup work is bounded in decoded pages as well as emitted code");
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
		== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime)) && prepared.reads == 0,
		"bounded warmup adds no architectural effects to the admitted first branch");
	test::runCpuParity(prepared.cpu(), ordinary.cpu(), (pages - 2u) * jumpCycles);
	require(prepared.cpu().readFramePc(0) == distant && !entryAt(prepared.cpu(), distant, 0),
		"native and ordinary execution reach a target outside the startup batch at the same frontier");
	test::runCpuParity(prepared.cpu(), ordinary.cpu(), NATIVE_BLOCK_COMPILATION_THRESHOLD * jumpCycles);
	const auto& frame = *prepared.cpu().rootThread()->currentFrame;
	test::waitForNativeEntry(prepared.cpu(), *frame.decodedPage, (distant & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
		== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime)) && entryAt(prepared.cpu(), distant, 0),
		"ordinary hot compilation installs the later entry without changing guest state");
}

void observationsAndUnusedOperandsStayAtExecution() {
	auto image = cartridgeProgram("observed");
	writeInstruction(image.text, 128, static_cast<u8>(OpCode::GETGL), 0, 63, 63, 255);
	writeInstruction(image.text, 132, static_cast<u8>(OpCode::LOADK), 0, 0, 63);
	for (const u32 word : {128u, 132u}) image.functions.push_back({.firstWord=word, .wordCount=1});
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, image));
	int observations = 0;
	InstructionObserverBinding observer;
	const u32 observedPc = machine.cart.textAddress + INSTRUCTION_BYTES;
	observer.points[1].insert(observedPc);
	observer.context = &observations;
	observer.observe = [](void* context, ExecutionDomainId domain, u32, ConstValueSpan) {
		require(domain == 0, "cartridge observation keeps its execution domain");
		++*static_cast<int*>(context);
	};
	machine.cpu().setInstructionObserver(std::move(observer));
	const auto fault = machine.runtime.machine.memory.readBusFaultSequence();
	machine.execute();
	machine.prepareAtGrantBoundary();
	require(observations == 0 && machine.reads == 0 && machine.runtime.machine.memory.readBusFaultSequence() == fault
		&& !entryAt(machine.cpu(), observedPc, 0)
		&& entryAt(machine.cpu(), machine.cart.textAddress + 64u * INSTRUCTION_BYTES, 0),
		"cold preparation cannot observe guest code, raise unused constant/name faults or read MMIO/RAM");
	require(machine.cpu().runUntilDepth(0, 1) == RunResult::Yielded && observations == 1,
		"the observed cartridge instruction runs exactly once on its own grant");
}

void warmupAdmitsTheEntryBeforeCompetingFunctionSpans() {
	constexpr u32 twoPageFunctions = NATIVE_IMAGE_WARMUP_MAX_PAGES / 2u + 2u;
	constexpr u32 admittedSparse = NATIVE_IMAGE_WARMUP_MAX_PAGES - twoPageFunctions - 2u;
	constexpr u32 sparseFunctions = admittedSparse + 2u;
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.functions.resize(2u + twoPageFunctions + sparseFunctions);
	image.text.resize((twoPageFunctions + sparseFunctions * NATIVE_VERSION_REGION_MAX_PAGES + 4u) * MAPPED_PAGE_BYTE_SIZE);
	const auto layout = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	const u32 firstBoundary = (layout.textAddress + MAPPED_PAGE_BYTE_MASK) & ~MAPPED_PAGE_BYTE_MASK;
	const u32 firstPage = (firstBoundary - layout.textAddress) / INSTRUCTION_BYTES;
	const auto put = [&](u32 word, OpCode op) {
		writeInstruction(image.text, word, static_cast<u8>(op), 0, 1, 0);
	};
	for (u32 index = 0; index < twoPageFunctions; ++index) {
		const u32 word = firstPage + index * DECODED_PAGE_WORDS - 2u;
		if (index + 1u == twoPageFunctions) {
			image.functions[2u + index] = {.firstWord = word, .wordCount = 3};
			put(word, OpCode::K0);
			writeInstruction(image.text, word + 1u, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
			put(word + 2u, OpCode::RET);
			continue;
		}
		image.functions[2u + index] = {.firstWord = word, .wordCount = 4};
		for (u32 local = 0; local < 3u; ++local) put(word + local, OpCode::K0);
		put(word + 3u, OpCode::RET);
	}
	for (u32 index = 0; index < sparseFunctions; ++index) {
		const u32 word = firstPage + (twoPageFunctions + index * NATIVE_VERSION_REGION_MAX_PAGES) * DECODED_PAGE_WORDS;
		const u32 words = NATIVE_VERSION_REGION_MAX_PAGES * DECODED_PAGE_WORDS;
		image.functions[2u + twoPageFunctions + index] = {.firstWord = word, .wordCount = words};
		put(word, OpCode::RET);
		for (u32 local = 1; local + 1u < words; ++local) put(word + local, OpCode::K0);
		put(word + words - 1u, OpCode::RET);
	}
	const u32 bootWord = firstPage + (twoPageFunctions + sparseFunctions * NATIVE_VERSION_REGION_MAX_PAGES) * DECODED_PAGE_WORDS;
	image.functions[0] = {.firstWord = bootWord, .wordCount = 2};
	image.functions[1] = {.firstWord = bootWord + 2u, .wordCount = 1};
	put(bootWord, OpCode::K0);
	put(bootWord + 1u, OpCode::RET);
	put(bootWord + 2u, OpCode::RET);
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	Fixture machine(rom), ordinary(rom);
	ordinary.cpu().setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	const u32 entry = machine.cart.textAddress + bootWord * INSTRUCTION_BYTES;
	const auto grant = BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::MTC0)];
	auto& cpu = machine.cpu();
	require(test::runCpuParity(cpu, ordinary.cpu(), grant) == RunResult::Yielded
		&& cpu.readFramePc(0) == entry && ordinary.cpu().readFramePc(0) == entry && !entryAt(cpu, entry, 0),
		"the exact EXEC grant admits the cartridge entry without preparing it");
	machine.prepareAtGrantBoundary(OpCode::K0);
	ordinary.prepareAtGrantBoundary(OpCode::K0);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(machine.runtime))
		== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime)),
		"physical page admission adds no guest effects to the admitted K0 step");
	const auto* boot = entryAt(cpu, entry, 0);
	const auto* sibling = entryAt(cpu, entry + 2u * INSTRUCTION_BYTES, 0);
	require(boot && sibling && boot->region == sibling->region,
		"geometric function spans cannot starve the explicit cartridge entry and its same-page batch");
	const auto& decoded = cpu.rootThread()->currentFrame->executionImage->decodedPages;
	for (u32 index = 0; index < twoPageFunctions; ++index) {
		const auto pc = machine.cart.textAddress + image.functions[2u + index].firstWord * INSTRUCTION_BYTES;
		const auto* first = entryAt(cpu, pc, 0);
		const auto* second = entryAt(cpu, pc + 2u * INSTRUCTION_BYTES, 0);
		if (index + 1u == twoPageFunctions)
			require(first && first->sourceWords == 3u && !second,
				"a crossing WIDE encoding can require a second page without publishing an entry there");
		else require(first && second && first->region == second->region,
				"neighboring functions sharing physical pages do not spend the page allowance twice");
	}
	for (u32 index = 0; index < sparseFunctions; ++index) {
		const auto pc = machine.cart.textAddress + image.functions[2u + twoPageFunctions + index].firstWord * INSTRUCTION_BYTES;
		MappedPageBinding page;
		machine.runtime.machine.memory.bindMappedPage(pc, MAPPED_BUS_INSTRUCTION_FETCH, page);
		if (index < admittedSparse) {
			MappedPageBinding unreachable;
			machine.runtime.machine.memory.bindMappedPage(pc + MAPPED_PAGE_BYTE_SIZE, MAPPED_BUS_INSTRUCTION_FETCH, unreachable);
			require(entryAt(cpu, pc, 0) && !decoded.find(unreachable.key),
				"unreachable function body pages neither create decoded source nor consume warmup allowance");
		} else require(!entryAt(cpu, pc, 0) && !decoded.find(page.key),
				"the WIDE body page still belongs to the dependency allowance when no entry was published in it");
	}
	require(decoded.entries().size() == NATIVE_IMAGE_WARMUP_MAX_PAGES && cpu.readNativeCompilationProfile().capacityEvictedRegions == 0,
		"prepared code stays within the unchanged physical page allowance");
}

void coldDiscoveryDoesNotFetchAPageBeyondItsWideBudget() {
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.functions.resize(NATIVE_IMAGE_WARMUP_MAX_PAGES);
	image.text.resize((NATIVE_IMAGE_WARMUP_MAX_PAGES + NATIVE_VERSION_REGION_MAX_PAGES + 2u) * MAPPED_PAGE_BYTE_SIZE);
	const auto layout = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	const u32 firstPage = (layout.textAddress + MAPPED_PAGE_BYTE_MASK) & ~MAPPED_PAGE_BYTE_MASK;
	const u32 firstWord = (firstPage - layout.textAddress) / INSTRUCTION_BYTES;
	const auto put = [&](u32 word, OpCode op, u8 b = 0, u8 c = 0) {
		writeInstruction(image.text, word, static_cast<u8>(op), 0, b, c);
	};
	for (u32 page = 0; page + 1u < NATIVE_IMAGE_WARMUP_MAX_PAGES; ++page) {
		const u32 word = firstWord + page * DECODED_PAGE_WORDS;
		if (page == 0u) {
			image.functions[page] = {.firstWord = word, .wordCount = 2};
			put(word, OpCode::K0);
			put(word + 1u, OpCode::RET, 1);
		} else {
			image.functions[page] = {.firstWord = word, .wordCount = 1};
			put(word, OpCode::RET, 1);
		}
	}
	const u32 bodyWord = firstWord + NATIVE_IMAGE_WARMUP_MAX_PAGES * DECODED_PAGE_WORDS;
	const u32 prefixWord = bodyWord - 1u, rootWord = prefixWord - 1u;
	const u32 extent = NATIVE_VERSION_REGION_MAX_PAGES * DECODED_PAGE_WORDS + 3u;
	image.functions.back() = {.firstWord = rootWord, .wordCount = extent};
	put(rootWord, OpCode::KSMI, 0, 7);
	put(prefixWord, OpCode::WIDE);
	put(bodyWord, OpCode::RET, 2);
	for (u32 word = bodyWord + 1u; word < rootWord + extent - 1u; ++word) put(word, OpCode::K0);
	put(rootWord + extent - 1u, OpCode::RET, 1);
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, image));
	auto& cpu = machine.cpu();
	const auto grant = BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::MTC0)];
	require(cpu.runUntilDepth(0, grant) == RunResult::Yielded && cpu.readFramePc(0) == firstPage,
		"the real cartridge begins on the first admitted page");
	machine.prepareAtGrantBoundary(OpCode::K0);
	require(cpu.readFramePc(0) == firstPage + INSTRUCTION_BYTES,
		"the cold batch prepares on the first page without reaching the pending return or WIDE body");
	const auto& decoded = cpu.rootThread()->currentFrame->executionImage->decodedPages;
	const u32 root = machine.cart.textAddress + rootWord * INSTRUCTION_BYTES;
	const u32 body = machine.cart.textAddress + bodyWord * INSTRUCTION_BYTES;
	MappedPageBinding bodyPage;
	machine.runtime.machine.memory.bindMappedPage(body, MAPPED_BUS_INSTRUCTION_FETCH, bodyPage);
	require(decoded.entries().size() == NATIVE_IMAGE_WARMUP_MAX_PAGES && !decoded.find(bodyPage.key),
		"the crossing WIDE body cannot decode a 33rd physical page during warmup");
	const auto* entry = entryAt(cpu, root, 0);
	require(entry && entry->sourceWords == 1u && !entryAt(cpu, root + INSTRUCTION_BYTES, 0),
		"the useful prefix still publishes and leaves the complete WIDE for ordinary execution");
	cpu.beginCompletionCallInExecutionDomain(0, machine.cart.functionAddresses.back());
	require(cpu.runUntilDepth(1, 1024) == RunResult::Halted && cpu.readCompletionValues().get(0) == valueInteger(7)
		&& decoded.find(bodyPage.key), "ordinary execution fetches the body and returns after the native prefix");
}

} // namespace

int main() {
	try {
		deferredWarmupRequiresAnAdmittedGrant();
		coldExecPreservesGuestStateAndBanks();
		preparedCodeUsesItsImageConstants();
		coldExecRecordsNumericFieldFeedback();
		repeatExecAndRestoreHaveDistinctPolicies();
		instrumentedGrantsDoNotPrepareNativeCode();
		residentExecDoesNotReopenTheBootHeader();
		observationsAndUnusedOperandsStayAtExecution();
		invalidDirectoryAndNonStaticEntryPreventCompilation();
		hintsDoNotBoundReachableCode();
		crossPageWideSourceUsesItsPhysicalSlot();
		boundedWarmupLeavesDistantBranchesToHotCompilation();
		warmupAdmitsTheEntryBeforeCompetingFunctionSpans();
		coldDiscoveryDoesNotFetchAPageBeyondItsWideBudget();
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		cartridgePreparationFollowsWorkerPublication();
#endif
		std::cout << "CART-PRECOMPILE:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
