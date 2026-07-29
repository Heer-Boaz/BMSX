import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../machine/ts/input/manager';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { OverlayRenderer } from '../runtime/overlay_renderer';

export function editorBlocksRuntimePipeline(editor: CartEditor): boolean {
	return editor.blocksRuntimePipeline;
}

export function isManagedOverlayEditorActive(editor: CartEditor): boolean {
	if (!editor.blocksRuntimePipeline) {
		return false;
	}
	return editor.isActive;
}

export function updateGamePipelineExts(
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	input: Input,
	audioOutput: HostAudioOutput,
): void {
	const overlayActive = editor.blocksRuntimePipeline && overlayRenderer.active;
	input.setGameplayCaptureEnabled(!overlayActive);
	audioOutput.muteUi(overlayActive);
}

export function toggleEditor(
	editor: CartEditor,
	sources: RuntimeSourceState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	input: Input,
	audioOutput: HostAudioOutput,
): void {
	if (editor.isActive) {
		deactivateEditor(editor, overlayRenderer, input, audioOutput);
		return;
	}
	activateEditor(editor, sources, overlayRenderer, runtime, input, audioOutput);
}

export function activateEditor(
	editor: CartEditor,
	sources: RuntimeSourceState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	input: Input,
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
	updateGamePipelineExts(editor, overlayRenderer, input, audioOutput);
}

export function deactivateEditor(
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	input: Input,
	audioOutput: HostAudioOutput,
): void {
	if (editor.isActive) {
		editor.deactivate();
	}
	overlayRenderer.abandonFrame();
	updateGamePipelineExts(editor, overlayRenderer, input, audioOutput);
}
