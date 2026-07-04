#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/frame.h"
#include "machine/devices/vdp/registers.h"
#include "machine/devices/vdp/rpu.h"
#include "machine/devices/vdp/rpu_desc.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include "render/vdp/transform.h"

#include <array>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr uint32_t VDP_XF_MATRIX_HEADER = bmsx::VDP_XF_PACKET_KIND | (bmsx::VDP_XF_MATRIX_PACKET_PAYLOAD_WORDS << 16u);
constexpr uint32_t VDP_XF_SELECT_HEADER = bmsx::VDP_XF_PACKET_KIND | (bmsx::VDP_XF_SELECT_PACKET_PAYLOAD_WORDS << 16u);

struct Harness {
	bmsx::Memory memory;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::VDP vdp;

		Harness()
			: memory({
				{ nullptr, 0 },
				{ nullptr, 0 }
			})
		, cpu(memory)
		, scheduler(cpu)
		, vdp(memory, scheduler, {256u, 212u}) {
		memory.writeIoValue(bmsx::IO_VDP_DITHER, bmsx::valueNumber(static_cast<double>(0u)));
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
	h.memory.writeValue(bmsx::IO_VDP_FAULT_ACK, bmsx::valueNumber(static_cast<double>(1u)));
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
		harness.memory.writeValue(bmsx::IO_VDP_FIFO, bmsx::valueNumber(static_cast<double>(word)));
	}
	harness.memory.writeValue(bmsx::IO_VDP_FIFO_CTRL, bmsx::valueNumber(static_cast<double>(bmsx::VDP_FIFO_CTRL_SEAL)));
}

std::vector<uint32_t> xfMatrixRegisterPacket(uint32_t matrixIndex, const std::array<uint32_t, bmsx::VDP_XF_MATRIX_WORDS>& words) {
	std::vector<uint32_t> packet{VDP_XF_MATRIX_HEADER, matrixIndex * bmsx::VDP_XF_MATRIX_WORDS};
	packet.insert(packet.end(), words.begin(), words.end());
	return packet;
}

std::vector<uint32_t> xfSelectRegisterPacket(uint32_t viewMatrixIndex, uint32_t projectionMatrixIndex) {
	return {VDP_XF_SELECT_HEADER, bmsx::VDP_XF_VIEW_MATRIX_INDEX_REGISTER, viewMatrixIndex, projectionMatrixIndex};
}

void testDirectLifecycle() {
	Harness h;

	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_END_FRAME)));
	expectVdpFault(h, bmsx::VDP_FAULT_SUBMIT_STATE, "END_FRAME without open frame should fault");
	clearVdpFault(h);
	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_FILL_RECT)));
	expectVdpFault(h, bmsx::VDP_FAULT_SUBMIT_STATE, "retired draw doorbell without open frame should fault as submit-state");
	clearVdpFault(h);

	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_BEGIN_FRAME)));
	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_FILL_RECT)));
	expectVdpFault(h, bmsx::VDP_FAULT_CMD_BAD_DOORBELL, "retired draw doorbell inside a frame should fault as bad doorbell");
	clearVdpFault(h);
	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_END_FRAME)));
	h.vdp.presentReadyFrameOnVblankEdge();
	require(h.vdp.readDeviceOutput().rpu->commands.passCount == 0u, "retired draw doorbell should not produce RPU passes");
}

void testRawRegisterWordsDoNotCancelFrame() {
	Harness h;

	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_BEGIN_FRAME)));
	h.memory.writeValue(bmsx::IO_VDP_REG_DRAW_CTRL, bmsx::valueNumber(static_cast<double>(0x4u)));
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_CTRL) == 0x4u, "DRAW_CTRL should latch raw bits");
	h.memory.writeValue(bmsx::IO_VDP_REG_DRAW_SCALE_X, bmsx::valueNumber(static_cast<double>(0xffff0000u)));
	require(h.memory.readIoU32(bmsx::IO_VDP_REG_DRAW_SCALE_X) == 0xffff0000u, "DRAW_SCALE_X should latch raw bits");
	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_END_FRAME)));
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "raw register words should not fault");
}

