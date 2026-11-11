# Gate regression only; no BMSX runtime and no large allocation/stress workload.
param([string] $OutputDirectory = (Join-Path $env:TEMP ('bmsx-test-job-' + [Guid]::NewGuid().ToString('N'))))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$launcher = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../scripts/test-windows.ps1'))
$fixture = Join-Path $OutputDirectory 'fixture.exe'
Add-Type -Path (Join-Path $PSScriptRoot 'test_windows_job_fixture.cs') -OutputAssembly $fixture -OutputType ConsoleApplication
$shell = (Get-Process -Id $PID).Path
function Run-Case([string] $Name, [string[]] $ChildArguments, [int] $Expected, [UInt64] $Limit = 8589934592, [int] $Timeout = 10) {
    $ErrorActionPreference = 'Continue' # Native stderr is evidence, not a PowerShell exception.
    $out = Join-Path $OutputDirectory ($Name + '.out')
    $err = Join-Path $OutputDirectory ($Name + '.err')
    & $shell -NoProfile -ExecutionPolicy Bypass -File $launcher -FilePath $fixture -MemoryLimitBytes $Limit -TimeoutSeconds $Timeout @ChildArguments >$out 2>$err
    $actual = $LASTEXITCODE
    if ($actual -ne $Expected) { throw "$Name exit $actual, expected $Expected; see $err" }
    if ($Expected -ne 125) {
        $accounting = [regex]::Match((Get-Content -Raw -LiteralPath $err), '\[test-job\] cpu_user_100ns=(\d+) cpu_kernel_100ns=(\d+) total_processes=(\d+)')
        # Windows may add console/helper processes; every deliberate fixture
        # process must still be included after it has exited.
        $processes = if ($Name -eq 'cleanup' -or $Name -eq 'timeout') { 2 } else { 1 }
        if (-not $accounting.Success -or [int]$accounting.Groups[3].Value -lt $processes) {
            throw "$Name final job accounting must include the complete process tree; see $err"
        }
    }
    return $out
}
Run-Case 'success' @('exit','0') 0 | Out-Null
Run-Case 'exit-code' @('exit','23') 23 | Out-Null
$childFile = Join-Path $OutputDirectory 'child.pid'
Run-Case 'cleanup' @('tree',$childFile) 0 | Out-Null
$child = [int](Get-Content -LiteralPath $childFile)
if (Get-Process -Id $child -ErrorAction SilentlyContinue) { throw 'Child survived normal root exit' }
Run-Case 'timeout' @('timeout',$childFile) 124 -Timeout 1 | Out-Null
$child = [int](Get-Content -LiteralPath $childFile)
if (Get-Process -Id $child -ErrorAction SilentlyContinue) { throw 'Child survived job timeout' }
Run-Case 'over-cap-rejected' @('exit','0') 125 -Limit 8589934593 | Out-Null
Run-Case 'allocation-denial' @('deny') 137 -Limit 67108864 | Out-Null
# The denial probe deliberately returns zero. A missing OS notification is not
# a passing detection proof: the assertion above fails and retains its logs.
Write-Output "Windows job gate: six process/limit cases passed; logs=$OutputDirectory"
