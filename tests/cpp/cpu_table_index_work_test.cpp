#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
enum class KeyKind { String, Integer, Boolean };
constexpr std::array forms{std::pair{OpCode::GETFIELD, KeyKind::String}, std::pair{OpCode::SELF, KeyKind::String},
	std::pair{OpCode::GETT, KeyKind::String}, std::pair{OpCode::GETI, KeyKind::Integer},
	std::pair{OpCode::GETT, KeyKind::Integer}, std::pair{OpCode::GETT, KeyKind::Boolean}};

struct Program {
	test::Blua32TestImage image;
	std::array<u32, 4> starts;
	Program(OpCode op, bool wide, bool stringReceiver = false) {
		image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		u32 word = 0;
		if (stringReceiver) writeInstruction(image.text, word++, static_cast<u8>(OpCode::CALL), 20, 2, 1);
		const std::array codes{OpCode::MOV, op, OpCode::MOV};
		for (u32 i = 0; i < codes.size(); ++i) {
			starts[i] = word;
			if (wide) writeInstruction(image.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
			writeInstruction(image.text, word++, static_cast<u8>(codes[i]), i == 2 ? 8 : 6, i == 0 ? 0 : 6,
				i == 1 && op != OpCode::GETFIELD && op != OpCode::SELF ? 1 : 0);
		}
		starts[3] = word;
		writeInstruction(image.text, word, static_cast<u8>(OpCode::JMP), 0, 63, (starts[0] - word - 1u) & 63u, 255);
		writeInstruction(image.text, 64, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.constants = {std::string("field")};
		image.functions = {{.firstWord=0, .wordCount=word+1, .maxStack=24}, {.firstWord=64, .wordCount=1}};
		image.exceptionFunctionIndex = 1;
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
		else {
			cpu.prepareSystemNativeCode();
			const auto* page = cpu.activeThread()->currentFrame->executionImage->nativeCodeLookup->find(rom.textAddress, 0);
			require(page && page->nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES],
				"the real read body is published before all short-grant checks");
		}
#endif
	}
};

void sameSnapshot(const CpuRuntimeState& a, const CpuRuntimeState& b) {
	require(a == b
		&& a.epcWord == b.epcWord
		&& a.luaFaultReasonWord == b.luaFaultReasonWord && a.lastPc == b.lastPc,
		"complete guest graphs and instruction/fault boundaries match");
}
Value keyFor(CPU& cpu, KeyKind kind) {
	return kind == KeyKind::String ? valueString(cpu.stringPool().intern("field"))
		: kind == KeyKind::Integer ? valueInteger(1) : valueBool(false);
}
TableRecord makeChain(CPU& cpu, TableRecord root, int depth, Value key, Value value) {
	auto current = root;
	for (int i = 1; i < depth; ++i) {
		auto next = cpu.createTable(2, 2); auto meta = cpu.createTable(0, 1);
		meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(next.address())); current.setMetatableAddress(meta.address()); current = next;
	}
	current.set(key, value);
	return current;
}
void cycle(CPU& cpu, TableRecord root) {
	auto meta = cpu.createTable(0, 1);
	meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(root.address())); root.setMetatableAddress(meta.address());
}

