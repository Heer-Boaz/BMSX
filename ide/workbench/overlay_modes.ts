import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { OverlayRenderer } from '../runtime/overlay_renderer';

export function toggleEditor(
	editor: CartEditor,
	sources: RuntimeSourceState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
): void {
	if (editor.isActive) {
		deactivateEditor(editor, overlayRenderer, audioOutput);
		return;
	}
	activateEditor(editor, sources, runtime, audioOutput);
}

export function activateEditor(
	editor: CartEditor,
	sources: RuntimeSourceState,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
): void {
	if (!blua32ToolingImageForDomain(
		sources.currentBlua32Media,
		runtime.machine.cpu.activeCartridgeSlot(),
	)?.symbols) {
		return;
	}
	if (!editor.isActive) {
		editor.activate();
	}
	audioOutput.muteUi(editor.executionSuspended);
}

export function deactivateEditor(
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	audioOutput: HostAudioOutput,
): void {
	if (editor.isActive) {
		editor.deactivate();
	}
	overlayRenderer.abandonFrame();
	audioOutput.muteUi(editor.executionSuspended);
}
