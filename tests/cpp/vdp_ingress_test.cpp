#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/vdp/bbu.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include "render/vdp/transform.h"

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
constexpr uint32_t VDP_XF_MATRIX_HEADER = bmsx::VDP_XF_PACKET_KIND | (bmsx::VDP_XF_MATRIX_PACKET_PAYLOAD_WORDS << 16u);
constexpr uint32_t VDP_XF_SELECT_HEADER = bmsx::VDP_XF_PACKET_KIND | (bmsx::VDP_XF_SELECT_PACKET_PAYLOAD_WORDS << 16u);

constexpr uint32_t regIndex(uint32_t addr) {
	return (addr - bmsx::IO_VDP_REG0) / bmsx::IO_WORD_SIZE;
}

constexpr uint32_t VDP_REG_BG_COLOR = regIndex(bmsx::IO_VDP_REG_BG_COLOR);
constexpr uint32_t VDP_REG_SRC_SLOT = regIndex(bmsx::IO_VDP_REG_SRC_SLOT);
constexpr uint32_t VDP_REG_DRAW_PRIORITY = regIndex(bmsx::IO_VDP_REG_DRAW_PRIORITY);
constexpr uint32_t VDP_REG_SLOT_INDEX = regIndex(bmsx::IO_VDP_REG_SLOT_INDEX);

void writeIo(bmsx::Memory& memory, uint32_t addr, uint32_t value) {
	memory.writeValue(addr, bmsx::valueNumber(static_cast<double>(value)));
}

void setIo(bmsx::Memory& memory, uint32_t addr, uint32_t value) {
	memory.writeIoValue(addr, bmsx::valueNumber(static_cast<double>(value)));
}

struct Harness {
	bmsx::Memory memory;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::VDP vdp;

	Harness()
		: memory()
		, cpu(memory)
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

void sealFifo(Harness& harness, const std::vector<uint32_t>& words) {
	for (const uint32_t word : words) {
		writeIo(harness.memory, bmsx::IO_VDP_FIFO, word);
	}
	writeIo(harness.memory, bmsx::IO_VDP_FIFO_CTRL, bmsx::VDP_FIFO_CTRL_SEAL);
}

void writePrimaryPixel(Harness& h, uint32_t x, uint32_t y, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	std::vector<uint8_t> pixels(16u * 16u * 4u, 0u);
	const size_t index = (static_cast<size_t>(y) * 16u + static_cast<size_t>(x)) * 4u;
	pixels[index + 0u] = r;
	pixels[index + 1u] = g;
	pixels[index + 2u] = b;
	pixels[index + 3u] = a;
	h.vdp.writeVram(bmsx::VRAM_PRIMARY_SLOT_BASE, pixels.data(), pixels.size());
}

void requireFramePixel(const Harness& h, uint32_t x, uint32_t y, uint8_t r, uint8_t g, uint8_t b, uint8_t a, const char* message) {
	const auto& pixels = h.vdp.frameBufferRenderReadback();
	const size_t index = (static_cast<size_t>(y) * h.vdp.frameBufferWidth() + static_cast<size_t>(x)) * 4u;
	require(pixels[index + 0u] == r, message);
	require(pixels[index + 1u] == g, message);
	require(pixels[index + 2u] == b, message);
	require(pixels[index + 3u] == a, message);
}

std::vector<uint32_t> xfMatrixRegisterPacket(uint32_t matrixIndex, const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS>& words) {
	std::vector<uint32_t> packet{VDP_XF_MATRIX_HEADER, matrixIndex * bmsx::VDP_XF_MATRIX_WORDS};
	packet.insert(packet.end(), words.begin(), words.end());
	return packet;
}

std::vector<uint32_t> xfSelectRegisterPacket(uint32_t viewMatrixIndex, uint32_t projectionMatrixIndex) {
	return {VDP_XF_SELECT_HEADER, bmsx::VDP_XF_VIEW_MATRIX_INDEX_REGISTER, viewMatrixIndex, projectionMatrixIndex};
}

std::vector<uint32_t> billboardPacket(uint32_t sizeWord, uint32_t u = 2u, uint32_t v = 3u, uint32_t w = 4u, uint32_t h = 5u, uint32_t control = 0u) {
	return {
		VDP_BILLBOARD_HEADER,
		0u,
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
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_PRIORITY, 7u);
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
	writePrimaryPixel(h, 3u, 3u, 0x11u, 0x22u, 0x33u, 0xffu);
	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 16u << 16u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_X, 10u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_Y, 20u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_PRIORITY, 9u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0xff000003u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	requireFramePixel(h, 10u, 4u, 0x11u, 0x22u, 0x33u, 0xffu, "DRAW_CTRL flip and parallax should execute inside the VDP");
}

void testPmuParallaxResolvedBlitSnapshot() {
	Harness h;

	h.vdp.setTiming(1000, 1000, 0);
	writeIo(h.memory, bmsx::IO_VDP_PMU_BANK, 0u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 16u << 16u);
	h.vdp.accrueCycles(250, 250);

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writePrimaryPixel(h, 0u, 0u, 0x44u, 0x55u, 0x66u, 0xffu);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_X, 32u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_Y, 40u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_PRIORITY, 9u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x00800000u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 100u << 16u);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 8u << 16u);
	h.vdp.accrueCycles(500, 750);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	requireFramePixel(h, 32u, 48u, 0x44u, 0x55u, 0x66u, 0xffu, "PMU should resolve +8px Y before VDP execution");
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
	writePrimaryPixel(h, 0u, 0u, 0x77u, 0x88u, 0x99u, 0xffu);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_X, 32u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_Y, 40u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_PRIORITY, 9u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x00800000u | (3u << 8u));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	requireFramePixel(h, 32u, 46u, 0x77u, 0x88u, 0x99u, 0xffu, "PMU bank Y should resolve inside VDP execution");
}

