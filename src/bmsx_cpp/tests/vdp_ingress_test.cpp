#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/vdp/bbu.h"
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
constexpr uint32_t VDP_CMD_DRAW_LINE = 3u;
constexpr uint32_t VDP_CMD_BLIT = 4u;
constexpr uint32_t VDP_CMD_BEGIN_FRAME = 14u;
constexpr uint32_t VDP_CMD_END_FRAME = 15u;

constexpr uint32_t VDP_PKT_END = 0x00000000u;
constexpr uint32_t VDP_PKT_CMD = 0x01000000u;
constexpr uint32_t VDP_PKT_REG1 = 0x02000000u;
constexpr uint32_t VDP_PKT_REGN = 0x03000000u;
constexpr uint32_t VDP_BILLBOARD_HEADER = bmsx::VDP_BBU_PACKET_KIND | (bmsx::VDP_BBU_PACKET_PAYLOAD_WORDS << 16u);
constexpr uint32_t VDP_SKYBOX_HEADER = bmsx::VDP_SBX_PACKET_KIND | (bmsx::VDP_SBX_PACKET_PAYLOAD_WORDS << 16u);

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

std::vector<uint32_t> billboardPacket(uint32_t sizeWord, uint32_t u = 2u, uint32_t v = 3u, uint32_t w = 4u, uint32_t h = 5u, uint32_t control = 0u) {
	return {
		VDP_BILLBOARD_HEADER,
		0u,
		bmsx::VDP_SLOT_PRIMARY,
		u | (v << 16u),
		w | (h << 16u),
		10u << 16u,
		20u << 16u,
		30u << 16u,
		sizeWord,
		0xff112233u,
		control,
	};
}

bmsx::SkyboxFaceSources skyboxSources(uint32_t w = 1u, uint32_t h = 1u) {
	const bmsx::VdpSlotSource source{bmsx::VDP_SLOT_PRIMARY, 0u, 0u, w, h};
	return bmsx::SkyboxFaceSources{
		source,
		source,
		source,
		source,
		source,
		source,
	};
}

std::vector<uint32_t> skyboxPacket(uint32_t control = bmsx::VDP_SBX_CONTROL_ENABLE, uint32_t w = 4u, uint32_t h = 5u) {
	std::vector<uint32_t> words;
	words.reserve(2u + bmsx::SKYBOX_FACE_WORD_COUNT);
	words.push_back(VDP_SKYBOX_HEADER);
	words.push_back(control);
	for (size_t face = 0; face < bmsx::SKYBOX_FACE_COUNT; ++face) {
		words.push_back(bmsx::VDP_SLOT_PRIMARY);
		words.push_back(0u);
		words.push_back(0u);
		words.push_back(w);
		words.push_back(h);
	}
	return words;
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

void testRawRegisterWordsDoNotCancelFrame() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 4u);
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_CTRL) == 4u, "DRAW_CTRL should latch raw representable bits");
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0xffff0000u);
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_SCALE_X) == 0xffff0000u, "negative Q16 scale should latch as a raw register word");
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
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0xff000003u);
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

void testPmuParallaxResolvedBlitSnapshot() {
	Harness h;

	h.vdp.setTiming(1000, 1000, 0);
	writeIo(h.memory, bmsx::IO_VDP_PMU_BANK, 0u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 16u << 16u);
	h.vdp.accrueCycles(250, 250);

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_X, 32u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_Y, 40u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_LAYER_PRIO, 9u << 8);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x00800000u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 100u << 16u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 8u << 16u);
	h.vdp.accrueCycles(500, 750);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	const auto* queue = h.vdp.takeReadyExecutionQueue();
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(std::abs(command.parallaxWeight - 0.5f) < 0.0001f, "DRAW_CTRL parallax weight should remain per-BLIT state");
	require(std::abs(command.dstX - 32.0f) < 0.0001f, "PMU should leave X unchanged for this rig");
	require(std::abs(command.dstY - 48.0f) < 0.0001f, "PMU should resolve +8px Y before backend execution");
	require(std::abs(command.scaleX - 1.0f) < 0.0001f, "PMU should leave scale X unchanged for this rig");
	require(std::abs(command.scaleY - 1.0f) < 0.0001f, "PMU should leave scale Y unchanged for this rig");
	h.vdp.completeReadyExecution(queue);
}

