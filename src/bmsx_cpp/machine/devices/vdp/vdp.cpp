#include "machine/devices/vdp/vdp.h"
#include "machine/common/numeric.h"
#include "machine/common/word.h"
#include "machine/devices/vdp/fault.h"
#include "machine/devices/vdp/fixed_point.h"
#include "machine/devices/vdp/packet.h"
#include "machine/memory/map.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/scheduler/budget.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>
#include <string>
#include <utility>

namespace bmsx {
namespace {

constexpr uint32_t VDP_RD_BUDGET_BYTES = 4096u;
constexpr uint32_t VDP_RD_MAX_CHUNK_PIXELS = 256u;
constexpr int VDP_SERVICE_BATCH_WORK_UNITS = 128;
constexpr size_t BLITTER_FIFO_CAPACITY = 4096u;
constexpr u32 VDP_REPLAY_PACKET_FAULT = 0xffffffffu;
template <typename T>
std::vector<T> acquireVectorFromPool(std::vector<std::vector<T>>& pool) {
	if (pool.empty()) {
		return {};
	}
	std::vector<T> values = std::move(pool.back());
	pool.pop_back();
	return values;
}

uint32_t imageByteSize(uint32_t width, uint32_t height) {
	const uint64_t byteSize = static_cast<uint64_t>(width) * static_cast<uint64_t>(height) * 4u;
	if (byteSize > std::numeric_limits<uint32_t>::max()) {
		throw vdpFault("image surface exceeds addressable VRAM span.");
	}
	return static_cast<uint32_t>(byteSize);
}

VdpVramSurface makeVramSurface(uint32_t surfaceId, uint32_t baseAddr, uint32_t capacity, uint32_t width, uint32_t height) {
	if (imageByteSize(width, height) > capacity) {
		throw vdpFault("VDP surface exceeds mapped VRAM capacity.");
	}
	VdpVramSurface surface;
	surface.surfaceId = surfaceId;
	surface.baseAddr = baseAddr;
	surface.capacity = capacity;
	surface.width = width;
	surface.height = height;
	return surface;
}

} // namespace

VDP::VDP(
	Memory& memory,
	DeviceScheduler& scheduler,
	VdpFrameBufferSize frameBufferSize,
	VdpEntropySeeds entropySeeds
)
	: m_memory(memory)
	, m_vramStaging(VRAM_STAGING_SIZE)
	, m_vramGarbageScratch(VRAM_GARBAGE_CHUNK_BYTES)
	, m_vramMachineSeed(entropySeeds.machineSeed)
	, m_vramBootSeed(entropySeeds.bootSeed)
	, m_configuredFrameBufferSize(frameBufferSize)
	, m_scheduler(scheduler) {
	m_memory.setVramWriter(this);
	m_memory.mapIoRead(IO_VDP_RD_STATUS, this, &VDP::readVdpStatusThunk);
	m_memory.mapIoRead(IO_VDP_RD_DATA, this, &VDP::readVdpDataThunk);
	m_memory.mapIoWrite(IO_VDP_DITHER, this, &VDP::onDitherWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO, this, &VDP::onFifoWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO_CTRL, this, &VDP::onFifoCtrlWriteThunk);
	m_memory.mapIoWrite(IO_VDP_CMD, this, &VDP::onCommandWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FAULT_ACK, this, &VDP::onFaultAckWriteThunk);
	for (uint32_t index = 0; index < VDP_REGISTER_COUNT; ++index) {
		m_memory.mapIoWrite(IO_VDP_REG0 + index * IO_WORD_SIZE, this, &VDP::onRegisterWriteThunk);
	}
	m_memory.mapIoWrite(IO_VDP_PMU_BANK, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_X, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_Y, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_SCALE_X, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_SCALE_Y, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_CTRL, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_SBX_COMMIT, this, &VDP::onSbxCommitWriteThunk);
	m_memory.mapIoWrite(IO_VDP_CAMERA_COMMIT, this, &VDP::onCameraCommitWriteThunk);
	m_buildFrame.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_activeFrame.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_pendingFrame.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_execution.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
}

void VDP::resetIngressState() {
	m_vdpFifoWordByteCount = 0;
	m_vdpFifoStreamWordCount = 0u;
	m_dmaSubmitActive = false;
	refreshSubmitBusyStatus();
}

void VDP::resetStatus() {
	m_vdpStatus = 0u;
	m_faultCode = VDP_FAULT_NONE;
	m_faultDetail = 0u;
	m_memory.writeIoValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
	m_memory.writeIoValue(IO_VDP_FAULT_CODE, valueNumber(static_cast<double>(m_faultCode)));
	m_memory.writeIoValue(IO_VDP_FAULT_DETAIL, valueNumber(static_cast<double>(m_faultDetail)));
	m_memory.writeIoValue(IO_VDP_FAULT_ACK, valueNumber(0.0));
	refreshSubmitBusyStatus();
}

void VDP::clearFault() {
	m_faultCode = VDP_FAULT_NONE;
	m_faultDetail = 0u;
	m_memory.writeIoValue(IO_VDP_FAULT_CODE, valueNumber(static_cast<double>(m_faultCode)));
	m_memory.writeIoValue(IO_VDP_FAULT_DETAIL, valueNumber(static_cast<double>(m_faultDetail)));
	setStatusFlag(VDP_STATUS_FAULT, false);
}

void VDP::resetVdpRegisters() {
	uint32_t slotDim = 1u | (1u << 16u);
	if (auto* primary = findRegisteredVramSlotBySurfaceId(VDP_RD_SURFACE_PRIMARY)) {
		slotDim = (primary->surfaceWidth & 0xffffu) | ((primary->surfaceHeight & 0xffffu) << 16u);
	}
	m_vdpRegisters.fill(0u);
	m_vdpRegisters[VDP_REG_SRC_SLOT] = VDP_SLOT_PRIMARY;
	m_vdpRegisters[VDP_REG_LINE_WIDTH] = VDP_Q16_ONE;
	m_vdpRegisters[VDP_REG_DRAW_SCALE_X] = VDP_Q16_ONE;
	m_vdpRegisters[VDP_REG_DRAW_SCALE_Y] = VDP_Q16_ONE;
	m_vdpRegisters[VDP_REG_DRAW_COLOR] = 0xffffffffu;
	m_vdpRegisters[VDP_REG_BG_COLOR] = 0xff000000u;
	m_vdpRegisters[VDP_REG_SLOT_INDEX] = VDP_SLOT_PRIMARY;
	m_vdpRegisters[VDP_REG_SLOT_DIM] = slotDim;
	for (uint32_t index = 0; index < VDP_REGISTER_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, valueNumber(static_cast<double>(m_vdpRegisters[index])));
	}
}

void VDP::writeVdpRegister(uint32_t index, u32 value) {
	if (index >= VDP_REGISTER_COUNT) {
		throw vdpFault("VDP register " + std::to_string(index) + " is out of range.");
	}
	switch (index) {
	case VDP_REG_SLOT_DIM:
		configureSelectedSlotDimension(value);
		break;
	default:
		break;
	}
	m_vdpRegisters[index] = value;
	m_memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, valueNumber(static_cast<double>(value)));
}

void VDP::onVdpRegisterWrite(uint32_t addr) {
	const uint32_t index = (addr - IO_VDP_REG0) / IO_WORD_SIZE;
	writeVdpRegister(index, m_memory.readIoU32(addr));
}

void VDP::onDitherWrite(Value value) {
	m_liveDitherType = toI32(asNumber(value));
}

void VDP::writePmuBankSelect(u32 value) {
	m_pmu.selectBank(value);
	syncPmuRegisterWindow();
}

void VDP::onPmuRegisterWindowWrite(uint32_t addr) {
	const u32 value = m_memory.readIoU32(addr);
	switch (addr) {
	case IO_VDP_PMU_BANK:
		writePmuBankSelect(value);
		return;
	case IO_VDP_PMU_X:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::X, value);
		break;
	case IO_VDP_PMU_Y:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::Y, value);
		break;
	case IO_VDP_PMU_SCALE_X:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::ScaleX, value);
		break;
	case IO_VDP_PMU_SCALE_Y:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::ScaleY, value);
		break;
	case IO_VDP_PMU_CTRL:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::Control, value);
		break;
	}
	m_memory.writeIoValue(addr, valueNumber(static_cast<double>(value)));
}

void VDP::syncPmuRegisterWindow() {
	const VdpPmuRegisterWindow window = m_pmu.registerWindow();
	m_memory.writeIoValue(IO_VDP_PMU_BANK, valueNumber(static_cast<double>(window.bank)));
	m_memory.writeIoValue(IO_VDP_PMU_X, valueNumber(static_cast<double>(window.x)));
	m_memory.writeIoValue(IO_VDP_PMU_Y, valueNumber(static_cast<double>(window.y)));
	m_memory.writeIoValue(IO_VDP_PMU_SCALE_X, valueNumber(static_cast<double>(window.scaleX)));
	m_memory.writeIoValue(IO_VDP_PMU_SCALE_Y, valueNumber(static_cast<double>(window.scaleY)));
	m_memory.writeIoValue(IO_VDP_PMU_CTRL, valueNumber(static_cast<double>(window.control)));
}

void VDP::onSbxCommitWrite() {
	if ((m_memory.readIoU32(IO_VDP_SBX_COMMIT) & VDP_SBX_COMMIT_WRITE) == 0u) {
		return;
	}
	for (size_t index = 0; index < SKYBOX_FACE_WORD_COUNT; ++index) {
		m_sbxMmioFaceWords[index] = m_memory.readIoU32(IO_VDP_SBX_FACE0 + static_cast<uint32_t>(index * IO_WORD_SIZE));
	}
	m_sbx.writePacket(m_memory.readIoU32(IO_VDP_SBX_CONTROL), m_sbxMmioFaceWords);
}

void VDP::onCameraCommitWrite() {
	if ((m_memory.readIoU32(IO_VDP_CAMERA_COMMIT) & VDP_CAMERA_COMMIT_WRITE) == 0u) {
		return;
	}
	for (size_t index = 0; index < 16u; ++index) {
		m_cameraMmioView[index] = f32BitsToNumber(m_memory.readIoU32(IO_VDP_CAMERA_VIEW + static_cast<uint32_t>(index * IO_WORD_SIZE)));
		m_cameraMmioProj[index] = f32BitsToNumber(m_memory.readIoU32(IO_VDP_CAMERA_PROJ + static_cast<uint32_t>(index * IO_WORD_SIZE)));
	}
	for (size_t index = 0; index < 3u; ++index) {
		m_cameraMmioEye[index] = f32BitsToNumber(m_memory.readIoU32(IO_VDP_CAMERA_EYE + static_cast<uint32_t>(index * IO_WORD_SIZE)));
	}
	m_camera.writeCameraBank0(m_cameraMmioView, m_cameraMmioProj, m_cameraMmioEye[0], m_cameraMmioEye[1], m_cameraMmioEye[2]);
}

