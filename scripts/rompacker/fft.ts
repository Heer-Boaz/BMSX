const PI = Math.PI;

function bitReverse(value: number, bits: number): number {
	let x = value;
	let y = 0;
	for (let b = 0; b < bits; b++) {
		y = (y << 1) | (x & 1);
		x >>>= 1;
	}
	return y;
}

export class FFTComplexRadix2 {
	readonly size: number;
	private readonly bits: number;
	private readonly rev: Uint16Array;
	private readonly cosTable: Float64Array;
	private readonly sinTable: Float64Array;

	constructor(size: number) {
		if ((size & (size - 1)) !== 0) throw new Error(`FFT size must be power of 2, got ${size}`);
		this.size = size;
		this.bits = Math.round(Math.log2(size));

		this.rev = new Uint16Array(size);
		for (let i = 0; i < size; i++) this.rev[i] = bitReverse(i, this.bits);

		this.cosTable = new Float64Array(size >>> 1);
		this.sinTable = new Float64Array(size >>> 1);
		for (let k = 0; k < (size >>> 1); k++) {
			const ang = (2 * PI * k) / size;
			this.cosTable[k] = Math.cos(ang);
			this.sinTable[k] = -Math.sin(ang);
		}
	}

	forward(re: Float64Array, im: Float64Array): void {
		const n = this.size;
		if (re.length !== n || im.length !== n) throw new Error(`FFT buffers must have length ${n}`);

		for (let i = 0; i < n; i++) {
			const j = this.rev[i];
			if (j > i) {
				let tr = re[i];
				re[i] = re[j];
				re[j] = tr;
				let ti = im[i];
				im[i] = im[j];
				im[j] = ti;
			}
		}

		for (let len = 2; len <= n; len <<= 1) {
			const half = len >>> 1;
			const step = n / len;
			for (let i = 0; i < n; i += len) {
				for (let j = 0; j < half; j++) {
					const tw = (j * step) | 0;
					const wr = this.cosTable[tw];
					const wi = this.sinTable[tw];

					const i0 = i + j;
					const i1 = i0 + half;

					const r1 = re[i1];
					const i1v = im[i1];

					const vr = r1 * wr - i1v * wi;
					const vi = r1 * wi + i1v * wr;

					const ur = re[i0];
					const ui = im[i0];

					re[i0] = ur + vr;
					im[i0] = ui + vi;
					re[i1] = ur - vr;
					im[i1] = ui - vi;
				}
			}
		}
	}
}
