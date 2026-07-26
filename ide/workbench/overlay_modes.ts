import { blua32ToolingImageForDomain } from '../runtime/blua32_media';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { Input } from '../../machine/ts/input/manager';
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
): void {
	const overlayActive = editor.blocksRuntimePipeline && overlayRenderer.active;
	Input.instance.setGameplayCaptureEnabled(!overlayActive);
	updateOverlayAudioSuspension(overlayActive);
}

function updateOverlayAudioSuspension(overlayActive: boolean): void {
	if (!machineManager.sndmaster.isRuntimeAudioReady()) {
		return;
	}
	if (overlayActive) {
		machineManager.sndmaster.suspendAll('overlay');
	} else {
		machineManager.sndmaster.resumeAll('overlay');
	}
}

export function toggleEditor(
	editor: CartEditor,
	sources: RuntimeSourceState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
): void {
	if (editor.isActive) {
		deactivateEditor(editor, overlayRenderer);
		return;
	}
	activateEditor(editor, sources, overlayRenderer, runtime);
}

export function activateEditor(
	editor: CartEditor,
	sources: RuntimeSourceState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
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
	updateGamePipelineExts(editor, overlayRenderer);
}

export function deactivateEditor(editor: CartEditor, overlayRenderer: OverlayRenderer): void {
	if (editor.isActive) {
		editor.deactivate();
	}
	overlayRenderer.abandonFrame();
	updateGamePipelineExts(editor, overlayRenderer);
}
