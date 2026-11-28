#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/closure_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
#include "support/thread_allocation_reference.h"
#include "support/table_allocation_reference.h"

#include <array>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

int cycles(OpCode op) { return BASE_CYCLES[static_cast<u8>(op)]; }

struct Program {
	test::Blua32TestImage image;
	u32 next;
	Program(OpCode op, bool wide) : next(wide ? 2u : 1u) {
		image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		if (wide) put(0, OpCode::WIDE, 0, 0, 0);
		const int b = op == OpCode::SETI ? 2 : op == OpCode::SETT ? 1 : 0;
		const int c = op == OpCode::GETT ? 1 : op == OpCode::LEN ? 0 : 2;
		put(next - 1, op, 0, b, c);
		put(next, OpCode::MOV, 8, 0, 0);
		put(next + 1, OpCode::HALT, 0, 0, 0);
		put(64, OpCode::HALT, 0, 0, 0);
		image.constants = {std::string("field"), std::string("length result")};
		image.functions = {{.firstWord=0, .wordCount=next+2, .maxStack=16}, {.firstWord=64, .wordCount=1}};
		image.exceptionFunctionIndex = 1;
	}
	void put(u32 word, OpCode op, int a, int b, int c) {
		writeInstruction(image.text, word, static_cast<u8>(op), a, b, c);
	}
};

struct Machine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	Machine(const Program& program, bool scalar)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, program.image)),
		memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		test::seedManagedFixture(cpu, addresses);
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
	Value bindHandler() {
		test::reserveReferenceThreadFrame(cpu.gcHeap(), *cpu.activeThread(), 32); // These raw fixtures exercise placement after admission.
		return valueClosure(test::seedTestCapturedClosure(cpu, rom.functionAddresses[2], {}));
	}
};

void parity(Machine& generated, Machine& scalar, int grant) {
	test::runCpuParity(generated.cpu, scalar.cpu, grant);
	const auto g = generated.cpu.captureRuntimeState(), s = scalar.cpu.captureRuntimeState();
	require(g == s && g.epcWord == s.epcWord && g.luaFaultReasonWord == s.luaFaultReasonWord && g.lastPc == s.lastPc
		&& test::sameLanguageRam(generated.cpu, scalar.cpu), "native and scalar table semantics preserve the same guest state");
}

void rawKeysAndReadForwarding() {
	for (Value key : {valueNil(), valueFloatBits(0xffa01234u)}) for (bool invalidForward : {false, true}) {
		Program program(OpCode::GETT, true);
		Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			auto root = bmsx::test::allocateTableReference(m->cpu, 0, 1), meta = bmsx::test::allocateTableReference(m->cpu, 0, 1);
			if (invalidForward) meta.setStringKey(m->cpu.stringPool().intern("__index"), valueBool(false));
			root.setMetatableAddress(meta.address());
			auto r = m->cpu.activeThread()->currentFrame->registers;
			r.set(0, valueTable(root.address())); r.set(1, key); r.set(8, valueInteger(57));
		}
		parity(generated, scalar, 1);
		require(generated.cpu.instructionBudgetRemaining == 1 - cycles(OpCode::GETT), "an inadmissible raw key does not add work or charge its unadmitted successor");
		if (invalidForward) {
			require(generated.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INDEX_NON_TABLE
				&& generated.cpu.readEpcWord() == generated.rom.textAddress && valueIsTable(generated.cpu.readFrameRegister(0, 0)),
				"a nonnil, nonindexable forwarding value faults at the original WIDE read");
		} else {
			require(generated.cpu.readCauseWord() == 0 && isNil(generated.cpu.readFrameRegister(0, 0))
				&& generated.cpu.readFrameRegister(0, 8) == valueInteger(57), "ordinary nil and NaN keys miss without executing a later instruction");
		}
	}
}

void rawGetDistinguishesExplicitKeysFromMissingArguments() {
	for (const Value key : {valueNil(), valueFloatBits(0xffa01234u)}) for (bool supplied : {false, true}) {
		Program program(OpCode::CALL, true);
		Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			auto root = bmsx::test::allocateTableReference(m->cpu, 0, 1), meta = bmsx::test::allocateTableReference(m->cpu, 0, 1);
			meta.setStringKey(m->cpu.stringPool().intern("__index"), m->cpu.createBuiltinFunction(BuiltinFunctionId::Error));
			root.setMetatableAddress(meta.address());
			auto* frame = m->cpu.activeThread()->currentFrame;
			frame->registers.set(0, m->cpu.createBuiltinFunction(BuiltinFunctionId::RawGet));
			frame->registers.set(1, valueTable(root.address()));
			frame->registers.set(2, key);
			frame->setTop(2 + supplied);
		}
		parity(generated, scalar, 1);
		if (supplied) {
			require(generated.cpu.readCauseWord() == 0 && isNil(generated.cpu.readFrameRegister(0, 0)),
				"rawget of explicit nil or NaN misses without invoking __index");
		} else {
			require(generated.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT
				&& generated.cpu.readEpcWord() == generated.rom.textAddress, "rawget reports a missing key at its CALL");
		}
	}
}

