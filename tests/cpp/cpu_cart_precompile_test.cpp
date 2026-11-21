#include "common/endian.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/runtime/record_constructor.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/rom_header.h"
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
		const auto requests = cpu().readNativeCompilationProfile().prepareRequests;
		require(cpu().runUntilDepth(0, grant) == RunResult::Yielded && cpu().instructionBudgetRemaining == 0
			&& cpu().isCartridgeExecutionActive() && cpu().readFramePc(0) == cart.textAddress,
			"EXEC completes its own exact grant before the first cartridge instruction");
		require(cpu().readNativeCompilationProfile().prepareRequests == requests,
			"EXEC commits without running native preparation inside the guest instruction");
	}

	void prepareAtGrantBoundary() {
		require(cpu().runUntilDepth(0, 0) == RunResult::Yielded && cpu().instructionBudgetRemaining == 0
			&& cpu().readFramePc(0) == cart.textAddress,
			"a normal grant boundary can prepare the image without executing its first instruction");
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
		for (const u32 word : {0u, 4u, 64u, static_cast<u32>(DECODED_PAGE_WORDS)}) {
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

void preparedCodeReadsTheLiveConstantBank() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}};
	image.constants = {i32{13}};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOADKR), 1, 2, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::SETI), 3, 1, 63, 7); // RK(C) = K[0].
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
	Fixture prepared(rom), scalar(withoutHints(rom));
	prepared.execute();
	scalar.execute();
	prepared.prepareAtGrantBoundary();
	scalar.prepareAtGrantBoundary();
	const auto* compiled = entryAt(prepared.cpu(), rom.textAddress, 0);
	require(compiled && !entryAt(scalar.cpu(), rom.textAddress, 0), "only the prepared CPU has installed this entry");
	const auto initialize = [](Fixture& machine) {
		auto& frame = *machine.cpu().activeThread()->frameAtDepth(0);
		auto table = machine.cpu().createTable(1);
		table.setInteger(1, valueInteger(0));
		frame.registers.set(2, valueInteger(0));
		frame.registers.set(3, valueTable(table.address()));
		return table;
	};
	const auto generatedTable = initialize(prepared);
	const auto referenceTable = initialize(scalar);
	int grant = 0;
	for (const auto op : {OpCode::LOADK, OpCode::LOADKR, OpCode::SETI, OpCode::JMP})
		grant += BASE_CYCLES[static_cast<u8>(op)];
	for (const Value value : {valueInteger(13), valueFloatBits(0xffa12345u), valueFromTag(ValueTag::False, 37)}) {
		for (auto* machine : {&prepared, &scalar}) {
			auto& frame = *machine->cpu().activeThread()->frameAtDepth(0);
			const auto pool = frame.executionImage->constPool;
			ValueSpan bank(machine->runtime.machine.memory, pool.wordAddress(), pool.tagAddress(), pool.size());
			bank.set(0, value);
		}
		test::runCpuParity(prepared.cpu(), scalar.cpu(), grant);
		for (auto* machine : {&prepared, &scalar}) {
			const auto& frame = *machine->cpu().activeThread()->frameAtDepth(0);
			require(frame.registers.get(0) == value && frame.registers.get(1) == value
				&& machine->cpu().readFramePc(0) == rom.textAddress && machine->cpu().instructionBudgetRemaining == 0,
				"LOADK and LOADKR read both current raw lanes at the exact same frontier");
		}
		require(generatedTable.getInteger(1) == value && referenceTable.getInteger(1) == value
			&& entryAt(prepared.cpu(), rom.textAddress, 0) == compiled,
			"RK stores the same live value without replacing the installed entry");
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
		machine.prepareAtGrantBoundary();
		auto& cpu = machine.cpu();
		const u32 root = machine.cart.textAddress, pc = root + INSTRUCTION_BYTES;
		const auto* cold = entryAt(cpu, root, 0);
		require(cold && cold->terminal.currentPc == pc && entryAt(cpu, pc + INSTRUCTION_BYTES, 0)
			&& entryAt(cpu, root + 64u * INSTRUCTION_BYTES, 0),
				"prepared code uses a generic continuation until the types stabilize");
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
			if (!entryAt(cpu, root, 0)) test::waitForNativeEntry(cpu, *frame.decodedPage, word);
		}
		const auto* entry = entryAt(cpu, root, 0);
		if (inherited) {
			require(entry->terminal.currentPc == pc,
				"a consistently inherited numeric field does not speculate on an unobserved own slot");
			continue;
		}
		require(entry->hasFusedJump && entry->terminal.currentPc == pc + 3 * INSTRUCTION_BYTES,
			"an observed own numeric read keeps subtraction and comparison in the same native body without a following store");
		const auto prefixCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
		NativeBlockRunState grant{.constants = frame.executionImage->constPool, .heap = &cpu.gcHeap(),
			.globalValues = {}, .systemGlobalValues = {}, .remainingCycles = prefixCycles + loopCycles};
		const auto* exit = entry->run(frame.registers, grant);
		require(exit->nextPc == machine.cart.textAddress && grant.remainingCycles == 0 && frame.registers.get(3) == valueFloat(3.5f),
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

test::Blua32TestRom recordConstructorProgram() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 6}};
	image.constants = {std::string("castle"), std::string("room"), std::string("player"),
		std::string("room_number"), std::string("item_id")};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::NEWT), 0, 0, 5);
	for (u32 field = 0; field < 5; ++field)
		writeInstruction(image.text, 1 + field, static_cast<u8>(OpCode::SETFIELD), 0, field, field + 1);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	return test::encodeBlua32TestRom(RomImageDomain::Cartridge, image);
}