void testRpuFrameRetainsPassAndDraw() {
	Harness h;
	constexpr uint32_t passDescAddr = 0x100u;
	constexpr uint32_t drawDescAddr = 0x140u;
	constexpr uint32_t streamDescAddr = 0x200u;
	constexpr uint32_t streamVramAddr = 0x300u;
	constexpr uint32_t shaderVariantWord = bmsx::VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1 | bmsx::VDP_RPU_SHADER_FLAG_MORPH | bmsx::VDP_RPU_SHADER_FLAG_T1;
	constexpr uint32_t pipeColorWriteRgba = 0x000f0000u;

	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + streamVramAddr, 0x00112233u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + streamVramAddr + 4u, 0x44556677u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + streamVramAddr + 8u, 0x8899aabbu);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + streamDescAddr + bmsx::RPU_STREAM_DESC_VRAM_ADDR_OFFSET, streamVramAddr);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + streamDescAddr + bmsx::RPU_STREAM_DESC_BYTE_LENGTH_OFFSET, 36u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + streamDescAddr + bmsx::RPU_STREAM_DESC_LAYOUT_ID_OFFSET, bmsx::VDP_RPU_LAYOUT_V2_C4 | (1u << 16u) | (2u << 24u));
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_SHADER_VARIANT_OFFSET, shaderVariantWord | (bmsx::VDP_RPU_PRIM_TRIANGLES << 16u));
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_PIPELINE_WORD_OFFSET, pipeColorWriteRgba);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_VERTEX_COUNT_OFFSET, 3u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_INSTANCE_COUNT_OFFSET, 5u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_INDEX_VRAM_ADDR_OFFSET, 0u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_INDEX_COUNT_OFFSET, 0u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_INDEX_TYPE_OFFSET, bmsx::VDP_RPU_INDEX_NONE | (1u << 8u));
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_STREAM_DESCS_ADDR_OFFSET, streamDescAddr);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_CONSTANT_DESCS_ADDR_OFFSET, 0u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + drawDescAddr + bmsx::RPU_DRAW_DESC_TEXTURE_DESCS_ADDR_OFFSET, 0u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_COLOR_SURFACE_DESC_ADDR_OFFSET, 0u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_DEPTH_SURFACE_DESC_ADDR_OFFSET, 0u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_VIEWPORT_XY_OFFSET, 0u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_VIEWPORT_WH_OFFSET, 256u | (212u << 16u));
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_OPS_OFFSET, bmsx::VDP_RPU_PASS_COLOR_CLEAR);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_CLEAR_COLOR_OFFSET, 0xff102030u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_CLEAR_DEPTH_WORD_OFFSET, 0xffffffffu);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_DRAW_DESCS_ADDR_OFFSET, drawDescAddr);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + passDescAddr + bmsx::RPU_PASS_DESC_DRAW_COUNT_OFFSET, 1u);

	sealFifo(h, {
		bmsx::VDP_RPU_PACKET_KIND | (bmsx::VDP_RPU_EXEC_PASS_LIST_WORDS << 16u), bmsx::VDP_RPU_OP_EXEC_PASS_LIST | (1u << 8u), passDescAddr,
		bmsx::VDP_RPU_PACKET_KIND | (bmsx::VDP_RPU_SEAL_FRAME_WORDS << 16u), bmsx::VDP_RPU_OP_SEAL_FRAME,
		bmsx::VDP_PKT_END,
	});

	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "RPU packet stream should not fault");
	h.vdp.advanceWork(h.vdp.getPendingRenderWorkUnits());
	h.vdp.presentReadyFrameOnVblankEdge();
	const bmsx::VdpDeviceOutput& output = h.vdp.readDeviceOutput();
	require(output.rpu->commands.passCount == 1u, "RPU output should retain one pass");
	require(output.rpu->commands.drawCount == 1u, "RPU output should retain one draw");
	require(output.rpu->commands.passClearColor[0u] == 0xff102030u, "RPU pass should retain clear color");
	require(output.rpu->commands.drawShaderVariant[0u] == shaderVariantWord, "RPU draw should retain shader flags");
	require(output.rpu->commands.drawVertexCount[0u] == 3u, "RPU draw should retain vertex count");
	require(output.rpu->commands.drawInstanceCount[0u] == 5u, "RPU draw should retain instance count");
	require(output.rpu->commands.streamVramAddr[0u] == streamVramAddr, "RPU stream should retain VDP-local address");
	require(output.rpu->commands.streamByteLength[0u] == 36u, "RPU stream should retain declared byte window");
	require(output.rpu->commands.streamStepRate[0u] == 2u, "RPU stream should retain step rate");
	require(output.rpu->vdpVram.get().size() == bmsx::VDP_RPU_PARAM_MEM_SIZE, "RPU output should retain VDP-local memory binding");
	require(output.rpu->vdpVramPageRevisions.get().size() == bmsx::VDP_RPU_PARAM_MEM_PAGE_COUNT, "RPU output should retain VDP-local memory page revisions");
	const uint32_t revisionBefore = bmsx::vdpRpuVramRangeRevision(*output.rpu, streamVramAddr, 36u);
	h.memory.writeU32(bmsx::VRAM_STAGING_BASE + streamVramAddr + 12u, 0xccddeeffu);
	const uint32_t revisionAfter = bmsx::vdpRpuVramRangeRevision(*output.rpu, streamVramAddr, 36u);
	require(revisionAfter != revisionBefore, "RPU VDP-local memory writes should bump page revisions");
}

