import { insavegame } from '../serializer/serializationhooks';
import { Component } from './basecomponent';
import type { InputAbilityProgram } from '../gas/input_ability_dsl';
import type { Identifier } from '../rompack/rompack';

@insavegame
export class InputAbilityComponent extends Component {
	public static override get unique(): boolean { return true; }

	/** Player index that drives this object. Defaults to player 1. */
	public playerIndex = 1;
	/** Program identifier that resolves to a ROM data asset. */
	public programId?: Identifier;
	/** Optional inlined program definition. */
	public program?: InputAbilityProgram;
}
