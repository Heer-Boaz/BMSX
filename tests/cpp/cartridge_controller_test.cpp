#include "spec/bmsx/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/cartridge/contracts.h"
#include "spec/bmsx/cartridge.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/memory_map.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "machine/scheduler/device.h"

#include <array>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

struct CartridgeHarness {
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::ExecutionAddressSpace executionAddressSpace;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;

	explicit CartridgeHarness(const bmsx::CartridgeSocketMediaPair& slots)
		: memory(bmsx::MemoryInit{ {}, slots }, bmsx::PSX_MACHINE_SPEC.ramBytes)
		, irq(memory)
		, executionAddressSpace(memory)
		, cpu(memory, irq, executionAddressSpace)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		irq.reset();
		dma.reset();
		memory.cartridgeController().reset();
		dma.setTiming(1, 0, 1, 1, 0, scheduler.nowCycles());
	}
};

void testPhysicalSocketSelectionAndRawLatch() {
	const std::array<bmsx::u8, 4> slot0Rom{{ 0x44u, 0x33u, 0x22u, 0x11u }};
	const std::array<bmsx::u8, 4> slot1Rom{{ 0xddu, 0xccu, 0xbbu, 0xaau }};
	bmsx::CartridgeSocketMediaPair slots{};
	slots[0] = bmsx::CartridgeCardMedia{slot0Rom, 16u, false};
	slots[1] = bmsx::CartridgeCardMedia{slot1Rom, std::nullopt, true};
	CartridgeHarness harness(slots);
	bmsx::Memory& memory = harness.memory;

	require(memory.readMappedU32LE(bmsx::IO_CART_SELECT) == 0u, "reset selects physical socket 0");
	require(memory.readMappedU32LE(bmsx::CART_ROM_BASE) == 0x11223344u, "CPU aperture reads slot 0 after reset");
	require(
		memory.readMappedU32LE(bmsx::IO_CART_STATUS)
			== (bmsx::CARTRIDGE_STATUS_SLOT0_PRESENT
				| bmsx::CARTRIDGE_STATUS_SLOT1_PRESENT),
		"status reports both inserted cartridges"
	);
	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0xa5a50001u);
	require(memory.readMappedU32LE(bmsx::IO_CART_SELECT) == 0xa5a50001u, "selection register retains its raw word");
	require(memory.readMappedU32LE(bmsx::CART_ROM_BASE) == 0xaabbccddu, "CPU aperture reads slot 1 when CS1 is selected");
	require(
		memory.readMappedU32LE(bmsx::IO_CART_STATUS)
			== (bmsx::CARTRIDGE_STATUS_SLOT0_PRESENT
				| bmsx::CARTRIDGE_STATUS_SLOT1_PRESENT
				| bmsx::CARTRIDGE_STATUS_SELECTED_SLOT1),
		"status reflects the selected physical socket"
	);
}

void testAbsentSocketDrivesZeroAndHasNoState() {
	const std::array<bmsx::u8, 4> slot0Rom{{ 0x44u, 0x33u, 0x22u, 0x11u }};
	bmsx::CartridgeSocketMediaPair slots{};
	slots[0] = bmsx::CartridgeCardMedia{slot0Rom, std::nullopt, false};
	CartridgeHarness harness(slots);
	bmsx::Memory& memory = harness.memory;
	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	require(
		memory.readMappedU32LE(bmsx::IO_CART_STATUS)
			== (bmsx::CARTRIDGE_STATUS_SLOT0_PRESENT
				| bmsx::CARTRIDGE_STATUS_SELECTED_SLOT1),
		"status retains selection while reporting the second socket absent"
	);
	require(memory.readMappedU32LE(bmsx::CART_ROM_BASE) == 0u, "absent socket drives zero in ROM aperture");
	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0u, "absent socket drives zero in RAM aperture");
	require(memory.readMappedU32LE(bmsx::CART_MMIO_BASE) == 0u, "absent socket drives zero in MMIO aperture");
	require(!memory.cartridgeController().captureState().slots[1].has_value(), "absent socket has no synthetic state");
}

void testSocketLocalRamMailboxResetAndRestore() {
	bmsx::CartridgeSocketMediaPair slots{};
	slots[0] = bmsx::CartridgeCardMedia{std::nullopt, 16u, true};
	slots[1] = bmsx::CartridgeCardMedia{std::nullopt, 16u, true};
	CartridgeHarness harness(slots);
	bmsx::Memory& memory = harness.memory;

	require(memory.readMappedU32LE(bmsx::IO_CART_SELECT) == 0u, "cartridge hardware does not interpret executable metadata");
	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0x11112222u);
	memory.writeMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_DATA_OFFSET, 0x33334444u);
	memory.writeMappedU32LE(
		bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET,
		0x80000000u | bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER | bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_READ
	);
	require(
		memory.readMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET)
			== (0x80000000u | bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_READ),
		"mailbox control retains representable high bits as a raw word"
	);
	require(
		memory.readMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_STATUS_OFFSET)
			== bmsx::CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING,
		"slot 1 mailbox retains its IRQ source latch"
	);
	require((memory.readMappedU32LE(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_CARTRIDGE_SLOT1) != 0u, "slot 1 raises its own IRQ line");

	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0x2468ace0u);
	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0x55556666u);
	memory.writeMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_DATA_OFFSET, 0x77778888u);
	memory.writeMappedU32LE(
		bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET,
		bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER | bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE
	);
	require((memory.readMappedU32LE(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_CARTRIDGE_SLOT0) != 0u, "slot 0 raises its own IRQ line");
	const bmsx::CartridgeControllerState saved = memory.cartridgeController().captureState();

	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0u);
	memory.writeMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_DATA_OFFSET, 0u);
	memory.writeMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET, 1u);
	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	memory.cartridgeController().restoreState(saved);

	require(memory.readMappedU32LE(bmsx::IO_CART_SELECT) == 0x2468ace0u, "restore retains the raw selection word");
	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0x55556666u, "restore returns slot 0 RAM");
	require(memory.readMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_DATA_OFFSET) == 0x77778888u, "restore returns slot 0 mailbox data");
	require(
		memory.readMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_STATUS_OFFSET)
			== bmsx::CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING,
		"restore returns slot 0 mailbox IRQ state"
	);
	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0x11112222u, "slot 1 RAM is independent");
	require(memory.readMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_DATA_OFFSET) == 0x33334444u, "slot 1 mailbox is independent");

	memory.cartridgeController().reset();
	require(memory.readMappedU32LE(bmsx::IO_CART_SELECT) == 0u, "reset returns to physical socket 0");
	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0x55556666u, "reset retains cartridge RAM");
	require(memory.readMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_DATA_OFFSET) == 0u, "reset clears mailbox data");
	require(memory.readMappedU32LE(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_STATUS_OFFSET) == 0u, "reset clears mailbox IRQ state");
}

