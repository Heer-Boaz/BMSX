import { insavegame } from '../serializer/serializationhooks';
import { Component } from './basecomponent';
import type { Identifier } from '../rompack/rompack';
import type { InputActionEffectProgram } from '../action_effects/input_action_effect_dsl';

@insavegame
export class InputActionEffectComponent extends Component {
	public static override get unique(): boolean { return true; }

	/** Program identifier that resolves to a ROM data asset. */
	public program_id?: Identifier;
	/** Optional inlined program definition. */
	public program?: InputActionEffectProgram;
}
