import { createFsmStatePath } from '../../../../toolchain/ts/cartlib/fsm/state_path';
import { LuaSyntaxKind, type LuaStringLiteralExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorSourceDocument } from './model';
import type { StateMachineScope, StateMachineSourceDefinition, StateMachineSourceOutcome,
	StateMachineSourcePath, StateMachineSourceTransition } from './state_machine_model';
import { bindStateMachineSourcePath } from './state_machine_scope';

export type StateMachinePathUse = {
	readonly definition: StateMachineSourceDefinition;
	readonly transition: StateMachineSourceTransition;
	readonly outcome: StateMachineSourceOutcome;
};

type RetargetUnavailable = {
	readonly kind: 'unavailable';
	readonly reason: 'syntax-incomplete' | 'source-not-path' | 'indirect-literal' | 'different-registration' | 'unaddressable-target';
};

export type StateMachineRetargetCheck = RetargetUnavailable
	| { readonly kind: 'unchanged' }
	| { readonly kind: 'unresolved-consumer'; readonly use: StateMachinePathUse; readonly target: StateMachineSourceOutcome['target'] }
	| { readonly kind: 'available'; readonly literal: LuaStringLiteralExpression; readonly text: string;
		readonly uses: readonly { readonly use: StateMachinePathUse; readonly plan: StateMachineSourcePath }[] };

type RetargetSource = {
	readonly kind: 'source';
	readonly literal: LuaStringLiteralExpression;
	readonly path: StateMachineSourcePath;
	readonly use: StateMachinePathUse;
};

/**
 * One source-operation lifetime, not a per-frame graph query or a Lua evaluator.
 * Source values identify shared authored uses; rendered endpoints do not.
 */
export class StateMachineRetargetAnalysis {
	public readonly uses: readonly StateMachinePathUse[];
	private readonly source: RetargetSource | RetargetUnavailable;
	private lastTarget: StateMachineScope | undefined;
	private lastCheck: StateMachineRetargetCheck | undefined;

	public constructor(document: BehaviorSourceDocument, transition: StateMachineSourceTransition, outcome: StateMachineSourceOutcome) {
		const uses: StateMachinePathUse[] = [];
		this.uses = uses;
		if (!document.syntaxComplete) { this.source = { kind: 'unavailable', reason: 'syntax-incomplete' }; return; }
		if (outcome.target.kind !== 'path') { this.source = { kind: 'unavailable', reason: 'source-not-path' }; return; }
		const proof = outcome.proof;
		const literal = proof.kind === 'direct' ? proof.expression : proof.statement.expressions[0];
		if (literal.kind !== LuaSyntaxKind.StringLiteralExpression) {
			this.source = { kind: 'unavailable', reason: 'indirect-literal' }; return;
		}
		let selectedUse: StateMachinePathUse | undefined;
		for (const definition of document.definitions) {
			if (definition.behaviorKind !== 'state_machine') continue;
			for (const consumer of definition.transitions) for (const candidate of consumer.outcomes) {
				if (candidate.value !== literal) continue;
				const use = { definition, transition: consumer, outcome: candidate };
				uses.push(use);
				if (consumer === transition && candidate === outcome) selectedUse = use;
			}
		}
		this.source = { kind: 'source', literal, path: outcome.target, use: selectedUse! };
	}

	/** Retain the current candidate only: no target-count × shared-consumer result cache. */
	public checkTarget(target: StateMachineScope): StateMachineRetargetCheck {
		if (this.source.kind === 'unavailable') return this.source;
		if (this.lastTarget !== target) {
			this.lastCheck = this.computeTarget(this.source, target);
			this.lastTarget = target;
		}
		return this.lastCheck!;
	}

	private computeTarget(source: RetargetSource, target: StateMachineScope): StateMachineRetargetCheck {
		const root = source.use.definition.scopes[0];
		let targetRoot = target;
		while (targetRoot.parent !== null) targetRoot = targetRoot.parent;
		if (targetRoot !== root) return { kind: 'unavailable', reason: 'different-registration' };
		if (target.rowKey === source.path.target) return { kind: 'unchanged' };
		let anchor = source.path.absolute ? root : source.use.transition.origin;
		for (let index = 0; index < source.path.up; index += 1) anchor = anchor.parent!;
		let common = anchor;
		let ancestor = target;
		while (ancestor.depth > common.depth) ancestor = ancestor.parent!;
		while (common.depth > ancestor.depth) common = common.parent!;
		while (common !== ancestor) { common = common.parent!; ancestor = ancestor.parent!; }
		const keys: string[] = [];
		for (let scope = target; scope !== common; scope = scope.parent!) keys.push(scope.name!);
		keys.reverse();
		const path = createFsmStatePath(source.path.absolute, source.path.up + anchor.depth - common.depth, keys);
		if (path === undefined) return { kind: 'unavailable', reason: 'unaddressable-target' };
		const uses: { use: StateMachinePathUse; plan: StateMachineSourcePath }[] = [];
		for (const use of this.uses) {
			if (use.outcome.target.kind !== 'path') return { kind: 'unresolved-consumer', use, target: use.outcome.target };
			const plan = bindStateMachineSourcePath(use.definition.scopes[0], use.transition.origin, path);
			if (plan.kind !== 'path') return { kind: 'unresolved-consumer', use, target: plan };
			uses.push({ use, plan });
		}
		return { kind: 'available', literal: source.literal, text: path.text, uses };
	}
}