void testPmuScaleUsesAbsoluteWeight() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_PMU_BANK, 3u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_Y, 12u << 16u);
	writeIo(h.memory, bmsx::IO_VDP_PMU_SCALE_X, 0x00018000u);

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writePrimaryPixel(h, 0u, 0u, 0xaau, 0xbbu, 0xccu, 0xffu);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_X, 32u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DST_Y, 40u << 16);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_PRIORITY, 9u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0xff800000u | (3u << 8u));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "BLIT should submit render work");
	h.vdp.advanceWork(workUnits);
	requireFramePixel(h, 32u, 34u, 0xaau, 0xbbu, 0xccu, 0xffu, "negative PMU weight should invert offset inside VDP execution");
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
	sealStream(range, {VDP_PKT_REG1 | 19u, 0u, VDP_PKT_END});
	expectVdpFault(range, bmsx::VDP_FAULT_STREAM_BAD_PACKET, "REG1 range should latch stream fault");
	clearVdpFault(range);
	sealStream(range, {VDP_PKT_REGN | (2u << 16) | 18u, 0u, 0u, VDP_PKT_END});
	expectVdpFault(range, bmsx::VDP_FAULT_STREAM_BAD_PACKET, "REGN range should latch stream fault");
}

void testStreamDexFaultsAbortSealedFrame() {
	Harness fifo;
	writeIo(fifo.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(fifo.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(fifo.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(fifo.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(fifo.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0u);
	writeIo(fifo.memory, bmsx::IO_VDP_REG_DRAW_SCALE_Y, 0x00010000u);
	sealFifo(fifo, {VDP_PKT_CMD | VDP_CMD_BLIT, VDP_PKT_END});
	expectVdpFault(fifo, bmsx::VDP_FAULT_DEX_INVALID_SCALE, "FIFO DEX invalid scale should latch a DEX fault");
	require(fifo.vdp.getPendingRenderWorkUnits() == 0, "FIFO DEX fault should abort the sealed stream frame");
	require(fifo.vdp.canAcceptVdpSubmit(), "FIFO DEX fault should leave the submit path open");

	Harness dma;
	writeIo(dma.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(dma.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(dma.memory, bmsx::IO_VDP_REG_SRC_UV, 15u);
	writeIo(dma.memory, bmsx::IO_VDP_REG_SRC_WH, 2u | (16u << 16));
	writeIo(dma.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0x00010000u);
	writeIo(dma.memory, bmsx::IO_VDP_REG_DRAW_SCALE_Y, 0x00010000u);
	sealStream(dma, {VDP_PKT_CMD | VDP_CMD_BLIT, VDP_PKT_END});
	expectVdpFault(dma, bmsx::VDP_FAULT_DEX_SOURCE_OOB, "DMA DEX source OOB should latch a DEX fault");
	require(dma.vdp.getPendingRenderWorkUnits() == 0, "DMA DEX fault should abort the sealed stream frame");
	require(dma.vdp.canAcceptVdpSubmit(), "DMA DEX fault should leave the submit path open");
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

void testUnsupportedDrawCtrlBlendFaultsAtBlitSnapshot() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16));
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_SLOT, bmsx::VDP_SLOT_PRIMARY);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_UV, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_SRC_WH, 4u | (4u << 16));
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_X, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_SCALE_Y, 0x00010000u);
	writeIo(h.memory, bmsx::IO_VDP_REG_DRAW_CTRL, 0x00000004u);

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BLIT);
	expectVdpFault(h, bmsx::VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL, "unsupported DRAW_CTRL blend bits should latch a device fault");
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_CTRL) == 0x00000004u, "DRAW_CTRL raw register bits should remain latched");
}

