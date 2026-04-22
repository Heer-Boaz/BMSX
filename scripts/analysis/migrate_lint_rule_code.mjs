import { readFileSync, writeFileSync } from 'node:fs';

const moves = [
	{
		source: 'scripts/analysis/cpp_quality/rules.ts',
		target: 'scripts/lint/rules/code_quality/repeated_expression_pattern.ts',
		symbols: [
			'lintCppRepeatedExpressions',
			'cppRepeatedAccessChain',
		],
		targetImports: [
			"import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';",
			"import { collectCppStatementRanges, cppRangeHas, findCppAccessChainStart } from '../../../../src/bmsx/language/cpp/syntax/syntax';",
			"import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';",
			"import { cppTokenText, normalizedCppTokenText } from '../../../../src/bmsx/language/cpp/syntax/tokens';",
			"import type { CppLintIssue } from '../../../analysis/cpp_quality/diagnostics';",
			"import { repeatedAccessChainPatternRule } from './repeated_access_chain_pattern';",
		],
		targetSupport: [
			'',
			'function compactCppSampleText(text: string): string {',
			'\treturn text.length <= 180 ? text : `${text.slice(0, 177)}...`;',
			'}',
		].join('\n'),
		analyzerImport: "import { lintCppRepeatedExpressions } from '../../lint/rules/code_quality/repeated_expression_pattern';",
		analyzerRemoveFromRulesImport: 'lintCppRepeatedExpressions',
	},
];

for (const move of moves) {
	applyMove(move);
}

function applyMove(move) {
	let source = readFileSync(move.source, 'utf8');
	let target = readFileSync(move.target, 'utf8');
	const extracted = [];
	for (const symbol of move.symbols) {
		const block = extractFunctionBlock(source, symbol);
		if (block === null) {
			continue;
		}
		source = source.slice(0, block.start) + source.slice(block.end);
		extracted.push(block.text.trim());
	}
	if (extracted.length === 0) {
		return;
	}
	target = addImports(target, move.targetImports);
	if (move.targetSupport && !target.includes('function compactCppSampleText(')) {
		target = `${target.trimEnd()}\n${move.targetSupport}\n`;
	}
	for (const block of extracted) {
		const name = functionName(block);
		const adjusted = block.replaceAll('compactSampleText(', 'compactCppSampleText(');
		if (!target.includes(`function ${name}(`) && !target.includes(`function ${name}<`) && !target.includes(`export function ${name}(`)) {
			target = `${target.trimEnd()}\n\n${adjusted}\n`;
		}
	}
	writeFileSync(move.source, source);
	writeFileSync(move.target, target);
	updateAnalyzer(move);
}

function extractFunctionBlock(source, name) {
	const match = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(source);
	if (match === null) {
		return null;
	}
	const brace = source.indexOf('{', match.index);
	if (brace === -1) {
		throw new Error(`No body for ${name}`);
	}
	let depth = 0;
	for (let index = brace; index < source.length; index += 1) {
		const char = source[index];
		if (char === '{') {
			depth += 1;
		} else if (char === '}') {
			depth -= 1;
			if (depth === 0) {
				let end = index + 1;
				while (source[end] === '\n') {
					end += 1;
				}
				return {
					start: match.index,
					end,
					text: source.slice(match.index, index + 1),
				};
			}
		}
	}
	throw new Error(`Unclosed body for ${name}`);
}

function addImports(source, imports) {
	let result = source;
	for (const importLine of imports) {
		if (result.includes(importLine)) {
			continue;
		}
		result = `${importLine}\n${result}`;
	}
	return result;
}

function functionName(block) {
	const match = /function\s+([A-Za-z0-9_]+)/.exec(block);
	if (match === null) {
		throw new Error(`Cannot read function name from block: ${block.slice(0, 80)}`);
	}
	return match[1];
}

function updateAnalyzer(move) {
	const path = 'scripts/analysis/cpp_quality/analyzer.ts';
	let source = readFileSync(path, 'utf8');
	if (!source.includes(move.analyzerImport)) {
		const insertion = source.indexOf("import { readFileSync } from 'node:fs';");
		source = `${source.slice(0, insertion)}${move.analyzerImport}\n${source.slice(insertion)}`;
	}
	source = source.replace(new RegExp(`\\n\\s*${move.analyzerRemoveFromRulesImport},`, 'g'), '');
	writeFileSync(path, source);
}