void VDP::syncSbxRegisterWindow() {
	m_memory.writeIoValue(IO_VDP_SBX_CONTROL, valueNumber(static_cast<double>(m_sbx.liveControl())));
	const VdpSbxUnit::FaceWords& words = m_sbx.liveFaceWords();
	for (size_t index = 0; index < SKYBOX_FACE_WORD_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_SBX_FACE0 + static_cast<uint32_t>(index * IO_WORD_SIZE), valueNumber(static_cast<double>(words[index])));
	}
	m_memory.writeIoValue(IO_VDP_SBX_COMMIT, valueNumber(0.0));
}

void VDP::syncCameraRegisterWindow() {
	const VdpCameraState state = m_camera.captureState();
	for (size_t index = 0; index < 16u; ++index) {
		m_memory.writeIoValue(IO_VDP_CAMERA_VIEW + static_cast<uint32_t>(index * IO_WORD_SIZE), valueNumber(static_cast<double>(numberToF32Bits(state.view[index]))));
		m_memory.writeIoValue(IO_VDP_CAMERA_PROJ + static_cast<uint32_t>(index * IO_WORD_SIZE), valueNumber(static_cast<double>(numberToF32Bits(state.proj[index]))));
	}
	m_memory.writeIoValue(IO_VDP_CAMERA_EYE + 0u * IO_WORD_SIZE, valueNumber(static_cast<double>(numberToF32Bits(state.eye.x))));
	m_memory.writeIoValue(IO_VDP_CAMERA_EYE + 1u * IO_WORD_SIZE, valueNumber(static_cast<double>(numberToF32Bits(state.eye.y))));
	m_memory.writeIoValue(IO_VDP_CAMERA_EYE + 2u * IO_WORD_SIZE, valueNumber(static_cast<double>(numberToF32Bits(state.eye.z))));
	m_memory.writeIoValue(IO_VDP_CAMERA_COMMIT, valueNumber(0.0));
}

void VDP::configureSelectedSlotDimension(u32 word) {
	const uint32_t width = packedLow16(word);
	const uint32_t height = packedHigh16(word);
	if (width == 0u || height == 0u) {
		raiseFault(VDP_FAULT_VRAM_SLOT_DIM, word);
		return;
	}
	uint32_t surfaceId = 0u;
	if (!tryResolveSurfaceIdForSlot(m_vdpRegisters[VDP_REG_SLOT_INDEX], surfaceId, VDP_FAULT_VRAM_SLOT_DIM)) {
		return;
	}
	VramSlot& slot = getVramSlotBySurfaceId(surfaceId);
	const uint64_t byteLength = static_cast<uint64_t>(width) * static_cast<uint64_t>(height) * 4u;
	if (byteLength > slot.capacity) {
		raiseFault(VDP_FAULT_VRAM_SLOT_DIM, word);
		return;
	}
	setVramSlotLogicalDimensions(slot, width, height);
}

VdpLatchedGeometry VDP::readLatchedGeometry() const {
	VdpLatchedGeometry geometry;
	geometry.x0 = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_GEOM_X0]);
	geometry.y0 = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_GEOM_Y0]);
	geometry.x1 = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_GEOM_X1]);
	geometry.y1 = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_GEOM_Y1]);
	return geometry;
}

// start hot-path -- VDP status, command ingress, scheduler service, and VRAM row access run on frame-critical paths.
// disable-next-line single_line_method_pattern -- VBLANK status is the public device pin; status register bit ownership stays here.
void VDP::setVblankStatus(bool active) {
	setStatusFlag(VDP_STATUS_VBLANK, active);
}

void VDP::setStatusFlag(uint32_t mask, bool active) {
	const uint32_t nextStatus = active ? (m_vdpStatus | mask) : (m_vdpStatus & ~mask);
	if (nextStatus == m_vdpStatus) {
		return;
	}
	m_vdpStatus = nextStatus;
	m_memory.writeIoValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
}

void VDP::raiseFault(uint32_t code, uint32_t detail) {
	if ((m_vdpStatus & VDP_STATUS_FAULT) != 0u) {
		return;
	}
	m_faultCode = code;
	m_faultDetail = detail;
	m_memory.writeIoValue(IO_VDP_FAULT_CODE, valueNumber(static_cast<double>(m_faultCode)));
	m_memory.writeIoValue(IO_VDP_FAULT_DETAIL, valueNumber(static_cast<double>(m_faultDetail)));
	setStatusFlag(VDP_STATUS_FAULT, true);
}

void VDP::onVdpFaultAckWrite() {
	if (m_memory.readIoU32(IO_VDP_FAULT_ACK) == 0u) {
		return;
	}
	clearFault();
	m_memory.writeIoValue(IO_VDP_FAULT_ACK, valueNumber(0.0));
}

bool VDP::canAcceptVdpSubmit() const {
	return !hasBlockedSubmitPath();
}

void VDP::acceptSubmitAttempt() {
	setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, false);
	refreshSubmitBusyStatus();
}

void VDP::rejectSubmitAttempt() {
	setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, true);
	refreshSubmitBusyStatus();
}

void VDP::rejectBusySubmitAttempt(uint32_t detail) {
	rejectSubmitAttempt();
	raiseFault(VDP_FAULT_SUBMIT_BUSY, detail);
}

void VDP::beginDmaSubmit() {
	m_dmaSubmitActive = true;
	acceptSubmitAttempt();
}

void VDP::endDmaSubmit() {
	m_dmaSubmitActive = false;
	refreshSubmitBusyStatus();
}

void VDP::sealDmaTransfer(uint32_t src, size_t byteLength) {
	try {
		consumeSealedVdpStream(src, byteLength);
	} catch (...) {
		endDmaSubmit();
		throw;
	}
	endDmaSubmit();
}

void VDP::writeVdpFifoBytes(const u8* data, size_t length) {
	for (size_t index = 0; index < length; index += 1u) {
		m_vdpFifoWordScratch[static_cast<size_t>(m_vdpFifoWordByteCount)] = data[index];
		m_vdpFifoWordByteCount += 1;
		if (m_vdpFifoWordByteCount != 4) {
			continue;
		}
		const u32 word = static_cast<u32>(m_vdpFifoWordScratch[0])
			| (static_cast<u32>(m_vdpFifoWordScratch[1]) << 8)
			| (static_cast<u32>(m_vdpFifoWordScratch[2]) << 16)
			| (static_cast<u32>(m_vdpFifoWordScratch[3]) << 24);
		m_vdpFifoWordByteCount = 0;
		pushVdpFifoWord(word);
	}
	refreshSubmitBusyStatus();
}

bool VDP::hasOpenDirectVdpFifoIngress() const {
	return m_vdpFifoWordByteCount != 0 || m_vdpFifoStreamWordCount != 0u;
}

bool VDP::hasBlockedSubmitPath() const {
	return hasOpenDirectVdpFifoIngress() || m_dmaSubmitActive || m_buildFrame.open || !canAcceptSubmittedFrame();
}

// disable-next-line single_line_method_pattern -- submit-busy refresh owns the status-bit projection from current VDP ingress state.
void VDP::refreshSubmitBusyStatus() {
	setStatusFlag(VDP_STATUS_SUBMIT_BUSY, hasBlockedSubmitPath());
}

void VDP::pushVdpFifoWord(u32 word) {
	if (m_vdpFifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, m_vdpFifoStreamWordCount + 1u);
		resetIngressState();
		return;
	}
	m_vdpFifoStreamWords[static_cast<size_t>(m_vdpFifoStreamWordCount)] = word;
	m_vdpFifoStreamWordCount += 1u;
	refreshSubmitBusyStatus();
}

void VDP::consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength) {
	if ((byteLength & 3u) != 0u) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, static_cast<uint32_t>(byteLength));
		return;
	}
	if (byteLength > VDP_STREAM_BUFFER_SIZE) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, static_cast<uint32_t>(byteLength));
		return;
	}
	if (m_buildFrame.open) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, VDP_CMD_BEGIN_FRAME);
		cancelSubmittedFrame();
		return;
	}
	uint32_t cursor = baseAddr;
	const uint32_t end = baseAddr + static_cast<uint32_t>(byteLength);
	beginSubmittedFrame();
	bool ended = false;
	while (cursor < end) {
		const u32 word = m_memory.readU32(cursor);
		cursor += IO_WORD_SIZE;
		if (word == VDP_PKT_END) {
			if (cursor != end) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				cancelSubmittedFrame();
				return;
			}
			ended = true;
			break;
		}
		cursor = consumeReplayPacket(word, cursor, end, ReplayPayloadSource::Memory);
		if (cursor == VDP_REPLAY_PACKET_FAULT) {
			cancelSubmittedFrame();
			return;
		}
	}
	if (!ended) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, static_cast<uint32_t>(byteLength));
		cancelSubmittedFrame();
		return;
	}
	if (!sealSubmittedFrame()) {
		cancelSubmittedFrame();
	}
	refreshSubmitBusyStatus();
}

void VDP::consumeSealedVdpWordStream(u32 wordCount) {
	if (m_buildFrame.open) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, VDP_CMD_BEGIN_FRAME);
		cancelSubmittedFrame();
		return;
	}
	u32 cursor = 0u;
	beginSubmittedFrame();
	bool ended = false;
	while (cursor < wordCount) {
		const u32 word = m_vdpFifoStreamWords[static_cast<size_t>(cursor)];
		cursor += 1u;
		if (word == VDP_PKT_END) {
			if (cursor != wordCount) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				cancelSubmittedFrame();
				return;
			}
			ended = true;
			break;
		}
		cursor = consumeReplayPacket(word, cursor, wordCount, ReplayPayloadSource::WordStream);
		if (cursor == VDP_REPLAY_PACKET_FAULT) {
			cancelSubmittedFrame();
			return;
		}
	}
	if (!ended) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, wordCount);
		cancelSubmittedFrame();
		return;
	}
	if (!sealSubmittedFrame()) {
		cancelSubmittedFrame();
	}
	refreshSubmitBusyStatus();
}

void VDP::sealVdpFifoTransfer() {
	if (m_vdpFifoWordByteCount != 0) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, static_cast<uint32_t>(m_vdpFifoWordByteCount));
		resetIngressState();
		return;
	}
	if (m_vdpFifoStreamWordCount == 0u) {
		return;
	}
	consumeSealedVdpWordStream(m_vdpFifoStreamWordCount);
	resetIngressState();
}

u32 VDP::readReplayPayloadWord(u32 cursor, u32 offset, ReplayPayloadSource source) const {
	if (source == ReplayPayloadSource::Memory) {
		return m_memory.readU32(cursor + offset * IO_WORD_SIZE);
	}
	return m_vdpFifoStreamWords[static_cast<size_t>(cursor + offset)];
}

