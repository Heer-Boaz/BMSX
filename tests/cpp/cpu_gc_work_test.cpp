#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
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
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

test::Blua32TestImage image(OpCode operation = OpCode::HALT, bool wide = false) {
	test::Blua32TestImage result;
	result.text.resize(MAPPED_PAGE_BYTE_SIZE);
	u32 word = 0;
	if (wide) writeInstruction(result.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(result.text, word++, static_cast<u8>(operation), 0,
		operation == OpCode::NEWT ? 2 : 1, 1);
	writeInstruction(result.text, word++, static_cast<u8>(OpCode::KSMI), 7, 0, 37);
	writeInstruction(result.text, word++, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	result.functions = {{.firstWord=0, .wordCount=word, .maxStack=8}};
	result.constants = {std::monostate{}, 12.0, std::string("ROM text does not own guest text bytes")};
	result.systemGlobalNames = {"system", "system"};
	result.globalNames = {"global", "global"};
	return result;
}

struct Machine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	Machine(const test::Blua32TestImage& source, bool scalar = false)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, source)),
		memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
};

void canonicalPoolAndRootRanges() {
	Machine machine(image()); auto& cpu = machine.cpu;
	// __index7 + __mode6 + Thread(64+8*8) + static root Closure16.
	require(cpu.luaHeap().usedBytes() == 157, "boot pool is the literal canonical allocation sum, not host object sizes");
	cpu.instructionBudgetRemaining = 7;
	cpu.luaHeap().collectRuntime();
	// B157 => 2*40; C3 =>6; S1+G1 =>6, duplicate names share roots.
	require(cpu.instructionBudgetRemaining == -85, "runtime collection adds literal92 including complete nil root ranges");
	require(cpu.luaHeap().usedBytes() == 157, "readonly ROM String bytes are not charged as allocated text");
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers[0] = valueTable(cpu.createTable(2, 3)); //32+16+80=128.
	frame.registers[1] = valueString(cpu.stringPool().intern("é😀")); //6 UTF8 bytes.
	frame.top = 2;
	require(cpu.luaHeap().usedBytes() == 291, "canonical reserved table capacity and UTF8 text bytes agree");
	cpu.instructionBudgetRemaining = 7;
	cpu.luaHeap().collectRuntime();
	require(cpu.instructionBudgetRemaining == -151 && cpu.luaHeap().usedBytes() == 291,
		"aggregate B291 rounds once to73 words, giving literal158 including roots");
	const auto threshold = cpu.luaHeap().captureState();
	require(threshold.nextCollectionBytes == 1048576, "the existing minimum collection threshold is unchanged");
	cpu.instructionBudgetRemaining = 123;
	cpu.collectHeap();
	require(cpu.instructionBudgetRemaining == 123, "host/reset raw collection does not bill guest work");
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	require(cpu.instructionBudgetRemaining == 123 && cpu.luaHeap().captureState().trackedBytes == 291,
		"snapshot capture/restore does not collect or bill runtime work and preserves canonical accounting");
	cpu.reset();
	require(cpu.instructionBudgetRemaining == 123 && cpu.luaHeap().usedBytes() == 157,
		"reset installation and raw maintenance collection do not execute or bill guest work");
}

void explicitCollectionAndNoReplay() {
	for (bool wide : {false, true}) {
		Machine generated(image(OpCode::CALL, wide)), scalar(image(OpCode::CALL, wide), true);
		for (auto* m : {&generated, &scalar}) {
			auto& frame = *m->cpu.rootThread()->currentFrame;
			frame.registers[0] = m->cpu.createBuiltinFunction(BuiltinFunctionId::CollectGarbage);
			frame.top = 1;
		}
		require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Yielded
			&& generated.cpu.instructionBudgetRemaining == -127,
			"explicit primitive retains CALL32+primitive4+collection92 after short grant, without receiving slots");
		require(generated.cpu.readFramePc(0) == generated.rom.textAddress + (wide ? 8 : 4)
			&& isNil(generated.cpu.readFrameRegister(0, 7)), "collection completes but cannot execute its successor");
		test::runCpuParity(generated.cpu, scalar.cpu, 0);
		require(generated.cpu.instructionBudgetRemaining == 0 && isNil(generated.cpu.readFrameRegister(0, 7)),
			"zero grant performs no replay or collection");
		test::runCpuParity(generated.cpu, scalar.cpu, 2);
		require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.readFrameRegister(0, 7) == valueNumber(37),
			"fresh grant executes only the actual successor, not the completed builtin");
	}
}