void stringForwardingUsesLiveStringReceiverAndVisitBound() {
	Program program(OpCode::GETT, false);
	constexpr u32 handler = 72;
	program.put(handler, OpCode::RET, 0, 2, 0);
	program.image.functions.push_back({.firstWord=handler, .wordCount=1, .numParams=2, .maxStack=4});
	Machine generated(program, false), scalar(program, true);
	for (auto* m : {&generated, &scalar}) {
		auto& cpu = m->cpu;
		auto root = bmsx::test::allocateTableReference(cpu, 0, 1), meta = bmsx::test::allocateTableReference(cpu, 0, 1), methods = bmsx::test::allocateTableReference(cpu, 0, 1), methodsMeta = bmsx::test::allocateTableReference(cpu, 0, 1);
		const auto index = cpu.stringPool().intern("__index");
		const Value forwarded = valueString(cpu.stringPool().intern("proxy"));
		meta.setStringKey(index, forwarded); root.setMetatableAddress(meta.address());
		methodsMeta.setStringKey(index, m->bindHandler()); methods.setMetatableAddress(methodsMeta.address());
		auto state = cpu.captureRuntimeState();
		state.stringIndexTableWord = methods.address();
		cpu.restoreRuntimeState(state);
		auto r = cpu.activeThread()->currentFrame->registers;
		r.set(0, valueTable(root.address())); r.set(1, valueNil()); r.set(2, forwarded);
		r.set(3, valueTable(methodsMeta.address())); r.set(4, valueTable(root.address()));
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	generated.cpu.prepareSystemNativeCode();
#endif
	const auto receiver = generated.cpu.readFrameRegister(0, 2);
	parity(generated, scalar, 1);
	require(generated.cpu.getFrameDepth() == 2
		&& generated.cpu.readFrameRegister(1, 0) == receiver && isNil(generated.cpu.readFrameRegister(1, 1))
		&& generated.cpu.instructionBudgetRemaining == 1 - cycles(OpCode::GETT) - TABLE_INDEX_VISIT_CYCLES - 2,
		"a String forwarding target enters its installed Table but passes the original String and raw key to its function");
	parity(generated, scalar, 1);
	require(generated.cpu.getFrameDepth() == 1 && generated.cpu.readFrameRegister(0, 0) == receiver
		&& generated.cpu.instructionBudgetRemaining == 1 - cycles(OpCode::RET) - 1,
		"the ordinary handler returns the original String through the indexed read's single result placement");
	for (auto* m : {&generated, &scalar}) {
		auto& cpu = m->cpu;
		auto r = cpu.activeThread()->currentFrame->registers;
		asTable(r.get(3), cpu.gcHeap()).setStringKey(cpu.stringPool().intern("__index"), r.get(2));
		r.set(0, r.get(4));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
	}
	parity(generated, scalar, 1);
	require(generated.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP
		&& generated.cpu.readEpcWord() == generated.rom.textAddress
		&& generated.cpu.instructionBudgetRemaining == 1 - cycles(OpCode::GETT) - (TABLE_INDEX_CHAIN_LIMIT - 1) * TABLE_INDEX_VISIT_CYCLES,
		"Table-to-String forwarding cannot reset the 32-visit chain bound");
}

void stringIndexUsesTheRestoredControlWord() {
	Machine machine(Program(OpCode::GETT, false), true);
	auto& cpu = machine.cpu;
	auto& gc = cpu.gcHeap();
	auto& memory = machine.memory;
	const u32 head = cpu.heapAllocator().managementOffset() + GC_DIAGNOSTIC_OFFSET;
	const u32 tag = head + static_cast<u32>(GcDiagnosticField::StringIndexTag);
	const u32 word = head + static_cast<u32>(GcDiagnosticField::StringIndexWord);
	auto methods = bmsx::test::allocateTableReference(cpu, 0, 1);
	const auto key = cpu.stringPool().intern("watched-method");
	methods.setStringKey(key, valueInteger(73));
	memory.writeRamRecordWord(tag, static_cast<u32>(ValueTag::Table));
	memory.writeRamRecordWord(word, methods.address());
	auto* frame = cpu.activeThread()->currentFrame;
	frame->registers.set(0, valueString(cpu.stringPool().intern("receiver")));
	frame->registers.set(1, valueString(key));
	frame->extendTop(2);

	cpu.collectHeap();
	require(gc.tableRecordAddress(methods.address()) == methods.address(),
		"the live RAM index is the sole root of the method Table");
	const auto ram = memory.captureSaveState();
	auto control = cpu.captureRuntimeState();
	control.stringIndexTableWord = methods.address();
	cpu.restoreRuntimeState(control);
	auto unwired = control;
	unwired.stringIndexTableWord = 0u;
	cpu.restoreRuntimeState(unwired);
	cpu.runUntilDepth(0, 1);
	require(cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INDEX_NON_TABLE,
		"the unbound datapath does not use the collector's retained String root");
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(control);
	cpu.runUntilDepth(0, 1);
	require(cpu.readFrameRegister(0, 0) == valueInteger(73)
		&& cpu.instructionBudgetRemaining == 1 - cycles(OpCode::GETT),
		"restored CPU state supplies the method lookup with the original charge");
}

void tableValuedNewIndexAndOwnOverwrite() {
	for (const auto op : {OpCode::SETI, OpCode::SETFIELD, OpCode::SETT}) for (bool wide : {false, true}) {
		Program program(op, wide);
		Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			auto own = bmsx::test::allocateTableReference(m->cpu, 4, 2), holder = bmsx::test::allocateTableReference(m->cpu, 4, 2), meta = bmsx::test::allocateTableReference(m->cpu, 0, 1);
			const Value key = op == OpCode::SETI ? valueInteger(2) : valueString(m->cpu.stringPool().intern("field"));
			meta.setStringKey(m->cpu.stringPool().intern("__newindex"), valueTable(holder.address()));
			own.setMetatableAddress(meta.address());
			own.set(key, valueBool(false));
			auto r = m->cpu.activeThread()->currentFrame->registers;
			r.set(0, valueTable(own.address())); r.set(1, key); r.set(2, valueInteger(37));
			r.set(3, valueTable(holder.address())); r.set(8, valueInteger(57));
		}
		parity(generated, scalar, 1);
		const auto read = [&](int slot) {
			return asTable(generated.cpu.readFrameRegister(0, slot), generated.cpu.gcHeap()).get(generated.cpu.readFrameRegister(0, 1));
		};
		require(read(0) == valueInteger(37) && isNil(read(3)) && generated.cpu.instructionBudgetRemaining == 1 - cycles(op),
			"existing false is present: ordinary overwrite stays on its own Table");
		for (auto* m : {&generated, &scalar}) {
			auto own = asTable(m->cpu.readFrameRegister(0, 0), m->cpu.gcHeap());
			own.set(m->cpu.readFrameRegister(0, 1), valueNil());
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		}
		parity(generated, scalar, 1);
		require(isNil(read(0)) && read(3) == valueInteger(37) && generated.cpu.instructionBudgetRemaining == 1 - cycles(op) - TABLE_INDEX_VISIT_CYCLES
			&& generated.cpu.readFrameRegister(0, 8) == valueInteger(57), "after deleting the own entry, the same site writes the live holder and charges its visit");
	}
}

