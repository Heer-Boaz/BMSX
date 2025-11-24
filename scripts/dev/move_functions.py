#!/usr/bin/env python3
"""Utility to migrate exported functions between editor source files."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Sequence, Tuple

class FunctionExtractionError(RuntimeError):
	def __init__(self, name: str, message: str) -> None:
		super().__init__(f"{name}: {message}")
		self.name = name

def read_function_names(values: Sequence[str], file_hint: Path | None) -> List[str]:
	names: List[str] = []
	for value in values:
		candidate = value.strip()
		if not candidate:
			continue
		names.append(candidate)
	if file_hint is not None:
		text = file_hint.read_text(encoding='utf-8')
		for raw in text.splitlines():
			candidate = raw.strip()
			if not candidate or candidate.startswith('#'):
				continue
			names.append(candidate)
	if not names:
		raise SystemExit('No function names provided.')
	return names

def locate_function_block(text: str, name: str) -> Tuple[str, int, int]:
	marker = f"export function {name}"
	start = text.find(marker)
	if start == -1:
		raise FunctionExtractionError(name, 'definition not found')
	brace_start = text.find('{', start)
	if brace_start == -1:
		raise FunctionExtractionError(name, 'opening brace not found')
	line_start = text.rfind('\n', 0, start)
	segment_start = line_start + 1 if line_start != -1 else 0
	depth = 0
	in_single = False
	in_double = False
	in_backtick = False
	in_line_comment = False
	in_block_comment = False
	escape = False
	i = brace_start
	while i < len(text):
		ch = text[i]
		nxt = text[i + 1] if i + 1 < len(text) else ''
		if in_line_comment:
			if ch == '\n':
				in_line_comment = False
		elif in_block_comment:
			if ch == '*' and nxt == '/':
				in_block_comment = False
				i += 1
		elif in_single:
			if escape:
				escape = False
			elif ch == '\\':
				escape = True
			elif ch == "'":
				in_single = False
		elif in_double:
			if escape:
				escape = False
			elif ch == '\\':
				escape = True
			elif ch == '"':
				in_double = False
		elif in_backtick:
			if escape:
				escape = False
			elif ch == '\\':
				escape = True
			elif ch == '`':
				in_backtick = False
		else:
			if ch == '/' and nxt == '/':
				in_line_comment = True
				i += 1
			elif ch == '/' and nxt == '*':
				in_block_comment = True
				i += 1
			elif ch == '"':
				in_double = True
			elif ch == "'":
				in_single = True
			elif ch == '`':
				in_backtick = True
			elif ch == '{':
				depth += 1
			elif ch == '}':
				depth -= 1
				if depth == 0:
					line_start = text.rfind('\n', segment_start, i)
					column = i if line_start == -1 else i - line_start - 1
					if column != 0:
						raise FunctionExtractionError(name, 'closing brace is not at column 0')
					end = i + 1
					while end < len(text) and text[end] in '\r\n':
						end += 1
					return text[segment_start:end], segment_start, end
		i += 1
	raise FunctionExtractionError(name, 'matching closing brace not found')

def migrate_functions(source: Path, dest: Path, names: Sequence[str], dry_run: bool) -> None:
	source_text = source.read_text(encoding='utf-8')
	dest_text = dest.read_text(encoding='utf-8')
	extracted: List[Tuple[str, str]] = []
	working_text = source_text
	for name in names:
		snippet, start, end = locate_function_block(working_text, name)
		extracted.append((name, snippet.rstrip()))
		working_text = working_text[:start] + working_text[end:]
	if not extracted:
		print('No functions extracted.')
		return
	tail = dest_text.rstrip()
	if tail:
		tail += '\n\n'
	processed_dest = tail + '\n\n'.join(snippet for _name, snippet in extracted) + '\n'
	print(f'Extracted {len(extracted)} functions: {", ".join(name for name, _ in extracted)}')
	if dry_run:
		print('Dry run enabled; no files were modified.')
		return
	source.write_text(working_text, encoding='utf-8')
	dest.write_text(processed_dest, encoding='utf-8')
	print(f'Updated {source} and appended blocks to {dest}.')

def parse_args(argv: Sequence[str]) -> argparse.Namespace:
	parser = argparse.ArgumentParser(description='Move exported functions between editor source files.')
	parser.add_argument('--source', type=Path, required=True, help='Path to the source TypeScript file')
	parser.add_argument('--dest', type=Path, required=True, help='Path to the destination TypeScript file')
	parser.add_argument('-n', '--name', dest='names', action='append', default=[], help='Function name to move (can be repeated)')
	parser.add_argument('--names-file', type=Path, help='Optional file containing additional function names (one per line)')
	parser.add_argument('--dry-run', action='store_true', help='Preview changes without modifying files')
	return parser.parse_args(argv)

def main(argv: Sequence[str] | None = None) -> int:
	args = parse_args(sys.argv[1:] if argv is None else argv)
	source = args.source
	dest = args.dest
	if not source.exists():
		raise SystemExit(f'Source file not found: {source}')
	if not dest.exists():
		dest.parent.mkdir(parents=True, exist_ok=True)
		dest.write_text('', encoding='utf-8')
	names = read_function_names(args.names, args.names_file)
	try:
		migrate_functions(source, dest, names, args.dry_run)
	except FunctionExtractionError as error:
		raise SystemExit(f'Error extracting {error.name}: {error}') from error
	return 0

if __name__ == '__main__':
	sys.exit(main())
