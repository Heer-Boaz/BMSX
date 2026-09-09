import { performance } from 'node:perf_hooks';

/** Warmup plus median host time for cold projection and batched warm operations. */
export function medianMilliseconds(run: () => void): number {
	for (let index = 0; index < 10; index += 1) run();
	const samples: number[] = [];
	for (let index = 0; index < 25; index += 1) {
		const start = performance.now();
		run();
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	return samples[12];
}
