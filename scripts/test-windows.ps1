# Native Windows test gate. Job-wide committed memory, not Linux RSS semantics.
# No service configuration, elevation, breakaway or unbounded fallback.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)] [string] $FilePath,
    [string] $WorkingDirectory = (Get-Location).Path,
    [int] $TimeoutSeconds = 600,
    [UInt64] $MemoryLimitBytes = 8589934592,
    [Parameter(ValueFromRemainingArguments = $true)] [string[]] $ArgumentList = @()
)
$ErrorActionPreference = 'Stop'
try {
    $executable = (Get-Command -Name $FilePath -CommandType Application -ErrorAction Stop).Source
    $directory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($WorkingDirectory)
    Add-Type -Path (Join-Path $PSScriptRoot 'test_windows_job.cs')
    $code = [Bmsx.TestJob]::Run($executable, $ArgumentList, $directory, $MemoryLimitBytes, $TimeoutSeconds)
    exit $code
} catch {
    [Console]::Error.WriteLine('BMSX Windows test gate: ' + $_.Exception.Message)
    exit 125
}
