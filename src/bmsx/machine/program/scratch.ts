import type { Table, Value } from '../cpu/cpu';
import { ScratchBuffer } from '../../common/scratchbuffer';

export class LuaScratchState {
	private readonly valueScratch = new ScratchBuffer<Value[]>(() => []);
	private valueScratchIndex = 0;
	private readonly stringScratch = new ScratchBuffer<string[]>(() => []);
	private stringScratchIndex = 0;
	private readonly tableMarshalScratch = new ScratchBuffer<Map<Table, unknown>>(() => new Map<Table, unknown>());
	private tableMarshalScratchIndex = 0;

	public acquireValue(): Value[] {
		const scratch = this.valueScratch.get(this.valueScratchIndex);
		this.valueScratchIndex += 1;
		scratch.length = 0;
		return scratch;
	}

	public releaseValue(values: Value[]): void {
		values.length = 0;
		this.valueScratchIndex -= 1;
	}

	public acquireString(): string[] {
		const scratch = this.stringScratch.get(this.stringScratchIndex);
		this.stringScratchIndex += 1;
		scratch.length = 0;
		return scratch;
	}

	public releaseString(values: string[]): void {
		values.length = 0;
		this.stringScratchIndex -= 1;
	}

	public acquireTableMarshal(): Map<Table, unknown> {
		const scratch = this.tableMarshalScratch.get(this.tableMarshalScratchIndex);
		this.tableMarshalScratchIndex += 1;
		scratch.clear();
		return scratch;
	}

	public releaseTableMarshal(values: Map<Table, unknown>): void {
		values.clear();
		this.tableMarshalScratchIndex -= 1;
	}
}
