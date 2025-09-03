import type { InputMap } from '../input/inputtypes';
import type { BaseModel } from './basemodel';

export type PluginOpts = {
	data?: Record<string, any>;
	constants?: Readonly<Record<string, any>>;
	spaces?: string[];
	inputMaps?: Array<{ playerIndex: number; map: InputMap }>;
	onBoot?: (model: BaseModel) => void;
	onTick?: (model: BaseModel, dt: number) => void;
	onLoad?: (model: BaseModel) => void;
	dispose?: () => void;
};

// export function makeModelPlugin(opts: PluginOpts) {
// 	return {
// 		onBoot(model: BaseModel) {
// 			if (opts.spaces) opts.spaces.forEach(s => model.addSpace(s));
// 			if (opts.inputMaps) opts.inputMaps.forEach(im => $.input.getPlayerInput(im.playerIndex).setInputMap(im.map));
// 			opts.onBoot?.(model);
// 		},
// 		onTick: opts.onTick,
// 		onLoad: opts.onLoad,
// 		dispose: opts.dispose,
// 		data: opts.data as Record<string, any>,
// 		constants: opts.constants as Readonly<Record<string, any>>,
// 	};
// }
