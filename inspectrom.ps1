param (
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$argv
)

$romfile = $null
$rest = @()

foreach ($arg in $argv) {
	if (-not $romfile -and -not $arg.StartsWith('-')) {
		$romfile = $arg
	} else {
		$rest += $arg
	}
}

if (-not $romfile) {
	Write-Host 'Usage: ./inspectrom.ps1 <romname> [--ui] [--list-assets] [--manifest] [--program-asm]'
	exit 1
}

npx tsx ./scripts/rominspector/rominspector.ts "./dist/$romfile" @rest
