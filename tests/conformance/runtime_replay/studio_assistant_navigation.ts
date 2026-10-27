import type { StudioFixture } from './studio_fixture';

/** Replace and submit through the real multiline composer, not a conversation/model shortcut. */
export async function submitAssistantText(test: StudioFixture, text: string, direct = false): Promise<void> {
	const input = test.ide.editor.editorParts.activeGroup.model.activeTab;
	if (input.kind !== 'assistant') throw new Error('Assistant composer required');
	await test.click(input.composerBounds);
	await test.press('ControlLeft', 'KeyA'); await test.clipboard.writeText(text);
	await test.press('ControlLeft', 'KeyV');
	if (direct) await test.press('ControlLeft', 'ShiftLeft', 'Enter');
	else await test.press('ControlLeft', 'Enter');
}
