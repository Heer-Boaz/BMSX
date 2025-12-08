import type { NodeSpec } from "../../ecs/pipeline";

/** BMSX VM overlay pipeline extensions. */
export const ideExtSpec: NodeSpec[] = [
	{ ref: 'bmsx:ide_update_system' },
	{ ref: 'bmsx:ide_draw_system' },
];

export const terminalExtSpec: NodeSpec[] = [
	{ ref: 'bmsx:terminal_update_system' },
	{ ref: 'bmsx:terminal_draw_system' },
];
