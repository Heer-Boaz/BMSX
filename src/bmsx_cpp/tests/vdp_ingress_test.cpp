#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/vdp/bbu.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/memory/string_memory.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
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

void expectVdpFault(Harness& h, uint32_t code, const char* label) {
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == code, label);
	require((h.memory.readIoU32(bmsx::IO_VDP_STATUS) & bmsx::VDP_STATUS_FAULT) != 0u, label);
}

void clearVdpFault(Harness& h) {
	writeIo(h.memory, bmsx::IO_VDP_FAULT_ACK, 1u);
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "FAULT_ACK should clear VDP fault code");
	require((h.memory.readIoU32(bmsx::IO_VDP_STATUS) & bmsx::VDP_STATUS_FAULT) == 0u, "FAULT_ACK should clear VDP fault status bit");
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_ACK) == 0u, "FAULT_ACK write should self-clear");
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

void writeSbxMmio(bmsx::Memory& memory, uint32_t control = bmsx::VDP_SBX_CONTROL_ENABLE, uint32_t w = 1u, uint32_t h = 1u) {
	uint32_t addr = bmsx::IO_VDP_SBX_FACE0;
	for (size_t face = 0; face < bmsx::SKYBOX_FACE_COUNT; ++face) {
		writeIo(memory, addr + 0u * bmsx::IO_WORD_SIZE, bmsx::VDP_SLOT_PRIMARY);
		writeIo(memory, addr + 1u * bmsx::IO_WORD_SIZE, 0u);
		writeIo(memory, addr + 2u * bmsx::IO_WORD_SIZE, 0u);
		writeIo(memory, addr + 3u * bmsx::IO_WORD_SIZE, w);
		writeIo(memory, addr + 4u * bmsx::IO_WORD_SIZE, h);
		addr += 5u * bmsx::IO_WORD_SIZE;
	}
	writeIo(memory, bmsx::IO_VDP_SBX_CONTROL, control);
	writeIo(memory, bmsx::IO_VDP_SBX_COMMIT, bmsx::VDP_SBX_COMMIT_WRITE);
}

void writeCameraMmio(bmsx::Memory& memory, const std::array<bmsx::f32, 16>& view, const std::array<bmsx::f32, 16>& proj, const std::array<bmsx::f32, 3>& eye) {
	for (size_t index = 0; index < 16u; ++index) {
		writeIo(memory, bmsx::IO_VDP_CAMERA_VIEW + static_cast<uint32_t>(index * bmsx::IO_WORD_SIZE), bmsx::numberToF32Bits(view[index]));
		writeIo(memory, bmsx::IO_VDP_CAMERA_PROJ + static_cast<uint32_t>(index * bmsx::IO_WORD_SIZE), bmsx::numberToF32Bits(proj[index]));
	}
	for (size_t index = 0; index < 3u; ++index) {
		writeIo(memory, bmsx::IO_VDP_CAMERA_EYE + static_cast<uint32_t>(index * bmsx::IO_WORD_SIZE), bmsx::numberToF32Bits(eye[index]));
	}
	writeIo(memory, bmsx::IO_VDP_CAMERA_COMMIT, bmsx::VDP_CAMERA_COMMIT_WRITE);
}

