#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/memory/string_memory.h"
#include "machine/scheduler/device.h"

#include <cmath>
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
	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 4u); }, "invalid draw ctrl");
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_CTRL) == 0u, "invalid draw ctrl should not mutate the latch");
	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x01000000u); }, "invalid draw ctrl high bits");
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_CTRL) == 0u, "invalid draw ctrl high bits should not mutate the latch");
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

void testBlitDrawCtrlSnapshot() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_LAYER_PRIO, 9u << 8);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x00ff0003u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	const auto* queue = h.vdp.takeReadyExecutionQueue();
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(command.flipH && command.flipV, "DRAW_CTRL flip bits should be snapshotted");
	require(std::abs(command.parallaxWeight + 1.0f) < 0.0001f, "DRAW_CTRL signed Q8.8 parallax should be snapshotted");
	h.vdp.completeReadyExecution(queue);
}

void testPmuParallaxSnapshot() {
	Harness h;

	h.vdp.setTiming(1000, 1000, 0);
	h.vdp.setParallaxRig(2.0f, 1.5f, 0.25f, 0.75f, 3.0f, 0.8f, 1.2f, 0.4f, 0.7f);
	h.vdp.accrueCycles(250, 250);

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_LAYER_PRIO, 9u << 8);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x00008000u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	h.vdp.setParallaxRig(-5.0f, 2.0f, 1.0f, 1.0f, 8.0f, 2.0f, 2.0f, 2.0f, 1.5f);
	h.vdp.accrueCycles(500, 750);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	const auto* queue = h.vdp.takeReadyExecutionQueue();
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(std::abs(command.parallaxWeight - 0.5f) < 0.0001f, "DRAW_CTRL parallax weight should remain per-BLIT state");
	const auto& rig = h.vdp.executionParallaxRig();
	require(std::abs(rig.vy - 2.0f) < 0.0001f, "PMU vy should be snapshotted at frame seal");
	require(std::abs(rig.scale - 1.5f) < 0.0001f, "PMU scale should be snapshotted at frame seal");
	require(std::abs(rig.impact - 0.25f) < 0.0001f, "PMU impact should be snapshotted at frame seal");
	require(std::abs(rig.impact_t - 0.75f) < 0.0001f, "PMU impact_t should be snapshotted at frame seal");
	require(std::abs(rig.bias_px - 3.0f) < 0.0001f, "PMU bias should be snapshotted at frame seal");
	require(std::abs(rig.parallax_strength - 0.8f) < 0.0001f, "PMU parallax strength should be snapshotted at frame seal");
	require(std::abs(rig.scale_strength - 1.2f) < 0.0001f, "PMU scale strength should be snapshotted at frame seal");
	require(std::abs(rig.flip_strength - 0.4f) < 0.0001f, "PMU flip strength should be snapshotted at frame seal");
	require(std::abs(rig.flip_window - 0.7f) < 0.0001f, "PMU flip window should be snapshotted at frame seal");
	require(std::abs(h.vdp.executionParallaxClockSeconds() - 0.25) < 0.0001, "PMU clock should be snapshotted at frame seal");
	h.vdp.completeReadyExecution(queue);
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
		{"BLIT DRAW_CTRL snapshot", testBlitDrawCtrlSnapshot},
		{"PMU parallax snapshot", testPmuParallaxSnapshot},
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
