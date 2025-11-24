#!/usr/bin/env python3
"""Utility to migrate exported functions between source files."""
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
	# Find the opening brace that starts the function body. We must ignore
	# braces that appear inside the parameter list (e.g. TypeScript object
	# type annotations) or inside strings/comments. To do this we scan from
	# the marker and track parentheses depth and string/comment state; the
	# function body opening brace is the first '{' we encounter while not
	# being inside parentheses, strings or comments.
	brace_start = -1
	line_start = text.rfind('\n', 0, start)
	segment_start = line_start + 1 if line_start != -1 else 0
	depth = 0
	in_single = False
	in_double = False
	in_backtick = False
	in_line_comment = False
	in_block_comment = False
	escape = False
	i = start
	paren_depth = 0

	# Single-pass scanner: track parentheses depth (to ignore braces inside
	# parameter/type lists), string/comment state, and brace nesting depth for
	# the function body. When we encounter the first '{' outside of any
	# parentheses we treat it as the start of the body and begin tracking
	# brace depth until the matching closing '}' is found.
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
			elif ch == '(':
				paren_depth += 1
			elif ch == ')':
				if paren_depth > 0:
					paren_depth -= 1
			elif ch == '{':
				# Only treat '{' as the start of the function body when
				# we're not inside a parenthesized parameter list.
				if paren_depth == 0:
					if brace_start == -1:
						brace_start = i
						depth = 1
					else:
						depth += 1
				else:
					# brace inside parameter/type list - ignore
					pass
			elif ch == '}':
				if depth > 0:
					depth -= 1
					if depth == 0:
						# capture from the start of the line containing the
						# function signature through the closing brace and any
						# following newline characters
						line_start = text.rfind('\n', segment_start, i)
						end = i + 1
						while end < len(text) and text[end] in '\r\n':
							end += 1
						return text[segment_start:end], segment_start, end
				# otherwise '}' outside function body - ignore
		i += 1

	if brace_start == -1:
		raise FunctionExtractionError(name, 'opening brace not found')
	# We found an opening brace but did not find a matching closing brace.
	raise FunctionExtractionError(name, 'matching closing brace not found')

def migrate_functions(source: Path, dest: Path, names: Sequence[str], dry_run: bool) -> None:
	source_text = source.read_text(encoding='utf-8')
	dest_text = dest.read_text(encoding='utf-8')
	# Prevent accidental duplicate appends: if the destination already
	# contains any of the function markers we're about to move, abort to
	# avoid creating partially-duplicated files. If the user really wants to
	# overwrite or re-add functions they should clean the destination first
	# or use a separate destination file.
	already_present = [name for name in names if f"export function {name}" in dest_text]
	if already_present:
		raise SystemExit(f'The destination file {dest} already contains definitions for: {", ".join(already_present)}\nPlease remove them or choose a different destination before running this tool.')
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
		print('\n--- BEGIN DRY-RUN PREVIEW OF DESTINATION FILE ---\n')
		print(processed_dest)
		print('\n--- END DRY-RUN PREVIEW OF DESTINATION FILE ---')
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
