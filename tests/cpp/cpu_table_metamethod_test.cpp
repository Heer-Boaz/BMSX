#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <array>
#include <iostream>
#include <stdexcept>

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
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
	Value bindHandler(u32 word) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[2], rom.textAddress + word * INSTRUCTION_BYTES);
		const auto closure = valueClosure(cpu.activeThread()->currentFrame->closureAddress());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
		return closure;
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
			auto root = m->cpu.createTable(0, 1), meta = m->cpu.createTable(0, 1);
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

void rawBuiltinsDistinguishExplicitKeysFromMissingArguments() {
	for (const auto id : {BuiltinFunctionId::RawGet, BuiltinFunctionId::RawSet}) {
		for (const Value key : {valueNil(), valueFloatBits(0xffa01234u)}) for (bool supplied : {false, true}) {
			Program program(OpCode::CALL, true);
			Machine generated(program, false), scalar(program, true);
			const bool write = id == BuiltinFunctionId::RawSet;
			for (auto* m : {&generated, &scalar}) {
				auto root = m->cpu.createTable(0, 1), meta = m->cpu.createTable(0, 1);
				meta.setStringKey(m->cpu.stringPool().intern(write ? "__newindex" : "__index"), m->cpu.createBuiltinFunction(BuiltinFunctionId::Error));
				root.setMetatableAddress(meta.address());
				auto* frame = m->cpu.activeThread()->currentFrame;
				frame->registers.set(0, m->cpu.createBuiltinFunction(id)); frame->registers.set(1, valueTable(root.address()));
				frame->registers.set(2, key); frame->registers.set(3, valueNil());
				frame->setTop((write ? 3 : 2) + supplied);
			}
			parity(generated, scalar, 1);
			if (supplied && !write) {
				require(generated.cpu.readCauseWord() == 0 && isNil(generated.cpu.readFrameRegister(0, 0)),
					"rawget of explicit nil or NaN misses without invoking __index");
			} else {
				const u32 reason = !supplied ? LUA_FAULT_REASON_INVALID_ARGUMENT : valueIsNaN(key) ? LUA_FAULT_REASON_INDEX_NAN : LUA_FAULT_REASON_INDEX_NIL;
				require(generated.cpu.readLuaFaultReasonWord() == reason && generated.cpu.readEpcWord() == generated.rom.textAddress,
					"missing and explicitly invalid arguments fault from their own raw CALL contract, not __newindex");
			}
		}
	}
}

void stringForwardingUsesLiveStringReceiverAndVisitBound() {
	constexpr u32 install = 72;
	Program program(OpCode::GETT, false);
	program.put(install, OpCode::CALL, 12, 2, 1);
	program.put(install+1, OpCode::HALT, 0, 0, 0);
	program.image.functions.push_back({.firstWord=install, .wordCount=2, .maxStack=16});
	Machine generated(program, false), scalar(program, true);
	for (auto* m : {&generated, &scalar}) {
		auto& cpu = m->cpu;
		auto root = cpu.createTable(0, 1), meta = cpu.createTable(0, 1), methods = cpu.createTable(0, 1), methodsMeta = cpu.createTable(0, 1);
		const auto index = cpu.stringPool().intern("__index");
		const Value forwarded = valueString(cpu.stringPool().intern("proxy"));
		meta.setStringKey(index, forwarded); root.setMetatableAddress(meta.address());
		methodsMeta.setStringKey(index, cpu.createBuiltinFunction(BuiltinFunctionId::Type)); methods.setMetatableAddress(methodsMeta.address());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[2], m->rom.textAddress + install * INSTRUCTION_BYTES);
		auto r = cpu.activeThread()->currentFrame->registers;
		r.set(12, cpu.createBuiltinFunction(BuiltinFunctionId::SetStringIndex)); r.set(13, valueTable(methods.address()));
		cpu.runUntilDepth(0, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		r.set(0, valueTable(root.address())); r.set(1, valueNil()); r.set(2, forwarded);
		r.set(3, valueTable(methodsMeta.address())); r.set(4, valueTable(root.address()));
	}
	parity(generated, scalar, 1);
	const auto result = generated.cpu.readFrameRegister(0, 0);
	require(valueIsString(result) && generated.cpu.stringPool().toString(asStringId(result)) == "string"
		&& generated.cpu.instructionBudgetRemaining == 1 - cycles(OpCode::GETT) - TABLE_INDEX_VISIT_CYCLES - 2,
		"a String forwarding target enters its installed Table but passes the String itself to its function");
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

void tableValuedNewIndexAndOwnOverwrite() {
	for (const auto op : {OpCode::SETI, OpCode::SETFIELD, OpCode::SETT}) for (bool wide : {false, true}) {
		Program program(op, wide);
		Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			auto own = m->cpu.createTable(4, 2), holder = m->cpu.createTable(4, 2), meta = m->cpu.createTable(0, 1);
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

void callableNewIndexDiscardsAllResults() {
	constexpr u32 handler = 72;
	for (const Value key : {valueNil(), valueFloatBits(0xffa01234u)}) {
		Program program(OpCode::SETT, true);
		program.put(handler, OpCode::SETFIELD, 0, 0, 2);
		program.put(handler+1, OpCode::RET, 0, 3, 0);
		program.image.functions.push_back({.firstWord=handler, .wordCount=2, .numParams=3, .maxStack=8});
		Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			const Value method = m->bindHandler(handler);
			auto root = m->cpu.createTable(0, 1), meta = m->cpu.createTable(0, 1);
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
		const Value method = m->bindHandler(handler);
		auto root = m->cpu.createTable(4, 0), meta = m->cpu.createTable(0, 1);
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
		rawKeysAndReadForwarding(); rawBuiltinsDistinguishExplicitKeysFromMissingArguments();
		stringForwardingUsesLiveStringReceiverAndVisitBound(); tableValuedNewIndexAndOwnOverwrite();
		callableNewIndexDiscardsAllResults(); tableLengthAllowsOrdinaryMetamethodResult();
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
	return 0;
}
