import {
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_SRC_RANGE,
	GEO_INDEX_NONE,
	GEO_VERTEX2_BYTES,
	GEO_XFORM2_AABB_BYTES,
	GEO_XFORM2_MATRIX_BYTES,
	GEO_XFORM2_RECORD_AUX_INDEX_OFFSET,
	GEO_XFORM2_RECORD_BYTES,
	GEO_XFORM2_RECORD_DST1_INDEX_OFFSET,
	GEO_XFORM2_RECORD_DST_INDEX_OFFSET,
	GEO_XFORM2_RECORD_FLAGS_OFFSET,
	GEO_XFORM2_RECORD_SRC_INDEX_OFFSET,
	GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET,
	GEO_XFORM2_MAX_VERTICES,
} from './contracts';
import { geometryIndexedAddr, geometryIndexedSpanFits } from './addressing';
import type { GeometryJobState } from './job';
import type { Memory } from '../../memory/memory';
import type { MemoryWordCounters } from '../../memory/word_counters';
import { toSignedWord, transformFixed16 } from '../../common/numeric';

export enum GeometryXform2Phase { Record, Publish, Complete }

export type GeometryXform2Progress = {
	phase: GeometryXform2Phase;
	dstAddress: number; boundsAddress: number;
	vertexCount: number; hasBounds: boolean;
	vertices: Uint32Array; bounds: Uint32Array;
	pendingMemory: MemoryWordCounters; pendingWorkUnits: number; pendingFault: number;
};