void grantsAndRestore() {
	for (bool wide : {false, true}) for (const auto [op, kind] : forms) for (int depth : {1, 2, 5, 32}) {
		Program program(op, wide); Machine generated(program, false), scalar(program, true);
		const std::array charges{2, (op == OpCode::SELF ? 17 : op == OpCode::GETI ? 8 : 16) + 8 * (depth - 1), 2, 2};
		const int total = charges[0] + charges[1] + charges[2] + charges[3];
		for (auto* m : {&generated, &scalar}) {
			auto root = m->cpu.createTable(2, 2); const auto key = keyFor(m->cpu, kind);
			makeChain(m->cpu, root, depth, key, valueBool(false));
			if (depth == 1) cycle(m->cpu, root);
			auto r = m->cpu.activeThread()->currentFrame->registers; r.set(0, valueTable(root.address())); r.set(1, key);
		}
		const auto heap = generated.cpu.luaHeap().usedBytes();
		for (int grant = 0; grant <= total; ++grant) {
			for (auto* m : {&generated, &scalar}) {
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
				auto r = m->cpu.activeThread()->currentFrame->registers; r.set(6, valueInteger(91)); r.set(7, valueNil()); r.set(8, valueInteger(57));
			}
			require(test::runCpuParity(generated.cpu, scalar.cpu, grant) == RunResult::Yielded, "an ordinary read loop remains runnable");
			int remaining = grant, completed = 0;
			while (remaining > 0) remaining -= charges[completed++];
			auto* frame = generated.cpu.activeThread()->currentFrame; auto r = frame->registers;
			require(generated.cpu.instructionBudgetRemaining == remaining, "each additionally visited Table costs exactly8, including debt");
			require(frame->readControl(bmsx::FrameField::Pc) == generated.rom.textAddress + program.starts[completed == 4 ? 0 : completed] * INSTRUCTION_BYTES,
				"the completed read frontier precedes every unadmitted marker");
			require(r.get(6) == (completed >= 2 ? valueBool(false) : completed == 1 ? r.get(0) : valueInteger(91))
				&& r.get(8) == (completed >= 3 ? valueBool(false) : valueInteger(57))
				&& r.get(7) == (op == OpCode::SELF && completed >= 2 ? r.get(0) : valueNil()),
				"aliased result, following marker and SELF receiver publish at their actual instruction boundaries");
			sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
			require(test::sameLanguageRam(generated.cpu, scalar.cpu), "guest heap and stack bytes match");
			require(generated.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes()
				&& generated.cpu.luaHeap().collectionTarget() == scalar.cpu.luaHeap().collectionTarget(),
				"physical allocator and pacing words agree");
		}
		// Reusing a prototype result may repair slot hints, never change its price.
		require(generated.cpu.luaHeap().usedBytes() == heap, "lookups do not allocate guest storage");
		for (auto* m : {&generated, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			const auto ram = m->memory.captureSaveState();
			const auto before = m->cpu.captureRuntimeState();
			m->cpu.runUntilDepth(0, 3); const auto after = m->cpu.captureRuntimeState(); const int debt = m->cpu.instructionBudgetRemaining;
			m->memory.restoreSaveState(ram);
			m->cpu.restoreRuntimeState(before); m->cpu.runUntilDepth(0, 3);
			require(m->cpu.instructionBudgetRemaining == debt, "restore reproduces semantic work independently of native/cache hints");
			sameSnapshot(m->cpu.captureRuntimeState(), after);
		}
	}
}

void faultsOnce() {
	for (bool wide : {false, true}) for (const auto [op, kind] : forms) for (bool cyclic : {false, true}) {
		Program program(op, wide); Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			auto root = m->cpu.createTable(2, 2); const auto key = keyFor(m->cpu, kind);
			if (cyclic) cycle(m->cpu, root); else makeChain(m->cpu, root, 33, key, valueInteger(73));
			auto r = m->cpu.activeThread()->currentFrame->registers; r.set(0, valueTable(root.address())); r.set(1, key); r.set(8, valueInteger(57));
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 3);
		require(3 - generated.cpu.instructionBudgetRemaining == 2 + (op == OpCode::SELF ? 17 : op == OpCode::GETI ? 8 : 16) + 248,
			"attempted32 visits cost31 extras once, not once in native leaf and again in scalar fault replay");
		require(generated.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP
			&& generated.cpu.readEpcWord() == generated.rom.textAddress + program.starts[1] * INSTRUCTION_BYTES,
			"chain error belongs to actual instruction/prefix start");
		auto r = generated.cpu.activeThread()->frameAtDepth(0)->registers;
		require(r.get(6) == r.get(0) && r.get(8) == valueInteger(57) && (op != OpCode::SELF || r.get(7) == r.get(0)),
			"fault leaves destination and following marker intact but retains SELF receiver");
		sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
		require(test::sameLanguageRam(generated.cpu, scalar.cpu), "guest heap and stack bytes match");
			require(generated.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes()
				&& generated.cpu.luaHeap().collectionTarget() == scalar.cpu.luaHeap().collectionTarget(),
				"physical allocator and pacing words agree");
	}
}