void testFifoReplayAndFaults() {
	{
		Harness unknownPacket;
		sealStream(unknownPacket, {
			bmsx::VDP_PKT_REG1 | bmsx::VDP_REG_BG_COLOR,
			0xff102030u,
			0x04000000u,
			bmsx::VDP_PKT_END,
		});
		require(unknownPacket.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "unknown packet kind should flow without stream fault");
		require(unknownPacket.memory.readIoU32(bmsx::IO_VDP_REG_BG_COLOR) == 0xff102030u, "prior register packet side effects should remain visible");
		require(unknownPacket.vdp.getPendingRenderWorkUnits() == 0, "unknown packet should not submit render work");
	}
	{
		Harness reserved;
		sealStream(reserved, {bmsx::VDP_PKT_CMD | (1u << 16u) | bmsx::VDP_CMD_CLEAR, bmsx::VDP_PKT_END});
		expectVdpFault(reserved, bmsx::VDP_FAULT_CMD_BAD_DOORBELL, "reserved command bits should still decode the low command word");
		clearVdpFault(reserved);
		sealStream(reserved, {bmsx::VDP_PKT_REG1 | 19u, 0xaabbccddu, bmsx::VDP_PKT_END});
		require(reserved.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "REG1 high register index should not fault");
		require(reserved.memory.readIoU32(bmsx::IO_VDP_REG_SRC_SLOT) == 0xaabbccddu, "REG1 high register index should wrap through the register datapath");
		sealStream(reserved, {bmsx::VDP_PKT_REGN | (2u << 16u) | 18u, 0x11111111u, 0x22222222u, bmsx::VDP_PKT_END});
		require(reserved.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "REGN high register range should not fault");
		require(reserved.memory.readIoU32(bmsx::IO_VDP_REG_SRC_SLOT) == 0x22222222u, "REGN high register range should wrap through the register datapath");
	}
	{
		Harness retiredDoorbell;
		sealStream(retiredDoorbell, {bmsx::VDP_PKT_CMD | bmsx::VDP_CMD_CLEAR, bmsx::VDP_PKT_END});
		expectVdpFault(retiredDoorbell, bmsx::VDP_FAULT_CMD_BAD_DOORBELL, "retired DEX command packet should fault as a bad doorbell");
	}
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
	std::vector<uint32_t> projPacket = xfMatrixRegisterPacket(projectionMatrixIndex, projWords);
	stream.insert(stream.end(), projPacket.begin(), projPacket.end());
	std::vector<uint32_t> selectPacket = xfSelectRegisterPacket(viewMatrixIndex, projectionMatrixIndex);
	stream.insert(stream.end(), selectPacket.begin(), selectPacket.end());
	stream.push_back(bmsx::VDP_PKT_END);
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

void testXfWordsResolveToRenderOwnedViewRotationInverseTransform() {
	bmsx::VdpTransformSnapshot transform;
	constexpr uint32_t viewMatrixIndex = 2u;
	constexpr uint32_t projectionMatrixIndex = 3u;
	constexpr uint32_t viewMatrixIndexWord = viewMatrixIndex + bmsx::VDP_XF_MATRIX_COUNT;
	constexpr uint32_t projectionMatrixIndexWord = projectionMatrixIndex + bmsx::VDP_XF_MATRIX_COUNT;
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

	bmsx::resolveVdpTransformSnapshot(transform, matrixWords, viewMatrixIndexWord, projectionMatrixIndexWord);

	require(transform.view[0] == 2.0f, "XF view should decode Q16.16 words");
	require(transform.viewRotationInverse[0] == 0.5f, "XF view rotation inverse should invert affine X scale");
	require(transform.viewRotationInverse[5] == 0.25f, "XF view rotation inverse should invert affine Y scale");
	require(transform.viewRotationInverse[10] == 0.125f, "XF view rotation inverse should invert affine Z scale");
	require(transform.viewRotationInverse[12] == 0.0f && transform.viewRotationInverse[13] == 0.0f && transform.viewRotationInverse[14] == 0.0f, "XF view rotation inverse should remove translation");
	require(transform.eye.x == -3.0f && transform.eye.y == -2.0f && transform.eye.z == -2.0f, "XF eye should come from affine inverse");
}

void testXfSelectRegistersLatchRawWords() {
	Harness h;
	constexpr uint32_t viewMatrixIndex = bmsx::VDP_XF_MATRIX_COUNT;
	constexpr uint32_t projectionMatrixIndex = 0xffffffffu;

	sealStream(h, {
		bmsx::VDP_XF_PACKET_KIND | (bmsx::VDP_XF_SELECT_PACKET_PAYLOAD_WORDS << 16u),
		bmsx::VDP_XF_VIEW_MATRIX_INDEX_REGISTER,
		viewMatrixIndex,
		projectionMatrixIndex,
		bmsx::VDP_PKT_END,
	});

	const bmsx::VdpState state = h.vdp.captureState();
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "raw XF select words should not fault");
	require(state.xf.viewMatrixIndex == viewMatrixIndex, "XF should latch raw view matrix index word");
	require(state.xf.projectionMatrixIndex == projectionMatrixIndex, "XF should latch raw projection matrix index word");
}

