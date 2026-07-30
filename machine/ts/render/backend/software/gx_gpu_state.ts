import {
	GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES,
	GX_GPU_TRIANGLE_COLOR_COMPONENTS,
	GX_GPU_TRIANGLE_UV_COMPONENTS,
} from '../gx_gpu_render_rules';

export class GxGpuSoftwareTriangleEdgeSpan {
	public rowValue = 0;
	public rowStep = 0;
	public boundary = 0;
	public boundaryStep = 0;
	public remainder = 0;
	public remainderStep = 0;
	public denominator = 0;
	public boundaryKind = 0;

	public initialize(initialRowValue: number, stepX: number, stepY: number): void {
		this.rowValue = initialRowValue;
		this.rowStep = stepY;
		this.boundary = 0;
		this.boundaryStep = 0;
		this.remainder = 0;
		this.remainderStep = 0;
		this.denominator = 0;
		this.boundaryKind = 0;
		let numerator: number;
		let numeratorStep: number;
		if (stepX > 0) {
			this.denominator = stepX;
			numerator = -this.rowValue + this.denominator - 1;
			numeratorStep = -this.rowStep;
			this.boundaryKind = 1;
		} else if (stepX < 0) {
			this.denominator = -stepX;
			numerator = this.rowValue;
			numeratorStep = this.rowStep;
			this.boundaryKind = -1;
		} else {
			return;
		}
		this.boundary = (numerator - (numerator % this.denominator)) / this.denominator;
		this.remainder = numerator - this.boundary * this.denominator;
		if (this.remainder < 0) {
			this.boundary -= 1;
			this.remainder += this.denominator;
		}
		this.boundaryStep = (numeratorStep - (numeratorStep % this.denominator)) / this.denominator;
		this.remainderStep = numeratorStep - this.boundaryStep * this.denominator;
		if (this.remainderStep < 0) {
			this.boundaryStep -= 1;
			this.remainderStep += this.denominator;
		}
	}

	public intersect(bounds: Int32Array): boolean {
		if (this.boundaryKind > 0) {
			if (this.boundary > bounds[0]) {
				bounds[0] = this.boundary;
			}
			return bounds[0] <= bounds[1];
		}
		if (this.boundaryKind < 0) {
			if (this.boundary < bounds[1]) {
				bounds[1] = this.boundary;
			}
			return bounds[0] <= bounds[1];
		}
		return this.rowValue >= 0;
	}

	public advance(): void {
		if (this.boundaryKind === 0) {
			this.rowValue += this.rowStep;
			return;
		}
		this.boundary += this.boundaryStep;
		this.remainder += this.remainderStep;
		if (this.remainder >= this.denominator) {
			this.remainder -= this.denominator;
			this.boundary += 1;
		}
	}
}

export class GxGpuSoftwareState {
	public readonly vram: Uint16Array;
	public readonly vramWordMask: number;
	public readonly vramSnapshotScratch: Uint8Array;
	public processedCommandCount = 0;
	public processedCommandSerial = 0;
	public vramSnapshotSerial = 0n;
	public interlacedPixels: Uint32Array;
	public interlacedWidth = 0;
	public interlacedHeight = 0;
	public interlacedValid = false;
	public interlacedVramReplacementSerial = 0n;
	public readonly triangleUvPlaneScratch = new Uint32Array(GX_GPU_TRIANGLE_UV_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
	public readonly triangleColorPlaneScratch = new Uint32Array(GX_GPU_TRIANGLE_COLOR_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
	public readonly triangleEdge0 = new GxGpuSoftwareTriangleEdgeSpan();
	public readonly triangleEdge1 = new GxGpuSoftwareTriangleEdgeSpan();
	public readonly triangleEdge2 = new GxGpuSoftwareTriangleEdgeSpan();
	public readonly triangleSpanBounds = new Int32Array(2);

	constructor(vramByteCount: number, interlacedPixelCount: number) {
		this.vram = new Uint16Array(vramByteCount >>> 1);
		this.vramWordMask = this.vram.length - 1;
		this.vramSnapshotScratch = new Uint8Array(vramByteCount);
		this.interlacedPixels = new Uint32Array(interlacedPixelCount);
	}
}
