/** Independent source-only Call Hierarchy subject shared by Studio UI acceptance. */
export const CALL_HIERARCHY_SOURCE = `local function hit() end
local function launch()
 hit()
end
local function update()
 launch()
end
return launch
`;
