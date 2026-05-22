export const VDP_RPU_PACKET_COST = 1;
export const VDP_RPU_RESOURCE_COST = 2;
export const VDP_RPU_PASS_COST = 8;
export const VDP_RPU_DRAW_COST = 4;
export const VDP_RPU_BIND_COST = 1;
export const VDP_RPU_UPLOAD_COST = 2;
export const VDP_RPU_DISCARD_COST = 1;
export const VDP_RPU_UPLOAD_BYTE_DENSITY_DIVISOR = 256;
export const VDP_RPU_DRAW_VERTEX_DENSITY_DIVISOR = 64;
export const VDP_RPU_DRAW_INSTANCE_DENSITY_DIVISOR = 16;
export const VDP_RPU_DRAW_INDEX_DENSITY_DIVISOR = 64;

export function rpuWorkBucket(workUnits: number, densityDivisor: number): number {
	if (workUnits === 0) {
		return 0;
	}
	const work = (workUnits + densityDivisor - 1) >>> 0;
	return (work - (work % densityDivisor)) / densityDivisor;
}

export function rpuUploadCost(byteLength: number): number {
	return VDP_RPU_UPLOAD_COST + rpuWorkBucket(byteLength, VDP_RPU_UPLOAD_BYTE_DENSITY_DIVISOR);
}

export function rpuDrawCost(vertexCount: number, instanceCount: number, indexCount: number): number {
	return VDP_RPU_DRAW_COST
		+ rpuWorkBucket(vertexCount, VDP_RPU_DRAW_VERTEX_DENSITY_DIVISOR)
		+ rpuWorkBucket(instanceCount, VDP_RPU_DRAW_INSTANCE_DENSITY_DIVISOR)
		+ rpuWorkBucket(indexCount, VDP_RPU_DRAW_INDEX_DENSITY_DIVISOR);
}
