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
// Fill-rate proxy: a pass is charged for the pixels its viewport covers, so
// clears and fullscreen passes carry a fill cost that plain draw-call counting
// misses. Estimated at submit from the pass viewport (integer, O(1) per pass) —
// never per rasterized pixel, so it stays cheap on the GLES2/SNES-mini target.
// Divisor = viewport pixels per fill work-unit; tune to set the overdraw ceiling
// (4096 -> a 320x240 pass costs ~19 units of the ~427/frame NTSC budget).
export const VDP_RPU_PASS_FILL_PIXEL_DENSITY_DIVISOR = 4096;

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

export function rpuPassFillCost(viewportWH: number): number {
	const width = viewportWH & 0xffff;
	const height = (viewportWH >>> 16) & 0xffff;
	return rpuWorkBucket((width * height) >>> 0, VDP_RPU_PASS_FILL_PIXEL_DENSITY_DIVISOR);
}

export function rpuDrawCost(vertexCount: number, instanceCount: number, indexCount: number): number {
	return VDP_RPU_DRAW_COST
		+ rpuWorkBucket(vertexCount, VDP_RPU_DRAW_VERTEX_DENSITY_DIVISOR)
		+ rpuWorkBucket(instanceCount, VDP_RPU_DRAW_INSTANCE_DENSITY_DIVISOR)
		+ rpuWorkBucket(indexCount, VDP_RPU_DRAW_INDEX_DENSITY_DIVISOR);
}
