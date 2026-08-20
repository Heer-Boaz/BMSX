import type { RuntimeErrorDetails } from '../../../runtime/fault_state';
import { formatRuntimeStackFrame } from '../../../runtime/error_format';
import type {
	RuntimeErrorOverlay,
	RuntimeErrorOverlayLineDescriptor,
} from './model';

export function rebuildRuntimeErrorOverlayView(overlay: RuntimeErrorOverlay): void {
	const descriptors = buildRuntimeErrorOverlayDescriptors(
		overlay.messageLines,
		overlay.details,
		overlay.expanded,
	);
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
	expanded: boolean,
): RuntimeErrorOverlayLineDescriptor[] {
	const descriptors: RuntimeErrorOverlayLineDescriptor[] = [];
	for (let index = 0; index < messageLines.length; index += 1) {
		descriptors.push({ text: messageLines[index], role: 'message' });
	}
	if (!expanded || !details || details.luaStack.length === 0) {
		return descriptors;
	}
	if (descriptors.length > 0) {
		descriptors.push({ text: '', role: 'divider' });
	}
	descriptors.push({ text: 'Lua Call Stack:', role: 'header' });
	for (let frameIndex = 0; frameIndex < details.luaStack.length; frameIndex += 1) {
		const frame = details.luaStack[frameIndex];
		const descriptor: RuntimeErrorOverlayLineDescriptor = {
			text: formatRuntimeStackFrame(frame),
			role: 'frame',
		};
		if (frame.resource) {
			descriptor.frame = frame;
		}
		descriptors.push(descriptor);
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