void warmedOneHopUsesLiveMappings() {
	for (bool wide : {false, true}) for (const auto op : {OpCode::GETFIELD, OpCode::SELF, OpCode::GETT}) {
		Program program(op, wide); Machine generated(program, false), scalar(program, true);
		const std::array machines{&generated, &scalar};
		for (auto* m : machines) {
			auto& cpu = m->cpu;
			const auto key = keyFor(cpu, KeyKind::String);
			auto receiver = cpu.createTable(0, 2);
			makeChain(cpu, receiver, 2, key, valueInteger(73));
			auto replacement = cpu.createTable(0, 2);
			replacement.set(key, valueInteger(107));
			auto r = cpu.activeThread()->currentFrame->registers;
			r.set(0, valueTable(receiver.address())); r.set(1, key); r.set(2, valueTable(replacement.address()));
		}
		const int base = op == OpCode::SELF ? 17 : 16;
		const auto check = [&](Value result, int work) {
			const std::array charges{2, base + work, 2};
			for (const int grant : {2, 3, charges[0] + charges[1] + charges[2]}) {
				for (auto* m : machines) {
					m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
					auto* frame = m->cpu.activeThread()->currentFrame;
					frame->registers.set(7, valueNil()); frame->registers.set(8, valueInteger(57));
					frame->writeControl(FrameField::Top, 0x49000003u);
				}
				require(test::runCpuParity(generated.cpu, scalar.cpu, grant) == RunResult::Yielded,
					"one-hop lookup remains runnable across exact and short grants");
				int remaining = grant, completed = 0;
				while (remaining > 0) remaining -= charges[completed++];
				auto* frame = generated.cpu.activeThread()->currentFrame;
				const auto r = frame->registers;
				const u32 top = completed == 3 ? 9u : completed == 2 && op == OpCode::SELF ? 8u : 7u;
				require(generated.cpu.instructionBudgetRemaining == remaining
					&& frame->readControl(FrameField::Pc) == generated.rom.textAddress + program.starts[completed] * INSTRUCTION_BYTES
					&& frame->readControl(FrameField::Top) == (0x49000000u | top),
					"the live lookup charges only visited Tables and publishes exact PC and register top");
				require(r.get(6) == (completed >= 2 ? result : r.get(0))
					&& r.get(7) == (op == OpCode::SELF && completed >= 2 ? r.get(0) : valueNil())
					&& r.get(8) == (completed == 3 ? result : valueInteger(57)),
					"the aliased read and SELF receiver observe live mappings without running an unadmitted successor");
				sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
				require(test::sameLanguageRam(generated.cpu, scalar.cpu), "guest heap and stack bytes match");
			}
		};
		// Warm the published site before changing any of the mappings it observes.
		check(valueInteger(73), 8);
		check(valueInteger(73), 8);
		for (auto* m : machines) {
			auto root = asTable(m->cpu.readFrameRegister(0, 0), m->cpu.gcHeap());
			root.set(m->cpu.readFrameRegister(0, 1), valueBool(false));
		}
		check(valueBool(false), 0);
		for (auto* m : machines) {
			auto root = asTable(m->cpu.readFrameRegister(0, 0), m->cpu.gcHeap());
			root.set(m->cpu.readFrameRegister(0, 1), valueNil());
		}
		check(valueInteger(73), 8);
		for (auto* m : machines) {
			auto& cpu = m->cpu;
			auto root = asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap());
			TableRecord(cpu.gcHeap(), root.metatableAddress()).setStringKey(cpu.stringPool().intern("__index"), cpu.readFrameRegister(0, 2));
		}
		check(valueInteger(107), 8);
		for (auto* m : machines) {
			auto holder = asTable(m->cpu.readFrameRegister(0, 2), m->cpu.gcHeap());
			holder.set(m->cpu.readFrameRegister(0, 1), valueBool(false));
		}
		check(valueBool(false), 8);
		for (auto* m : machines) {
			auto holder = asTable(m->cpu.readFrameRegister(0, 2), m->cpu.gcHeap());
			holder.set(m->cpu.readFrameRegister(0, 1), valueNil());
		}
		check(valueNil(), 8);
	}
}

