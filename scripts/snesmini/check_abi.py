#!/usr/bin/env python3

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys


class AuditError(RuntimeError):
	pass


@dataclasses.dataclass(frozen=True)
class DynamicInfo:
	needed: tuple[str, ...]
	runpaths: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class SymbolTable:
	default_definitions: frozenset[str]
	versioned_definitions: frozenset[tuple[str, str]]
	strong_undefined: frozenset[tuple[str, str | None, str | None]]


@dataclasses.dataclass(frozen=True)
class ElfInfo:
	path: Path
	dynamic: DynamicInfo
	interpreter: str | None
	version_definitions: frozenset[str]
	version_requirements: dict[str, frozenset[str]]
	symbols: SymbolTable


@dataclasses.dataclass(frozen=True)
class RuntimeSymbolContract:
	library_group: str
	source: Path
	symbols: frozenset[str]


class RuntimeRoot:
	def __init__(self, root: Path) -> None:
		self.root = root.resolve()
		self.cache = self._read_cache()
		self.search_directories = self._read_search_directories()

	def _read_cache(self) -> dict[str, Path]:
		if not (self.root / "etc/ld.so.cache").is_file():
			return {}
		result = subprocess.run(
			["ldconfig", "-p", "-r", str(self.root)],
			check=True,
			capture_output=True,
			text=True,
		)
		cache: dict[str, Path] = {}
		for line in result.stdout.splitlines():
			match = re.match(r"\s*(\S+)\s+\([^)]*\)\s+=>\s+(\S+)$", line)
			if match and match.group(1) not in cache:
				cache[match.group(1)] = self.target_path(match.group(2))
		return cache

	def _read_search_directories(self) -> tuple[Path, ...]:
		target_directories = [
			"/lib",
			"/usr/lib",
			"/lib/arm-linux-gnueabihf",
			"/usr/lib/arm-linux-gnueabihf",
		]
		conf = self.root / "etc/ld.so.conf"
		if conf.is_file():
			target_directories.extend(self._read_conf(conf, set()))
		directories: list[Path] = []
		for target_directory in target_directories:
			directory = self.target_path(target_directory)
			if directory.is_dir() and directory not in directories:
				directories.append(directory)
		return tuple(directories)

	def _read_conf(self, path: Path, visited: set[Path]) -> list[str]:
		path = path.resolve()
		if path in visited:
			return []
		visited.add(path)
		directories: list[str] = []
		for raw_line in path.read_text(encoding="utf-8").splitlines():
			line = raw_line.split("#", 1)[0].strip()
			if not line:
				continue
			if line.startswith("include "):
				pattern = line.removeprefix("include ").strip().lstrip("/")
				for included in sorted(self.root.glob(pattern)):
					directories.extend(self._read_conf(included, visited))
				continue
			directories.append(line)
		return directories

	def target_path(self, target_path: str) -> Path:
		return self._resolve_symlinks(self.root / target_path.lstrip("/"))

	def _resolve_symlinks(self, path: Path) -> Path:
		try:
			pending = list(path.relative_to(self.root).parts)
		except ValueError as error:
			raise AuditError(f"target-root symlink escapes the root: {path}") from error
		resolved: list[str] = []
		symlink_count = 0
		while pending:
			component = pending.pop(0)
			if component in {"", "."}:
				continue
			if component == "..":
				if not resolved:
					raise AuditError(f"target-root symlink escapes the root: {path}")
				resolved.pop()
				continue
			candidate = self.root.joinpath(*resolved, component)
			if not candidate.is_symlink():
				resolved.append(component)
				continue
			symlink_count += 1
			if symlink_count > 64:
				raise AuditError(f"symlink loop in target root: {path}")
			target = Path(os.readlink(candidate))
			if target.is_absolute():
				resolved.clear()
				pending = list(target.parts[1:]) + pending
			else:
				pending = list(target.parts) + pending
		return self.root.joinpath(*resolved)

	def resolve(self, soname: str, owner: ElfInfo | None = None) -> Path:
		if "/" in soname:
			candidate = self.target_path(soname)
			if candidate.is_file():
				return candidate
			raise AuditError(f"runtime dependency is missing: {soname}")

		if owner is not None:
			for runpath in owner.dynamic.runpaths:
				origin = owner.path.parent
				expanded = runpath.replace("${ORIGIN}", str(origin)).replace("$ORIGIN", str(origin))
				candidate = Path(expanded) / soname
				if not candidate.is_absolute():
					candidate = origin / candidate
				candidate = self._resolve_symlinks(candidate)
				try:
					candidate.relative_to(self.root)
				except ValueError as error:
					raise AuditError(
						f"{owner.path} resolves {soname} outside the target root through {runpath}"
					) from error
				if candidate.is_file():
					return candidate

		cached = self.cache.get(soname)
		if cached is not None and cached.is_file():
			return cached
		for directory in self.search_directories:
			candidate = self._resolve_symlinks(directory / soname)
			if candidate.is_file():
				return candidate
		raise AuditError(f"runtime dependency is missing from the target root: {soname}")


