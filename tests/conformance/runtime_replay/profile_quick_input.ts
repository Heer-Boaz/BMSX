import assert from 'node:assert/strict';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { configureFontVariant } from '../../../ide/editor/ui/view/view';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { QuickInputController } from '../../../ide/workbench/services/quick_input/controller';
import { medianMilliseconds } from '../../helpers/performance';

configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
const picker = new QuickInputController({ text: '', isSupported: () => false, writeText: async () => {} });
const accept = () => assert.fail('measuring layout must not execute a choice');
const FRAMES = 100000;
for (const count of [128, 1024, 8192]) {
	const items = Array.from({ length: count }, (_, index) => ({ label: `commands/independent/resource_${index}.lua`,
		description: 'independent source catalog', detail: `SLOT 0 / ${index}:1` }));
	const provide = () => items;
	const openMilliseconds = medianMilliseconds(() => picker.pick('Choose', 'Type a name', provide, accept));
	const rows = picker.model.list.rows, row = rows[0];
	const warm = medianMilliseconds(() => { for (let frame = 0; frame < FRAMES; frame += 1) picker.update(); });
	assert.equal(picker.model.list.rows, rows); assert.equal(rows[0], row);
	console.log(JSON.stringify({ count, openMilliseconds, warmedMicrosecondsPerFrame: warm * 1000 / FRAMES,
		preparedRows: picker.model.entries.filter(row => row.labelText.length !== 0).length }));
}
picker.dispose();