void testPmuBankRegistersResolveDrawCtrl() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_PMU_BANK, 3u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 12u << 16u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_SCALE_X, 0x00018000u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_CTRL, 1u);
	require(h.memory.readIoU32(bmsx::IO_VDP_PMU_CTRL) == 1u, "PMU control should store raw register bits");
	writeIo(h.memory, bmsx::IO_VDP_PMU_BANK, 4u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_SCALE_Y, 0u);
	require(h.memory.readIoU32(bmsx::IO_VDP_PMU_SCALE_Y) == 0u, "PMU scale register should store zero as raw state");
	writeIo(h.memory, bmsx::IO_VDP_PMU_BANK, 3u);

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_X, 32u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_Y, 40u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_LAYER_PRIO, 9u << 8);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x00800000u | (3u << 8u));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	const auto* queue = h.vdp.takeReadyExecutionQueue();
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(std::abs(command.parallaxWeight - 0.5f) < 0.0001f, "DRAW_CTRL parallax weight should be snapshotted");
	require(std::abs(command.dstY - 46.0f) < 0.0001f, "PMU bank Y should resolve into BLIT geometry");
	require(std::abs(command.scaleX - 1.25f) < 0.0001f, "PMU bank scale X should resolve into BLIT geometry");
	require(std::abs(command.scaleY - 1.0f) < 0.0001f, "PMU bank scale Y should remain unchanged");
	h.vdp.completeReadyExecution(queue);
}

void testPmuScaleUsesAbsoluteWeight() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_PMU_BANK, 3u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 12u << 16u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_SCALE_X, 0x00018000u);

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_X, 32u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_Y, 40u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_LAYER_PRIO, 9u << 8);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0xff800000u | (3u << 8u));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	const auto* queue = h.vdp.takeReadyExecutionQueue();
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(std::abs(command.parallaxWeight + 0.5f) < 0.0001f, "DRAW_CTRL negative parallax weight should be snapshotted");
	require(std::abs(command.dstY - 34.0f) < 0.0001f, "negative PMU weight should invert offset");
	require(std::abs(command.scaleX - 1.25f) < 0.0001f, "negative PMU weight should use absolute scale influence");
	require(std::abs(command.scaleY - 1.0f) < 0.0001f, "PMU bank scale Y should remain unchanged");
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

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_INDEX, 3u);
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_SLOT_INDEX) == 3u, "SLOT_INDEX should latch raw representable words");
	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_INDEX, bmsx::VDP_SLOT_PRIMARY);

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

void testBlitSourceGeometryEntersFrameDatapath() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_Y, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 15u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 2u | (16u << 16));

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
}

void testBlitAndLineConsumeRepresentableGeometry() {
	{
		Harness h;
		writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
		writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
		writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
		writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
		writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0xffff0000u);
		writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_Y, 0x00010000u);

		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
		require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_SCALE_X) == 0xffff0000u, "raw negative Q16 scale should remain latched");
		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	}
	{
		Harness h;
		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
		writeIo(h.memory, bmsx::IO_VDP_REG_LINE_WIDTH, 0u);

		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_DRAW_LINE);
		require(h.memory.readIoU32(bmsx::IO_VDP_REG_LINE_WIDTH) == 0u, "raw zero line width should remain latched");
		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	}
}

void testPmuResolvedScaleFlowsThroughBlitDatapath() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_PMU_BANK, 0u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_SCALE_X, 0u);
	require(h.memory.readIoU32(bmsx::IO_VDP_PMU_SCALE_X) == 0u, "PMU scale register should store zero as raw state");

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_Y, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x01000000u);

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
}