void testDirectLifecycle() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	expectVdpFault(h, bmsx::VDP_FAULT_SUBMIT_STATE, "END without BEGIN should latch submit-state fault");
	clearVdpFault(h);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_FILL_RECT);
	expectVdpFault(h, bmsx::VDP_FAULT_SUBMIT_STATE, "draw without BEGIN should latch submit-state fault");
	clearVdpFault(h);

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	expectVdpFault(h, bmsx::VDP_FAULT_SUBMIT_STATE, "double BEGIN should latch submit-state fault");
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
	const auto output = h.vdp.readHostOutput();
	require(output.executionToken != 0u, "host output should expose an execution token");
	const auto* queue = output.executionQueue;
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(command.flipH && command.flipV, "DRAW_CTRL flip bits should be snapshotted");
	require(std::abs(command.parallaxWeight + 1.0f) < 0.0001f, "DRAW_CTRL signed Q8.8 parallax should be snapshotted");
	h.vdp.completeHostExecution(output);
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
	const auto output = h.vdp.readHostOutput();
	const auto* queue = output.executionQueue;
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(std::abs(command.parallaxWeight - 0.5f) < 0.0001f, "DRAW_CTRL parallax weight should remain per-BLIT state");
	require(std::abs(command.dstX - 32.0f) < 0.0001f, "PMU should leave X unchanged for this rig");
	require(std::abs(command.dstY - 48.0f) < 0.0001f, "PMU should resolve +8px Y before backend execution");
	require(std::abs(command.scaleX - 1.0f) < 0.0001f, "PMU should leave scale X unchanged for this rig");
	require(std::abs(command.scaleY - 1.0f) < 0.0001f, "PMU should leave scale Y unchanged for this rig");
	h.vdp.completeHostExecution(output);
	require(h.vdp.readHostOutput().executionToken == 0u, "host execution ack should clear token");
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
	const auto output = h.vdp.readHostOutput();
	const auto* queue = output.executionQueue;
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(std::abs(command.parallaxWeight - 0.5f) < 0.0001f, "DRAW_CTRL parallax weight should be snapshotted");
	require(std::abs(command.dstY - 46.0f) < 0.0001f, "PMU bank Y should resolve into BLIT geometry");
	require(std::abs(command.scaleX - 1.25f) < 0.0001f, "PMU bank scale X should resolve into BLIT geometry");
	require(std::abs(command.scaleY - 1.0f) < 0.0001f, "PMU bank scale Y should remain unchanged");
	h.vdp.completeHostExecution(output);
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
	const auto output = h.vdp.readHostOutput();
	const auto* queue = output.executionQueue;
	require(queue != nullptr && queue->size() == 1u, "BLIT should reach the execution queue");
	const auto& command = queue->front();
	require(command.type == bmsx::VDP::BlitterCommandType::Blit, "queued command should be a BLIT");
	require(std::abs(command.parallaxWeight + 0.5f) < 0.0001f, "DRAW_CTRL negative parallax weight should be snapshotted");
	require(std::abs(command.dstY - 34.0f) < 0.0001f, "negative PMU weight should invert offset");
	require(std::abs(command.scaleX - 1.25f) < 0.0001f, "negative PMU weight should use absolute scale influence");
	require(std::abs(command.scaleY - 1.0f) < 0.0001f, "PMU bank scale Y should remain unchanged");
	h.vdp.completeHostExecution(output);
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
	sealStream(fault, {
		VDP_PKT_REG1 | VDP_REG_BG_COLOR,
		0xff102030u,
		0x04000000u,
		VDP_PKT_END,
	});
	expectVdpFault(fault, bmsx::VDP_FAULT_STREAM_BAD_PACKET, "unknown packet kind should latch stream fault");
	require(fault.memory.readIoU32(bmsx::IO_VDP_REG_BG_COLOR) == 0xff102030u, "prior FIFO register write should remain after fault");

	Harness range;
	sealStream(range, {VDP_PKT_CMD | (1u << 16) | VDP_CMD_CLEAR, VDP_PKT_END});
	expectVdpFault(range, bmsx::VDP_FAULT_STREAM_BAD_PACKET, "CMD reserved bits should latch stream fault");
	clearVdpFault(range);
	sealStream(range, {VDP_PKT_REG1 | 18u, 0u, VDP_PKT_END});
	expectVdpFault(range, bmsx::VDP_FAULT_STREAM_BAD_PACKET, "REG1 range should latch stream fault");
	clearVdpFault(range);
	sealStream(range, {VDP_PKT_REGN | (2u << 16) | 17u, 0u, 0u, VDP_PKT_END});
	expectVdpFault(range, bmsx::VDP_FAULT_STREAM_BAD_PACKET, "REGN range should latch stream fault");
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

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 0xffffffffu);
	expectVdpFault(h, bmsx::VDP_FAULT_VRAM_SLOT_DIM, "slot capacity overflow should latch a cart-visible fault");
	const auto afterFault = h.vdp.resolveBlitterSurfaceSize(bmsx::VDP_RD_SURFACE_PRIMARY);
	require(afterFault.width == 16u && afterFault.height == 16u, "invalid SLOT_DIM should not change the slot");
}

