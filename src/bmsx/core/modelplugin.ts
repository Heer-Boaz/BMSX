import type { InputMap } from '../input/inputtypes';
import type { World } from './world';

export type PluginOpts = {
	spaces?: string[];
	inputMaps?: Array<{ playerIndex: number; map: InputMap }>;
	onBoot?: (model: World) => void;
	onTick?: (model: World, dt: number) => void;
	onLoad?: (model: World) => void;
	dispose?: () => void;
};