void testMailboxIrqRaisesOncePerSourceLatchEdge() {
	bmsx::CartridgeSocketMediaPair slots{};
	slots[0] = bmsx::CartridgeCardMedia{std::nullopt, std::nullopt, true};
	CartridgeHarness harness(slots);
	bmsx::Memory& memory = harness.memory;
	const bmsx::u32 mailboxControl = bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET;
	const bmsx::u32 mailboxStatus = bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_STATUS_OFFSET;
	const bmsx::u32 mailboxAck = bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET;

	memory.writeMappedU32LE(mailboxControl, bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	require((memory.readMappedU32LE(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_CARTRIDGE_SLOT0) != 0u, "mailbox edge raises slot IRQ");
	require(
		memory.readMappedU32LE(mailboxStatus) == bmsx::CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING,
		"mailbox source latch records the edge");

	memory.writeMappedU32LE(bmsx::IO_IRQ_ACK, bmsx::IRQ_CARTRIDGE_SLOT0);
	require((memory.readMappedU32LE(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_CARTRIDGE_SLOT0) == 0u, "central IRQ acknowledgement clears the controller flag");
	memory.writeMappedU32LE(mailboxControl, bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	require(
		(memory.readMappedU32LE(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_CARTRIDGE_SLOT0) == 0u,
		"central IRQ acknowledgement does not clear the cartridge source latch");

	memory.writeMappedU32LE(mailboxAck, 1u);
	require(memory.readMappedU32LE(mailboxStatus) == 0u, "local acknowledgement clears the mailbox source latch");
	memory.writeMappedU32LE(mailboxControl, bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	require((memory.readMappedU32LE(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_CARTRIDGE_SLOT0) != 0u, "a new mailbox edge raises the IRQ again");
}

void testDmaRequestSelectorsOverrideBothChipSelects() {
	const std::array<bmsx::u8, 8> slot0Rom{{
		0x04u, 0x03u, 0x02u, 0x01u,
		0x14u, 0x13u, 0x12u, 0x11u,
	}};
	const std::array<bmsx::u8, 8> slot1Rom{{
		0xa4u, 0xa3u, 0xa2u, 0xa1u,
		0xb4u, 0xb3u, 0xb2u, 0xb1u,
	}};
	bmsx::CartridgeSocketMediaPair slots{};
	slots[0] = bmsx::CartridgeCardMedia{slot0Rom, 16u, true};
	slots[1] = bmsx::CartridgeCardMedia{slot1Rom, 16u, true};
	CartridgeHarness harness(slots);
	bmsx::Memory& memory = harness.memory;

	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	memory.writeMappedU32LE(
		bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET,
		bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_READ
	);
	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0u);
	memory.writeMappedU32LE(
		bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET,
		bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE
	);

	const bmsx::u32 control = bmsx::DMA_CONTROL_READ_INCREMENT
		| bmsx::DMA_CONTROL_WRITE_INCREMENT
		| (bmsx::DMA_REQUEST_CARTRIDGE_SLOT1_READ << bmsx::DMA_CONTROL_READ_REQUEST_SHIFT)
		| (bmsx::DMA_REQUEST_CARTRIDGE_SLOT0_WRITE << bmsx::DMA_CONTROL_WRITE_REQUEST_SHIFT)
		| (1u << bmsx::DMA_CONTROL_BLOCK_WORDS_SHIFT);
	memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, bmsx::CART_ROM_BASE);
	memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, bmsx::CART_RAM_BASE);
	memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 2u);
	memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, control);
	memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
	const bmsx::i64 deadline = harness.scheduler.nextDeadline();
	require(deadline == 4, "cartridge read and write serialize on the shared external bus");
	harness.scheduler.advanceTo(deadline);
	harness.dma.onService(deadline);

	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0xa1a2a3a4u, "DMA read selector drives slot 1 CS");
	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE + 4u) == 0xb1b2b3b4u, "DMA burst retains slot 1 CS");
	memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0u, "DMA write selector drives slot 0 CS independently");
	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE + 4u) == 0u, "slot 1 RAM is not the DMA destination");
}

} // namespace

int main() {
	testPhysicalSocketSelectionAndRawLatch();
	testAbsentSocketDrivesZeroAndHasNoState();
	testSocketLocalRamMailboxResetAndRestore();
	testMailboxIrqRaisesOncePerSourceLatchEdge();
	testDmaRequestSelectorsOverrideBothChipSelects();
	return 0;
}