def run_readelf(*arguments: str, path: Path) -> str:
	result = subprocess.run(
		["readelf", "--wide", *arguments, str(path)],
		check=True,
		capture_output=True,
		text=True,
	)
	return result.stdout


def sha256_file(path: Path) -> str:
	digest = hashlib.sha256()
	with path.open("rb") as source:
		while chunk := source.read(1024 * 1024):
			digest.update(chunk)
	return digest.hexdigest()


def inspect_architecture(path: Path) -> None:
	header = run_readelf("-h", path=path)
	required = (
		"Class:                             ELF32",
		"Data:                              2's complement, little endian",
		"Machine:                           ARM",
	)
	for marker in required:
		if marker not in header:
			raise AuditError(f"{path} is not an ARM hard-float ELF32 artifact")
	if "hard-float ABI" not in header:
		attributes = run_readelf("-A", path=path)
		if "Tag_ABI_VFP_args: VFP registers" not in attributes:
			raise AuditError(f"{path} is not an ARM hard-float ELF32 artifact")


def read_dynamic(path: Path) -> DynamicInfo:
	output = run_readelf("-d", path=path)
	needed: list[str] = []
	runpaths: list[str] = []
	for line in output.splitlines():
		needed_match = re.search(r"\(NEEDED\).*\[([^]]+)]", line)
		if needed_match:
			needed.append(needed_match.group(1))
			continue
		runpath_match = re.search(r"\((?:RPATH|RUNPATH)\).*\[([^]]+)]", line)
		if runpath_match:
			runpaths.extend(entry for entry in runpath_match.group(1).split(":") if entry)
	return DynamicInfo(tuple(needed), tuple(runpaths))


def read_interpreter(path: Path) -> str | None:
	output = run_readelf("-l", path=path)
	match = re.search(r"Requesting program interpreter:\s*([^]]+)]", output)
	return match.group(1) if match else None


def read_versions(
	path: Path,
) -> tuple[frozenset[str], dict[str, frozenset[str]], dict[int, tuple[str, str]]]:
	output = run_readelf("--version-info", path=path)
	section = ""
	definitions: set[str] = set()
	requirements: dict[str, set[str]] = {}
	requirement_indices: dict[int, tuple[str, str]] = {}
	current_provider = ""
	for line in output.splitlines():
		if line.startswith("Version definition section"):
			section = "definitions"
			continue
		if line.startswith("Version needs section"):
			section = "requirements"
			continue
		if line.startswith("Version symbols section"):
			section = ""
			continue
		if section == "definitions":
			match = re.search(r"\bName:\s*(\S+)", line)
			if match:
				definitions.add(match.group(1))
		elif section == "requirements":
			provider_match = re.search(r"\bFile:\s*(\S+)", line)
			if provider_match:
				current_provider = provider_match.group(1)
				requirements.setdefault(current_provider, set())
				continue
			version_match = re.search(r"\bName:\s*(\S+).*?\bVersion:\s*(\d+)", line)
			if version_match:
				version = version_match.group(1)
				requirements[current_provider].add(version)
				requirement_indices[int(version_match.group(2))] = (current_provider, version)
	return (
		frozenset(definitions),
		{provider: frozenset(versions) for provider, versions in requirements.items()},
		requirement_indices,
	)


def split_symbol_version(symbol: str) -> tuple[str, str | None, bool]:
	if "@@" in symbol:
		name, version = symbol.split("@@", 1)
		return name, version, True
	if "@" in symbol:
		name, version = symbol.split("@", 1)
		return name, version, False
	return symbol, None, True


