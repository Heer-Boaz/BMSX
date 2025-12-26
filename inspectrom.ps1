param (
	[string]$arg1,
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$rest
)

npx tsx ./scripts/rominspector/rominspector.ts ./dist/$arg1 @rest