void testBlitSourceFaultsLatchDexFaults() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_Y, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, 99u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	expectVdpFault(h, bmsx::VDP_FAULT_DEX_SOURCE_SLOT, "DEX invalid source slot should latch a source-slot fault");
	require(!h.vdp.canAcceptVdpSubmit(), "invalid DEX source slot should keep the direct frame open");
	clearVdpFault(h);

	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 15u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 2u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	expectVdpFault(h, bmsx::VDP_FAULT_DEX_SOURCE_OOB, "DEX source rect overflow should latch a source fault");
	require(!h.vdp.canAcceptVdpSubmit(), "invalid DEX source rect should keep the direct frame open");
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
}

void testBlitAndLineLatchDexFaults() {
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
		expectVdpFault(h, bmsx::VDP_FAULT_DEX_INVALID_SCALE, "invalid DEX scale should latch a device fault");
		require(!h.vdp.canAcceptVdpSubmit(), "invalid DEX scale should drop the command and keep the direct frame open");
	}
	{
		Harness h;
		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
		writeIo(h.memory, bmsx::IO_VDP_REG_LINE_WIDTH, 0u);

		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_DRAW_LINE);
		require(h.memory.readIoU32(bmsx::IO_VDP_REG_LINE_WIDTH) == 0u, "raw zero line width should remain latched");
		expectVdpFault(h, bmsx::VDP_FAULT_DEX_INVALID_LINE_WIDTH, "invalid LINE width should latch a device fault");
		require(!h.vdp.canAcceptVdpSubmit(), "invalid LINE width should drop the command and keep the direct frame open");
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

	require(!h.vdp.readHostOutput().skyboxEnabled, "skybox starts disabled");
	writeSbxMmio(h.memory);
	require(!h.vdp.readHostOutput().skyboxEnabled, "live SBX write should not commit visible skybox");

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	require(!h.vdp.readHostOutput().skyboxEnabled, "sealed SBX frame should wait for VBlank present");
	h.vdp.commitReadyFrameOnVblankEdge();
	require(h.vdp.readHostOutput().skyboxEnabled, "presented frame should commit visible SBX state");

	writeSbxMmio(h.memory, 0u);
	require(h.vdp.readHostOutput().skyboxEnabled, "live SBX clear should not change visible skybox immediately");
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	h.vdp.commitReadyFrameOnVblankEdge();
	require(!h.vdp.readHostOutput().skyboxEnabled, "presented clear frame should disable visible skybox");
}

void testSbxValidatesAtFrameSeal() {
	Harness h;

	writeSbxMmio(h.memory, bmsx::VDP_SBX_CONTROL_ENABLE, 2u, 1u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	expectVdpFault(h, bmsx::VDP_FAULT_SBX_SOURCE_OOB, "SBX source rect overflow should latch a device fault");
	require(h.vdp.canAcceptVdpSubmit(), "invalid SBX frame should cancel and close the build frame");
	require(!h.vdp.readHostOutput().skyboxEnabled, "invalid SBX state should not become visible");
}

void testSbxSkyboxPacketLatchesFrameState() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto stream = skyboxPacket(bmsx::VDP_SBX_CONTROL_ENABLE, 4u, 5u);
	stream.push_back(VDP_PKT_END);
	sealStream(h, stream);
	h.vdp.commitReadyFrameOnVblankEdge();
	require(h.vdp.readHostOutput().skyboxEnabled, "SKYBOX packet should present visible SBX state");
	const auto sample = (*h.vdp.readHostOutput().skyboxSamples)[0u];
	require(sample.source.surfaceId == bmsx::VDP_RD_SURFACE_PRIMARY, "SKYBOX should resolve primary slot");
	require(sample.surfaceWidth == 16u && sample.surfaceHeight == 16u, "SKYBOX should resolve surface size");
	require(sample.source.width == 4u && sample.source.height == 5u, "SKYBOX should resolve face dimensions");
}

