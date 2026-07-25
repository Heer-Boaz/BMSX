import { ArrayNativeArgsView } from '../cpu/cpu';
import type { Table } from '../cpu/table';
import type { Value } from '../cpu/value';
import { ScratchArrayStack, ScratchMapStack } from '../../common/scratchstack';
import { ScratchBuffer } from '../../common/scratchbuffer';

export class LuaScratchState {
	public readonly values = new ScratchArrayStack<Value>();
	public readonly strings = new ScratchArrayStack<string>();
	public readonly tableMarshal = new ScratchMapStack<Table, unknown>();
	private readonly nativeArgsScratch = new ScratchBuffer<ArrayNativeArgsView>(() => new ArrayNativeArgsView());
	private nativeArgsScratchIndex = 0;

	public acquireNativeArgs(values: ReadonlyArray<Value>): ArrayNativeArgsView {
		const args = this.nativeArgsScratch.get(this.nativeArgsScratchIndex);
		this.nativeArgsScratchIndex += 1;
		args.bind(values);
		return args;
	}

	public releaseNativeArgs(args: ArrayNativeArgsView): void {
		args.clear();
		this.nativeArgsScratchIndex -= 1;
	}
}
