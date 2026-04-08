#include "geometry_controller.h"

#include "../io.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace bmsx {
namespace {

constexpr uint32_t GEO_RECORD_INDEX_NONE = 0xffffu;
constexpr uint32_t WORD_ALIGN_MASK = 3u;
constexpr uint32_t XFORM2_JOB_WORDS = 6u;
constexpr uint32_t XFORM2_JOB_BYTES = XFORM2_JOB_WORDS * 4u;
constexpr uint32_t XFORM2_VERTEX_BYTES = 8u;
constexpr uint32_t XFORM2_MATRIX_WORDS = 6u;
constexpr uint32_t XFORM2_MATRIX_BYTES = XFORM2_MATRIX_WORDS * 4u;
constexpr uint32_t XFORM2_AABB_BYTES = 16u;
constexpr uint32_t SAT2_PAIR_WORDS = 5u;
constexpr uint32_t SAT2_PAIR_BYTES = SAT2_PAIR_WORDS * 4u;
constexpr uint32_t SAT2_DESC_WORDS = 4u;
constexpr uint32_t SAT2_DESC_BYTES = SAT2_DESC_WORDS * 4u;
constexpr uint32_t SAT2_RESULT_WORDS = 5u;
constexpr uint32_t SAT2_RESULT_BYTES = SAT2_RESULT_WORDS * 4u;
constexpr int FIX16_SHIFT = 16;
constexpr double FIX16_SCALE = 65536.0;

inline int32_t saturateI32(int64_t value) {
	if (value < static_cast<int64_t>(std::numeric_limits<int32_t>::min())) {
		return std::numeric_limits<int32_t>::min();
	}
	if (value > static_cast<int64_t>(std::numeric_limits<int32_t>::max())) {
		return std::numeric_limits<int32_t>::max();
	}
	return static_cast<int32_t>(value);
}

inline int64_t saturatingAdd64(int64_t lhs, int64_t rhs) {
	if (rhs > 0 && lhs > (std::numeric_limits<int64_t>::max() - rhs)) {
		return std::numeric_limits<int64_t>::max();
	}
	if (rhs < 0 && lhs < (std::numeric_limits<int64_t>::min() - rhs)) {
		return std::numeric_limits<int64_t>::min();
	}
	return lhs + rhs;
}

} // namespace

GeometryController::GeometryController(Memory& memory, std::function<void(uint32_t)> raiseIrq)
	: m_memory(memory)
	, m_raiseIrq(std::move(raiseIrq)) {}

void GeometryController::setWorkBudget(uint32_t workUnits) {
	m_workBudget = workUnits;
}

bool GeometryController::hasPendingWork() const {
	return m_activeJob.has_value();
}

uint32_t GeometryController::pendingWorkUnits() const {
	if (!m_activeJob.has_value()) {
		return 0u;
	}
	return m_activeJob->count - m_activeJob->processed;
}

void GeometryController::reset() {
	m_workBudget = 0;
	m_activeJob.reset();
	writeRegister(IO_GEO_SRC0, 0);
	writeRegister(IO_GEO_SRC1, 0);
	writeRegister(IO_GEO_SRC2, 0);
	writeRegister(IO_GEO_DST0, 0);
	writeRegister(IO_GEO_DST1, 0);
	writeRegister(IO_GEO_COUNT, 0);
	writeRegister(IO_GEO_CMD, 0);
	writeRegister(IO_GEO_CTRL, 0);
	writeRegister(IO_GEO_STATUS, 0);
	writeRegister(IO_GEO_PARAM0, 0);
	writeRegister(IO_GEO_PARAM1, 0);
	writeRegister(IO_GEO_STRIDE0, 0);
	writeRegister(IO_GEO_STRIDE1, 0);
	writeRegister(IO_GEO_STRIDE2, 0);
	writeRegister(IO_GEO_PROCESSED, 0);
	writeRegister(IO_GEO_FAULT, 0);
}

