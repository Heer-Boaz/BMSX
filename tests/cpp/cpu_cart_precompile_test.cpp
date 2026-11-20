#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_table_constructor.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <iostream>
#include <stdexcept>
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
	for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
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
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LOADK), 1, 0, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOAD_MEM), 2, 1, static_cast<u8>(MemoryAccessKind::U32LE));
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 64, static_cast<u8>(OpCode::KSMI), 0, 0, 11);
	writeInstruction(image.text, 65, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::KSMI), 0, 0, 23);
	writeInstruction(image.text, DECODED_PAGE_WORDS + 1u, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord=0, .wordCount=5, .maxStack=3},
		{.firstWord=64, .wordCount=2}, {.firstWord=DECODED_PAGE_WORDS, .wordCount=2}};
	return image;
}

struct Fixture {
	test::Blua32TestRom system;
	test::Blua32TestRom cart;
	test::Blua32TestRom other;
	Input input;
	Runtime runtime;
	int reads = 0;

	explicit Fixture(test::Blua32TestRom cartridge, u32 slot = 0, bool warmSystem = false)
		: system(systemProgram(warmSystem)), cart(std::move(cartridge)),
		other(test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("other-slot"))),
		runtime({system.bytes, slot == 0 ? test::cartridgeSlots(cart.bytes, other.bytes)
			: test::cartridgeSlots(other.bytes, cart.bytes), PSX_MACHINE_SPEC}, input) {
		runtime.boot();
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
		require(cpu().runUntilDepth(0, grant) == RunResult::Yielded && cpu().instructionBudgetRemaining == 0
			&& cpu().isCartridgeExecutionActive() && cpu().readFramePc(0) == cart.textAddress,
			"EXEC completes its own exact grant before the first cartridge instruction");
	}
};

const NativeBlock* entryAt(CPU& cpu, u32 pc, u32 slot) {
	const auto& image = *cpu.rootThread()->currentFrame->executionImage;
	if (!image.nativeCodeLookup) return nullptr;
	const auto* page = image.nativeCodeLookup->find(pc, slot);
	return page && page->nativeBlocks
		? page->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get() : nullptr;
}

