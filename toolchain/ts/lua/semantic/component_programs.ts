import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaCallExpression,
	type LuaExpression,
	type LuaTableConstructorExpression,
	type LuaTableField,
} from '../syntax/ast';
import { walkLuaExpressionTree } from '../syntax/ast/traversal';
import type { StaticStringSource, SymbolID } from './model';
import {
	appendValueElement,
	appendValueMember,
	declarationValueSource,
	semanticValueSourceKey,
	tableValueSource,
	type SemanticValueSource,
} from './value_graph';

export type ComponentProgramKind = 'state_machine' | 'behaviour_tree';

export type ComponentProgramMountEntry = {
	programKind: ComponentProgramKind;
	programId: StaticStringSource;
	classDeclId: SymbolID;
};

export type ComponentProgramCallbackEntry = {
	programKind: ComponentProgramKind;
	programId: StaticStringSource;
	callee: SemanticValueSource;
	receiverPath?: readonly string[];
};

type ComponentFactoryKind = ComponentProgramKind | undefined;

type StaticExpressionDeclaration = {
	id: SymbolID;
	constantInitializer?: LuaExpression;
};

export interface ComponentProgramSemanticHost {
	readonly file: string;
	classifyComponentFactory(callExpression: LuaCallExpression): ComponentFactoryKind;
	resolveConstantStringSource(expression: LuaExpression): StaticStringSource | undefined;
	resolveStaticExpressionDeclaration(expression: LuaExpression): StaticExpressionDeclaration | undefined;
	resolveMemberValueSource(owner: SemanticValueSource, name: string): SemanticValueSource;
	resolveExpressionValueSource(expression: LuaExpression): SemanticValueSource | undefined;
}

const BEHAVIOUR_TREE_TASK_CALLBACK_MEMBERS: readonly string[] = ['execute', 'tick', 'abort'];
const BEHAVIOUR_TREE_SERVICE_CALLBACK_MEMBERS: readonly string[] = [
	'on_search_start',
	'on_become_relevant',
	'on_tick',
	'on_cease_relevant',
];
const BEHAVIOUR_TREE_DECORATOR_CALLBACK_MEMBERS: readonly string[] = ['evaluate'];
const TABLE_ROLE_BEHAVIOUR_TREE = 1;
const TABLE_ROLE_STATE = 2;
const TABLE_ROLE_STATES = 3;
const TABLE_ROLE_TRANSITIONS = 4;
const TABLE_ROLE_TRANSITION = 5;
const TABLE_ROLE_INPUT_HANDLERS = 6;
const TABLE_ROLE_GUARDS = 7;
const TABLE_ROLE_TIMELINES = 8;
const TABLE_ROLE_TIMELINE = 9;
const TABLE_ROLE_TIMELINE_DEFINITION = 10;

type ComponentProgramTableRole =
	| typeof TABLE_ROLE_BEHAVIOUR_TREE
	| typeof TABLE_ROLE_STATE
	| typeof TABLE_ROLE_STATES
	| typeof TABLE_ROLE_TRANSITIONS
	| typeof TABLE_ROLE_TRANSITION
	| typeof TABLE_ROLE_INPUT_HANDLERS
	| typeof TABLE_ROLE_GUARDS
	| typeof TABLE_ROLE_TIMELINES
	| typeof TABLE_ROLE_TIMELINE
	| typeof TABLE_ROLE_TIMELINE_DEFINITION;

type ComponentProgramScan = {
	programKind: ComponentProgramKind;
	programId: StaticStringSource;
	retainedCallbacks: Set<string>;
	visitedTables: Set<string>;
};

type ResolvedComponentProgramTable = {
	table: LuaTableConstructorExpression;
	owner: SemanticValueSource;
};

type AssignedMember = {
	name: string;
	declId: SymbolID;
	expression: LuaExpression;
};

// Declarative component programs invoke authored callbacks with the mounted
// object as their first argument. Retain that runtime contract as ordinary
// call edges so parameter and return inference stay owned by the value graph.
export class ComponentProgramSemanticCollector {
	public readonly mounts: ComponentProgramMountEntry[] = [];
	public readonly callbacks: ComponentProgramCallbackEntry[] = [];
	private readonly tableInitializerByDeclId: Map<SymbolID, LuaTableConstructorExpression> = new Map();
	private readonly assignedMembersByOwner: Map<string, AssignedMember[]> = new Map();

	constructor(private readonly host: ComponentProgramSemanticHost) {}

	public recordTableInitializer(declId: SymbolID, table: LuaTableConstructorExpression): void {
		this.tableInitializerByDeclId.set(declId, table);
	}

