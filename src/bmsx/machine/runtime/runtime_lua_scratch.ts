import type { Value } from '../cpu/cpu';

const MAX_POOLED_RUNTIME_SCRATCH_ARRAYS = 32;

export class RuntimeLuaScratchState {
	private readonly valuePool: Value[][] = [];
	private readonly stringPool: string[][] = [];

	public acquireValue(): Value[] {
		const pool = this.valuePool;
		if (pool.length > 0) {
			const scratch = pool.pop()!;
			scratch.length = 0;
			return scratch;
		}
		return [];
	}

	public releaseValue(values: Value[]): void {
		values.length = 0;
		if (this.valuePool.length < MAX_POOLED_RUNTIME_SCRATCH_ARRAYS) {
			this.valuePool.push(values);
		}
	}

	public acquireString(): string[] {
		const pool = this.stringPool;
		if (pool.length > 0) {
			const scratch = pool.pop()!;
			scratch.length = 0;
			return scratch;
		}
		return [];
	}

	public releaseString(values: string[]): void {
		values.length = 0;
		if (this.stringPool.length < MAX_POOLED_RUNTIME_SCRATCH_ARRAYS) {
			this.stringPool.push(values);
		}
	}
}