void testBlitterFifoOverflowFaultsInsteadOfThrowing() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_X0, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_Y0, 0u);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_X1, 1u << 16u);
	writeIo(h.memory, bmsx::IO_VDP_REG_GEOM_Y1, 1u << 16u);
	for (size_t index = 0; index <= 4096u; ++index) {
		writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_FILL_RECT);
	}

	expectVdpFault(h, bmsx::VDP_FAULT_DEX_OVERFLOW, "blitter FIFO overflow should latch a device fault");
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
	h.vdp.presentReadyFrameOnVblankEdge();
	require(h.vdp.readHostOutput().skyboxEnabled, "presented frame should commit visible SBX state");

	writeSbxMmio(h.memory, 0u);
	require(h.vdp.readHostOutput().skyboxEnabled, "live SBX clear should not change visible skybox immediately");
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	writeIo(h.memory, bmsx::IO_VDP_CMD, VDP_CMD_END_FRAME);
	h.vdp.presentReadyFrameOnVblankEdge();
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
	h.vdp.presentReadyFrameOnVblankEdge();
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
	h.vdp.presentReadyFrameOnVblankEdge();
	require(!h.vdp.readHostOutput().skyboxEnabled, "raw control without enable bit should not show SKYBOX");

	auto badSource = skyboxPacket(bmsx::VDP_SBX_CONTROL_ENABLE, 17u, 1u);
	badSource.push_back(VDP_PKT_END);
	sealStream(h, badSource);
	expectVdpFault(h, bmsx::VDP_FAULT_SBX_SOURCE_OOB, "bad-source SKYBOX should latch a device fault");
	require(!h.vdp.readHostOutput().skyboxEnabled, "bad-source SKYBOX should not become visible");
}

