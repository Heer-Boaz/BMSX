import { LuaSyntaxKind, type LuaGotoStatement, type LuaLabelStatement } from '../syntax/ast';
import type { LuaStatementSequence } from '../syntax/statement_sequence';

export type LuaJumpProblem = {
	readonly statement: LuaGotoStatement | LuaLabelStatement;
	readonly message: string;
};

type PendingGoto = {
	statement: LuaGotoStatement;
	locals: number;
};

type Block = {
	parent: Block | undefined;
	locals: string[];
	labels?: Map<string, LuaLabelStatement>;
	pending?: Map<string, PendingGoto[]>;
};

type JumpBindings = {
	readonly targets: ReadonlyMap<LuaGotoStatement, LuaLabelStatement>;
	readonly endLabels: ReadonlySet<LuaLabelStatement>;
	readonly problems: readonly LuaJumpProblem[];
};

const noJumpBindings: JumpBindings = { targets: new Map(), endLabels: new Set(), problems: [] };
const bindingsByBody = new WeakMap<LuaStatementSequence, JumpBindings>();

/** Resolve Lua labels within one activation, in declaration order. */
export function getLuaJumpBindings(body: LuaStatementSequence): JumpBindings {
	if (!body.hasJumps) return noJumpBindings;
	const cached = bindingsByBody.get(body);
	if (cached !== undefined) return cached;
	const targets = new Map<LuaGotoStatement, LuaLabelStatement>();
	const endLabels = new Set<LuaLabelStatement>();
	const problems: LuaJumpProblem[] = [];

	const visibleLabel = (block: Block, name: string): LuaLabelStatement | undefined => {
		for (let from: Block | undefined = block; from !== undefined; from = from.parent) {
			const label = from.labels?.get(name);
			if (label !== undefined) return label;
		}
		return undefined;
	};

	const moveJump = (block: Block, jump: PendingGoto): void => {
		const pending = block.pending ??= new Map();
		const name = jump.statement.label;
		const jumps = pending.get(name);
		if (jumps === undefined) pending.set(name, [jump]);
		else jumps.push(jump);
	};

	const visit = (statements: LuaStatementSequence, parent: Block | undefined, repeat: boolean): void => {
		if (!statements.hasJumps) return;
		const block: Block = { parent, locals: [] };
		let endLabelStart = statements.length;
		if (!repeat) {
			for (const cursor = statements.cursor(statements.length); cursor.retreat();) {
				if (cursor.statement!.kind !== LuaSyntaxKind.LabelStatement) break;
				endLabelStart -= 1;
			}
		}
		let index = 0;
		for (const cursor = statements.cursor(); cursor.statement !== undefined; cursor.advance(), ++index) {
			const statement = cursor.statement;
			switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement:
					for (const name of statement.names) block.locals.push(name.name);
					break;
				case LuaSyntaxKind.LocalFunctionStatement:
					block.locals.push(statement.name.name);
					break;
				case LuaSyntaxKind.DoStatement:
				case LuaSyntaxKind.WhileStatement:
				case LuaSyntaxKind.ForNumericStatement:
				case LuaSyntaxKind.ForGenericStatement:
					visit(statement.block.body, block, false);
					break;
				case LuaSyntaxKind.RepeatStatement:
					visit(statement.block.body, block, true);
					break;
				case LuaSyntaxKind.IfStatement:
					for (const clause of statement.clauses) visit(clause.block.body, block, false);
					break;
				case LuaSyntaxKind.GotoStatement: {
					const target = visibleLabel(block, statement.label);
					if (target !== undefined) targets.set(statement, target);
					else moveJump(block, { statement, locals: block.locals.length });
					break;
				}
				case LuaSyntaxKind.LabelStatement: {
					if (visibleLabel(block, statement.label) !== undefined) {
						problems.push({ statement, message: `Duplicate label '${statement.label}'.` });
						break;
					}
					const atEnd = index >= endLabelStart;
					if (atEnd) endLabels.add(statement);
					const locals = atEnd ? 0 : block.locals.length;
					(block.labels ??= new Map()).set(statement.label, statement);
					const pending = block.pending?.get(statement.label);
					if (pending === undefined) break;
					for (const jump of pending) {
						if (jump.locals < locals) {
							problems.push({ statement: jump.statement, message:
								`Goto '${statement.label}' jumps into the scope of local '${block.locals[jump.locals]}'.` });
						} else {
							targets.set(jump.statement, statement);
						}
					}
					block.pending!.delete(statement.label);
					break;
				}
			}
		}
		if (block.pending === undefined) return;
		for (const [name, jumps] of block.pending) {
			for (const jump of jumps) {
				if (parent === undefined) {
					problems.push({ statement: jump.statement, message: `No visible label '${name}' for goto.` });
				} else {
					jump.locals = parent.locals.length;
					moveJump(parent, jump);
				}
			}
		}
	};

	visit(body, undefined, false);
	const bindings = { targets, endLabels, problems };
	bindingsByBody.set(body, bindings);
	return bindings;
}
