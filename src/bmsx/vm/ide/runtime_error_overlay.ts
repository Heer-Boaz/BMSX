import type {
	RuntimeErrorDetails,
	RuntimeErrorOverlay,
	RuntimeErrorOverlayLineDescriptor
} from './types';
import type { StackTraceFrame } from '../../lua/luavalue';
import { ide_state } from './ide_state';
import { setActiveRuntimeErrorOverlay } from './vm_cart_editor';

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
			chunkPath: frame.chunkPath,
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
			chunkPath: frame.chunkPath,
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
	const combinedStack = buildCombinedRuntimeErrorStack(details);
	if (combinedStack.length === 0) {
		return descriptors;
	}
	if (descriptors.length > 0) {
		descriptors.push({ text: '', role: 'divider' });
	}
	let headerText = 'Call Stack:';
	const hasLuaFrames = details !== null && details.luaStack.length > 0;
	const hasJsFrames = details !== null && details.jsStack.length > 0;
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
		const text = formatRuntimeErrorStackFrame(frame);
		descriptors.push({ text, role: 'frame', frame });
	}
	return descriptors;
}

function buildCombinedRuntimeErrorStack(details: RuntimeErrorDetails): StackTraceFrame[] {
	if (!details) {
		return [];
	}
	const luaFrames: StackTraceFrame[] = [];
	for (let index = 0; index < details.luaStack.length; index += 1) {
		luaFrames.push(details.luaStack[index]);
	}
	const jsFrames: StackTraceFrame[] = [];
	for (let index = 0; index < details.jsStack.length; index += 1) {
		jsFrames.push(details.jsStack[index]);
	}
	if (luaFrames.length === 0 && jsFrames.length === 0) {
		return [];
	}
	if (luaFrames.length === 0) {
		return jsFrames.slice();
	}
	if (jsFrames.length === 0) {
		return luaFrames.slice();
	}
	const combined: StackTraceFrame[] = [];
	for (let index = 0; index < luaFrames.length; index += 1) {
		combined.push(luaFrames[index]);
	}
	for (let index = 0; index < jsFrames.length; index += 1) {
		combined.push(jsFrames[index]);
	}
	return combined;
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

function formatRuntimeErrorStackFrame(frame: StackTraceFrame): string {
	const originLabel = frame.origin === 'lua' ? '' : 'JS'; // Make Lua the default and only label JS frames
	let name = frame.functionName && frame.functionName.length > 0 ? frame.functionName : '';
	if (name.length === 0) {
		if (frame.source?.length > 0) {
			name = frame.source;
		}
		else if (frame.raw?.length > 0) {
			name = frame.raw;
		}
		else {
			name = '(anonymous)';
		}
	}
	let location = '';
	if (frame?.source.length > 0) {
		location = frame.source;
	}
	if (frame.line !== null) {
		location = location.length > 0 ? `${location}:${frame.line}` : `${frame.line}`;
		if (frame.column !== null) {
			location += `:${frame.column}`;
		}
	}
	const suffix = location.length > 0 ? `(${location})` : '';
	if (originLabel.length === 0) {
		return `${name}${suffix}`;
	}
	return `[${originLabel}] ${name}${suffix}`;
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
