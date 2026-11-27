#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/closure_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
#include "support/thread_allocation_reference.h"
#include "support/table_allocation_reference.h"

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
	Program(OpCode op, bool wide) {
		image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		u32 word = 0;
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
	Machine(const test::Blua32TestImage& image, bool scalar)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image)),
		  memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		  irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		test::seedManagedFixture(cpu, addresses);
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
		auto next = bmsx::test::allocateTableReference(cpu, 2, 2); auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
		meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(next.address())); current.setMetatableAddress(meta.address()); current = next;
	}
	current.set(key, value);
	return current;
}
void cycle(CPU& cpu, TableRecord root) {
	auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
	meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(root.address())); root.setMetatableAddress(meta.address());
}

void grantsAndRestore() {
	for (bool wide : {false, true}) for (const auto [op, kind] : forms) for (int depth : {1, 2, 3, 5, 32}) {
		Program program(op, wide); Machine generated(program.image, false), scalar(program.image, true);
		const std::array charges{2, (op == OpCode::SELF ? 17 : op == OpCode::GETI ? 8 : 16) + 8 * (depth - 1), 2, 2};
		const int total = charges[0] + charges[1] + charges[2] + charges[3];
		for (auto* m : {&generated, &scalar}) {
			auto root = bmsx::test::allocateTableReference(m->cpu, 2, 2); const auto key = keyFor(m->cpu, kind);
			makeChain(m->cpu, root, depth, key, valueBool(false));
			if (depth == 1) cycle(m->cpu, root);
			auto r = m->cpu.activeThread()->currentFrame->registers; r.set(0, valueTable(root.address())); r.set(1, key);
		}
		const auto heap = generated.cpu.luaHeap().usedBytes();
		for (int grant = 0; grant <= total; ++grant) {
			for (auto* m : {&generated, &scalar}) {
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
				auto& frame = *m->cpu.activeThread()->currentFrame;
				auto r = frame.registers; r.set(6, valueInteger(91)); r.set(7, valueNil()); r.set(8, valueInteger(57));
				frame.setTop(2);
			}
			require(test::runCpuParity(generated.cpu, scalar.cpu, grant) == RunResult::Yielded, "an ordinary read loop remains runnable");
			int remaining = grant, completed = 0;
			while (remaining > 0) remaining -= charges[completed++];
			auto* frame = generated.cpu.activeThread()->currentFrame; auto r = frame->registers;
			require(generated.cpu.instructionBudgetRemaining == remaining, "each additionally visited Table costs exactly8, including debt");
			require(frame->readControl(bmsx::FrameField::Pc) == generated.rom.textAddress + program.starts[completed == 4 ? 0 : completed] * INSTRUCTION_BYTES,
				"the completed read frontier precedes every unadmitted marker");
			const int top = completed >= 3 ? 9 : completed == 2 && op == OpCode::SELF ? 8 : completed != 0 ? 7 : 2;
			require(frame->readWindow(FrameField::Top) == top, "the exhausted grant publishes only results written by admitted instructions");
			if (completed == 2) {
				const auto readPc = generated.rom.textAddress + program.starts[1] * INSTRUCTION_BYTES;
				require(generated.cpu.readCurrentInstructionPc() == readPc
					&& generated.cpu.lastPc == readPc + (wide ? INSTRUCTION_BYTES : 0u),
					"an admitted read owns its prefix and body PCs even when the visit cost exhausts the grant");
			}
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

void exhaustedStringChainCharges() {
	for (int capacity : {8, 256}) for (const auto op : {OpCode::GETFIELD, OpCode::GETT, OpCode::SELF}) {
		Program program(op, false);
		Machine generated(program.image, false), scalar(program.image, true);
		for (auto* m : {&generated, &scalar}) {
			auto& cpu = m->cpu;
			auto root = bmsx::test::allocateTableReference(cpu, 0, capacity);
			auto key = cpu.stringPool().intern("field");
			auto r = cpu.activeThread()->currentFrame->registers;
			r.set(0, valueTable(root.address())); r.set(1, valueString(key));
			const auto home = root.beginStringProbe(key).node;
			for (int n = 0, placed = 0; placed < 8; ++n) {
				const auto candidate = cpu.stringPool().intern("chain" + std::to_string(n));
				if (root.beginStringProbe(candidate).node != home) continue;
				const int slot = root.setStringKey(candidate, valueInteger(++placed));
				if (placed == 4) {
					// A payload match partway down the chain must inspect its tag
					// and resume at this node, with the original traversal bound.
					m->memory.writeRamRecordWord(root.hashAddress() + 4u * slot, key);
					m->memory.writeRamRecordByte(root.hashAddress() + 8u * capacity + slot, static_cast<u8>(ValueTag::Integer));
				}
			}
		}
		const int total = 2 + BASE_CYCLES[static_cast<u8>(op)] + 7;
		for (int grant : {3, total - 1, total, total + 1}) {
			for (auto* m : {&generated, &scalar}) {
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
				m->cpu.activeThread()->currentFrame->registers.set(8, valueInteger(91));
			}
			test::runCpuParity(generated.cpu, scalar.cpu, grant);
			const bool marker = grant > total;
			require(generated.cpu.instructionBudgetRemaining == grant - total - (marker ? 2 : 0)
				&& isNil(generated.cpu.readFrameRegister(0, 6))
				&& generated.cpu.readFrameRegister(0, 8) == (marker ? valueNil() : valueInteger(91)),
				"an eight-node absent String key charges seven cycles before the following instruction");
		}
		for (auto* m : {&generated, &scalar}) {
			auto& cpu = m->cpu;
			auto root = asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap());
			cycle(cpu, root);
			// Close the actual tail link onto home. Only the visit bound,
			// not a negative link, can terminate this raw RAM chain.
			const auto key = cpu.stringPool().intern("field");
			auto probe = root.beginStringProbe(key);
			const int home = probe.node;
			root.advanceStringProbe(key, probe, 7);
			const auto links = root.hashAddress() + capacity * 10u;
			if (capacity <= TableRecord::BYTE_LINK_CAPACITY) m->memory.writeRamRecordByte(links + probe.node, static_cast<u8>(home));
			else m->memory.writeRamRecordWord(links + 4u * probe.node, home);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 3);
		require(generated.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP
			&& 3 - generated.cpu.instructionBudgetRemaining == 2 + BASE_CYCLES[static_cast<u8>(op)] + 32 * (capacity - 1) + 31 * TABLE_INDEX_VISIT_CYCLES,
			"fault replay pays all 32 searches and 31 inherited visits exactly once");
	}
}

void growingStringHitCharges() {
	for (const auto op : {OpCode::GETFIELD, OpCode::GETT, OpCode::SELF}) {
		Program program(op, false);
		Machine generated(program.image, false), scalar(program.image, true);
		int n = 0, previousDepth = 0;
		for (int depth : {64, 65, 96}) {
			int next = n;
			for (auto* m : {&generated, &scalar}) {
				auto& cpu = m->cpu;
				const auto key = keyFor(cpu, KeyKind::String);
				auto r = cpu.activeThread()->currentFrame->registers;
				auto table = depth == 64 ? bmsx::test::allocateTableReference(cpu, 0, 128) : asTable(r.get(0), cpu.gcHeap());
				r.set(0, valueTable(table.address())); r.set(1, key);
				const auto home = hashCanonicalTableKey(key) & 127u;
				next = n;
				for (int i = previousDepth; i < depth; ++i) {
					if (i == 1) table.set(key, valueInteger(73));
					else {
						Value other;
						do other = valueInteger(next++); while ((hashCanonicalTableKey(other) & 127u) != home);
						table.set(other, valueBool(false));
					}
				}
				auto probe = table.beginStringProbe(asStringId(key));
				require(table.advanceStringProbe(asStringId(key), probe, 128) == static_cast<size_t>(depth)
					&& probe.value == valueInteger(73), "the field stays at the live chain tail");
			}
			n = next; previousDepth = depth;
			const int charge = 2 + BASE_CYCLES[static_cast<u8>(op)] + depth - 64;
			for (const int grant : {3, charge, charge + 1}) {
				for (auto* m : {&generated, &scalar}) {
					m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
					m->cpu.activeThread()->currentFrame->registers.set(8, valueInteger(91));
				}
				test::runCpuParity(generated.cpu, scalar.cpu, grant);
				const bool marker = grant > charge;
				require(generated.cpu.instructionBudgetRemaining == grant - charge - (marker ? 2 : 0)
					&& generated.cpu.readFrameRegister(0, 6) == valueInteger(73)
					&& generated.cpu.readFrameRegister(0, 8) == valueInteger(marker ? 73 : 91),
					"training a still-valid slot cannot hide a growing successful chain from the grant");
			}
		}
		for (auto* m : {&generated, &scalar}) {
			auto& cpu = m->cpu;
			auto root = asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap());
			const auto key = keyFor(cpu, KeyKind::String);
			root.set(key, valueNil());
			makeChain(cpu, root, 2, key, valueBool(false));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 3);
		require(3 - generated.cpu.instructionBudgetRemaining == 2 + BASE_CYCLES[static_cast<u8>(op)] + 32 + TABLE_INDEX_VISIT_CYCLES
			&& generated.cpu.readFrameRegister(0, 6) == valueBool(false),
			"a matched tombstone retains its hit cost when the lookup continues on another table");
	}
}

void directIndexMemberWork() {
	for (const auto [op, kind] : forms) for (bool inherited : {false, true}) {
		Program program(op, false);
		Machine generated(program.image, false), scalar(program.image, true);
		for (auto* m : {&generated, &scalar}) {
			auto& cpu = m->cpu;
			auto receiver = bmsx::test::allocateTableReference(cpu), meta = bmsx::test::allocateTableReference(cpu, 0, 128), parent = bmsx::test::allocateTableReference(cpu, 2, 1);
			const auto key = keyFor(cpu, kind);
			const auto method = valueString(cpu.stringPool().intern("__index"));
			const u32 home = hashCanonicalTableKey(method) & 127u;
			receiver.setMetatableAddress(meta.address());
			parent.set(key, valueBool(false));
			auto r = cpu.activeThread()->currentFrame->registers;
			r.set(0, valueTable(receiver.address())); r.set(1, key);
			for (int i = 0, n = 0; i < 96; ++i) {
				if (inherited && i == 1) meta.set(method, valueTable(parent.address()));
				else {
					Value other;
					do other = valueInteger(n++); while ((hashCanonicalTableKey(other) & 127u) != home);
					meta.set(other, valueInteger(i));
				}
			}
		}
		const int total = 2 + BASE_CYCLES[static_cast<u8>(op)] + (inherited ? 32 + TABLE_INDEX_VISIT_CYCLES : 95);
		for (int grant : {3, total, total + 1}) {
			for (auto* m : {&generated, &scalar}) {
				m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
				m->cpu.activeThread()->currentFrame->registers.set(8, valueInteger(91));
			}
			test::runCpuParity(generated.cpu, scalar.cpu, grant);
			const Value expected = inherited ? valueBool(false) : valueNil();
			const bool marker = grant > total;
			require(generated.cpu.instructionBudgetRemaining == grant - total - (marker ? 2 : 0)
				&& generated.cpu.readFrameRegister(0, 6) == expected
				&& generated.cpu.readFrameRegister(0, 8) == (marker ? expected : valueInteger(91)),
				"the direct __index probe is paid once even for a non-String requested key");
		}
		if (inherited) {
			for (auto* m : {&generated, &scalar}) {
				auto& cpu = m->cpu;
				const auto receiver = cpu.readFrameRegister(0, 0);
				auto root = asTable(receiver, cpu.gcHeap());
				TableRecord(cpu.gcHeap(), root.metatableAddress()).setStringKey(cpu.stringPool().intern("__index"), receiver);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			}
			test::runCpuParity(generated.cpu, scalar.cpu, 3);
			require(generated.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP
				&& 3 - generated.cpu.instructionBudgetRemaining == 2 + BASE_CYCLES[static_cast<u8>(op)] + 32 * 32 + 31 * TABLE_INDEX_VISIT_CYCLES,
				"a fault retains every direct method search without repaying speculative native probes");
		}
	}
}

void periodicIndexChainKeepsThePartialTail() {
	Program program(OpCode::GETFIELD, false);
	Machine generated(program.image, false), scalar(program.image, true);
	constexpr std::array next{1, 2, 3, 4, 2};
	for (auto* m : {&generated, &scalar}) {
		auto& cpu = m->cpu;
		const std::array roots{bmsx::test::allocateTableReference(cpu), bmsx::test::allocateTableReference(cpu), bmsx::test::allocateTableReference(cpu), bmsx::test::allocateTableReference(cpu), bmsx::test::allocateTableReference(cpu)};
		const auto method = valueString(cpu.stringPool().intern("__index")), key = keyFor(cpu, KeyKind::String);
		const u32 home = hashCanonicalTableKey(method) & 127u;
		for (size_t i = 0; i < roots.size(); ++i) {
			auto meta = bmsx::test::allocateTableReference(cpu, 0, 128);
			auto receiver = roots[i];
			receiver.setMetatableAddress(meta.address());
			for (int j = 0, n = 0; j < 65 + static_cast<int>(i); ++j) {
				if (j == 1) meta.set(method, valueTable(roots[next[i]].address()));
				else {
					Value other;
					do other = valueInteger(n++); while ((hashCanonicalTableKey(other) & 127u) != home);
					meta.set(other, valueBool(false));
				}
			}
		}
		u32 links = 0;
		int position = 0;
		TableLookupResult result;
		for (u32 limit = 1; limit <= TABLE_INDEX_CHAIN_LIMIT; ++limit) {
			links += 1 + position;
			position = next[position];
			require(roots[0].resolveIndex(key, result, limit) == links && result.extraVisits == limit - 1
				&& result.status == TableLookupStatus::ChainExhausted,
				"a nonuniform period after an acyclic prefix charges exactly the admitted visits and fractional last period");
		}
		cpu.activeThread()->currentFrame->registers.set(0, valueTable(roots[0].address()));
	}
	test::runCpuParity(generated.cpu, scalar.cpu, 3);
	// Two prefix visits (1+2), then ten periods of 3+4+5.
	require(3 - generated.cpu.instructionBudgetRemaining == 2 + BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)] + 123 + 31 * TABLE_INDEX_VISIT_CYCLES
		&& generated.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP,
		"the generated read publishes the same complete periodic fault as the scalar path");
}

