#include "machine/cpu/value_arithmetic.h"
#include "support/number32_cpu_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
using test::Number32Machine;
void require(bool condition, const char* message) {
	if (!condition)
		throw std::runtime_error(message);
}

test::Blua32TestImage chunk(
	std::span<const std::array<int, 4>> instructions, std::vector<Blua32EncodedConstant> constants = {}) {
	test::Blua32TestImage image;
	image.text.resize((instructions.size() + 1) * INSTRUCTION_BYTES);
	for (size_t i = 0; i < instructions.size(); ++i) {
		const auto& item = instructions[i];
		writeInstruction(image.text, i, item[0], item[1], item[2], item[3]);
	}
	writeInstruction(image.text, instructions.size(), static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {
		{.firstWord = 0, .wordCount = static_cast<u32>(instructions.size()), .numParams = 8, .maxStack = 24},
		{.firstWord = static_cast<u32>(instructions.size()), .wordCount = 1, .maxStack = 8}};
	image.exceptionFunctionIndex = 1;
	image.constants = std::move(constants);
	image.globalNames = {"saved"};
	return image;
}
void parity(Number32Machine& native, Number32Machine& scalar) {
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require(native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining && a.lastPc == b.lastPc &&
				a.statusWord == b.statusWord && a.causeWord == b.causeWord && a.epcWord == b.epcWord &&
				a.badAddressWord == b.badAddressWord && a.luaFaultReasonWord == b.luaFaultReasonWord &&
				a.hardHalted == b.hardHalted,
		"native context retains exact instruction, privilege, fault and cycle boundaries");
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()) &&
				std::ranges::equal(a.snapshot.objectWords(), b.snapshot.objectWords()),
		"native context retains the complete serialized compact value graph");
	require(a.threads.size() == b.threads.size(), "context thread counts agree");
	for (int frame = 0; frame < native.cpu.getFrameDepth(); ++frame)
		require(native.cpu.readFramePc(frame) == scalar.cpu.readFramePc(frame)
			&& native.cpu.getFrameRegisterCount(frame) == scalar.cpu.getFrameRegisterCount(frame), "active physical PCs and tops match the scalar owner");
	for (size_t i = 0; i < a.threads.size(); ++i) {
		const auto& x = a.threads[i];
		const auto& y = b.threads[i];
		require(x.stackTop == y.stackTop && x.frameDepth == y.frameDepth,
			"context stack and frame extents agree");
	}
}
void requireNative(CPU& cpu,u64 expectedReturns=1) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::ScalarBoundary)].entries == 0,
		"context operation must not escape to the interpreter");
	require(cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::Return)].entries == expectedReturns,
		"context operation must complete through generated execution");
#else
	(void)cpu;
	(void)expectedReturns;
