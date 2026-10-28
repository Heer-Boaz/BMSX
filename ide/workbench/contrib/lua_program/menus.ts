import type { WorkbenchMenuCommandDefinition, WorkbenchMenuDefinition } from '../../ui/menu/model';
import type { LuaProgramInput } from './editor_input';

export const LUA_PROGRAM_TITLE_ACTIONS: readonly WorkbenchMenuCommandDefinition<LuaProgramInput>[] = [
	{ type: 'command', command: 'luaProgram.add', when: input => !input.liveVisible },
	{ type: 'command', command: 'luaProgram.edit', when: input => !input.liveVisible },
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'luaProgram.live', when: input => !input.liveVisible },
	{ type: 'command', command: 'luaProgram.authoring', when: input => input.liveVisible },
];

export const LUA_PROGRAM_CONTEXT_ACTIONS: WorkbenchMenuDefinition<LuaProgramInput> = [
	{ type: 'command', command: 'luaProgram.add', when: input => !input.liveVisible },
	{ type: 'command', command: 'luaProgram.edit', when: input => !input.liveVisible },
	{ type: 'command', command: 'luaProgram.remove', when: input => !input.liveVisible },
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'editor.sourceToSide' },
	{ type: 'command', command: 'luaProgram.live', when: input => !input.liveVisible },
	{ type: 'command', command: 'luaProgram.authoring', when: input => input.liveVisible },
	{ type: 'command', command: 'luaProgram.selectInstance' },
	{ type: 'command', command: 'luaProgram.testInput', when: input => input.programKind === 'input' },
];