u32 VDP::consumeReplayPacket(u32 word, u32 cursor, u32 limit, ReplayPayloadSource source) {
	const u32 payloadUnit = source == ReplayPayloadSource::Memory ? IO_WORD_SIZE : 1u;
	const u32 kind = word & VDP_PKT_KIND_MASK;
	switch (kind) {
		case VDP_PKT_CMD:
			return consumeReplayCommandPacket(word) ? cursor : VDP_REPLAY_PACKET_FAULT;
		case VDP_PKT_REG1: {
			const u32 reg = decodeReg1Packet(word);
			if (cursor + payloadUnit > limit) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			if (reg == VDP_REPLAY_PACKET_FAULT) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			writeVdpRegister(reg, readReplayPayloadWord(cursor, 0u, source));
			return cursor + payloadUnit;
		}
		case VDP_PKT_REGN: {
			RegnPacket packet;
			if (!decodeRegnPacket(word, packet)) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 payloadCount = packet.count * payloadUnit;
			if (cursor + payloadCount > limit) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			for (uint32_t offset = 0; offset < packet.count; ++offset) {
				writeVdpRegister(packet.firstRegister + offset, readReplayPayloadWord(cursor, offset, source));
			}
			return cursor + payloadCount;
		}
		case VDP_BBU_PACKET_KIND: {
			if (!isVdpUnitPacketHeaderValid(word, VDP_BBU_PACKET_PAYLOAD_WORDS)) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 payloadCount = VDP_BBU_PACKET_PAYLOAD_WORDS * payloadUnit;
			if (cursor + payloadCount > limit) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 controlWord = readReplayPayloadWord(cursor, 10u, source);
			if (controlWord != 0u) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, controlWord);
				return VDP_REPLAY_PACKET_FAULT;
			}
			return latchBillboardPacket(m_bbu.decodePacket(
				readReplayPayloadWord(cursor, 0u, source),
				readReplayPayloadWord(cursor, 1u, source),
				readReplayPayloadWord(cursor, 2u, source),
				readReplayPayloadWord(cursor, 3u, source),
				readReplayPayloadWord(cursor, 4u, source),
				readReplayPayloadWord(cursor, 5u, source),
				readReplayPayloadWord(cursor, 6u, source),
				readReplayPayloadWord(cursor, 7u, source),
				readReplayPayloadWord(cursor, 8u, source),
				readReplayPayloadWord(cursor, 9u, source),
				controlWord)) ? cursor + payloadCount : VDP_REPLAY_PACKET_FAULT;
		}
		case VDP_SBX_PACKET_KIND: {
			if (!isVdpUnitPacketHeaderValid(word, VDP_SBX_PACKET_PAYLOAD_WORDS)) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 payloadCount = VDP_SBX_PACKET_PAYLOAD_WORDS * payloadUnit;
			if (cursor + payloadCount > limit) {
				raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			for (size_t index = 0; index < SKYBOX_FACE_WORD_COUNT; ++index) {
				m_sbxPacketFaceWords[index] = readReplayPayloadWord(cursor, static_cast<u32>(index + 1u), source);
			}
			m_sbx.writePacket(readReplayPayloadWord(cursor, 0u, source), m_sbxPacketFaceWords);
			return cursor + payloadCount;
		}
		default:
			raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
	}
}

u32 VDP::decodeReg1Packet(u32 word) const {
	if ((word & VDP_PKT_RESERVED_MASK) != 0u) {
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 reg = packedLow16(word);
	if (reg >= VDP_REGISTER_COUNT) {
		return VDP_REPLAY_PACKET_FAULT;
	}
	return reg;
}


bool VDP::decodeRegnPacket(u32 word, RegnPacket& packet) const {
	const u32 firstRegister = packedLow16(word);
	const u32 count = (word >> 16u) & 0xffu;
	if (count == 0u || count > VDP_REGISTER_COUNT) {
		return false;
	}
	if (firstRegister >= VDP_REGISTER_COUNT || firstRegister + count > VDP_REGISTER_COUNT) {
		return false;
	}
	packet.firstRegister = firstRegister;
	packet.count = count;
	return true;
}

bool VDP::consumeReplayCommandPacket(u32 word) {
	if ((word & VDP_PKT_RESERVED_MASK) != 0u) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, word);
		return false;
	}
	const u32 command = packedLow16(word);
	if (command == VDP_CMD_BEGIN_FRAME || command == VDP_CMD_END_FRAME) {
		raiseFault(VDP_FAULT_STREAM_BAD_PACKET, command);
		return false;
	}
	if (command == VDP_CMD_NOP) {
		return true;
	}
	return executeVdpDrawDoorbell(command);
}

void VDP::consumeDirectVdpCommand(u32 command) {
	if (command == VDP_CMD_NOP) {
		return;
	}
	if (command == VDP_CMD_BEGIN_FRAME) {
		if (m_buildFrame.open) {
			raiseFault(VDP_FAULT_SUBMIT_STATE, command);
			cancelSubmittedFrame();
			return;
		}
		beginSubmittedFrame();
		refreshSubmitBusyStatus();
		return;
	}
	if (command == VDP_CMD_END_FRAME) {
		if (!m_buildFrame.open) {
			rejectSubmitAttempt();
			raiseFault(VDP_FAULT_SUBMIT_STATE, command);
			return;
		}
		if (!sealSubmittedFrame()) {
			cancelSubmittedFrame();
		}
		refreshSubmitBusyStatus();
		return;
	}
	if (!m_buildFrame.open) {
		rejectSubmitAttempt();
		raiseFault(VDP_FAULT_SUBMIT_STATE, command);
		return;
	}
	executeVdpDrawDoorbell(command);
	refreshSubmitBusyStatus();
}

bool VDP::executeVdpDrawDoorbell(u32 command) {
	switch (command) {
		case VDP_CMD_CLEAR:
			return enqueueLatchedClear();
		case VDP_CMD_FILL_RECT:
			return enqueueLatchedFillRect();
		case VDP_CMD_DRAW_LINE:
			return enqueueLatchedDrawLine();
		case VDP_CMD_BLIT:
			return enqueueLatchedBlit();
		case VDP_CMD_COPY_RECT:
			return enqueueLatchedCopyRect();
		default:
			raiseFault(VDP_FAULT_CMD_BAD_DOORBELL, command);
			return false;
	}
}

void VDP::onVdpFifoWrite() {
	if (m_dmaSubmitActive || m_buildFrame.open || (!hasOpenDirectVdpFifoIngress() && !canAcceptSubmittedFrame())) {
		rejectBusySubmitAttempt(m_memory.readIoU32(IO_VDP_FIFO));
		return;
	}
	acceptSubmitAttempt();
	pushVdpFifoWord(m_memory.readIoU32(IO_VDP_FIFO));
}

void VDP::onVdpFifoCtrlWrite() {
	if ((m_memory.readIoU32(IO_VDP_FIFO_CTRL) & VDP_FIFO_CTRL_SEAL) == 0u) {
		return;
	}
	if (m_dmaSubmitActive) {
		rejectBusySubmitAttempt(VDP_FIFO_CTRL_SEAL);
		return;
	}
	sealVdpFifoTransfer();
	refreshSubmitBusyStatus();
}

