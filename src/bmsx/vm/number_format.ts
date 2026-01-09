// Port of C++ number_format.h to keep VM text output identical across TS and C++.
// We added this because the C++ VM cannot rely on std::to_chars here, so it
// uses a custom %.6g formatter; TS mirrors that output for parity.
// This matters for parity-sensitive behavior like tostring/concat/print output,
// deterministic test logs, and savegame/debug comparisons between runtimes.
// Performance note: this runs in JS and allocates strings, so it is slower than
// V8's native number->string path. In hot loops (10k-100k conversions per frame)
// this can cost multiple milliseconds. Avoid per-frame formatting of changing
// numbers; cache or preformat values when possible.
const PRECISION = 6;
const POW10 = [1e1, 1e2, 1e4, 1e8, 1e16, 1e32, 1e64, 1e128, 1e256];
const POW10_INV = [1e-1, 1e-2, 1e-4, 1e-8, 1e-16, 1e-32, 1e-64, 1e-128, 1e-256];
const POW10_EXP = [1, 2, 4, 8, 16, 32, 64, 128, 256];

function roundToEven(value: number): number {
	const base = Math.floor(value);
	const frac = value - base;
	if (frac > 0.5) {
		return base + 1;
	}
	if (frac < 0.5) {
		return base;
	}
	return (base & 1) !== 0 ? base + 1 : base;
}

function normalize10(value: number): { exp10: number; norm: number } {
	let exp10 = 0;
	let norm = value;
	if (norm >= 10.0) {
		for (let i = 8; i >= 0; i -= 1) {
			if (norm >= POW10[i]) {
				norm *= POW10_INV[i];
				exp10 += POW10_EXP[i];
			}
		}
		while (norm >= 10.0) {
			norm *= 0.1;
			exp10 += 1;
		}
	} else if (norm < 1.0) {
		for (let i = 8; i >= 0; i -= 1) {
			if (norm < POW10_INV[i]) {
				norm *= POW10[i];
				exp10 -= POW10_EXP[i];
			}
		}
		while (norm < 1.0) {
			norm *= 10.0;
			exp10 -= 1;
		}
	}
	return { exp10, norm };
}

function writeDigits6(value: number): string {
	let num = value;
	const chars = new Array<string>(6);
	for (let i = 5; i >= 0; i -= 1) {
		chars[i] = String.fromCharCode(48 + (num % 10));
		num = Math.floor(num / 10);
	}
	return chars.join('');
}

function trimTrailingZeros(text: string, dotIndex: number): string {
	let end = text.length;
	while (end > dotIndex + 1 && text.charAt(end - 1) === '0') {
		end -= 1;
	}
	if (end === dotIndex + 1) {
		end = dotIndex;
	}
	return text.slice(0, end);
}

export function formatNumber(value: number): string {
	if (value === 0) {
		return Object.is(value, -0) ? '-0' : '0';
	}
	const negative = value < 0;
	const absValue = negative ? -value : value;

	if (absValue < 1000000.0) {
		const asInt = Math.trunc(absValue);
		if (asInt === absValue) {
			return (negative ? '-' : '') + asInt.toString();
		}
	}

	const { exp10, norm } = normalize10(absValue);
	let scaled = norm * 100000.0;
	let digits = roundToEven(scaled);
	let adjustedExp = exp10;
	if (digits === 1000000) {
		digits = 100000;
		adjustedExp += 1;
	}

	const digitsBuf = writeDigits6(digits);
	let out = negative ? '-' : '';

	if (adjustedExp >= -4 && adjustedExp < PRECISION) {
		const decimalPos = adjustedExp + 1;
		if (decimalPos > 0) {
			out += digitsBuf.slice(0, decimalPos);
			if (decimalPos < PRECISION) {
				const dotPos = out.length;
				out += '.';
				out += digitsBuf.slice(decimalPos);
				return trimTrailingZeros(out, dotPos);
			}
			return out;
		}
		out += '0.';
		const dotPos = out.length - 1;
		for (let i = 0; i < -decimalPos; i += 1) {
			out += '0';
		}
		out += digitsBuf;
		return trimTrailingZeros(out, dotPos);
	}

	out += digitsBuf.charAt(0);
	const dotPos = out.length;
	out += '.';
	out += digitsBuf.slice(1);
	out = trimTrailingZeros(out, dotPos);
	out += 'e';
	out += adjustedExp >= 0 ? '+' : '-';
	const absExp = Math.abs(adjustedExp);
	if (absExp >= 100) {
		const hundreds = Math.floor(absExp / 100);
		const rem = absExp % 100;
		out += String.fromCharCode(48 + hundreds);
		out += String.fromCharCode(48 + Math.floor(rem / 10));
		out += String.fromCharCode(48 + (rem % 10));
	} else {
		out += String.fromCharCode(48 + Math.floor(absExp / 10));
		out += String.fromCharCode(48 + (absExp % 10));
	}
	return out;
}