void testXfPacketUpdatesRawTransformRegisterState() {
	Harness h;
	constexpr uint32_t viewMatrixIndex = 2u;
	constexpr uint32_t projectionMatrixIndex = 3u;
	const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS> viewWords{{
		0x00010000u, 0u, 0u, 0u,
		0u, 0x00010000u, 0u, 0u,
		0u, 0u, 0x00010000u, 0u,
		0x00030000u, 0x00040000u, 0xfffb0000u, 0x00010000u,
	}};
	const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS> projWords{{
		0x00020000u, 0u, 0u, 0u,
		0u, 0x00020000u, 0u, 0u,
		0u, 0u, 0xffff0000u, 0xffff0000u,
		0u, 0u, 0xfffe0000u, 0u,
	}};
	std::vector<uint32_t> stream = xfMatrixRegisterPacket(viewMatrixIndex, viewWords);
	auto projectionPacket = xfMatrixRegisterPacket(projectionMatrixIndex, projWords);
	stream.insert(stream.end(), projectionPacket.begin(), projectionPacket.end());
	auto selectPacket = xfSelectRegisterPacket(viewMatrixIndex, projectionMatrixIndex);
	stream.insert(stream.end(), selectPacket.begin(), selectPacket.end());
	stream.push_back(VDP_PKT_END);
	sealStream(h, stream);

	const bmsx::VdpState state = h.vdp.captureState();
	const size_t viewBase = static_cast<size_t>(viewMatrixIndex * bmsx::VDP_XF_MATRIX_WORDS);
	const size_t projectionBase = static_cast<size_t>(projectionMatrixIndex * bmsx::VDP_XF_MATRIX_WORDS);
	require(state.xf.viewMatrixIndex == viewMatrixIndex, "XF should select view matrix index");
	require(state.xf.projectionMatrixIndex == projectionMatrixIndex, "XF should select projection matrix index");
	for (size_t index = 0; index < bmsx::VDP_XF_MATRIX_WORDS; ++index) {
		require(state.xf.matrixWords[viewBase + index] == viewWords[index], "XF should preserve view matrix words");
		require(state.xf.matrixWords[projectionBase + index] == projWords[index], "XF should preserve projection matrix words");
	}
}

void testXfWordsResolveToRenderOwnedSkyboxTransform() {
	bmsx::VdpTransformSnapshot transform;
	constexpr uint32_t viewMatrixIndex = 2u;
	constexpr uint32_t projectionMatrixIndex = 3u;
	std::array<uint32_t, bmsx::VDP_XF_MATRIX_REGISTER_WORDS> matrixWords{};
	const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS> viewWords{{
		0x00020000u, 0u, 0u, 0u,
		0u, 0x00040000u, 0u, 0u,
		0u, 0u, 0x00080000u, 0u,
		0x00060000u, 0x00080000u, 0x00100000u, 0x00010000u,
	}};
	const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS> projWords{{
		0x00010000u, 0u, 0u, 0u,
		0u, 0x00010000u, 0u, 0u,
		0u, 0u, 0x00010000u, 0u,
		0u, 0u, 0u, 0x00010000u,
	}};
	for (size_t index = 0; index < bmsx::VDP_XF_MATRIX_WORDS; ++index) {
		matrixWords[static_cast<size_t>(viewMatrixIndex * bmsx::VDP_XF_MATRIX_WORDS) + index] = viewWords[index];
		matrixWords[static_cast<size_t>(projectionMatrixIndex * bmsx::VDP_XF_MATRIX_WORDS) + index] = projWords[index];
	}

	bmsx::resolveVdpTransformSnapshot(transform, matrixWords, viewMatrixIndex, projectionMatrixIndex);

	require(transform.view[0] == 2.0f, "XF view should decode Q16.16 words");
	require(transform.skyboxView[0] == 0.5f, "XF skybox view should invert affine X scale");
	require(transform.skyboxView[5] == 0.25f, "XF skybox view should invert affine Y scale");
	require(transform.skyboxView[10] == 0.125f, "XF skybox view should invert affine Z scale");
	require(transform.skyboxView[12] == 0.0f && transform.skyboxView[13] == 0.0f && transform.skyboxView[14] == 0.0f, "XF skybox view should remove translation");
	require(transform.eye.x == -3.0f && transform.eye.y == -2.0f && transform.eye.z == -2.0f, "XF eye should come from affine inverse");
}

