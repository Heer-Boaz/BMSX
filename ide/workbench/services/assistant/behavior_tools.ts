import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import { SYSTEM_RESOURCE_DOMAIN, CARTRIDGE_RESOURCE_DOMAINS, type ResourceDomain } from '../../../common/resource';
import type { EditorTextEdit, EditorTextModel } from '../../../editor/model/text_model';
import { readLuaSourceRange } from '../../../language/lua/source_edits';
import { parseLuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import { resolveRuntimeResource, type RuntimeSourceState } from '../../../runtime/sources';
import type { BehaviorSourceDocuments } from '../../contrib/behavior_lens/source_documents';
import type { BehaviorRegistrationSource, BehaviorSourceNode } from '../../contrib/behavior_lens/model';
import { indexStateMachineSource } from '../../contrib/behavior_lens/state_machine_index';
import { createStateMachineInitialEdits, type StateMachineInitialTarget } from '../../contrib/behavior_lens/state_machine_initial';
import { indexBehaviorTreeMembers } from '../../contrib/behavior_lens/behavior_tree_index';
import type { BehaviorTreeSourceMember } from '../../contrib/behavior_lens/behavior_tree_model';
import { createBehaviorTreeChildDuplicateEdits, createBehaviorTreeChildMoveEdits, createBehaviorTreeChildRemovalEdits } from '../../contrib/behavior_lens/behavior_tree_edit';
import { indexActionEffectWrites, type EffectPropertyWrite } from '../../contrib/behavior_lens/action_effect_index';
import type { StateMachineSourceOutcome } from '../../contrib/behavior_lens/state_machine_model';
import type { WorkspaceSourceContext, CapturedWorkspaceSource } from '../working_copy/source_context';
import { decodeBehaviorToolRequest } from './behavior_tool_protocol';
import { StudioToolInputError } from './tool_input';

export type ToolBehaviorRegistration = Omit<BehaviorRegistrationSource, 'rowKey'> & { readonly behavior: string };
export type ToolBehaviorNode = Omit<BehaviorSourceNode, 'rowKey' | 'children'> & {
	readonly node: string; readonly children: readonly string[]; readonly actions: readonly string[];
	readonly write?: { readonly range: LuaSourceRange; readonly expression: string };
};
export type ToolBehaviorDocument = {
	readonly behavior: string; readonly syntaxComplete: boolean; readonly root: string;
	readonly sources: readonly { domain: ResourceDomain; path: string; version: number; readOnly: boolean }[];
	readonly nodes: readonly ToolBehaviorNode[];
	readonly entries: readonly { kind: 'initial' | 'concurrent'; owner: string; origin: string; target: { kind: 'state'; node: string } | Extract<StateMachineSourceOutcome['target'], { kind: 'unresolved' }> }[];
	readonly transitions: readonly { origin: string; node: string; kind: string; outcomes: readonly {
		proof: 'direct' | 'return'; range: LuaSourceRange; target: StateMachineSourceOutcome['target'];
	}[] }[];
};
export type BehaviorToolReadResult = { kind: 'behaviors'; data: readonly ToolBehaviorRegistration[] } | { kind: 'behavior'; data: ToolBehaviorDocument };
type BehaviorEdit = { kind: 'edit'; title: string; model: EditorTextModel; edits: readonly EditorTextEdit[] };
type NodeBinding = {
	readonly source: BehaviorSourceNode;
	readonly files: ReadonlyMap<string, CapturedWorkspaceSource>;
	readonly actions: readonly string[];
	readonly initial: StateMachineInitialTarget | undefined;
	readonly member: BehaviorTreeSourceMember | undefined;
	readonly write: EffectPropertyWrite | undefined;
};

/** Prompt-local references into the shared source generation, never a second behavior editor. */
export class WorkspaceBehaviorTools {
	private catalog: ToolBehaviorRegistration[] | undefined;
	private readonly registrations = new Map<string, BehaviorRegistrationSource>();
	private readonly reads = new Map<string, ToolBehaviorDocument>();
	private readonly nodes = new Map<string, NodeBinding>();

	public constructor(private readonly id: string, private readonly context: WorkspaceSourceContext,
		private readonly sources: RuntimeSourceState, private readonly documents: BehaviorSourceDocuments) {}

	public execute(name: string, input: unknown): BehaviorToolReadResult | BehaviorEdit {
		const request = decodeBehaviorToolRequest(name, input);
		switch (request.name) {
			case 'studio_list_behaviors': {
				if (this.catalog === undefined) {
					this.catalog = [];
					for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
						for (const registration of this.documents.registrations.getRegistrations(domain)) {
							const behavior = `${this.id}/behavior/${this.catalog.length}`;
							this.registrations.set(behavior, registration);
							// Do not serialize the registration's retained AST/semantic file.
							const { resource, behaviorKind, semanticId, label, range, occurrenceRange } = registration;
							this.catalog.push({ behavior, resource: { domain: resource.domain, path: resource.path }, behaviorKind, semanticId, label, range, occurrenceRange });
						}
					}
				}
				return { kind: 'behaviors', data: this.catalog };
			}
			case 'studio_read_behavior': return { kind: 'behavior', data: this.read(request.behavior) };
			case 'studio_propose_fsm_initial': {
				const { files, source, initial } = this.node(request.state, 'fsm.set_initial');
				const model = files.get(initial!.owner.file.file)!.model;
				return { kind: 'edit', title: `FSM initial: ${source.label}`, model, edits: createStateMachineInitialEdits(model.buffer, initial!) };
			}
			case 'studio_propose_bt_child_edit': {
				const { files, source, member } = this.node(request.child, `bt.${request.operation}`);
				const model = files.get(member!.file.file)!.model;
				const edits = request.operation === 'remove' ? createBehaviorTreeChildRemovalEdits(model.buffer, member!)
					: request.operation === 'duplicate' ? createBehaviorTreeChildDuplicateEdits(model.buffer, member!)
					: createBehaviorTreeChildMoveEdits(model.buffer, member!, member!.index + (request.operation === 'move_up' ? -1 : 1));
				return { kind: 'edit', title: `BT ${request.operation}: ${source.label}`, model, edits };
			}
			case 'studio_propose_effect_value': {
				const { files, source, write } = this.node(request.property, 'effect.set_value');
				const model = files.get(write!.file.file)!.model;
				const parsed = parseLuaFieldValueEdit(model.buffer, write!.file.chunk.locations, write!.field, request.expression);
				if ('error' in parsed) throw new StudioToolInputError(parsed.error);
				return { kind: 'edit', title: `Effect value: ${source.label}`, model, edits: [parsed.value.edit] };
			}
		}
	}

	private node(handle: string, action: string): NodeBinding {
		const binding = this.nodes.get(handle);
		if (binding === undefined) throw new StudioToolInputError('Source node handle does not belong to a behavior read in this context');
		if (!binding.actions.includes(action)) throw new StudioToolInputError(`Source occurrence does not admit ${action}`);
		return binding;
	}

	private read(handle: string): ToolBehaviorDocument {
		const existing = this.reads.get(handle);
		if (existing !== undefined) return existing;
		const registration = this.registrations.get(handle);
		if (registration === undefined) throw new StudioToolInputError('Behavior handle does not belong to this source context');
		const capture = (path: string) => {
			const resource = resolveRuntimeResource(this.sources, { domain: registration.resource.domain, path })!;
			return this.context.read(this.context.models.retain(resource, 'lua', resourceSourceForChunk(this.sources, resource)));
		};
		const root = capture(registration.resource.path);
		const document = this.documents.get(root.model);
		const definition = document.definitions.find(item => item.rowKey === registration.rowKey)!;
		const files = new Map(document.files.map(file => [file.file, capture(file.file)]));
		const ordered: BehaviorSourceNode[] = [], handles = new Map<string, string>();
		function collect(node: BehaviorSourceNode): void {
			handles.set(node.rowKey, `${handle}/node/${ordered.length}`); ordered.push(node);
			for (const child of node.children) collect(child);
		}
		collect(definition);
		const initialTargets = indexStateMachineSource(document).initialTargets;
		const members = definition.behaviorKind === 'behavior_tree' ? indexBehaviorTreeMembers(definition) : undefined;
		const writes = definition.behaviorKind === 'action_effect' ? indexActionEffectWrites(definition) : undefined;
		const nodes: ToolBehaviorNode[] = ordered.map(source => {
			const actions: string[] = [];
			const target = initialTargets.get(source.rowKey), member = members?.get(source.rowKey), write = writes?.get(source.rowKey);
			if (document.syntaxComplete) {
				if (target !== undefined && !files.get(target.owner.file.file)!.model.readOnly) actions.push('fsm.set_initial');
				if (member !== undefined && !files.get(member.file.file)!.model.readOnly) {
					actions.push('bt.remove', 'bt.duplicate');
					if (member.index > 0) actions.push('bt.move_up');
					if (member.index + 1 < member.branch.entries.length) actions.push('bt.move_down');
				}
				if (write !== undefined && !files.get(write.file.file)!.model.readOnly) actions.push('effect.set_value');
			}
			const { behaviorKind, kind, label, detail, authoredRange, referenceRange, occurrenceRange, resolution } = source;
			const range = write?.file.chunk.locations.range(write.field.value.span);
			const node = handles.get(source.rowKey)!;
			this.nodes.set(node, { source, files, actions, initial: target, member, write });
			return { node, behaviorKind, kind, label, detail, authoredRange, referenceRange, occurrenceRange, resolution,
				children: source.children.map(child => handles.get(child.rowKey)!), actions,
				write: range === undefined ? undefined : { range, expression: readLuaSourceRange(files.get(range.path)!.model.buffer, range) } };
		});
		const entries: ToolBehaviorDocument['entries'] = definition.behaviorKind !== 'state_machine' ? [] : definition.entries.map(entry => ({
			kind: entry.kind, owner: handles.get(entry.owner)!, origin: handles.get(entry.origin)!,
			target: entry.target.kind === 'state' ? { kind: 'state', node: handles.get(entry.target.rowKey)! } : entry.target,
		}));
		const transitions: ToolBehaviorDocument['transitions'] = definition.behaviorKind !== 'state_machine' ? [] : definition.transitions.map(transition => ({
			origin: handles.get(transition.origin.rowKey)!, node: handles.get(transition.slot.source.rowKey)!, kind: transition.slot.kind,
			outcomes: transition.outcomes.map(outcome => ({ proof: outcome.proof.kind,
				range: outcome.proof.file.chunk.locations.range(outcome.proof.kind === 'direct' ? outcome.proof.expression.span : outcome.proof.statement.span),
				target: outcome.target.kind !== 'path' ? outcome.target : { ...outcome.target, target: handles.get(outcome.target.target)!,
					steps: outcome.target.steps.map(step => ({ ...step, scope: handles.get(step.scope)!, target: handles.get(step.target)! })) },
			})),
		}));
		const data: ToolBehaviorDocument = { behavior: handle, syntaxComplete: document.syntaxComplete, root: handles.get(definition.rowKey)!, nodes, entries, transitions,
			sources: [...files.values()].map(({ model, version }) => ({ ...model.identity, version, readOnly: model.readOnly })) };
		this.reads.set(handle, data);
		return data;
	}
}
