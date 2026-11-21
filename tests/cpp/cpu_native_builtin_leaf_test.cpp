#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "spec/blua32/memory_access_kind.h"
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
constexpr u32 MARKER_ADDRESS = DYNAMIC_RAM_BASE + 0x4000u;

test::Blua32TestRom image(int results, int args, bool wide = false) {
	test::Blua32TestImage source; source.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::MOV), 7, 12, 0);
	u32 word = 1;
	if (wide) writeInstruction(source.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(source.text, word++, static_cast<u8>(OpCode::CALL), 0, args, results);
	writeInstruction(source.text, word, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(source.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::STORE_MEM), 7, 11, static_cast<u8>(MemoryAccessKind::Word));
	writeInstruction(source.text, DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(source.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	source.functions = {{.firstWord=0, .wordCount=word+1, .maxStack=16},
		{.firstWord=word, .wordCount=1, .maxStack=16},
		{.firstWord=DECODED_PAGE_WORDS, .wordCount=2, .maxStack=16},
		{.firstWord=2 * DECODED_PAGE_WORDS, .wordCount=1, .maxStack=16}};
	source.exceptionFunctionIndex = source.irqFunctionIndex = 3;
	source.globalNames = {"rawLeafMarker", "target"};
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, source, MARKER_ADDRESS - DYNAMIC_RAM_BASE + sizeof(u32));
	rom.bytes.resize((rom.bytes.size() + MAPPED_PAGE_BYTE_MASK) & ~size_t{MAPPED_PAGE_BYTE_MASK});
	return rom;
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
	int observedSuccessors = 0;
	Machine(const test::Blua32TestRom& r, bool scalar, bool observeSuccessor = false) : rom(r), memory(MemoryInit{r.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (observeSuccessor) {
			InstructionObserverBinding observer;
			observer.points[0].insert(r.textAddress + 2 * INSTRUCTION_BYTES);
			observer.context = &observedSuccessors;
			observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) { ++*static_cast<int*>(context); };
			cpu.setInstructionObserver(std::move(observer));
		}
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
	void seed(BuiltinFunctionId id, int mode = 0, float position = 3) {
		auto* frame = cpu.rootThread()->currentFrame; auto r = frame->registers;
		r.set(0, cpu.createBuiltinFunction(id));
		require(asBuiltinFunctionId(r.get(0)) == id, "the actual runtime callee carries its raw builtin ID");
		r.set(12, valueFloat(99.75f)); r.set(11, valueInteger(MARKER_ADDRESS)); frame->writeControl(bmsx::FrameField::Top, 3);
		if (id == BuiltinFunctionId::StringByte) {
			r.set(1, mode == 2 ? valueInteger(17) : valueString(cpu.stringPool().intern(std::string("A\xc3\xa9\xf0\x9f\x98\x80\0Z", 9))));
			r.set(2, mode == 1 ? valueNil() : mode == 3 ? valueBool(false) : valueFloat(position));
			expected = mode == 1 ? valueInteger(65) : position == 3 ? valueInteger(169) : position == 2 ? valueInteger(195) : valueNil();
		} else {
			target = cpu.createTable(0, 1); meta = cpu.createTable(0, 1);
			meta->setStringKey(cpu.stringPool().intern("field"), valueInteger(71));
			target->setMetatableAddress(meta->address());
			cpu.setGlobalByKey(cpu.stringPool().intern("target"), valueTable(target->address()));
			r.set(1, mode == 3 ? valueInteger(17) : valueTable(target->address()));
			r.set(2, mode == 1 ? valueNil() : mode == 2 ? valueBool(false) : valueTable(meta->address()));
			expected = id == BuiltinFunctionId::GetMetatable ? valueTable(meta->address()) : valueTable(target->address());
		}
	}
	u32 marker() { return memory.readMappedU32LE(MARKER_ADDRESS); }
};

void parity(Machine& a, Machine& b) {
	const auto x = a.cpu.captureRuntimeState(), y = b.cpu.captureRuntimeState();
	require((x == y && bmsx::test::sameLanguageRam(a.cpu, b.cpu))
		&& x.causeWord == y.causeWord && x.epcWord == y.epcWord && x.lastPc == y.lastPc && x.hardHalted == y.hardHalted,
		"ordinary native/scalar execution preserves the guest graph and exception state");
	require(a.cpu.readCurrentInstructionPc() == b.cpu.readCurrentInstructionPc() && a.cpu.instructionBudgetRemaining == b.cpu.instructionBudgetRemaining,
		"current PC and consumed grant agree, independently of checkpoint metadata");
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void directGate(BuiltinFunctionId id, int results, int grant, bool cold = false, int mode = 0, bool interrupt = false) {
	const auto rom = image(results, id == BuiltinFunctionId::GetMetatable ? 2 : 3);
	// A real observed successor is not an internal native entry. This retains
	// the shared materialized gate contract, independently of inline leaf calls.
	Machine machine(rom, false, true); machine.seed(id, mode);
	auto* frame = machine.cpu.rootThread()->currentFrame;
	require(frame->next == nullptr, "the first builtin has no spare activation node");
	auto* owner = frame->executionImage; auto* page = owner->nativeCodeLookup->find(frame->readControl(bmsx::FrameField::Pc), 0);
	require(page && page->nativeBlocks, "preparation publishes the real caller");
	const u32 word = (frame->readControl(bmsx::FrameField::Pc) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	auto* caller = page->nativeBlocks->entries[word].get();
	require(caller && caller->terminal.exit == NativeBlockExit::Call, "the real compiled caller ends at CALL");
	auto* markerPage = owner->nativeCodeLookup->find(rom.textAddress + MAPPED_PAGE_BYTE_SIZE, 0);
	const auto markerWord = ((rom.textAddress + MAPPED_PAGE_BYTE_SIZE) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(markerPage && markerPage->nativeCode[markerWord], "the raw marker body is independently published");
	void* marker = cold ? nullptr : markerPage->nativeCode[markerWord];
	caller->terminal.continuationCells[0] = &marker;
	const auto& gate = nativeBlockGate();
	NativeCpuRunState run{.state={.constants=owner->constPool, .frame=frame, .heap=&machine.cpu.gcHeap(),
		.constantCount=static_cast<u32>(owner->constPool.size()), .remainingCycles=grant, .registerTop=static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top)), .exitCode=gate.dispatch,
		.ram=machine.memory.ramData(),
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		.diagnosticOpcodes={},
#endif
		}, .cpu=&machine.cpu, .targetDepth=0, .codeRoot=owner->nativeCodeLookup->root(0),
		.cartridgeSlot=0, .error={}};
	// The typed gate models an already admitted segment, not outer-loop IRQ admission.
	if (interrupt) machine.cpu.requestNonMaskableInterrupt();
	reinterpret_cast<NativeBlockGate::Entry>(gate.entry)(&run.state, page->nativeCode[word], &frame->registers);
	if (run.error) std::rethrow_exception(run.error);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	require(run.state.diagnosticOpcodes.call == 1, "the admitted native CALL is counted once");
#endif
	const int receiving = results == 1 ? 0 : 1;
	if (!cold && !interrupt && grant == 64 && id != BuiltinFunctionId::Type) {
		require(machine.marker() == 99, "one real native gate follows the builtin raw continuation, not C++ CALL redispatch");
		require(machine.cpu.instructionBudgetRemaining == 64 - 2 - 32 - 2 - receiving - 3 - 2,
			"prefix, CALL, primitive, receiving slots and marker are each charged once");
	} else if (id == BuiltinFunctionId::Type) {
		require(machine.marker() == 0, "Type remains on its allocating ordinary CALL path");
		return;
	} else {
		require(machine.marker() == 0 && frame->readControl(bmsx::FrameField::Pc) == rom.textAddress + 2 * INSTRUCTION_BYTES,
			"cold or exhausted completion commits the successor without executing it");
		require(run.state.remainingCycles == grant - 2 - 32 - 2 - receiving
			&& machine.cpu.instructionBudgetRemaining == run.state.remainingCycles, "both budget owners retain the complete CALL debit");
		require(static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top)) == receiving
			&& (!receiving || frame->registers.get(0) == machine.expected), "a cold/debt/interrupt exit exposes the completed result before any resume");
		if (interrupt) require(machine.cpu.captureRuntimeState().nonMaskableInterruptPending, "post-CALL stop retains the pending interrupt for its real owner");
		else machine.cpu.runUntilDepth(0, 1);
		if (!interrupt) require(machine.cpu.readCauseWord() == 0 && machine.cpu.isHaltedUntilIrq()
			&& machine.observedSuccessors == 1, "resuming the ordinary successor observes it once and never replays the already committed CALL");
	}
	if (id == BuiltinFunctionId::SetMetatable && mode == 1) require(machine.target->metatableAddress() == 0u, "discard and receiving forms still perform the real metatable removal");
	require(frame->registers.get(7) == valueFloat(99.75f), "the cached numeric prefix survives the returning helper ABI");
	require(static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top)) == receiving && machine.cpu.getFrameDepth() == 1 && frame->next == nullptr, "builtin completion owns exact top without a child frame");
	if (receiving) require(frame->registers.get(0) == machine.expected, "the raw native result equals the primitive contract");
}
#endif

