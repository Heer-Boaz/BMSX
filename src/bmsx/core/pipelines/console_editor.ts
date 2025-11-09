import type { NodeSpec } from "../../ecs/pipeline";

/**
 * Pipeline variant tailored for the console editor.
 * Keeps rendering systems active while omitting gameplay/physics updates.
 */
	export function consoleEditorSpec(): NodeSpec[] {
	return [
		{ ref: 'bmsxConsole.mode' },
		{ ref: 'bmsxConsole.editor', after: ['bmsxConsole.mode'] },
		{ ref: 'transform' },
		{ ref: 'textRender' },
		{ ref: 'spriteRender', after: ['textRender'] },
		{ ref: 'meshRender', after: ['spriteRender'] },
		{ ref: 'renderSubmit', after: ['meshRender'] },
		{ ref: 'bmsxConsole.draw', after: ['renderSubmit'] },
	];
}