void VDP::onVdpCommandWrite() {
	const uint32_t command = m_memory.readIoU32(IO_VDP_CMD);
	if (command == VDP_CMD_NOP) {
		return;
	}
	const bool directFrameCommand = command == VDP_CMD_BEGIN_FRAME || command == VDP_CMD_END_FRAME || m_buildFrame.open;
	if (!directFrameCommand && hasBlockedSubmitPath()) {
		rejectBusySubmitAttempt(command);
		return;
	}
	if (command == VDP_CMD_BEGIN_FRAME && !m_buildFrame.open && hasBlockedSubmitPath()) {
		rejectBusySubmitAttempt(command);
		return;
	}
	if (command != VDP_CMD_BEGIN_FRAME && command != VDP_CMD_END_FRAME && !m_buildFrame.open) {
		rejectSubmitAttempt();
	} else {
		acceptSubmitAttempt();
	}
	consumeDirectVdpCommand(command);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onFifoWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpFifoWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onFifoCtrlWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpFifoCtrlWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onCommandWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpCommandWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onDitherWriteThunk(void* context, uint32_t, Value value) {
	static_cast<VDP*>(context)->onDitherWrite(value);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onRegisterWriteThunk(void* context, uint32_t addr, Value) {
	static_cast<VDP*>(context)->onVdpRegisterWrite(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onPmuRegisterWindowWriteThunk(void* context, uint32_t addr, Value) {
	static_cast<VDP*>(context)->onPmuRegisterWindowWrite(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onSbxCommitWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onSbxCommitWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onCameraCommitWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onCameraCommitWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require C-style thunks back into the VDP instance.
void VDP::onFaultAckWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpFaultAckWrite();
}

void VDP::setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_workUnitsPerSec = workUnitsPerSec;
	m_workCarry = 0;
	m_availableWorkUnits = 0;
	scheduleNextService(nowCycles);
}

void VDP::accrueCycles(int cycles, int64_t nowCycles) {
	if (!hasPendingRenderWork() || cycles <= 0) {
		return;
	}
	const int64_t wholeUnits = accrueBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, cycles);
	if (wholeUnits > 0) {
		const int remainingWork = getPendingRenderWorkUnits() - m_availableWorkUnits;
		const int64_t maxGrant = remainingWork <= 0 ? 0 : remainingWork;
		const int64_t granted = wholeUnits > maxGrant ? maxGrant : wholeUnits;
		m_availableWorkUnits += static_cast<int>(granted);
	}
	scheduleNextService(nowCycles);
	refreshSubmitBusyStatus();
}

void VDP::onService(int64_t nowCycles) {
	if (needsImmediateSchedulerService()) {
		promotePendingFrame();
	}
	if (hasPendingRenderWork() && m_availableWorkUnits > 0) {
		const int pendingBefore = getPendingRenderWorkUnits();
		advanceWork(m_availableWorkUnits);
		const int pendingAfter = getPendingRenderWorkUnits();
		const int consumed = pendingBefore - pendingAfter;
		if (consumed > 0) {
			m_availableWorkUnits -= consumed;
		}
	}
	scheduleNextService(nowCycles);
}

// start repeated-sequence-acceptable -- VRAM row streaming keeps read/write loops direct; callback helpers would add hot-path overhead.
void VDP::writeVram(uint32_t addr, const u8* data, size_t length) {
	if (addr >= VRAM_STAGING_BASE && addr + length <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		const uint32_t offset = addr - VRAM_STAGING_BASE;
		std::memcpy(m_vramStaging.data() + offset, data, length);
		return;
	}
	VramSlot* mappedSlot = findMappedVramSlot(addr, length);
	if (mappedSlot == nullptr) {
		raiseFault(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
		return;
	}
	auto& slot = *mappedSlot;
	const uint32_t offset = addr - slot.baseAddr;
	if ((offset & 3u) != 0u || (length & 3u) != 0u) {
		raiseFault(VDP_FAULT_VRAM_WRITE_UNALIGNED, addr);
		return;
	}
	if (slot.surfaceWidth == 0 || slot.surfaceHeight == 0) {
		raiseFault(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
		return;
	}
	const uint32_t stride = slot.surfaceWidth * 4u;
	const uint32_t totalBytes = slot.surfaceHeight * stride;
	if (offset + length > totalBytes) {
		raiseFault(VDP_FAULT_VRAM_WRITE_OOB, addr);
		return;
	}
	size_t remaining = length;
	size_t cursor = 0;
	uint32_t row = offset / stride;
	uint32_t rowOffset = offset - row * stride;
	while (remaining > 0) {
		const uint32_t rowAvailable = stride - rowOffset;
			const uint32_t rowBytes = static_cast<uint32_t>(std::min<size_t>(remaining, rowAvailable));
			const uint32_t xStart = rowOffset / 4u;
			const uint32_t xEnd = xStart + rowBytes / 4u;
			markVramSlotDirtySpan(slot, row, xStart, xEnd);
			const size_t cpuOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
			std::memcpy(slot.cpuReadback.data() + cpuOffset, data + cursor, rowBytes);
			invalidateReadCache(slot.surfaceId);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1;
		rowOffset = 0;
	}
}

void VDP::readVram(uint32_t addr, u8* out, size_t length) const {
	if (addr >= VRAM_STAGING_BASE && addr + length <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		const uint32_t offset = addr - VRAM_STAGING_BASE;
		std::memcpy(out, m_vramStaging.data() + offset, length);
		return;
	}
	const auto& slot = findVramSlot(addr, length);
	if (slot.surfaceWidth == 0 || slot.surfaceHeight == 0) {
		std::memset(out, 0, length);
		return;
	}
	const uint32_t offset = addr - slot.baseAddr;
	const uint32_t stride = slot.surfaceWidth * 4u;
	const uint32_t totalBytes = slot.surfaceHeight * stride;
	if (offset + length > totalBytes) {
		throw vdpFault("VRAM read exceeds slot bounds.");
	}
	size_t remaining = length;
	size_t cursor = 0;
	uint32_t row = offset / stride;
	uint32_t rowOffset = offset - row * stride;
	while (remaining > 0) {
		const uint32_t rowAvailable = stride - rowOffset;
		const uint32_t rowBytes = static_cast<uint32_t>(std::min<size_t>(remaining, rowAvailable));
		const size_t cpuOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
		std::memcpy(out + cursor, slot.cpuReadback.data() + cpuOffset, rowBytes);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1;
		rowOffset = 0;
	}
}
// end repeated-sequence-acceptable
// end hot-path

// start hot-path -- frame scheduling and submitted-frame promotion run every visible frame.
void VDP::beginFrame() {
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
	m_readOverflow = false;
}

bool VDP::enqueueLatchedClear() {
	BlitterCommand command;
	command.type = BlitterCommandType::Clear;
	command.seq = nextBlitterSequence();
	command.renderCost = VDP_RENDER_CLEAR_COST;
	command.color = unpackArgbColor(m_vdpRegisters[VDP_REG_BG_COLOR]);
	enqueueBlitterCommand(std::move(command));
	return true;
}

bool VDP::enqueueLatchedFillRect() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const VdpLatchedGeometry geometry = readLatchedGeometry();
	const VdpClippedRect clipped = computeClippedRect(geometry.x0, geometry.y0, geometry.x1, geometry.y1, m_frameBufferWidth, m_frameBufferHeight);
	if (clipped.area == 0.0) {
		return true;
	}
	const FrameBufferColor color = unpackArgbColor(m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	BlitterCommand command;
	assignLayeredBlitterCommand(command, BlitterCommandType::FillRect, calculateVisibleRectCost(clipped.width, clipped.height) * calculateAlphaMultiplier(color), layer, priority);
	command.x0 = geometry.x0;
	command.y0 = geometry.y0;
	command.x1 = geometry.x1;
	command.y1 = geometry.y1;
	command.color = color;
	enqueueBlitterCommand(std::move(command));
	return true;
}

bool VDP::enqueueLatchedDrawLine() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const f32 thickness = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_LINE_WIDTH]);
	if (thickness <= 0.0f) {
		raiseFault(VDP_FAULT_DEX_INVALID_LINE_WIDTH, m_vdpRegisters[VDP_REG_LINE_WIDTH]);
		return false;
	}
	const VdpLatchedGeometry geometry = readLatchedGeometry();
	const double span = computeClippedLineSpan(geometry.x0, geometry.y0, geometry.x1, geometry.y1, m_frameBufferWidth, m_frameBufferHeight);
	if (span == 0.0) {
		return true;
	}
	const FrameBufferColor color = unpackArgbColor(m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	const int thicknessMultiplier = thickness > 1.0f ? 2 : 1;
	BlitterCommand command;
	assignLayeredBlitterCommand(command, BlitterCommandType::DrawLine, blitSpanBucket(span) * thicknessMultiplier * calculateAlphaMultiplier(color), layer, priority);
	command.x0 = geometry.x0;
	command.y0 = geometry.y0;
	command.x1 = geometry.x1;
	command.y1 = geometry.y1;
	command.thickness = thickness;
	command.color = color;
	enqueueBlitterCommand(std::move(command));
	return true;
}

bool VDP::enqueueLatchedBlit() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const VdpDrawCtrl drawCtrl = decodeVdpDrawCtrl(m_vdpRegisters[VDP_REG_DRAW_CTRL]);
	const u32 slot = m_vdpRegisters[VDP_REG_SRC_SLOT];
	const u32 u = packedLow16(m_vdpRegisters[VDP_REG_SRC_UV]);
	const u32 v = packedHigh16(m_vdpRegisters[VDP_REG_SRC_UV]);
	const u32 w = packedLow16(m_vdpRegisters[VDP_REG_SRC_WH]);
	const u32 h = packedHigh16(m_vdpRegisters[VDP_REG_SRC_WH]);
	BlitterSource source;
	if (!tryResolveBlitterSourceWordsInto(slot, u, v, w, h, source, VDP_FAULT_DEX_SOURCE_SLOT)) {
		return false;
	}
	VdpBlitterSurfaceSize surface;
	if (!tryResolveBlitterSurfaceForSource(source, surface, VDP_FAULT_DEX_SOURCE_OOB, VDP_FAULT_DEX_SOURCE_OOB)) {
		return false;
	}
	const f32 scaleX = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_DRAW_SCALE_X]);
	const f32 scaleY = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_DRAW_SCALE_Y]);
	if (scaleX <= 0.0f) {
		raiseFault(VDP_FAULT_DEX_INVALID_SCALE, m_vdpRegisters[VDP_REG_DRAW_SCALE_X]);
		return false;
	}
	if (scaleY <= 0.0f) {
		raiseFault(VDP_FAULT_DEX_INVALID_SCALE, m_vdpRegisters[VDP_REG_DRAW_SCALE_Y]);
		return false;
	}
	const f32 dstX = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_DST_X]);
	const f32 dstY = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_DST_Y]);
	const VdpResolvedBlitPmu resolved = m_pmu.resolveBlit(dstX, dstY, scaleX, scaleY, drawCtrl.pmuBank, drawCtrl.parallaxWeight);
	const double dstWidth = static_cast<double>(source.width) * static_cast<double>(resolved.scaleX);
	const double dstHeight = static_cast<double>(source.height) * static_cast<double>(resolved.scaleY);
	const VdpClippedRect clipped = computeClippedRect(resolved.dstX, resolved.dstY, resolved.dstX + dstWidth, resolved.dstY + dstHeight, m_frameBufferWidth, m_frameBufferHeight);
	if (clipped.area == 0.0) {
		return true;
	}
	const FrameBufferColor color = unpackArgbColor(m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	BlitterCommand command;
	assignLayeredBlitterCommand(command, BlitterCommandType::Blit, calculateVisibleRectCost(clipped.width, clipped.height) * calculateAlphaMultiplier(color), layer, priority);
	command.source = source;
	command.dstX = resolved.dstX;
	command.dstY = resolved.dstY;
	command.scaleX = resolved.scaleX;
	command.scaleY = resolved.scaleY;
	command.flipH = drawCtrl.flipH;
	command.flipV = drawCtrl.flipV;
	command.color = color;
	command.parallaxWeight = drawCtrl.parallaxWeight;
	enqueueBlitterCommand(std::move(command));
	return true;
}

bool VDP::enqueueLatchedCopyRect() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const i32 srcX = static_cast<i32>(packedLow16(m_vdpRegisters[VDP_REG_SRC_UV]));
	const i32 srcY = static_cast<i32>(packedHigh16(m_vdpRegisters[VDP_REG_SRC_UV]));
	const i32 width = static_cast<i32>(packedLow16(m_vdpRegisters[VDP_REG_SRC_WH]));
	const i32 height = static_cast<i32>(packedHigh16(m_vdpRegisters[VDP_REG_SRC_WH]));
	const i32 dstX = static_cast<i32>(m_vdpRegisters[VDP_REG_DST_X]) >> 16;
	const i32 dstY = static_cast<i32>(m_vdpRegisters[VDP_REG_DST_Y]) >> 16;
	enqueueCopyRect(srcX, srcY, width, height, dstX, dstY, priority, layer);
	return true;
}

u32 VDP::nextBlitterSequence() {
	return m_blitterSequence++;
}

void VDP::assignLayeredBlitterCommand(BlitterCommand& command, BlitterCommandType type, int renderCost, Layer2D layer, f32 z) {
	command.type = type;
	command.seq = nextBlitterSequence();
	command.renderCost = renderCost;
	command.layer = layer;
	command.z = z;
}

std::vector<VDP::GlyphRunGlyph> VDP::acquireGlyphBuffer() {
	return acquireVectorFromPool(m_glyphBufferPool);
}

std::vector<VDP::TileRunBlit> VDP::acquireTileBuffer() {
	return acquireVectorFromPool(m_tileBufferPool);
}

void VDP::recycleBlitterBuffers(std::vector<BlitterCommand>& queue) {
	for (auto& command : queue) {
		if (command.type == BlitterCommandType::GlyphRun) {
			command.glyphs.clear();
			m_glyphBufferPool.push_back(std::move(command.glyphs));
		} else if (command.type == BlitterCommandType::TileRun) {
			command.tiles.clear();
			m_tileBufferPool.push_back(std::move(command.tiles));
		}
	}
}

void VDP::resetBuildFrameState() {
	recycleBlitterBuffers(m_buildFrame.queue);
	m_buildFrame.queue.clear();
	m_buildFrame.billboards.clear();
	m_buildFrame.cost = 0;
	m_buildFrame.open = false;
}

void VDP::resetQueuedFrameState() {
	resetBuildFrameState();
	clearActiveFrame();
	m_committedBillboards.clear();
	recycleBlitterBuffers(m_pendingFrame.queue);
	m_pendingFrame.billboards.clear();
	resetSubmittedFrameSlot(m_pendingFrame);
}

void VDP::enqueueBlitterCommand(BlitterCommand&& command) {
	if (!m_buildFrame.open) {
		throw vdpFault("no submitted frame is open.");
	}
	if (m_buildFrame.queue.size() >= BLITTER_FIFO_CAPACITY) {
		throw vdpFault("blitter FIFO overflow (4096 commands).");
	}
	m_buildFrame.cost += command.renderCost;
	m_buildFrame.queue.push_back(std::move(command));
}

int VDP::calculateVisibleRectCost(double width, double height) const {
	return blitAreaBucket(width * height);
}

int VDP::calculateAlphaMultiplier(const FrameBufferColor& color) const {
	return color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
}