void testSbxCommitsOnlyThroughFramePresent() {
	Harness h;

	require(!h.vdp.committedSkyboxEnabled(), "skybox starts disabled");
	h.vdp.setSkyboxSources(skyboxSources());
	require(!h.vdp.committedSkyboxEnabled(), "live SBX write should not commit visible skybox");

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	require(!h.vdp.committedSkyboxEnabled(), "sealed SBX frame should wait for VBlank present");
	h.vdp.commitReadyFrameOnVblankEdge();
	require(h.vdp.committedSkyboxEnabled(), "presented frame should commit visible SBX state");

	h.vdp.clearSkybox();
	require(h.vdp.committedSkyboxEnabled(), "live SBX clear should not change visible skybox immediately");
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	h.vdp.commitReadyFrameOnVblankEdge();
	require(!h.vdp.committedSkyboxEnabled(), "presented clear frame should disable visible skybox");
}

void testSbxValidatesAtFrameSeal() {
	Harness h;

	h.vdp.setSkyboxSources(skyboxSources(2u, 1u));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);

	expectThrow([&] { writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME); }, "SBX source rect overflow");
	require(h.vdp.canAcceptVdpSubmit(), "invalid SBX frame should cancel and close the build frame");
	require(!h.vdp.committedSkyboxEnabled(), "invalid SBX state should not become visible");
}

void testSbxSkyboxPacketLatchesFrameState() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto stream = skyboxPacket(bmsx::VDP_SBX_CONTROL_ENABLE, 4u, 5u);
	stream.push_back(VDP_PKT_END);
	sealStream(h, stream);
	h.vdp.commitReadyFrameOnVblankEdge();
	require(h.vdp.committedSkyboxEnabled(), "SKYBOX packet should present visible SBX state");
	const auto sample = h.vdp.resolveCommittedSkyboxFaceSample(0u);
	require(sample.source.surfaceId == bmsx::VDP_RD_SURFACE_PRIMARY, "SKYBOX should resolve primary slot");
	require(sample.surfaceWidth == 16u && sample.surfaceHeight == 16u, "SKYBOX should resolve surface size");
	require(sample.source.width == 4u && sample.source.height == 5u, "SKYBOX should resolve face dimensions");
}

void testSbxSkyboxPacketFaultsAtAcceptanceAndFrameSeal() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto badControl = skyboxPacket(2u, 4u, 5u);
	badControl.push_back(VDP_PKT_END);
	expectThrow([&] { sealStream(h, badControl); }, "SKYBOX reserved control");
	require(!h.vdp.committedSkyboxEnabled(), "bad-control SKYBOX should not become visible");

	auto badSource = skyboxPacket(bmsx::VDP_SBX_CONTROL_ENABLE, 17u, 1u);
	badSource.push_back(VDP_PKT_END);
	expectThrow([&] { sealStream(h, badSource); }, "SBX source rect overflow");
	require(!h.vdp.committedSkyboxEnabled(), "bad-source SKYBOX should not become visible");
}

void testBbuBillboardPacketLatchesInstanceRam() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto stream = billboardPacket(2u << 16u);
	stream.push_back(VDP_PKT_END);
	sealStream(h, stream);
	require(h.vdp.getPendingRenderWorkUnits() == 1, "BILLBOARD should submit BBU render work");
	h.vdp.advanceWork(1);
	const auto* queue = h.vdp.takeReadyExecutionQueue();
	require(queue != nullptr, "BILLBOARD should produce ready execution state");
	const auto& billboards = h.vdp.takeReadyExecutionBillboards();
	require(billboards.size() == 1u, "BILLBOARD should latch one instance");
	const auto& entry = billboards.front();
	require(entry.slot == bmsx::VDP_SLOT_PRIMARY, "BBU should resolve source slot");
	require(entry.surfaceWidth == 16u && entry.surfaceHeight == 16u, "BBU should resolve source surface dimensions");
	require(entry.source.srcX == 2u && entry.source.srcY == 3u, "BBU should resolve source origin");
	require(entry.source.width == 4u && entry.source.height == 5u, "BBU should resolve source dimensions");
	require(std::abs(entry.positionX - 10.0f) < 0.0001f, "BBU should decode X");
	require(std::abs(entry.positionY - 20.0f) < 0.0001f, "BBU should decode Y");
	require(std::abs(entry.positionZ - 30.0f) < 0.0001f, "BBU should decode Z");
	require(std::abs(entry.size - 2.0f) < 0.0001f, "BBU should decode size");
	require(std::abs(entry.color.r - (0x11 / 255.0f)) < 0.0001f, "BBU should decode color R");
	require(std::abs(entry.color.g - (0x22 / 255.0f)) < 0.0001f, "BBU should decode color G");
	require(std::abs(entry.color.b - (0x33 / 255.0f)) < 0.0001f, "BBU should decode color B");
	require(std::abs(entry.color.a - 1.0f) < 0.0001f, "BBU should decode color A");
	h.vdp.completeReadyExecution(queue);
}

