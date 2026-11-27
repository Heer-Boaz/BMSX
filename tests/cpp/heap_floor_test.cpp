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
#include "support/managed_fixture.h"

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
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {}
};

Machine bootPair(bool publishCartAperture = false) {
	test::Blua32TestImage boot;
	boot.constants = {static_cast<i32>(test::blua32TestFunctionAddress(RomImageDomain::Cartridge, 0)),
		static_cast<i32>(pageRound(CART_BSS + CART_BSS_BYTES))};
	u32 word = 0;
	boot.text.resize((publishCartAperture ? 4u : 2u) * INSTRUCTION_BYTES);
	if (publishCartAperture) {
		writeInstruction(boot.text, word++, static_cast<u8>(OpCode::LOADK), 0, 0, 1);
		writeInstruction(boot.text, word++, static_cast<u8>(OpCode::MTC0), 0, COP0_RAM_END, 0);
	}
	writeInstruction(boot.text, word++, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(boot.text, word++, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
	boot.functions = {{.firstWord = 0, .wordCount = word, .maxStack = 1}};
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

void explicitRamEndPrecedesExecAndSurvivesRestore() {
	Machine machine = bootPair(true);
	constexpr u32 limit = RAM_BASE + MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE;
	const u32 systemFloor = pageRound(SYSTEM_BSS + 0x100u);
	const u32 cartFloor = pageRound(CART_BSS + CART_BSS_BYTES);
	machine.cpu.reset();
	require(machine.memory.ramBusEnd() == DYNAMIC_RAM_BASE,
		"cold reset does not expose any program RAM on the public bus before firmware selects an end");
	require(machine.cpu.heapAllocator().occupiedBytes() == 0u,
		"raw reset does not allocate language storage");
	test::seedManagedFixture(machine.cpu, machine.addresses);
	require(machine.cpu.heapAllocator().floorAddress() == systemFloor, "the admitted BIOS context maps its static extent");
	require(machine.cpu.luaHeap().capacity() == limit - systemFloor, "the BIOS has the system heap extent");
	const auto savedMemory = machine.memory.captureSaveState();
	const auto savedCpu = machine.cpu.captureRuntimeState();
	require(machine.cpu.runUntilDepth(0, 100) == RunResult::Yielded, "RAM_END changes the aperture at its own boundary");
	require(!machine.cpu.isCartridgeExecutionActive() && machine.memory.ramBusEnd() == cartFloor, "RAM_END changes the aperture before EXEC");
	machine.cpu.runUntilDepth(0, 100);
	require(machine.cpu.isCartridgeExecutionActive(), "EXEC entered the cartridge");
	require(machine.memory.ramBusEnd() == cartFloor, "EXEC does not change the aperture");
	require(machine.cpu.luaHeap().capacity() == limit - cartFloor, "the cartridge has its own heap extent");
	machine.memory.restoreSaveState(savedMemory);
	machine.cpu.restoreRuntimeState(savedCpu);
	require(machine.cpu.luaHeap().capacity() == limit - systemFloor, "restore uses the floor from restored RAM");
}

void instructionFetchFollowsTheLiveFloor() {
	Machine machine = bootPair();
	test::seedManagedFixture(machine.cpu, machine.addresses);
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

void execLeavesLiveChunksAndTheApertureUntouched() {
	Machine machine = bootPair();
	test::seedManagedFixture(machine.cpu, machine.addresses);
	HeapAllocator& heap = machine.cpu.heapAllocator();
	const u32 floor = heap.floorAddress();
	const u32 cartFloor = pageRound(CART_BSS + CART_BSS_BYTES);
	u32 claimed;
	do { claimed = heap.allocate(4088u, true); } while (claimed >= cartFloor);
	require(claimed >= CART_BSS, "the new static region overlaps a live allocation");
	machine.memory.writeRamRecordWord(claimed, 0x5eed5eedu);
	const u32 occupied = heap.occupiedBytes();
	machine.cpu.runUntilDepth(0, 100);
	require(machine.cpu.isCartridgeExecutionActive(), "EXEC selects the static cartridge function without a heap check");
	require(machine.memory.ramBusEnd() == floor, "EXEC does not expose the cartridge static extent");
	require(heap.occupiedBytes() == occupied, "EXEC does not change the allocations in the static extent");
	require(machine.memory.readRamRecordWord(claimed) == 0x5eed5eedu, "the live payload stays untouched");
}

void reclaimLargeChunkAcrossHistoryPages() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	HeapAllocator heap(memory);
	constexpr u32 bytes = 400u * HEAP_PAGE_SIZE - 8;
	heap.reset(RAM_BASE + heap.managementOffset() - 404u * HEAP_PAGE_SIZE);
	const u32 high = heap.allocate(2u * HEAP_PAGE_SIZE - 8u, true);
	const u32 run = heap.allocate(bytes, false);
	const u32 low = heap.allocate(4088u, true);
	require(high && run && low && !heap.allocate(HEAP_PAGE_SIZE, true),
		"the three live chunks do not leave room for an additional page of payload");
	memory.writeRamRecordWord(run, 0xe8d1caffu);
	memory.writeRamRecordWord(run + bytes - sizeof(u32), 0xcabbeedd);
	memory.writeRamRecordWord(high, 0x11223344u);
	memory.writeRamRecordWord(low, 0x55667788u);
	const auto occupied = heap.occupiedBytes();
	const auto runExtent = heap.allocationBytes(run);

	RamHistory archive;
	RamHistory::PageMap allocated, freed;
	archive.capture(memory, nullptr, allocated);
	heap.free(run);
	const auto releasedRam = memory.captureSaveState().ram;
	archive.capture(memory, &allocated, freed);
	archive.restore(memory, freed, allocated);
	require(heap.occupiedBytes() == occupied && heap.issuedObjectStart(run - RAM_BASE)
		&& memory.readRamRecordWord(run) == 0xe8d1caffu
		&& memory.readRamRecordWord(run + bytes - sizeof(u32)) == 0xcabbeedd
		&& !heap.allocate(HEAP_PAGE_SIZE, true), "rewind restores the live chunk and its payload");

	archive.restore(memory, allocated, freed);
	require(memory.captureSaveState().ram == releasedRam, "forward history reproduces the chunk metadata verbatim");
	require(heap.occupiedBytes() == occupied - runExtent && !heap.issuedObjectStart(run - RAM_BASE)
		&& !heap.allocate(bytes + HEAP_PAGE_SIZE, true), "the freed chunk leaves both other allocations in use");
	require(heap.allocate(bytes, false) != 0 && memory.readRamRecordWord(high) == 0x11223344u
		&& memory.readRamRecordWord(low) == 0x55667788u, "the large request can reuse free storage without changing either live payload");
}

} // namespace

int main() {
	try {
		explicitRamEndPrecedesExecAndSurvivesRestore();
		instructionFetchFollowsTheLiveFloor();
		execLeavesLiveChunksAndTheApertureUntouched();
		reclaimLargeChunkAcrossHistoryPages();
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
	std::cout << "heap floor tests passed\n";
	return 0;
}
