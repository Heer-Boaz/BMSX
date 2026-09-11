/** Two ordinary source files; no cartlib knowledge or game-specific line numbers. */
export const SOURCE_CHOICES_DEFINITIONS = `source_choice_beacon = 1
local function make_choice(branch)
	if branch then return { destination = 1 } end
	return { destination = 2 }
end
source_choice_endpoint = make_choice(source_choice_condition)
print(source_choice_beacon)
`;

export const SOURCE_CHOICES_USAGE = `local value = source_choice_beacon
local function shadow(source_choice_beacon)
	return source_choice_beacon
end
local destination = source_choice_endpoint.destination
return source_choice_beacon
`;