#if defined(BMSX_NATIVE_COMPILER_WORKER)
void cartridgePreparationDrainsTheExistingWorker() {
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("worker")), 0, true);
	require(machine.cpu().runUntilDepth(0, 2 * NATIVE_BLOCK_COMPILATION_THRESHOLD) == RunResult::Yielded
		&& machine.cpu().readNativeCompilationProfile().prepareRequests == 1,
		"the real BIOS warm loop submits one ordinary compiler-worker job");
	machine.cpu().beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, machine.system.functionAddresses[0]);
	machine.execute();
	const auto profile = machine.cpu().readNativeCompilationProfile();
	require(profile.backgroundCompleted == 1 && profile.backgroundCancelled == 0
		&& entryAt(machine.cpu(), machine.cart.textAddress, 0),
		"cartridge cold compilation waits for and publishes the existing worker through its normal owner");
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
		require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
			== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime))
			&& prepared.reads == 0 && ordinary.reads == 0,
			"cold compilation adds no guest heap/names/registers, clock, MMIO, fault or scheduler changes to ordinary EXEC");
		for (const u32 word : {0u, 4u, 64u, static_cast<u32>(DECODED_PAGE_WORDS)}) {
			require(entryAt(prepared.cpu(), rom.textAddress + word * INSTRUCTION_BYTES, slot),
				"EXEC prepares cold cartridge roots and helper continuations in their physical slot");
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

void coldExecLetsNumericFieldChainsWarm() {
	test::Blua32TestImage image;
	image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 5}, {.firstWord = 64, .wordCount = 1}};
	image.constants = {std::string("x"), Blua32FloatConstant{0u}};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 4, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETFIELD), 2, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::SUB), 3, 2, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LT), 0, 3, 62, 7); // RK(C) = K[1].
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	writeInstruction(image.text, 64, static_cast<u8>(OpCode::HALT), 0, 0, 0);

	const int readCycles = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)];
	const int compareGrant = readCycles + BASE_CYCLES[static_cast<u8>(OpCode::SUB)] + BASE_CYCLES[static_cast<u8>(OpCode::LT)];
	const int loopCycles = compareGrant + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	for (const bool inherited : {false, true}) {
		Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, image));
		machine.execute();
		auto& cpu = machine.cpu();
		const u32 pc = machine.cart.textAddress + INSTRUCTION_BYTES;
		require(entryAt(cpu, machine.cart.textAddress, 0) && !entryAt(cpu, pc, 0)
			&& entryAt(cpu, machine.cart.textAddress + 64u * INSTRUCTION_BYTES, 0),
			"EXEC compiles the prefix and unrelated function but not the unobserved field/arithmetic chain");
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		auto receiver = cpu.createTable(0, 1);
		auto holder = receiver;
		if (inherited) {
			holder = cpu.createTable(0, 1);
			auto meta = cpu.createTable(0, 1);
			meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(holder.address()));
			receiver.setMetatableAddress(meta.address());
		}
		const auto key = cpu.stringPool().intern("x");
		holder.setStringKey(key, valueFloat(4.0f));
		frame.registers.set(0, valueTable(receiver.address()));
		frame.registers.set(1, valueFloat(0.5f));
		if (!inherited) {
			// The original ROM star positions first contain integers, then
			// ordinary movement settles on Float. Exercise the same startup
			// type change through real bytecode, not seeded compiler hints.
			holder.setStringKey(key, valueInteger(4));
			require(cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::K1)] + 8 * loopCycles) == RunResult::Yielded,
				"the cold Float step first consumes an Integer field");
			holder.setStringKey(key, valueFloat(4.0f));
		}
		require(cpu.runUntilDepth(0, (loopCycles + BASE_CYCLES[static_cast<u8>(OpCode::K1)]
			+ (inherited ? TABLE_INDEX_VISIT_CYCLES : 0)) * (NATIVE_BLOCK_COMPILATION_THRESHOLD + 12)) == RunResult::Yielded,
			"the real EXEC path visits and warms its deferred field entry");
		const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		test::waitForNativeEntry(cpu, *frame.decodedPage, word);
		const auto* entry = entryAt(cpu, pc, 0);
		if (inherited) {
			require(entry->terminal.currentPc == pc,
				"a consistently inherited numeric field does not speculate on an unobserved own slot");
			continue;
		}
		require(entry->hasFusedJump && entry->terminal.currentPc == pc + 3 * INSTRUCTION_BYTES,
			"an observed own numeric read keeps subtraction and comparison in the same native body without a following store");
		NativeBlockRunState grant{.constants = frame.executionImage->constPool, .heap = &cpu.gcHeap(), .remainingCycles = loopCycles};
		const auto* exit = entry->run(frame.registers, grant);
		require(exit->nextPc == machine.cart.textAddress && grant.remainingCycles == 0 && frame.registers.get(3) == valueFloat(3.5f),
			"the warmed Float path executes through the comparison and fused jump at the exact guest cost");

		holder.setStringKey(key, valueFloat(0.25f));
		grant.remainingCycles = compareGrant;
		exit = entry->run(frame.registers, grant);
		require(exit->nextPc == pc + 4 * INSTRUCTION_BYTES && grant.remainingCycles == 0
			&& frame.registers.get(3) == valueFloat(-0.25f),
			"negative motion branches to the wrap continuation even when no grant remains for a jump");

		frame.registers.set(1, valueInteger(1));
		frame.registers.set(3, valueInteger(99));
		grant.remainingCycles = compareGrant;
		exit = entry->run(frame.registers, grant);
		require(exit->exit == NativeBlockExit::ScalarBoundary && grant.scalarPc == pc + INSTRUCTION_BYTES
			&& grant.remainingCycles == compareGrant - readCycles && frame.registers.get(2) == valueFloat(0.25f)
			&& frame.registers.get(3) == valueInteger(99),
			"a change in the step's tag publishes the read but leaves the arithmetic at its original guest PC");
	}
}