void testEmptyFifoFrame() {
	Harness h;

	sealStream(h, {bmsx::VDP_PKT_END});
	require(h.vdp.getPendingRenderWorkUnits() == 0, "empty FIFO frame should submit no render work");
}

void testReadbackFaultsLatchStatus() {
	Harness h;

	h.memory.writeValue(bmsx::IO_VDP_RD_MODE, bmsx::valueNumber(static_cast<double>(99u)));

	require(h.vdp.readVdpData() == 0u, "unsupported read mode should return open bus");
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_RD_UNSUPPORTED_MODE, "unsupported read mode should latch fault code");
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_DETAIL) == 99u, "unsupported read mode should latch mode detail");
	require((h.memory.readIoU32(bmsx::IO_VDP_STATUS) & bmsx::VDP_STATUS_FAULT) != 0u, "unsupported read mode should set VDP fault status");
	clearVdpFault(h);
}

void testFaultLatchStickyFirstUntilAck() {
	Harness h;

	h.memory.writeValue(bmsx::IO_VDP_RD_MODE, bmsx::valueNumber(static_cast<double>(99u)));
	require(h.vdp.readVdpData() == 0u, "unsupported readback should return open-bus zero");
	expectVdpFault(h, bmsx::VDP_FAULT_RD_UNSUPPORTED_MODE, "first fault should latch");
	const std::array<bmsx::u8, 4> data{{1u, 2u, 3u, 4u}};
	h.vdp.writeVram(bmsx::VRAM_FRAMEBUFFER_BASE + 1u, data.data(), 0u, data.size());
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_RD_UNSUPPORTED_MODE, "second fault should not overwrite sticky-first latch");
	clearVdpFault(h);
	h.vdp.writeVram(bmsx::VRAM_FRAMEBUFFER_BASE + 1u, data.data(), 0u, data.size());
	expectVdpFault(h, bmsx::VDP_FAULT_VRAM_WRITE_UNALIGNED, "ACK should allow the next fault to latch");
}