	public recordMemberAssignment(
		owner: SemanticValueSource,
		name: string,
		declId: SymbolID,
		expression: LuaExpression,
	): void {
		const ownerKey = semanticValueSourceKey(owner);
		let members = this.assignedMembersByOwner.get(ownerKey);
		if (!members) {
			members = [];
			this.assignedMembersByOwner.set(ownerKey, members);
		}
		for (let index = 0; index < members.length; index += 1) {
			const member = members[index];
			if (member.declId === declId && member.expression === expression) {
				return;
			}
		}
		members.push({ name, declId, expression });
	}

	public recordProgram(
		programKind: ComponentProgramKind,
		programId: StaticStringSource,
		definition: LuaExpression,
	): void {
		const scan: ComponentProgramScan = {
			programKind,
			programId,
			retainedCallbacks: new Set(),
			visitedTables: new Set(),
		};
		this.scanTable(
			definition,
			undefined,
			programKind === 'state_machine' ? TABLE_ROLE_STATE : TABLE_ROLE_BEHAVIOUR_TREE,
			scan,
		);
	}

	public recordMounts(descriptor: LuaTableConstructorExpression, classDeclId: SymbolID): void {
		for (let fieldIndex = 0; fieldIndex < descriptor.fields.length; fieldIndex += 1) {
			const field = descriptor.fields[fieldIndex];
			if (field.kind !== LuaTableFieldKind.IdentifierKey || field.name !== 'components') {
				continue;
			}
			walkLuaExpressionTree(field.value, expression => {
				if (expression.kind !== LuaSyntaxKind.CallExpression) {
					return expression.kind === LuaSyntaxKind.FunctionExpression ? false : undefined;
				}
				const programKind = this.host.classifyComponentFactory(expression);
				if (programKind === 'behaviour_tree') {
					const programExpression = expression.arguments[0];
					const programId = programExpression
						? this.host.resolveConstantStringSource(programExpression)
						: undefined;
					if (programId) {
						this.mounts.push({ programKind, programId, classDeclId });
					}
					return false;
				}
				if (programKind !== 'state_machine') {
					return undefined;
				}
				const programList = expression.arguments[0];
				if (!programList || programList.kind !== LuaSyntaxKind.TableConstructorExpression) {
					return false;
				}
				for (let programIndex = 0; programIndex < programList.fields.length; programIndex += 1) {
					const programField = programList.fields[programIndex];
					if (programField.kind !== LuaTableFieldKind.Array) {
						continue;
					}
					const programId = this.host.resolveConstantStringSource(programField.value);
					if (programId) {
						this.mounts.push({ programKind, programId, classDeclId });
					}
				}
				return false;
			});
			return;
		}
	}

	private scanTable(
		expression: LuaExpression,
		tableOwner: SemanticValueSource | undefined,
		role: ComponentProgramTableRole,
		scan: ComponentProgramScan,
		receiverPath?: readonly string[],
	): boolean {
		const resolved = this.resolveTable(expression, tableOwner);
		if (!resolved) {
			return false;
		}
		let tableKey = `${role}\0${resolved.table.range.start.line}\0${resolved.table.range.start.column}`
			+ `\0${semanticValueSourceKey(resolved.owner)}`;
		if (receiverPath) {
			for (let index = 0; index < receiverPath.length; index += 1) {
				tableKey += `\0${receiverPath[index]}`;
			}
		}
		if (scan.visitedTables.has(tableKey)) {
			return true;
		}
		scan.visitedTables.add(tableKey);
		switch (role) {
			case TABLE_ROLE_BEHAVIOUR_TREE:
				this.scanBehaviourTree(resolved.table, resolved.owner, scan);
				break;
			case TABLE_ROLE_STATE:
				this.scanState(resolved.table, resolved.owner, scan);
				break;
			case TABLE_ROLE_STATES:
				this.scanStates(resolved.table, resolved.owner, scan);
				break;
			case TABLE_ROLE_TRANSITIONS:
				this.scanTransitions(resolved.table, resolved.owner, scan);
				break;
			case TABLE_ROLE_TRANSITION:
				this.scanTransition(resolved.table, resolved.owner, scan);
				break;
			case TABLE_ROLE_INPUT_HANDLERS:
				this.scanInputHandlers(resolved.table, scan);
				break;
			case TABLE_ROLE_GUARDS:
				this.scanGuards(resolved.table, resolved.owner, scan);
				break;
			case TABLE_ROLE_TIMELINES:
				this.scanTimelines(resolved.table, resolved.owner, scan);
				break;
			case TABLE_ROLE_TIMELINE:
				this.scanTimeline(resolved.table, resolved.owner, scan);
				break;
			case TABLE_ROLE_TIMELINE_DEFINITION:
				this.scanTimelineDefinition(resolved.table, resolved.owner, scan, receiverPath);
				break;
		}
		return true;
	}