void VDP::swapFrameBufferReadbackPages() {
	auto& renderSlot = getVramSlotBySurfaceId(VDP_RD_SURFACE_FRAMEBUFFER);
	std::swap(renderSlot.cpuReadback, m_displayFrameBufferCpuReadback);
	invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
}

// disable-next-line single_line_method_pattern -- render-side framebuffer writes invalidate the device read cache through this public pin.
void VDP::invalidateFrameBufferReadCache() {
	invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
}

void VDP::beginSubmittedFrame() {
	if (m_buildFrame.open) {
		throw vdpFault("submitted frame already open.");
	}
	resetBuildFrameState();
	m_blitterSequence = 0u;
	m_buildFrame.open = true;
}

void VDP::cancelSubmittedFrame() {
	resetBuildFrameState();
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

bool VDP::assignBuildToSlot(bool active) {
	if (!m_buildFrame.open) {
		throw vdpFault("no submitted frame is open.");
	}
	auto& frame = active ? m_activeFrame : m_pendingFrame;
	if (!frame.queue.empty()) {
		throw vdpFault(active
			? "active frame queue is not empty."
			: "pending frame queue is not empty.");
	}
	const bool frameHasFrameBufferCommands = !m_buildFrame.queue.empty();
	const bool frameHasCommands = frameHasFrameBufferCommands || !m_buildFrame.billboards.empty();
	const int frameCost = (!m_buildFrame.queue.empty() && m_buildFrame.queue.front().type != BlitterCommandType::Clear)
		? (m_buildFrame.cost + VDP_RENDER_CLEAR_COST)
		: m_buildFrame.cost;
	frame.skyboxControl = m_sbx.latchFrame(frame.skyboxFaceWords);
	if (!resolveSkyboxFrameSamples(frame.skyboxControl, frame.skyboxFaceWords, frame.skyboxSamples)) {
		return false;
	}
	m_camera.latchFrame(frame.camera);
	frame.queue.swap(m_buildFrame.queue);
	frame.billboards.swap(m_buildFrame.billboards);
	frame.occupied = true;
	frame.hasCommands = frameHasCommands;
	frame.hasFrameBufferCommands = frameHasFrameBufferCommands;
	frame.ready = frameCost == 0;
	frame.cost = frameCost;
	frame.workRemaining = frameCost;
	frame.ditherType = m_liveDitherType;
	m_buildFrame.billboards.clear();
	m_buildFrame.cost = 0;
	m_buildFrame.open = false;
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
	return true;
}

bool VDP::sealSubmittedFrame() {
	if (!m_buildFrame.open) {
		throw vdpFault("no submitted frame is open.");
	}
	if (!m_activeFrame.occupied) {
		return assignBuildToSlot(true);
	}
	if (!m_pendingFrame.occupied) {
		return assignBuildToSlot(false);
	}
	raiseFault(VDP_FAULT_SUBMIT_BUSY, VDP_CMD_END_FRAME);
	return false;
}

void VDP::promotePendingFrame() {
	if (m_activeFrame.occupied || !m_pendingFrame.occupied) {
		return;
	}
	std::swap(m_activeFrame, m_pendingFrame);
	resetSubmittedFrameSlot(m_pendingFrame);
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::advanceWork(int workUnits) {
	if (!m_activeFrame.occupied) {
		promotePendingFrame();
	}
	if (!m_activeFrame.occupied || m_activeFrame.ready || workUnits <= 0) {
		return;
	}
	if (workUnits >= m_activeFrame.workRemaining) {
		m_activeFrame.workRemaining = 0;
		m_activeFrame.queue.swap(m_execution.queue);
		m_activeFrame.queue.clear();
		m_execution.pending = true;
		m_hostOutputToken += 1u;
		if (m_hostOutputToken == 0u) {
			m_hostOutputToken = 1u;
		}
		scheduleNextService(m_scheduler.currentNowCycles());
		return;
	}
	m_activeFrame.workRemaining -= workUnits;
}

int VDP::getPendingRenderWorkUnits() const {
	if (!m_activeFrame.occupied) {
		return m_pendingFrame.cost;
	}
	return (m_activeFrame.ready || m_execution.pending) ? 0 : m_activeFrame.workRemaining;
}

void VDP::scheduleNextService(int64_t nowCycles) {
	if (needsImmediateSchedulerService()) {
		m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles);
		return;
	}
	if (!hasPendingRenderWork()) {
		m_scheduler.cancelDeviceService(DeviceServiceVdp);
		return;
	}
	const int pendingWork = getPendingRenderWorkUnits();
	const int targetUnits = pendingWork < VDP_SERVICE_BATCH_WORK_UNITS ? pendingWork : VDP_SERVICE_BATCH_WORK_UNITS;
	if (m_availableWorkUnits >= targetUnits) {
		m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, targetUnits - m_availableWorkUnits));
}

void VDP::clearActiveFrame() {
	recycleBlitterBuffers(m_activeFrame.queue);
	recycleBlitterBuffers(m_execution.queue);
	m_execution.queue.clear();
	m_execution.pending = false;
	m_hostOutputToken = 0u;
	resetSubmittedFrameSlot(m_activeFrame);
}

VDP::VdpHostOutput VDP::readHostOutput() {
	VdpHostOutput output;
	if (m_execution.pending) {
		output.executionToken = m_hostOutputToken;
		output.executionQueue = &m_execution.queue;
	}
	output.executionBillboards = &m_activeFrame.billboards;
	output.executionWritesFrameBuffer = m_activeFrame.hasFrameBufferCommands;
	output.ditherType = m_committedDitherType;
	output.camera = &m_committedCamera;
	output.skyboxEnabled = m_sbx.visibleEnabled();
	output.skyboxSamples = &m_committedSkyboxSamples;
	output.billboards = &m_committedBillboards;
	output.surfaceUploadSlots = &m_vramSlots;
	output.frameBufferWidth = m_frameBufferWidth;
	output.frameBufferHeight = m_frameBufferHeight;
	output.frameBufferRenderReadback = &frameBufferRenderReadback();
	return output;
}

void VDP::completeHostExecution(const VdpHostOutput& output) {
	if (!m_execution.pending || output.executionToken != m_hostOutputToken || output.executionQueue != &m_execution.queue) {
		throw vdpFault("no active frame execution pending.");
	}
	if (output.executionWritesFrameBuffer) {
		invalidateFrameBufferReadCache();
	}
	m_execution.pending = false;
	m_activeFrame.ready = true;
	recycleBlitterBuffers(m_execution.queue);
	m_execution.queue.clear();
	m_hostOutputToken = 0u;
}

void VDP::commitActiveVisualState() {
	m_committedDitherType = m_activeFrame.ditherType;
	m_sbx.presentFrame(m_activeFrame.skyboxControl, m_activeFrame.skyboxFaceWords);
	m_committedCamera = m_activeFrame.camera;
	m_committedSkyboxSamples = m_activeFrame.skyboxSamples;
	m_committedBillboards.swap(m_activeFrame.billboards);
	m_activeFrame.billboards.clear();
}

void VDP::finishCommittedFrameOnVblankEdge() {
	commitActiveVisualState();
	m_lastFrameCommitted = true;
	m_lastFrameHeld = false;
	clearActiveFrame();
	promotePendingFrame();
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

bool VDP::commitReadyFrameOnVblankEdge() {
	if (!m_activeFrame.occupied) {
		m_lastFrameCommitted = false;
		m_lastFrameCost = 0;
		m_lastFrameHeld = false;
		promotePendingFrame();
		scheduleNextService(m_scheduler.currentNowCycles());
		refreshSubmitBusyStatus();
		return false;
	}
	m_lastFrameCost = m_activeFrame.cost;
	if (!m_activeFrame.ready) {
		m_lastFrameCommitted = false;
		m_lastFrameHeld = true;
		return false;
	}
	if (m_activeFrame.hasFrameBufferCommands) {
		finishCommittedFrameOnVblankEdge();
		return true;
	}
	finishCommittedFrameOnVblankEdge();
	return false;
}
// end hot-path

uint32_t VDP::resolveSurfaceIdForSlot(u32 slot) const {
	if (slot == VDP_SLOT_SYSTEM) {
		return VDP_RD_SURFACE_SYSTEM;
	}
	if (slot == VDP_SLOT_PRIMARY) {
		return VDP_RD_SURFACE_PRIMARY;
	}
	if (slot == VDP_SLOT_SECONDARY) {
		return VDP_RD_SURFACE_SECONDARY;
	}
	throw vdpFault("source slot " + std::to_string(slot) + " is not a VDP blitter slot.");
}

bool VDP::tryResolveSurfaceIdForSlot(u32 slot, uint32_t& surfaceId, uint32_t faultCode) {
	if (slot == VDP_SLOT_SYSTEM) {
		surfaceId = VDP_RD_SURFACE_SYSTEM;
		return true;
	}
	if (slot == VDP_SLOT_PRIMARY) {
		surfaceId = VDP_RD_SURFACE_PRIMARY;
		return true;
	}
	if (slot == VDP_SLOT_SECONDARY) {
		surfaceId = VDP_RD_SURFACE_SECONDARY;
		return true;
	}
	raiseFault(faultCode, slot);
	return false;
}

void VDP::resolveBlitterSourceWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, BlitterSource& target) const {
	target.surfaceId = resolveSurfaceIdForSlot(slot);
	target.srcX = u;
	target.srcY = v;
	target.width = w;
	target.height = h;
}

uint32_t VDP::resolveSlotForSurfaceId(uint32_t surfaceId) const {
	if (surfaceId == VDP_RD_SURFACE_SYSTEM) {
		return VDP_SLOT_SYSTEM;
	}
	if (surfaceId == VDP_RD_SURFACE_PRIMARY) {
		return VDP_SLOT_PRIMARY;
	}
	if (surfaceId == VDP_RD_SURFACE_SECONDARY) {
		return VDP_SLOT_SECONDARY;
	}
	throw vdpFault("surface " + std::to_string(surfaceId) + " cannot be sampled by the blitter slot pipeline.");
}

bool VDP::tryResolveBlitterSourceWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, BlitterSource& target, uint32_t faultCode) {
	uint32_t surfaceId = 0u;
	if (!tryResolveSurfaceIdForSlot(slot, surfaceId, faultCode)) {
		return false;
	}
	target.surfaceId = surfaceId;
	target.srcX = u;
	target.srcY = v;
	target.width = w;
	target.height = h;
	return true;
}

VdpBlitterSurfaceSize VDP::resolveBlitterSurfaceSize(uint32_t surfaceId) const {
	const auto& surface = getReadSurface(surfaceId);
	return VdpBlitterSurfaceSize{
		surface.surfaceWidth,
		surface.surfaceHeight,
	};
}

VdpBlitterSurfaceSize VDP::resolveBlitterSurfaceForSource(const BlitterSource& source) const {
	if (source.width == 0u || source.height == 0u) {
		throw vdpFault("VDP source dimensions must be positive.");
	}
	const VdpBlitterSurfaceSize surface = resolveBlitterSurfaceSize(source.surfaceId);
	if (source.srcX + source.width > surface.width || source.srcY + source.height > surface.height) {
		throw vdpFault("VDP source rectangle exceeds configured slot dimensions.");
	}
	return surface;
}

