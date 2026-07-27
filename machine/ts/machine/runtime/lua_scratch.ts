import type { Table } from '../cpu/table';
import type { Value } from '../cpu/value';
import { ScratchArrayStack, ScratchMapStack } from '../../common/scratchstack';

export class LuaScratchState {
	public readonly values = new ScratchArrayStack<Value>();
	public readonly strings = new ScratchArrayStack<string>();
	public readonly tableMarshal = new ScratchMapStack<Table, unknown>();
}
