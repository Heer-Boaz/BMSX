import type { Table, Value } from '../cpu/cpu';
import { ScratchArrayStack, ScratchMapStack } from '../../common/scratchstack';

export class LuaScratchState {
	private readonly valueScratch = new ScratchArrayStack<Value>();
	private readonly stringScratch = new ScratchArrayStack<string>();
	private readonly tableMarshalScratch = new ScratchMapStack<Table, unknown>();

	public acquireValue(): Value[] {
		return this.valueScratch.acquire();
	}

	public releaseValue(values: Value[]): void {
		this.valueScratch.release(values);
	}

	public acquireString(): string[] {
		return this.stringScratch.acquire();
	}

	public releaseString(values: string[]): void {
		this.stringScratch.release(values);
	}

	public acquireTableMarshal(): Map<Table, unknown> {
		return this.tableMarshalScratch.acquire();
	}

	public releaseTableMarshal(values: Map<Table, unknown>): void {
		this.tableMarshalScratch.release(values);
	}
}
