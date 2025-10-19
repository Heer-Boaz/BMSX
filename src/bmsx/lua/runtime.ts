import {
	LuaSyntaxKind,
	LuaBinaryOperator,
	LuaUnaryOperator,
	LuaTableFieldKind,
} from './ast';
import type {
	LuaAssignableExpression,
	LuaAssignmentStatement,
	LuaBlock,
	LuaBooleanLiteralExpression,
	LuaBinaryExpression,
	LuaCallExpression,
	LuaCallStatement,
	LuaChunk,
	LuaDoStatement,
	LuaExpression,
	LuaForGenericStatement,
	LuaForNumericStatement,
	LuaFunctionDeclarationStatement,
	LuaFunctionExpression,
	LuaIdentifierExpression,
	LuaIfStatement,
	LuaIndexExpression,
	LuaLabelStatement,
	LuaLocalAssignmentStatement,
	LuaLocalFunctionStatement,
	LuaGotoStatement,
	LuaMemberExpression,
	LuaNilLiteralExpression,
	LuaNumericLiteralExpression,
	LuaBreakStatement,
	LuaRepeatStatement,
	LuaReturnStatement,
	LuaStatement,
	LuaStringLiteralExpression,
	LuaTableArrayField,
	LuaTableConstructorExpression,
	LuaTableExpressionField,
	LuaTableIdentifierField,
	LuaUnaryExpression,
	LuaVarargExpression,
	LuaWhileStatement,
	LuaSourceRange,
} from './ast';
import { LuaEnvironment } from './environment';
import { LuaRuntimeError, LuaSyntaxError } from './errors';
import { LuaLexer } from './lexer';
import { LuaParser } from './parser';
import type { LuaFunctionValue, LuaValue } from './value';
import { LuaTable } from './value';

type ExecutionSignal =
	| { readonly kind: 'normal' }
	| { readonly kind: 'return'; readonly values: ReadonlyArray<LuaValue> }
	| { readonly kind: 'break'; readonly origin: LuaStatement }
	| { readonly kind: 'goto'; readonly label: string; readonly origin: LuaGotoStatement };

const NORMAL_SIGNAL: ExecutionSignal = { kind: 'normal' };

class LuaNativeFunction implements LuaFunctionValue {
	public readonly name: string;
	private readonly interpreter: LuaInterpreter;
	private readonly handler: (interpreter: LuaInterpreter, args: ReadonlyArray<LuaValue>) => ReadonlyArray<LuaValue>;

	constructor(name: string, interpreter: LuaInterpreter, handler: (interpreter: LuaInterpreter, args: ReadonlyArray<LuaValue>) => ReadonlyArray<LuaValue>) {
		this.name = name;
		this.interpreter = interpreter;
		this.handler = handler;
	}

	public call(args: ReadonlyArray<LuaValue>): LuaValue[] {
		const result = this.handler(this.interpreter, args);
		return Array.from(result);
	}
}

class LuaScriptFunction implements LuaFunctionValue {
	public readonly name: string;
	private readonly interpreter: LuaInterpreter;
	private readonly expression: LuaFunctionExpression;
	private readonly closure: LuaEnvironment;
	private readonly implicitSelfName: string | null;

	constructor(name: string, interpreter: LuaInterpreter, expression: LuaFunctionExpression, closure: LuaEnvironment, implicitSelfName: string | null) {
		this.name = name;
		this.interpreter = interpreter;
		this.expression = expression;
		this.closure = closure;
		this.implicitSelfName = implicitSelfName;
	}

	public call(args: ReadonlyArray<LuaValue>): LuaValue[] {
		return this.interpreter.invokeScriptFunction(this.expression, this.closure, this.name, args, this.implicitSelfName);
	}
}

type ResolvedAssignmentTarget =
	| { readonly kind: 'identifier'; readonly name: string; readonly environment: LuaEnvironment | null }
	| { readonly kind: 'member'; readonly table: LuaTable; readonly key: string }
	| { readonly kind: 'index'; readonly table: LuaTable; readonly index: LuaValue };

type IteratorState = {
	readonly entries: ReadonlyArray<[LuaValue, LuaValue]>;
};

type LabelMetadata = {
	readonly index: number;
	readonly statement: LuaLabelStatement;
};

type LabelScope = {
	readonly labels: Map<string, LabelMetadata>;
	readonly parent: LabelScope | null;
};

export class LuaInterpreter {
	 private readonly globals: LuaEnvironment;
	 private currentChunk: string;
	 private randomSeedValue: number;
	 private reservedIdentifiers: Set<string> = new Set<string>();

	constructor(globals: LuaEnvironment | null) {
		if (globals === null) {
			this.globals = LuaEnvironment.createRoot();
		}
		else {
			this.globals = globals;
		}
		this.currentChunk = '<chunk>';
		this.randomSeedValue = Date.now();
		this.initializeBuiltins();
	}

	public execute(source: string, chunkName: string): LuaValue[] {
		const lexer = new LuaLexer(source, chunkName);
		const tokens = lexer.scanTokens();
		const parser = new LuaParser(tokens, chunkName, source);
		const chunk = parser.parseChunk();
		this.validateReservedIdentifiers(chunk.body);
		return this.executeChunk(chunk);
	}

	public setReservedIdentifiers(names: Iterable<string>): void {
		this.reservedIdentifiers = new Set<string>();
		for (const name of names) {
			if (typeof name === 'string' && name.length > 0) {
				this.reservedIdentifiers.add(name);
			}
		}
	}

	public getGlobalEnvironment(): LuaEnvironment {
		return this.globals;
	}

	protected executeChunk(chunk: LuaChunk): LuaValue[] {
		this.currentChunk = chunk.range.chunkName;
		const chunkScope = LuaEnvironment.createChild(this.globals);
		const signal = this.executeStatements(chunk.body, chunkScope, [], null);
		if (signal.kind === 'return') {
			return Array.from(signal.values);
		}
		if (signal.kind === 'break') {
			const breakStatement = signal.origin as LuaBreakStatement;
			throw this.runtimeErrorAt(breakStatement.range, 'Unexpected break outside of loop.');
		}
		if (signal.kind === 'goto') {
			throw this.runtimeErrorAt(signal.origin.range, `Label '${signal.label}' not found.`);
		}
		return [];
	}

	private executeStatements(statements: ReadonlyArray<LuaStatement>, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, parentScope: LabelScope | null): ExecutionSignal {
		const labels = this.buildLabelMap(statements);
		const scope: LabelScope = { labels, parent: parentScope };
		let index = 0;
		while (index < statements.length) {
			const statement = statements[index];
			if (statement.kind === LuaSyntaxKind.LabelStatement) {
				index += 1;
				continue;
			}
			const signal = this.executeStatement(statement, environment, varargs, scope);
			if (signal.kind === 'normal') {
				index += 1;
				continue;
			}
			if (signal.kind === 'goto') {
				const metadata = scope.labels.get(signal.label);
				if (metadata !== undefined) {
					index = metadata.index;
					continue;
				}
				return signal;
			}
			return signal;
		}
		return NORMAL_SIGNAL;
	}

