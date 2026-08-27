import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaExpression,
	type LuaTableConstructorExpression,
} from '../syntax/ast';
import type { SymbolID } from './model';
import {
	appendValueCall,
	appendValueMember,
	semanticValueSourcesEqual,
	type SemanticValueSource,
} from './value_graph';

export type ComponentPublicationEntry = {
	lifecycleDeclId: SymbolID;
	name: string;
	memberDeclId: SymbolID;
};

export type PrefabComponentEntry = {
	classDeclId: SymbolID;
	component: SemanticValueSource;
};

type PrefabStaticExpressionDeclaration = {
	id: SymbolID;
	constantInitializer?: LuaExpression;
};

type ComponentLifecycleScope = {
	lifecycleDeclId: SymbolID;
};

export interface PrefabComponentSemanticHost {
	resolveExpressionValueSource(expression: LuaExpression): SemanticValueSource | undefined;
	resolveStaticExpressionDeclaration(expression: LuaExpression): PrefabStaticExpressionDeclaration | undefined;
}

// Prefab composition invokes each authored component factory, attaches the
// result, and then calls its on_attach lifecycle method. Retain only the
// surface that the component itself publishes onto that parent.
export class PrefabComponentSemanticCollector {
	public readonly publications: ComponentPublicationEntry[] = [];
	public readonly components: PrefabComponentEntry[] = [];
	private readonly lifecycleScopes: (ComponentLifecycleScope | undefined)[] = [];

	constructor(private readonly host: PrefabComponentSemanticHost) {}

	public enterFunction(lifecycle: ComponentLifecycleScope | undefined): void {
		this.lifecycleScopes.push(lifecycle);
	}

	public leaveFunction(): void {
		this.lifecycleScopes.pop();
	}

	public recordMemberAssignment(
		owner: SemanticValueSource | undefined,
		name: string,
		memberDeclId: SymbolID,
		value: SemanticValueSource | undefined,
	): void {
		const lifecycle = this.lifecycleScopes[this.lifecycleScopes.length - 1];
		if (!lifecycle || !owner || !value
			|| !semanticValueSourcesEqual(owner, appendValueMember(value, 'parent'))) {
			return;
		}
		this.publications.push({
			lifecycleDeclId: lifecycle.lifecycleDeclId,
			name,
			memberDeclId,
		});
	}

	public recordPrefabComponents(
		descriptor: LuaTableConstructorExpression,
		classDeclId: SymbolID,
	): void {
		for (let fieldIndex = 0; fieldIndex < descriptor.fields.length; fieldIndex += 1) {
			const field = descriptor.fields[fieldIndex];
			if (field.kind !== LuaTableFieldKind.IdentifierKey || field.name !== 'components') {
				continue;
			}
			const components = this.resolveTable(field.value);
			if (!components) {
				return;
			}
			for (let componentIndex = 0; componentIndex < components.fields.length; componentIndex += 1) {
				const componentField = components.fields[componentIndex];
				if (componentField.kind !== LuaTableFieldKind.Array) {
					continue;
				}
				const factory = this.host.resolveExpressionValueSource(componentField.value);
				if (factory) {
					this.components.push({
						classDeclId,
						component: appendValueCall(factory),
					});
				}
			}
			return;
		}
	}

	private resolveTable(expression: LuaExpression): LuaTableConstructorExpression | undefined {
		if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
			return expression;
		}
		const declaration = this.host.resolveStaticExpressionDeclaration(expression);
		return declaration?.constantInitializer?.kind === LuaSyntaxKind.TableConstructorExpression
			? declaration.constantInitializer
			: undefined;
	}
}