void allocationCollectionAndFailure() {
	for (bool wide : {false, true}) {
		Machine generated(image(OpCode::NEWT, wide)), scalar(image(OpCode::NEWT, wide), true);
		for (auto* m : {&generated, &scalar}) {
			const auto before = m->cpu.luaHeap().captureState();
			m->cpu.luaHeap().restoreState({before.trackedBytes, 0});
		}
		require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Yielded
			&& generated.cpu.instructionBudgetRemaining == -119,
			"automatic GC bills pre-request92 plus NEWT24 and four initialized Values exactly once");
		require(generated.cpu.luaHeap().usedBytes() == 225 && valueIsTable(generated.cpu.readFrameRegister(0, 0))
			&& isNil(generated.cpu.readFrameRegister(0, 7)), "request68 is admitted after collection, not included in its bill");
		test::runCpuParity(generated.cpu, scalar.cpu, 2);
		require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.readFrameRegister(0, 7) == valueNumber(37),
			"allocation and GC are not replayed on the next grant");
	}
	Machine failure(image()); auto& cpu = failure.cpu;
	cpu.instructionBudgetRemaining = 1;
	bool failed = false;
	try { cpu.luaHeap().reserve(4 * 1024 * 1024); }
	catch (const LuaOutOfMemorySignal&) { failed = true; }
	require(failed && cpu.instructionBudgetRemaining == -91 && cpu.luaHeap().usedBytes() == 157,
		"failed oversized admission retains literal92 collection charge, not pending request bytes");
	cpu.runUntilDepth(0, 1);
	require(cpu.instructionBudgetRemaining == -1, "out-of-run reserve debt is transient and overwritten by the next run grant");
}

void allActivatedImagesAndUniqueGlobals() {
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, image());
	auto cartSource = image();
	cartSource.constants = {std::monostate{}, 1.0, 2.0, std::string("card0")};
	cartSource.globalNames = {"global", "card0", "card0"};
	const auto card0 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartSource);
	cartSource.constants = {std::string("card1")};
	cartSource.globalNames = {"global", "card1"};
	const auto card1 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartSource);
	Memory memory(MemoryInit{system.bytes, test::cartridgeSlots(card0.bytes, card1.bytes)}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
	cpu.reset();
	cpu.writeFrameExecution(0, 0, card0.functionAddresses[0], card0.textAddress);
	cpu.writeFrameExecution(0, 1, card1.functionAddresses[0], card1.textAddress);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.functionAddresses[0], system.textAddress);
	cpu.collectHeap();
	require(cpu.luaHeap().usedBytes() == 157, "retired closures and readonly image payloads do not inflate the live pool");
	cpu.instructionBudgetRemaining = 5;
	cpu.luaHeap().collectRuntime();
	// C=3+4+1, S=1, G=3; all activated images remain roots, not only the current system image.
	require(cpu.instructionBudgetRemaining == -103,
		"literal108 bills all resident image ranges and unique cross-image slot identities");
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	cpu.instructionBudgetRemaining = 5;
	cpu.luaHeap().collectRuntime();
	require(cpu.instructionBudgetRemaining == -103, "restored residency and registered ranges reproduce the same collection bill");
}

void temporaryRootsAndUnreachablePool() {
	Machine machine(image()); auto& cpu = machine.cpu;
	Table* table = cpu.createTable(); //32; retained only by the reserve temporary root.
	const auto id = cpu.stringPool().intern("é😀"); //6; another temporary root.
	const auto before = cpu.luaHeap().captureState();
	require(before.trackedBytes == 195, "precollection includes currently unreachable allocations");
	cpu.luaHeap().restoreState({before.trackedBytes, 0});
	cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap().reserve(0, valueTable(table), valueString(id));
	//2*ceil(195/4)=98, plus12 root words.
	require(cpu.instructionBudgetRemaining == -109 && cpu.luaHeap().usedBytes() == 195
		&& cpu.stringPool().toString(id) == "é😀", "all reserve temporary roots survive one charged collection");
	cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap().collectRuntime();
	require(cpu.instructionBudgetRemaining == -109 && cpu.luaHeap().usedBytes() == 157,
		"bill uses precollection dead bytes, not the surviving pool");
}
}

int main() {
	try {
		canonicalPoolAndRootRanges(); explicitCollectionAndNoReplay();
		allocationCollectionAndFailure(); allActivatedImagesAndUniqueGlobals(); temporaryRootsAndUnreachablePool();
		std::cout << "guest GC work tests passed\n";
		return 0;
	} catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