	private executeStatement(statement: LuaStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				this.executeLocalAssignment(statement as LuaLocalAssignmentStatement, environment, varargs);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.LocalFunctionStatement:
				this.executeLocalFunction(statement as LuaLocalFunctionStatement, environment);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				this.executeFunctionDeclaration(statement as LuaFunctionDeclarationStatement, environment);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.AssignmentStatement:
				this.executeAssignment(statement as LuaAssignmentStatement, environment, varargs);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.ReturnStatement:
				return this.executeReturn(statement as LuaReturnStatement, environment, varargs);
			case LuaSyntaxKind.BreakStatement:
				return { kind: 'break', origin: statement };
			case LuaSyntaxKind.IfStatement:
				return this.executeIf(statement as LuaIfStatement, environment, varargs, scope);
			case LuaSyntaxKind.WhileStatement:
				return this.executeWhile(statement as LuaWhileStatement, environment, varargs, scope);
			case LuaSyntaxKind.RepeatStatement:
				return this.executeRepeat(statement as LuaRepeatStatement, environment, varargs, scope);
			case LuaSyntaxKind.ForNumericStatement:
				return this.executeForNumeric(statement as LuaForNumericStatement, environment, varargs, scope);
			case LuaSyntaxKind.ForGenericStatement:
				return this.executeForGeneric(statement as LuaForGenericStatement, environment, varargs, scope);
			case LuaSyntaxKind.DoStatement:
				return this.executeDo(statement as LuaDoStatement, environment, varargs, scope);
			case LuaSyntaxKind.CallStatement:
				this.evaluateCallExpression((statement as LuaCallStatement).expression, environment, varargs);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.GotoStatement:
				return { kind: 'goto', label: (statement as LuaGotoStatement).label, origin: statement as LuaGotoStatement };
			case LuaSyntaxKind.LabelStatement:
				return NORMAL_SIGNAL;
			default:
				throw this.runtimeError('Unsupported statement kind.');
		}
	}

	private executeLocalAssignment(statement: LuaLocalAssignmentStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): void {
		const values = this.evaluateExpressionList(statement.values, environment, varargs);
		for (let index = 0; index < statement.names.length; index += 1) {
			const identifier = statement.names[index];
			const value = index < values.length ? values[index] : null;
			environment.set(identifier.name, value);
		}
	}

	private executeLocalFunction(statement: LuaLocalFunctionStatement, environment: LuaEnvironment): void {
		const functionValue = this.createScriptFunction(statement.functionExpression, environment, statement.name.name, null);
		environment.set(statement.name.name, functionValue);
	}

	private executeFunctionDeclaration(statement: LuaFunctionDeclarationStatement, environment: LuaEnvironment): void {
		const functionNameParts = statement.name.identifiers;
		if (functionNameParts.length === 0) {
			throw this.runtimeErrorAt(statement.range, 'Function declaration missing name.');
		}
		const functionDisplayName = this.composeFunctionName(statement.name);
		const implicitSelfName = statement.name.methodName !== null ? 'self' : null;
		const functionValue = this.createScriptFunction(statement.functionExpression, environment, functionDisplayName, implicitSelfName);

		if (statement.name.methodName !== null) {
			const methodTable = this.resolveTableFromPath(functionNameParts, environment, functionDisplayName, statement.range);
			methodTable.set(statement.name.methodName, functionValue);
			return;
		}

		if (functionNameParts.length === 1) {
			const resolvedEnv = environment.resolve(functionNameParts[0]);
			if (resolvedEnv !== null) {
				resolvedEnv.set(functionNameParts[0], functionValue);
				return;
			}
			this.globals.set(functionNameParts[0], functionValue);
			return;
		}

		const containerParts: string[] = [];
		for (let index = 0; index < functionNameParts.length - 1; index += 1) {
			containerParts.push(functionNameParts[index]);
		}
		const containerTable = this.resolveTableFromPath(containerParts, environment, functionDisplayName, statement.range);
		const finalName = functionNameParts[functionNameParts.length - 1];
		containerTable.set(finalName, functionValue);
	}

	private composeFunctionName(name: LuaFunctionDeclarationStatement['name']): string {
		let display = '';
		for (let index = 0; index < name.identifiers.length; index += 1) {
			if (index > 0) {
				display += '.';
			}
			display += name.identifiers[index];
		}
		if (name.methodName !== null) {
			display += `:${name.methodName}`;
		}
		return display;
	}

	private resolveTableFromPath(parts: ReadonlyArray<string>, environment: LuaEnvironment, displayName: string, range: LuaSourceRange): LuaTable {
		if (parts.length === 0) {
			throw this.runtimeErrorAt(range, `Invalid table path for function '${displayName}'.`);
		}
		let currentValue: LuaValue | null = this.lookupIdentifier(parts[0], environment);
		if (!(currentValue instanceof LuaTable)) {
			throw this.runtimeErrorAt(range, `Expected table for '${parts[0]}' when declaring function '${displayName}'.`);
		}
		let currentTable: LuaTable = currentValue;
		for (let index = 1; index < parts.length; index += 1) {
			const fieldValue = currentTable.get(parts[index]);
			if (!(fieldValue instanceof LuaTable)) {
				throw this.runtimeErrorAt(range, `Expected table for '${parts[index]}' when declaring function '${displayName}'.`);
			}
			currentTable = fieldValue;
		}
		return currentTable;
	}

	private executeAssignment(statement: LuaAssignmentStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): void {
		const resolvedTargets = statement.left.map((target) => this.resolveAssignmentTarget(target, environment, varargs));
		const values = this.evaluateExpressionList(statement.right, environment, varargs);
		for (let index = 0; index < resolvedTargets.length; index += 1) {
			const resolved = resolvedTargets[index];
			const value = index < values.length ? values[index] : null;
			this.assignResolvedTarget(resolved, value);
		}
	}

	private executeReturn(statement: LuaReturnStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): ExecutionSignal {
		if (statement.expressions.length === 0) {
			return { kind: 'return', values: [] };
		}
		const values = this.evaluateExpressionList(statement.expressions, environment, varargs);
		return { kind: 'return', values };
	}

	private executeIf(statement: LuaIfStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		for (const clause of statement.clauses) {
			if (clause.condition === null || this.isTruthy(this.evaluateSingleExpression(clause.condition, environment, varargs))) {
				return this.executeBlock(clause.block, environment, varargs, scope);
			}
		}
		return NORMAL_SIGNAL;
	}

	private executeWhile(statement: LuaWhileStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		const loopEnvironment = LuaEnvironment.createChild(environment);
		while (this.isTruthy(this.evaluateSingleExpression(statement.condition, loopEnvironment, varargs))) {
			const signal = this.executeBlock(statement.block, loopEnvironment, varargs, scope);
			if (signal.kind === 'return') {
				return signal;
			}
			if (signal.kind === 'break') {
				return NORMAL_SIGNAL;
			}
			if (signal.kind === 'goto') {
				return signal;
			}
		}
		return NORMAL_SIGNAL;
	}

	private executeRepeat(statement: LuaRepeatStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		while (true) {
			const iterationEnvironment = LuaEnvironment.createChild(environment);
			const signal = this.executeStatements(statement.block.body, iterationEnvironment, varargs, scope);
			if (signal.kind === 'return') {
				return signal;
			}
			if (signal.kind === 'break') {
				return NORMAL_SIGNAL;
			}
			if (signal.kind === 'goto') {
				return signal;
			}
			const condition = this.evaluateSingleExpression(statement.condition, iterationEnvironment, varargs);
			if (this.isTruthy(condition)) {
				return NORMAL_SIGNAL;
			}
		}
	}

	private executeForNumeric(statement: LuaForNumericStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		const startValue = this.expectNumber(this.evaluateSingleExpression(statement.start, environment, varargs), 'Numeric for loop start must be a number.', statement.start.range);
		const limitValue = this.expectNumber(this.evaluateSingleExpression(statement.limit, environment, varargs), 'Numeric for loop limit must be a number.', statement.limit.range);
		let stepValue = 1;
		if (statement.step !== null) {
			stepValue = this.expectNumber(this.evaluateSingleExpression(statement.step, environment, varargs), 'Numeric for loop step must be a number.', statement.step.range);
		}
		const loopEnvironment = LuaEnvironment.createChild(environment);
		loopEnvironment.set(statement.variable.name, startValue);
		let current = startValue;
		const ascending = stepValue >= 0;
		while ((ascending && current <= limitValue) || (!ascending && current >= limitValue)) {
			loopEnvironment.assignExisting(statement.variable.name, current);
			const signal = this.executeBlock(statement.block, loopEnvironment, varargs, scope);
			if (signal.kind === 'return') {
				return signal;
			}
			if (signal.kind === 'break') {
				return NORMAL_SIGNAL;
			}
			if (signal.kind === 'goto') {
				return signal;
			}
			current += stepValue;
		}
		return NORMAL_SIGNAL;
	}

	private executeForGeneric(statement: LuaForGenericStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		const iteratorValues = this.evaluateExpressionList(statement.iterators, environment, varargs);
		if (iteratorValues.length === 0) {
			throw this.runtimeErrorAt(statement.range, 'Generic for loop requires an iterator function.');
		}
		const iteratorFunction = this.expectFunction(iteratorValues[0], 'Generic for loop requires an iterator function.', statement.range);
		const state = iteratorValues.length > 1 ? iteratorValues[1] : null;
		let control = iteratorValues.length > 2 ? iteratorValues[2] : null;

		const loopEnvironment = LuaEnvironment.createChild(environment);
		for (const variable of statement.variables) {
			loopEnvironment.set(variable.name, null);
		}

		while (true) {
			const callArgs: LuaValue[] = [state, control];
			const results = iteratorFunction.call(callArgs);
			if (results.length === 0 || results[0] === null || results[0] === false) {
				return NORMAL_SIGNAL;
			}
			control = results[0];
			for (let index = 0; index < statement.variables.length; index += 1) {
				const variable = statement.variables[index];
				const value = index < results.length ? results[index] : null;
				loopEnvironment.assignExisting(variable.name, value);
			}
			const signal = this.executeBlock(statement.block, loopEnvironment, varargs, scope);
			if (signal.kind === 'return') {
				return signal;
			}
			if (signal.kind === 'break') {
				return NORMAL_SIGNAL;
			}
			if (signal.kind === 'goto') {
				return signal;
			}
		}
	}

	private executeDo(statement: LuaDoStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		return this.executeBlock(statement.block, environment, varargs, scope);
	}

	private executeBlock(block: LuaBlock, parentEnvironment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, parentScope: LabelScope): ExecutionSignal {
		const blockEnvironment = LuaEnvironment.createChild(parentEnvironment);
		return this.executeStatements(block.body, blockEnvironment, varargs, parentScope);
	}

	private buildLabelMap(statements: ReadonlyArray<LuaStatement>): Map<string, LabelMetadata> {
		const labels = new Map<string, LabelMetadata>();
		for (let index = 0; index < statements.length; index += 1) {
			const statement = statements[index];
			if (statement.kind === LuaSyntaxKind.LabelStatement) {
				const labelStatement = statement as LuaLabelStatement;
				if (labels.has(labelStatement.label)) {
					throw this.runtimeErrorAt(labelStatement.range, `Duplicate label '${labelStatement.label}'.`);
				}
				labels.set(labelStatement.label, { index, statement: labelStatement });
			}
		}
		return labels;
	}

	private evaluateExpressionList(expressions: ReadonlyArray<LuaExpression>, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		if (expressions.length === 0) {
			return [];
		}
		const results: LuaValue[] = [];
		for (let index = 0; index < expressions.length; index += 1) {
			const expression = expressions[index];
			const values = this.evaluateExpression(expression, environment, varargs);
			if (index === expressions.length - 1) {
				for (const value of values) {
					results.push(value);
				}
			}
			else {
				const value = values.length > 0 ? values[0] : null;
				results.push(value);
			}
		}
		return results;
	}

	private evaluateExpression(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression:
				return [this.evaluateNumericLiteral(expression as LuaNumericLiteralExpression)];
			case LuaSyntaxKind.StringLiteralExpression:
				return [this.evaluateStringLiteral(expression as LuaStringLiteralExpression)];
			case LuaSyntaxKind.BooleanLiteralExpression:
				return [this.evaluateBooleanLiteral(expression as LuaBooleanLiteralExpression)];
			case LuaSyntaxKind.NilLiteralExpression:
				return [this.evaluateNilLiteral(expression as LuaNilLiteralExpression)];
			case LuaSyntaxKind.VarargExpression:
				return this.evaluateVararg(expression as LuaVarargExpression, varargs);
			case LuaSyntaxKind.IdentifierExpression:
				return [this.evaluateIdentifier(expression as LuaIdentifierExpression, environment)];
			case LuaSyntaxKind.FunctionExpression:
				return [this.createScriptFunction(expression as LuaFunctionExpression, environment, '<anonymous>', null)];
			case LuaSyntaxKind.TableConstructorExpression:
				return [this.evaluateTableConstructor(expression as LuaTableConstructorExpression, environment, varargs)];
			case LuaSyntaxKind.BinaryExpression:
				return [this.evaluateBinaryExpression(expression as LuaBinaryExpression, environment, varargs)];
			case LuaSyntaxKind.UnaryExpression:
				return [this.evaluateUnaryExpression(expression as LuaUnaryExpression, environment, varargs)];
			case LuaSyntaxKind.CallExpression:
				return this.evaluateCallExpression(expression as LuaCallExpression, environment, varargs);
			case LuaSyntaxKind.MemberExpression:
				return [this.evaluateMemberExpression(expression as LuaMemberExpression, environment, varargs)];
			case LuaSyntaxKind.IndexExpression:
				return [this.evaluateIndexExpression(expression as LuaIndexExpression, environment, varargs)];
			default:
				throw this.runtimeError('Unsupported expression kind.');
		}
	}

	private evaluateSingleExpression(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const values = this.evaluateExpression(expression, environment, varargs);
		if (values.length === 0) {
			return null;
		}
		return values[0];
	}

	private evaluateNumericLiteral(expression: LuaNumericLiteralExpression): number {
		return expression.value;
	}

	private evaluateStringLiteral(expression: LuaStringLiteralExpression): string {
		return expression.value;
	}

	private evaluateBooleanLiteral(expression: LuaBooleanLiteralExpression): boolean {
		return expression.value;
	}

	private evaluateNilLiteral(_expression: LuaNilLiteralExpression): LuaValue {
		return null;
	}

	private evaluateVararg(_expression: LuaVarargExpression, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		return Array.from(varargs);
	}

	private evaluateIdentifier(expression: LuaIdentifierExpression, environment: LuaEnvironment): LuaValue {
		const value = this.lookupIdentifier(expression.name, environment);
		if (value !== null) {
			return value;
		}
		return null;
	}

	private evaluateMemberExpression(expression: LuaMemberExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const baseValue = this.evaluateSingleExpression(expression.base, environment, varargs);
		if (!(baseValue instanceof LuaTable)) {
			throw this.runtimeErrorAt(expression.range, 'Attempted to index field on a non-table value.');
		}
		return baseValue.get(expression.identifier);
	}

	private evaluateIndexExpression(expression: LuaIndexExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const baseValue = this.evaluateSingleExpression(expression.base, environment, varargs);
		if (!(baseValue instanceof LuaTable)) {
			throw this.runtimeErrorAt(expression.range, 'Attempted to index on a non-table value.');
		}
		const indexValues = this.evaluateExpression(expression.index, environment, varargs);
		const indexValue = indexValues.length > 0 ? indexValues[0] : null;
		return baseValue.get(indexValue);
	}

	private evaluateBinaryExpression(expression: LuaBinaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		switch (expression.operator) {
			case LuaBinaryOperator.Or: {
				const left = this.evaluateSingleExpression(expression.left, environment, varargs);
				if (this.isTruthy(left)) {
					return left;
				}
				return this.evaluateSingleExpression(expression.right, environment, varargs);
			}
			case LuaBinaryOperator.And: {
				const left = this.evaluateSingleExpression(expression.left, environment, varargs);
				if (!this.isTruthy(left)) {
					return left;
				}
				return this.evaluateSingleExpression(expression.right, environment, varargs);
			}
			case LuaBinaryOperator.Equal:
				return this.evaluateSingleExpression(expression.left, environment, varargs) === this.evaluateSingleExpression(expression.right, environment, varargs);
			case LuaBinaryOperator.NotEqual:
				return this.evaluateSingleExpression(expression.left, environment, varargs) !== this.evaluateSingleExpression(expression.right, environment, varargs);
			case LuaBinaryOperator.LessThan:
				return this.compareNumbers(expression, environment, varargs, (a, b) => a < b);
			case LuaBinaryOperator.LessEqual:
				return this.compareNumbers(expression, environment, varargs, (a, b) => a <= b);
			case LuaBinaryOperator.GreaterThan:
				return this.compareNumbers(expression, environment, varargs, (a, b) => a > b);
			case LuaBinaryOperator.GreaterEqual:
				return this.compareNumbers(expression, environment, varargs, (a, b) => a >= b);
			case LuaBinaryOperator.Concat:
				return this.toLuaString(this.evaluateSingleExpression(expression.left, environment, varargs)) + this.toLuaString(this.evaluateSingleExpression(expression.right, environment, varargs));
			case LuaBinaryOperator.Add:
				return this.applyNumericBinary(expression, environment, varargs, (a, b) => a + b);
			case LuaBinaryOperator.Subtract:
				return this.applyNumericBinary(expression, environment, varargs, (a, b) => a - b);
			case LuaBinaryOperator.Multiply:
				return this.applyNumericBinary(expression, environment, varargs, (a, b) => a * b);
			case LuaBinaryOperator.Divide:
				return this.applyNumericBinary(expression, environment, varargs, (a, b) => a / b);
			case LuaBinaryOperator.Modulus:
				return this.applyNumericBinary(expression, environment, varargs, (a, b) => a % b);
			case LuaBinaryOperator.Exponent:
				return this.applyNumericBinary(expression, environment, varargs, (a, b) => Math.pow(a, b));
			default:
				throw this.runtimeErrorAt(expression.range, 'Unsupported binary operator.');
		}
	}

	private evaluateUnaryExpression(expression: LuaUnaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const operand = this.evaluateSingleExpression(expression.operand, environment, varargs);
		switch (expression.operator) {
			case LuaUnaryOperator.Negate:
				return -this.expectNumber(operand, 'Unary minus operand must be a number.', expression.range);
			case LuaUnaryOperator.Not:
				return !this.isTruthy(operand);
			case LuaUnaryOperator.Length:
				if (typeof operand === 'string') {
					return operand.length;
				}
				if (operand instanceof LuaTable) {
					const metamethodResult = this.invokeMetamethod(operand, '__len', [operand]);
					if (metamethodResult !== null) {
						const first = metamethodResult.length > 0 ? metamethodResult[0] : null;
						return this.expectNumber(first, 'Metamethod __len must return a number.', expression.range);
					}
					return operand.numericLength();
				}
				throw this.runtimeErrorAt(expression.range, 'Length operator expects a string or table.');
			default:
				throw this.runtimeErrorAt(expression.range, 'Unsupported unary operator.');
		}
	}

	private evaluateCallExpression(expression: LuaCallExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		const calleeValue = this.evaluateSingleExpression(expression.callee, environment, varargs);
		if (expression.methodName !== null) {
			if (!(calleeValue instanceof LuaTable)) {
				throw this.runtimeErrorAt(expression.range, 'Method call requires a table instance.');
			}
			const methodValue = calleeValue.get(expression.methodName);
			const functionValue = this.expectFunction(methodValue, `Method '${expression.methodName}' not found on table.`, expression.range);
			const args = this.buildCallArguments(expression, environment, varargs, calleeValue);
			return functionValue.call(args);
		}
		const functionValue = this.expectFunction(calleeValue, 'Attempted to call a non-function value.', expression.range);
		const args = this.buildCallArguments(expression, environment, varargs, null);
		return functionValue.call(args);
	}

	private buildCallArguments(expression: LuaCallExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, selfValue: LuaValue | null): LuaValue[] {
		const evaluatedArgs = this.evaluateExpressionList(expression.arguments, environment, varargs);
		if (selfValue === null) {
			return evaluatedArgs;
		}
		const args: LuaValue[] = [selfValue];
		for (const value of evaluatedArgs) {
			args.push(value);
		}
		return args;
	}

	private evaluateTableConstructor(expression: LuaTableConstructorExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaTable {
		const table = new LuaTable();
		let arrayIndex = 1;
		for (const field of expression.fields) {
			if (field.kind === LuaTableFieldKind.Array) {
				const arrayField = field as LuaTableArrayField;
				const values = this.evaluateExpression(arrayField.value, environment, varargs);
				if (values.length === 0) {
					table.set(arrayIndex, null);
					arrayIndex += 1;
				}
				else {
					for (const value of values) {
						table.set(arrayIndex, value);
						arrayIndex += 1;
					}
				}
			}
			else if (field.kind === LuaTableFieldKind.IdentifierKey) {
				const identifierField = field as LuaTableIdentifierField;
				const value = this.evaluateSingleExpression(identifierField.value, environment, varargs);
				table.set(identifierField.name, value);
			}
			else if (field.kind === LuaTableFieldKind.ExpressionKey) {
				const expressionField = field as LuaTableExpressionField;
				const keyValues = this.evaluateExpression(expressionField.key, environment, varargs);
				const keyValue = keyValues.length > 0 ? keyValues[0] : null;
				const value = this.evaluateSingleExpression(expressionField.value, environment, varargs);
				table.set(keyValue, value);
			}
			else {
				throw this.runtimeError('Unknown table field kind.');
			}
		}
		return table;
	}

	private resolveAssignmentTarget(target: LuaAssignableExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): ResolvedAssignmentTarget {
		if (target.kind === LuaSyntaxKind.IdentifierExpression) {
			const identifier = target as LuaIdentifierExpression;
			const resolvedEnvironment = environment.resolve(identifier.name);
			return {
				kind: 'identifier',
				name: identifier.name,
				environment: resolvedEnvironment,
			};
		}
		if (target.kind === LuaSyntaxKind.MemberExpression) {
			const member = target as LuaMemberExpression;
			const tableValue = this.evaluateSingleExpression(member.base, environment, varargs);
			if (!(tableValue instanceof LuaTable)) {
				throw this.runtimeErrorAt(member.base.range, 'Attempted to assign to a member of a non-table value.');
			}
			return {
				kind: 'member',
				table: tableValue,
				key: member.identifier,
			};
		}
		if (target.kind === LuaSyntaxKind.IndexExpression) {
			const indexExpression = target as LuaIndexExpression;
			const tableValue = this.evaluateSingleExpression(indexExpression.base, environment, varargs);
			if (!(tableValue instanceof LuaTable)) {
				throw this.runtimeErrorAt(indexExpression.base.range, 'Attempted to assign to an index of a non-table value.');
			}
			const indexValues = this.evaluateExpression(indexExpression.index, environment, varargs);
			const indexValue = indexValues.length > 0 ? indexValues[0] : null;
			return {
				kind: 'index',
				table: tableValue,
				index: indexValue,
			};
		}
		throw this.runtimeError('Unsupported assignment target.');
	}

	private assignResolvedTarget(target: ResolvedAssignmentTarget, value: LuaValue): void {
		if (target.kind === 'identifier') {
			if (target.environment !== null) {
				target.environment.set(target.name, value);
			}
			else {
				this.globals.set(target.name, value);
			}
			return;
		}
		if (target.kind === 'member') {
			target.table.set(target.key, value);
			return;
		}
		if (target.kind === 'index') {
			target.table.set(target.index, value);
			return;
		}
		throw this.runtimeError('Unsupported assignment target kind.');
	}

	private invokeMetamethod(table: LuaTable, name: string, args: ReadonlyArray<LuaValue>): LuaValue[] | null {
		const metatable = table.getMetatable();
		if (metatable === null) {
			return null;
		}
		const handler = metatable.get(name);
		if (handler === null) {
			return null;
		}
		const functionValue = this.expectFunction(handler, `Metamethod ${name} must be a function.`, null);
		return functionValue.call(args);
	}

	private nextRandom(): number {
		this.randomSeedValue = (this.randomSeedValue * 1664525 + 1013904223) % 4294967296;
		return this.randomSeedValue / 4294967296;
	}

	private serializeValueInternal(value: LuaValue, visited: Set<LuaTable>): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (value instanceof LuaTable) {
			if (visited.has(value)) {
				throw this.runtimeError('Cannot serialize cyclic table structures.');
			}
			visited.add(value);
			const entriesData: unknown[] = [];
			const entries = value.entriesArray();
			for (const entry of entries) {
				const serializedKey = this.serializeValueInternal(entry[0], visited);
				const serializedValue = this.serializeValueInternal(entry[1], visited);
				entriesData.push({ key: serializedKey, value: serializedValue });
			}
			const metatable = value.getMetatable();
			const serializedMetatable = metatable !== null ? this.serializeValueInternal(metatable, visited) : null;
			visited.delete(value);
			return { type: 'table', entries: entriesData, metatable: serializedMetatable };
		}
		const functionValue = this.expectFunction(value, 'Unable to serialize value.', null);
		return { type: 'function', name: functionValue.name };
	}

	private deserializeValueInternal(data: unknown): LuaValue {
		if (data === null || typeof data === 'boolean' || typeof data === 'number' || typeof data === 'string') {
			return data as LuaValue;
		}
		if (typeof data !== 'object') {
			throw this.runtimeError('Unsupported serialized value.');
		}
		const record = data as Record<string, unknown>;
		const typeField = record.type;
		if (typeField === 'table') {
			const entriesData = record.entries;
			if (!Array.isArray(entriesData)) {
				throw this.runtimeError('Invalid serialized table entries.');
			}
			const table = new LuaTable();
			for (const entry of entriesData) {
				if (typeof entry !== 'object' || entry === null) {
					throw this.runtimeError('Invalid serialized table entry.');
				}
				const entryRecord = entry as Record<string, unknown>;
				if (!('key' in entryRecord) || !('value' in entryRecord)) {
					throw this.runtimeError('Invalid serialized table entry.');
				}
				const key = this.deserializeValueInternal(entryRecord.key);
				const entryValue = this.deserializeValueInternal(entryRecord.value);
				table.set(key, entryValue);
			}
			if ('metatable' in record && record.metatable !== null) {
				const deserializedMetatable = this.deserializeValueInternal(record.metatable);
				if (!(deserializedMetatable instanceof LuaTable)) {
					throw this.runtimeError('Serialized metatable must resolve to a table.');
				}
				table.setMetatable(deserializedMetatable);
			}
			return table;
		}
		if (typeField === 'function') {
			const nameField = record.name;
			if (typeof nameField !== 'string') {
				throw this.runtimeError('Serialized function entry missing name.');
			}
			return this.findFunctionByQualifiedName(nameField);
		}
		throw this.runtimeError('Unsupported serialized value type.');
	}

	private findFunctionByQualifiedName(name: string): LuaFunctionValue {
		if (name.length === 0) {
			throw this.runtimeError('Cannot deserialize unnamed function.');
		}
		let methodName: string | null = null;
		let path = name;
		const colonIndex = name.indexOf(':');
		if (colonIndex >= 0) {
			methodName = name.substring(colonIndex + 1);
			path = name.substring(0, colonIndex);
		}
		const segments = path.split('.');
		if (segments.length === 0) {
			throw this.runtimeError(`Function '${name}' not found during deserialization.`);
		}
		let value: LuaValue | null = this.globals.get(segments[0]);
		if (value === null) {
			throw this.runtimeError(`Function '${name}' not found during deserialization.`);
		}
		for (let index = 1; index < segments.length; index += 1) {
			if (!(value instanceof LuaTable)) {
				throw this.runtimeError(`Function '${name}' not found during deserialization.`);
			}
			value = value.get(segments[index]);
		}
		if (methodName !== null) {
			if (!(value instanceof LuaTable)) {
				throw this.runtimeError(`Function '${name}' not found during deserialization.`);
			}
			value = value.get(methodName);
		}
		const functionValue = this.expectFunction(value, `Function '${name}' not found during deserialization.`, null);
		return functionValue;
	}

	private lookupIdentifier(name: string, environment: LuaEnvironment): LuaValue | null {
		const value = environment.get(name);
		if (value !== null) {
			return value;
		}
		return this.globals.get(name);
	}

	private compareNumbers(expression: LuaBinaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, comparator: (left: number, right: number) => boolean): boolean {
		const left = this.expectNumber(this.evaluateSingleExpression(expression.left, environment, varargs), 'Comparison operands must be numbers.', expression.range);
		const right = this.expectNumber(this.evaluateSingleExpression(expression.right, environment, varargs), 'Comparison operands must be numbers.', expression.range);
		return comparator(left, right);
	}

	private applyNumericBinary(expression: LuaBinaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, operator: (left: number, right: number) => number): number {
		const left = this.expectNumber(this.evaluateSingleExpression(expression.left, environment, varargs), 'Arithmetic operands must be numbers.', expression.range);
		const right = this.expectNumber(this.evaluateSingleExpression(expression.right, environment, varargs), 'Arithmetic operands must be numbers.', expression.range);
		return operator(left, right);
	}

	private isTruthy(value: LuaValue): boolean {
		if (value === null) {
			return false;
		}
		if (value === false) {
			return false;
		}
		return true;
	}

	private expectNumber(value: LuaValue, message: string, range: LuaSourceRange | null): number {
		if (typeof value === 'number') {
			return value;
		}
		if (range !== null) {
			throw this.runtimeErrorAt(range, message);
		}
		throw this.runtimeError(message);
	}

	private expectFunction(value: LuaValue, message: string, range: LuaSourceRange | null): LuaFunctionValue {
		if (typeof value === 'object' && value !== null) {
			if ('call' in value) {
				const candidate = value as LuaFunctionValue;
				if (typeof candidate.call === 'function') {
					return candidate;
				}
			}
		}
		if (range !== null) {
			throw this.runtimeErrorAt(range, message);
		}
		throw this.runtimeError(message);
	}

	private expectString(value: LuaValue, message: string, range: LuaSourceRange | null): string {
		if (typeof value === 'string') {
			return value;
		}
		if (range !== null) {
			throw this.runtimeErrorAt(range, message);
		}
		throw this.runtimeError(message);
	}

	private toLuaString(value: LuaValue): string {
		if (value === null) {
			return 'nil';
		}
		if (typeof value === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value.toString() : 'nan';
		}
		if (typeof value === 'string') {
			return value;
		}
		if (value instanceof LuaTable) {
			return 'table';
		}
		return 'function';
	}

	private createScriptFunction(expression: LuaFunctionExpression, environment: LuaEnvironment, name: string, implicitSelfName: string | null): LuaScriptFunction {
		return new LuaScriptFunction(name, this, expression, environment, implicitSelfName);
	}

	public invokeScriptFunction(expression: LuaFunctionExpression, closure: LuaEnvironment, name: string, args: ReadonlyArray<LuaValue>, implicitSelfName: string | null): LuaValue[] {
		const activationEnvironment = LuaEnvironment.createChild(closure);
		const parameters = expression.parameters;
		let argumentIndex = 0;
		if (implicitSelfName !== null) {
			const selfValue = argumentIndex < args.length ? args[argumentIndex] : null;
			activationEnvironment.set(implicitSelfName, selfValue);
			argumentIndex += 1;
		}
		for (const parameter of parameters) {
			const value = argumentIndex < args.length ? args[argumentIndex] : null;
			activationEnvironment.set(parameter.name, value);
			argumentIndex += 1;
		}
		let varargValues: LuaValue[] = [];
		if (expression.hasVararg) {
			const extras: LuaValue[] = [];
			for (let index = argumentIndex; index < args.length; index += 1) {
				extras.push(args[index]);
			}
			varargValues = extras;
		}
		const signal = this.executeBlock(expression.body, activationEnvironment, varargValues, null);
		if (signal.kind === 'return') {
			return Array.from(signal.values);
		}
		if (signal.kind === 'break') {
			throw this.runtimeErrorAt(expression.range, `Cannot break from function '${name}'.`);
		}
		if (signal.kind === 'goto') {
			throw this.runtimeErrorAt(signal.origin.range, `Label '${signal.label}' not found in function '${name}'.`);
		}
		return [];
	}

	private validateReservedIdentifiers(statements: ReadonlyArray<LuaStatement>): void {
		if (this.reservedIdentifiers.size === 0) {
			return;
		}
		for (const statement of statements) {
			switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement: {
					const localAssignment = statement as LuaLocalAssignmentStatement;
					for (const name of localAssignment.names) {
						this.ensureIdentifierNotReserved(name.name, name.range);
					}
					break;
				}
				case LuaSyntaxKind.LocalFunctionStatement: {
					const localFunc = statement as LuaLocalFunctionStatement;
					this.ensureIdentifierNotReserved(localFunc.name.name, localFunc.name.range);
					this.validateFunctionExpression(localFunc.functionExpression);
					break;
				}
				case LuaSyntaxKind.FunctionDeclarationStatement: {
					const funcDecl = statement as LuaFunctionDeclarationStatement;
					if (funcDecl.name.identifiers.length > 0) {
						this.ensureIdentifierNotReserved(funcDecl.name.identifiers[0], funcDecl.range);
					}
					if (funcDecl.name.methodName) {
						this.ensureIdentifierNotReserved(funcDecl.name.methodName, funcDecl.range);
					}
					this.validateFunctionExpression(funcDecl.functionExpression);
					break;
				}
				case LuaSyntaxKind.AssignmentStatement: {
					const assignment = statement as LuaAssignmentStatement;
					for (const target of assignment.left) {
						if (target.kind === LuaSyntaxKind.IdentifierExpression) {
							const identifier = target as LuaIdentifierExpression;
							this.ensureIdentifierNotReserved(identifier.name, identifier.range);
						}
					}
					break;
				}
				case LuaSyntaxKind.IfStatement: {
					const ifStatement = statement as LuaIfStatement;
					for (const clause of ifStatement.clauses) {
						this.validateReservedIdentifiers(clause.block.body);
					}
					break;
				}
				case LuaSyntaxKind.WhileStatement:
					this.validateReservedIdentifiers((statement as LuaWhileStatement).block.body);
					break;
				case LuaSyntaxKind.RepeatStatement:
					this.validateReservedIdentifiers((statement as LuaRepeatStatement).block.body);
					break;
				case LuaSyntaxKind.ForNumericStatement: {
					const numeric = statement as LuaForNumericStatement;
					this.ensureIdentifierNotReserved(numeric.variable.name, numeric.variable.range);
					this.validateReservedIdentifiers(numeric.block.body);
					break;
				}
				case LuaSyntaxKind.ForGenericStatement: {
					const generic = statement as LuaForGenericStatement;
					for (const variable of generic.variables) {
						this.ensureIdentifierNotReserved(variable.name, variable.range);
					}
					this.validateReservedIdentifiers(generic.block.body);
					break;
				}
				case LuaSyntaxKind.DoStatement:
					this.validateReservedIdentifiers((statement as LuaDoStatement).block.body);
					break;
				default:
					break;
			}
		}
	}

	private ensureIdentifierNotReserved(name: string, range: LuaSourceRange): void {
		if (this.reservedIdentifiers.has(name)) {
			throw new LuaSyntaxError(`'${name}' is reserved and cannot be redefined.`, range.chunkName, range.start.line, range.start.column);
		}
	}

	private validateFunctionExpression(expression: LuaFunctionExpression): void {
		for (const parameter of expression.parameters) {
			this.ensureIdentifierNotReserved(parameter.name, parameter.range);
		}
		this.validateReservedIdentifiers(expression.body.body);
	}

	private initializeBuiltins(): void {
		this.globals.set('print', new LuaNativeFunction('print', this, (interpreter, args) => {
			const parts: string[] = [];
			for (const value of args) {
				parts.push(interpreter.toLuaString(value));
			}
			if (parts.length === 0) {
				console.log('');
			}
			else {
				console.log(parts.join('\t'));
			}
			return [];
		}));

		this.globals.set('type', new LuaNativeFunction('type', this, (_interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			let result: string;
			if (value === null) {
				result = 'nil';
			}
			else if (typeof value === 'boolean') {
				result = 'boolean';
			}
			else if (typeof value === 'number') {
				result = 'number';
			}
			else if (typeof value === 'string') {
				result = 'string';
			}
			else if (value instanceof LuaTable) {
				result = 'table';
			}
			else {
				result = 'function';
			}
			return [result];
		}));

		this.globals.set('tostring', new LuaNativeFunction('tostring', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			return [interpreter.toLuaString(value)];
		}));

		this.globals.set('tonumber', new LuaNativeFunction('tonumber', this, (_interpreter, args) => {
			if (args.length === 0) {
				return [null];
			}
			const value = args[0];
			if (typeof value === 'number') {
				return [value];
			}
			if (typeof value === 'string') {
				const converted = Number(value);
				if (Number.isFinite(converted)) {
					return [converted];
				}
				return [null];
			}
			return [null];
		}));

		this.globals.set('setmetatable', new LuaNativeFunction('setmetatable', this, (interpreter, args) => {
			if (args.length === 0 || !(args[0] instanceof LuaTable)) {
				throw interpreter.runtimeError('setmetatable expects a table as the first argument.');
			}
			const targetTable = args[0] as LuaTable;
			let metatable: LuaTable | null = null;
			if (args.length >= 2) {
				const metaArg = args[1];
				if (metaArg !== null && !(metaArg instanceof LuaTable)) {
					throw interpreter.runtimeError('setmetatable expects a table or nil as the second argument.');
				}
				if (metaArg instanceof LuaTable) {
					metatable = metaArg;
				}
			}
			targetTable.setMetatable(metatable);
			return [targetTable];
		}));

		this.globals.set('getmetatable', new LuaNativeFunction('getmetatable', this, (interpreter, args) => {
			if (args.length === 0 || !(args[0] instanceof LuaTable)) {
				throw interpreter.runtimeError('getmetatable expects a table as the first argument.');
			}
			const targetTable = args[0] as LuaTable;
			const metatable = targetTable.getMetatable();
			if (metatable === null) {
				return [null];
			}
			return [metatable];
		}));

		const mathTable = new LuaTable();
		mathTable.set('abs', new LuaNativeFunction('math.abs', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = interpreter.expectNumber(value, 'math.abs expects a number.', null);
			return [Math.abs(number)];
		}));
		mathTable.set('ceil', new LuaNativeFunction('math.ceil', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = interpreter.expectNumber(value, 'math.ceil expects a number.', null);
			return [Math.ceil(number)];
		}));
		mathTable.set('floor', new LuaNativeFunction('math.floor', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = interpreter.expectNumber(value, 'math.floor expects a number.', null);
			return [Math.floor(number)];
		}));
		mathTable.set('max', new LuaNativeFunction('math.max', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('math.max expects at least one argument.');
			}
			let result = interpreter.expectNumber(args[0], 'math.max expects numeric arguments.', null);
			for (let index = 1; index < args.length; index += 1) {
				const value = interpreter.expectNumber(args[index], 'math.max expects numeric arguments.', null);
				if (value > result) {
					result = value;
				}
			}
			return [result];
		}));
		mathTable.set('min', new LuaNativeFunction('math.min', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('math.min expects at least one argument.');
			}
			let result = interpreter.expectNumber(args[0], 'math.min expects numeric arguments.', null);
			for (let index = 1; index < args.length; index += 1) {
				const value = interpreter.expectNumber(args[index], 'math.min expects numeric arguments.', null);
				if (value < result) {
					result = value;
				}
			}
			return [result];
		}));
		mathTable.set('sqrt', new LuaNativeFunction('math.sqrt', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = interpreter.expectNumber(value, 'math.sqrt expects a number.', null);
			if (number < 0) {
				throw interpreter.runtimeError('math.sqrt cannot operate on negative numbers.');
			}
			return [Math.sqrt(number)];
		}));
		mathTable.set('random', new LuaNativeFunction('math.random', this, (interpreter, args) => {
			const randomValue = interpreter.nextRandom();
			if (args.length === 0) {
				return [randomValue];
			}
			if (args.length === 1) {
				const upper = interpreter.expectNumber(args[0], 'math.random expects numeric bounds.', null);
				const upperInt = Math.floor(upper);
				if (upperInt < 1) {
					throw interpreter.runtimeError('math.random upper bound must be positive.');
				}
				return [Math.floor(randomValue * upperInt) + 1];
			}
			const lower = interpreter.expectNumber(args[0], 'math.random expects numeric bounds.', null);
			const upper = interpreter.expectNumber(args[1], 'math.random expects numeric bounds.', null);
			const lowerInt = Math.floor(lower);
			const upperInt = Math.floor(upper);
			if (upperInt < lowerInt) {
				throw interpreter.runtimeError('math.random upper bound must be greater than or equal to lower bound.');
			}
			const span = upperInt - lowerInt + 1;
			return [lowerInt + Math.floor(randomValue * span)];
		}));
		mathTable.set('randomseed', new LuaNativeFunction('math.randomseed', this, (interpreter, args) => {
			const seedValue = args.length > 0 ? interpreter.expectNumber(args[0], 'math.randomseed expects a number.', null) : Date.now();
			interpreter.randomSeedValue = Math.floor(seedValue) >>> 0;
			return [];
		}));
		mathTable.set('pi', Math.PI);
		this.globals.set('math', mathTable);

		const stringTable = new LuaTable();
		stringTable.set('len', new LuaNativeFunction('string.len', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(value, 'string.len expects a string.', null);
			return [str.length];
		}));
		stringTable.set('upper', new LuaNativeFunction('string.upper', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(value, 'string.upper expects a string.', null);
			return [str.toUpperCase()];
		}));
		stringTable.set('lower', new LuaNativeFunction('string.lower', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(value, 'string.lower expects a string.', null);
			return [str.toLowerCase()];
		}));
		stringTable.set('sub', new LuaNativeFunction('string.sub', this, (interpreter, args) => {
			const source = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(source, 'string.sub expects a string.', null);
			const startArg = args.length > 1 ? interpreter.expectNumber(args[1], 'string.sub expects numeric indices.', null) : 1;
			const endArg = args.length > 2 ? interpreter.expectNumber(args[2], 'string.sub expects numeric indices.', null) : str.length;
			const startIndex = Math.max(1, Math.floor(startArg));
			const endIndex = Math.floor(endArg);
			if (endIndex < startIndex) {
				return [''];
			}
			const zeroBasedStart = startIndex - 1;
			const slice = str.substring(zeroBasedStart, endIndex);
			return [slice];
		}));
		stringTable.set('find', new LuaNativeFunction('string.find', this, (interpreter, args) => {
			const source = args.length > 0 ? args[0] : '';
			const pattern = args.length > 1 ? args[1] : '';
			const str = interpreter.expectString(source, 'string.find expects a string.', null);
			const pat = interpreter.expectString(pattern, 'string.find expects a pattern string.', null);
			const startIndex = args.length > 2 ? Math.max(1, Math.floor(interpreter.expectNumber(args[2], 'string.find expects numeric start index.', null))) - 1 : 0;
			const position = str.indexOf(pat, startIndex);
			if (position === -1) {
				return [null];
			}
			const first = position + 1;
			const last = first + pat.length - 1;
			return [first, last];
		}));
		stringTable.set('byte', new LuaNativeFunction('string.byte', this, (interpreter, args) => {
			const source = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(source, 'string.byte expects a string.', null);
			const positionArg = args.length > 1 ? interpreter.expectNumber(args[1], 'string.byte expects a numeric position.', null) : 1;
			const position = Math.floor(positionArg) - 1;
			if (position < 0 || position >= str.length) {
				return [null];
			}
			return [str.charCodeAt(position)];
		}));
		stringTable.set('char', new LuaNativeFunction('string.char', this, (interpreter, args) => {
			if (args.length === 0) {
				return [''];
			}
			let result = '';
			for (const value of args) {
				const code = interpreter.expectNumber(value, 'string.char expects numeric character codes.', null);
				result += String.fromCharCode(Math.floor(code));
			}
			return [result];
		}));
		this.globals.set('string', stringTable);

		const osTable = new LuaTable();
		osTable.set('time', new LuaNativeFunction('os.time', this, (interpreter, args) => {
			if (args.length === 0) {
				return [Math.floor(Date.now() / 1000)];
			}
			const tableArg = args[0];
			if (!(tableArg instanceof LuaTable)) {
				throw this.runtimeError('os.time expects a table or no arguments.');
			}
			const year = tableArg.get('year');
			const month = tableArg.get('month');
			const day = tableArg.get('day');
			const hour = tableArg.get('hour');
			const min = tableArg.get('min');
			const sec = tableArg.get('sec');
			const date = new Date(
				interpreter.expectNumber(year, 'os.time table requires year.', null),
				interpreter.expectNumber(month, 'os.time table requires month.', null) - 1,
				interpreter.expectNumber(day, 'os.time table requires day.', null),
				interpreter.expectNumber(hour !== null ? hour : 0, 'os.time invalid hour.', null),
				interpreter.expectNumber(min !== null ? min : 0, 'os.time invalid minute.', null),
				interpreter.expectNumber(sec !== null ? sec : 0, 'os.time invalid second.', null)
			);
			return [Math.floor(date.getTime() / 1000)];
		}));
		osTable.set('date', new LuaNativeFunction('os.date', this, (interpreter, args) => {
			const formatValue = args.length > 0 ? args[0] : null;
			const timestampValue = args.length > 1 ? args[1] : null;
			const timestamp = timestampValue === null ? Math.floor(Date.now() / 1000) : Math.floor(interpreter.expectNumber(timestampValue, 'os.date expects numeric timestamp.', null));
			const date = new Date(timestamp * 1000);
			if (formatValue === null) {
				return [date.toISOString()];
			}
			const format = interpreter.expectString(formatValue, 'os.date expects a format string.', null);
			if (format === '*t') {
				const table = new LuaTable();
				table.set('year', date.getUTCFullYear());
				table.set('month', date.getUTCMonth() + 1);
				table.set('day', date.getUTCDate());
				table.set('hour', date.getUTCHours());
				table.set('min', date.getUTCMinutes());
				table.set('sec', date.getUTCSeconds());
				table.set('isdst', false);
				return [table];
			}
			return [date.toISOString()];
		}));
		osTable.set('difftime', new LuaNativeFunction('os.difftime', this, (interpreter, args) => {
			const t2 = args.length > 0 ? interpreter.expectNumber(args[0], 'os.difftime expects numeric arguments.', null) : 0;
			const t1 = args.length > 1 ? interpreter.expectNumber(args[1], 'os.difftime expects numeric arguments.', null) : 0;
			return [t2 - t1];
		}));
		this.globals.set('os', osTable);

		this.globals.set('pairs', new LuaNativeFunction('pairs', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('pairs expects a table argument.');
			}
			const table = args[0];
			if (!(table instanceof LuaTable)) {
				throw interpreter.runtimeError('pairs expects a table argument.');
			}
			const state: IteratorState = {
				entries: table.entriesArray(),
			};
			const iterator = new LuaNativeFunction('pairs_iterator', interpreter, (_selfInterpreter, iteratorArgs) => {
				const [, lastKey] = iteratorArgs;
				let startIndex = 0;
				const entries = state.entries;
				if (lastKey !== null) {
					for (let index = 0; index < entries.length; index += 1) {
						const entry = entries[index];
						if (entry[0] === lastKey) {
							startIndex = index + 1;
							break;
						}
					}
				}
				if (startIndex >= entries.length) {
					return [null];
				}
				const entry = entries[startIndex];
				return [entry[0], entry[1]];
			});
			return [iterator, table, null];
		}));

		this.globals.set('ipairs', new LuaNativeFunction('ipairs', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('ipairs expects a table argument.');
			}
			const table = args[0];
			if (!(table instanceof LuaTable)) {
				throw interpreter.runtimeError('ipairs expects a table argument.');
			}
			const iterator = new LuaNativeFunction('ipairs_iterator', interpreter, (_selfInterpreter, iteratorArgs) => {
				const tableArg = iteratorArgs.length > 0 ? iteratorArgs[0] : null;
				const indexValue = iteratorArgs.length > 1 ? iteratorArgs[1] : null;
				if (!(tableArg instanceof LuaTable)) {
					return [null];
				}
				const index = typeof indexValue === 'number' ? indexValue + 1 : 1;
				const value = tableArg.get(index);
				if (value === null) {
					return [null];
				}
				return [index, value];
			});
			return [iterator, table, 0];
		}));

		this.globals.set('serialize', new LuaNativeFunction('serialize', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			try {
				const serialized = interpreter.serializeValueInternal(value, new Set<LuaTable>());
				return [JSON.stringify(serialized)];
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw interpreter.runtimeError(`serialize failed: ${message}`);
			}
		}));

		this.globals.set('deserialize', new LuaNativeFunction('deserialize', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('deserialize expects a string argument.');
			}
			const source = args[0];
			if (typeof source !== 'string') {
				throw interpreter.runtimeError('deserialize expects a string argument.');
			}
			try {
				const parsed = JSON.parse(source);
				const value = interpreter.deserializeValueInternal(parsed);
				return [value];
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw interpreter.runtimeError(`deserialize failed: ${message}`);
			}
		}));
	}

	private runtimeError(message: string): LuaRuntimeError {
		return new LuaRuntimeError(message, this.currentChunk, 0, 0);
	}

	private runtimeErrorAt(range: LuaSourceRange, message: string): LuaRuntimeError {
		return new LuaRuntimeError(message, range.chunkName, range.start.line, range.start.column);
	}
}

export function createLuaInterpreter(): LuaInterpreter {
	return new LuaInterpreter(null);
}

export function createLuaNativeFunction(name: string, interpreter: LuaInterpreter, handler: (interpreter: LuaInterpreter, args: ReadonlyArray<LuaValue>) => ReadonlyArray<LuaValue>): LuaFunctionValue {
	return new LuaNativeFunction(name, interpreter, handler);
}