void faultsOnce() {
	for (bool wide : {false, true}) for (const auto [op, kind] : forms) for (bool cyclic : {false, true}) {
		Program program(op, wide); Machine generated(program.image, false), scalar(program.image, true);
		for (auto* m : {&generated, &scalar}) {
			auto root = bmsx::test::allocateTableReference(m->cpu, 2, 2); const auto key = keyFor(m->cpu, kind);
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
		Program program(op, wide); Machine generated(program.image, false), scalar(program.image, true);
		const std::array machines{&generated, &scalar};
		for (auto* m : machines) {
			auto& cpu = m->cpu;
			const auto key = keyFor(cpu, KeyKind::String);
			auto receiver = bmsx::test::allocateTableReference(cpu, 0, 2);
			makeChain(cpu, receiver, 2, key, valueInteger(73));
			auto replacement = bmsx::test::allocateTableReference(cpu, 0, 2);
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

void callableIndexUsesARealDetachedActivation() {
	constexpr u32 handlerWord = 72;
	for (bool wide : {false, true}) for (const auto op : {OpCode::GETFIELD, OpCode::GETI, OpCode::GETT, OpCode::SELF}) {
		Program program(op, wide);
		writeInstruction(program.image.text, handlerWord, static_cast<u8>(OpCode::RET), 0, 3, 0);
		program.image.functions.push_back({.firstWord=handlerWord, .wordCount=1, .numParams=2, .maxStack=8});
		Machine generated(program.image, false), scalar(program.image, true);
		const std::array machines{&generated, &scalar};
		for (auto* m : machines) {
			auto& cpu = m->cpu;
			const Value key = op == OpCode::GETI ? valueInteger(1) : op == OpCode::GETT ? valueFloat(1.0f) : keyFor(cpu, KeyKind::String);
			const u32 closure = test::seedTestCapturedClosure(cpu, m->rom.functionAddresses[2], {});
			auto& thread = *cpu.activeThread();
			thread.reserveFrame(thread.stackTop() + 8); // The exact grant measures placement, not acquiring storage.
			auto* frame = cpu.activeThread()->currentFrame;
			frame->registers.set(3, valueClosure(closure));
			frame->writeControl(FrameField::Top, 0x4900000bu);
			auto root = bmsx::test::allocateTableReference(cpu, 0, 2);
			frame->registers.set(0, valueTable(root.address())); frame->registers.set(1, key);
			auto receiver = makeChain(cpu, root, 2, key, valueNil());
			frame->registers.set(2, valueTable(receiver.address()));
			auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
			meta.setStringKey(cpu.stringPool().intern("__index"), frame->registers.get(3));
			receiver.setMetatableAddress(meta.address());
			frame->registers.set(8, valueInteger(57)); frame->registers.set(9, valueInteger(99));
		}
		const int baseCycles = BASE_CYCLES[static_cast<u8>(op)];
		const int callCycles = 2 + baseCycles + TABLE_INDEX_VISIT_CYCLES + 2;
		const int grant = wide ? 3 : callCycles;
		require(test::runCpuParity(generated.cpu, scalar.cpu, grant) == RunResult::Yielded,
			"a short grant suspends after entering the metamethod, before its first instruction");
		const auto* caller = generated.cpu.activeThread()->firstFrame;
		const auto* handler = generated.cpu.activeThread()->currentFrame;
		const auto readPc = generated.rom.textAddress + program.starts[1] * INSTRUCTION_BYTES;
		const auto nextPc = generated.rom.textAddress + program.starts[2] * INSTRUCTION_BYTES;
		require(generated.cpu.instructionBudgetRemaining == grant - callCycles
			&& handler->previous == caller && handler->stackBase() >= caller->stackBase() + caller->stackCapacity()
			&& handler->readControl(FrameField::CallSite) == readPc && caller->readControl(FrameField::Pc) == nextPc,
			"the indexed read charges one traversal and admits a non-overlapping frame at the original opcode PC");
		require(handler->registers.get(0) == caller->registers.get(2) && handler->registers.get(1) == caller->registers.get(1)
			&& caller->registers.get(6) == caller->registers.get(0)
			&& (op != OpCode::SELF || caller->registers.get(7) == caller->registers.get(0)),
			"the current forwarded receiver and original key reach the handler, while SELF keeps its initial receiver");
		sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
		require(test::sameLanguageRam(generated.cpu, scalar.cpu), "pending method call has the same guest frame and arguments");
		const std::array ram{generated.memory.captureSaveState(), scalar.memory.captureSaveState()};
		const std::array cpu{generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState()};
		const std::array successorGrants{0, 0, 2};
		for (size_t pass = 0; pass < successorGrants.size(); ++pass) {
			if (pass != 0) for (size_t i = 0; i < machines.size(); ++i) {
				machines[i]->memory.restoreSaveState(ram[i]);
				machines[i]->cpu.restoreRuntimeState(cpu[i]);
			}
			const int successorCycles = successorGrants[pass];
			const int returnCycles = BASE_CYCLES[static_cast<u8>(OpCode::RET)];
			test::runCpuParity(generated.cpu, scalar.cpu, returnCycles + 1 + successorCycles);
			const auto* frame = generated.cpu.activeThread()->currentFrame;
			const u32 frontier = generated.rom.textAddress + program.starts[successorCycles != 0 ? 3 : 2] * INSTRUCTION_BYTES;
			require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.getFrameDepth() == 1
				&& frame->readControl(FrameField::Pc) == frontier && frame->readControl(FrameField::Top) == 0x4900000bu
				&& frame->registers.get(6) == frame->registers.get(2)
				&& frame->registers.get(8) == (successorCycles != 0 ? frame->registers.get(2) : valueInteger(57))
				&& frame->registers.get(9) == valueInteger(99),
				"RET places only the first result, preserves caller top, and executes only the admitted successor");
			sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
			require(test::sameLanguageRam(generated.cpu, scalar.cpu), "restored method return has identical guest state");
			if (successorCycles == 0) test::runCpuParity(generated.cpu, scalar.cpu, 2);
			require(generated.cpu.readFrameRegister(0, 8) == generated.cpu.readFrameRegister(0, 2),
				"the successor consumes the placed result without re-running the index");
		}
	}
}

void builtinIndexPreservesResultAndFaultBoundaries() {
	for (bool wide : {false, true}) for (bool fault : {false, true}) {
		Program program(OpCode::SELF, wide); Machine generated(program.image, false), scalar(program.image, true);
		for (auto* m : {&generated, &scalar}) {
			auto root = bmsx::test::allocateTableReference(m->cpu, 0, 1), meta = bmsx::test::allocateTableReference(m->cpu, 0, 1);
			meta.setStringKey(m->cpu.stringPool().intern("__index"), m->cpu.createBuiltinFunction(fault ? BuiltinFunctionId::Error : BuiltinFunctionId::Type));
			root.setMetatableAddress(meta.address());
			auto* frame = m->cpu.activeThread()->currentFrame;
			frame->registers.set(0, valueTable(root.address())); frame->registers.set(8, valueInteger(57));
			frame->writeControl(FrameField::Top, 0x4900000bu);
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 3);
		const auto* frame = generated.cpu.activeThread()->firstFrame;
		require(frame->registers.get(7) == frame->registers.get(0) && frame->registers.get(8) == valueInteger(57)
			&& frame->readControl(FrameField::Top) == 0x4900000bu,
			"method lookup preserves SELF's receiver and the original caller top even when invocation faults");
		if (fault) {
			require(generated.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_EXPLICIT_ERROR
				&& generated.cpu.readEpcWord() == generated.rom.textAddress + program.starts[1] * INSTRUCTION_BYTES
				&& frame->registers.get(6) == frame->registers.get(0),
				"faulting builtin indexer blames the original narrow/WIDE SELF and leaves its result untouched");
		} else {
			const Value result = frame->registers.get(6);
			require(valueIsString(result) && generated.cpu.stringPool().toString(asStringId(result)) == "table"
				&& generated.cpu.instructionBudgetRemaining == 3 - 2 - 17 - 1 - 1,
				"the builtin sees the receiver Table and returns one result at its ordinary primitive price");
		}
		sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
		require(test::sameLanguageRam(generated.cpu, scalar.cpu), "builtin method effects agree across CPU backends");
	}
}

void suspendedIndexRestoresItsPlacement() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	const auto put = [&](u32 word, OpCode op, int a = 0, int b = 0, int c = 0) {
		writeInstruction(image.text, word, static_cast<u8>(op), a, b, c);
	};
	put(0, OpCode::K1, 10);
	put(1, OpCode::WIDE); put(2, OpCode::SELF, 0);
	put(3, OpCode::HALT);
	put(64, OpCode::HALT);
	put(65, OpCode::RET, 0, 2);
	image.constants = {std::string("field")};
	image.functions = {{.firstWord=0, .wordCount=4, .maxStack=12}, {.firstWord=64, .wordCount=2, .numParams=2, .maxStack=2}};
	Machine generated(image, false), scalar(image, true);
	const std::array machines{&generated, &scalar};
	for (auto* m : machines) {
		auto& cpu = m->cpu;
		const u32 entry = test::seedTestCapturedClosure(cpu, m->rom.functionAddresses[1], {});
		auto root = bmsx::test::allocateTableReference(cpu, 0, 1), meta = bmsx::test::allocateTableReference(cpu, 0, 1);
		meta.setStringKey(cpu.stringPool().intern("__index"), valueClosure(entry));
		root.setMetatableAddress(meta.address());
		auto* thread = cpu.rootThread();
		cpu.luaHeap().reserveThreadFrameStorage(thread->address, 32u, 4u, valueClosure(entry));
		thread->bindStack();
		thread->currentFrame->registers.set(0, valueTable(root.address()));
		thread->currentFrame->extendTop(1);
	}
	for (int grant = 0; grant < 12 && !generated.cpu.isHaltedUntilIrq(); ++grant)
		test::runCpuParity(generated.cpu, scalar.cpu, 1);
	const auto* indexer = generated.cpu.activeThread()->currentFrame;
	require(generated.cpu.isHaltedUntilIrq() && generated.cpu.getFrameDepth() == 2
		&& indexer->readControl(FrameField::Function) == generated.rom.functionAddresses[1]
		&& indexer->registers.get(0) == indexer->previous->registers.get(1)
		&& indexer->registers.get(1) == keyFor(generated.cpu, KeyKind::String),
		"SELF's ordinary indexer suspends with the original receiver and key");
	const std::array ram{generated.memory.captureSaveState(), scalar.memory.captureSaveState()};
	const std::array cpu{generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState()};
	for (bool replay : {false, true}) {
		if (replay) for (size_t i = 0; i < machines.size(); ++i) {
			machines[i]->memory.restoreSaveState(ram[i]); machines[i]->cpu.restoreRuntimeState(cpu[i]);
		}
		for (auto* machine : machines) {
			machine->cpu.activeThread()->currentFrame->registers.set(0, valueInteger(17));
			machine->cpu.clearHaltUntilIrq();
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 1);
		const auto* caller = generated.cpu.activeThread()->currentFrame;
		require(generated.cpu.getFrameDepth() == 1
			&& caller->readControl(FrameField::Pc) == generated.rom.textAddress + 3 * INSTRUCTION_BYTES
			&& caller->readWindow(FrameField::Top) == 11 && caller->registers.get(0) == valueInteger(17)
			&& valueIsTable(caller->registers.get(1)) && caller->registers.get(10) == valueInteger(1),
			"the resumed indexer fills only the selected result without shortening the live caller window");
		sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
		require(test::sameLanguageRam(generated.cpu, scalar.cpu), "suspended and restored indexers have identical guest state");
	}
}

void stringReceiver() {
	for (bool wide : {false, true}) {
		Program program(OpCode::GETFIELD, wide); Machine generated(program.image, false), scalar(program.image, true);
		for (auto* m : {&generated, &scalar}) {
			auto& cpu = m->cpu; auto installed = bmsx::test::allocateTableReference(cpu, 0, 2); const auto key = keyFor(cpu, KeyKind::String);
			makeChain(cpu, installed, 3, key, valueInteger(73));
			const u32 head = cpu.heapAllocator().managementOffset() + HEAP_SERVICE_REMARK_HEAD_OFFSET;
			m->memory.writeRamRecordWord(head + static_cast<u32>(HeapServiceRemarkHeadField::StringIndexTag), static_cast<u32>(ValueTag::Table));
			m->memory.writeRamRecordWord(head + static_cast<u32>(HeapServiceRemarkHeadField::StringIndexWord), installed.address());
			auto r = cpu.activeThread()->currentFrame->registers;
			r.set(0, valueString(cpu.stringPool().intern("receiver"))); r.set(8, valueInteger(57));
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
			TableRecord installed(m->cpu.gcHeap(), m->cpu.gcHeap().diagnosticWord(HeapServiceRemarkHeadField::StringIndexWord));
			TableRecord(m->cpu.gcHeap(), installed.metatableAddress()).setStringKey(m->cpu.stringPool().intern("__index"), valueTable(bmsx::test::allocateTableReference(m->cpu).address()));
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
	try {
		grantsAndRestore(); exhaustedStringChainCharges(); growingStringHitCharges(); directIndexMemberWork(); periodicIndexChainKeepsThePartialTail(); faultsOnce(); warmedOneHopUsesLiveMappings();
		callableIndexUsesARealDetachedActivation(); builtinIndexPreservesResultAndFaultBoundaries();
		suspendedIndexRestoresItsPlacement(); stringReceiver();
	}
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
	return 0;
}