def read_symbols(path: Path, requirement_indices: dict[int, tuple[str, str]]) -> SymbolTable:
	default_definitions: set[str] = set()
	versioned_definitions: set[tuple[str, str]] = set()
	strong_undefined: set[tuple[str, str | None, str | None]] = set()
	for line in run_readelf("--dyn-syms", path=path).splitlines():
		columns = line.split()
		if len(columns) < 8 or not columns[0].endswith(":"):
			continue
		binding = columns[4]
		visibility = columns[5]
		section = columns[6]
		if binding not in {"GLOBAL", "WEAK"} or visibility not in {"DEFAULT", "PROTECTED"}:
			continue
		name, version, is_default = split_symbol_version(columns[7])
		if section == "UND":
			if binding == "GLOBAL":
				provider = requirement_indices[int(columns[8][1:-1])][0] if version is not None else None
				strong_undefined.add((name, version, provider))
			continue
		if version is not None:
			versioned_definitions.add((name, version))
		if is_default:
			default_definitions.add(name)
	return SymbolTable(
		frozenset(default_definitions),
		frozenset(versioned_definitions),
		frozenset(strong_undefined),
	)


def inspect_elf(path: Path) -> ElfInfo:
	inspect_architecture(path)
	definitions, requirements, requirement_indices = read_versions(path)
	return ElfInfo(
		path=path,
		dynamic=read_dynamic(path),
		interpreter=read_interpreter(path),
		version_definitions=definitions,
		version_requirements=requirements,
		symbols=read_symbols(path, requirement_indices),
	)


def read_libretro_map(path: Path) -> frozenset[str]:
	exports: set[str] = set()
	section = ""
	for raw_line in path.read_text(encoding="utf-8").splitlines():
		line = raw_line.strip()
		if line == "global:":
			section = "global"
			continue
		if line == "local:":
			section = "local"
			continue
		if section != "global" or not line.endswith(";"):
			continue
		name = line[:-1]
		if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
			raise AuditError(f"{path} contains a non-explicit libretro export: {name}")
		exports.add(name)
	return frozenset(exports)


def audit_libretro_exports(info: ElfInfo, required: frozenset[str]) -> None:
	exports = info.symbols.default_definitions
	missing = required - exports
	if missing:
		raise AuditError(f"{info.path} is missing libretro exports: {', '.join(sorted(missing))}")
	extra = exports - required
	if extra:
		raise AuditError(f"{info.path} exports symbols absent from its map: {', '.join(sorted(extra))}")


def read_runtime_symbol_contract(value: str) -> RuntimeSymbolContract:
	library_group, separator, source_name = value.partition("=")
	if not separator:
		raise AuditError(f"runtime symbol contract requires LIBRARY=FILE: {value}")
	source = Path(source_name).resolve()
	symbols: set[str] = set()
	for raw_line in source.read_text(encoding="utf-8").splitlines():
		line = raw_line.strip()
		if not line:
			continue
		match = re.fullmatch(r"BMSX_RUNTIME_SYMBOL\(([A-Za-z_][A-Za-z0-9_]*)\);", line)
		if match is None:
			raise AuditError(f"{source} contains an invalid runtime symbol declaration: {line}")
		symbols.add(match.group(1))
	return RuntimeSymbolContract(library_group, source, frozenset(symbols))


def dependency_closure(root: Path, dependencies: dict[Path, dict[str, Path]]) -> frozenset[Path]:
	closure: set[Path] = set()
	queue = [root.resolve()]
	while queue:
		path = queue.pop()
		if path in closure:
			continue
		closure.add(path)
		queue.extend(provider.resolve() for provider in dependencies[path].values())
	return frozenset(closure)


def audit_symbol_resolution(
	root: Path,
	infos: dict[Path, ElfInfo],
	dependencies: dict[Path, dict[str, Path]],
) -> None:
	closure = dependency_closure(root, dependencies)
	default_definitions = frozenset(
		symbol
		for path in closure
		for symbol in infos[path].symbols.default_definitions
	)
	for path in closure:
		info = infos[path]
		for symbol, version, provider_name in info.symbols.strong_undefined:
			if version is None:
				if symbol not in default_definitions:
					raise AuditError(f"{path} has unresolved strong symbol: {symbol}")
				continue
			provider_path = dependencies[path][provider_name].resolve()
			if (symbol, version) not in infos[provider_path].symbols.versioned_definitions:
				raise AuditError(
					f"{path} requires {symbol}@{version}, absent from {provider_path}"
				)