void fixedFieldAssignmentReusesTheTerminalProof() {
	Program program(OpCode::SETFIELD, true);
	Machine generated(program, false), scalar(program, true);
	for (auto* m : {&generated, &scalar}) {
		auto& cpu = m->cpu;
		auto& strings = cpu.stringPool();
		const auto field = *strings.find("field"), newIndex = strings.intern("__newindex");
		auto own = bmsx::test::allocateTableReference(cpu, 1, 2), holder = bmsx::test::allocateTableReference(cpu, 1, 2);
		auto meta = bmsx::test::allocateTableReference(cpu, 0, 1), holderMeta = bmsx::test::allocateTableReference(cpu, 0, 2);
		meta.setStringKey(newIndex, valueTable(holder.address()));
		holderMeta.setStringKey(strings.intern("unrelated method"), valueBool(false));
		own.setMetatableAddress(meta.address());
		holder.setMetatableAddress(holderMeta.address());
		own.setStringKey(field, valueBool(false));
		holder.setInteger(1, valueInteger(61));
		const auto home = holder.beginStringProbe(field).node;
		for (int i = 0; i < 64; ++i) {
			const auto collider = strings.intern("terminal collision " + std::to_string(i));
			if (holder.beginStringProbe(collider).node != home) continue;
			holder.setStringKey(collider, valueInteger(27));
			break;
		}
		auto registers = cpu.activeThread()->currentFrame->registers;
		registers.set(0, valueTable(own.address()));
		registers.set(3, valueTable(holder.address()));
		registers.set(4, valueTable(holderMeta.address()));
	}
	const auto assign = [&](Value value, int inheritedVisits) {
		for (auto* m : {&generated, &scalar}) {
			auto& cpu = m->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			auto registers = cpu.activeThread()->currentFrame->registers;
			registers.set(2, value); registers.set(8, valueInteger(57));
		}
		parity(generated, scalar, cycles(OpCode::SETFIELD) + inheritedVisits * TABLE_INDEX_VISIT_CYCLES);
		const auto& cpu = generated.cpu;
		require(cpu.instructionBudgetRemaining == 0 && cpu.readCurrentInstructionPc() == generated.rom.textAddress
			&& cpu.lastPc == generated.rom.textAddress + INSTRUCTION_BYTES
			&& cpu.readFramePc(0) == generated.rom.textAddress + program.next * INSTRUCTION_BYTES
			&& cpu.readFrameRegister(0, 8) == valueInteger(57),
			"the WIDE store charges exactly its visits and leaves the suffix unexecuted");
	};
	const auto hint = [](Machine& m) {
		const auto& page = *m.cpu.activeThread()->currentFrame->decodedPage;
		return page.words[(m.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].tableCacheSlot();
	};
	auto& cpu = generated.cpu;
	const auto field = *cpu.stringPool().find("field");
	auto own = asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap());
	auto holder = asTable(cpu.readFrameRegister(0, 3), cpu.gcHeap());
	const Value negativeZero = valueFloatBits(0x80000000u), rawNaN = valueFloatBits(0xffc01234u);
	assign(negativeZero, 0);
	const int ownHint = hint(scalar);
	require(ownHint >= 0 && hint(generated) == ownHint && own.getStringKey(field) == negativeZero
		&& isNil(holder.getStringKey(field)), "a present false field trains the own hint and never forwards");
	assign(valueBool(false), 0);
	require(hint(scalar) == ownHint && own.getStringKey(field) == valueBool(false),
		"the warmed own slot accepts the next exact tagged value");

	for (auto* m : {&generated, &scalar})
		asTable(m->cpu.readFrameRegister(0, 0), m->cpu.gcHeap()).setStringKey(field, valueNil());
	assign(negativeZero, 1);
	int holderSlot = -1;
	require(isNil(own.getStringKey(field)) && holder.getStringKeyCached(field, holderSlot) == negativeZero
		&& holderSlot >= 0 && holderSlot != ownHint && hint(scalar) == ownHint && hint(generated) == ownHint,
		"a stale source hint cannot supply or learn a forwarded holder's different slot");
	assign(valueNil(), 1);
	require(isNil(holder.getStringKey(field)) && holder.getInteger(1) == valueInteger(61),
		"the terminal delete writes nil without disturbing the holder's array");
	assign(valueBool(false), 1);
	require(holder.getStringKeyCached(field, holderSlot) == valueBool(false) && holderSlot != ownHint,
		"the next forwarded write restores the terminal tombstone");

	for (auto* m : {&generated, &scalar}) {
		auto& lane = m->cpu;
		asTable(lane.readFrameRegister(0, 4), lane.gcHeap())
			.setStringKey(lane.stringPool().intern("__newindex"), lane.readFrameRegister(0, 0));
	}
	assign(rawNaN, 1);
	require(holder.getStringKey(field) == rawNaN && isNil(own.getStringKey(field))
		&& hint(scalar) == ownHint && hint(generated) == ownHint,
		"a live false terminal slot takes precedence over its own redirect and preserves the original raw Float");
}