void recordConstructorPreservesGrantAndLayout() {
	const auto rom = recordConstructorProgram();
	const int allocateCycles = BASE_CYCLES[static_cast<u8>(OpCode::NEWT)] + 16;
	const int fieldCycles = BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)];
	for (const bool shortGrant : {true, false}) {
		Fixture prepared(rom), scalar(withoutHints(rom));
		prepared.execute();
		scalar.execute();
		prepared.prepareAtGrantBoundary();
		scalar.prepareAtGrantBoundary();
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
		require(plan && plan->count == 5 && plan->partialMask == 0, "native preparation plans the exact fixed-key recipe");
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

	{
		Fixture prepared(rom), scalar(withoutHints(rom));
		prepared.execute();
		scalar.execute();
		prepared.prepareAtGrantBoundary();
		scalar.prepareAtGrantBoundary();
		const auto* recipe = entryAt(prepared.cpu(), rom.textAddress, 0)->terminal.recordConstructor;
		require(recipe && recipe->continuation[0] && *recipe->continuation[0],
			"publication binds the completed recipe to its warm successor");
		const int fullGrant = allocateCycles + 5 * fieldCycles + BASE_CYCLES[static_cast<u8>(OpCode::HALT)] + 1;
		for (auto* machine : {&prepared, &scalar}) {
			require(machine->cpu().runUntilDepth(0, fullGrant) == RunResult::Halted
				&& machine->cpu().instructionBudgetRemaining == 1,
				"both paths reach HALT after charging the complete construction");
		}
	}


	{
		Fixture prepared(rom);
		prepared.execute();
		prepared.prepareAtGrantBoundary();
		const u32 firstFieldPc = rom.textAddress + INSTRUCTION_BYTES;
		auto& cpu = prepared.cpu();
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		auto other = cpu.createTable();
		frame.registers.set(0, valueTable(other.address()));
		frame.registers.set(1, valueInteger(47));
		frame.setTop(2);
		frame.writeControl(FrameField::Pc, firstFieldPc);
		require(entryAt(cpu, firstFieldPc, 0) && cpu.runUntilDepth(0, fieldCycles) == RunResult::Yielded
			&& cpu.readFramePc(0) == firstFieldPc + INSTRUCTION_BYTES
			&& other.getStringKey(cpu.stringPool().intern("castle")) == valueInteger(47),
			"an independent field entry executes one ordinary store against its own receiver");
	}

	for (const bool lateObserver : {false, true}) {
		Fixture observed(rom);
		if (lateObserver) {
			observed.execute();
			observed.prepareAtGrantBoundary();
			require(entryAt(observed.cpu(), rom.textAddress, 0)->terminal.recordConstructor,
				"the recipe is installed before replacing the observer");
		}
		int storesObserved = 0;
		InstructionObserverBinding observer;
		observer.points[1].insert(rom.textAddress + 3 * INSTRUCTION_BYTES);
		observer.context = &storesObserved;
		observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) {
			++*static_cast<int*>(context);
		};
		observed.cpu().setInstructionObserver(std::move(observer));
		if (lateObserver)
			require(!entryAt(observed.cpu(), rom.textAddress, 0), "a late observer retires the prepared recipe");
		else {
			observed.execute();
			observed.prepareAtGrantBoundary();
			require(!entryAt(observed.cpu(), rom.textAddress, 0)->terminal.recordConstructor,
				"constructor preparation cannot cross an observed guest instruction");
		}
		observed.cpu().runUntilDepth(0, allocateCycles + 5 * fieldCycles);
		require(storesObserved == 1, "the observed original field store runs exactly once");
	}
}

