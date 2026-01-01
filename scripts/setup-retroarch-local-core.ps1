param(
	[string]$RomPath,
	[ValidateSet('Debug', 'Release')]
	[string]$BuildType = 'Release',
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

& $CMakeExe -S $CppDir -B $BuildDir -A x64 -DBMSX_BUILD_LIBRETRO=ON -DCMAKE_BUILD_TYPE=$BuildType
& $CMakeExe --build $BuildDir --config $BuildType

$CorePath = Join-Path (Join-Path $BuildDir $BuildType) $CoreName
$CoresDir = Join-Path $RetroArchDir 'cores'
$InfoDir = Join-Path $RetroArchDir 'info'
$InfoSrc = Join-Path $RootDir 'dist\bmsx_libretro.info'
$InfoDst = Join-Path $InfoDir 'bmsx_libretro.info'
$RetroArchExe = Join-Path $RetroArchDir 'retroarch.exe'

New-Item -ItemType Directory -Force $CoresDir | Out-Null
Copy-Item -Force $CorePath (Join-Path $CoresDir $CoreName)
New-Item -ItemType Directory -Force $InfoDir | Out-Null
Copy-Item -Force $InfoSrc $InfoDst

& $RetroArchExe --appendconfig $LocalCfg -L (Join-Path $CoresDir $CoreName) $RomPath