bool VDP::tryResolveBlitterSurfaceForSource(const BlitterSource& source, VdpBlitterSurfaceSize& target, uint32_t faultCode, uint32_t zeroSizeFaultCode) {
	if (source.width == 0u || source.height == 0u) {
		raiseFault(zeroSizeFaultCode, source.width | (source.height << 16u));
		return false;
	}
	const VdpBlitterSurfaceSize surface = resolveBlitterSurfaceSize(source.surfaceId);
	if (source.srcX + source.width > surface.width || source.srcY + source.height > surface.height) {
		raiseFault(faultCode, source.srcX | (source.srcY << 16u));
		return false;
	}
	target = surface;
	return true;
}

void VDP::resolveBlitterSampleWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, ResolvedBlitterSample& target) const {
	BlitterSource source;
	resolveBlitterSourceWordsInto(slot, u, v, w, h, source);
	const VdpBlitterSurfaceSize surface = resolveBlitterSurfaceForSource(source);
	target.source = source;
	target.surfaceWidth = surface.width;
	target.surfaceHeight = surface.height;
	target.slot = resolveSlotForSurfaceId(source.surfaceId);
}

bool VDP::tryResolveBlitterSampleWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, ResolvedBlitterSample& target, uint32_t faultCode) {
	BlitterSource source;
	if (!tryResolveBlitterSourceWordsInto(slot, u, v, w, h, source, faultCode)) {
		return false;
	}
	VdpBlitterSurfaceSize surface;
	if (!tryResolveBlitterSurfaceForSource(source, surface, faultCode, faultCode)) {
		return false;
	}
	target.source = source;
	target.surfaceWidth = surface.width;
	target.surfaceHeight = surface.height;
	target.slot = resolveSlotForSurfaceId(source.surfaceId);
	return true;
}

bool VDP::latchBillboardPacket(const VdpBbuPacket& packet) {
	const f32 size = decodeUnsignedQ16_16(packet.sizeWord);
	if (size <= 0.0f) {
		raiseFault(VDP_FAULT_BBU_ZERO_SIZE, packet.sizeWord);
		return false;
	}
	if (m_buildFrame.billboards.size() >= VDP_BBU_BILLBOARD_LIMIT) {
		raiseFault(VDP_FAULT_BBU_OVERFLOW, static_cast<uint32_t>(m_buildFrame.billboards.size()));
		return false;
	}
	BlitterSource source;
	if (!tryResolveBlitterSourceWordsInto(packet.sourceRect.slot, packet.sourceRect.u, packet.sourceRect.v, packet.sourceRect.w, packet.sourceRect.h, source, VDP_FAULT_BBU_SOURCE_OOB)) {
		return false;
	}
	VdpBlitterSurfaceSize surface;
	if (!tryResolveBlitterSurfaceForSource(source, surface, VDP_FAULT_BBU_SOURCE_OOB, VDP_FAULT_BBU_ZERO_SIZE)) {
		return false;
	}
	m_bbu.latchBillboard(
		m_buildFrame.billboards,
		packet,
		nextBlitterSequence(),
			VdpBbuSource{source.surfaceId, source.srcX, source.srcY, source.width, source.height},
			VdpBbuSurfaceSize{surface.width, surface.height},
			resolveSlotForSurfaceId(source.surfaceId));
	m_buildFrame.cost += VDP_RENDER_BILLBOARD_COST;
	return true;
}

bool VDP::resolveSkyboxFrameSamples(u32 control, const VdpSbxUnit::FaceWords& faceWords, SkyboxSamples& samples) {
	if ((control & VDP_SBX_CONTROL_ENABLE) == 0u) {
		return true;
	}
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		if (!tryResolveBlitterSampleWordsInto(
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_SLOT_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_U_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_V_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_W_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_H_WORD),
			samples[index],
			VDP_FAULT_SBX_SOURCE_OOB)) {
			return false;
		}
	}
	return true;
}

void VDP::enqueueCopyRect(i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, f32 z, Layer2D layer) {
	const VdpClippedRect clipped = computeClippedRect(dstX, dstY, dstX + width, dstY + height, m_frameBufferWidth, m_frameBufferHeight);
	if (clipped.area == 0.0) {
		return;
	}
	BlitterCommand command;
	assignLayeredBlitterCommand(command, BlitterCommandType::CopyRect, calculateVisibleRectCost(clipped.width, clipped.height), layer, z);
	command.srcX = srcX;
	command.srcY = srcY;
	command.width = width;
	command.height = height;
	command.dstX = static_cast<f32>(dstX);
	command.dstY = static_cast<f32>(dstY);
	enqueueBlitterCommand(std::move(command));
}

VDP::TileRunClipWindow VDP::clipTileRun(i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY) const {
	TileRunClipWindow clip;
	clip.frameWidth = static_cast<i32>(m_frameBufferWidth);
	clip.frameHeight = static_cast<i32>(m_frameBufferHeight);
	const i32 totalWidth = cols * tileW;
	const i32 totalHeight = rows * tileH;
	clip.dstX = originX - scrollX;
	clip.dstY = originY - scrollY;
	i32 writeWidth = totalWidth;
	i32 writeHeight = totalHeight;
	if (clip.dstX < 0) {
		clip.srcClipX = -clip.dstX;
		writeWidth += clip.dstX;
		clip.dstX = 0;
	}
	if (clip.dstY < 0) {
		clip.srcClipY = -clip.dstY;
		writeHeight += clip.dstY;
		clip.dstY = 0;
	}
	const i32 overflowX = (clip.dstX + writeWidth) - clip.frameWidth;
	if (overflowX > 0) {
		writeWidth -= overflowX;
	}
	const i32 overflowY = (clip.dstY + writeHeight) - clip.frameHeight;
	if (overflowY > 0) {
		writeHeight -= overflowY;
	}
	clip.visible = writeWidth > 0 && writeHeight > 0;
	return clip;
}

u32 VDP::readTileRunPayloadWord(const TileRunPayload& payload, u32 wordOffset) const {
	if (payload.source == TileRunPayloadSource::Memory) {
		return m_memory.readU32(payload.memoryBase + wordOffset * IO_WORD_SIZE);
	}
	return payload.words[wordOffset];
}

void VDP::appendTileRunSource(BlitterCommand& command, const BlitterSource& source, const TileRunClipWindow& clip, i32 tileW, i32 tileH, i32 tileX, i32 tileY, i32 row, const char* sourceName, int& visibleRowCount, int& visibleNonEmptyTileCount, i32& lastVisibleRow) {
	if (source.width != static_cast<u32>(tileW) || source.height != static_cast<u32>(tileH)) {
		throw vdpFault(std::string(sourceName) + " tile size mismatch.");
	}
	const VdpClippedRect clipped = computeClippedRect(
		static_cast<double>(tileX),
		static_cast<double>(tileY),
		static_cast<double>(tileX + tileW),
		static_cast<double>(tileY + tileH),
		static_cast<double>(clip.frameWidth),
		static_cast<double>(clip.frameHeight)
	);
	if (clipped.area == 0.0) {
		return;
	}
	visibleNonEmptyTileCount += 1;
	if (lastVisibleRow != row) {
		lastVisibleRow = row;
		visibleRowCount += 1;
	}
	command.tiles.emplace_back();
	auto& blit = command.tiles.back();
	blit.surfaceId = source.surfaceId;
	blit.srcX = source.srcX;
	blit.srcY = source.srcY;
	blit.width = source.width;
	blit.height = source.height;
	blit.dstX = static_cast<f32>(tileX);
	blit.dstY = static_cast<f32>(tileY);
}

void VDP::latchPayloadTileRunFrom(const TileRunPayload& payload, const char* sourceName, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	if (tileCount != static_cast<uint32_t>(cols * rows)) {
		throw vdpFault(std::string(sourceName) + " size mismatch.");
	}
	const TileRunClipWindow clip = clipTileRun(cols, rows, tileW, tileH, originX, originY, scrollX, scrollY);
	if (!clip.visible) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::TileRun;
	command.seq = nextBlitterSequence();
	command.tiles = acquireTileBuffer();
	command.z = z;
	command.layer = layer;
	int visibleRowCount = 0;
	int visibleNonEmptyTileCount = 0;
	i32 lastVisibleRow = -1;
	for (i32 row = 0; row < rows; row += 1) {
		const i32 base = row * cols;
		for (i32 col = 0; col < cols; col += 1) {
			const u32 payloadOffset = static_cast<u32>(base + col) * 5u;
			const u32 slot = readTileRunPayloadWord(payload, payloadOffset);
			if (slot == VDP_SLOT_NONE) {
				continue;
			}
			BlitterSource source;
			resolveBlitterSourceWordsInto(
				slot,
				readTileRunPayloadWord(payload, payloadOffset + 1u),
				readTileRunPayloadWord(payload, payloadOffset + 2u),
				readTileRunPayloadWord(payload, payloadOffset + 3u),
				readTileRunPayloadWord(payload, payloadOffset + 4u),
				source);
			const i32 tileX = clip.dstX + (col * tileW) - clip.srcClipX;
			const i32 tileY = clip.dstY + (row * tileH) - clip.srcClipY;
			appendTileRunSource(command, source, clip, tileW, tileH, tileX, tileY, row, sourceName, visibleRowCount, visibleNonEmptyTileCount, lastVisibleRow);
		}
	}
	if (command.tiles.empty()) {
		command.tiles.clear();
		m_tileBufferPool.push_back(std::move(command.tiles));
		return;
	}
	command.renderCost = tileRunCost(visibleRowCount, visibleNonEmptyTileCount);
	enqueueBlitterCommand(std::move(command));
}

void VDP::latchPayloadTileRun(uint32_t payloadBase, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	const TileRunPayload payload{TileRunPayloadSource::Memory, payloadBase, nullptr};
	latchPayloadTileRunFrom(payload, "latchPayloadTileRun", tileCount, cols, rows, tileW, tileH, originX, originY, scrollX, scrollY, z, layer);
}

void VDP::latchPayloadTileRunWords(const u32* payloadWords, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	const TileRunPayload payload{TileRunPayloadSource::WordStream, 0u, payloadWords};
	latchPayloadTileRunFrom(payload, "latchPayloadTileRunWords", tileCount, cols, rows, tileW, tileH, originX, originY, scrollX, scrollY, z, layer);
}

void VDP::commitLiveVisualState() {
	m_committedDitherType = m_liveDitherType;
	m_committedBillboards.clear();
	m_sbx.presentLiveState();
	m_camera.latchFrame(m_committedCamera);
	resolveSkyboxFrameSamples(m_sbx.visibleControl(), m_sbx.visibleFaceWords(), m_committedSkyboxSamples);
}

// start hot-path -- VDP readback registers are polled by the emulated CPU.
uint32_t VDP::readVdpStatus() {
	uint32_t status = 0;
	if (m_readBudgetBytes >= 4u) {
		status |= VDP_RD_STATUS_READY;
	}
	if (m_readOverflow) {
		status |= VDP_RD_STATUS_OVERFLOW;
	}
	return status;
}

