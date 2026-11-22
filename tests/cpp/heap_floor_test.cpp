#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "machine/runtime/history/ram_history.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <array>

#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

constexpr u32 SYSTEM_BSS = DYNAMIC_RAM_BASE + 0x00010000u;
constexpr u32 CART_BSS = DYNAMIC_RAM_BASE + 0x00040000u;
constexpr u32 CART_BSS_BYTES = 0x00020001u;

u32 pageRound(u32 address) {
	return (address + HEAP_PAGE_SIZE - 1u) & ~(HEAP_PAGE_SIZE - 1u);
}

void setBss(test::Blua32TestRom& rom, u32 address, u32 byteCount) {
	u8* header = rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET;
	writeLE32(header + BLUA32_IMAGE_BSS_ADDRESS_OFFSET, address);
	writeLE32(header + BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET, byteCount);
}

struct Machine {
	test::Blua32TestRom system;
	test::Blua32TestRom cart;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;

	Machine(test::Blua32TestRom systemRom, test::Blua32TestRom cartRom)
		: system(std::move(systemRom)), cart(std::move(cartRom)),
		memory(MemoryInit{system.bytes, test::cartridgeSlots(cart.bytes)}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
	}
};

Machine bootPair() {
	test::Blua32TestImage boot;
	boot.constants = {static_cast<i32>(test::blua32TestFunctionAddress(RomImageDomain::Cartridge, 0))};
	boot.text.resize(2u * INSTRUCTION_BYTES);
	writeInstruction(boot.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(boot.text, 1, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
	boot.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 1}};
	test::Blua32TestImage cart;
	cart.text.resize(INSTRUCTION_BYTES);
	writeInstruction(cart.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	cart.functions = {{.firstWord = 0, .wordCount = 1}};
	auto systemRom = test::encodeBlua32TestRom(RomImageDomain::System, boot);
	auto cartRom = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cart);
	setBss(systemRom, SYSTEM_BSS, 0x100u);
	setBss(cartRom, CART_BSS, CART_BSS_BYTES);
	return Machine(std::move(systemRom), std::move(cartRom));
}

void capacityFollowsTheFloorAcrossResetExecAndRestore() {
	Machine machine = bootPair();
	constexpr u32 limit = RAM_BASE + MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE;
	const u32 systemFloor = pageRound(SYSTEM_BSS + 0x100u);
	const u32 cartFloor = pageRound(CART_BSS + CART_BSS_BYTES);
	require(machine.cpu.heapAllocator().floorAddress() == systemFloor, "reset takes the system static end");
	require(machine.cpu.luaHeap().capacity() == limit - systemFloor, "the BIOS has the system heap extent");
	const auto savedMemory = machine.memory.captureSaveState();
	const auto savedCpu = machine.cpu.captureRuntimeState();
	machine.cpu.runUntilDepth(0, 100);
	require(machine.cpu.isCartridgeExecutionActive(), "EXEC entered the cartridge");
	require(machine.cpu.heapAllocator().floorAddress() == cartFloor, "EXEC takes the cartridge static end");
	require(machine.cpu.luaHeap().capacity() == limit - cartFloor, "the cartridge has its own heap extent");
	machine.memory.restoreSaveState(savedMemory);
	machine.cpu.restoreRuntimeState(savedCpu);
	require(machine.cpu.luaHeap().capacity() == limit - systemFloor, "restore uses the floor from restored RAM");
}