def audit_runtime(
	runtime: RuntimeRoot,
	artifacts: tuple[Path, ...],
	libretro_core: Path | None,
	libretro_exports: frozenset[str] | None,
	runtime_symbol_contracts: tuple[RuntimeSymbolContract, ...],
) -> None:
	infos: dict[Path, ElfInfo] = {}
	dependencies: dict[Path, dict[str, Path]] = {}
	queue = list(artifacts)
	contract_libraries: dict[RuntimeSymbolContract, Path] = {}
	for contract in runtime_symbol_contracts:
		for alternative in contract.library_group.split("|"):
			try:
				library = runtime.resolve(alternative)
				contract_libraries[contract] = library.resolve()
				queue.append(library)
				break
			except AuditError:
				continue
		else:
			raise AuditError(f"none of the runtime libraries are present: {contract.library_group}")

	artifact_set = set(artifacts)
	while queue:
		path = queue.pop()
		path = path.resolve()
		if path in infos:
			continue
		info = inspect_elf(path)
		infos[path] = info
		if path in artifact_set:
			for soname in info.dynamic.needed:
				if soname.startswith(("libstdc++.so", "libgcc_s.so", "libgomp.so", "libquadmath.so")):
					raise AuditError(f"{path} dynamically depends on forbidden compiler runtime {soname}")

		resolved: dict[str, Path] = {}
		for soname in info.dynamic.needed:
			provider = runtime.resolve(soname, info)
			resolved[soname] = provider
			queue.append(provider)
		if info.interpreter is not None:
			interpreter = runtime.resolve(info.interpreter)
			resolved[Path(info.interpreter).name] = interpreter
			queue.append(interpreter)
		dependencies[path] = resolved

	for path, info in infos.items():
		for provider_name, required_versions in info.version_requirements.items():
			provider_path = dependencies[path].get(provider_name)
			if provider_path is None:
				provider_path = runtime.resolve(provider_name, info)
			provider = infos[provider_path.resolve()]
			missing = required_versions - provider.version_definitions
			if missing:
				raise AuditError(
					f"{path} requires versions absent from {provider_path}: {', '.join(sorted(missing))}"
				)

	for root in (*artifacts, *contract_libraries.values()):
		audit_symbol_resolution(root, infos, dependencies)

	if libretro_core is not None:
		audit_libretro_exports(infos[libretro_core.resolve()], libretro_exports)

	for contract, library in contract_libraries.items():
		missing = contract.symbols - infos[library].symbols.default_definitions
		if missing:
			raise AuditError(
				f"{library} does not export symbols declared by {contract.source}: "
				f"{', '.join(sorted(missing))}"
			)

	for artifact in artifacts:
		print(f"[snesmini abi] {artifact}: sha256={sha256_file(artifact)}")
	print(f"[snesmini abi] resolved {len(infos) - len(artifacts)} target-runtime ELF dependencies")


def parse_arguments() -> argparse.Namespace:
	parser = argparse.ArgumentParser()
	parser.add_argument("--rootfs", type=Path, required=True)
	parser.add_argument("--artifact", type=Path, action="append", default=[])
	parser.add_argument("--libretro-core", type=Path)
	parser.add_argument("--libretro-map", type=Path)
	parser.add_argument("--runtime-symbols", action="append", default=[])
	return parser.parse_args()


def main() -> int:
	arguments = parse_arguments()
	artifacts = tuple(path.resolve() for path in arguments.artifact)
	libretro_core = arguments.libretro_core.resolve() if arguments.libretro_core else None
	libretro_exports = read_libretro_map(arguments.libretro_map) if arguments.libretro_map else None
	if libretro_core is not None and libretro_core not in artifacts:
		artifacts += (libretro_core,)
	if libretro_core is not None and libretro_exports is None:
		raise AuditError("--libretro-core requires --libretro-map")
	if libretro_core is None and libretro_exports is not None:
		raise AuditError("--libretro-map requires --libretro-core")
	if not artifacts:
		raise AuditError("at least one artifact must be audited")
	for artifact in artifacts:
		if not artifact.is_file():
			raise AuditError(f"artifact does not exist: {artifact}")
	audit_runtime(
		RuntimeRoot(arguments.rootfs),
		artifacts,
		libretro_core,
		libretro_exports,
		tuple(read_runtime_symbol_contract(value) for value in arguments.runtime_symbols),
	)
	return 0


if __name__ == "__main__":
	try:
		raise SystemExit(main())
	except (AuditError, subprocess.CalledProcessError) as error:
		print(f"[snesmini abi] {error}", file=sys.stderr)
		raise SystemExit(1)
