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
	type LuaLocalFunctionStatement,
	type LuaMemberExpression,
	type LuaTableConstructorExpression,
} from '../../syntax/ast';
import { extractAssignmentPath, extractTableKeyFromExpression, visitNamedTableFields } from './expression_paths';

export type ModuleExportNode = {
	children: Map<string, ModuleExportNode>;
};

export const createModuleExportNode = (): ModuleExportNode => ({
	children: new Map<string, ModuleExportNode>(),
});

const resolveStaticModuleShapePath = (
	expression: LuaExpression,
	localShapes: ReadonlyMap<string, ModuleExportNode>,
): ModuleExportNode | null => {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		const identifier = expression as LuaIdentifierExpression;
		const shape = localShapes.get(identifier.name);
		if (shape === undefined) {
			return null;
		}
		return shape;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const member = expression as LuaMemberExpression;
		const baseShape = resolveStaticModuleShapePath(member.base, localShapes);
		if (!baseShape) {
			return null;
		}
		const shape = baseShape.children.get(member.identifier);
		return shape !== undefined ? shape : null;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const indexExpr = expression as LuaIndexExpression;
		const baseShape = resolveStaticModuleShapePath(indexExpr.base, localShapes);
		if (!baseShape) {
			return null;
		}
		const key = extractTableKeyFromExpression(indexExpr.index);
		if (!key) {
			return null;
		}
		const shape = baseShape.children.get(key);
		return shape !== undefined ? shape : null;
	}
	return null;
};

export const buildModuleShapeFromExpression = (
	expression: LuaExpression,
	localShapes: ReadonlyMap<string, ModuleExportNode>,
): ModuleExportNode | null => {
	if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		const table = expression as LuaTableConstructorExpression;
		const node = createModuleExportNode();
		visitNamedTableFields(table, (key, value) => {
			node.children.set(
				key,
				buildModuleShapeOrEmpty(value, localShapes),
			);
		});
		return node;
	}
	return resolveStaticModuleShapePath(expression, localShapes);
};

function buildModuleShapeOrEmpty(expression: LuaExpression, localShapes: ReadonlyMap<string, ModuleExportNode>): ModuleExportNode {
	return buildModuleShapeFromExpression(expression, localShapes) ?? createModuleExportNode();
}

const assignModuleShapePath = (
	root: ModuleExportNode,
	path: ReadonlyArray<string>,
	startIndex: number,
	value: ModuleExportNode,
	methodName: string | null = null,
): void => {
	if (startIndex >= path.length && (!methodName || methodName.length === 0)) {
		root.children = value.children;
		return;
	}
	let cursor = root;
	const endIndex = methodName && methodName.length > 0 ? path.length : path.length - 1;
	for (let index = startIndex; index < endIndex; index += 1) {
		const key = path[index];
		let child = cursor.children.get(key);
		if (!child) {
			child = createModuleExportNode();
			cursor.children.set(key, child);
		}
		cursor = child;
	}
	cursor.children.set(methodName && methodName.length > 0 ? methodName : path[path.length - 1], value);
};

export const buildTopLevelLocalModuleShapes = (
	chunk: LuaChunk,
): Map<string, ModuleExportNode> => {
	const localShapes = new Map<string, ModuleExportNode>();
	for (let index = 0; index < chunk.body.length; index += 1) {
		const statement = chunk.body[index];
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			const localAssignment = statement as LuaLocalAssignmentStatement;
			const values = localAssignment.values;
			for (let nameIndex = 0; nameIndex < localAssignment.names.length; nameIndex += 1) {
				const value = values[nameIndex];
				if (!value) {
					continue;
				}
				const shape = buildModuleShapeFromExpression(value, localShapes);
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
				const right = assignment.right[targetIndex];
				if (!right) {
					continue;
				}
				const shape = buildModuleShapeOrEmpty(right, localShapes);
				assignModuleShapePath(rootShape, path, 1, shape);
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.FunctionDeclarationStatement) {
			const declaration = statement as LuaFunctionDeclarationStatement;
			if (declaration.name.identifiers.length === 0) {
				continue;
			}
			const rootName = declaration.name.identifiers[0];
			const rootShape = localShapes.get(rootName);
			if (!rootShape) {
				continue;
			}
			if (declaration.name.identifiers.length === 1 && (!declaration.name.methodName || declaration.name.methodName.length === 0)) {
				continue;
			}
			assignModuleShapePath(rootShape, declaration.name.identifiers, 1, createModuleExportNode(), declaration.name.methodName);
			continue;
		}
		if (statement.kind === LuaSyntaxKind.LocalFunctionStatement) {
			const declaration = statement as LuaLocalFunctionStatement;
			const existing = localShapes.get(declaration.name.name);
			if (existing) {
				localShapes.set(declaration.name.name, existing);
			}
		}
	}
	return localShapes;
};