void instructionFetchFollowsTheLiveFloor() {
	Machine machine = bootPair();
	auto& cpu = machine.cpu;
	auto& memory = machine.memory;
	const u32 pc = cpu.heapAllocator().floorAddress();
	const auto selectPc = [&](u32 address) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.system.functionAddresses[0], address);
	};
	std::array<u8, 2 * INSTRUCTION_BYTES> text{};
	writeInstruction(text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	require(cpu.heapAllocator().setFloor(pc + HEAP_PAGE_SIZE), "the test code occupies reserved static storage");
	memory.writeBytes(pc, text.data(), text.size());
	selectPc(pc);
	const int loop = BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	cpu.runUntilDepth(0, 300 * loop);
	require(cpu.readFrameRegister(0, 0) == valueInteger(1), "RAM below the floor supplies instructions");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *cpu.rootThread()->currentFrame->decodedPage;
	test::waitForNativeEntry(cpu, page, 0u);
	require(page.nativeBlocks != nullptr, "a warm executable page is translated");
#endif
	const auto saved = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	require(cpu.heapAllocator().setFloor(pc), "lowering the floor covers the old code page");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(!page.nativeBlocks, "the floor change retires cached code immediately");
#endif
	require(memory.readRamRecordWord(pc) == readLE32(text.data()), "the dormant code bytes still exist in physical RAM");
	require(memory.readMappedU32LE(pc) == 0 && memory.readMappedU32LE(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED,
		"the retired page is no longer mapped on the system bus");
	cpu.runUntilDepth(0, 1);
	require(cpu.readCauseWord() == CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR && cpu.readEpcWord() == pc, "the next warm entry faults on fetch, not execution");

	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(saved);
	writeInstruction(text, 0, static_cast<u8>(OpCode::K0), 0, 0, 0);
	memory.writeBytes(pc, text.data(), text.size());
	cpu.runUntilDepth(0, loop);
	require(cpu.readFrameRegister(0, 0) == valueInteger(0), "the restored boundary admits the new contents");

	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(saved);
	writeInstruction(text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(text, 1, static_cast<u8>(OpCode::K1), 0, 0, 0);
	memory.writeBytes(pc - INSTRUCTION_BYTES, text.data(), text.size());
	require(cpu.heapAllocator().setFloor(pc), "prepare the WIDE boundary after writing both instruction words");
	selectPc(pc - INSTRUCTION_BYTES);
	cpu.runUntilDepth(0, 1);
	require(cpu.readCauseWord() == CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR && cpu.readEpcWord() == pc - INSTRUCTION_BYTES,
		"a WIDE body faults across the floor without retiring the prefix");
}

void execRefusesLivePagesBelowTheFloor() {
	Machine machine = bootPair();
	HeapAllocator& heap = machine.cpu.heapAllocator();
	const u32 floor = heap.floorAddress();
	const u32 cartFloor = pageRound(CART_BSS + CART_BSS_BYTES);
	u32 claimed;
	do { claimed = heap.allocate(HEAP_PAGE_SIZE, true); } while (claimed >= cartFloor);
	require(claimed >= floor, "the new static region overlaps a live allocation");
	const u32 marker = CART_BSS - RAM_BASE;
	writeLE32(machine.memory.ramData() + marker, 0x5eed5eedu);
	machine.cpu.runUntilDepth(0, 100);
	require(machine.cpu.captureRuntimeState().hardHalted, "EXEC hard-halts over a live page");
	require(heap.floorAddress() == floor, "the refused floor is not applied");
	require(readLE32(machine.memory.ramData() + marker) == 0x5eed5eedu, "cartridge BSS stays untouched");
}

void reclaimRunAcrossBitmapAndHistoryPages() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	HeapAllocator heap(memory);
	constexpr u32 bytes = 400u * HEAP_PAGE_SIZE;
	const u32 high = heap.allocate(2u * HEAP_PAGE_SIZE, true);
	const u32 run = heap.allocate(bytes, false);
	const u32 low = heap.allocate(HEAP_PAGE_SIZE, true);
	require(run + bytes == high && low + HEAP_PAGE_SIZE == run && heap.setFloor(low),
		"the live heap consists of the run and its two neighbors");

	RamHistory archive;
	RamHistory::PageMap allocated, freed;
	archive.capture(memory, nullptr, allocated);
	heap.free(run);
	const auto releasedRam = memory.captureSaveState().ram;
	archive.capture(memory, &allocated, freed);
	archive.restore(memory, freed, allocated);
	require(heap.occupiedBytes() == bytes + 3u * HEAP_PAGE_SIZE && heap.allocate(HEAP_PAGE_SIZE, true) == 0u,
		"rewind restores the run and both neighboring allocations");

	archive.restore(memory, allocated, freed);
	require(memory.captureSaveState().ram == releasedRam, "forward history publishes every released descriptor, not just the head");
	require(heap.occupiedBytes() == 3u * HEAP_PAGE_SIZE && heap.allocate(bytes + HEAP_PAGE_SIZE, true) == 0u,
		"reclamation preserves the neighbors in both partial bitmap words");
	require(heap.allocate(bytes, false) == run, "the same entire run is available again");
}

void objectSweepResumesFromRam() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	HeapAllocator heap(memory);
	const u32 first = heap.allocate(32, false), vacant = heap.allocate(32, false), last = heap.allocate(32, false);
	constexpr u32 ownedBytes = 128u * HEAP_PAGE_SIZE;
	const u32 owned = heap.allocate(ownedBytes, true);
	const u32 run = heap.allocate(3u * HEAP_PAGE_SIZE, false);
	for (const u32 address : {first, vacant, last, owned, run}) memory.writeRamRecordWord(address, 1);
	heap.free(vacant);
	struct Visits { HeapAllocator& heap; std::vector<u32> addresses; } visits{heap, {}};
	auto retire = +[](void* context, u32 address) -> i32 {
		auto& sweep = *static_cast<Visits*>(context);
		sweep.addresses.push_back(address);
		sweep.heap.free(address);
		return sweep.addresses.size() == 1 ? -5 : -1;
	};
	auto inspect = +[](void* context, u32 address) -> i32 {
		static_cast<std::vector<u32>*>(context)->push_back(address);
		return 1;
	};

	heap.beginObjectSweep();
	const auto beforeZero = memory.captureSaveState().ram;
	require(heap.sweepObjects(0, &visits, retire) == 0 && visits.addresses.empty()
		&& memory.captureSaveState().ram == beforeZero, "zero allowance does not advance the sweep or visit a record");
	require(heap.sweepObjects(1, &visits, retire) == 5 && visits.addresses == std::vector<u32>{run},
		"an object run contributes the charge of one visit");
	visits.addresses.clear();
	require(heap.sweepObjects(1, &visits, retire) == 5 && visits.addresses == std::vector<u32>{first}
		&& heap.objectSweepActive(), "the first slot can finish but the sweep stops before the hole and next object");
	const u32 cursor = heap.managementOffset() + 8u;
	require(memory.readRamRecordWord(cursor) == ((first - RAM_BASE) | 1u),
		"the published cursor contains the page and the next slot ordinal");
	const auto midSweep = memory.captureSaveState();
	std::vector<u32> inventory;
	heap.visitObjectRecords(&inventory, inspect);
	require(inventory == std::vector<u32>{last} && memory.captureSaveState().ram == midSweep.ram,
		"cold inventory is independent of the sweep cursor and leaves RAM unchanged");

	RamHistory archive;
	RamHistory::PageMap paused, finished;
	archive.capture(memory, nullptr, paused);
	const auto complete = [&] {
		require(heap.allocate(32, false) == first, "the swept prefix can immediately receive a new allocation");
		memory.writeRamRecordWord(first, 2);
		visits.addresses.clear();
		require(heap.sweepObjects(1, &visits, retire) == 1 && visits.addresses.empty() && heap.objectSweepActive(),
			"the issued hole consumes exactly one visit without inspecting the next record");
		require(heap.sweepObjects(1, &visits, retire) == 5 && visits.addresses == std::vector<u32>{last},
			"the next visit resumes at the last record, not the new allocation in the swept prefix");
		require(heap.occupiedBytes() == ownedBytes + 32u && memory.readRamRecordWord(owned) == 1
			&& memory.readRamRecordWord(first) == 2 && !heap.objectSweepActive()
			&& memory.readRamRecordWord(cursor) == heap.pageLimit() * HEAP_PAGE_SIZE,
			"the new allocation and owned run survive and the cursor reaches the sentinel");
	};
	complete();
	const auto completedRam = memory.captureSaveState().ram;
	archive.capture(memory, &paused, finished);
	archive.restore(memory, finished, paused);
	require(memory.captureSaveState().ram == midSweep.ram, "rewind restores the partial-page cursor and records");
	complete();
	require(memory.captureSaveState().ram == completedRam, "the same resumed sweep reproduces all RAM");

	archive.restore(memory, finished, paused);
	heap.free(last);
	const u32 larger = heap.allocate(64, false), largerNext = heap.allocate(64, false);
	require(larger == first && largerNext == larger + 64, "a released page can be assigned a new size class");
	memory.writeRamRecordWord(larger, 3);
	memory.writeRamRecordWord(largerNext, 4);
	inventory.clear();
	require(heap.sweepObjects(1, &inventory, inspect) == 1 && inventory == std::vector<u32>{largerNext}
		&& !heap.objectSweepActive(), "the saved ordinal resumes against the new class stride");
}

} // namespace

int main() {
	try {
		capacityFollowsTheFloorAcrossResetExecAndRestore();
		instructionFetchFollowsTheLiveFloor();
		execRefusesLivePagesBelowTheFloor();
		reclaimRunAcrossBitmapAndHistoryPages();
		objectSweepResumesFromRam();
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
	std::cout << "heap floor tests passed\n";
	return 0;
}