void GeometryController::normalizeAfterStateRestore() {
	m_workBudget = 0;
	m_activeJob.reset();
	const uint32_t ctrl = readRegister(IO_GEO_CTRL);
	const uint32_t status = readRegister(IO_GEO_STATUS);
	const uint32_t processed = readRegister(IO_GEO_PROCESSED);
	writeRegister(IO_GEO_CTRL, ctrl & ~(GEO_CTRL_START | GEO_CTRL_ABORT));
	if ((status & GEO_STATUS_BUSY) != 0u) {
		writeRegister(IO_GEO_STATUS, GEO_STATUS_DONE | GEO_STATUS_ERROR);
		writeRegister(IO_GEO_PROCESSED, processed);
		writeRegister(IO_GEO_FAULT, packFault(GEO_FAULT_ABORTED_BY_HOST, processed));
	}
}

void GeometryController::onCtrlWrite() {
	const uint32_t ctrl = readRegister(IO_GEO_CTRL);
	const bool start = (ctrl & GEO_CTRL_START) != 0u;
	const bool abort = (ctrl & GEO_CTRL_ABORT) != 0u;
	if (!start && !abort) {
		return;
	}
	writeRegister(IO_GEO_CTRL, ctrl & ~(GEO_CTRL_START | GEO_CTRL_ABORT));
	if (start && abort) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return;
	}
	if (abort) {
		if (m_activeJob.has_value()) {
			finishError(GEO_FAULT_ABORTED_BY_HOST, m_activeJob->processed);
		}
		return;
	}
	if (m_activeJob.has_value()) {
		finishRejected(GEO_FAULT_REJECT_BUSY);
		return;
	}
	tryStart();
}

void GeometryController::tick() {
	if (!m_activeJob.has_value() || m_workBudget == 0u) {
		return;
	}
	uint32_t remaining = m_workBudget;
	m_workBudget = 0;
	while (m_activeJob.has_value() && remaining > 0u) {
		switch (m_activeJob->cmd) {
			case IO_CMD_GEO_XFORM2_BATCH:
				processXform2Record(*m_activeJob);
				break;
			case IO_CMD_GEO_SAT2_BATCH:
				processSat2Record(*m_activeJob);
				break;
			default:
				finishRejected(GEO_FAULT_REJECT_BAD_CMD);
				return;
		}
		remaining -= 1u;
	}
}

void GeometryController::tryStart() {
	GeoJob job;
	job.cmd = readRegister(IO_GEO_CMD);
	job.src0 = readRegister(IO_GEO_SRC0);
	job.src1 = readRegister(IO_GEO_SRC1);
	job.src2 = readRegister(IO_GEO_SRC2);
	job.dst0 = readRegister(IO_GEO_DST0);
	job.dst1 = readRegister(IO_GEO_DST1);
	job.count = readRegister(IO_GEO_COUNT);
	job.param0 = readRegister(IO_GEO_PARAM0);
	job.param1 = readRegister(IO_GEO_PARAM1);
	job.stride0 = readRegister(IO_GEO_STRIDE0);
	job.stride1 = readRegister(IO_GEO_STRIDE1);
	job.stride2 = readRegister(IO_GEO_STRIDE2);
	switch (job.cmd) {
		case IO_CMD_GEO_XFORM2_BATCH:
			if (!validateXform2Submission(job)) {
				return;
			}
			break;
		case IO_CMD_GEO_SAT2_BATCH:
			if (!validateSat2Submission(job)) {
				return;
			}
			break;
		default:
			finishRejected(GEO_FAULT_REJECT_BAD_CMD);
			return;
	}
	writeRegister(IO_GEO_STATUS, 0u);
	writeRegister(IO_GEO_PROCESSED, 0u);
	writeRegister(IO_GEO_FAULT, 0u);
	if (job.count == 0u) {
		finishSuccess(0u);
		return;
	}
	m_activeJob = job;
	writeRegister(IO_GEO_STATUS, GEO_STATUS_BUSY);
}