void stringReceiver() {
	for (bool wide : {false, true}) {
		Program program(OpCode::GETFIELD, wide, true); Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			auto& cpu = m->cpu; auto installed = cpu.createTable(0, 2); const auto key = keyFor(cpu, KeyKind::String);
			makeChain(cpu, installed, 3, key, valueInteger(73));
			auto r = cpu.activeThread()->currentFrame->registers;
			r.set(20, cpu.createBuiltinFunction(BuiltinFunctionId::SetStringIndex)); r.set(21, valueTable(installed.address()));
			r.set(0, valueString(cpu.stringPool().intern("receiver"))); r.set(8, valueInteger(57));
			require(cpu.runUntilDepth(0, 7) == RunResult::Yielded, "the real builtin installs the String index Table");
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 3);
		require(generated.cpu.instructionBudgetRemaining == 3 - 2 - 32
			&& generated.cpu.readFrameRegister(0, 6) == valueInteger(73) && generated.cpu.readFrameRegister(0, 8) == valueInteger(57),
			"String dispatch's first installed Table is covered by base; only two inherited targets add16");
		sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
		require(test::sameLanguageRam(generated.cpu, scalar.cpu), "guest heap and stack bytes match");
			require(generated.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes()
				&& generated.cpu.luaHeap().collectionTarget() == scalar.cpu.luaHeap().collectionTarget(),
				"physical allocator and pacing words agree");
		for (auto* m : {&generated, &scalar}) {
			auto installed = asTable(m->cpu.readFrameRegister(0, 21), m->cpu.gcHeap());
			TableRecord(m->cpu.gcHeap(), installed.metatableAddress()).setStringKey(m->cpu.stringPool().intern("__index"), valueTable(m->cpu.createTable().address()));
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress + program.starts[0] * INSTRUCTION_BYTES);
			m->cpu.activeThread()->currentFrame->writeControl(FrameField::Top, 0x49000001u);
		}
		// Grant exactly the prefix, the live two-table lookup, and its
		// receiving MOV. The earlier run exhausted its grant in the helper.
		test::runCpuParity(generated.cpu, scalar.cpu, 2 + 24 + 2);
		require(generated.cpu.instructionBudgetRemaining == 0
			&& isNil(generated.cpu.readFrameRegister(0, 6)) && isNil(generated.cpu.readFrameRegister(0, 8))
			&& generated.cpu.activeThread()->currentFrame->readControl(FrameField::Top) == 0x49000009u,
			"the updated String lookup resumes its receiving window, publishes its extent, and charges the marker once");
		sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
		require(test::sameLanguageRam(generated.cpu, scalar.cpu), "guest heap and stack bytes match");
			require(generated.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes()
				&& generated.cpu.luaHeap().collectionTarget() == scalar.cpu.luaHeap().collectionTarget(),
				"physical allocator and pacing words agree");
	}
}
} // namespace
int main() {
	try { grantsAndRestore(); faultsOnce(); warmedOneHopUsesLiveMappings(); stringReceiver(); }
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
	return 0;
}