void recordConstructorUsesLiveKeys() {
	const auto rom = recordConstructorProgram();
	const int allocateCycles = BASE_CYCLES[static_cast<u8>(OpCode::NEWT)] + 16;
	const int fieldCycles = BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)];
	Fixture prepared(rom), scalar(withoutHints(rom));
	prepared.execute();
	scalar.execute();
	prepared.prepareAtGrantBoundary();
	scalar.prepareAtGrantBoundary();
	const u32 pc = rom.textAddress;
	const auto* entry = entryAt(prepared.cpu(), pc, 0);
	const int grant = allocateCycles + 5 * fieldCycles;
	for (const char* key : {"castle", "observatory", "room"}) {
		for (auto* machine : {&prepared, &scalar}) {
			auto& cpu = machine->cpu();
			auto& frame = *cpu.activeThread()->frameAtDepth(0);
			const auto pool = frame.executionImage->constPool;
			ValueSpan bank(machine->runtime.machine.memory, pool.wordAddress(), pool.tagAddress(), pool.size());
			bank.set(0, valueString(cpu.stringPool().intern(key)));
			for (int field = 1; field <= 5; ++field) frame.registers.set(field, valueInteger(field));
			frame.setTop(6);
			frame.writeControl(FrameField::Pc, pc);
		}
		test::runCpuParity(prepared.cpu(), scalar.cpu(), grant);
		const auto table = [](Fixture& machine) {
			auto& cpu = machine.cpu();
			return asTable(cpu.activeThread()->frameAtDepth(0)->registers.get(0), cpu.gcHeap());
		};
		const auto a = table(prepared), b = table(scalar);
		const bool duplicate = std::string_view(key) == "room";
		require(a.getStringKey(prepared.cpu().stringPool().intern(key)) == valueInteger(duplicate ? 2 : 1)
			&& a.hashFree() == b.hashFree() && entryAt(prepared.cpu(), pc, 0) == entry,
			"the same recipe binds a changed key and leaves duplicate selectors to the ordered writes");
		for (u32 at = 0; at < TableRecord::storageBytes(0, 8); ++at)
			require(prepared.runtime.machine.memory.readRamRecordByte(a.storageAddress() + at)
				== scalar.runtime.machine.memory.readRamRecordByte(b.storageAddress() + at),
				"rebinding a recipe preserves physical record placement");
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
	machine.prepareAtGrantBoundary();
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
	machine.prepareAtGrantBoundary();
	require(entryAt(machine.cpu(), machine.cart.textAddress, 0),
		"resident hints select native source from the newly installed physical ROM");
	require(machine.cpu().runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::K1)]) == RunResult::Yielded
		&& machine.cpu().readFrameRegister(0, 0) == valueInteger(1),
		"the resident image fetches the installed replacement instruction");
}

void descriptiveTablesAndStaticAcceptanceRemainIndependent() {
	for (const u32 table : {IO_IRQ_FLAGS, CART_ROM_BASE + CART_ROM_SIZE - 32u}) {
		auto rom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridgeProgram("no-backed-hints"));
		writeLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET, table);
		Fixture machine(std::move(rom));
		const auto fault = machine.runtime.machine.memory.readBusFaultSequence();
		machine.execute();
		machine.prepareAtGrantBoundary();
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
	machine.prepareAtGrantBoundary();
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
	require(prepared.cpu().rootThread()->currentFrame->executionImage->decodedPages.empty(),
		"EXEC does not decode the target graph");
	prepared.prepareAtGrantBoundary();
	ordinary.prepareAtGrantBoundary();
	const auto profile = prepared.cpu().readNativeCompilationProfile();
	const u32 distant = rom.textAddress + (pages - 1u) * MAPPED_PAGE_BYTE_SIZE;
	require(prepared.cpu().rootThread()->currentFrame->executionImage->decodedPages.size() == NATIVE_IMAGE_WARMUP_MAX_PAGES
		&& entryAt(prepared.cpu(), rom.textAddress, 0) && !entryAt(prepared.cpu(), distant, 0)
		&& profile.capacityEvictedRegions == 0u,
		"startup work is bounded in decoded pages as well as emitted code");
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
		== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime)) && prepared.reads == 0,
		"bounded warmup adds no architectural effects to native EXEC");
	const int jumpCycles = BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	test::runCpuParity(prepared.cpu(), ordinary.cpu(), (pages - 1u) * jumpCycles);
	require(prepared.cpu().readFramePc(0) == distant && !entryAt(prepared.cpu(), distant, 0),
		"native and ordinary execution reach a target outside the startup batch at the same frontier");
	test::runCpuParity(prepared.cpu(), ordinary.cpu(), NATIVE_BLOCK_COMPILATION_THRESHOLD * jumpCycles);
	const auto& frame = *prepared.cpu().rootThread()->currentFrame;
	test::waitForNativeEntry(prepared.cpu(), *frame.decodedPage, (distant & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(prepared.runtime))
		== encodeRuntimeSaveState(captureRuntimeSaveState(ordinary.runtime)) && entryAt(prepared.cpu(), distant, 0),
		"ordinary hot compilation installs the later entry without changing guest state");
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
	machine.prepareAtGrantBoundary();
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
		preparedCodeReadsTheLiveConstantBank();
		coldExecLetsNumericFieldChainsWarm();
		recordConstructorPreservesGrantAndLayout();
		recordConstructorUsesLiveKeys();
		repeatExecAndRestoreHaveDistinctPolicies();
		instrumentedGrantsDoNotPrepareNativeCode();
		residentExecDoesNotReopenTheBootHeader();
		observationsAndUnusedHintsStayAtExecution();
		descriptiveTablesAndStaticAcceptanceRemainIndependent();
		hintsDoNotBoundReachableCode();
		crossPageWideSourceUsesItsPhysicalSlot();
		boundedWarmupLeavesDistantBranchesToHotCompilation();
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
