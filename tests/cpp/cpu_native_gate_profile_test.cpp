#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/closure_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"

#include <algorithm>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
template<class T> concept HasGateProfile = requires(const T& cpu) { cpu.nativeGateProfile(); };
#if defined(BMSX_NATIVE_GATE_PROFILE)
static_assert(HasGateProfile<CPU>);
#else
static_assert(!HasGateProfile<CPU>);
#endif

test::Blua32TestRom image(OpCode op, int b = 0, int c = 0, bool loop = false) {
	test::Blua32TestImage source;
	source.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(source.text, 0, static_cast<u8>(op), 0, b, c);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	if (loop) {
		writeInstruction(source.text, 0, static_cast<u8>(OpCode::MOV), 0, 12, 0);
		writeInstruction(source.text, 1, static_cast<u8>(OpCode::CALL), 0, 1, 2);
		writeInstruction(source.text, 2, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
		writeInstruction(source.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	}
	writeInstruction(source.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(source.text, DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(source.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	source.functions = {{.firstWord=0, .wordCount=loop ? 4u : 2u, .maxStack=16},
		{.firstWord=1, .wordCount=1, .maxStack=16},
		{.firstWord=DECODED_PAGE_WORDS, .wordCount=2, .maxStack=2},
		{.firstWord=2 * DECODED_PAGE_WORDS, .wordCount=1, .maxStack=2}};
	if (op == OpCode::ADD) {
		// Keep two instructions in the first admitted prefix. A single ADD
		// can execute natively on its own and never needs ScalarBoundary.
		writeInstruction(source.text, 1, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(source.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		source.functions[0].wordCount = 3;
		source.functions[1].firstWord = 2;
	}
	source.exceptionFunctionIndex = source.irqFunctionIndex = 3;
	source.globalNames = {"marker"};
	return test::encodeBlua32TestRom(RomImageDomain::System, source);
}

struct Machine {
	const test::Blua32TestRom& rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	int observed = 0;
	Machine(const test::Blua32TestRom& r, bool scalar, bool observeNext = false) : rom(r),
		memory(MemoryInit{r.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		test::seedManagedFixture(cpu, addresses);
		if (observeNext) {
			InstructionObserverBinding observer;
			observer.points[0].insert(r.textAddress + INSTRUCTION_BYTES);
			observer.context = &observed;
			observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) { ++*static_cast<int*>(context); };
			cpu.setInstructionObserver(std::move(observer));
		}
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
	void builtin(bool invalid = false) {
		auto& frame = *cpu.rootThread()->currentFrame;
		frame.registers.set(0, cpu.createBuiltinFunction(BuiltinFunctionId::StringByte));
		frame.registers.set(1, invalid ? valueInteger(17) : valueString(cpu.stringPool().intern("Az")));
		frame.registers.set(2, valueInteger(2));
		frame.writeControl(bmsx::FrameField::Top, 3);
	}
	void closure() {
		const auto closure = test::seedTestCapturedClosure(cpu, rom.functionAddresses[2], {});
		cpu.rootThread()->currentFrame->registers.set(12, valueClosure(closure));
	}
};

void parity(Machine& generated, Machine& scalar, int grant) {
	test::runCpuParity(generated.cpu, scalar.cpu, grant);
	const auto a = generated.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require((a == b && bmsx::test::sameLanguageRam(generated.cpu, scalar.cpu))
		&& a.causeWord == b.causeWord && a.epcWord == b.epcWord && a.lastPc == b.lastPc
		&& a.hardHalted == b.hardHalted, "profiling preserves the actual scalar guest graph and fault state");
	require(generated.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc(), "profiling preserves the real instruction frontier");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& profile = generated.cpu.nativeGateProfile();
	for (const auto& row : profile.exits) {
		require(row.entries == row.resumes + row.returns && row.exceptions <= row.returns,
			"every actual C++ dispatch has one outcome, including exception/null paths");
	}
	require(profile.builtinAttempts == profile.builtinDeclines + profile.builtinResumes + profile.builtinStops,
		"every materialized builtin attempt has exactly one outcome");
	for (const auto& row : scalar.cpu.nativeGateProfile().exits) require(row.entries == 0, "scalar execution is not a native C++ gate");
	require(scalar.cpu.nativeGateProfile().builtinAttempts == 0, "scalar builtins are not materialized native calls");
#endif
}

#if defined(BMSX_NATIVE_GATE_PROFILE)
const NativeGateExitProfile& row(const Machine& m, NativeBlockExit kind) {
	return m.cpu.nativeGateProfile().exits[static_cast<size_t>(kind)];
}
#endif

void simpleExits() {
	for (auto operation : {OpCode::HALT, OpCode::ADD, OpCode::LOADKR}) {
		const auto rom = image(operation, operation == OpCode::LOADKR ? 1 : 0);
		Machine generated(rom, false), scalar(rom, true);
		for (auto* m : {&generated, &scalar}) {
			m->cpu.rootThread()->currentFrame->registers.set(0, valueInteger(3));
			m->cpu.rootThread()->currentFrame->registers.set(1, valueInteger(100000));
		}
		parity(generated, scalar, operation == OpCode::ADD ? 1 : 100);
#if defined(BMSX_NATIVE_GATE_PROFILE)
		if (operation == OpCode::HALT) require(row(generated, NativeBlockExit::Halt).entries == 1
			&& row(generated, NativeBlockExit::Halt).returns == 1, "real HALT returns from dispatch once");
		if (operation == OpCode::ADD) require(row(generated, NativeBlockExit::ScalarBoundary).entries == 1
			&& row(generated, NativeBlockExit::ScalarBoundary).returns == 1
			&& generated.cpu.readFrameRegister(0, 0) == valueInteger(6), "early scalar admission is counted and executes the opcode only once");
		if (operation == OpCode::LOADKR) require(row(generated, NativeBlockExit::InvalidConstant).entries == 1
			&& row(generated, NativeBlockExit::InvalidConstant).exceptions == 1
			&& row(generated, NativeBlockExit::InvalidConstant).returns == 1, "a thrown dispatch exception is a counted null outcome");
#endif
	}

}

void builtinPaths() {
	for (int arguments : {0, 3}) for (bool invalid : {false, true}) for (int grant : {6, 100}) {
		const auto rom = image(OpCode::CALL, arguments, 2);
		Machine generated(rom, false), scalar(rom, true);
		generated.builtin(invalid); scalar.builtin(invalid);
		parity(generated, scalar, grant);
#if defined(BMSX_NATIVE_GATE_PROFILE)
		const auto& p = generated.cpu.nativeGateProfile();
		if (arguments == 3 && !invalid) {
			require(p.builtinAttempts == 0 && row(generated, NativeBlockExit::Call).entries == 0,
				"same-frame inline leaf calls are not materialized C++ gates");
		} else {
			require(p.builtinAttempts == 1, "the shared CALL gate makes one actual leaf attempt");
			if (invalid) require(p.builtinDeclines == 1 && row(generated, NativeBlockExit::Call).entries == 1
				&& row(generated, NativeBlockExit::Call).exceptions == 1,
				"decline then dispatchCall is one handled exit but two raw C++ entries");
			else require(grant == 6 ? p.builtinStops == 1 : p.builtinResumes == 1,
				"materialized builtin completion distinguishes exhausted versus resumable grants");
		}
#endif
	}
	const auto rom = image(OpCode::CALL, 2, 2);
	Machine generated(rom, false), scalar(rom, true);
	for (auto* machine : {&generated, &scalar}) {
		auto& frame = *machine->cpu.rootThread()->currentFrame;
		frame.registers.set(0, machine->cpu.createBuiltinFunction(BuiltinFunctionId::Type));
		frame.registers.set(1, valueInteger(17));
		frame.writeControl(bmsx::FrameField::Top, 2);
	}
	parity(generated, scalar, 100);
	require(generated.cpu.rootThread()->currentFrame->registers.get(0) == valueString(generated.cpu.stringPool().intern("number")),
		"the full type builtin publishes the guest result");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(generated.cpu.nativeGateProfile().builtinAttempts == 0 && row(generated, NativeBlockExit::Call).entries == 1,
		"a nonleaf builtin enters its semantic handler without a rejected leaf call");
#endif
}

void warmClosureAndSnapshot() {
	const auto rom = image(OpCode::MOV, 0, 0, true);
	Machine generated(rom, false), scalar(rom, true);
	generated.closure(); scalar.closure();
	const int loopCycles = BASE_CYCLES[static_cast<size_t>(OpCode::MOV)] + BASE_CYCLES[static_cast<size_t>(OpCode::CALL)]
		+ BASE_CYCLES[static_cast<size_t>(OpCode::K1)] + BASE_CYCLES[static_cast<size_t>(OpCode::RET)]
		+ BASE_CYCLES[static_cast<size_t>(OpCode::SETGL)] + BASE_CYCLES[static_cast<size_t>(OpCode::JMP)]
		+ 1; // RET B2 places its one real result into CALL C2.
	parity(generated, scalar, loopCycles);
	require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.readFramePc(0) == rom.textAddress,
		"the first full loop grant includes exactly one return-value placement");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto before = generated.cpu.nativeGateProfile();
#endif
	parity(generated, scalar, loopCycles);
	require(generated.cpu.readFramePc(0) == rom.textAddress && generated.cpu.getGlobalByKey(generated.cpu.stringPool().intern("marker")) == valueInteger(1),
		"the actual second closure iteration reaches its guest marker and loop boundary");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& after = generated.cpu.nativeGateProfile();
	for (auto kind : {NativeBlockExit::Call, NativeBlockExit::Return}) {
		const auto index = static_cast<size_t>(kind);
		require(after.exits[index].entries == before.exits[index].entries, "warm native-only CALL/RET do not enter C++ dispatch");
	}
	require(after.builtinAttempts == before.builtinAttempts, "closure gates do not attempt builtin leaves");
	const auto snapshot = generated.cpu.captureRuntimeState();
	const auto counts = generated.cpu.nativeGateProfile();
	generated.cpu.restoreRuntimeState(snapshot);
	for (size_t k = 0; k < counts.exits.size(); ++k) require(generated.cpu.nativeGateProfile().exits[k].entries == counts.exits[k].entries,
		"capture/restore does not rewind or synthesize diagnostic lifetime events");
#endif
}
} // namespace
int main() {
	try { simpleExits(); builtinPaths(); warmClosureAndSnapshot(); }
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
