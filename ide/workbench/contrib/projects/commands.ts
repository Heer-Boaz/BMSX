import type { CartEditor } from '../../../cart_editor';
import { showEditorMessage } from '../../../common/feedback_state';
import { COLOR_STATUS_ERROR, COLOR_STATUS_SUCCESS } from '../../../common/constants';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';

export function createCartridge(editor: CartEditor): void {
	editor.quickInput.input('New cartridge', 'New folder in carts/; existing projects are never overwritten', '',
		target => editor.projects!.createCartridge(target), project => {
			showEditorMessage(`Created ${project.projectRoot}`, COLOR_STATUS_SUCCESS, 5);
			if (editor.builds === undefined) return;
			editor.quickInput.pick('Cartridge created', 'Build it, then open the published result in Build Jobs', () => new TextQuickPickProvider([
				{ label: 'Build new cartridge', description: project.target, detail: 'Debug -O3 with matching BIOS; current runtime stays unchanged', build: true },
				{ label: 'Keep project without building', description: project.projectRoot, detail: '', build: false },
			]), choice => {
				if (!choice.build) return;
				void editor.builds!.submit(project.target, true, 3).then(() => {
					showEditorMessage(`Build accepted: ${project.target}. See Studio: Build Jobs.`, COLOR_STATUS_SUCCESS, 5);
				}).catch(error => showEditorMessage(String(error), COLOR_STATUS_ERROR, 8));
			});
		});
}
