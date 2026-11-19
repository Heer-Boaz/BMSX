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
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words())
		&& std::ranges::equal(a.snapshot.objectWords(), b.snapshot.objectWords())
		&& a.nextObjectHashId == b.nextObjectHashId && a.luaHeap.trackedBytes == b.luaHeap.trackedBytes
		&& a.luaHeap.nextCollectionBytes == b.luaHeap.nextCollectionBytes && a.epcWord == b.epcWord
		&& a.luaFaultReasonWord == b.luaFaultReasonWord && a.lastPc == b.lastPc,
		"complete guest graphs, heap/collector thresholds and instruction/fault boundaries match");
}
Value keyFor(CPU& cpu, KeyKind kind) {
	return kind == KeyKind::String ? valueString(cpu.stringPool().intern("field"))
		: kind == KeyKind::Integer ? valueInteger(1) : valueBool(false);
}
Table* makeChain(CPU& cpu, Table* root, int depth, Value key, Value value) {
	auto* current = root;
	for (int i = 1; i < depth; ++i) {
		auto* next = cpu.createTable(2, 2); auto* meta = cpu.createTable(0, 1);
		meta->setStringKey(cpu.stringPool().intern("__index"), valueTable(cpu.gcHeap().reference(next))); current->setMetatable(meta); current = next;
	}
	current->set(key, value);
	return current;
}
void cycle(CPU& cpu, Table* root) {
	auto* meta = cpu.createTable(0, 1);
	meta->setStringKey(cpu.stringPool().intern("__index"), valueTable(cpu.gcHeap().reference(root))); root->setMetatable(meta);
}

void grantsAndRestore() {
	for (bool wide : {false, true}) for (const auto [op, kind] : forms) for (int depth : {1, 2, 5, 32}) {
		Program program(op, wide); Machine generated(program, false), scalar(program, true);
		const std::array charges{2, (op == OpCode::SELF ? 17 : op == OpCode::GETI ? 8 : 16) + 8 * (depth - 1), 2, 2};
		const int total = charges[0] + charges[1] + charges[2] + charges[3];
		for (auto* m : {&generated, &scalar}) {
			auto* root = m->cpu.createTable(2, 2); const auto key = keyFor(m->cpu, kind);
			makeChain(m->cpu, root, depth, key, valueBool(false));
			if (depth == 1) cycle(m->cpu, root);
			auto r = m->cpu.activeThread()->currentFrame->registers; r.set(0, valueTable(m->cpu.gcHeap().reference(root))); r.set(1, key);
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
			require(frame->pc == generated.rom.textAddress + program.starts[completed == 4 ? 0 : completed] * INSTRUCTION_BYTES,
				"the completed read frontier precedes every unadmitted marker");
			require(r.get(6) == (completed >= 2 ? valueBool(false) : completed == 1 ? r.get(0) : valueInteger(91))
				&& r.get(8) == (completed >= 3 ? valueBool(false) : valueInteger(57))
				&& r.get(7) == (op == OpCode::SELF && completed >= 2 ? r.get(0) : valueNil()),
				"aliased result, following marker and SELF receiver publish at their actual instruction boundaries");
			sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
		}
		// Reusing a prototype result may repair slot hints, never change its price.
		require(generated.cpu.luaHeap().usedBytes() == heap, "lookups do not allocate guest storage");
		for (auto* m : {&generated, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			const auto before = m->cpu.captureRuntimeState();
			m->cpu.runUntilDepth(0, 3); const auto after = m->cpu.captureRuntimeState(); const int debt = m->cpu.instructionBudgetRemaining;
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
			auto* root = m->cpu.createTable(2, 2); const auto key = keyFor(m->cpu, kind);
			if (cyclic) cycle(m->cpu, root); else makeChain(m->cpu, root, 33, key, valueInteger(73));
			auto r = m->cpu.activeThread()->currentFrame->registers; r.set(0, valueTable(m->cpu.gcHeap().reference(root))); r.set(1, key); r.set(8, valueInteger(57));
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
	}
}

void stringReceiver() {
	for (bool wide : {false, true}) {
		Program program(OpCode::GETFIELD, wide, true); Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			auto& cpu = m->cpu; auto* installed = cpu.createTable(0, 2); const auto key = keyFor(cpu, KeyKind::String);
			makeChain(cpu, installed, 3, key, valueInteger(73));
			auto r = cpu.activeThread()->currentFrame->registers;
			r.set(20, cpu.createBuiltinFunction(BuiltinFunctionId::SetStringIndex)); r.set(21, valueTable(cpu.gcHeap().reference(installed)));
			r.set(0, valueString(cpu.stringPool().intern("receiver"))); r.set(8, valueInteger(57));
			require(cpu.runUntilDepth(0, 7) == RunResult::Yielded, "the real builtin installs the String index Table");
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 3);
		require(generated.cpu.instructionBudgetRemaining == 3 - 2 - 32
			&& generated.cpu.readFrameRegister(0, 6) == valueInteger(73) && generated.cpu.readFrameRegister(0, 8) == valueInteger(57),
			"String dispatch's first installed Table is covered by base; only two inherited targets add16");
		sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
		for (auto* m : {&generated, &scalar}) {
			auto* installed = asTable(m->cpu.readFrameRegister(0, 21), m->cpu.gcHeap());
			installed->metatable()->setStringKey(m->cpu.stringPool().intern("__index"), valueTable(m->cpu.gcHeap().reference(m->cpu.createTable())));
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress + program.starts[0] * INSTRUCTION_BYTES);
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 3);
		require(generated.cpu.instructionBudgetRemaining == 3 - 2 - 24 && isNil(generated.cpu.readFrameRegister(0, 6)),
			"live prototype replacement uses the new two-Table path and resolved nil has no fault");
		sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
	}
}
} // namespace
int main() {
	try { grantsAndRestore(); faultsOnce(); stringReceiver(); }
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
	return 0;
}