void recordConstructorPreservesGrantAndLayout() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 6}};
	image.constants = {std::string("castle"), std::string("room"), std::string("player"),
		std::string("room_number"), std::string("item_id")};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::NEWT), 0, 0, 5);
	for (u32 field = 0; field < 5; ++field)
		writeInstruction(image.text, 1 + field, static_cast<u8>(OpCode::SETFIELD), 0, field, field + 1);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	const int allocateCycles = BASE_CYCLES[static_cast<u8>(OpCode::NEWT)] + 16;
	const int fieldCycles = BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)];
	for (const bool shortGrant : {true, false}) {
		Fixture prepared(rom), scalar(withoutHints(rom));
		prepared.execute();
		scalar.execute();
		for (auto* machine : {&prepared, &scalar}) {
			auto& frame = *machine->cpu().activeThread()->frameAtDepth(0);
			frame.registers.set(1, valueBool(false));
			frame.registers.set(2, valueNil());
			frame.registers.set(3, valueTable(machine->cpu().createTable().address()));
			frame.registers.set(4, valueFloatBits(0x80000000u));
			frame.registers.set(5, valueInteger(11));
			frame.setTop(6);
		}
		const u32 start = rom.textAddress;
		auto* plan = entryAt(prepared.cpu(), start, 0)->terminal.recordConstructor;
		require(plan && plan->count == 5 && plan->partialMask == 0, "EXEC prepares the exact fixed-key recipe");
		// The final store can overdraw by its own charge. A shorter grant
		// must still expose the original instruction frontier and table state.
		const int grant = allocateCycles + (shortGrant ? 2 * fieldCycles : 4 * fieldCycles + 1);
		const u32 expectedPc = start + (shortGrant ? 3u : 6u) * INSTRUCTION_BYTES;
		for (auto* machine : {&prepared, &scalar}) {
			require(machine->cpu().runUntilDepth(0, grant) == RunResult::Yielded
				&& machine->cpu().readFramePc(0) == expectedPc
				&& machine->cpu().instructionBudgetRemaining == (shortGrant ? 0 : 1 - fieldCycles),
				"constructor publishes the same original PC and exact cycle frontier");
		}
		require(plan->partialMask == (shortGrant ? 0u : 29u),
			"only the admitted full group executes the prepared nil-aware placement");
		const auto table = [](Fixture& fixture) {
			return asTable(fixture.cpu().activeThread()->frameAtDepth(0)->registers.get(0), fixture.cpu().gcHeap());
		};
		auto a = table(prepared), b = table(scalar);
		require(a.hashFree() == b.hashFree(), "the prepared constructor preserves the physical free cursor");
		for (u32 at = 0; at < TableRecord::storageBytes(0, 8); ++at)
			require(prepared.runtime.machine.memory.readRamRecordByte(a.storageAddress() + at)
				== scalar.runtime.machine.memory.readRamRecordByte(b.storageAddress() + at),
				"prepared placement preserves the exact live keys, nils, raw values and hash links");
		if (shortGrant) {
			for (auto* machine : {&prepared, &scalar}) {
				require(machine->cpu().runUntilDepth(0, 3 * fieldCycles) == RunResult::Yielded
					&& machine->cpu().readFramePc(0) == start + 6 * INSTRUCTION_BYTES,
					"the original stores resume at the short-grant frontier");
			}
		}
		const auto id = prepared.cpu().stringPool().intern("item_id");
		require(a.getStringKey(id) == valueInteger(11), "completed constructor publishes all admitted values");
		a.setStringKey(id, valueInteger(29));
		require(a.getStringKey(id) == valueInteger(29), "the prepared body remains an ordinary mutable table");
	}

	Fixture observed(rom);
	int storesObserved = 0;
	InstructionObserverBinding observer;
	observer.points[1].insert(rom.textAddress + 3 * INSTRUCTION_BYTES);
	observer.context = &storesObserved;
	observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) {
		++*static_cast<int*>(context);
	};
	observed.cpu().setInstructionObserver(std::move(observer));
	observed.execute();
	require(entryAt(observed.cpu(), rom.textAddress, 0)->terminal.recordConstructor == nullptr,
		"constructor preparation cannot cross an observed guest instruction");
	observed.cpu().runUntilDepth(0, allocateCycles + 5 * fieldCycles);
	require(storesObserved == 1, "the observed original field store runs exactly once");
}