Value VDP::readVdpStatusThunk(void* context, uint32_t) {
	return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpStatus()));
}

uint32_t VDP::readVdpData() {
	const uint32_t surfaceId = m_memory.readIoU32(IO_VDP_RD_SURFACE);
	const uint32_t x = m_memory.readIoU32(IO_VDP_RD_X);
	const uint32_t y = m_memory.readIoU32(IO_VDP_RD_Y);
	const uint32_t mode = m_memory.readIoU32(IO_VDP_RD_MODE);
	if (mode != VDP_RD_MODE_RGBA8888) {
		raiseFault(VDP_FAULT_RD_UNSUPPORTED_MODE, mode);
		return 0u;
	}
	if (surfaceId >= VDP_RD_SURFACE_COUNT) {
		raiseFault(VDP_FAULT_RD_SURFACE, surfaceId);
		return 0u;
	}
	const ReadSurface& readSurface = m_readSurfaces[surfaceId];
	if (!readSurface.registered) {
		raiseFault(VDP_FAULT_RD_SURFACE, surfaceId);
		return 0u;
	}
	const auto& surface = getVramSlotBySurfaceId(readSurface.surfaceId);
	const uint32_t width = surface.surfaceWidth;
	const uint32_t height = surface.surfaceHeight;
	if (x >= width || y >= height) {
		raiseFault(VDP_FAULT_RD_OOB, x | (y << 16u));
		return 0u;
	}
	if (m_readBudgetBytes < 4u) {
		m_readOverflow = true;
		return 0u;
	}
	auto& cache = getReadCache(surfaceId, surface, x, y);
	const uint32_t localX = x - cache.x0;
	const size_t byteIndex = static_cast<size_t>(localX) * 4u;
	const u32 r = cache.data[byteIndex + 0];
	const u32 g = cache.data[byteIndex + 1];
	const u32 b = cache.data[byteIndex + 2];
	const u32 a = cache.data[byteIndex + 3];
	m_readBudgetBytes -= 4u;
	uint32_t nextX = x + 1u;
	uint32_t nextY = y;
	if (nextX >= width) {
		nextX = 0u;
		nextY = y + 1u;
	}
	m_memory.writeValue(IO_VDP_RD_X, valueNumber(static_cast<double>(nextX)));
	m_memory.writeValue(IO_VDP_RD_Y, valueNumber(static_cast<double>(nextY)));
	return (r | (g << 8u) | (b << 16u) | (a << 24u));
}

Value VDP::readVdpDataThunk(void* context, uint32_t) {
	return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpData()));
}

// end hot-path

void VDP::initializeRegisters() {
	const i32 dither = 0;
	const auto& frameBufferSurface = m_readSurfaces[VDP_RD_SURFACE_FRAMEBUFFER];
	if (frameBufferSurface.registered) {
		const auto& slot = getVramSlotBySurfaceId(frameBufferSurface.surfaceId);
		m_frameBufferWidth = slot.surfaceWidth;
		m_frameBufferHeight = slot.surfaceHeight;
	} else {
		m_frameBufferWidth = m_configuredFrameBufferSize.width;
		m_frameBufferHeight = m_configuredFrameBufferSize.height;
	}
	resetQueuedFrameState();
	resetIngressState();
	resetStatus();
	m_memory.writeIoValue(IO_VDP_RD_SURFACE, valueNumber(static_cast<double>(VDP_RD_SURFACE_SYSTEM)));
	m_memory.writeIoValue(IO_VDP_RD_X, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_Y, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_MODE, valueNumber(static_cast<double>(VDP_RD_MODE_RGBA8888)));
	m_memory.writeIoValue(IO_VDP_DITHER, valueNumber(static_cast<double>(dither)));
	m_memory.writeIoValue(IO_VDP_SLOT_PRIMARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	m_memory.writeIoValue(IO_VDP_SLOT_SECONDARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	m_memory.writeIoValue(IO_VDP_CMD, valueNumber(0.0));
	resetVdpRegisters();
	m_pmu.reset();
	syncPmuRegisterWindow();
	m_camera.reset();
	m_liveDitherType = dither;
	m_committedDitherType = dither;
	m_sbx.reset();
	syncSbxRegisterWindow();
	syncCameraRegisterWindow();
	m_lastFrameCommitted = true;
	m_lastFrameCost = 0;
	m_lastFrameHeld = false;
}

void VDP::initializeVramSurfaces() {
	const std::array<VdpVramSurface, VDP_RD_SURFACE_COUNT> surfaces = {
		makeVramSurface(VDP_RD_SURFACE_SYSTEM, VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE, 1u, 1u),
		makeVramSurface(VDP_RD_SURFACE_PRIMARY, VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE, 1u, 1u),
		makeVramSurface(VDP_RD_SURFACE_SECONDARY, VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE, 1u, 1u),
		makeVramSurface(VDP_RD_SURFACE_FRAMEBUFFER, VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE, m_configuredFrameBufferSize.width, m_configuredFrameBufferSize.height),
	};
	m_vramSlots.clear();
	m_readSurfaces = {};
	for (auto& cache : m_readCaches) {
		cache.width = 0;
		cache.data.clear();
	}
	resetQueuedFrameState();
	m_sbx.reset();
	syncSbxRegisterWindow();
	m_committedDitherType = m_liveDitherType;
	seedVramStaging();
	m_vramSlots.reserve(surfaces.size());
	for (const auto& surface : surfaces) {
		registerVramSlot(surface);
	}
	m_memory.writeIoValue(IO_VDP_SLOT_PRIMARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	m_memory.writeIoValue(IO_VDP_SLOT_SECONDARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
}

uint32_t VDP::trackedUsedVramBytes() const {
	uint32_t usedBytes = 0;
	for (const auto& slot : m_vramSlots) {
		usedBytes += slot.surfaceWidth * slot.surfaceHeight * 4u;
	}
	return usedBytes;
}

uint32_t VDP::trackedTotalVramBytes() const {
	return VRAM_SYSTEM_SLOT_SIZE + VRAM_PRIMARY_SLOT_SIZE + VRAM_SECONDARY_SLOT_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
}

void VDP::attachImgDecController(ImgDecController& controller) {
	m_imgDecController = &controller;
}

void VDP::captureVisualStateFields(VdpState& state) const {
	state.camera = m_camera.captureState();
	state.skyboxControl = m_sbx.liveControl();
	state.skyboxFaceWords = m_sbx.liveFaceWords();
	state.pmuSelectedBank = m_pmu.selectedBank();
	state.pmuBankWords = m_pmu.captureBankWords();
	state.ditherType = m_liveDitherType;
	state.vdpFaultCode = m_faultCode;
	state.vdpFaultDetail = m_faultDetail;
}

VdpState VDP::captureState() const {
	VdpState state;
	captureVisualStateFields(state);
	return state;
}

void VDP::restoreState(const VdpState& state) {
	m_camera.writeCameraBank0(state.camera.view, state.camera.proj, state.camera.eye.x, state.camera.eye.y, state.camera.eye.z);
	m_sbx.restoreLiveState(state.skyboxControl, state.skyboxFaceWords);
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(state.ditherType)));
	m_pmu.restoreBankWords(state.pmuSelectedBank, state.pmuBankWords);
	syncPmuRegisterWindow();
	syncSbxRegisterWindow();
	syncCameraRegisterWindow();
	m_vdpStatus = 0u;
	m_faultCode = state.vdpFaultCode;
	m_faultDetail = state.vdpFaultDetail;
	m_memory.writeIoValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
	m_memory.writeIoValue(IO_VDP_FAULT_CODE, valueNumber(static_cast<double>(m_faultCode)));
	m_memory.writeIoValue(IO_VDP_FAULT_DETAIL, valueNumber(static_cast<double>(m_faultDetail)));
	setStatusFlag(VDP_STATUS_FAULT, m_faultCode != VDP_FAULT_NONE);
	refreshSubmitBusyStatus();
	commitLiveVisualState();
}

VdpSaveState VDP::captureSaveState() const {
	VdpSaveState state;
	captureVisualStateFields(state);
	state.vramStaging = m_vramStaging;
	state.surfacePixels = captureSurfacePixels();
	state.displayFrameBufferPixels = m_displayFrameBufferCpuReadback;
	return state;
}

void VDP::restoreSaveState(const VdpSaveState& state) {
	restoreState(state);
	m_vramStaging = state.vramStaging;
	for (const VdpSurfacePixelsState& surface : state.surfacePixels) {
		restoreSurfacePixels(surface);
	}
	m_displayFrameBufferCpuReadback = state.displayFrameBufferPixels;
}

void VDP::registerVramSlot(const VdpVramSurface& surface) {
	const uint32_t size = surface.width * surface.height * 4u;
	if (surface.width == 0u || surface.height == 0u || size > surface.capacity) {
		throw vdpFault("VRAM surface has invalid dimensions.");
	}
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, surface.baseAddr};
	fillVramGarbageScratch(m_vramSeedPixel.data(), m_vramSeedPixel.size(), stream);
	VramSlot slot;
	slot.baseAddr = surface.baseAddr;
	slot.capacity = surface.capacity;
	slot.surfaceId = surface.surfaceId;
	slot.surfaceWidth = surface.width;
	slot.surfaceHeight = surface.height;
	slot.cpuReadback.resize(static_cast<size_t>(size));
	slot.dirtySpansByRow.resize(surface.height);
	m_vramSlots.push_back(std::move(slot));
	registerReadSurface(surface.surfaceId);
	auto& slotRef = m_vramSlots.back();
	if (surface.surfaceId == VDP_RD_SURFACE_FRAMEBUFFER) {
		m_frameBufferWidth = surface.width;
		m_frameBufferHeight = surface.height;
		m_displayFrameBufferCpuReadback.resize(static_cast<size_t>(size));
	}
	if (surface.surfaceId == VDP_RD_SURFACE_SYSTEM) {
		invalidateReadCache(surface.surfaceId);
		return;
	}
	seedVramSlotPixels(slotRef);
}

void VDP::setVramSlotLogicalDimensions(VramSlot& slot, uint32_t width, uint32_t height) {
	const uint32_t size = width * height * 4u;
	if (width == 0u || height == 0u || size > slot.capacity) {
		throw vdpFault("invalid VRAM surface dimensions " + std::to_string(width) + "x" + std::to_string(height) + " for surface " + std::to_string(slot.surfaceId) + ".");
	}
	if (slot.surfaceWidth == width && slot.surfaceHeight == height) {
		return;
	}
	std::vector<u8> previous;
	if (slot.surfaceId != VDP_RD_SURFACE_SYSTEM) {
		previous.swap(slot.cpuReadback);
	}
	slot.surfaceWidth = width;
	slot.surfaceHeight = height;
	slot.cpuReadback.resize(static_cast<size_t>(size));
	slot.dirtySpansByRow.assign(height, VramSlot::DirtySpan{});
	invalidateReadCache(slot.surfaceId);
	if (slot.surfaceId == VDP_RD_SURFACE_FRAMEBUFFER) {
		m_frameBufferWidth = width;
		m_frameBufferHeight = height;
		m_displayFrameBufferCpuReadback.resize(static_cast<size_t>(size));
	}
	if (slot.surfaceId == VDP_RD_SURFACE_SYSTEM) {
		slot.dirtyRowStart = 0;
		slot.dirtyRowEnd = 0;
		return;
	}
	seedVramSlotPixels(slot);
	const size_t copyBytes = previous.size() < slot.cpuReadback.size() ? previous.size() : slot.cpuReadback.size();
	if (copyBytes > 0u) {
		std::memcpy(slot.cpuReadback.data(), previous.data(), copyBytes);
	}
}

void VDP::setDecodedVramSurfaceDimensions(uint32_t baseAddr, uint32_t width, uint32_t height) {
	VramSlot& slot = findVramSlot(baseAddr, 1u);
	setVramSlotLogicalDimensions(slot, width, height);
}

void VDP::configureVramSlotSurface(uint32_t slotId, uint32_t width, uint32_t height) {
	if (width == 0u || height == 0u) {
		throw vdpFault("invalid VRAM surface dimensions " + std::to_string(width) + "x" + std::to_string(height) + ".");
	}
	const uint32_t surfaceId = resolveSurfaceIdForSlot(slotId);
	VramSlot& slot = getVramSlotBySurfaceId(surfaceId);
	const uint32_t byteLength = imageByteSize(width, height);
	if (byteLength > slot.capacity) {
		throw vdpFault("VRAM surface " + std::to_string(width) + "x" + std::to_string(height) + " exceeds slot capacity " + std::to_string(slot.capacity) + ".");
	}
	setVramSlotLogicalDimensions(slot, width, height);
}

std::vector<VdpSurfacePixelsState> VDP::captureSurfacePixels() const {
	std::vector<VdpSurfacePixelsState> surfaces;
	surfaces.reserve(m_vramSlots.size());
	for (const VramSlot& slot : m_vramSlots) {
		VdpSurfacePixelsState state;
		state.surfaceId = slot.surfaceId;
		state.pixels = slot.cpuReadback;
		surfaces.push_back(std::move(state));
	}
	return surfaces;
}

void VDP::restoreSurfacePixels(const VdpSurfacePixelsState& state) {
	VramSlot& slot = getVramSlotBySurfaceId(state.surfaceId);
	slot.cpuReadback = state.pixels;
	invalidateReadCache(state.surfaceId);
	markVramSlotDirty(slot, 0, slot.surfaceHeight);
}

VDP::VramSlot& VDP::findVramSlot(uint32_t addr, size_t length) {
	VramSlot* slot = findMappedVramSlot(addr, length);
	if (slot != nullptr) {
		return *slot;
	}
	throw vdpFault("VRAM write has no mapped slot.");
}

VDP::VramSlot* VDP::findMappedVramSlot(uint32_t addr, size_t length) {
	for (auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return &slot;
		}
	}
	return nullptr;
}

