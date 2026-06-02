import type { Table, Value } from '../cpu/cpu';
import { ScratchArrayStack, ScratchMapStack } from '../../common/scratchstack';

export class LuaScratchState {
	public readonly values = new ScratchArrayStack<Value>();
	public readonly strings = new ScratchArrayStack<string>();
	public readonly tableMarshal = new ScratchMapStack<Table, unknown>();
}
