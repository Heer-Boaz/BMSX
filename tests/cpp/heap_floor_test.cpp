#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

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

void execRefusesLivePagesBelowTheFloor() {
	Machine machine = bootPair();
	HeapAllocator& heap = machine.cpu.heapAllocator();
	const u32 floor = heap.floorAddress();
	require(heap.allocate(heap.capacityBytes() - 2u * HEAP_PAGE_SIZE, false) == floor + HEAP_PAGE_SIZE, "the run leaves the lowest page free and the top page holds the reset closure");
	const u32 marker = CART_BSS - RAM_BASE;
	writeLE32(machine.memory.ramData() + marker, 0x5eed5eedu);
	machine.cpu.runUntilDepth(0, 100);
	require(machine.cpu.captureRuntimeState().hardHalted, "EXEC hard-halts over a live page");
	require(heap.floorAddress() == floor, "the refused floor is not applied");
	require(readLE32(machine.memory.ramData() + marker) == 0x5eed5eedu, "cartridge BSS stays untouched");
}

void objectSweepResumesFromRam() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	HeapAllocator heap(memory);
	const u32 first = heap.allocate(32, false), vacant = heap.allocate(32, false), last = heap.allocate(32, false);
	const u32 owned = heap.allocate(2u * HEAP_PAGE_SIZE, true);
	const u32 run = heap.allocate(3u * HEAP_PAGE_SIZE, false);
	for (const u32 address : {first, vacant, last, owned, run}) memory.writeRamRecordWord(address, 1);
	heap.free(vacant);
	struct Visits { HeapAllocator& heap; std::vector<u32> addresses; } visits{heap, {}};
	auto retire = +[](void* context, u32 address) -> bool {
		auto& sweep = *static_cast<Visits*>(context);
		sweep.addresses.push_back(address);
		sweep.heap.free(address);
		return true;
	};

	heap.beginObjectSweep();
	require(heap.sweepObjects(1, &visits, retire) == 1 && visits.addresses == std::vector<u32>{run},
		"an object run counts once");
	require(heap.objectSweepActive(), "the sweep still has object pages to visit");
	const auto midSweep = memory.captureSaveState();
	for (int replay = 0; replay < 2; ++replay) {
		memory.restoreSaveState(midSweep);
		visits.addresses.clear();
		require(heap.sweepObjects(1, &visits, retire) == 3 && visits.addresses == std::vector<u32>{first, last},
			"the current page is indivisible, including its vacant issued slot");
		require(heap.occupiedBytes() == 2u * HEAP_PAGE_SIZE && memory.readRamRecordWord(owned) == 1
			&& !heap.objectSweepActive(), "the owner retains its block and the cursor reaches the end");
	}
}

} // namespace

int main() {
	try {
		capacityFollowsTheFloorAcrossResetExecAndRestore();
		execRefusesLivePagesBelowTheFloor();
		objectSweepResumesFromRam();
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
	std::cout << "heap floor tests passed\n";
	return 0;
}
