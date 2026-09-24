import type { TestDebugger } from '../../../testing/debugger';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';

/** Compiled-image breakpoint editor, independent of the authoring gutter and working copies. */
export function openTestDebugSources(quickInput: QuickInputController, debug: TestDebugger, report: (text: string) => void): void {
	quickInput.pick('COMPILED TEST SOURCES', 'Choose a source to read and toggle a breakpoint', (_origin, lifetime) => {
		lifetime.add({ dispose: debug.onDidChange(() => { if (debug.status === 'closed' || debug.status === 'finished') quickInput.hide(); }) });
		return new TextQuickPickProvider(debug.sources.catalog.map(source => ({ ...source, label: source.path,
			description: `Physical ${source.domain} / authored ${source.sourceDomain}`, detail: source.symbols ? 'Compiled symbols' : 'No symbols' })));
	}, source => {
		const compiled = debug.sources.read(source.source), points = new Map(compiled.breakpoints.map(point => [point.line, point]));
		quickInput.pick(`TEST SOURCE / ${source.path}`, 'Select a compiled line to toggle its breakpoint; blank lines stay unbound', (_origin, lifetime) => {
			lifetime.add({ dispose: debug.onDidChange(() => { if (debug.status === 'closed' || debug.status === 'finished') quickInput.hide(); }) });
			return new TextQuickPickProvider(compiled.text.split('\n').map((text, index) => ({ line: index + 1,
				label: `${index + 1}: ${text}`, description: points.get(index + 1)?.status ?? '', detail: '' })));
		}, item => {
			// Read current requests, not the picker snapshot: another client may have edited them meanwhile.
			const current = debug.sources.read(source.source).breakpoints, present = current.some(point => point.line === item.line);
			const lines = current.filter(point => point.line !== item.line).map(point => point.line);
			if (!present) lines.push(item.line);
			const bound = debug.sources.setBreakpoints(source.source, lines);
			report(`${source.path}:${item.line} / ${present ? 'REMOVED' : bound.find(point => point.line === item.line)!.status.toUpperCase()}`);
		});
	});
}