bool GeometryController::validateXform2Submission(const GeoJob& job) {
	if (job.param0 != 0u || job.param1 != 0u) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (job.stride0 != XFORM2_JOB_BYTES || job.stride1 != XFORM2_VERTEX_BYTES || job.stride2 != XFORM2_MATRIX_BYTES) {
		finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
		return false;
	}
	if ((job.src0 & WORD_ALIGN_MASK) != 0u
		|| (job.src1 & WORD_ALIGN_MASK) != 0u
		|| (job.src2 & WORD_ALIGN_MASK) != 0u
		|| (job.dst0 & WORD_ALIGN_MASK) != 0u
		|| (job.dst1 & WORD_ALIGN_MASK) != 0u) {
		finishRejected(GEO_FAULT_REJECT_MISALIGNED_REGS);
		return false;
	}
	if (job.count == 0u) {
		return true;
	}
	if (!m_memory.isReadableMainMemoryRange(job.src0, job.stride0)
		|| !m_memory.isReadableMainMemoryRange(job.src1, job.stride1)
		|| !m_memory.isReadableMainMemoryRange(job.src2, job.stride2)) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (!m_memory.isRamRange(job.dst0, XFORM2_VERTEX_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	if (job.dst1 != 0u && !m_memory.isRamRange(job.dst1, 4u)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	return true;
}

bool GeometryController::validateSat2Submission(const GeoJob& job) {
	if (job.param0 != 0u || job.param1 != 0u || job.dst1 != 0u) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (job.stride0 != SAT2_PAIR_BYTES || job.stride1 != SAT2_DESC_BYTES || job.stride2 != XFORM2_VERTEX_BYTES) {
		finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
		return false;
	}
	if ((job.src0 & WORD_ALIGN_MASK) != 0u
		|| (job.src1 & WORD_ALIGN_MASK) != 0u
		|| (job.src2 & WORD_ALIGN_MASK) != 0u
		|| (job.dst0 & WORD_ALIGN_MASK) != 0u) {
		finishRejected(GEO_FAULT_REJECT_MISALIGNED_REGS);
		return false;
	}
	if (job.count == 0u) {
		return true;
	}
	if (!m_memory.isReadableMainMemoryRange(job.src0, job.stride0)
		|| !m_memory.isReadableMainMemoryRange(job.src1, job.stride1)
		|| !m_memory.isReadableMainMemoryRange(job.src2, job.stride2)) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (!m_memory.isRamRange(job.dst0, SAT2_RESULT_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	return true;
}

void GeometryController::processXform2Record(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	const std::optional<uint32_t> recordAddr = resolveIndexedSpan(job.src0, recordIndex, job.stride0, XFORM2_JOB_BYTES);
	if (!recordAddr.has_value()) {
		finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*recordAddr, XFORM2_JOB_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t flags = m_memory.readU32(*recordAddr + 0u);
	const uint32_t srcIndex = m_memory.readU32(*recordAddr + 4u);
	const uint32_t dstIndex = m_memory.readU32(*recordAddr + 8u);
	const uint32_t auxIndex = m_memory.readU32(*recordAddr + 12u);
	const uint32_t vertexCount = m_memory.readU32(*recordAddr + 16u);
	const uint32_t dst1Index = m_memory.readU32(*recordAddr + 20u);
	if (flags != 0u) {
		finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
		return;
	}
	if (vertexCount == 0u) {
		completeRecord(job);
		return;
	}
	if (vertexCount > (std::numeric_limits<uint32_t>::max() / XFORM2_VERTEX_BYTES)) {
		finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
		return;
	}
	const uint32_t vertexBytes = vertexCount * XFORM2_VERTEX_BYTES;
	const std::optional<uint32_t> srcAddr = resolveIndexedSpan(job.src1, srcIndex, job.stride1, vertexBytes);
	if (!srcAddr.has_value() || !m_memory.isReadableMainMemoryRange(*srcAddr, vertexBytes)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> matrixAddr = resolveIndexedSpan(job.src2, auxIndex, job.stride2, XFORM2_MATRIX_BYTES);
	if (!matrixAddr.has_value() || !m_memory.isReadableMainMemoryRange(*matrixAddr, XFORM2_MATRIX_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> dstAddr = resolveIndexedSpan(job.dst0, dstIndex, XFORM2_VERTEX_BYTES, vertexBytes);
	if (!dstAddr.has_value() || !m_memory.isRamRange(*dstAddr, vertexBytes)) {
		finishError(GEO_FAULT_DST_RANGE, recordIndex);
		return;
	}
	uint32_t aabbAddr = 0u;
	if (dst1Index != GEO_INDEX_NONE) {
		const std::optional<uint32_t> resolvedAabbAddr = resolveIndexedSpan(job.dst1, dst1Index, XFORM2_AABB_BYTES, XFORM2_AABB_BYTES);
		if (!resolvedAabbAddr.has_value() || !m_memory.isRamRange(*resolvedAabbAddr, XFORM2_AABB_BYTES)) {
			finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return;
		}
		aabbAddr = *resolvedAabbAddr;
	}
	const int32_t m00 = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 0u));
	const int32_t m01 = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 4u));
	const int32_t tx = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 8u));
	const int32_t m10 = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 12u));
	const int32_t m11 = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 16u));
	const int32_t ty = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 20u));
	int32_t minX = 0;
	int32_t minY = 0;
	int32_t maxX = 0;
	int32_t maxY = 0;
	for (uint32_t vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1u) {
		const uint32_t localAddr = *srcAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		const uint32_t worldAddr = *dstAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		const int32_t localX = static_cast<int32_t>(m_memory.readU32(localAddr + 0u));
		const int32_t localY = static_cast<int32_t>(m_memory.readU32(localAddr + 4u));
		const int32_t worldX = transformFixed16(m00, m01, tx, localX, localY);
		const int32_t worldY = transformFixed16(m10, m11, ty, localX, localY);
		m_memory.writeU32(worldAddr + 0u, static_cast<uint32_t>(worldX));
		m_memory.writeU32(worldAddr + 4u, static_cast<uint32_t>(worldY));
		if (vertexIndex == 0u) {
			minX = worldX;
			minY = worldY;
			maxX = worldX;
			maxY = worldY;
			continue;
		}
		if (worldX < minX) {
			minX = worldX;
		}
		if (worldY < minY) {
			minY = worldY;
		}
		if (worldX > maxX) {
			maxX = worldX;
		}
		if (worldY > maxY) {
			maxY = worldY;
		}
	}
	if (dst1Index != GEO_INDEX_NONE) {
		m_memory.writeU32(aabbAddr + 0u, static_cast<uint32_t>(minX));
		m_memory.writeU32(aabbAddr + 4u, static_cast<uint32_t>(minY));
		m_memory.writeU32(aabbAddr + 8u, static_cast<uint32_t>(maxX));
		m_memory.writeU32(aabbAddr + 12u, static_cast<uint32_t>(maxY));
	}
	completeRecord(job);
}