void testBbuFaultsAtBillboardPacketAcceptance() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto zeroSize = billboardPacket(0u);
	zeroSize.push_back(VDP_PKT_END);
	expectThrow([&] { sealStream(h, zeroSize); }, "zero billboard size");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "zero-size BILLBOARD should cancel the build frame");

	auto badControl = billboardPacket(1u << 16u, 0u, 0u, 1u, 1u, 1u);
	badControl.push_back(VDP_PKT_END);
	expectThrow([&] { sealStream(h, badControl); }, "BILLBOARD reserved control");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "bad-control BILLBOARD should cancel the build frame");

	auto badSource = billboardPacket(1u << 16u, 15u, 0u, 2u, 1u);
	badSource.push_back(VDP_PKT_END);
	expectThrow([&] { sealStream(h, badSource); }, "BBU source rect overflow");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "bad-source BILLBOARD should cancel the build frame");

	std::vector<uint32_t> overflow;
	for (size_t index = 0; index <= bmsx::VDP_BBU_BILLBOARD_LIMIT; ++index) {
		auto packet = billboardPacket(1u << 16u, 0u, 0u, 1u, 1u);
		overflow.insert(overflow.end(), packet.begin(), packet.end());
	}
	overflow.push_back(VDP_PKT_END);
	expectThrow([&] { sealStream(h, overflow); }, "BBU billboard overflow");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "overflow BILLBOARD should cancel the build frame");
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
		{"raw register frame behavior", testRawRegisterWordsDoNotCancelFrame},
		{"latch snapshot geometry", testLatchSnapshotGeometry},
		{"BLIT DRAW_CTRL snapshot", testBlitDrawCtrlSnapshot},
		{"PMU parallax resolved BLIT snapshot", testPmuParallaxResolvedBlitSnapshot},
		{"PMU bank registers resolve DRAW_CTRL", testPmuBankRegistersResolveDrawCtrl},
		{"PMU scale uses absolute weight", testPmuScaleUsesAbsoluteWeight},
		{"FIFO replay and faults", testFifoReplayAndFaults},
		{"slot registers", testSlotRegisters},
		{"BLIT source geometry datapath", testBlitSourceGeometryEntersFrameDatapath},
		{"BLIT and LINE representable geometry", testBlitAndLineConsumeRepresentableGeometry},
		{"PMU resolved scale datapath", testPmuResolvedScaleFlowsThroughBlitDatapath},
		{"SBX commits through frame present", testSbxCommitsOnlyThroughFramePresent},
		{"SBX validates at frame seal", testSbxValidatesAtFrameSeal},
		{"SBX SKYBOX packet latches frame state", testSbxSkyboxPacketLatchesFrameState},
		{"SBX SKYBOX packet faults", testSbxSkyboxPacketFaultsAtAcceptanceAndFrameSeal},
		{"BBU BILLBOARD packet latches instance RAM", testBbuBillboardPacketLatchesInstanceRam},
		{"BBU faults at BILLBOARD packet acceptance", testBbuFaultsAtBillboardPacketAcceptance},
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
