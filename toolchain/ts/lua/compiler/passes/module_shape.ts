import {
	LuaAssignmentOperator,
	LuaSyntaxKind,
	type LuaAssignmentStatement,
	type LuaChunk,
	type LuaExpression,
	type LuaFunctionDeclarationStatement,
	type LuaIdentifierExpression,
	type LuaIndexExpression,
	type LuaLocalAssignmentStatement,
	type LuaMemberExpression,
	type LuaTableConstructorExpression,
} from '../../syntax/ast';
import { stringLiteralValue } from '../../syntax/literals';
import { extractAssignmentPath, visitNamedTableFields } from './expression_paths';

export type ModuleExportShape = Map<string, ModuleExportShape>;

const resolveStaticModuleShapePath = (
	expression: LuaExpression,
	localShapes: ReadonlyMap<string, ModuleExportShape>,
): ModuleExportShape | undefined => {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		const identifier = expression as LuaIdentifierExpression;
		return localShapes.get(identifier.name);
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const member = expression as LuaMemberExpression;
		const baseShape = resolveStaticModuleShapePath(member.base, localShapes);
		if (!baseShape) {
			return undefined;
		}
		return baseShape.get(member.member.name);
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const indexExpr = expression as LuaIndexExpression;
		const baseShape = resolveStaticModuleShapePath(indexExpr.base, localShapes);
		if (!baseShape) {
			return undefined;
		}
		const key = stringLiteralValue(indexExpr.index);
		if (key == null) {
			return undefined;
		}
		return baseShape.get(key);
	}
	return undefined;
};

export const buildModuleShapeFromExpression = (
	expression: LuaExpression,
	localShapes: ReadonlyMap<string, ModuleExportShape>,
): ModuleExportShape | undefined => {
	if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		const table = expression as LuaTableConstructorExpression;
		const shape = new Map<string, ModuleExportShape>();
		visitNamedTableFields(table, (key, value) => {
			shape.set(
				key,
				buildModuleShapeOrEmpty(value, localShapes),
			);
		});
		return shape;
	}
	return resolveStaticModuleShapePath(expression, localShapes);
};

function buildModuleShapeOrEmpty(expression: LuaExpression, localShapes: ReadonlyMap<string, ModuleExportShape>): ModuleExportShape {
	return buildModuleShapeFromExpression(expression, localShapes) ?? new Map<string, ModuleExportShape>();
}

const assignModuleShapePath = (
	root: ModuleExportShape,
	path: ReadonlyArray<string>,
	startIndex: number,
	value: ModuleExportShape,
	methodName: string | null,
): void => {
	let cursor = root;
	const endIndex = methodName && methodName.length > 0 ? path.length : path.length - 1;
	for (let index = startIndex; index < endIndex; index += 1) {
		const key = path[index];
		let child = cursor.get(key);
		if (!child) {
			child = new Map<string, ModuleExportShape>();
			cursor.set(key, child);
		}
		cursor = child;
	}
	cursor.set(methodName && methodName.length > 0 ? methodName : path[path.length - 1], value);
};

export const buildTopLevelLocalModuleShapes = (
	chunk: LuaChunk,
): Map<string, ModuleExportShape> => {
	const localShapes = new Map<string, ModuleExportShape>();
	for (let index = 0; index < chunk.body.length; index += 1) {
		const statement = chunk.body[index];
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			const localAssignment = statement as LuaLocalAssignmentStatement;
			const values = localAssignment.values;
			const shapes = new Array<ModuleExportShape | undefined>(values.length);
			for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
				shapes[valueIndex] = buildModuleShapeFromExpression(values[valueIndex], localShapes);
			}
			for (let nameIndex = 0; nameIndex < localAssignment.names.length; nameIndex += 1) {
				const shape = shapes[nameIndex];
				if (!shape) {
					continue;
				}
				localShapes.set(localAssignment.names[nameIndex].name, shape);
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.AssignmentStatement) {
			const assignment = statement as LuaAssignmentStatement;
			if (assignment.operator !== LuaAssignmentOperator.Assign) {
				continue;
			}
			const shapes = new Array<ModuleExportShape | undefined>(assignment.right.length);
			for (let rightIndex = 0; rightIndex < assignment.right.length; rightIndex += 1) {
				shapes[rightIndex] = buildModuleShapeOrEmpty(assignment.right[rightIndex], localShapes);
			}
			for (let targetIndex = 0; targetIndex < assignment.left.length; targetIndex += 1) {
				const left = assignment.left[targetIndex];
				const path = extractAssignmentPath(left);
				if (!path || path.length === 0) {
					continue;
				}
				const rootName = path[0];
				const rootShape = localShapes.get(rootName);
				if (!rootShape) {
					continue;
				}
				const shape = shapes[targetIndex];
				if (!shape) {
					continue;
				}
				if (path.length === 1) {
					localShapes.set(rootName, shape);
				} else {
					assignModuleShapePath(rootShape, path, 1, shape, null);
				}
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.FunctionDeclarationStatement) {
			const declaration = statement as LuaFunctionDeclarationStatement;
			const path = declaration.name.path;
			if (path.length === 0) {
				continue;
			}
			const rootName = path[0].name;
			const rootShape = localShapes.get(rootName);
			if (!rootShape) {
				continue;
			}
			if (path.length === 1 && declaration.name.method === null) {
				continue;
			}
			const names = new Array<string>(path.length);
			for (let pathIndex = 0; pathIndex < path.length; pathIndex += 1) {
				names[pathIndex] = path[pathIndex].name;
			}
			const method = declaration.name.method;
			assignModuleShapePath(
				rootShape,
				names,
				1,
				new Map<string, ModuleExportShape>(),
				method === null ? null : method.name,
			);
		}
	}
	return localShapes;
};
