import ts from 'typescript';

export function compactStatementText(node: ts.Statement, sourceFile: ts.SourceFile): string {
	return node.getText(sourceFile).replace(/\s+/g, ' ').trim();
}
