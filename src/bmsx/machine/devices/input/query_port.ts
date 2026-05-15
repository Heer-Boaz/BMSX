import { Memory } from '../../memory/memory';
import type { Value } from '../../cpu/cpu';
import type { StringPool } from '../../cpu/string_pool';
import {
	IO_INP_CONSUME,
	IO_INP_QUERY,
} from '../../bus/io';
import { InputControllerActionTable, type InputControllerQueryResult } from './action_table';
import { InputControllerRegisterFile } from './registers';

export class InputControllerQueryPort {
	private readonly queryResult: InputControllerQueryResult = { statusWord: 0, valueQ16: 0 };

	public constructor(
		private readonly memory: Memory,
		private readonly strings: StringPool,
		private readonly registers: InputControllerRegisterFile,
		private readonly actionTable: InputControllerActionTable,
	) {}

	public writeQuery(_addr: number, value: Value): void {
		this.registers.write(IO_INP_QUERY, value);
		const queryText = this.strings.toString(this.registers.state.queryStringId);
		this.actionTable.queryAction(this.registers.selectedPlayerIndex(), queryText, this.queryResult);
		this.registers.writeResult(this.memory, this.queryResult.statusWord, this.queryResult.valueQ16);
	}

	public writeConsume(_addr: number, value: Value): void {
		this.registers.write(IO_INP_CONSUME, value);
		const actionNames = this.strings.toString(this.registers.state.consumeStringId);
		this.actionTable.consumeActions(this.registers.selectedPlayerIndex(), actionNames);
	}
}