void repeatExecAndRestoreHaveDistinctPolicies() {
	Fixture machine(test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("repeat")));
	machine.cpu().prepareSystemNativeCode();
	machine.execute();
	const auto first = machine.cpu().readNativeCompilationProfile();
	machine.cpu().requestNonMaskableInterrupt();
	require(machine.cpu().enterPendingInterrupt(), "NMI enters the system EXEC handler");
	machine.execute();
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

void descriptiveTablesAndStaticAcceptanceRemainIndependent() {
	for (const u32 table : {IO_IRQ_FLAGS, CART_ROM_BASE + CART_ROM_SIZE - 32u}) {
		auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("no-backed-hints"));
		writeLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET, table);
		Fixture machine(std::move(rom));
		const auto fault = machine.runtime.machine.memory.readBusFaultSequence();
		machine.execute();
		require(machine.cpu().readNativeCompilationProfile().codeBytes == 0 && machine.reads == 0
			&& machine.runtime.machine.memory.readBusFaultSequence() == fault,
			"unbacked descriptive tables cannot become new EXEC admission or MMIO/fault requirements");
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
	require(entryAt(machine.cpu(), machine.cart.textAddress + MAPPED_PAGE_BYTE_SIZE, 0),
		"cold discovery follows backed cross-page branches beyond descriptive function extents");
	require(machine.cpu().runUntilDepth(0, 1) == RunResult::Yielded
		&& machine.cpu().readFramePc(0) == machine.cart.textAddress + MAPPED_PAGE_BYTE_SIZE,
		"the cross-page branch consumes its own grant without fetching its successor");
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
	const auto* block = entryAt(machine.cpu(), machine.cart.textAddress + word * INSTRUCTION_BYTES, 1u);
	require(block && block->sourceWords >= 2u,
		"cold cartridge discovery owns a WIDE body's dependency across its physical ROM page");
	machine.runtime.machine.memory.writeMappedU32LE(IO_CART_SELECT, 0u);
	machine.cpu().beginCompletionCallInExecutionDomain(1, machine.cart.functionAddresses[1]);
	require(machine.cpu().runUntilDepth(1, 32) == RunResult::Halted
		&& machine.cpu().readCompletionValues().get(0) == valueInteger(37),
		"the prepared cross-page function and operands stay pinned to slot one after socket selection changes");
}

