import type { VdpRpuFrameOutput } from './rpu';

export type VdpDirtySpan = {
	xStart: number;
	xEnd: number;
};

export type VdpSurfaceUploadSlot = {
	baseAddr: number;
	capacity: number;
	surfaceId: number;
	surfaceWidth: number;
	surfaceHeight: number;
	cpuReadback: Uint8Array;
	dirtyRowStart: number;
	dirtyRowEnd: number;
	dirtySpansByRow: VdpDirtySpan[];
};

export function createVdpDirtySpans(height: number): VdpDirtySpan[] {
	const spans: VdpDirtySpan[] = [];
	for (let row = 0; row < height; row += 1) {
		spans.push({ xStart: 0, xEnd: 0 });
	}
	return spans;
}

export type VdpSurfaceUpload = Readonly<{
	surfaceId: number;
	surfaceWidth: number;
	surfaceHeight: number;
	cpuReadback: Uint8Array;
	dirtyRowStart: number;
	dirtyRowEnd: number;
	dirtySpansByRow: readonly VdpDirtySpan[];
	requiresFullSync: boolean;
}>;

export type VdpDeviceOutput = Readonly<{
	ditherType: number;
	scanoutPhase: number;
	scanoutX: number;
	scanoutY: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
	rpu: VdpRpuFrameOutput;
}>;

export type VdpFrameBufferPresentation = Readonly<{
	presentationCount: number;
	readbackValid: boolean;
	requiresFullSync: boolean;
	dirtyRowStart: number;
	dirtyRowEnd: number;
	dirtySpansByRow: readonly VdpDirtySpan[];
	renderReadback: Uint8Array;
	displayReadback: Uint8Array;
	width: number;
	height: number;
}>;

export type VdpFrameBufferPresentationSink = {
	consumeVdpFrameBufferPresentation(presentation: VdpFrameBufferPresentation): void;
};

export type VdpSurfaceUploadSink = {
	consumeVdpSurfaceUpload(upload: VdpSurfaceUpload): void;
};
