param(
	[string]$RomPath,
	[string]$RetroArchDir = $env:RETROARCH_DIR_WIN
)

$ErrorActionPreference = 'Stop'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not $RomPath) {
	$RomPath = Join-Path $RootDir 'dist\2025.debug.rom'
}
if (-not $RetroArchDir) {
	$RetroArchDir = 'C:\RetroArch-Win64'
}

$CppDir = Join-Path $RootDir 'src\bmsx_cpp'
$BuildDir = Join-Path $RootDir 'build-win'
$LocalCfg = Join-Path $RootDir 'scripts\retroarch.local.cfg'
$CoreName = 'bmsx_libretro.dll'

$VcpkgExe = $null
$CMakeExe = "cmake"
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
	$VsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
	if (Test-Path $VsWhere) {
		$InstallPath = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.CMake.Project -property installationPath
		if ($InstallPath) {
			$FoundCMake = Get-ChildItem -Path $InstallPath -Filter "cmake.exe" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*\bin\cmake.exe" } | Select-Object -First 1 -ExpandProperty FullName
			if ($FoundCMake) {
				$CMakeExe = $FoundCMake
			}
		}
	}
}

# Ensure Ninja and ccache are available on Windows; prefer winget over choco if present
$CpuCount = [Environment]::ProcessorCount
if (-not (Get-Command ninja -ErrorAction SilentlyContinue)) {
	if (Get-Command winget -ErrorAction SilentlyContinue) {
		winget install --silent --accept-package-agreements --accept-source-agreements Ninja
	} elseif (Get-Command choco -ErrorAction SilentlyContinue) {
		choco install -y ninja
	} else {
		Write-Host "Warning: 'ninja' not found. Please install winget or chocolatey and re-run this script."
	}
}
if (-not (Get-Command ccache -ErrorAction SilentlyContinue)) {
	if (Get-Command winget -ErrorAction SilentlyContinue) {
		winget install --silent --accept-package-agreements --accept-source-agreements ccache
	} elseif (Get-Command choco -ErrorAction SilentlyContinue) {
		choco install -y ccache
	} else {
		Write-Host "Warning: 'ccache' not found. Please install winget or chocolatey and re-run this script."
	}
}

# Configure with Ninja generator and enable ccache as the compiler launcher by default
& $CMakeExe -S $CppDir -B $BuildDir -G Ninja -DBMSX_BUILD_LIBRETRO=ON -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache

Write-Host "Dependencies installed and CMake configured with Ninja and ccache in $BuildDir"