#endif
}
void indexedConstants() {
	constexpr std::array program{std::array<int, 4>{static_cast<int>(OpCode::K1), 7, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::LOADKR), 2, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::RET), 2, 2, 0}};
	for (Value index : {valueInteger(0), valueInteger(1), valueFloat(-0.0f), valueFloat(1.875f), valueInteger(-1),
			 valueInteger(2), valueFloatBits(0x7fa12345), valueFloatBits(0x7f800000), valueBool(true)})
		for (int grant : {1, 2, 3, 4, 5, 6, 32}) {
			const auto image = chunk(program, {i32{16777217}, Blua32FloatConstant{0xffa12345}});
			Number32Machine native(image), scalar(image, false);
			for (auto* m : {&native, &scalar}) {
				auto r = m->cpu.activeThread()->currentFrame->registers;
				r.set(0, index);
				r.set(2, valueInteger(917));
			}
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			parity(native, scalar);
			const bool valid = index == valueInteger(0) || index == valueInteger(1) || index == valueFloat(-0.0f) ||
							   index == valueFloat(1.875f);
			if (grant == 32 && valid) {
				requireNative(native.cpu);
				const bool second = index == valueInteger(1) || index == valueFloat(1.875f);
				require(native.cpu.readCompletionValues().get(0) ==
							(second ? valueFloatBits(0xffa12345) : valueInteger(16777217)),
					"constant indexing truncates finite Floats and copies the selected raw subtype");
			}
			if (grant >= 3 && !valid) {
				require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT &&
							native.cpu.readFrameRegister(0, 2) == valueInteger(917),
					"invalid constant indices do not publish a destination");
				if (grant == 3)
					require(native.cpu.instructionBudgetRemaining == -1,
						"a failed indexed constant load retains exactly its started charge");
			}
		}
}
void methodReceivers() {
	for (int source : {0, 2, 3, 6})
		for (int kind = 0; kind < 4; ++kind)
			for (int grant : {1, 2, 3, 4, 5, 6, 7, 8, 32}) {
				const std::array program{std::array<int, 4>{static_cast<int>(OpCode::K1), 7, 0, 0},
					std::array<int, 4>{static_cast<int>(OpCode::SELF), 2, source, 0},
					std::array<int, 4>{static_cast<int>(OpCode::RET), 2, 3, 0}};
				const auto image = chunk(program, {std::string("method")});
				Number32Machine native(image), scalar(image, false);
				for (auto* machine : {&native, &scalar}) {
					Value base = kind == 1 ? valueInteger(-1) : kind == 2 ? valueFloatBits(0xffa12345) : valueBool(false);
					if (kind == 0) {
						auto* table = machine->cpu.createTable();
						table->setStringKey(machine->cpu.stringPool().intern("method"), valueInteger(77));
						base = valueTable(machine->cpu.gcHeap().reference(table));
					}
					auto registers = machine->cpu.activeThread()->currentFrame->registers;
					registers.set(2, valueInteger(811));
					registers.set(3, valueFloatBits(0x80000000));
					registers.set(source, base);
				}
				test::runCpuParity(native.cpu, scalar.cpu, grant);
				parity(native, scalar);
				if (grant == 32 && kind == 0) {
					requireNative(native.cpu);
					const auto results = native.cpu.readCompletionValues();
					require(results.size() == 2 && results.get(0) == valueInteger(77) && valueIsTable(results.get(1)),
						"SELF returns both the method value and original compact receiver, including aliases");
				}
			}
}
void controlWords() {
	for (int field : std::array<int, 6>{COP0_EPC, COP0_BAD_ADDRESS, COP0_LUA_FAULT_REASON, COP0_CAUSE, COP0_EXEC, 7})
		for (bool user : {false, true})
			for (int kind = 0; kind < 4; ++kind)
				for (int grant : {1, 2, 3, 4, 5, 6, 32}) {
					const std::array program{std::array<int, 4>{static_cast<int>(OpCode::LOADK), 0, 0, 0},
						std::array<int, 4>{static_cast<int>(OpCode::MTC0), 0, COP0_STATUS, 0},
						std::array<int, 4>{static_cast<int>(OpCode::LOADK), 1, 0, 1},
						std::array<int, 4>{static_cast<int>(OpCode::MTC0), 1, field, 0},
						std::array<int, 4>{static_cast<int>(OpCode::MFC0), 2, COP0_EPC, 0},
						std::array<int, 4>{static_cast<int>(OpCode::RET), 2, 2, 0}};
					const Blua32EncodedConstant value =
						kind == 0	? Blua32EncodedConstant{i32{INT32_MIN}}
						: kind == 1 ? Blua32EncodedConstant{Blua32FloatConstant{0x4f000000}}
						: kind == 2 ? Blua32EncodedConstant{Blua32FloatConstant{0x7fc00000}}
									: Blua32EncodedConstant{true};
					const auto image = chunk(
						program, {static_cast<i32>(user ? CPU_STATUS_CART_ENTRY : CPU_STATUS_SYSTEM_ENTRY), value});
					Number32Machine native(image), scalar(image, false);
					for (auto* m : {&native, &scalar})
						m->cpu.activeThread()->currentFrame->registers.set(2, valueInteger(917));
					test::runCpuParity(native.cpu, scalar.cpu, grant);
					parity(native, scalar);
					if (grant == 32 && (user || kind >= 2)) {
						require((native.cpu.readCauseWord() & CPU_CAUSE_CODE_MASK) ==
									(user ? CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE : CPU_CAUSE_CODE_TRAP),
							"control privilege faults precede even invalid source conversion");
						require(
							native.cpu.readLuaFaultReasonWord() == (user ? 0u : LUA_FAULT_REASON_INVALID_ARGUMENT) &&
								native.cpu.readEpcWord() == native.rom.textAddress + 3 * INSTRUCTION_BYTES &&
								native.cpu.readFrameRegister(0, 2) == valueInteger(917),
							"ignored/unknown control fields still obey operand admission");
					}
					if (grant == 32 && !user && kind < 2 && field != COP0_EXEC && field != 7)
						requireNative(native.cpu);
				}
	for (int field : std::array<int, 4>{COP0_EXEC, COP0_STATUS, COP0_EPC, 7})
		for (bool user : {false, true}) {
			const std::array program{std::array<int, 4>{static_cast<int>(OpCode::LOADK), 0, 0, 0},
				std::array<int, 4>{static_cast<int>(OpCode::MTC0), 0, COP0_STATUS, 0},
				std::array<int, 4>{static_cast<int>(OpCode::MFC0), 2, field, 0},
				std::array<int, 4>{static_cast<int>(OpCode::RET), 2, 2, 0}};
			const auto image =
				chunk(program, {static_cast<i32>(user ? CPU_STATUS_CART_ENTRY : CPU_STATUS_SYSTEM_ENTRY)});
			Number32Machine native(image), scalar(image, false);
			test::runCpuParity(native.cpu, scalar.cpu, 64);
			parity(native, scalar);
			if (!user && field != 7)
				requireNative(native.cpu);
		}
}
void lengths() {
	constexpr std::array program{std::array<int, 4>{static_cast<int>(OpCode::K1), 7, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::LEN), 2, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::RET), 2, 2, 0}};
	for (int kind = 0; kind < 5; ++kind)
		for (int grant = 1; grant <= 70; ++grant) {
			Number32Machine native(chunk(program)), scalar(chunk(program), false);
			for (auto* m : {&native, &scalar}) {
				Value value;
				if (kind == 0)
					value = valueString(m->cpu.stringPool().intern("A\xf0\x9f\x98\x80\xe2\x82\xac"));
				else if (kind == 1 || kind == 2) {
					auto* table = m->cpu.createTable(8, 8);
					for (int i = 1; i <= (kind == 1 ? 8 : 20); ++i)
						table->setInteger(i, valueBool(true));
					if (kind == 2)
						table->setInteger(8, valueNil());
					value = valueTable(m->cpu.gcHeap().reference(table));
				} else
					value = kind == 3 ? valueFloatBits(0xffa12345) : valueBool(false);
				auto r = m->cpu.activeThread()->currentFrame->registers;
				r.set(0, value);
				r.set(2, valueInteger(917));
			}
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			parity(native, scalar);
			if (grant == 70 && kind < 3)
				requireNative(native.cpu);
		}
}