void capacityRetirementInsideNativeExecKeepsTheGateAlive() {
	auto image = cartridgeProgram("capacity");
	constexpr u32 fillerCount = 8192u;
	image.text.resize((fillerCount + 3u) * MAPPED_PAGE_BYTE_SIZE);
	for (u32 index = 0; index < fillerCount; ++index) {
		const u32 first = (index + 3u) * DECODED_PAGE_WORDS;
		for (u32 word = 0; word < DECODED_PAGE_WORDS - 1u; ++word)
			writeInstruction(image.text, first + word, static_cast<u8>(OpCode::GETFIELD), 0, 0, 0);
		writeInstruction(image.text, first + DECODED_PAGE_WORDS - 1u, static_cast<u8>(OpCode::RET), 0, 1, 0);
		image.functions.push_back({.firstWord=first, .wordCount=DECODED_PAGE_WORDS});
	}
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	Fixture prepared(rom), ordinary(withoutHints(rom));
	prepared.cpu().prepareSystemNativeCode();
	ordinary.cpu().prepareSystemNativeCode();
	require(entryAt(prepared.cpu(), prepared.system.textAddress, 0), "EXEC is entered through actual prepared system code");
	prepared.execute();
	ordinary.execute();
	const auto profile = prepared.cpu().readNativeCompilationProfile();
	require(profile.capacityFlushes > 0 && profile.capacityRetiredCodeBytes >= NATIVE_CODE_CACHE_MAX_BYTES,
		"cartridge preparation crosses the real shared cache limit and retires its executing BIOS source");
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
		== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime)) && prepared.reads == 0,
		"retirement inside native EXEC returns through the stable gate without stale descriptors or guest effects");
	test::runCpuParity(prepared.cpu(), ordinary.cpu(), 3);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
		== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime)),
		"the first cartridge instructions remain exact after capacity retirement");
}

void observationsAndUnusedHintsStayAtExecution() {
	auto image = cartridgeProgram("observed");
	writeInstruction(image.text, 128, static_cast<u8>(OpCode::GETGL), 0, 63, 63, 255);
	writeInstruction(image.text, 132, static_cast<u8>(OpCode::LOADK), 0, 0, 63);
	for (const u32 word : {128u, 132u, 136u, 140u, 144u, 148u}) image.functions.push_back({.firstWord=word, .wordCount=1});
	auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	writeLE32(rom.bytes.data() + rom.functionAddresses[5] - CART_ROM_BASE, IO_IRQ_FLAGS);
	writeLE32(rom.bytes.data() + rom.functionAddresses[6] - CART_ROM_BASE, CART_RAM_BASE);
	writeLE32(rom.bytes.data() + rom.functionAddresses[7] - CART_ROM_BASE, rom.textAddress + 1u);
	writeLE32(rom.bytes.data() + rom.functionAddresses[8] - CART_ROM_BASE, DYNAMIC_RAM_BASE);
	Fixture machine(std::move(rom));
	int observations = 0;
	InstructionObserverBinding observer;
	observer.points[1].insert(machine.cart.textAddress);
	observer.context = &observations;
	observer.observe = [](void* context, ExecutionDomainId domain, u32, ConstValueSpan) {
		require(domain == 0, "cartridge observation keeps its execution domain");
		++*static_cast<int*>(context);
	};
	machine.cpu().setInstructionObserver(std::move(observer));
	const auto fault = machine.runtime.machine.memory.readBusFaultSequence();
	machine.execute();
	require(observations == 0 && machine.reads == 0 && machine.runtime.machine.memory.readBusFaultSequence() == fault
		&& !entryAt(machine.cpu(), machine.cart.textAddress, 0)
		&& entryAt(machine.cpu(), machine.cart.textAddress + 64u * INSTRUCTION_BYTES, 0),
		"cold hints cannot observe guest code, raise unused constant/name faults or read MMIO/RAM");
	require(machine.cpu().runUntilDepth(0, 1) == RunResult::Yielded && observations == 1,
		"the observed cartridge instruction runs exactly once on its own grant");
}

} // namespace

int main() {
	try {
		coldExecPreservesGuestStateAndBanks();
		coldExecLetsNumericFieldChainsWarm();
		recordConstructorPreservesGrantAndLayout();
		repeatExecAndRestoreHaveDistinctPolicies();
		observationsAndUnusedHintsStayAtExecution();
		descriptiveTablesAndStaticAcceptanceRemainIndependent();
		hintsDoNotBoundReachableCode();
		crossPageWideSourceUsesItsPhysicalSlot();
		capacityRetirementInsideNativeExecKeepsTheGateAlive();
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		cartridgePreparationDrainsTheExistingWorker();
#endif
		std::cout << "CART-PRECOMPILE:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
