#include "common/hash_fnv.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/decoded_instruction.h"
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/jit/compiler.h"
#endif
#include "machine/devices/irq/controller.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/io.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/jit/sljit/abi.h"
#include "machine/cpu/jit/runtime/execution.h"
#endif

#include <algorithm>
#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

test::Blua32TestRom image(int results, int arguments, bool wide = false) {
	test::Blua32TestImage source; source.text.resize(4 * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::MOV), 7, 15, 0);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::MOV), 0, 12, 0);
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::MOV), 1, 13, 0);
	writeInstruction(source.text, 3, static_cast<u8>(OpCode::MOV), 2, 14, 0);
	u32 word = 4;
	if (wide) writeInstruction(source.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(source.text, word++, static_cast<u8>(OpCode::CALL), 0, arguments, results);
	writeInstruction(source.text, word++, static_cast<u8>(OpCode::MOV), 8, 0, 0);
	writeInstruction(source.text, word++, static_cast<u8>(OpCode::MOV), 9, 7, 0);
	writeInstruction(source.text, word++, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(source.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(source.text, DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(source.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(source.text, 3 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::MTC0), 0, COP0_STATUS, 0);
	writeInstruction(source.text, 3 * DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	source.functions = {{.firstWord=0, .wordCount=word, .maxStack=16},
		{.firstWord=DECODED_PAGE_WORDS, .wordCount=2, .maxStack=2},
		{.firstWord=2 * DECODED_PAGE_WORDS, .wordCount=1, .maxStack=2},
		{.firstWord=3 * DECODED_PAGE_WORDS, .wordCount=2, .maxStack=16}};
	source.exceptionFunctionIndex = source.irqFunctionIndex = 2;
	return test::encodeBlua32TestRom(RomImageDomain::System, source);
}

struct Machine {
	const test::Blua32TestRom& rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	std::optional<TableRecord> target;
	std::optional<TableRecord> meta;
	Value expected = valueNil();
	Machine(const test::Blua32TestRom& r, bool scalar) : rom(r),
		memory(MemoryInit{r.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
	void seed(BuiltinFunctionId id, int mode = 0, float position = 3) {
		auto* frame = cpu.rootThread()->currentFrame; auto r = frame->registers;
		r.set(0, valueInteger(-11)); r.set(1, valueBool(false)); r.set(2, valueBool(false));
		r.set(7, valueInteger(-7)); r.set(8, valueInteger(-8)); r.set(9, valueInteger(-9));
		r.set(12, cpu.createBuiltinFunction(id)); r.set(15, valueFloat(99.75f)); frame->writeControl(bmsx::FrameField::Top, 3);
		if (id == BuiltinFunctionId::StringByte) {
			r.set(13, mode == 2 ? valueInteger(17) : valueString(cpu.stringPool().intern(std::string("A\xc3\xa9\xf0\x9f\x98\x80\0Z", 9))));
			r.set(14, mode == 1 ? valueNil() : mode == 3 ? valueBool(false) : valueFloat(position));
			expected = mode == 1 ? valueInteger(65) : position == 3 ? valueInteger(169)
				: (position == 2 || position == 2.9f) ? valueInteger(195) : valueNil();
		} else if (id == BuiltinFunctionId::ToInteger) {
			r.set(13, valueFloat(position));
			expected = position == 3 ? valueInteger(3) : valueNil();
		} else {
			target = cpu.createTable(); meta = cpu.createTable();
			if (id != BuiltinFunctionId::SetMetatable || mode != 0) target->setMetatableAddress(meta->address());
			r.set(13, mode == 3 ? valueInteger(17) : valueTable(target->address()));
			r.set(14, mode == 1 ? valueNil() : mode == 2 ? valueBool(false) : valueTable(meta->address()));
			expected = id == BuiltinFunctionId::GetMetatable ? valueTable(meta->address()) : valueTable(target->address());
		}
	}
	void selectClosure() {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[1], rom.textAddress + MAPPED_PAGE_BYTE_SIZE);
		const Value closure = valueClosure(cpu.rootThread()->currentFrame->closureAddress());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
		cpu.rootThread()->currentFrame->registers.set(12, closure);
	}
};

void parity(Machine& a, Machine& b) {
	const auto x = a.cpu.captureRuntimeState(), y = b.cpu.captureRuntimeState();
	require((x == y && bmsx::test::sameLanguageRam(a.cpu, b.cpu))
		&& x.causeWord == y.causeWord && x.epcWord == y.epcWord && x.lastPc == y.lastPc && x.hardHalted == y.hardHalted,
		"native/scalar builtin continuity preserves the complete guest graph and fault state");
	require(a.cpu.readCurrentInstructionPc() == b.cpu.readCurrentInstructionPc()
		&& a.cpu.instructionBudgetRemaining == b.cpu.instructionBudgetRemaining,
		"native/scalar completed frontier and exact consumed grant agree");
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
NativeBlock* preparedCaller(Machine& machine) {
	auto* frame = machine.cpu.rootThread()->currentFrame;
	auto* page = frame->executionImage->nativeCodeLookup->find(machine.rom.textAddress, 0);
	require(page && page->nativeBlocks, "the CPU owns actual prepared caller code");
	auto* caller = page->nativeBlocks->entries[(machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
	require(caller && caller->terminal.exit == NativeBlockExit::Call, "the original source operation really is CALL");
	auto* successor = page->nativeBlocks->entries[(caller->terminal.nextPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
	require(successor && successor->region == caller->region, "CALL and its actual successor share a published allocation");
	return caller;
}
#endif

void recordObserversReadPendingFrameWords() {
	test::Blua32TestImage source; source.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::MOV), 5, 14, static_cast<u8>(ValueMoveKind::FloatBits));
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::MOV), 6, 15, static_cast<u8>(ValueMoveKind::FloatBits));
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(source.text, 3, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	writeInstruction(source.text, 4, static_cast<u8>(OpCode::MOV), 2, 0, 0);
	writeInstruction(source.text, 5, static_cast<u8>(OpCode::MOV), 3, 6, 0);
	writeInstruction(source.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	source.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 16}};
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, source);
	for (const auto id : {BuiltinFunctionId::StringByte, BuiltinFunctionId::GetMetatable}) {
		Machine native(rom, false), scalar(rom, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(preparedCaller(native)->admissionCycles == 2 * BASE_CYCLES[static_cast<u8>(OpCode::MOV)],
			"the installed leaf call admits both record writes in the same segment");
#endif
		for (auto* machine : {&native, &scalar}) {
			auto& registers = machine->cpu.rootThread()->currentFrame->registers;
			const u32 record = RAM_BASE + registers.wordAddress() + 4u * sizeof(u32);
			registers.set(0, machine->cpu.createBuiltinFunction(id));
			// R4 and following words back the record. R6 is outside the CALL
			// arguments and holds the metatable address or String byte count.
			if (id == BuiltinFunctionId::GetMetatable) {
				TableRecord(machine->cpu.gcHeap(), record).initialize(0, 0);
				const auto meta = machine->cpu.createTable().address();
				registers.set(1, valueTable(record));
				registers.set(14, valueFloatBits(0u));
				registers.set(15, valueFloatBits(meta));
				machine->expected = valueTable(meta);
			} else {
				machine->memory.writeRamRecordWord(record, BLUA32_STRING_RECORD_KIND);
				machine->memory.writeRamRecordWord(record + BLUA32_STRING_HASH_OFFSET, fnv1a32(""));
				machine->memory.writeRamRecordWord(record + BLUA32_STRING_LENGTH_OFFSET, 0u);
				machine->memory.writeRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET, 0u);
				machine->memory.writeRamRecordByte(record + BLUA32_STRING_RECORD_HEADER_SIZE, 'a');
				registers.set(1, valueString(record));
				registers.set(14, valueFloatBits(fnv1a32("a")));
				registers.set(15, valueFloatBits(1u));
				machine->expected = valueInteger('a');
			}
		}
		const int grant = 2 * BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)] + 2 + 1;
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded
			&& native.cpu.readFramePc(0) == rom.textAddress + 4 * INSTRUCTION_BYTES
			&& native.cpu.readCurrentInstructionPc() == rom.textAddress + 2 * INSTRUCTION_BYTES
			&& native.cpu.lastPc == rom.textAddress + 3 * INSTRUCTION_BYTES && native.cpu.instructionBudgetRemaining == 0,
			"the record observer completes its WIDE CALL once before the successor");
		require(native.cpu.readFrameRegister(0, 0) == native.expected,
			id == BuiltinFunctionId::GetMetatable ? "GetMetatable observes the pending metatable address" : "StringByte observes the pending byte count");
		parity(native, scalar);
		const int continuation = 2 * BASE_CYCLES[static_cast<u8>(OpCode::MOV)];
		require(test::runCpuParity(native.cpu, scalar.cpu, continuation) == RunResult::Yielded
			&& native.cpu.readFrameRegister(0, 2) == native.expected
			&& native.cpu.readFrameRegister(0, 3) == native.cpu.readFrameRegister(0, 6),
			"the successor sees both the result and the published frame word");
		parity(native, scalar);
	}
}

void recordObserversReadTheCallFrameControl() {
	for (const bool open : {false, true}) {
		test::Blua32TestImage source;
		source.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(source.text, 0, static_cast<u8>(OpCode::K1), 6, 0, 0);
		writeInstruction(source.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(source.text, 2, static_cast<u8>(OpCode::CALL), 0, open ? 0 : 2, 2);
		writeInstruction(source.text, 3, static_cast<u8>(OpCode::MOV), 3, 0, 0);
		writeInstruction(source.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		source.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}};
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, source);
		const u32 nextPc = rom.textAddress + 3u * INSTRUCTION_BYTES;
		for (const auto id : {BuiltinFunctionId::StringByte, BuiltinFunctionId::GetMetatable}) {
			Machine native(rom, false), scalar(rom, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			require(preparedCaller(native)->admissionCycles == BASE_CYCLES[static_cast<u8>(OpCode::K1)],
				"the generated CALL owns the preceding register-top advance");
#endif
			for (auto* machine : {&native, &scalar}) {
				auto& frame = *machine->cpu.rootThread()->currentFrame;
				auto& r = frame.registers;
				r.set(0, machine->cpu.createBuiltinFunction(id));
				const auto control = RAM_BASE + frame.controlOffset;
				if (id == BuiltinFunctionId::StringByte) {
					// Byte 1 is the low byte of Pc. The masked Protected
					// word supplies a length large enough for that byte.
					r.set(1, valueString(control + static_cast<u32>(FrameField::Pc) - BLUA32_STRING_RECORD_HEADER_SIZE));
				} else {
					r.set(1, valueTable(control + static_cast<u32>(FrameField::Top) - static_cast<u32>(TableHeader::Metatable)));
				}
				frame.setTop(2);
			}
			const int grant = BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)] + 2 + 1;
			const auto expected = id == BuiltinFunctionId::StringByte ? valueInteger(nextPc & 0xffu) : valueTable(7);
			require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded
				&& native.cpu.readFrameRegister(0, 0) == expected && native.cpu.readFramePc(0) == nextPc
				&& native.cpu.activeThread()->currentFrame->readWindow(FrameField::Top) == 1
				&& native.cpu.lastPc == nextPc - INSTRUCTION_BYTES && native.cpu.instructionBudgetRemaining == 0,
				"the inline or gate leaf reads the WIDE CALL frontier before placing results");
			parity(native, scalar);
		}
	}
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void rawContinuity(BuiltinFunctionId id, int results, int mode = 0, float position = 3, bool missing = false) {
	const int arguments = id == BuiltinFunctionId::GetMetatable || id == BuiltinFunctionId::ToInteger || missing ? 2 : 3;
	const auto rom = image(results, arguments); Machine machine(rom, false); machine.seed(id, mode, position);
	if (missing) machine.expected = valueInteger(65);
	auto* frame = machine.cpu.rootThread()->currentFrame;
	auto* caller = preparedCaller(machine);
	machine.cpu.instructionBudgetRemaining = 12345;
	NativeBlockRunState state{.constants=frame->executionImage->constPool, .frame=frame, .remainingCycles=64, .registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
	const auto* exit = caller->run(frame->registers, state);
	// Base NativeBlock::run deliberately has no NativeCpuRunState tail or C++
	// dispatcher. Only a real body-internal completed CALL can reach this HALT.
	require(exit->exit == NativeBlockExit::Halt, "CPU-bound CALL completes and reaches its actual same-region HALT in one base-ABI invocation");
	const int receiving = results == 1 ? 0 : 1;
	require(state.remainingCycles == 64 - 6 * BASE_CYCLES[static_cast<u8>(OpCode::MOV)] - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - (id == BuiltinFunctionId::ToInteger ? 1 : 2) - receiving - BASE_CYCLES[static_cast<u8>(OpCode::HALT)],
		"CALL prefix, primitive, receive slot and actual successor are charged once");
	require(frame->registers.get(7) == valueFloat(99.75f) && frame->registers.get(9) == valueFloat(99.75f),
		"dirty cached values not consumed by the leaf survive its host-call ABI");
	require(frame->registers.get(8) == (receiving ? machine.expected : frame->registers.get(12)),
		"the successor consumes the new result, or the retained callee when results are discarded");
	const bool observesRecord = id != BuiltinFunctionId::ToInteger;
	require(machine.cpu.instructionBudgetRemaining == 12345, "the base native ABI owns the live cycle grant");
	require(frame->readControl(FrameField::Pc) == (observesRecord ? caller->terminal.nextPc : rom.textAddress)
		&& frame->readWindow(FrameField::Top) == (observesRecord ? 8 : 3),
		"only record readers expose the CALL's pre-placement control in RAM");
}

void rawSetMetatableReturnsUnexecutedCall() {
	for (const bool clear : {false, true}) {
		const auto rom = image(2, 3);
		Machine machine(rom, false);
		machine.seed(BuiltinFunctionId::SetMetatable, clear ? 1 : 0);
		const u32 original = clear ? machine.meta->address() : 0u;
		auto* frame = machine.cpu.rootThread()->currentFrame;
		auto* caller = preparedCaller(machine);
		NativeBlockRunState state{.constants=frame->executionImage->constPool, .frame=frame, .remainingCycles=64,
			.registerTop=static_cast<i32>(frame->readControl(FrameField::Top))};
		const auto* exit = caller->run(frame->registers, state);
		require(exit == &caller->terminal && exit->currentPc == rom.textAddress + 4 * INSTRUCTION_BYTES
			&& state.remainingCycles == 64 - 4 * BASE_CYCLES[static_cast<u8>(OpCode::MOV)] - BASE_CYCLES[static_cast<u8>(OpCode::CALL)],
			"a valid SetMetatable returns the original CALL with only the prefix and opcode charged");
		require(machine.target->metatableAddress() == original
			&& frame->registers.get(0) == frame->registers.get(12)
			&& frame->registers.get(1) == frame->registers.get(13)
			&& frame->registers.get(2) == frame->registers.get(14)
			&& frame->registers.get(8) == valueInteger(-8),
			"the base native ABI leaves metatable mutation, result placement and the successor to the CPU");
	}
}

void rawDeclines() {
	for (const int variant : {0, 1, 2, 3, 4}) {
		const int results = variant == 0 ? 3 : 2;
		const auto rom = image(results, variant == 4 ? 0 : 3); Machine machine(rom, false); machine.seed(variant == 1 ? BuiltinFunctionId::Type : BuiltinFunctionId::StringByte, variant == 2 ? 3 : 0);
		if (variant == 3) machine.selectClosure();
		auto* frame = machine.cpu.rootThread()->currentFrame;
		NativeBlockRunState state{.constants=frame->executionImage->constPool, .frame=frame, .remainingCycles=64, .registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
		const auto* exit = preparedCaller(machine)->run(frame->registers, state);
		require(exit->exit == NativeBlockExit::Call && state.remainingCycles == 64 - 4 * BASE_CYCLES[static_cast<u8>(OpCode::MOV)] - BASE_CYCLES[static_cast<u8>(OpCode::CALL)],
			"padding, unsupported primitive, bad arguments and a real Closure preserve the ordinary unexecuted CALL boundary");
		require(frame->registers.get(0) == frame->registers.get(12) && frame->registers.get(1) == frame->registers.get(13)
			&& frame->registers.get(2) == frame->registers.get(14) && frame->registers.get(8) == valueInteger(-8),
			"a declined inline call publishes the exact dirty prefix without a result or successor");
	}
}

void completedDebtDoesNotRunTheSuccessor() {
	for (const int results : {0,1,2}) {
		const auto rom=image(results,3);Machine machine(rom,false);machine.seed(BuiltinFunctionId::StringByte);
		auto* frame=machine.cpu.rootThread()->currentFrame;
		const int prefix=4*BASE_CYCLES[static_cast<u8>(OpCode::MOV)]+BASE_CYCLES[static_cast<u8>(OpCode::CALL)];
		NativeBlockRunState state{.constants=frame->executionImage->constPool,.frame=frame, .remainingCycles=prefix,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
		const auto* caller=preparedCaller(machine);const auto* exit=caller->run(frame->registers, state);const int receiving=results==1?0:1;
		require(exit->exit==NativeBlockExit::CompletedCall && exit->cycles==0 && exit->nextPc==caller->terminal.nextPc,
			"an exhausting successful leaf returns its completed successor frontier, never the original CALL");
		require(state.remainingCycles==-2-receiving && state.registerTop==receiving,
			"the complete primitive/result charge commits even when CALL exhausted the grant");
		require(frame->registers.get(8)==valueInteger(-8) && frame->registers.get(9)==valueInteger(-9),
			"no successor executes after the completed CALL debt");
		require(frame->registers.get(0)==(receiving ? machine.expected : frame->registers.get(12)),
			"completed debt publishes the raw result, or retains the callee for a discarded result");
	}
}

void mutableCalleesUseTheirCurrentIdentity() {
	const auto rom=image(2,3);Machine machine(rom,false);auto* caller=preparedCaller(machine);
	for(const auto id:{BuiltinFunctionId::StringByte,BuiltinFunctionId::SetMetatable,BuiltinFunctionId::GetMetatable,BuiltinFunctionId::Type}) {
		machine.seed(id);auto* frame=machine.cpu.rootThread()->currentFrame;
		NativeBlockRunState state{.constants=frame->executionImage->constPool,.frame=frame, .remainingCycles=64,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
		const auto* exit=caller->run(frame->registers, state);
		if(id==BuiltinFunctionId::SetMetatable || id==BuiltinFunctionId::Type)
			require(exit==&caller->terminal && frame->registers.get(0)==frame->registers.get(12) && frame->registers.get(8)==valueInteger(-8),
				"a reused callsite returns ordinary CALL for the current non-leaf builtin");
		else require(exit->exit==NativeBlockExit::Halt && frame->registers.get(8)==machine.expected,"one published callsite observes each actual supported primitive ID");
	}
	machine.seed(BuiltinFunctionId::StringByte);machine.selectClosure();auto* frame=machine.cpu.rootThread()->currentFrame;
	NativeBlockRunState state{.constants=frame->executionImage->constPool,.frame=frame, .remainingCycles=64,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
	require(caller->run(frame->registers, state)->exit==NativeBlockExit::Call && valueIsClosure(frame->registers.get(0)),
		"a real Closure replacing a formerly hot primitive retains normal activation semantics");
}

void inlineInterruptStop(bool nmi, bool wide) {
	const auto rom=image(2,3,wide);Machine machine(rom,false);
	if(!nmi) {
		auto* frame=machine.cpu.rootThread()->currentFrame;
		frame->registers.set(0, valueInteger(CPU_STATUS_INTERRUPT_ENABLE_CURRENT));
		machine.cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,rom.functionAddresses[3],rom.textAddress+3*MAPPED_PAGE_BYTE_SIZE);
		machine.cpu.runUntilDepth(0,BASE_CYCLES[static_cast<u8>(OpCode::MTC0)]);
		require((machine.cpu.captureRuntimeState().statusWord&CPU_STATUS_INTERRUPT_ENABLE_CURRENT)!=0,"the guest MTC0 really unmasks IRQ admission");
		machine.cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,rom.functionAddresses[0],rom.textAddress);
		machine.memory.writeMappedU32LE(IO_IRQ_MASK,1);
	}
	machine.seed(BuiltinFunctionId::StringByte);auto* frame=machine.cpu.rootThread()->currentFrame;
	auto* caller=preparedCaller(machine);auto* owner=frame->executionImage;auto* page=owner->nativeCodeLookup->find(rom.textAddress,0);
	const auto& gate=nativeBlockGate();
	NativeCpuRunState run{.state={.constants=owner->constPool,.frame=frame, .remainingCycles=64,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top)),.exitCode=gate.dispatch,.ram=machine.memory.ramData()},
		.cpu=&machine.cpu,.targetDepth=0,.codeRoot=owner->nativeCodeLookup->root(0),
		.cartridgeSlot=0,.error={}};
	run.state.bindWindow(*frame);
	// The typed gate is an already-admitted native segment, not a fresh outer
	// CPU IRQ admission. Its successful CALL must stop at the next instruction.
	if(nmi) machine.cpu.requestNonMaskableInterrupt();else machine.irq.raise(1);
	reinterpret_cast<NativeBlockGate::Entry>(gate.entry)(&run.state, page->nativeCode[(rom.textAddress&MAPPED_PAGE_BYTE_MASK)/INSTRUCTION_BYTES], &frame->registers);
	if(run.error) std::rethrow_exception(run.error);
	require(frame->registers.get(0)==machine.expected && frame->registers.get(8)==valueInteger(-8)
		&& frame->readControl(bmsx::FrameField::Pc)==caller->terminal.nextPc && static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))==1,
		"positive-grant IRQ/NMI stops AFTER completed leaf, before its actual internal successor");
	require(run.state.remainingCycles==64-4*BASE_CYCLES[static_cast<u8>(OpCode::MOV)]-BASE_CYCLES[static_cast<u8>(OpCode::CALL)]-3
		&& machine.cpu.instructionBudgetRemaining==run.state.remainingCycles,
		"interrupt stop publishes one exact CALL/primitive/result debit, never an unexecuted replay");
	machine.cpu.runUntilDepth(0,1);
	require((machine.cpu.readCauseWord()&(nmi?CPU_CAUSE_NMI:CPU_CAUSE_IRQ))!=0
		&& machine.cpu.readEpcWord()==caller->terminal.nextPc && frame->registers.get(8)==valueInteger(-8),
		"the real CPU owner next admits the pending interrupt at CALL's successor PC");
}