	private resolveTable(
		expression: LuaExpression,
		tableOwner: SemanticValueSource | undefined,
	): ResolvedComponentProgramTable | undefined {
		if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
			return {
				table: expression,
				owner: tableOwner ?? tableValueSource(
					this.host.file,
					expression.range.start.line,
					expression.range.start.column,
				),
			};
		}
		const decl = this.host.resolveStaticExpressionDeclaration(expression);
		if (!decl) {
			return undefined;
		}
		const table = this.tableInitializerByDeclId.get(decl.id);
		if (table) {
			return { table, owner: declarationValueSource(decl.id) };
		}
		return decl.constantInitializer
			? this.resolveTable(decl.constantInitializer, undefined)
			: undefined;
	}

	private scanBehaviourTree(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			const fieldName = staticTableFieldName(field);
			const fieldOwner = fieldName ? this.host.resolveMemberValueSource(owner, fieldName) : undefined;
			if (fieldName && fieldOwner) {
				switch (fieldName) {
					case 'task':
						this.recordCallbackMembers(fieldOwner, BEHAVIOUR_TREE_TASK_CALLBACK_MEMBERS, scan);
						continue;
					case 'service':
						this.recordCallbackMembers(fieldOwner, BEHAVIOUR_TREE_SERVICE_CALLBACK_MEMBERS, scan);
						continue;
					case 'decorator':
						this.recordCallbackMembers(fieldOwner, BEHAVIOUR_TREE_DECORATOR_CALLBACK_MEMBERS, scan);
						continue;
				}
			}
			this.scanTable(field.value, fieldOwner, TABLE_ROLE_BEHAVIOUR_TREE, scan);
		}
	}

	private scanState(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			const fieldName = staticTableFieldName(field);
			if (!fieldName) {
				continue;
			}
			this.scanStateMember(
				fieldName,
				field.value,
				this.host.resolveMemberValueSource(owner, fieldName),
				scan,
			);
		}
		this.scanAssignedStateMembers(owner, scan);
	}

	private scanStates(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			const fieldName = staticTableFieldName(field);
			this.scanTable(
				field.value,
				fieldName ? this.host.resolveMemberValueSource(owner, fieldName) : undefined,
				TABLE_ROLE_STATE,
				scan,
			);
		}
		this.scanAssignedStates(owner, scan);
		this.scanAssignedStateMembers(appendValueElement(owner), scan);
	}

	private scanAssignedStates(owner: SemanticValueSource, scan: ComponentProgramScan): void {
		const members = this.assignedMembersByOwner.get(semanticValueSourceKey(owner));
		if (!members) {
			return;
		}
		for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
			const member = members[memberIndex];
			this.scanTable(
				member.expression,
				declarationValueSource(member.declId),
				TABLE_ROLE_STATE,
				scan,
			);
		}
	}

	private scanAssignedStateMembers(owner: SemanticValueSource, scan: ComponentProgramScan): void {
		const members = this.assignedMembersByOwner.get(semanticValueSourceKey(owner));
		if (!members) {
			return;
		}
		for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
			const member = members[memberIndex];
			this.scanStateMember(
				member.name,
				member.expression,
				declarationValueSource(member.declId),
				scan,
			);
		}
	}

	private scanStateMember(
		name: string,
		expression: LuaExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		switch (name) {
			case 'entering_state':
			case 'exiting_state':
			case 'update':
				this.recordCallback(owner, expression, scan);
				break;
			case 'states':
				this.scanTable(expression, owner, TABLE_ROLE_STATES, scan);
				break;
			case 'on':
				this.scanTable(expression, owner, TABLE_ROLE_TRANSITIONS, scan);
				break;
			case 'input_event_handlers':
				this.scanTable(expression, owner, TABLE_ROLE_INPUT_HANDLERS, scan);
				break;
			case 'transition_guards':
				this.scanTable(expression, owner, TABLE_ROLE_GUARDS, scan);
				break;
			case 'timelines':
				this.scanTable(expression, owner, TABLE_ROLE_TIMELINES, scan);
				break;
		}
	}

	private scanTransitions(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			const fieldName = staticTableFieldName(field);
			const fieldOwner = fieldName ? this.host.resolveMemberValueSource(owner, fieldName) : undefined;
			if (!this.scanTable(field.value, fieldOwner, TABLE_ROLE_TRANSITION, scan)) {
				this.recordCallback(
					fieldOwner ?? this.host.resolveExpressionValueSource(field.value),
					field.value,
					scan,
				);
			}
		}
	}

	private scanTransition(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			if (staticTableFieldName(field) === 'go') {
				this.recordCallback(this.host.resolveMemberValueSource(owner, 'go'), field.value, scan);
			}
		}
	}

	private scanInputHandlers(
		table: LuaTableConstructorExpression,
		scan: ComponentProgramScan,
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			this.scanTable(table.fields[fieldIndex].value, undefined, TABLE_ROLE_TRANSITION, scan);
		}
	}

	private scanGuards(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			const fieldName = staticTableFieldName(field);
			if (fieldName === 'can_enter' || fieldName === 'can_exit') {
				this.recordCallback(this.host.resolveMemberValueSource(owner, fieldName), field.value, scan);
			}
		}
	}

	private scanTimelines(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			const fieldName = staticTableFieldName(field);
			this.scanTable(
				field.value,
				fieldName ? this.host.resolveMemberValueSource(owner, fieldName) : undefined,
				TABLE_ROLE_TIMELINE,
				scan,
			);
		}
	}

	private scanTimeline(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
	): void {
		let targetPath: readonly string[] | undefined;
		let targetPathAuthored = false;
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			if (staticTableFieldName(field) === 'target_path') {
				targetPathAuthored = true;
				targetPath = this.resolveReceiverPath(field.value);
				break;
			}
		}
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			const fieldName = staticTableFieldName(field);
			if (fieldName === 'on_finished') {
				this.recordCallback(
					this.host.resolveMemberValueSource(owner, fieldName),
					field.value,
					scan,
				);
			} else if (fieldName === 'def' && (!targetPathAuthored || targetPath)) {
				const fieldOwner = this.host.resolveMemberValueSource(owner, fieldName);
				if (!this.scanTable(
					field.value,
					fieldOwner,
					TABLE_ROLE_TIMELINE_DEFINITION,
					scan,
					targetPath,
				)) {
					const definitionSource = this.host.resolveExpressionValueSource(field.value);
					if (definitionSource) {
						this.retainCallback(appendValueMember(definitionSource, 'apply'), scan, targetPath);
					}
				}
			}
		}
	}

	private scanTimelineDefinition(
		table: LuaTableConstructorExpression,
		owner: SemanticValueSource,
		scan: ComponentProgramScan,
		receiverPath?: readonly string[],
	): void {
		for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
			const field = table.fields[fieldIndex];
			if (staticTableFieldName(field) === 'apply') {
				this.recordCallback(
					this.host.resolveMemberValueSource(owner, 'apply'),
					field.value,
					scan,
					receiverPath,
				);
			}
		}
	}

	private resolveReceiverPath(expression: LuaExpression): readonly string[] | undefined {
		const resolved = this.resolveTable(expression, undefined);
		if (!resolved) {
			return undefined;
		}
		const fields = resolved.table.fields;
		const path = new Array<string>(fields.length);
		for (let index = 0; index < fields.length; index += 1) {
			const field = fields[index];
			if (field.kind !== LuaTableFieldKind.Array
				|| field.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
				return undefined;
			}
			path[index] = field.value.value;
		}
		return path;
	}

	private recordCallbackMembers(
		owner: SemanticValueSource,
		members: readonly string[],
		scan: ComponentProgramScan,
	): void {
		for (let index = 0; index < members.length; index += 1) {
			this.retainCallback(appendValueMember(owner, members[index]), scan);
		}
	}

	private recordCallback(
		callee: SemanticValueSource | undefined,
		expression: LuaExpression,
		scan: ComponentProgramScan,
		receiverPath?: readonly string[],
	): void {
		if (!callee || !isCallbackExpression(expression)) {
			return;
		}
		this.retainCallback(callee, scan, receiverPath);
	}

	private retainCallback(
		callee: SemanticValueSource,
		scan: ComponentProgramScan,
		receiverPath?: readonly string[],
	): void {
		let key = semanticValueSourceKey(callee);
		if (receiverPath) {
			for (let index = 0; index < receiverPath.length; index += 1) {
				key += `\0${receiverPath[index]}`;
			}
		}
		if (scan.retainedCallbacks.has(key)) {
			return;
		}
		scan.retainedCallbacks.add(key);
		this.callbacks.push({
			programKind: scan.programKind,
			programId: scan.programId,
			callee,
			receiverPath,
		});
	}
}

function staticTableFieldName(field: LuaTableField): string | undefined {
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		return field.name;
	}
	if (field.kind === LuaTableFieldKind.ExpressionKey
		&& field.key.kind === LuaSyntaxKind.StringLiteralExpression) {
		return field.key.value;
	}
	return undefined;
}

function isCallbackExpression(expression: LuaExpression): boolean {
	switch (expression.kind) {
		case LuaSyntaxKind.FunctionExpression:
		case LuaSyntaxKind.IdentifierExpression:
		case LuaSyntaxKind.MemberExpression:
		case LuaSyntaxKind.IndexExpression:
		case LuaSyntaxKind.CallExpression:
		case LuaSyntaxKind.BinaryExpression:
			return true;
		default:
			return false;
	}
}
