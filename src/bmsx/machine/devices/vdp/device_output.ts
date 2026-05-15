import type { VdpBbuFrameBuffer } from './bbu';
import type { VdpResolvedBlitterSample } from './blitter';
import type { VdpMduFrameBuffer } from './mdu';

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
	xfMatrixWords: ArrayLike<number>;
	xfViewMatrixIndex: number;
	xfProjectionMatrixIndex: number;
	skyboxEnabled: boolean;
	skyboxSamples: readonly VdpResolvedBlitterSample[];
	billboards: VdpBbuFrameBuffer;
	meshes: VdpMduFrameBuffer;
	lightRegisterWords: ArrayLike<number>;
	morphWeightWords: ArrayLike<number>;
	jointMatrixWords: ArrayLike<number>;
	frameBufferWidth: number;
	frameBufferHeight: number;
}>;

export type VdpFrameBufferPresentation = Readonly<{
	presentationCount: number;
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