void GeometryController::processSat2Record(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	const std::optional<uint32_t> pairAddr = resolveIndexedSpan(job.src0, recordIndex, job.stride0, SAT2_PAIR_BYTES);
	if (!pairAddr.has_value()) {
		finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*pairAddr, SAT2_PAIR_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t flags = m_memory.readU32(*pairAddr + 0u);
	const uint32_t shapeAIndex = m_memory.readU32(*pairAddr + 4u);
	const uint32_t resultIndex = m_memory.readU32(*pairAddr + 8u);
	const uint32_t shapeBIndex = m_memory.readU32(*pairAddr + 12u);
	const uint32_t pairFlags = m_memory.readU32(*pairAddr + 16u);
	if (flags != 0u || pairFlags != 0u) {
		finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
		return;
	}
	const std::optional<uint32_t> resultAddr = resolveIndexedSpan(job.dst0, resultIndex, SAT2_RESULT_BYTES, SAT2_RESULT_BYTES);
	if (!resultAddr.has_value() || !m_memory.isRamRange(*resultAddr, SAT2_RESULT_BYTES)) {
		finishError(GEO_FAULT_DST_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> shapeADescAddr = resolveIndexedSpan(job.src1, shapeAIndex, job.stride1, SAT2_DESC_BYTES);
	const std::optional<uint32_t> shapeBDescAddr = resolveIndexedSpan(job.src1, shapeBIndex, job.stride1, SAT2_DESC_BYTES);
	if (!shapeADescAddr.has_value() || !shapeBDescAddr.has_value()) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*shapeADescAddr, SAT2_DESC_BYTES)
		|| !m_memory.isReadableMainMemoryRange(*shapeBDescAddr, SAT2_DESC_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t shapeAFlags = m_memory.readU32(*shapeADescAddr + 0u);
	const uint32_t shapeAVertexCount = m_memory.readU32(*shapeADescAddr + 4u);
	const uint32_t shapeAVertexOffsetBytes = m_memory.readU32(*shapeADescAddr + 8u);
	const uint32_t shapeAReserved = m_memory.readU32(*shapeADescAddr + 12u);
	const uint32_t shapeBFlags = m_memory.readU32(*shapeBDescAddr + 0u);
	const uint32_t shapeBVertexCount = m_memory.readU32(*shapeBDescAddr + 4u);
	const uint32_t shapeBVertexOffsetBytes = m_memory.readU32(*shapeBDescAddr + 8u);
	const uint32_t shapeBReserved = m_memory.readU32(*shapeBDescAddr + 12u);
	if (shapeAFlags != GEO_SHAPE_CONVEX_POLY
		|| shapeBFlags != GEO_SHAPE_CONVEX_POLY
		|| shapeAReserved != 0u
		|| shapeBReserved != 0u) {
		finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
		return;
	}
	if (shapeAVertexCount < 3u || shapeBVertexCount < 3u) {
		finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
		return;
	}
	if ((shapeAVertexOffsetBytes & WORD_ALIGN_MASK) != 0u || (shapeBVertexOffsetBytes & WORD_ALIGN_MASK) != 0u) {
		finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
		return;
	}
	if (shapeAVertexCount > (std::numeric_limits<uint32_t>::max() / XFORM2_VERTEX_BYTES)
		|| shapeBVertexCount > (std::numeric_limits<uint32_t>::max() / XFORM2_VERTEX_BYTES)) {
		finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
		return;
	}
	const uint32_t shapeAVertexBytes = shapeAVertexCount * XFORM2_VERTEX_BYTES;
	const uint32_t shapeBVertexBytes = shapeBVertexCount * XFORM2_VERTEX_BYTES;
	const std::optional<uint32_t> shapeAVertexAddr = resolveIndexedSpan(job.src2, shapeAVertexOffsetBytes, 1u, shapeAVertexBytes);
	const std::optional<uint32_t> shapeBVertexAddr = resolveIndexedSpan(job.src2, shapeBVertexOffsetBytes, 1u, shapeBVertexBytes);
	if (!shapeAVertexAddr.has_value() || !shapeBVertexAddr.has_value()) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*shapeAVertexAddr, shapeAVertexBytes)
		|| !m_memory.isReadableMainMemoryRange(*shapeBVertexAddr, shapeBVertexBytes)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	double centerAX = 0.0;
	double centerAY = 0.0;
	for (uint32_t vertexIndex = 0; vertexIndex < shapeAVertexCount; vertexIndex += 1u) {
		const uint32_t vertexAddr = *shapeAVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		centerAX += static_cast<int32_t>(m_memory.readU32(vertexAddr + 0u));
		centerAY += static_cast<int32_t>(m_memory.readU32(vertexAddr + 4u));
	}
	double centerBX = 0.0;
	double centerBY = 0.0;
	for (uint32_t vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1u) {
		const uint32_t vertexAddr = *shapeBVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		centerBX += static_cast<int32_t>(m_memory.readU32(vertexAddr + 0u));
		centerBY += static_cast<int32_t>(m_memory.readU32(vertexAddr + 4u));
	}
	centerAX /= static_cast<double>(shapeAVertexCount);
	centerAY /= static_cast<double>(shapeAVertexCount);
	centerBX /= static_cast<double>(shapeBVertexCount);
	centerBY /= static_cast<double>(shapeBVertexCount);
	double bestOverlap = std::numeric_limits<double>::infinity();
	double bestAxisX = 0.0;
	double bestAxisY = 0.0;
	uint32_t bestAxisIndex = 0u;
	uint32_t bestShapeSelector = GEO_SAT_META_SHAPE_SRC;
	bool sawAxis = false;
	for (uint32_t shapeSelector = GEO_SAT_META_SHAPE_SRC; shapeSelector <= GEO_SAT_META_SHAPE_AUX; shapeSelector += 1u) {
		const uint32_t axisBase = shapeSelector == GEO_SAT_META_SHAPE_SRC ? *shapeAVertexAddr : *shapeBVertexAddr;
		const uint32_t axisCount = shapeSelector == GEO_SAT_META_SHAPE_SRC ? shapeAVertexCount : shapeBVertexCount;
		for (uint32_t edgeIndex = 0; edgeIndex < axisCount; edgeIndex += 1u) {
			const uint32_t currentAddr = axisBase + edgeIndex * XFORM2_VERTEX_BYTES;
			const uint32_t nextIndex = edgeIndex + 1u == axisCount ? 0u : edgeIndex + 1u;
			const uint32_t nextAddr = axisBase + nextIndex * XFORM2_VERTEX_BYTES;
			const double x0 = static_cast<int32_t>(m_memory.readU32(currentAddr + 0u));
			const double y0 = static_cast<int32_t>(m_memory.readU32(currentAddr + 4u));
			const double x1 = static_cast<int32_t>(m_memory.readU32(nextAddr + 0u));
			const double y1 = static_cast<int32_t>(m_memory.readU32(nextAddr + 4u));
			const double nx = -(y1 - y0);
			const double ny = x1 - x0;
			const double axisLength = std::sqrt((nx * nx) + (ny * ny));
			if (!(axisLength > 0.0)) {
				continue;
			}
			sawAxis = true;
			const double ax = nx / axisLength;
			const double ay = ny / axisLength;
			double minA = std::numeric_limits<double>::infinity();
			double maxA = -std::numeric_limits<double>::infinity();
			for (uint32_t vertexIndex = 0; vertexIndex < shapeAVertexCount; vertexIndex += 1u) {
				const uint32_t vertexAddr = *shapeAVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
				const double px = static_cast<int32_t>(m_memory.readU32(vertexAddr + 0u));
				const double py = static_cast<int32_t>(m_memory.readU32(vertexAddr + 4u));
				const double projection = (px * ax) + (py * ay);
				if (projection < minA) {
					minA = projection;
				}
				if (projection > maxA) {
					maxA = projection;
				}
			}
			double minB = std::numeric_limits<double>::infinity();
			double maxB = -std::numeric_limits<double>::infinity();
			for (uint32_t vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1u) {
				const uint32_t vertexAddr = *shapeBVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
				const double px = static_cast<int32_t>(m_memory.readU32(vertexAddr + 0u));
				const double py = static_cast<int32_t>(m_memory.readU32(vertexAddr + 4u));
				const double projection = (px * ax) + (py * ay);
				if (projection < minB) {
					minB = projection;
				}
				if (projection > maxB) {
					maxB = projection;
				}
			}
			const double sepA = minA - maxB;
			const double sepB = minB - maxA;
			if (sepA > 0.0 || sepB > 0.0) {
				writeSat2Result(*resultAddr, 0u, 0, 0, 0, 0u);
				completeRecord(job);
				return;
			}
			const double overlap = std::min(maxA, maxB) - std::max(minA, minB);
			if (overlap < bestOverlap) {
				bestOverlap = overlap;
				bestAxisX = ax;
				bestAxisY = ay;
				bestAxisIndex = edgeIndex;
				bestShapeSelector = shapeSelector;
			}
		}
	}
	if (!sawAxis) {
		finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
		return;
	}
	if (!std::isfinite(bestOverlap) || !std::isfinite(bestAxisX) || !std::isfinite(bestAxisY)) {
		finishError(GEO_FAULT_NUMERIC_OVERFLOW_INTERNAL, recordIndex);
		return;
	}
	const double deltaX = centerBX - centerAX;
	const double deltaY = centerBY - centerAY;
	if (((deltaX * bestAxisX) + (deltaY * bestAxisY)) < 0.0) {
		bestAxisX = -bestAxisX;
		bestAxisY = -bestAxisY;
	}
	writeSat2Result(
		*resultAddr,
		1u,
		roundToI32Clamped(bestAxisX * FIX16_SCALE),
		roundToI32Clamped(bestAxisY * FIX16_SCALE),
		roundToI32Clamped(bestOverlap),
		packSat2Meta(bestAxisIndex, bestShapeSelector)
	);
	completeRecord(job);
}

void GeometryController::completeRecord(GeoJob& job) {
	job.processed += 1u;
	writeRegister(IO_GEO_PROCESSED, job.processed);
	if (job.processed >= job.count) {
		finishSuccess(job.processed);
	}
}

void GeometryController::finishSuccess(uint32_t processed) {
	m_activeJob.reset();
	writeRegister(IO_GEO_STATUS, GEO_STATUS_DONE);
	writeRegister(IO_GEO_PROCESSED, processed);
	writeRegister(IO_GEO_FAULT, 0u);
	m_raiseIrq(IRQ_GEO_DONE);
}

void GeometryController::finishError(uint32_t code, uint32_t recordIndex, bool signalIrq) {
	m_activeJob.reset();
	writeRegister(IO_GEO_STATUS, GEO_STATUS_DONE | GEO_STATUS_ERROR);
	writeRegister(IO_GEO_FAULT, packFault(code, recordIndex));
	if (signalIrq) {
		m_raiseIrq(IRQ_GEO_ERROR);
	}
}

void GeometryController::finishRejected(uint32_t code) {
	m_activeJob.reset();
	writeRegister(IO_GEO_STATUS, GEO_STATUS_REJECTED);
	writeRegister(IO_GEO_PROCESSED, 0u);
	writeRegister(IO_GEO_FAULT, packFault(code, GEO_RECORD_INDEX_NONE));
}

std::optional<uint32_t> GeometryController::resolveIndexedSpan(uint32_t base, uint32_t index, uint32_t stride, uint32_t byteLength) const {
	const uint64_t offset = static_cast<uint64_t>(index) * static_cast<uint64_t>(stride);
	if (offset > std::numeric_limits<uint32_t>::max()) {
		return std::nullopt;
	}
	const uint64_t addr = static_cast<uint64_t>(base) + offset;
	if (addr > std::numeric_limits<uint32_t>::max()) {
		return std::nullopt;
	}
	const uint64_t end = addr + byteLength;
	if (end > (static_cast<uint64_t>(std::numeric_limits<uint32_t>::max()) + 1ull)) {
		return std::nullopt;
	}
	return static_cast<uint32_t>(addr);
}

uint32_t GeometryController::readRegister(uint32_t addr) const {
	return static_cast<uint32_t>(asNumber(m_memory.readValue(addr)));
}

void GeometryController::writeRegister(uint32_t addr, uint32_t value) {
	m_memory.writeValue(addr, valueNumber(static_cast<double>(value)));
}

void GeometryController::writeSat2Result(uint32_t addr, uint32_t hit, int32_t nx, int32_t ny, int32_t depth, uint32_t meta) {
	m_memory.writeU32(addr + 0u, hit);
	m_memory.writeU32(addr + 4u, static_cast<uint32_t>(nx));
	m_memory.writeU32(addr + 8u, static_cast<uint32_t>(ny));
	m_memory.writeU32(addr + 12u, static_cast<uint32_t>(depth));
	m_memory.writeU32(addr + 16u, meta);
}

uint32_t GeometryController::packFault(uint32_t code, uint32_t recordIndex) {
	return ((code & 0xffffu) << 16u) | (recordIndex & 0xffffu);
}

uint32_t GeometryController::packSat2Meta(uint32_t axisIndex, uint32_t shapeSelector) {
	return ((shapeSelector & 0xffffu) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & GEO_SAT_META_AXIS_MASK);
}

int32_t GeometryController::roundToI32Clamped(double value) {
	if (value <= static_cast<double>(std::numeric_limits<int32_t>::min())) {
		return std::numeric_limits<int32_t>::min();
	}
	if (value >= static_cast<double>(std::numeric_limits<int32_t>::max())) {
		return std::numeric_limits<int32_t>::max();
	}
	return static_cast<int32_t>(std::llround(value));
}

int32_t GeometryController::transformFixed16(int32_t m0, int32_t m1, int32_t tx, int32_t x, int32_t y) {
	int64_t accum = 0;
	accum = saturatingAdd64(accum, static_cast<int64_t>(m0) * static_cast<int64_t>(x));
	accum = saturatingAdd64(accum, static_cast<int64_t>(m1) * static_cast<int64_t>(y));
	accum = saturatingAdd64(accum, static_cast<int64_t>(tx) * (static_cast<int64_t>(1) << FIX16_SHIFT));
	return saturateI32(accum >> FIX16_SHIFT);
}

} // namespace bmsx