void unboundStandaloneStillReturnsCall() {
	const auto rom = image(2, 3); Machine machine(rom, false); machine.seed(BuiltinFunctionId::StringByte);
	std::array<DecodedInstruction, 3> decoded{}; std::array<NativeBlockInstruction, 3> source{};
	const std::array ops{OpCode::MOV, OpCode::CALL, OpCode::HALT};
	for (size_t i=0;i<ops.size();++i) { decoded[i].op=static_cast<u8>(ops[i]); decoded[i].width=1;
		decoded[i].baseCycles=BASE_CYCLES[decoded[i].op]; source[i]={&decoded[i],rom.textAddress+static_cast<u32>(i)*INSTRUCTION_BYTES}; }
	decoded[0].a=0; decoded[0].b=12; decoded[1].a=0; decoded[1].b=3; decoded[1].c=2;
	const std::array plans{NativeBlockSource{std::span(source.data(),2)}, NativeBlockSource{std::span(source.data()+2,1)}};
	auto blocks=NativeCompiler::compile(plans,NativeCodeBindings(machine.memory,machine.cpu.stringPool()));
	auto* frame=machine.cpu.rootThread()->currentFrame;
	NativeBlockRunState state{.remainingCycles=64,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
	require(blocks.front()->run(frame->registers, state)==&blocks.front()->terminal && state.remainingCycles==64-BASE_CYCLES[static_cast<u8>(OpCode::MOV)]-BASE_CYCLES[static_cast<u8>(OpCode::CALL)],
		"default standalone bindings do not acquire a CPU or execute builtin CALLs");
}
#endif

void grantsAndRestore() {
	for (const bool wide : {false,true}) for (const int results : {0,1,2}) for (int grant=0;grant<=24;++grant) {
		const auto rom=image(results,3,wide); Machine native(rom,false),scalar(rom,true);
		native.seed(BuiltinFunctionId::StringByte);scalar.seed(BuiltinFunctionId::StringByte);
		test::runCpuParity(native.cpu,scalar.cpu,grant);parity(native,scalar);
		const auto n=native.cpu.captureRuntimeState(),s=scalar.cpu.captureRuntimeState();
		native.cpu.restoreRuntimeState(n);scalar.cpu.restoreRuntimeState(s);
		test::runCpuParity(native.cpu,scalar.cpu,64);parity(native,scalar);
		require(native.cpu.readCauseWord()==0 && native.cpu.isHaltedUntilIrq(),"every split grant and restored frontier completes the original builtin/successor");
	}
	for (const bool wide : {false,true}) for (const auto [mode, position] :
		{std::pair{2, 3.f}, std::pair{3, 3.f}, std::pair{0, std::numeric_limits<float>::infinity()}, std::pair{0, std::numeric_limits<float>::quiet_NaN()}}) {
		const auto rom=image(2,3,wide);Machine native(rom,false),scalar(rom,true);
		native.seed(BuiltinFunctionId::StringByte,mode,position);scalar.seed(BuiltinFunctionId::StringByte,mode,position);
		test::runCpuParity(native.cpu,scalar.cpu,15);parity(native,scalar);
		require(native.cpu.readLuaFaultReasonWord()==LUA_FAULT_REASON_INVALID_ARGUMENT
			&& native.cpu.readEpcWord()==rom.textAddress+4*INSTRUCTION_BYTES,
			"declined bad raw arguments fault at the original narrow/WIDE CALL, before its result or successor");
		require(native.cpu.rootThread()->firstFrame->registers.get(8)==valueInteger(-8),"a fault never commits the CALL successor");
	}
}
} // namespace

int main() {
	try {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		for (const auto id : {BuiltinFunctionId::StringByte,BuiltinFunctionId::GetMetatable})
		for (const int results : {0,1,2}) rawContinuity(id,results);
		rawSetMetatableReturnsUnexecutedCall();
		rawContinuity(BuiltinFunctionId::ToInteger,2);
		rawContinuity(BuiltinFunctionId::ToInteger,2,0,2.9f);
		rawContinuity(BuiltinFunctionId::StringByte,2,1);
		rawContinuity(BuiltinFunctionId::StringByte,2,0,3,true);
		for (const float p : {0.0f,-1.0f,2.0f,2.9f,2147483520.0f,0x1p32f}) rawContinuity(BuiltinFunctionId::StringByte,2,0,p);
		rawDeclines();completedDebtDoesNotRunTheSuccessor();mutableCalleesUseTheirCurrentIdentity();unboundStandaloneStillReturnsCall();
		for(const bool nmi:{false,true})for(const bool wide:{false,true})inlineInterruptStop(nmi,wide);
#endif
		recordObserversReadPendingFrameWords();
		recordObserversReadTheCallFrameControl();
		grantsAndRestore();
		std::cout<<"Native builtin continuity tests passed\n";return 0;
	} catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