void testXfPacketFaultsThroughVdpState() {
	Harness h;
	std::vector<uint32_t> stream{
		bmsx::VDP_XF_PACKET_KIND | (bmsx::VDP_XF_SELECT_PACKET_PAYLOAD_WORDS << 16u),
		bmsx::VDP_XF_VIEW_MATRIX_INDEX_REGISTER,
		bmsx::VDP_XF_MATRIX_COUNT,
		0u,
	};
	stream.push_back(VDP_PKT_END);
	sealStream(h, stream);
	expectVdpFault(h, bmsx::VDP_FAULT_STREAM_BAD_PACKET, "bad XF packet should latch a stream fault");
	require(h.vdp.getPendingRenderWorkUnits() == 0, "bad XF packet should not submit render work");
}

void testXfStateCommitsWithSubmittedFrame() {
	Harness h;
	const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS> projWords{{
		0x00010000u, 0u, 0u, 0u,
		0u, 0x00010000u, 0u, 0u,
		0u, 0u, 0x00010000u, 0u,
		0u, 0u, 0u, 0x00010000u,
	}};
	const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS> frameAView{{
		0x00020000u, 0u, 0u, 0u,
		0u, 0x00010000u, 0u, 0u,
		0u, 0u, 0x00010000u, 0u,
		0u, 0u, 0u, 0x00010000u,
	}};
	const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS> frameBView{{
		0x00030000u, 0u, 0u, 0u,
		0u, 0x00010000u, 0u, 0u,
		0u, 0u, 0x00010000u, 0u,
		0u, 0u, 0u, 0x00010000u,
	}};

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	std::vector<uint32_t> frameA = xfMatrixRegisterPacket(2u, frameAView);
	auto frameAProj = xfMatrixRegisterPacket(3u, projWords);
	frameA.insert(frameA.end(), frameAProj.begin(), frameAProj.end());
	auto frameASelect = xfSelectRegisterPacket(2u, 3u);
	frameA.insert(frameA.end(), frameASelect.begin(), frameASelect.end());
	frameA.insert(frameA.end(), {
		VDP_PKT_REGN | (5u << 16u) | VDP_REG_SRC_SLOT,
		bmsx::VDP_SLOT_PRIMARY,
		0u,
		4u | (4u << 16u),
		0u,
		0u,
		VDP_PKT_REG1 | VDP_REG_DRAW_PRIORITY,
		9u,
		VDP_PKT_CMD | VDP_CMD_BLIT,
		VDP_PKT_END,
	});
	sealStream(h, frameA);

	std::vector<uint32_t> frameB = xfMatrixRegisterPacket(4u, frameBView);
	auto frameBProj = xfMatrixRegisterPacket(5u, projWords);
	frameB.insert(frameB.end(), frameBProj.begin(), frameBProj.end());
	auto frameBSelect = xfSelectRegisterPacket(4u, 5u);
	frameB.insert(frameB.end(), frameBSelect.begin(), frameBSelect.end());
	frameB.push_back(VDP_PKT_END);
	sealStream(h, frameB);

	const int workUnits = h.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "frame A should require render work");
	h.vdp.advanceWork(workUnits);
	require(h.vdp.presentReadyFrameOnVblankEdge(), "frame A should present framebuffer work");
	const auto output = h.vdp.readHostOutput();
	require(output.xfViewMatrixIndex == 2u, "presented XF should keep frame A view index");
	require(output.xfProjectionMatrixIndex == 3u, "presented XF should keep frame A projection index");
	require((*output.xfMatrixWords)[2u * bmsx::VDP_XF_MATRIX_WORDS] == frameAView[0], "presented XF should keep frame A matrix words");
	require((*output.xfMatrixWords)[2u * bmsx::VDP_XF_MATRIX_WORDS] != frameBView[0], "presented XF should not use frame B live matrix");
}

