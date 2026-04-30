#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/memory/string_memory.h"
#include "machine/scheduler/device.h"

#include <cstdint>
#include <cstdlib>
#include <exception>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr uint32_t VDP_CMD_NOP = 0u;
constexpr uint32_t VDP_CMD_CLEAR = 1u;
constexpr uint32_t VDP_CMD_FILL_RECT = 2u;
constexpr uint32_t VDP_CMD_BLIT = 4u;
constexpr uint32_t VDP_CMD_BEGIN_FRAME = 14u;
constexpr uint32_t VDP_CMD_END_FRAME = 15u;

constexpr uint32_t VDP_PKT_END = 0x00000000u;
constexpr uint32_t VDP_PKT_CMD = 0x01000000u;
constexpr uint32_t VDP_PKT_REG1 = 0x02000000u;
constexpr uint32_t VDP_PKT_REGN = 0x03000000u;

constexpr uint32_t regIndex(uint32_t addr) {
	return (addr - bmsx::IO_VDP_REG0) / bmsx::IO_WORD_SIZE;
}

constexpr uint32_t VDP_REG_BG_COLOR = regIndex(bmsx::IO_VDP_REG_BG_COLOR);
constexpr uint32_t VDP_REG_SLOT_INDEX = regIndex(bmsx::IO_VDP_REG_SLOT_INDEX);

void writeIo(bmsx::Memory& memory, uint32_t addr, uint32_t value) {
	memory.writeValue(addr, bmsx::valueNumber(static_cast<double>(value)));
}

void setIo(bmsx::Memory& memory, uint32_t addr, uint32_t value) {
	memory.writeIoValue(addr, bmsx::valueNumber(static_cast<double>(value)));
}

struct Harness {
	bmsx::Memory memory;
	bmsx::StringHandleTable stringHandles;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::VDP vdp;

	Harness()
		: memory()
		, stringHandles(memory)
		, cpu(memory, &stringHandles)
		, scheduler(cpu)
		, vdp(memory, scheduler, {256u, 212u}) {
		setIo(memory, bmsx::IO_VDP_DITHER, 0u);
		setIo(memory, bmsx::IO_VDP_SLOT_PRIMARY_ATLAS, bmsx::VDP_SLOT_ATLAS_NONE);
		setIo(memory, bmsx::IO_VDP_SLOT_SECONDARY_ATLAS, bmsx::VDP_SLOT_ATLAS_NONE);
		vdp.initializeVramSurfaces();
		vdp.initializeRegisters();
		vdp.resetStatus();
	}
};

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void expectThrow(const std::function<void()>& fn, const char* label) {
	try {
		fn();
	} catch (const std::exception&) {
		return;
	}
	throw std::runtime_error(std::string("expected throw: ") + label);
}

void writeStream(bmsx::Memory& memory, const std::vector<uint32_t>& words) {
	for (size_t index = 0; index < words.size(); ++index) {
		memory.writeU32(bmsx::VDP_STREAM_BUFFER_BASE + static_cast<uint32_t>(index * bmsx::IO_WORD_SIZE), words[index]);
	}
}

void sealStream(Harness& harness, const std::vector<uint32_t>& words) {
	writeStream(harness.memory, words);
	harness.vdp.sealDmaTransfer(bmsx::VDP_STREAM_BUFFER_BASE, words.size() * bmsx::IO_WORD_SIZE);
}

void testDirectLifecycle() {
	Harness h;

	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME); }, "END without BEGIN");
	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_FILL_RECT); }, "draw without BEGIN");

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME); }, "double BEGIN");
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_NOP);
	require(h.vdp.canAcceptVdpSubmit(), "double BEGIN should cancel and close the frame");
}

void testInvalidRegisterDoesNotCancelFrame() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_FLAGS, 4u); }, "invalid draw flags");
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_FLAGS) == 0u, "invalid draw flags should not mutate the latch");
	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0xffff0000u); }, "negative Q16 scale");
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_SCALE_X) == 0x00010000u, "negative Q16 scale should not mutate the latch");
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
}

