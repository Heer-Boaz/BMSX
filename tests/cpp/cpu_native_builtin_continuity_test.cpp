#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/io.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_execution.h"
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
	Table* target = nullptr;
	Table* meta = nullptr;
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
			target = cpu.createTable(); meta = cpu.createTable(); target->setMetatable(meta);
			r.set(13, mode == 3 ? valueInteger(17) : valueTable(cpu.gcHeap().reference(target)));
			r.set(14, mode == 1 ? valueNil() : mode == 2 ? valueBool(false) : valueTable(cpu.gcHeap().reference(meta)));
			expected = id == BuiltinFunctionId::GetMetatable ? valueTable(cpu.gcHeap().reference(meta)) : valueTable(cpu.gcHeap().reference(target));
		}
	}
	void selectClosure() {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[1], rom.textAddress + MAPPED_PAGE_BYTE_SIZE);
		const Value closure = valueClosure(cpu.gcHeap().reference(cpu.rootThread()->currentFrame->closure));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
		cpu.rootThread()->currentFrame->registers.set(12, closure);
	}
};

void parity(Machine& a, Machine& b) {
	const auto x = a.cpu.captureRuntimeState(), y = b.cpu.captureRuntimeState();
	require(std::ranges::equal(x.snapshot.words(), y.snapshot.words())
		&& std::ranges::equal(x.snapshot.objectWords(), y.snapshot.objectWords())
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

void rawContinuity(BuiltinFunctionId id, int results, int mode = 0, float position = 3, bool missing = false) {
	const int arguments = id == BuiltinFunctionId::GetMetatable || id == BuiltinFunctionId::ToInteger || missing ? 2 : 3;
	const auto rom = image(results, arguments); Machine machine(rom, false); machine.seed(id, mode, position);
	if (missing) machine.expected = valueInteger(65);
	auto* frame = machine.cpu.rootThread()->currentFrame;
	auto* caller = preparedCaller(machine);
	machine.cpu.instructionBudgetRemaining = 12345;
	NativeBlockRunState state{.registers=frame->registers, .constants=frame->executionImage->constPool.view(), .frame=frame,
		.constantCount=static_cast<u32>(frame->executionImage->constPool.capacity()), .remainingCycles=64, .registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
	const auto* exit = caller->run(state);
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
	require(machine.cpu.instructionBudgetRemaining == 12345 && frame->readControl(bmsx::FrameField::Pc) == rom.textAddress && static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top)) == 3,
		"the base native ABI updates its own state, never hidden CPU/frame copies behind live native registers");
	if (id == BuiltinFunctionId::SetMetatable) require(machine.target->metatable() == (mode == 1 ? nullptr : machine.meta),
		"the inline route performs the real table mutation");
}

void rawDeclines() {
	for (const int variant : {0, 1, 2, 3, 4}) {
		const int results = variant == 0 ? 3 : 2;
		const auto rom = image(results, variant == 4 ? 0 : 3); Machine machine(rom, false); machine.seed(variant == 1 ? BuiltinFunctionId::Type : BuiltinFunctionId::StringByte, variant == 2 ? 3 : 0);
		if (variant == 3) machine.selectClosure();
		auto* frame = machine.cpu.rootThread()->currentFrame;
		NativeBlockRunState state{.registers=frame->registers, .constants=frame->executionImage->constPool.view(), .frame=frame,
			.constantCount=static_cast<u32>(frame->executionImage->constPool.capacity()), .remainingCycles=64, .registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
		const auto* exit = preparedCaller(machine)->run(state);
		require(exit->exit == NativeBlockExit::Call && state.remainingCycles == 64 - 4 * BASE_CYCLES[static_cast<u8>(OpCode::MOV)] - BASE_CYCLES[static_cast<u8>(OpCode::CALL)],
			"padding, unsupported primitive, bad arguments and a real Closure preserve the ordinary unexecuted CALL boundary");
		require(frame->registers.get(0) == frame->registers.get(12) && frame->registers.get(1) == frame->registers.get(13)
			&& frame->registers.get(2) == frame->registers.get(14) && frame->registers.get(8) == valueInteger(-8),
			"a declined inline call publishes the exact dirty prefix without a result or successor");
	}
}

void completedDebtDoesNotRunTheSuccessor() {
	for (const int results : {0,1,2}) {
		const auto rom=image(results,3);Machine machine(rom,false);machine.seed(BuiltinFunctionId::SetMetatable,1);
		auto* frame=machine.cpu.rootThread()->currentFrame;
		const int prefix=4*BASE_CYCLES[static_cast<u8>(OpCode::MOV)]+BASE_CYCLES[static_cast<u8>(OpCode::CALL)];
		NativeBlockRunState state{.registers=frame->registers,.constants=frame->executionImage->constPool.view(),.frame=frame,
			.constantCount=static_cast<u32>(frame->executionImage->constPool.capacity()),.remainingCycles=prefix,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
		const auto* caller=preparedCaller(machine);const auto* exit=caller->run(state);const int receiving=results==1?0:1;
		require(exit->exit!=NativeBlockExit::Call && exit->cycles==0 && exit->nextPc==caller->terminal.nextPc,
			"an exhausting successful leaf returns its completed successor frontier, never the original CALL");
		require(state.remainingCycles==-2-receiving && state.registerTop==receiving && machine.target->metatable()==nullptr,
			"the complete primitive/result charge and real mutation commit even when CALL exhausted the grant");
		require(frame->registers.get(8)==valueInteger(-8) && frame->registers.get(9)==valueInteger(-9),
			"no successor executes after the completed CALL debt");
		if(receiving) require(frame->registers.get(0)==valueTable(machine.cpu.gcHeap().reference(machine.target)),"completed debt publishes the raw aliased result");
	}
}

void mutableCalleesUseTheirCurrentIdentity() {
	const auto rom=image(2,3);Machine machine(rom,false);auto* caller=preparedCaller(machine);
	for(const auto id:{BuiltinFunctionId::StringByte,BuiltinFunctionId::GetMetatable,BuiltinFunctionId::SetMetatable,BuiltinFunctionId::Type}) {
		machine.seed(id);auto* frame=machine.cpu.rootThread()->currentFrame;
		NativeBlockRunState state{.registers=frame->registers,.constants=frame->executionImage->constPool.view(),.frame=frame,
			.constantCount=static_cast<u32>(frame->executionImage->constPool.capacity()),.remainingCycles=64,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
		const auto* exit=caller->run(state);
		if(id==BuiltinFunctionId::Type) require(exit->exit==NativeBlockExit::Call,"a reused callsite does not retain an earlier supported builtin ID");
		else require(exit->exit==NativeBlockExit::Halt && frame->registers.get(8)==machine.expected,"one published callsite observes each actual supported primitive ID");
	}
	machine.seed(BuiltinFunctionId::StringByte);machine.selectClosure();auto* frame=machine.cpu.rootThread()->currentFrame;
	NativeBlockRunState state{.registers=frame->registers,.constants=frame->executionImage->constPool.view(),.frame=frame,
		.constantCount=static_cast<u32>(frame->executionImage->constPool.capacity()),.remainingCycles=64,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
	require(caller->run(state)->exit==NativeBlockExit::Call && valueIsClosure(frame->registers.get(0)),
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
	NativeCpuRunState run{.state={.registers=frame->registers,.constants=owner->constPool.view(),.frame=frame,
		.constantCount=static_cast<u32>(owner->constPool.capacity()),.remainingCycles=64,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top)),.exitCode=gate.dispatch,.ram=machine.memory.ramData()},
		.cpu=&machine.cpu,.targetDepth=0,.codeRoot=owner->nativeCodeLookup->root(0),.systemRom=&machine.memory.systemRomStorage(),
		.cartridgeRom=machine.memory.cartridgeController().romStorage(0),.cartridgeSlot=0,.error={}};
	// The typed gate is an already-admitted native segment, not a fresh outer
	// CPU IRQ admission. Its successful CALL must stop at the next instruction.
	if(nmi) machine.cpu.requestNonMaskableInterrupt();else machine.irq.raise(1);
	using Entry=void(SLJIT_FUNC *)(NativeCpuRunState*,void*);
	reinterpret_cast<Entry>(gate.entry)(&run,page->nativeCode[(rom.textAddress&MAPPED_PAGE_BYTE_MASK)/INSTRUCTION_BYTES]);
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
	auto blocks=NativeBlock::compileRegion(plans,{},NativeCodeBindings(machine.memory,machine.cpu.stringPool(),machine.cpu.stringPool().intern("__index")));
	size_t bytes=0; blocks.front()->region->publish(bytes);
	auto* frame=machine.cpu.rootThread()->currentFrame;
	NativeBlockRunState state{.registers=frame->registers,.remainingCycles=64,.registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top))};
	require(blocks.front()->run(state)==&blocks.front()->terminal && state.remainingCycles==64-BASE_CYCLES[static_cast<u8>(OpCode::MOV)]-BASE_CYCLES[static_cast<u8>(OpCode::CALL)],
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
		for (const auto id : {BuiltinFunctionId::StringByte,BuiltinFunctionId::GetMetatable,BuiltinFunctionId::SetMetatable})
		for (const int results : {0,1,2}) rawContinuity(id,results);
		rawContinuity(BuiltinFunctionId::SetMetatable,2,1);
		rawContinuity(BuiltinFunctionId::ToInteger,2);
		rawContinuity(BuiltinFunctionId::ToInteger,2,0,2.9f);
		rawContinuity(BuiltinFunctionId::StringByte,2,1);
		rawContinuity(BuiltinFunctionId::StringByte,2,0,3,true);
		for (const float p : {0.0f,-1.0f,2.0f,2.9f,2147483520.0f,0x1p32f}) rawContinuity(BuiltinFunctionId::StringByte,2,0,p);
		rawDeclines();completedDebtDoesNotRunTheSuccessor();mutableCalleesUseTheirCurrentIdentity();unboundStandaloneStillReturnsCall();
		for(const bool nmi:{false,true})for(const bool wide:{false,true})inlineInterruptStop(nmi,wide);
#endif
		grantsAndRestore();
		std::cout<<"Native builtin continuity tests passed\n";return 0;
	} catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