test::Blua32TestImage capturedChunk(bool onlyStore = false, bool suspendFactory = false) {
	const std::array readWrite{std::array<int, 4>{static_cast<int>(OpCode::LOADK), 8, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::GETUP), 20, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::MOV), 21, 20, 0},
		std::array<int, 4>{static_cast<int>(OpCode::SETUP), 1, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::GETUP), 22, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::RET), 20, 4, 0}};
	const std::array store{std::array<int, 4>{static_cast<int>(OpCode::SETUP), 0, 0, 0},
		std::array<int, 4>{static_cast<int>(OpCode::RET), 0, 1, 0}};
	auto image = onlyStore ? chunk(store) : chunk(readWrite, {Blua32FloatConstant{0xffa12345}});
	image.functions[0].staticClosure = false;
	image.functions[0].upvalues = {{true, 8}};
	const u32 first = image.text.size() / INSTRUCTION_BYTES;
	image.text.resize((first + 3) * INSTRUCTION_BYTES);
	writeInstruction(image.text, first, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, first + 1, static_cast<u8>(OpCode::CLOSURE), 9, 0, 0);
	writeInstruction(image.text, first + 2, static_cast<u8>(suspendFactory ? OpCode::HALT : OpCode::RET), 9, 2, 0);
	image.functions.push_back({.firstWord = first, .wordCount = 3, .maxStack = 16});
	image.startupFunctionIndex = 2;
	image.irqFunctionIndex = 1;
	image.closureRelocations = {{first + 1, test::blua32TestFunctionAddress(RomImageDomain::System, 0)}};
	return image;
}
Closure* beginCaptured(Number32Machine& machine, bool suspended = false) {
	require(machine.cpu.runUntilDepth(0, 1000) == RunResult::Halted, "factory returns a real captured closure");
	auto* closure = asClosure(suspended ? machine.cpu.activeThread()->currentFrame->registers.get(9)
										: machine.cpu.readCompletionValues().get(0),
		machine.cpu.gcHeap());
	machine.cpu.setGlobalByKey(
		*machine.cpu.stringPool().find("saved"), valueClosure(machine.cpu.gcHeap().reference(closure)));
	machine.cpu.beginCompletionCall(*closure);
	return closure;
}
void captures() {
	for (int source = 0; source < 3; ++source)
		for (Value value : {valueInteger(INT32_MIN), valueFloatBits(0xffa12345), valueFromTag(ValueTag::True, 37)})
			for (int grant = 1; grant <= 40; ++grant) {
				const auto image = capturedChunk(false, source != 0);
				Number32Machine native(image), scalar(image, false);
				CallFrame* parents[2]{};
				for (int i = 0; i < 2; ++i) {
					auto& m = i == 0 ? native : scalar;
					auto* closure = beginCaptured(m, source != 0);
					auto* frame = m.cpu.activeThread()->currentFrame;
					auto* upvalue = static_cast<Upvalue*>(m.cpu.gcHeap().cellAt(closure->captureAddress(0)));
					if (source != 0) {
						parents[i] = frame->previous;
						parents[i]->registers.set(8, value);
						if (source == 1) {
							// Redirect the live open cell into the injected frame, retaining
							// actual thread/frame ownership and its matching open-cell chain.
							parents[i]->writeControl(FrameField::OpenHead, 0);
							upvalue->bind(frame->thread->address, frame->stackBase() + 8, frame->readControl(FrameField::OpenHead));
							frame->writeControl(FrameField::OpenHead, upvalue->address);
						}
					}
					upvalue->setValue(value);
					frame->registers.set(0, value);
					frame->registers.set(1, valueFloatBits(0x7fc12345));
				}
				test::runCpuParity(native.cpu, scalar.cpu, grant, source == 0 ? 0 : 1);
				parity(native, scalar);
				if (grant == 40) {
					requireNative(native.cpu,source==0?2:1);
					const auto results = native.cpu.readCompletionValues();
					const Value old = source == 1 ? valueFloatBits(0xffa12345) : value;
					require(results.size() == 3 && results.get(0) == old && results.get(1) == old &&
								results.get(2) == valueFloatBits(0x7fc12345),
						"open and closed cells copy complete words, including dirty aliased Float payloads");
				}
				if (source == 2)
					require(parents[0]->registers.get(8) == parents[1]->registers.get(8),
						"open outer-frame writes retain every Float/Integer bit");
			}
}
void closedBarrierAndDirectoryGrowth() {
	const auto image = capturedChunk(true);
	Number32Machine native(image), scalar(image, false);
	Table* children[2];
	Upvalue* upvalues[2];
	for (int i = 0; i < 2; ++i) {
		auto& m = i == 0 ? native : scalar;
		// Construct the capture AFTER directory growth: looking up an old id
		// through freed backing can appear to work while those bytes are intact.
		for (int n = 0; n < 600; ++n)
			m.cpu.createTable();
		auto* closure = beginCaptured(m);
		auto* child = m.cpu.createTable(1);
		child->setInteger(1, valueInteger(123));
		children[i] = child;
		auto* upvalue = static_cast<Upvalue*>(m.cpu.gcHeap().cellAt(closure->captureAddress(0)));
		upvalues[i] = upvalue;
		m.cpu.gcHeap().step(valueNil(), valueNil(), valueNil());
		require(upvalue->gcColor == 3, "collector has scanned the closed cell before mutation");
		m.cpu.activeThread()->currentFrame->registers.set(0, valueTable(m.cpu.gcHeap().reference(child)));
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1);
	parity(native, scalar);
	for (auto* cell : upvalues)
		require(cell->gcColor == 2, "closed native write queues the scanned cell again");
	test::runCpuParity(native.cpu, scalar.cpu, 100);
	parity(native, scalar);
	requireNative(native.cpu,2);
	for (int i = 0; i < 2; ++i) {
		auto& m = i == 0 ? native : scalar;
		m.cpu.collectHeap();
		require(asTable(upvalues[i]->value(), m.cpu.gcHeap()) == children[i] &&
					children[i]->getInteger(1) == valueInteger(123),
			"a child introduced by a closed-cell write survives the incremental collector");
	}
}
} // namespace
int main() {
	try {
		methodReceivers();
		std::cerr << "indexed constants\n";
		indexedConstants();
		std::cerr << "control words\n";
		controlWords();
		std::cerr << "lengths\n";
		lengths();
		std::cerr << "captures\n";
		captures();
		std::cerr << "closed barrier\n";
		closedBarrierAndDirectoryGrowth();
		std::cout << "Native compact constants, control, lengths, captures and barriers passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
