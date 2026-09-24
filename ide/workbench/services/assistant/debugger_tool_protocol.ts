import type { SourceExecutionMode } from '../../../runtime/source_debugger';
import { StudioToolInputError, toolArguments } from './tool_input';

export type DebuggerToolRequest =
	| { name: 'studio_list_debug_sources'; target: string }
	| { name: 'studio_read_debug_source'; source: string }
	| { name: 'studio_set_breakpoints'; source: string; lines: number[] }
	| { name: 'studio_resume_debugger'; target: string; mode: SourceExecutionMode };
const TARGET_FIELDS = ['target'], SOURCE_FIELDS = ['source'], BREAKPOINT_FIELDS = ['source', 'lines'], RESUME_FIELDS = ['target', 'mode'];
export const STUDIO_DEBUGGER_TOOLS = [
	{ name: 'studio_list_debug_sources', description: 'List the authoring target\'s installed Lua sources, distinct from editable working copies. Image-scoped handles expire when installed code changes. Use these sources for breakpoint coordinates and interpreting current stack locations. No source install, guest execution or filesystem access.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: TARGET_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_debug_source', description: 'Read installed source text and current requested/bound breakpoints for an installed-source handle. Lines/columns are one-based. This is the code running on the target, not dirty editor text. Use studio_read_source separately for working-copy edits.',
		inputSchema: { type: 'object', properties: { source: { type: 'string' } }, required: SOURCE_FIELDS, additionalProperties: false } },
	{ name: 'studio_set_breakpoints', description: 'Replace the breakpoint list for exactly one installed source; [] clears that source only. Uses the ordinary Studio gutter/persistence owner. Returns actual PC bindings: no-statement and missing-symbol locations are unbound, not successful stops. No nearest-line guessing or source edits. Breakpoints persist after the conversation; read the current list before changing it if preserving manual breakpoints.',
		inputSchema: { type: 'object', properties: { source: { type: 'string' }, lines: { type: 'array', items: { type: 'integer', minimum: 1 }, uniqueItems: true } }, required: BREAKPOINT_FIELDS, additionalProperties: false } },
	{ name: 'studio_resume_debugger', description: 'Continue or source-step (into/over/out) the authoring target using the shared Studio debugger. Steps require a current source stop; continue also accepts an ordinary paused target. Awaits a real breakpoint/step, guest-call boundary, fault, interruption or reset, not command acceptance. A continue without a breakpoint can run indefinitely: conversation Stop pauses only its own execution. No polling. Keeps Requested pause, never seeks or runs recorded history, never replaces a Terminal call. At a call boundary inspect its result using studio_terminal_status. All old inspection handles expire; open a new inspection after stopping. Coordinates are installed code.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, mode: { type: 'string', enum: ['continue', 'into', 'over', 'out'] } }, required: RESUME_FIELDS, additionalProperties: false } },
];
export function decodeDebuggerToolRequest(name: string, input: unknown): DebuggerToolRequest {
	switch (name) {
		case 'studio_list_debug_sources': {
			const value = toolArguments(input, TARGET_FIELDS);
			if (typeof value.target !== 'string') throw new StudioToolInputError('target must identify the Studio authoring runtime');
			return { name, target: value.target };
		}
		case 'studio_read_debug_source': {
			const value = toolArguments(input, SOURCE_FIELDS);
			if (typeof value.source !== 'string') throw new StudioToolInputError('source must be an installed-source handle');
			return { name, source: value.source };
		}
		case 'studio_set_breakpoints': {
			const value = toolArguments(input, BREAKPOINT_FIELDS);
			if (typeof value.source !== 'string' || !Array.isArray(value.lines)
				|| value.lines.some(line => !Number.isSafeInteger(line) || line < 1) || new Set(value.lines).size !== value.lines.length) {
				throw new StudioToolInputError('Breakpoints require an installed source and distinct positive integer lines');
			}
			return { name, source: value.source, lines: value.lines };
		}
		case 'studio_resume_debugger': {
			const value = toolArguments(input, RESUME_FIELDS);
			if (typeof value.target !== 'string' || !['continue', 'into', 'over', 'out'].includes(value.mode as string)) {
				throw new StudioToolInputError('Debugger execution requires a target and continue/into/over/out mode');
			}
			return { name, target: value.target, mode: value.mode as SourceExecutionMode };
		}
		default: throw new StudioToolInputError(`Unknown debugger tool: ${name}`);
	}
}