void testSbxSkyboxPacketRawControlAndFrameSealFault() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto badControl = skyboxPacket(2u, 4u, 5u);
	badControl.push_back(VDP_PKT_END);
	sealStream(h, badControl);
	h.vdp.commitReadyFrameOnVblankEdge();
	require(!h.vdp.readHostOutput().skyboxEnabled, "raw control without enable bit should not show SKYBOX");

	auto badSource = skyboxPacket(bmsx::VDP_SBX_CONTROL_ENABLE, 17u, 1u);
	badSource.push_back(VDP_PKT_END);
	sealStream(h, badSource);
	expectVdpFault(h, bmsx::VDP_FAULT_SBX_SOURCE_OOB, "bad-source SKYBOX should latch a device fault");
	require(!h.vdp.readHostOutput().skyboxEnabled, "bad-source SKYBOX should not become visible");
}

void testCameraMmioCommitsLiveBankAtFramePresent() {
	Harness h;
	std::array<bmsx::f32, 16> view{};
	std::array<bmsx::f32, 16> proj{};
	view[0] = 1.0f; view[5] = 1.0f; view[10] = 1.0f; view[15] = 1.0f;
	proj[0] = 1.0f; proj[5] = 1.0f; proj[10] = 1.0f; proj[15] = 1.0f;
	const std::array<bmsx::f32, 3> eye{3.0f, 4.0f, 5.0f};

	writeCameraMmio(h.memory, view, proj, eye);

	require(h.vdp.readHostOutput().camera->eye.x == 0.0f, "camera MMIO should not update visible camera before present");
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	h.vdp.commitReadyFrameOnVblankEdge();
	require(h.vdp.readHostOutput().camera->eye.x == 3.0f, "camera eye X should commit on present");
	require(h.vdp.readHostOutput().camera->eye.y == 4.0f, "camera eye Y should commit on present");
	require(h.vdp.readHostOutput().camera->eye.z == 5.0f, "camera eye Z should commit on present");
}

void testBbuBillboardPacketLatchesInstanceRam() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto stream = billboardPacket(2u << 16u);
	stream.push_back(VDP_PKT_END);
	sealStream(h, stream);
	require(h.vdp.getPendingRenderWorkUnits() == 1, "BILLBOARD should submit BBU render work");
	h.vdp.advanceWork(1);
	const auto output = h.vdp.readHostOutput();
	const auto* queue = output.executionQueue;
	require(queue != nullptr, "BILLBOARD should produce ready execution state");
	const auto& billboards = *output.executionBillboards;
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
	h.vdp.completeHostExecution(output);
}

void testBbuFaultsAtBillboardPacketAcceptance() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto zeroSize = billboardPacket(0u);
	zeroSize.push_back(VDP_PKT_END);
	sealStream(h, zeroSize);
	expectVdpFault(h, bmsx::VDP_FAULT_BBU_ZERO_SIZE, "zero billboard size should latch a device fault");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "zero-size BILLBOARD should cancel the build frame");
	clearVdpFault(h);

	auto badControl = billboardPacket(1u << 16u, 0u, 0u, 1u, 1u, 1u);
	badControl.push_back(VDP_PKT_END);
	sealStream(h, badControl);
	expectVdpFault(h, bmsx::VDP_FAULT_STREAM_BAD_PACKET, "BILLBOARD reserved control should latch a stream fault");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "bad-control BILLBOARD should cancel the build frame");
	clearVdpFault(h);

	auto badSource = billboardPacket(1u << 16u, 15u, 0u, 2u, 1u);
	badSource.push_back(VDP_PKT_END);
	sealStream(h, badSource);
	expectVdpFault(h, bmsx::VDP_FAULT_BBU_SOURCE_OOB, "BBU source rect overflow should latch a device fault");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "bad-source BILLBOARD should cancel the build frame");
	clearVdpFault(h);

	std::vector<uint32_t> overflow;
	for (size_t index = 0; index <= bmsx::VDP_BBU_BILLBOARD_LIMIT; ++index) {
		auto packet = billboardPacket(1u << 16u, 0u, 0u, 1u, 1u);
		overflow.insert(overflow.end(), packet.begin(), packet.end());
	}
	overflow.push_back(VDP_PKT_END);
	sealStream(h, overflow);
	expectVdpFault(h, bmsx::VDP_FAULT_BBU_OVERFLOW, "BBU billboard overflow should latch a device fault");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "overflow BILLBOARD should cancel the build frame");
}

void testEmptyFifoFrame() {
	Harness h;

	sealStream(h, {VDP_PKT_END});
	require(h.vdp.getPendingRenderWorkUnits() == 0, "empty FIFO frame should submit no render work");
}

