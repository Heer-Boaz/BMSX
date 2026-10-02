import { LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { RuntimeResource, ResourceDomain } from '../../../common/resource';
import type { EditorTextModel, EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { editorTextModelService } from '../../../editor/model/model_service';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { luaSourceRangeToTextRange, createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import { createLuaTableFieldInsertionEdits, validateLuaTableFieldExpression } from '../../../language/lua/table_field_insertion';
import { mapTrackedTextRange } from '../../../editor/text/text_change';
import { resolveRuntimeResource, resolveRuntimeResourceForContext, type RuntimeSourceState } from '../../../runtime/sources';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { collectLuaPrograms, projectLuaProgram, type LuaProgramKind, type LuaProgramOccurrence } from './source';
import { LuaProgramInput } from './editor_input';
import { LuaProgramRuntimeProjection, readProgramInstances } from './runtime';
import { programFieldTemplates, programEntryTemplate } from './schema';
import type { HostRewind } from '../../../../hosts/common/rewind';

/** Source ownership and runtime readback meet in a retained input, never in a second program database. */
export class LuaProgramController {
	private readonly projections = new WeakMap<LuaProgramInput, LuaProgramRuntimeProjection>();
	private readonly unbindGuest: () => void;
	public constructor(private readonly sources: RuntimeSourceState, public readonly guest: SuspendedGuestSession,
		private readonly panes: EditorPanes, private readonly navigation: EditorNavigationController, public readonly quickInput: QuickInputController,
		private readonly rewind: HostRewind) {
		this.unbindGuest = guest.onDidInvalidate(reason => {
			if (reason !== 'execution' || this.rewind.seeking || this.rewind.playing) return;
			// Resolve snapshot bookmarks before a new branch can reuse discarded identities.
			for (const input of editorTabGroup.tabs) if (input.kind === 'lua_program' && input.historyRestorePending) {
				this.projections.get(input)?.refresh(input, true);
				input.historyRestorePending = false;
			}
		});
	}
	public dispose(): void { this.unbindGuest(); }
	public open(kind: LuaProgramKind): void {
		const choices: { label: string; description: string; detail: string; occurrence: LuaProgramOccurrence }[] = [];
		const snapshots = new Map<ResourceDomain, LuaSemanticWorkspaceSnapshot>();
		for (const resource of this.sources.luaResources) {
			let snapshot = snapshots.get(resource.domain);
			if (snapshot === undefined) {
				const project = getOrCreateSemanticProject(editorTextModelService, resource.domain);
				project.synchronizeRuntimeSources(this.sources);
				snapshot = project.getSnapshot(); snapshots.set(resource.domain, snapshot);
			}
			for (const occurrence of collectLuaPrograms(resource, snapshot)) {
				if (occurrence.kind !== kind) continue;
				choices.push({ label: `${resource.path}:${occurrence.file.chunk.locations.range(occurrence.call.expression.span).start.line}`,
					description: kind, detail: 'Canonical Lua / unsaved working copies included', occurrence });
			}
		}
		this.quickInput.pick(kind === 'progression' ? 'PROGRESSION PROGRAMS' : 'INPUT BINDINGS', 'Choose a producer call',
			() => new TextQuickPickProvider(choices), item => this.openOccurrence(item.occurrence));
	}
	public openResource(resource: RuntimeResource, kind: LuaProgramKind): void {
		const project = getOrCreateSemanticProject(editorTextModelService, resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const occurrence = collectLuaPrograms(resource, project.getSnapshot()).find(item => item.kind === kind)!;
		this.openOccurrence(occurrence);
	}
	public openOccurrence(occurrence: LuaProgramOccurrence): LuaProgramInput {
		const resource = resolveRuntimeResource(this.sources, occurrence.resource)!;
		const model = editorTextModelService.retain(resource, 'lua', resourceSourceForChunk(this.sources, resource));
		const span = luaSourceRangeToTextRange(model.buffer, occurrence.file.chunk.locations.range(occurrence.call.expression.span));
		let input = editorTabGroup.tabs.find((input): input is LuaProgramInput => input.kind === 'lua_program'
			&& input.workingCopy === model && input.programKind === occurrence.kind && input.occurrenceRange.start === span.start && input.occurrenceRange.end === span.end);
		if (input === undefined) {
			input = new LuaProgramInput(model, occurrence.kind, span, this.guest);
			this.refresh(input);
		}
		openEditorTab(this.panes, input);
		return input;
	}
	public refreshRuntime(input: LuaProgramInput): void {
		// Reconcile at the requested position, not an intermediate replay checkpoint.
		if (this.rewind.seeking) return;
		let projection = this.projections.get(input);
		if (projection === undefined) { projection = new LuaProgramRuntimeProjection(this.sources, this.guest); this.projections.set(input, projection); }
		projection.refresh(input);
	}
	public onDidChangeContent(model: EditorTextModel, event: EditorTextModelContentChangeEvent): void {
		for (const input of editorTabGroup.tabs) {
			if (input.kind !== 'lua_program') continue;
			if (input.sourceModels.get(model.resource.path) === model) input.invalidateProjection();
			if (input.workingCopy === model) mapTrackedTextRange(input.occurrenceRange, event.changes);
		}
	}
	public refresh(input: LuaProgramInput): void {
		const project = getOrCreateSemanticProject(editorTextModelService, input.workingCopy.resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const snapshot = project.getSnapshot();
		if (input.sourceRevision === snapshot.revision) return;
		input.sourceRevision = snapshot.revision;
		input.invalidateProjection();
		const occurrences = collectLuaPrograms(input.workingCopy.resource, snapshot);
		input.occurrence = occurrences.find(item => item.kind === input.programKind && (() => {
			const range = luaSourceRangeToTextRange(input.workingCopy.buffer, item.file.chunk.locations.range(item.call.expression.span));
			return range.start === input.occurrenceRange.start && range.end === input.occurrenceRange.end;
		})());
		if (input.occurrence === undefined) {
			input.tree.roots.length = 0; input.tree.rows.length = 0; input.tree.selectionIndex = -1;
			input.status = 'Producer call removed or incomplete; source and Undo remain available.';
			return;
		}
		const reader = new LuaSourceReader(snapshot);
		const usedModels = new Set([input.workingCopy]);
		projectLuaProgram(input.tree, input.occurrence, reader, file => {
			let model = input.sourceModels.get(file.file);
			if (model === undefined) {
				const resource = resolveRuntimeResourceForContext(this.sources, input.workingCopy.resource.domain, file.file)!;
				model = editorTextModelService.retain(resource, 'lua', resourceSourceForChunk(this.sources, resource));
				input.sourceModels.set(file.file, model);
			}
			usedModels.add(model);
			return model;
		});
		for (const [path, model] of input.sourceModels) if (!usedModels.has(model)) input.sourceModels.delete(path);
		input.publishModels();
		input.status = reader.syntaxComplete ? 'Authored Lua / Save and Hot Resume apply changes' : 'Incomplete syntax / source editing required';
	}
	public openSource(input: LuaProgramInput): void {
		const row = input.liveVisible ? undefined : input.tree.rows[input.tree.selectionIndex]?.element;
		const file = row?.file ?? input.occurrence?.file;
		const range = file === undefined ? undefined : file.chunk.locations.range((row?.expression ?? input.occurrence!.call.expression).span);
		this.navigation.focusChunkSourceForContext(input.workingCopy.resource.domain, file?.file ?? input.workingCopy.resource.path,
			range === undefined ? null : { row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 });
	}
	public chooseInstance(input: LuaProgramInput): void {
		input.running = false;
		this.quickInput.pick('LIVE PROGRAM INSTANCE', 'Actual mounted contexts / components; no source-ID guess', (_origin, lifetime) => {
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
			return new TextQuickPickProvider(readProgramInstances(this.sources, this.guest, input.workingCopy.resource.domain, input.programKind));
		}, item => {
			input.instance = item.identity; input.instanceLabel = item.label;
			input.programHashId = 0; input.stateHashId = 0; input.stateRevision = -1;
			input.liveVisible = true; input.liveDirty = true;
		});
	}
	public add(input: LuaProgramInput): void {
		const property = input.tree.rows[input.tree.selectionIndex]?.element ?? input.tree.roots[0]?.element;
		const target = property?.table;
		if (target === undefined || !target.structural) return;
		const model = input.sourceModels.get(target.file.file)!;
		const entry = programEntryTemplate(input.programKind, property.key);
		if (entry !== undefined) {
			const lifetime = this.quickInput.input('ADD ENTRY', 'Authored Lua table', entry,
				async text => validateLuaTableFieldExpression(text), value => model.pushEditOperations(
					createLuaTableFieldInsertionEdits(model.buffer, target.file.chunk, target.table, target.table.fields.length, value)));
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
			return;
		}
		const existing = new Set(target.table.fields.map(field => field.kind === LuaTableFieldKind.IdentifierKey ? field.name : ''));
		const choices = programFieldTemplates(input.programKind, property.key).filter(item => !existing.has(item.name))
			.map(item => ({ ...item, label: item.name, description: '', detail: item.value }));
		choices.push({ name: '', value: '', label: 'Custom field', description: 'Lua table field', detail: 'Handlers, event matchers, custom commands and authored extensions' });
		this.quickInput.pick('ADD PROPERTY', 'Canonical Lua table field', (_origin, lifetime) => {
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
			return new TextQuickPickProvider(choices);
		}, item => {
			const lifetime = this.quickInput.input(item.label, item.name === '' ? 'Complete Lua field: name = expression or [key] = expression' : 'Lua expression', item.value,
				async text => {
					if (item.name !== '') return `${item.name} = ${validateLuaTableFieldExpression(text)}`;
					// Admit a complete authored table field through the same Lua grammar as source insertion.
					validateLuaTableFieldExpression(`{ ${text} }`);
					return text;
				}, value => model.pushEditOperations(
					createLuaTableFieldInsertionEdits(model.buffer, target.file.chunk, target.table, target.table.fields.length, value)));
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
		});
	}
	public remove(input: LuaProgramInput): void {
		const property = input.tree.rows[input.tree.selectionIndex].element;
		input.tree.selectionIndex = -1;
		input.sourceModels.get(property.file.file)!.pushEditOperations(createLuaTableFieldRemovalEdits(
			input.sourceModels.get(property.file.file)!.buffer, property.file.chunk.locations, property.file.chunk.tokens, property.field!));
	}
}