void testReadbackOobFaultsLatchStatus() {
	Harness h;

	h.memory.writeValue(bmsx::IO_VDP_RD_MODE, bmsx::valueNumber(static_cast<double>(bmsx::VDP_RD_MODE_RGBA8888)));
	h.memory.writeValue(bmsx::IO_VDP_RD_X, bmsx::valueNumber(static_cast<double>(999u)));
	h.memory.writeValue(bmsx::IO_VDP_RD_Y, bmsx::valueNumber(static_cast<double>(0u)));

	require(h.vdp.readVdpData() == 0u, "OOB read should return open bus");
	require(h.memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_RD_OOB, "OOB read should latch fault code");
}

void testSaveStateRestoresReadbackStatus() {
	Harness h;

	h.vdp.beginFrame();
	bmsx::VdpState state = h.vdp.captureState();
	state.readback.readBudgetBytes = 0u;
	state.readback.readOverflow = true;
	h.vdp.beginFrame();
	require((h.memory.readIoU32(bmsx::IO_VDP_RD_STATUS) & bmsx::VDP_RD_STATUS_READY) != 0u, "fresh VDP frame should expose ready readback status");

	h.vdp.restoreState(state);
	const uint32_t status = h.memory.readIoU32(bmsx::IO_VDP_RD_STATUS);
	require((status & bmsx::VDP_RD_STATUS_READY) == 0u, "save-state restore should preserve exhausted readback budget");
	require((status & bmsx::VDP_RD_STATUS_OVERFLOW) != 0u, "save-state restore should preserve readback overflow latch");
}

void testVramWriteFaultsLatchStatus() {
	Harness h;
	const uint8_t bytes[4] = {1u, 2u, 3u, 4u};

	h.vdp.writeVram(bmsx::VRAM_FRAMEBUFFER_BASE + 1u, bytes, 0u, sizeof(bytes));

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

	h.vdp.setDecodedVramSurfaceDimensions(bmsx::VRAM_FRAMEBUFFER_BASE, 1u, 1u);
	bytes = std::array<uint8_t, 4>{{0xffu, 0xffu, 0xffu, 0xffu}};
	h.vdp.readVram(bmsx::VRAM_FRAMEBUFFER_BASE + 4u, bytes.data(), bytes.size());
	expectVdpFault(h, bmsx::VDP_FAULT_VRAM_WRITE_OOB, "OOB VRAM read should latch fault code");
	require(bytes == std::array<uint8_t, 4>{{0u, 0u, 0u, 0u}}, "OOB VRAM read should return zero bytes");
}

void testVoutScanoutTimingOwnsVblankOutputPin() {
	Harness h;
	bmsx::VDP& vdp = h.vdp;

	const bmsx::VdpDeviceOutput resetOutput = vdp.readDeviceOutput();
	require(resetOutput.scanoutPhase == static_cast<uint32_t>(bmsx::VdpVoutScanoutPhase::Active), "VOUT scanout should start active");
	require(resetOutput.scanoutX == 0u, "VOUT scanout X should start at the left edge");
	require(resetOutput.scanoutY == 0u, "VOUT scanout Y should start at the top edge");
	require((h.memory.readIoU32(bmsx::IO_VDP_STATUS) & bmsx::VDP_STATUS_VBLANK) == 0u, "VDP status should start outside VBLANK");
	vdp.setScanoutTiming(false, 0, 100, 80);
	h.scheduler.setNowCycles(41);
	const bmsx::VdpDeviceOutput activeOutput = vdp.readDeviceOutput();
	require(activeOutput.scanoutPhase == static_cast<uint32_t>(bmsx::VdpVoutScanoutPhase::Active), "VOUT scanout should remain active before VBLANK");
	require(activeOutput.scanoutX == 166u, "VOUT active scanout X should advance through visible dots");
	require(activeOutput.scanoutY == 108u, "VOUT active scanout Y should advance through visible lines");
	h.scheduler.setNowCycles(80);
	vdp.setScanoutTiming(true, 80, 100, 80);
	h.scheduler.setNowCycles(90);
	const bmsx::VdpDeviceOutput vblankOutput = vdp.readDeviceOutput();
	require(vblankOutput.scanoutPhase == static_cast<uint32_t>(bmsx::VdpVoutScanoutPhase::Vblank), "VOUT scanout should enter VBLANK");
	require((h.memory.readIoU32(bmsx::IO_VDP_STATUS) & bmsx::VDP_STATUS_VBLANK) != 0u, "VDP status should reflect VOUT VBLANK phase");
}