void coldFieldAssignmentPublishesItsFrontierOnce() {
	constexpr u32 handler = 72;
	constexpr u8 extraHashSlots = 7;
	Program program(OpCode::SETFIELD, true);
	program.next = 3;
	program.put(0, OpCode::K1, 10, 0, 0);
	writeInstruction(program.image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0, extraHashSlots);
	program.put(2, OpCode::SETFIELD, 0, 0, 2);
	program.put(3, OpCode::MOV, 8, 0, 0);
	program.put(4, OpCode::HALT, 0, 0, 0);
	program.image.functions[0].wordCount = 5;
	program.put(handler, OpCode::SETI, 0, 1, 2);
	program.put(handler + 1, OpCode::RET, 0, 1, 0);
	program.image.functions.push_back({.firstWord=handler, .wordCount=2, .numParams=3, .maxStack=8});
	Machine machine(program, true); // Skip precompilation; enter ordinary scalar dispatch.
	auto& cpu = machine.cpu;
	cpu.setExecutionHook({});
	cpu.luaHeap().setCollectionTarget(static_cast<u32>(cpu.luaHeap().capacity()));
	const Value method = machine.bindHandler();
	auto root = bmsx::test::allocateTableReference(cpu, 1, 0);
	root.setInteger(1, valueInteger(17));
	const auto field = *cpu.stringPool().find("field");
	const unsigned storePc = machine.rom.textAddress + INSTRUCTION_BYTES;
	const unsigned successor = machine.rom.textAddress + program.next * INSTRUCTION_BYTES;
	const int throughStore = cycles(OpCode::K1) + cycles(OpCode::SETFIELD);
	const auto start = [&](Value value) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		auto* frame = cpu.activeThread()->currentFrame;
		frame->registers.set(0, valueTable(root.address()));
		frame->registers.set(2, value);
		frame->registers.set(8, valueInteger(57));
		frame->setTop(9);
	};

	start(valueBool(false));
	require(cpu.runUntilDepth(0, throughStore) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0
		&& cpu.readCurrentInstructionPc() == storePc && cpu.lastPc == storePc + INSTRUCTION_BYTES
		&& cpu.readFramePc(0) == successor && cpu.activeThread()->currentFrame->readWindow(FrameField::Top) == 11
		&& cpu.readFrameRegister(0, 8) == valueInteger(57) && cpu.readFrameRegister(0, 10) == valueInteger(1),
		"cold hinted insertion retires WIDE and publishes the preceding live top, not the unexecuted suffix");
	require(root.hashSlots() == TableRecord::hashCapacity(1 + extraHashSlots)
		&& root.getStringKey(field) == valueBool(false) && root.getInteger(1) == valueInteger(17),
		"the first own insertion reserves its requested hash storage without touching the array");
	const u32 storage = root.hashAddress();
	auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
	meta.setStringKey(cpu.stringPool().intern("__newindex"), method);
	root.setMetatableAddress(meta.address());
	start(valueInteger(29));
	require(cpu.runUntilDepth(0, throughStore) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0
		&& root.hashAddress() == storage && root.getStringKey(field) == valueInteger(29)
		&& root.getInteger(1) == valueInteger(17), "the next store updates the own slot in place without a method call");

	root.setStringKey(field, valueNil());
	start(valueInteger(41));
	require(cpu.runUntilDepth(0, throughStore) == RunResult::Yielded,
		"the stale own-slot prediction hands off to the callable method");
	const auto* child = cpu.activeThread()->currentFrame;
	require(child->previous && child->readControl(FrameField::CallSite) == storePc
		&& child->previous->readControl(FrameField::Pc) == successor && child->previous->readWindow(FrameField::Top) == 11
		&& child->registers.get(0) == valueTable(root.address()) && child->registers.get(1) == valueString(field)
		&& child->registers.get(2) == valueInteger(41) && isNil(root.getStringKey(field)),
		"__newindex sees the exact caller frontier and original operands before any store commits");
	require(cpu.runUntilDepth(0, cycles(OpCode::SETI) + cycles(OpCode::RET) + cycles(OpCode::MOV)) == RunResult::Yielded
		&& cpu.getFrameDepth() == 1 && cpu.instructionBudgetRemaining == 0
		&& cpu.readFrameRegister(0, 8) == valueTable(root.address()) && cpu.readFramePc(0) == successor + INSTRUCTION_BYTES
		&& root.getInteger(1) == valueInteger(41) && isNil(root.getStringKey(field)),
		"the method and successor finish once without replaying the original assignment");
}

