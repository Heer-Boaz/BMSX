import type {
	RuntimeErrorDetails,
	RuntimeErrorOverlay,
	RuntimeErrorOverlayLineDescriptor
} from './types';
import type { StackTraceFrame } from '../../lua/luavalue';
import { ide_state } from './ide_state';
import { setActiveRuntimeErrorOverlay } from './vm_cart_editor';
import { collectRuntimeStackFrames, formatRuntimeStackFrame } from '../runtime_error_util';

export function cloneRuntimeErrorDetails(details: RuntimeErrorDetails): RuntimeErrorDetails {
	if (!details) {
		return null;
	}
	const luaFrames: StackTraceFrame[] = [];
	for (let i = 0; i < details.luaStack.length; i += 1) {
		const frame = details.luaStack[i];
		luaFrames.push({
			origin: frame.origin,
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
			raw: frame.raw,
			pathPath: frame.pathPath,
		});
	}
	const jsFrames: StackTraceFrame[] = [];
	for (let j = 0; j < details.jsStack.length; j += 1) {
		const frame = details.jsStack[j];
		jsFrames.push({
			origin: frame.origin,
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
			raw: frame.raw,
			pathPath: frame.pathPath,
		});
	}
	return {
		message: details.message,
		luaStack: luaFrames,
		jsStack: jsFrames,
	};
}

export function rebuildRuntimeErrorOverlayView(overlay: RuntimeErrorOverlay): void {
	const descriptors = buildRuntimeErrorOverlayDescriptors(overlay.messageLines, overlay.details, overlay.expanded);
	overlay.lineDescriptors = descriptors;
	const lines: string[] = [];
	for (let index = 0; index < descriptors.length; index += 1) {
		lines.push(descriptors[index].text);
	}
	overlay.lines = lines;
	overlay.layout = null;
	overlay.hovered = false;
	overlay.hoverLine = -1;
	overlay.copyButtonHovered = false;
}

function buildRuntimeErrorOverlayDescriptors(
	messageLines: string[],
	details: RuntimeErrorDetails,
	expanded: boolean
): RuntimeErrorOverlayLineDescriptor[] {
	const descriptors: RuntimeErrorOverlayLineDescriptor[] = [];
	for (let index = 0; index < messageLines.length; index += 1) {
		descriptors.push({ text: messageLines[index], role: 'message' });
	}
	if (!expanded) {
		return descriptors;
	}
	if (!details) {
		return descriptors;
	}
	const combinedStack = collectRuntimeStackFrames(details, true);
	if (combinedStack.length === 0) {
		return descriptors;
	}
	if (descriptors.length > 0) {
		descriptors.push({ text: '', role: 'divider' });
	}
	let headerText = 'Call Stack:';
	const hasLuaFrames = details.luaStack.length > 0;
	const hasJsFrames = details.jsStack.length > 0;
	if (hasLuaFrames && hasJsFrames) {
		headerText = 'Call Stack (Lua + JS):';
	} else if (hasLuaFrames) {
		headerText = 'Lua Call Stack:';
	} else if (hasJsFrames) {
		headerText = 'JS Call Stack:';
	}
	descriptors.push({ text: headerText, role: 'header' });
	for (let frameIndex = 0; frameIndex < combinedStack.length; frameIndex += 1) {
		const frame = combinedStack[frameIndex];
		const text = formatRuntimeStackFrame(frame);
		descriptors.push({ text, role: 'frame', frame });
	}
	return descriptors;
}

export function buildRuntimeErrorOverlayCopyText(overlay: RuntimeErrorOverlay): string {
	if (overlay.lineDescriptors.length > 0) {
		const buffer: string[] = [];
		for (let index = 0; index < overlay.lineDescriptors.length; index += 1) {
			buffer.push(overlay.lineDescriptors[index].text);
		}
		return buffer.join('\n');
	}
	if (overlay.lines.length > 0) {
		return overlay.lines.join('\n');
	}
	return 'Runtime error';
}

export function updateRuntimeErrorOverlay(deltaSeconds: number): void {
	const overlay = ide_state.runtimeErrorOverlay;
	if (!overlay) {
		return;
	}
	if (!Number.isFinite(overlay.timer)) {
		return;
	}
	overlay.timer -= deltaSeconds;
	if (overlay.timer <= 0) {
		setActiveRuntimeErrorOverlay(null);
	}
}