void testLatchSnapshotGeometry() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_X0, 0u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_Y0, 0u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_X1, 8u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_Y1, 8u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_LAYER_PRIO, 7u << 8);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_COLOR, 0xff112233u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_FILL_RECT);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_X1, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_Y1, 0u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	require(h.vdp.getPendingRenderWorkUnits() > 0, "queued rect should keep its captured geometry");
}

void testFifoReplayAndFaults() {
	Harness replay;
	sealStream(replay, {
		VDP_PKT_REG1 | VDP_REG_BG_COLOR,
		0xff010203u,
		VDP_PKT_CMD | VDP_CMD_CLEAR,
		VDP_PKT_END,
	});
	require(replay.vdp.getPendingRenderWorkUnits() > 0, "FIFO clear should submit render work");

	Harness fault;
	expectThrow([&] {
		sealStream(fault, {
			VDP_PKT_REG1 | VDP_REG_BG_COLOR,
			0xff102030u,
			0x04000000u,
			VDP_PKT_END,
		});
	}, "unknown packet kind");
	require(fault.memory.readIoU32(bmsx::IO_VDP_REG_BG_COLOR) == 0xff102030u, "prior FIFO register write should remain after fault");

	Harness range;
	expectThrow([&] { sealStream(range, {VDP_PKT_CMD | (1u << 16) | VDP_CMD_CLEAR, VDP_PKT_END}); }, "CMD reserved bits");
	expectThrow([&] { sealStream(range, {VDP_PKT_REG1 | 18u, 0u, VDP_PKT_END}); }, "REG1 range");
	expectThrow([&] { sealStream(range, {VDP_PKT_REGN | (2u << 16) | 17u, 0u, 0u, VDP_PKT_END}); }, "REGN range");
}

void testSlotRegisters() {
	Harness h;

	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_INDEX, 3u); }, "invalid slot index");
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_SLOT_INDEX) == bmsx::VDP_SLOT_PRIMARY, "invalid slot index should not mutate");

	sealStream(h, {
		VDP_PKT_REGN | (2u << 16) | VDP_REG_SLOT_INDEX,
		bmsx::VDP_SLOT_PRIMARY,
		16u | (16u << 16),
		VDP_PKT_END,
	});
	const auto surface = h.vdp.resolveBlitterSurfaceSize(bmsx::VDP_RD_SURFACE_PRIMARY);
	require(surface.width == 16u && surface.height == 16u, "REGN SLOT_INDEX/SLOT_DIM should apply in order");

	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 0xffffffffu); }, "slot capacity overflow");
	const auto afterFault = h.vdp.resolveBlitterSurfaceSize(bmsx::VDP_RD_SURFACE_PRIMARY);
	require(afterFault.width == 16u && afterFault.height == 16u, "invalid SLOT_DIM should not change the slot");
}

void testValidationCancelsDirectDrawFrame() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_Y, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 15u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 2u | (16u << 16));

	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT); }, "BLIT source rect overflow");
	require(h.vdp.canAcceptVdpSubmit(), "invalid direct draw should cancel and close the build frame");
}

void testEmptyFifoFrame() {
	Harness h;

	sealStream(h, {VDP_PKT_END});
	require(h.vdp.getPendingRenderWorkUnits() == 0, "empty FIFO frame should submit no render work");
}

} // namespace

int main() {
	const std::vector<std::pair<const char*, void (*)()>> tests = {
		{"direct lifecycle", testDirectLifecycle},
		{"invalid register frame behavior", testInvalidRegisterDoesNotCancelFrame},
		{"latch snapshot geometry", testLatchSnapshotGeometry},
		{"FIFO replay and faults", testFifoReplayAndFaults},
		{"slot registers", testSlotRegisters},
		{"validation cancels direct draw", testValidationCancelsDirectDrawFrame},
		{"empty FIFO frame", testEmptyFifoFrame},
	};

	for (const auto& test : tests) {
		try {
			test.second();
		} catch (const std::exception& error) {
			std::cerr << "FAIL " << test.first << ": " << error.what() << "\n";
			return EXIT_FAILURE;
		}
	}
	return EXIT_SUCCESS;
}