void testReadbackFaultsLatchStatus() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_RD_MODE, 99u);

	require(h.vdp.readVdpData() == 0u, "unsupported read mode should return open bus");
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_RD_UNSUPPORTED_MODE, "unsupported read mode should latch fault code");
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_DETAIL) == 99u, "unsupported read mode should latch mode detail");
	require((h.memory.readIoU32(bmsx::IO_VDP_STATUS) & bmsx::VDP_STATUS_FAULT) != 0u, "unsupported read mode should set VDP fault status");
	clearVdpFault(h);
}

void testFaultLatchStickyFirstUntilAck() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_RD_MODE, 99u);
	require(h.vdp.readVdpData() == 0u, "unsupported readback should return open-bus zero");
	expectVdpFault(h, bmsx::VDP_FAULT_RD_UNSUPPORTED_MODE, "first fault should latch");
	const std::array<bmsx::u8, 4> data{{1u, 2u, 3u, 4u}};
	h.vdp.writeVram(bmsx::VRAM_PRIMARY_SLOT_BASE + 1u, data.data(), data.size());
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_RD_UNSUPPORTED_MODE, "second fault should not overwrite sticky-first latch");
	clearVdpFault(h);
	h.vdp.writeVram(bmsx::VRAM_PRIMARY_SLOT_BASE + 1u, data.data(), data.size());
	expectVdpFault(h, bmsx::VDP_FAULT_VRAM_WRITE_UNALIGNED, "ACK should allow the next fault to latch");
}

void testReadbackOobFaultsLatchStatus() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_RD_MODE, bmsx::VDP_RD_MODE_RGBA8888);
	writeIo(h.memory, bmsx::IO_VDP_RD_X, 999u);
	writeIo(h.memory, bmsx::IO_VDP_RD_Y, 0u);

	require(h.vdp.readVdpData() == 0u, "OOB read should return open bus");
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_RD_OOB, "OOB read should latch fault code");
}

void testVramWriteFaultsLatchStatus() {
	Harness h;
	const uint8_t bytes[4] = {1u, 2u, 3u, 4u};

	h.vdp.writeVram(bmsx::VRAM_PRIMARY_SLOT_BASE + 1u, bytes, sizeof(bytes));

	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_VRAM_WRITE_UNALIGNED, "unaligned VRAM write should latch fault code");
	require((h.memory.readIoU32(bmsx::IO_VDP_STATUS) & bmsx::VDP_STATUS_FAULT) != 0u, "unaligned VRAM write should set VDP fault status");
}

void testDitherRegisterWritesUpdateLiveLatch() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_DITHER, 3u);

	require(h.vdp.captureState().ditherType == 3, "DITHER write should update live VDP latch directly");
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
		{"BLIT source DEX faults", testBlitSourceFaultsLatchDexFaults},
		{"BLIT and LINE DEX faults", testBlitAndLineLatchDexFaults},
		{"PMU resolved scale datapath", testPmuResolvedScaleFlowsThroughBlitDatapath},
		{"SBX commits through frame present", testSbxCommitsOnlyThroughFramePresent},
		{"SBX validates at frame seal", testSbxValidatesAtFrameSeal},
		{"SBX SKYBOX packet latches frame state", testSbxSkyboxPacketLatchesFrameState},
		{"SBX SKYBOX packet raw control", testSbxSkyboxPacketRawControlAndFrameSealFault},
		{"VDP camera MMIO frame latch", testCameraMmioCommitsLiveBankAtFramePresent},
		{"BBU BILLBOARD packet latches instance RAM", testBbuBillboardPacketLatchesInstanceRam},
		{"BBU faults at BILLBOARD packet acceptance", testBbuFaultsAtBillboardPacketAcceptance},
		{"empty FIFO frame", testEmptyFifoFrame},
		{"VDP readback fault status", testReadbackFaultsLatchStatus},
		{"VDP fault latch sticky-first", testFaultLatchStickyFirstUntilAck},
		{"VDP readback OOB fault status", testReadbackOobFaultsLatchStatus},
		{"VDP VRAM write fault status", testVramWriteFaultsLatchStatus},
		{"VDP dither live latch", testDitherRegisterWritesUpdateLiveLatch},
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