void testDitherRegisterWritesUpdateLiveLatch() {
	Harness h;
	bmsx::VDP& vdp = h.vdp;

	const bmsx::VdpDeviceOutput resetOutput = vdp.readDeviceOutput();
	require(resetOutput.ditherType == 0, "visible DITHER output should start at reset value");
	require(resetOutput.frameBufferWidth == 256u, "visible VOUT scanout width should start at configured framebuffer width");
	require(resetOutput.frameBufferHeight == 212u, "visible VOUT scanout height should start at configured framebuffer height");
	h.memory.writeValue(bmsx::IO_VDP_DITHER, bmsx::valueNumber(static_cast<double>(3u)));
	vdp.setDecodedVramSurfaceDimensions(bmsx::VRAM_FRAMEBUFFER_BASE, 128u, 64u);

	require(vdp.captureState().ditherType == 3, "DITHER write should update live VDP latch directly");
	const bmsx::VdpDeviceOutput liveOutput = vdp.readDeviceOutput();
	require(liveOutput.ditherType == 0, "live DITHER write should wait for frame present before visible output");
	require(vdp.frameBufferWidth() == 128u, "FBM live scanout width should update at framebuffer configuration");
	require(vdp.frameBufferHeight() == 64u, "FBM live scanout height should update at framebuffer configuration");
	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_BEGIN_FRAME)));
	h.memory.writeValue(bmsx::IO_VDP_CMD, bmsx::valueNumber(static_cast<double>(bmsx::VDP_CMD_END_FRAME)));
	vdp.presentReadyFrameOnVblankEdge();
	const bmsx::VdpDeviceOutput presentedOutput = vdp.readDeviceOutput();
	require(presentedOutput.ditherType == 3, "presented frame should commit visible DITHER output");
	require(presentedOutput.frameBufferWidth == 128u, "presented frame should commit frame-sealed VOUT scanout width");
	require(presentedOutput.frameBufferHeight == 64u, "presented frame should commit frame-sealed VOUT scanout height");
}

} // namespace

int main() {
	const std::vector<std::pair<const char*, void (*)()>> tests = {
		{"direct lifecycle", testDirectLifecycle},
		{"raw register frame behavior", testRawRegisterWordsDoNotCancelFrame},
		{"RPU retained output", testRpuFrameRetainsPassAndDraw},
		{"FIFO replay and faults", testFifoReplayAndFaults},
		{"VDP XF packet raw state", testXfPacketUpdatesRawTransformRegisterState},
		{"VDP XF render transform", testXfWordsResolveToRenderOwnedViewRotationInverseTransform},
		{"VDP XF raw select register words", testXfSelectRegistersLatchRawWords},
		{"empty FIFO frame", testEmptyFifoFrame},
		{"VDP readback fault status", testReadbackFaultsLatchStatus},
		{"VDP fault latch sticky-first", testFaultLatchStickyFirstUntilAck},
		{"VDP readback OOB fault status", testReadbackOobFaultsLatchStatus},
		{"VDP save-state readback status", testSaveStateRestoresReadbackStatus},
		{"VDP VRAM write fault status", testVramWriteFaultsLatchStatus},
		{"VDP VRAM read fault status", testVramReadFaultsLatchStatus},
		{"VDP VOUT scanout timing", testVoutScanoutTimingOwnsVblankOutputPin},
		{"VDP dither live latch", testDitherRegisterWritesUpdateLiveLatch},
	};

	for (const auto& test : tests) {
		test.second();
	}
	return EXIT_SUCCESS;
}
