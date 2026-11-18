#include "machine/devices/geometry/xform2.h"

#include "machine/common/numeric.h"
#include "machine/devices/geometry/addressing.h"
#include "machine/devices/geometry/contracts.h"

namespace bmsx {
GeometryXform2Unit::GeometryXform2Unit(Memory& memory)
	: m_memory(memory) {
}

void GeometryXform2Unit::processStep(GeometryJobState& job) {
	auto& p = m_progress;
	p.pendingMemory = {};
	p.pendingWorkUnits = 0u;
	if (p.phase == static_cast<u32>(GeometryXform2Phase::Record)) {
		const uint32_t recordAddr = geometryIndexedAddr(job.src0, job.processed, job.stride0);
		if (!geometryIndexedSpanFits(job.src0, job.processed, job.stride0, GEO_XFORM2_RECORD_BYTES)) {
			p.pendingFault = GEO_FAULT_BAD_RECORD_ALIGNMENT;
			p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
			return;
		}
		if (!m_memory.isReadableMainMemoryRange(recordAddr, GEO_XFORM2_RECORD_BYTES)) {
			p.pendingFault = GEO_FAULT_SRC_RANGE;
			p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
			return;
		}
		const uint32_t flags = m_memory.readCountedU32(recordAddr + GEO_XFORM2_RECORD_FLAGS_OFFSET, p.pendingMemory);
		const uint32_t srcIndex = m_memory.readCountedU32(recordAddr + GEO_XFORM2_RECORD_SRC_INDEX_OFFSET, p.pendingMemory);
		const uint32_t dstIndex = m_memory.readCountedU32(recordAddr + GEO_XFORM2_RECORD_DST_INDEX_OFFSET, p.pendingMemory);
		const uint32_t auxIndex = m_memory.readCountedU32(recordAddr + GEO_XFORM2_RECORD_AUX_INDEX_OFFSET, p.pendingMemory);
		const uint32_t vertexCount = m_memory.readCountedU32(recordAddr + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, p.pendingMemory);
		const uint32_t dst1Index = m_memory.readCountedU32(recordAddr + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, p.pendingMemory);
		if (flags != 0u) {
			p.pendingFault = GEO_FAULT_BAD_RECORD_FLAGS;
			p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
			return;
		}
		if (vertexCount == 0u) {
			p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
			return;
		}
		if (vertexCount > GEO_XFORM2_MAX_VERTICES) {
			p.pendingFault = GEO_FAULT_BAD_VERTEX_COUNT;
			p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
			return;
		}
		const uint32_t vertexBytes = vertexCount * GEO_VERTEX2_BYTES;
		const uint32_t srcAddr = geometryIndexedAddr(job.src1, srcIndex, job.stride1);
		if (!geometryIndexedSpanFits(job.src1, srcIndex, job.stride1, vertexBytes)
			|| !m_memory.isReadableMainMemoryRange(srcAddr, vertexBytes)) {
			p.pendingFault = GEO_FAULT_SRC_RANGE;
			p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
			return;
		}
		const uint32_t matrixAddr = geometryIndexedAddr(job.src2, auxIndex, job.stride2);
		if (!geometryIndexedSpanFits(job.src2, auxIndex, job.stride2, GEO_XFORM2_MATRIX_BYTES)
			|| !m_memory.isReadableMainMemoryRange(matrixAddr, GEO_XFORM2_MATRIX_BYTES)) {
			p.pendingFault = GEO_FAULT_SRC_RANGE;
			p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
			return;
		}
		const uint32_t dstAddr = geometryIndexedAddr(job.dst0, dstIndex, GEO_VERTEX2_BYTES);
		if (!geometryIndexedSpanFits(job.dst0, dstIndex, GEO_VERTEX2_BYTES, vertexBytes)
			|| !m_memory.isRamRange(dstAddr, vertexBytes)) {
			p.pendingFault = GEO_FAULT_DST_RANGE;
			p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
			return;
		}
		uint32_t aabbAddr = 0u;
		if (dst1Index != GEO_INDEX_NONE) {
			aabbAddr = geometryIndexedAddr(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES);
			if (!geometryIndexedSpanFits(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES, GEO_XFORM2_AABB_BYTES)
				|| !m_memory.isRamRange(aabbAddr, GEO_XFORM2_AABB_BYTES)) {
				p.pendingFault = GEO_FAULT_DST_RANGE;
				p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
				return;
			}
		}
		p.dstAddress = dstAddr;
		p.boundsAddress = aabbAddr;
		p.vertexCount = vertexCount;
		p.hasBounds = dst1Index != GEO_INDEX_NONE;
		const i32 m00 = toSignedWord(m_memory.readCountedU32(matrixAddr + GEO_XFORM2_MATRIX_M00_OFFSET, p.pendingMemory));
		const i32 m01 = toSignedWord(m_memory.readCountedU32(matrixAddr + GEO_XFORM2_MATRIX_M01_OFFSET, p.pendingMemory));
		const i32 tx = toSignedWord(m_memory.readCountedU32(matrixAddr + GEO_XFORM2_MATRIX_TX_OFFSET, p.pendingMemory));
		const i32 m10 = toSignedWord(m_memory.readCountedU32(matrixAddr + GEO_XFORM2_MATRIX_M10_OFFSET, p.pendingMemory));
		const i32 m11 = toSignedWord(m_memory.readCountedU32(matrixAddr + GEO_XFORM2_MATRIX_M11_OFFSET, p.pendingMemory));
		const i32 ty = toSignedWord(m_memory.readCountedU32(matrixAddr + GEO_XFORM2_MATRIX_TY_OFFSET, p.pendingMemory));
		for (u32 i = 0; i < vertexCount * 2u; ++i) {
			p.vertices[i] = m_memory.readCountedU32(srcAddr + i * 4u, p.pendingMemory);
		}
		for (u32 i = 0; i < vertexCount; ++i) {
			const i32 x = toSignedWord(p.vertices[i * 2u]), y = toSignedWord(p.vertices[i * 2u + 1u]);
			const u32 worldX = static_cast<u32>(transformFixed16(m00, m01, tx, x, y));
			const u32 worldY = static_cast<u32>(transformFixed16(m10, m11, ty, x, y));
			p.vertices[i * 2u] = worldX;
			p.vertices[i * 2u + 1u] = worldY;
			if (i == 0u) {
				p.bounds = {worldX, worldY, worldX, worldY};
			} else {
				if (toSignedWord(worldX) < toSignedWord(p.bounds[0])) p.bounds[0] = worldX;
				if (toSignedWord(worldY) < toSignedWord(p.bounds[1])) p.bounds[1] = worldY;
				if (toSignedWord(worldX) > toSignedWord(p.bounds[2])) p.bounds[2] = worldX;
				if (toSignedWord(worldY) > toSignedWord(p.bounds[3])) p.bounds[3] = worldY;
			}
		}
		p.pendingMemory.ramWords += vertexCount * 2u + (p.hasBounds ? 4u : 0u);
		p.pendingWorkUnits = vertexCount;
		p.phase = static_cast<u32>(GeometryXform2Phase::Publish);
		return;
	}
	if (p.phase == static_cast<u32>(GeometryXform2Phase::Publish)) {
		for (u32 i = 0; i < p.vertexCount * 2u; ++i) m_memory.writeU32(p.dstAddress + i * 4u, p.vertices[i]);
		if (p.hasBounds) for (u32 i = 0; i < 4u; ++i) m_memory.writeU32(p.boundsAddress + i * 4u, p.bounds[i]);
		p.phase = static_cast<u32>(GeometryXform2Phase::Complete);
	}
}

} // namespace bmsx
