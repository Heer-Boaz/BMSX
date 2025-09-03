import type { InputMap } from '../input/inputtypes';
import type { BaseModel } from './basemodel';

export type PluginOpts = {
	spaces?: string[];
	inputMaps?: Array<{ playerIndex: number; map: InputMap }>;
	onBoot?: (model: BaseModel) => void;
	onTick?: (model: BaseModel, dt: number) => void;
	onLoad?: (model: BaseModel) => void;
	dispose?: () => void;
};
