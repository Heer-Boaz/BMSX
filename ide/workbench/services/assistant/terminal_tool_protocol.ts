import { StudioToolInputError, toolArguments } from './tool_input';

export type TerminalToolRequest =
	| { name: 'studio_terminal_status'; target: string }
	| { name: 'studio_evaluate_lua'; target: string; context: 'session'; source: string }
	| { name: 'studio_control_lua'; target: string; evaluation: number; action: 'pause' | 'continue' };
const TARGET_FIELDS = ['target'];
const EVALUATE_FIELDS = ['target', 'context', 'source'];
const CONTROL_FIELDS = ['target', 'evaluation', 'action'];

export const STUDIO_TERMINAL_TOOLS = [
	{ name: 'studio_terminal_status', description: 'Read Lua Terminal availability and the active evaluation, if any, on the authoring target. Same session as the manual Terminal. The active evaluation includes bounded historical output and an explicit truncation flag. Does not execute or resume Lua. Use on demand, not polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: TARGET_FIELDS, additionalProperties: false } },
	{ name: 'studio_evaluate_lua', description: 'Execute Lua in the actual Studio Terminal through BIOS load and the ordinary CPU scheduler. Context must be session: persistent Terminal bindings and standard libraries. Use getglobal(name) and setglobal(name, value) to read/write real ordinary cart-global registers (names from runtime inspection); returned tables are live objects. Free identifiers still name Terminal variables, NOT implicit cart bindings or debugger locals. System registers are separate. Expressions, statements and print work within the firmware load subset; table constructors and dynamic require are unsupported. Awaits real completion, Lua error, breakpoint/pause, interruption or host error, with result values and bounded output. Side effects are real and not rolled back. A paused call retains its physical stack; use studio_control_lua to continue. Stop cancels queued admission or pauses owned execution, not unwinding it. No OS shell, Save or Hot Resume. One evaluation at a time; no polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, context: { type: 'string', enum: ['session'] }, source: { type: 'string' } }, required: EVALUATE_FIELDS, additionalProperties: false } },
	{ name: 'studio_control_lua', description: 'Pause or continue the identified active Lua Terminal evaluation. Continue awaits its next actual return or stop and retains independent user/workbench pause. Pause retains guest frames and mutations; it does not abort/unwind or reset the machine. Rejects stale evaluation identities. A new evaluation cannot replace a suspended one; explicit Reboot is required to discard an infinite call.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, evaluation: { type: 'integer', minimum: 1 }, action: { type: 'string', enum: ['pause', 'continue'] } }, required: CONTROL_FIELDS, additionalProperties: false } },
];

/** Model arguments cross an external boundary; internal owners consume the decoded request. */
export function decodeTerminalToolRequest(name: string, input: unknown): TerminalToolRequest {
	switch (name) {
		case 'studio_terminal_status': {
			const value = toolArguments(input, TARGET_FIELDS);
			if (typeof value.target !== 'string') throw new StudioToolInputError('target must be the listed Studio runtime handle');
			return { name, target: value.target };
		}
		case 'studio_evaluate_lua': {
			const value = toolArguments(input, EVALUATE_FIELDS);
			if (typeof value.target !== 'string' || value.context !== 'session' || typeof value.source !== 'string') {
				throw new StudioToolInputError('Lua execution requires target, context=session and source; cart/frame bindings are not available');
			}
			return { name, target: value.target, context: value.context, source: value.source };
		}
		case 'studio_control_lua': {
			const value = toolArguments(input, CONTROL_FIELDS);
			if (typeof value.target !== 'string' || !Number.isSafeInteger(value.evaluation) || (value.evaluation as number) < 1
				|| value.action !== 'pause' && value.action !== 'continue') {
				throw new StudioToolInputError('Lua control requires target, positive evaluation identity and pause/continue action');
			}
			return { name, target: value.target, evaluation: value.evaluation as number, action: value.action };
		}
		default: throw new StudioToolInputError(`Unknown Studio runtime tool: ${name}`);
	}
}