const VDP::VramSlot& VDP::findVramSlot(uint32_t addr, size_t length) const {
	for (const auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return slot;
		}
	}
	throw vdpFault("VRAM write has no mapped slot.");
}

void VDP::markVramSlotDirty(VramSlot& slot, uint32_t startRow, uint32_t rowCount) {
	const uint32_t endRow = startRow + rowCount;
	if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
		slot.dirtyRowStart = startRow;
		slot.dirtyRowEnd = endRow;
	} else if (startRow < slot.dirtyRowStart) {
		slot.dirtyRowStart = startRow;
	}
	if (endRow > slot.dirtyRowEnd) {
		slot.dirtyRowEnd = endRow;
	}
	for (uint32_t row = startRow; row < endRow; ++row) {
		slot.dirtySpansByRow[row].xStart = 0;
		slot.dirtySpansByRow[row].xEnd = slot.surfaceWidth;
	}
}

void VDP::markVramSlotDirtySpan(VramSlot& slot, uint32_t row, uint32_t xStart, uint32_t xEnd) {
	const uint32_t endRow = row + 1u;
	if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
		slot.dirtyRowStart = row;
		slot.dirtyRowEnd = endRow;
	} else {
		if (row < slot.dirtyRowStart) {
			slot.dirtyRowStart = row;
		}
		if (endRow > slot.dirtyRowEnd) {
			slot.dirtyRowEnd = endRow;
		}
	}
	auto& span = slot.dirtySpansByRow[row];
	if (span.xStart >= span.xEnd) {
		span.xStart = xStart;
		span.xEnd = xEnd;
		return;
	}
	if (xStart < span.xStart) {
		span.xStart = xStart;
	}
	if (xEnd > span.xEnd) {
		span.xEnd = xEnd;
	}
}

VDP::VramSlot* VDP::findRegisteredVramSlotBySurfaceId(uint32_t surfaceId) {
	for (auto& slot : m_vramSlots) {
		if (slot.surfaceId == surfaceId) {
			return &slot;
		}
	}
	return nullptr;
}

VDP::VramSlot& VDP::getVramSlotBySurfaceId(uint32_t surfaceId) {
	VramSlot* slot = findRegisteredVramSlotBySurfaceId(surfaceId);
	if (slot != nullptr) {
		return *slot;
	}
	throw vdpFault("VRAM slot not registered for surface " + std::to_string(surfaceId) + ".");
}

const VDP::VramSlot& VDP::getVramSlotBySurfaceId(uint32_t surfaceId) const {
	for (const auto& slot : m_vramSlots) {
		if (slot.surfaceId == surfaceId) {
			return slot;
		}
	}
	throw vdpFault("VRAM slot not registered for surface " + std::to_string(surfaceId) + ".");
}

void VDP::seedVramStaging() {
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, VRAM_STAGING_BASE};
	fillVramGarbageScratch(m_vramStaging.data(), m_vramStaging.size(), stream);
}

void VDP::seedVramSlotPixels(VramSlot& slot) {
	const size_t rowPixels = static_cast<size_t>(slot.surfaceWidth);
	const size_t maxPixels = m_vramGarbageScratch.size() / 4u;
	slot.cpuReadback.resize(static_cast<size_t>(slot.surfaceWidth) * static_cast<size_t>(slot.surfaceHeight) * 4u);
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, slot.baseAddr};
	const size_t rowBytes = rowPixels * 4u;
	const uint32_t height = slot.surfaceHeight;
	if (rowBytes <= m_vramGarbageScratch.size()) {
		const size_t rowsPerChunk = std::max<size_t>(1u, m_vramGarbageScratch.size() / rowBytes);
		for (uint32_t y = 0; y < height; ) {
			const size_t rows = std::min<size_t>(rowsPerChunk, height - y);
			const size_t chunkBytes = rowBytes * rows;
			fillVramGarbageScratch(m_vramGarbageScratch.data(), chunkBytes, stream);
			if (slot.surfaceId != VDP_RD_SURFACE_SYSTEM) {
				markVramSlotDirty(slot, y, static_cast<uint32_t>(rows));
			}
			std::memcpy(slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes, m_vramGarbageScratch.data(), chunkBytes);
			y += static_cast<uint32_t>(rows);
		}
	} else {
		for (uint32_t y = 0; y < height; ++y) {
			for (uint32_t x = 0; x < slot.surfaceWidth; ) {
				const size_t segmentWidth = std::min<size_t>(maxPixels, slot.surfaceWidth - x);
				const size_t segmentBytes = segmentWidth * 4u;
				fillVramGarbageScratch(m_vramGarbageScratch.data(), segmentBytes, stream);
				if (slot.surfaceId != VDP_RD_SURFACE_SYSTEM) {
					markVramSlotDirty(slot, y, 1u);
				}
				std::memcpy(
					slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes + static_cast<size_t>(x) * 4u,
					m_vramGarbageScratch.data(),
					segmentBytes
				);
				x += static_cast<uint32_t>(segmentWidth);
			}
		}
	}
	invalidateReadCache(slot.surfaceId);
}

void VDP::registerReadSurface(uint32_t surfaceId) {
	m_readSurfaces[surfaceId].surfaceId = surfaceId;
	m_readSurfaces[surfaceId].registered = true;
	invalidateReadCache(surfaceId);
}

const VDP::VramSlot& VDP::getReadSurface(uint32_t surfaceId) const {
	const ReadSurface& surface = m_readSurfaces[surfaceId];
	if (!surface.registered) {
		throw vdpFault("read surface " + std::to_string(surfaceId) + " is not registered.");
	}
	return getVramSlotBySurfaceId(surface.surfaceId);
}

void VDP::clearSurfaceUploadDirty(uint32_t surfaceId) {
	auto& slot = getVramSlotBySurfaceId(surfaceId);
	for (uint32_t row = slot.dirtyRowStart; row < slot.dirtyRowEnd; ++row) {
		slot.dirtySpansByRow[row] = VramSlot::DirtySpan{};
	}
	slot.dirtyRowStart = 0;
	slot.dirtyRowEnd = 0;
}

void VDP::invalidateReadCache(uint32_t surfaceId) {
	m_readCaches[surfaceId].width = 0;
}

// start hot-path -- VDP read cache feeds CPU-side MMIO readback one pixel at a time.
VDP::ReadCache& VDP::getReadCache(uint32_t surfaceId, const VramSlot& surface, uint32_t x, uint32_t y) {
	auto& cache = m_readCaches[surfaceId];
	if (cache.width == 0 || cache.y != y || x < cache.x0 || x >= cache.x0 + cache.width) {
		prefetchReadCache(surfaceId, surface, x, y);
	}
	return cache;
}

// start numeric-sanitization-acceptable -- readback chunk width is the minimum of hardware cap, remaining surface span, and per-frame read budget.
void VDP::prefetchReadCache(uint32_t surfaceId, const VramSlot& surface, uint32_t x, uint32_t y) {
	const uint32_t maxPixelsByBudget = m_readBudgetBytes / 4u;
	if (maxPixelsByBudget == 0) {
		m_readOverflow = true;
		m_readCaches[surfaceId].width = 0;
		return;
	}
	const uint32_t chunkW = std::min(VDP_RD_MAX_CHUNK_PIXELS, std::min(surface.surfaceWidth - x, maxPixelsByBudget));
	auto& cache = m_readCaches[surfaceId];
	readSurfacePixels(surface, x, y, chunkW, 1, cache.data);
	cache.x0 = x;
	cache.y = y;
	cache.width = chunkW;
}
// end numeric-sanitization-acceptable

void VDP::readSurfacePixels(const VramSlot& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height, std::vector<u8>& out) {
	out.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	const uint32_t stride = surface.surfaceWidth * 4u;
	const uint32_t rowBytes = width * 4u;
	for (uint32_t row = 0; row < height; ++row) {
		const size_t srcOffset = static_cast<size_t>(y + row) * static_cast<size_t>(stride) + static_cast<size_t>(x) * 4u;
		const size_t dstOffset = static_cast<size_t>(row) * static_cast<size_t>(rowBytes);
		std::memcpy(out.data() + dstOffset, surface.cpuReadback.data() + srcOffset, rowBytes);
	}
}
// end hot-path

} // namespace bmsx
