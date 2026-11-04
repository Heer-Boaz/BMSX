import type { HostControlInputEvent } from '../../../../hosts/common/control/protocol';
import type { StudioToolDefinition } from '../../../../hosts/common/studio_tools';
import { hidKeyUsageForCode } from '../../../../hosts/common/input/hid_keys';
import { StudioToolInputError, toolArguments } from './tool_input';

export type StudioUiInputStep = { events: HostControlInputEvent[]; frames: number };
export type StudioUiRequest = { name: 'studio_capture_ui' }
	| { name: 'studio_ui_input'; capture: string; steps: StudioUiInputStep[] };

const BUTTONS = ['primary', 'secondary', 'aux', 'back', 'forward'] as const;
const MAX_FRAMES = 120;
const MAX_EVENTS = 256;
const EVENT_SCHEMAS = [
	{ type: 'object', properties: { type: { const: 'key' }, code: { type: 'string' }, down: { type: 'boolean' } }, required: ['type', 'code', 'down'], additionalProperties: false },
	{ type: 'object', properties: { type: { const: 'pointer' }, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } }, required: ['type', 'x', 'y'], additionalProperties: false },
	{ type: 'object', properties: { type: { const: 'button' }, button: { type: 'string', enum: BUTTONS }, down: { type: 'boolean' } }, required: ['type', 'button', 'down'], additionalProperties: false },
	{ type: 'object', properties: { type: { const: 'wheel' }, deltaY: { type: 'integer' } }, required: ['type', 'deltaY'], additionalProperties: false },
];

/** External window control, deliberately not exposed to the embedded assistant. */
export const STUDIO_UI_TOOLS: readonly StudioToolDefinition[] = [
	{ name: 'studio_capture_ui', description: 'Capture the selected Studio canvas after its next actual presentation, including editor chrome, menus and viewport overlays. This is NOT studio_capture_game, a desktop screenshot or a DOM/browser-dialog capture. Does not activate the editor, pause or execute the guest. Returns a PNG, its pixel dimensions, presentation sequence, context-owned capture receipt and input availability. Use image-pixel coordinates with studio_ui_input, not CSS/window coordinates. Capture is on demand, not continuous recording; a non-presenting session times out.',
		inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
		annotations: { readOnlyHint: true, openWorldHint: false } },
	{ name: 'studio_ui_input', description: 'Send a finite sequence of real pointer, wheel and KeyboardEvent.code input to the selected Studio, through its ordinary input/focus route. Requires sourceAccess=edit, reviewApproval=agent and a host with input control; user-review browser sessions cannot be controlled this way. Supply this context\'s latest studio_capture_ui receipt. Pointer positions are integer image pixels; capture again after resizing or opening/closing the editor before clicking. Each step applies events then waits frames host/UI frames (NOT guest video ticks). Use separate down/up steps for polled gameplay keys; wheel deltaY is signed logical steps. Maximum 120 total frames and 256 events. Concurrent control is rejected. Remaining held input is cancelled on completion, cancellation, timeout or context close; explicitly send button-up to commit a click/drag. Completed effects are not rolled back. Returns completed host frames, not proof of successful UI action; inspect a fresh screenshot and domain state. Never replay a mutation after a lost reply.',
		inputSchema: { type: 'object', properties: { capture: { type: 'string' }, steps: { type: 'array', minItems: 1, maxItems: MAX_FRAMES,
			items: { type: 'object', properties: { events: { type: 'array', maxItems: MAX_EVENTS, items: { oneOf: EVENT_SCHEMAS } },
				frames: { type: 'integer', minimum: 1, maximum: MAX_FRAMES } }, required: ['events', 'frames'], additionalProperties: false } } },
			required: ['capture', 'steps'], additionalProperties: false },
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
];

export function decodeStudioUiRequest(name: string, input: unknown): StudioUiRequest {
	if (name === 'studio_capture_ui') { toolArguments(input, []); return { name }; }
	if (name !== 'studio_ui_input') throw new StudioToolInputError(`Unknown Studio UI tool: ${name}`);
	const value = toolArguments(input, ['capture', 'steps']);
	if (typeof value.capture !== 'string' || !Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > MAX_FRAMES) {
		throw new StudioToolInputError('UI input requires a capture receipt and a nonempty bounded step sequence.');
	}
	let frames = 0, events = 0;
	const steps: StudioUiInputStep[] = [];
	for (const inputStep of value.steps) {
		const step = toolArguments(inputStep, ['events', 'frames']);
		if (!Number.isSafeInteger(step.frames) || (step.frames as number) < 1 || !Array.isArray(step.events)) {
			throw new StudioToolInputError('Each UI step requires events and a positive integer frame count.');
		}
		frames += step.frames as number; events += step.events.length;
		if (frames > MAX_FRAMES || events > MAX_EVENTS) throw new StudioToolInputError('UI sequence exceeds 120 frames or 256 events.');
		steps.push({ frames: step.frames as number, events: step.events.map(decodeInputEvent) });
	}
	return { name, capture: value.capture, steps };
}

function decodeInputEvent(input: unknown): HostControlInputEvent {
	if (!input || typeof input !== 'object' || !('type' in input)) throw new StudioToolInputError('Expected a UI input event.');
	switch (input.type) {
		case 'key': {
			const event = toolArguments(input, ['type', 'code', 'down']);
			if (typeof event.code !== 'string' || !(hidKeyUsageForCode(event.code) >= 0) || event.down !== true && event.down !== false) break;
			return { type: 'key', code: event.code, down: event.down };
		}
		case 'pointer': {
			const event = toolArguments(input, ['type', 'x', 'y']);
			if (!Number.isSafeInteger(event.x) || !Number.isSafeInteger(event.y) || (event.x as number) < 0 || (event.y as number) < 0) break;
			return { type: 'pointer', x: event.x as number, y: event.y as number };
		}
		case 'button': {
			const event = toolArguments(input, ['type', 'button', 'down']);
			if (!BUTTONS.includes(event.button as typeof BUTTONS[number]) || event.down !== true && event.down !== false) break;
			return { type: 'button', button: event.button as typeof BUTTONS[number], down: event.down };
		}
		case 'wheel': {
			const event = toolArguments(input, ['type', 'deltaY']);
			if (!Number.isSafeInteger(event.deltaY)) break;
			return { type: 'wheel', deltaY: event.deltaY as number };
		}
	}
	throw new StudioToolInputError('Invalid UI input event.');
}
