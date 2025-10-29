import type {
	RuntimeErrorDetails,
	RuntimeErrorOverlay,
	RuntimeErrorOverlayLineDescriptor,
	RuntimeErrorStackFrame
} from './types';

export function cloneRuntimeErrorDetails(details: RuntimeErrorDetails | null): RuntimeErrorDetails | null {
	if (!details) {
		return null;
	}
	const luaFrames: RuntimeErrorStackFrame[] = [];
	for (let i = 0; i < details.luaStack.length; i += 1) {
		const frame = details.luaStack[i];
		luaFrames.push({
			origin: frame.origin,
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
			raw: frame.raw,
			chunkAssetId: frame.chunkAssetId,
			chunkPath: frame.chunkPath,
		});
	}
	const jsFrames: RuntimeErrorStackFrame[] = [];
	for (let j = 0; j < details.jsStack.length; j += 1) {
		const frame = details.jsStack[j];
		jsFrames.push({
			origin: frame.origin,
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
			raw: frame.raw,
			chunkAssetId: frame.chunkAssetId,
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
}

function buildRuntimeErrorOverlayDescriptors(
	messageLines: string[],
	details: RuntimeErrorDetails | null,
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

function buildCombinedRuntimeErrorStack(details: RuntimeErrorDetails | null): RuntimeErrorStackFrame[] {
	if (!details) {
		return [];
	}
	const luaFrames: RuntimeErrorStackFrame[] = [];
	for (let index = 0; index < details.luaStack.length; index += 1) {
		luaFrames.push(details.luaStack[index]);
	}
	const jsFrames: RuntimeErrorStackFrame[] = [];
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
	const combined: RuntimeErrorStackFrame[] = [];
	for (let index = 0; index < luaFrames.length; index += 1) {
		combined.push(luaFrames[index]);
	}
	for (let index = 0; index < jsFrames.length; index += 1) {
		combined.push(jsFrames[index]);
	}
	return combined;
}

function formatRuntimeErrorStackFrame(frame: RuntimeErrorStackFrame): string {
    const originLabel = frame.origin === 'lua' ? 'Lua' : 'JS';
    let name = frame.functionName && frame.functionName.length > 0 ? frame.functionName : '';
    if (name.length === 0 && frame.source && frame.source.length > 0) {
        name = frame.source;
    }
    if (name.length === 0 && frame.raw.length > 0) {
        name = frame.raw;
    }
    if (name.length === 0) {
        name = '(anonymous)';
    }
    let location = '';
    if (frame.source && frame.source.length > 0) {
        location = frame.source;
    }
    if (frame.line !== null) {
        location = location.length > 0 ? `${location}:${frame.line}` : `${frame.line}`;
        if (frame.column !== null) {
            location += `:${frame.column}`;
        }
    }
    const suffix = location.length > 0 ? ` (${location})` : '';
    return `[${originLabel}] ${name}${suffix}`;
}