void testBbuBillboardPacketLatchesInstanceRam() {
	Harness h;

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 16u | (16u << 16u));
	auto stream = billboardPacket(2u << 16u);
	stream.push_back(VDP_PKT_END);
	sealStream(h, stream);
	require(h.vdp.getPendingRenderWorkUnits() == 1, "BILLBOARD should submit BBU render work");
	h.vdp.advanceWork(1);
	require(!h.vdp.presentReadyFrameOnVblankEdge(), "BILLBOARD should not present framebuffer pages");
	const auto output = h.vdp.readHostOutput();
	const auto& billboards = *output.billboards;
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
	require(entry.color == 0xff112233u, "BBU should preserve packed ARGB color");
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

void testVramReadFaultsLatchStatus() {
	Harness h;
	std::array<uint8_t, 4> bytes{{0xffu, 0xffu, 0xffu, 0xffu}};

	h.vdp.readVram(0u, bytes.data(), bytes.size());
	expectVdpFault(h, bmsx::VDP_FAULT_VRAM_WRITE_UNMAPPED, "unmapped VRAM read should latch fault code");
	require(bytes == std::array<uint8_t, 4>{{0u, 0u, 0u, 0u}}, "unmapped VRAM read should return zero bytes");
	clearVdpFault(h);

	writeIo(h.memory, bmsx::IO_VDP_REG_SLOT_DIM, 1u | (1u << 16u));
	bytes = std::array<uint8_t, 4>{{0xffu, 0xffu, 0xffu, 0xffu}};
	h.vdp.readVram(bmsx::VRAM_PRIMARY_SLOT_BASE + 4u, bytes.data(), bytes.size());
	expectVdpFault(h, bmsx::VDP_FAULT_VRAM_WRITE_OOB, "OOB VRAM read should latch fault code");
	require(bytes == std::array<uint8_t, 4>{{0u, 0u, 0u, 0u}}, "OOB VRAM read should return zero bytes");
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
		{"sealed stream DEX faults", testStreamDexFaultsAbortSealedFrame},
		{"slot registers", testSlotRegisters},
		{"BLIT source DEX faults", testBlitSourceFaultsLatchDexFaults},
		{"BLIT and LINE DEX faults", testBlitAndLineLatchDexFaults},
		{"DRAW_CTRL unsupported blend fault", testUnsupportedDrawCtrlBlendFaultsAtBlitSnapshot},
		{"blitter FIFO overflow fault", testBlitterFifoOverflowFaultsInsteadOfThrowing},
		{"PMU resolved scale datapath", testPmuResolvedScaleFlowsThroughBlitDatapath},
		{"SBX commits through frame present", testSbxCommitsOnlyThroughFramePresent},
		{"SBX validates at frame seal", testSbxValidatesAtFrameSeal},
		{"SBX SKYBOX packet latches frame state", testSbxSkyboxPacketLatchesFrameState},
		{"SBX SKYBOX packet raw control", testSbxSkyboxPacketRawControlAndFrameSealFault},
		{"VDP XF packet raw state", testXfPacketUpdatesRawTransformRegisterState},
		{"VDP XF render transform", testXfWordsResolveToRenderOwnedSkyboxTransform},
		{"VDP XF packet fault state", testXfPacketFaultsThroughVdpState},
		{"VDP XF frame commit timing", testXfStateCommitsWithSubmittedFrame},
		{"BBU BILLBOARD packet latches instance RAM", testBbuBillboardPacketLatchesInstanceRam},
		{"BBU faults at BILLBOARD packet acceptance", testBbuFaultsAtBillboardPacketAcceptance},
		{"empty FIFO frame", testEmptyFifoFrame},
		{"VDP readback fault status", testReadbackFaultsLatchStatus},
		{"VDP fault latch sticky-first", testFaultLatchStickyFirstUntilAck},
		{"VDP readback OOB fault status", testReadbackOobFaultsLatchStatus},
		{"VDP VRAM write fault status", testVramWriteFaultsLatchStatus},
		{"VDP VRAM read fault status", testVramReadFaultsLatchStatus},
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
