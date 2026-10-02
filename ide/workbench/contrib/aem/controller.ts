import { isMap, isSeq } from 'yaml';
import { showEditorWarningBanner } from '../../../common/feedback_state';
import { aemDocumentFormat } from '../../../../toolchain/ts/rompack/aem';
import { createStructuredInsertionEdit, createStructuredRemovalEdit, type StructuredCollection } from '../../../language/yaml/structured_edits';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { RuntimeResource } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { resolveTextFileModel } from '../../services/working_copy/text_file_model';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { openEditorTab } from '../../ui/tabs';
import { resolveTextCodeEditorInput } from '../../ui/code_tab/io';
import { AemEditorInput } from './editor_input';
import { aemFieldTemplates, aemSequenceTemplate, aemSequenceValueTemplate } from './schema';

export async function resolveAemEditorInput(sources: RuntimeSourceState, resource: RuntimeResource): Promise<AemEditorInput> {
	return new AemEditorInput(await resolveTextFileModel(editorTextModelService, sources, resource));
}

export class AemEditorController {
	public constructor(private readonly sources: RuntimeSourceState, private readonly panes: EditorPanes,
		public readonly quickInput: QuickInputController) {}
	public open(): void {
		this.quickInput.pick('AUDIO EVENT MAPS', 'Canonical YAML / JSON', () => new TextQuickPickProvider(this.sources.resources
			.filter(resource => resource.source.type === 'aem').map(resource => ({ label: resource.path, description: `CART ${resource.domain}`, detail: '', resource }))),
			item => {
				const generation = this.panes.beginOpen();
				void resolveAemEditorInput(this.sources, item.resource).then(input => {
					if (this.panes.openGeneration === generation) openEditorTab(this.panes, input);
					else input.dispose();
				}, error => showEditorWarningBanner(`Cannot open audio map: ${error instanceof Error ? error.message : String(error)}`));
			});
	}
	public openSource(input: AemEditorInput): void {
		const selected = input.tree.rows[input.tree.selectionIndex]?.element;
		const position = { row: 0, column: 0 };
		if (selected !== undefined) input.workingCopy.buffer.positionAt(selected.node.range![0], position);
		const generation = this.panes.beginOpen();
		void resolveTextCodeEditorInput(this.sources, input.workingCopy.resource).then(code => {
			if (this.panes.openGeneration === generation) openEditorTab(this.panes, code,
				{ selection: { row: position.row, startColumn: position.column, endColumn: position.column } });
			else code.dispose();
		}, error => showEditorWarningBanner(`Cannot open audio source: ${error instanceof Error ? error.message : String(error)}`));
	}
	public audioIds(input: AemEditorInput): readonly string[] {
		const resourcePackage = input.workingCopy.resource.domain === -1 ? this.sources.systemPackage : this.sources.cartridgeSlots[input.workingCopy.resource.domain]!.package;
		return Object.keys(resourcePackage.audio);
	}
	public add(input: AemEditorInput): void {
		const property = input.tree.rows[input.tree.selectionIndex]?.element ?? input.tree.roots[0].element;
		const collection = property.node as StructuredCollection;
		const format = aemDocumentFormat(input.workingCopy.resource.path);
		const insertion = (value: string, name?: string) => createStructuredInsertionEdit(input.source, format, collection, value, name);
		if (property.path.length === 1 && property.path[0] === 'events') {
			const lifetime = this.quickInput.input('NEW AUDIO EVENT', 'Event name', 'game.effect', async name => {
				if (collection.has(name)) throw new Error(`Event '${name}' already exists.`);
				return name;
			}, name => {
				this.quickInput.pick('EVENT AUDIO', 'Real cartridge audio asset', (_origin, lifetime) => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
					return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
				}, audio => input.workingCopy.pushEditOperations([insertion(JSON.stringify({ channel: 'sfx', rules: [{ go: { audio_id: audio.label } }] }), name)]));
			});
			lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
			return;
		}
		if (isSeq(collection)) {
			const value = aemSequenceValueTemplate(property.path);
			if (value !== undefined) {
				const lifetime = this.quickInput.input('NEW VALUE', 'YAML / JSON value', value,
					async text => insertion(text), edit => input.workingCopy.pushEditOperations([edit]));
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
				return;
			}
			this.quickInput.pick('RULE / ACTION AUDIO', 'Choose an actual asset for the new action', (_origin, lifetime) => {
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
			}, audio => {
				const lifetime = this.quickInput.input('NEW AUDIO RULE / ACTION', 'YAML / JSON value', aemSequenceTemplate(property.path, audio.label),
					async text => insertion(text), edit => input.workingCopy.pushEditOperations([edit]));
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
			});
			return;
		}
		const choices = aemFieldTemplates(property.path, collection).filter(item => !collection.has(item.name))
			.map(item => ({ ...item, label: item.name, description: '', detail: item.value }));
		choices.push({ name: '', value: '{}', label: 'Custom property', description: 'Authored map key', detail: 'Event payload names or schema extensions' });
		this.quickInput.pick('ADD AUDIO PROPERTY', 'Authored event / rule / action', (_origin, lifetime) => {
			lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
			return new TextQuickPickProvider(choices);
		}, item => {
			if (item.name === 'audio_id') {
				this.quickInput.pick('ACTION AUDIO', 'Real cartridge audio asset', (_origin, lifetime) => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
					return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
				}, audio => input.workingCopy.pushEditOperations([insertion(JSON.stringify(audio.label), item.name)]));
				return;
			}
			if (item.name === '') {
				const lifetime = this.quickInput.input('PROPERTY NAME', 'Authored map key', '', async name => {
					if (collection.has(name)) throw new Error(`Property '${name}' already exists.`);
					return name;
				}, name => {
					const lifetime = this.quickInput.input(name, 'YAML / JSON value', '{}', async text => insertion(text, name), edit => input.workingCopy.pushEditOperations([edit]));
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
				});
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
				return;
			}
			const lifetime = this.quickInput.input(item.name, 'YAML / JSON value', item.value,
				async text => insertion(text, item.name), edit => input.workingCopy.pushEditOperations([edit]));
			lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
		});
	}
	public remove(input: AemEditorInput): void {
		const property = input.tree.rows[input.tree.selectionIndex].element;
		input.tree.selectionIndex = -1;
		input.workingCopy.pushEditOperations([createStructuredRemovalEdit(input.source, property.parent!, property.index!)]);
	}
	public canAdd(input: AemEditorInput): boolean {
		const property = input.tree.rows[input.tree.selectionIndex]?.element ?? input.tree.roots[0]?.element;
		return !input.workingCopy.readOnly && property !== undefined && (isMap(property.node) || isSeq(property.node));
	}
}
