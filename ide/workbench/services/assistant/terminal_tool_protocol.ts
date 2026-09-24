import { StudioToolInputError, toolArguments } from './tool_input';
import type { TerminalContext } from '../terminal/session';

export type TerminalToolRequest =
	| { name: 'studio_terminal_status'; target: string }
	| { name: 'studio_evaluate_lua'; target: string; context: TerminalContext; source: string }
	| { name: 'studio_evaluate_frame'; target: string; frame: string; source: string }
	| { name: 'studio_control_lua'; target: string; evaluation: number; action: 'pause' | 'continue' };
const TARGET_FIELDS = ['target'];
const EVALUATE_FIELDS = ['target', 'context', 'source'];
const FRAME_FIELDS = ['target', 'frame', 'source'];
const CONTROL_FIELDS = ['target', 'evaluation', 'action'];

export const STUDIO_TERMINAL_TOOLS = [
	{ name: 'studio_terminal_status', description: 'Read Lua Terminal availability, the active evaluation and the last settled evaluation (if any), on the authoring target. Same session as the manual Terminal. Evaluations include bounded historical output and an explicit truncation flag. Does not execute or resume Lua. Use on demand, not polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: TARGET_FIELDS, additionalProperties: false } },
	{ name: 'studio_evaluate_lua', description: 'Execute Lua in the actual Studio Terminal through BIOS load and the ordinary CPU scheduler. Choose context=cart for real ordinary global registers: score = score + 1 writes the binding compiled cart code reads; installed names come from runtime inspection. Choose context=session for persistent isolated Terminal bindings and libraries. Locals/captures shadow globals; frame/module locals are NOT injected. Tables/functions are live guest objects. getglobal(name)/setglobal(name,value) explicitly reach ordinary globals in either context, including names not expressible as identifiers; system registers are separate. load without an explicit environment inherits session bindings in session context and ordinary globals in cart context. Expressions, statements and print work within the firmware load subset; table constructors and dynamic require are unsupported. Awaits completion, Lua error, breakpoint/pause, interruption or host error, with context, values and bounded output. Side effects are real, never rolled back. Use studio_control_lua to continue a paused call. Stop revokes queued admission or pauses owned execution, never unwinds it. No OS shell, Save or Hot Resume. One evaluation at a time; no polling.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, context: { type: 'string', enum: ['cart', 'session'] }, source: { type: 'string' } }, required: EVALUATE_FIELDS, additionalProperties: false } },
	{ name: 'studio_evaluate_frame', description: 'Evaluate Lua in the shared Terminal using an exact source frame from studio_read_runtime_stack in the current suspended inspection. Requires a source-debugger stop, not an ordinary host pause or historical frame. Installed BIOS symbols resolve locals, captures and static names before cart globals; unavailable or const bindings are not replaced with globals. Reads and writes affect real guest locations. The selected frame and active IRQ stay pinned; completion or Lua error returns to the same source stop. Escaped frame-access closures expire on evaluation return or source replacement. Stop pauses the call without unwinding; use studio_control_lua to continue. All inspection/value handles expire at admission; open a new inspection afterwards. Same limited BIOS loader as studio_evaluate_lua, no source install or rollback.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, frame: { type: 'string' }, source: { type: 'string' } }, required: FRAME_FIELDS, additionalProperties: false } },
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
			if (typeof value.target !== 'string' || value.context !== 'session' && value.context !== 'cart' || typeof value.source !== 'string') {
				throw new StudioToolInputError('Lua execution requires target, context=cart or session and source; use studio_evaluate_frame with a current stack frame for frame bindings');
			}
			return { name, target: value.target, context: value.context, source: value.source };
		}
		case 'studio_evaluate_frame': {
			const value = toolArguments(input, FRAME_FIELDS);
			if (typeof value.target !== 'string' || typeof value.frame !== 'string' || typeof value.source !== 'string') {
				throw new StudioToolInputError('Frame evaluation requires target, current stack frame reference and source');
			}
			return { name, target: value.target, frame: value.frame, source: value.source };
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