void callableNewIndexDiscardsAllResults() {
	constexpr u32 handler = 72;
	for (const Value key : {valueNil(), valueFloatBits(0xffa01234u)}) {
		Program program(OpCode::SETT, true);
		program.put(handler, OpCode::SETFIELD, 0, 0, 2);
		program.put(handler+1, OpCode::RET, 0, 3, 0);
		program.image.functions.push_back({.firstWord=handler, .wordCount=2, .numParams=3, .maxStack=8});
		Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			const Value method = m->bindHandler();
			auto root = bmsx::test::allocateTableReference(m->cpu, 0, 1), meta = bmsx::test::allocateTableReference(m->cpu, 0, 1);
			const auto field = m->cpu.stringPool().intern("field");
			root.setStringKey(field, valueBool(false));
			meta.setStringKey(m->cpu.stringPool().intern("__newindex"), method);
			root.setMetatableAddress(meta.address());
			auto* frame = m->cpu.activeThread()->currentFrame;
			frame->registers.set(0, valueTable(root.address())); frame->registers.set(1, key);
			frame->registers.set(2, valueInteger(73)); frame->registers.set(8, valueInteger(57));
			frame->writeControl(FrameField::Top, 0x4900000bu);
		}
		parity(generated, scalar, 1);
		const auto* child = generated.cpu.activeThread()->currentFrame;
		require(child->previous && child->readControl(FrameField::CallSite) == generated.rom.textAddress
			&& child->registers.get(0) == child->previous->registers.get(0) && child->registers.get(1) == key
			&& child->registers.get(2) == valueInteger(73) && generated.cpu.instructionBudgetRemaining == 1 - cycles(OpCode::SETT) - 3,
			"the callback sees the original nil or raw NaN and starts a real three-argument activation");
		parity(generated, scalar, cycles(OpCode::SETFIELD) + cycles(OpCode::RET));
		const auto* caller = generated.cpu.activeThread()->currentFrame;
		const auto table = asTable(caller->registers.get(0), generated.cpu.gcHeap());
		require(generated.cpu.getFrameDepth() == 1 && generated.cpu.instructionBudgetRemaining == 0
			&& caller->readControl(FrameField::Top) == 0x4900000bu && caller->registers.get(1) == key
			&& caller->registers.get(8) == valueInteger(57) && table.getStringKey(generated.cpu.stringPool().intern("field")) == valueInteger(73),
			"assignment returns no registers or receiving charge, while the handler's own mutation commits");
	}
}