void ordinaryCases() {
	for (const auto id : {BuiltinFunctionId::StringByte, BuiltinFunctionId::GetMetatable, BuiltinFunctionId::SetMetatable})
	for (const int results : {0, 1, 2, 3}) for (const bool wide : {false, true}) {
		const auto rom = image(results, id == BuiltinFunctionId::GetMetatable ? 2 : 3, wide);
		Machine native(rom, false), scalar(rom, true); native.seed(id); scalar.seed(id);
		for (const int grant : {0, 1, 2, 1, 3, 4, 16}) { test::runCpuParity(native.cpu, scalar.cpu, grant); parity(native, scalar); }
		require(native.cpu.readCauseWord() == 0 && native.cpu.isHaltedUntilIrq(), "the ordinary route completes the actual builtin exactly once");
		const int receiving = results == 0 ? 1 : results - 1;
		require(static_cast<bmsx::i32>(native.cpu.rootThread()->currentFrame->readControl(bmsx::FrameField::Top)) == receiving, "open, discard, fixed and padded receiving counts retain exact top");
		if (receiving) require(native.cpu.readFrameRegister(0, 0) == native.expected, "ordinary raw builtin result is exact");
		if (id == BuiltinFunctionId::SetMetatable) {
			native.target->setStringKey(native.cpu.stringPool().intern("local"), valueInteger(9));
			scalar.target->setStringKey(scalar.cpu.stringPool().intern("local"), valueInteger(9)); parity(native, scalar);
		}
		if (receiving > 1) require(isNil(native.cpu.readFrameRegister(0, 1)), "unsupported result counts keep ordinary nil padding");
		native.cpu.collectHeap(); scalar.cpu.collectHeap(); parity(native, scalar);
		native.cpu.restoreRuntimeState(native.cpu.captureRuntimeState()); scalar.cpu.restoreRuntimeState(scalar.cpu.captureRuntimeState()); parity(native, scalar);
	}
	for (const int args : {0, 2, 3}) {
		const auto rom = image(2, args); Machine native(rom, false), scalar(rom, true);
		native.seed(BuiltinFunctionId::StringByte, 1); scalar.seed(BuiltinFunctionId::StringByte, 1);
		if (args == 0) { native.cpu.rootThread()->currentFrame->writeControl(bmsx::FrameField::Top, 2); scalar.cpu.rootThread()->currentFrame->writeControl(bmsx::FrameField::Top, 2); }
		test::runCpuParity(native.cpu, scalar.cpu, 32); parity(native, scalar);
		require(native.cpu.readFrameRegister(0, 0) == valueInteger(65), "missing, explicit nil and open arguments preserve StringByte default position");
	}
	for (const float position : {0.0f, -1.0f, 2.0f, 2.9f, 0x1p32f, std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN()}) {
		const auto rom = image(2, 3); Machine native(rom, false), scalar(rom, true); native.seed(BuiltinFunctionId::StringByte, 0, position); scalar.seed(BuiltinFunctionId::StringByte, 0, position);
		test::runCpuParity(native.cpu, scalar.cpu, 32); parity(native, scalar);
		if (position == 2.9f)
			require(native.cpu.readCauseWord() == 0 && native.cpu.readFrameRegister(0, 0) == valueInteger(195), "StringByte truncates a finite fractional word position before indexing");
		else if (position == 0 || position == -1 || position == 2 || position == 0x1p32f)
			require(native.cpu.readFrameRegister(0, 0) == native.expected && native.cpu.readCauseWord() == 0, "word position selects the byte or nil after wrapping");
		else
			require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT,
				"nonfinite Float positions fault through the ordinary builtin");
	}
	for (const auto id : {BuiltinFunctionId::StringByte, BuiltinFunctionId::GetMetatable, BuiltinFunctionId::SetMetatable}) for (const bool wide : {false, true}) {
		const auto rom = image(2, 3, wide); Machine native(rom, false), scalar(rom, true);
		const int bad = id == BuiltinFunctionId::StringByte ? 3 : id == BuiltinFunctionId::GetMetatable ? 3 : 2;
		native.seed(id, bad); scalar.seed(id, bad);
		test::runCpuParity(native.cpu, scalar.cpu, 3); parity(native, scalar);
		require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT && native.cpu.readEpcWord() == rom.textAddress + INSTRUCTION_BYTES,
			"unsupported argument shapes use the existing error owner at the original WIDE instruction PC");
		require(native.cpu.instructionBudgetRemaining == -33, "argument errors pay prefix2+CALL32+primitive2 but no receiving-slot fee");
		if (id == BuiltinFunctionId::SetMetatable) require(native.target->metatableAddress() == native.meta->address(), "invalid metatable validation has no partial mutation");
	}
}
} // namespace

int main() {
	try {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		for (const auto id : {BuiltinFunctionId::StringByte, BuiltinFunctionId::GetMetatable, BuiltinFunctionId::SetMetatable}) for (int results : {0, 1, 2}) {
			directGate(id, results, 64); directGate(id, results, 9); directGate(id, results, 64, true);
		}
		directGate(BuiltinFunctionId::Type, 2, 64);
#endif
		#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		for (int results : {0, 1, 2}) directGate(BuiltinFunctionId::SetMetatable, results, 64, false, 1);
		directGate(BuiltinFunctionId::StringByte, 2, 64, false, 1);
		directGate(BuiltinFunctionId::StringByte, 2, 64, false, 0, true);
#endif
		ordinaryCases();
		std::cout << "Native builtin leaf tests passed\n";
		return 0;
	} catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