export class GeometryXform2Unit {
	private readonly state: GeometryXform2Progress = {
		phase: GeometryXform2Phase.Record, dstAddress: 0, boundsAddress: 0,
		vertexCount: 0, hasBounds: false,
		vertices: new Uint32Array(GEO_XFORM2_MAX_VERTICES * 2), bounds: new Uint32Array(4),
		pendingMemory: { ramWords: 0, systemRomWords: 0, cartridgeWords: 0, otherWords: 0 },
		pendingWorkUnits: 0, pendingFault: 0,
	};
	public constructor(private readonly memory: Memory) {}
	public reset(): void {
		const p = this.state;
		p.phase = GeometryXform2Phase.Record;
		p.dstAddress = p.boundsAddress = p.vertexCount = 0;
		p.hasBounds = false;
		p.vertices.fill(0); p.bounds.fill(0);
		p.pendingMemory.ramWords = p.pendingMemory.systemRomWords = p.pendingMemory.cartridgeWords = p.pendingMemory.otherWords = 0;
		p.pendingWorkUnits = p.pendingFault = 0;
	}
	public beginJob(): void {
		const p = this.state;
		p.phase = GeometryXform2Phase.Record;
		p.pendingMemory.ramWords = p.pendingMemory.systemRomWords = p.pendingMemory.cartridgeWords = p.pendingMemory.otherWords = 0;
		p.pendingWorkUnits = p.pendingFault = 0;
	}
	public progress(): Readonly<GeometryXform2Progress> { return this.state; }
	public captureState(): GeometryXform2Progress {
		const p = this.state;
		return { ...p, vertices: p.vertices.slice(), bounds: p.bounds.slice(), pendingMemory: { ...p.pendingMemory } };
	}
	public restoreState(value: GeometryXform2Progress): void {
		const p = this.state;
		p.phase = value.phase; p.dstAddress = value.dstAddress; p.boundsAddress = value.boundsAddress;
		p.vertexCount = value.vertexCount; p.hasBounds = value.hasBounds;
		p.vertices.set(value.vertices); p.bounds.set(value.bounds);
		Object.assign(p.pendingMemory, value.pendingMemory);
		p.pendingWorkUnits = value.pendingWorkUnits; p.pendingFault = value.pendingFault;
	}
	public processStep(job: GeometryJobState): void {
		const p = this.state;
		p.pendingMemory.ramWords = p.pendingMemory.systemRomWords = p.pendingMemory.cartridgeWords = p.pendingMemory.otherWords = 0;
		p.pendingWorkUnits = 0;
		if (p.phase === GeometryXform2Phase.Record) {
			const recordIndex = job.processed;
			const recordAddr = geometryIndexedAddr(job.src0, recordIndex, job.stride0);
			if (!geometryIndexedSpanFits(job.src0, recordIndex, job.stride0, GEO_XFORM2_RECORD_BYTES)) {
				p.pendingFault = GEO_FAULT_BAD_RECORD_ALIGNMENT;
				p.phase = GeometryXform2Phase.Complete;
				return;
			}
			if (!this.memory.isReadableMainMemoryRange(recordAddr, GEO_XFORM2_RECORD_BYTES)) {
				p.pendingFault = GEO_FAULT_SRC_RANGE;
				p.phase = GeometryXform2Phase.Complete;
				return;
			}
			const flags = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_FLAGS_OFFSET, p.pendingMemory);
			const srcIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_SRC_INDEX_OFFSET, p.pendingMemory);
			const dstIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_DST_INDEX_OFFSET, p.pendingMemory);
			const auxIndex = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_AUX_INDEX_OFFSET, p.pendingMemory);
			const vertexCount = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, p.pendingMemory);
			const dst1Index = this.memory.readU32(recordAddr + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, p.pendingMemory);
			if (flags !== 0) {
				p.pendingFault = GEO_FAULT_BAD_RECORD_FLAGS;
				p.phase = GeometryXform2Phase.Complete;
				return;
			}
			if (vertexCount === 0) {
				p.phase = GeometryXform2Phase.Complete;
				return;
			}
			if (vertexCount > GEO_XFORM2_MAX_VERTICES) {
				p.pendingFault = GEO_FAULT_BAD_VERTEX_COUNT;
				p.phase = GeometryXform2Phase.Complete;
				return;
			}
			const vertexBytes = vertexCount * GEO_VERTEX2_BYTES;
			const srcAddr = geometryIndexedAddr(job.src1, srcIndex, job.stride1);
			if (!geometryIndexedSpanFits(job.src1, srcIndex, job.stride1, vertexBytes)
				|| !this.memory.isReadableMainMemoryRange(srcAddr, vertexBytes)) {
				p.pendingFault = GEO_FAULT_SRC_RANGE;
				p.phase = GeometryXform2Phase.Complete;
				return;
			}
			const matrixAddr = geometryIndexedAddr(job.src2, auxIndex, job.stride2);
			if (!geometryIndexedSpanFits(job.src2, auxIndex, job.stride2, GEO_XFORM2_MATRIX_BYTES)
				|| !this.memory.isReadableMainMemoryRange(matrixAddr, GEO_XFORM2_MATRIX_BYTES)) {
				p.pendingFault = GEO_FAULT_SRC_RANGE;
				p.phase = GeometryXform2Phase.Complete;
				return;
			}
			const dstAddr = geometryIndexedAddr(job.dst0, dstIndex, GEO_VERTEX2_BYTES);
			if (!geometryIndexedSpanFits(job.dst0, dstIndex, GEO_VERTEX2_BYTES, vertexBytes)
				|| !this.memory.isRamRange(dstAddr, vertexBytes)) {
				p.pendingFault = GEO_FAULT_DST_RANGE;
				p.phase = GeometryXform2Phase.Complete;
				return;
			}
			let aabbAddr = 0;
			if (dst1Index !== GEO_INDEX_NONE) {
				aabbAddr = geometryIndexedAddr(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES);
				if (!geometryIndexedSpanFits(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES, GEO_XFORM2_AABB_BYTES)
					|| !this.memory.isRamRange(aabbAddr, GEO_XFORM2_AABB_BYTES)) {
					p.pendingFault = GEO_FAULT_DST_RANGE;
					p.phase = GeometryXform2Phase.Complete;
					return;
				}
			}
			p.dstAddress = dstAddr; p.boundsAddress = aabbAddr;
			p.vertexCount = vertexCount; p.hasBounds = dst1Index !== GEO_INDEX_NONE;
			const m00 = toSignedWord(this.memory.readU32(matrixAddr, p.pendingMemory));
			const m01 = toSignedWord(this.memory.readU32(matrixAddr + 4, p.pendingMemory));
			const tx = toSignedWord(this.memory.readU32(matrixAddr + 8, p.pendingMemory));
			const m10 = toSignedWord(this.memory.readU32(matrixAddr + 12, p.pendingMemory));
			const m11 = toSignedWord(this.memory.readU32(matrixAddr + 16, p.pendingMemory));
			const ty = toSignedWord(this.memory.readU32(matrixAddr + 20, p.pendingMemory));
			for (let i = 0; i < vertexCount * 2; ++i) p.vertices[i] = this.memory.readU32(srcAddr + i * 4, p.pendingMemory);
			for (let i = 0; i < vertexCount; ++i) {
				const x = toSignedWord(p.vertices[i * 2]), y = toSignedWord(p.vertices[i * 2 + 1]);
				const worldX = transformFixed16(m00, m01, tx, x, y) >>> 0;
				const worldY = transformFixed16(m10, m11, ty, x, y) >>> 0;
				p.vertices[i * 2] = worldX; p.vertices[i * 2 + 1] = worldY;
				if (i === 0) {
					p.bounds[0] = p.bounds[2] = worldX; p.bounds[1] = p.bounds[3] = worldY;
				} else {
					if (toSignedWord(worldX) < toSignedWord(p.bounds[0])) p.bounds[0] = worldX;
					if (toSignedWord(worldY) < toSignedWord(p.bounds[1])) p.bounds[1] = worldY;
					if (toSignedWord(worldX) > toSignedWord(p.bounds[2])) p.bounds[2] = worldX;
					if (toSignedWord(worldY) > toSignedWord(p.bounds[3])) p.bounds[3] = worldY;
				}
			}
			p.pendingMemory.ramWords += vertexCount * 2 + (p.hasBounds ? 4 : 0);
			p.pendingWorkUnits = vertexCount;
			p.phase = GeometryXform2Phase.Publish;
			return;
		}
		if (p.phase === GeometryXform2Phase.Publish) {
			for (let i = 0; i < p.vertexCount * 2; ++i) this.memory.writeU32(p.dstAddress + i * 4, p.vertices[i]);
			if (p.hasBounds) for (let i = 0; i < 4; ++i) this.memory.writeU32(p.boundsAddress + i * 4, p.bounds[i]);
			p.phase = GeometryXform2Phase.Complete;
		}
	}
}