void tableLengthAllowsOrdinaryMetamethodResult() {
	constexpr u32 handler = 72;
	Program program(OpCode::LEN, true);
	program.put(handler, OpCode::LOADK, 0, 0, 1);
	program.put(handler+1, OpCode::RET, 0, 2, 0);
	program.image.functions.push_back({.firstWord=handler, .wordCount=2, .numParams=2, .maxStack=4});
	Machine generated(program, false), scalar(program, true);
	for (auto* m : {&generated, &scalar}) {
		const Value method = m->bindHandler();
		auto root = bmsx::test::allocateTableReference(m->cpu, 4, 0), meta = bmsx::test::allocateTableReference(m->cpu, 0, 1);
		meta.setStringKey(m->cpu.stringPool().intern("__len"), method);
		root.setInteger(1, valueInteger(27)); root.setMetatableAddress(meta.address());
		auto* frame = m->cpu.activeThread()->currentFrame;
		frame->registers.set(0, valueTable(root.address())); frame->registers.set(8, valueInteger(-1));
		frame->extendTop(9);
	}
	parity(generated, scalar, 1);
	const auto* child = generated.cpu.activeThread()->currentFrame;
	require(child->previous && child->registers.get(0) == child->previous->registers.get(0) && child->registers.get(1) == child->registers.get(0)
		&& generated.cpu.instructionBudgetRemaining == 1 - cycles(OpCode::LEN) - 2,
		"table LEN calls its method with both receiver operands and no raw length probes");
	parity(generated, scalar, cycles(OpCode::LOADK) + cycles(OpCode::RET) + 1 + cycles(OpCode::MOV));
	const auto result = generated.cpu.readFrameRegister(0, 8);
	require(generated.cpu.instructionBudgetRemaining == 0 && valueIsString(result)
		&& generated.cpu.stringPool().toString(asStringId(result)) == "length result",
		"the native continuation sees the actual non-integer length result");
}
} // namespace

int main() {
	try {
		rawKeysAndReadForwarding(); rawGetDistinguishesExplicitKeysFromMissingArguments();
		stringForwardingUsesLiveStringReceiverAndVisitBound(); tableValuedNewIndexAndOwnOverwrite();
		stringIndexUsesTheRestoredControlWord();
		fixedFieldAssignmentReusesTheTerminalProof();
		coldFieldAssignmentPublishesItsFrontierOnce();
		callableNewIndexDiscardsAllResults(); tableLengthAllowsOrdinaryMetamethodResult();
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
	return 0;
}
