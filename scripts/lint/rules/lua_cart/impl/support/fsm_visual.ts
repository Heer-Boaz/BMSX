import { type LuaCallExpression as CallExpression, type LuaExpression as Expression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { findCallExpressionInStatements, getCallMethodName, getCallReceiverExpression, isGlobalCall, visitCallExpressionsInStatements } from '../../../../../../src/bmsx/lua/syntax/calls';
import { getFunctionLeafName } from './functions';
import { isSelfExpressionRoot } from './self_properties';
import { findTableFieldByKey, readBooleanFieldValueFromTable, readStringFieldValueFromTable } from './table_fields';
import { FsmVisualPrefabDefaults } from './types';

export function isVisualUpdateLikeFunctionName(functionName: string): boolean {
	if (!functionName || functionName === '<anonymous>') {
		return false;
	}
	const leaf = getFunctionLeafName(functionName).toLowerCase();
	return /^update(?:_[a-z0-9]+)*_visual(?:_[a-z0-9]+)*$/.test(leaf)
		|| /^sync(?:_[a-z0-9]+)*_components(?:_[a-z0-9]+)*$/.test(leaf)
		|| /^apply(?:_[a-z0-9]+)*_pose(?:_[a-z0-9]+)*$/.test(leaf)
		|| /^refresh(?:_[a-z0-9]+)*_presentation(?:_[a-z0-9]+)*(?:_if_changed)?$/.test(leaf);
}

export function isSelfGfxCallExpression(expression: CallExpression): boolean {
	if (getCallMethodName(expression) !== 'gfx') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	return !!receiver && isSelfExpressionRoot(receiver);
}

export function getSelfGfxStringLiteralArgument(expression: CallExpression): string | undefined {
	if (!isSelfGfxCallExpression(expression) || expression.arguments.length !== 1) {
		return undefined;
	}
	const argument = expression.arguments[0];
	if (argument.kind !== SyntaxKind.StringLiteralExpression) {
		return undefined;
	}
	return argument.value;
}

export function stateTimelinesDriveSelfGfx(stateExpression: Expression): boolean {
	const timelinesField = findTableFieldByKey(stateExpression, 'timelines');
	if (!timelinesField || timelinesField.value.kind !== SyntaxKind.TableConstructorExpression) {
		return false;
	}
	for (const timelineField of timelinesField.value.fields) {
		if (timelineField.value.kind !== SyntaxKind.TableConstructorExpression) {
			continue;
		}
		const onFrameField = findTableFieldByKey(timelineField.value, 'on_frame');
		if (!onFrameField || onFrameField.value.kind !== SyntaxKind.FunctionExpression) {
			continue;
		}
		if (findCallExpressionInStatements(onFrameField.value.body.body, isSelfGfxCallExpression)) {
			return true;
		}
	}
	return false;
}

export function collectPrefabVisualDefaultsById(statements: ReadonlyArray<Statement>): ReadonlyMap<string, FsmVisualPrefabDefaults> {
	const prefabs = new Map<string, FsmVisualPrefabDefaults>();
	visitCallExpressionsInStatements(statements, (expression) => {
		if (!isGlobalCall(expression, 'define_prefab')) {
			return;
		}
		const definition = expression.arguments[0];
		const defId = readStringFieldValueFromTable(definition, 'def_id');
		if (!defId) {
			return;
		}
		const defaultsField = findTableFieldByKey(definition, 'defaults');
		const defaults = defaultsField?.value;
		prefabs.set(defId, {
			imgid: readStringFieldValueFromTable(defaults, 'imgid'),
			visible: readBooleanFieldValueFromTable(defaults, 'visible'),
		});
	});
	return prefabs;
}
