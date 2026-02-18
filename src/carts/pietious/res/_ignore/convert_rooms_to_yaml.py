import sys
import re

import yaml

# Configure PyYAML to use block style ('|') for multiline strings
def str_presenter(dumper, data):
    if len(data.splitlines()) > 1:  # check for multiline string
        return dumper.represent_scalar('tag:yaml.org,2002:str', data, style='|')
    return dumper.represent_scalar('tag:yaml.org,2002:str', data)

yaml.add_representer(str, str_presenter)

# Minimal dummy since we are not using ruamel anymore, but we handle the formatting in the presenter
def PreservedScalarString(s): return s

# --- Helper Functions ---

def parse_csharp_array(array_str):
    if '{' not in array_str: return []
    content = array_str[array_str.find('{')+1 : array_str.rfind('}')]
    return [int(x.strip()) for x in content.split(',') if x.strip()]

def parse_string_array(map_block):
    lines = []
    # Simplified string extraction, assumes valid strings double quoted
    # Needs to handle potential escaped quotes or newlines if complex, 
    # but for room maps simple regex usually suffices
    matches = re.finditer(r'"([^"]*)"', map_block)
    for m in matches:
        lines.append(m.group(1))
    return lines

def extract_constants(content):
    constants = {}
    # Look for: public static string[] Name = { ... };
    # DotAll mode needed for multiline matching
    matches = re.finditer(r'public\s+static\s+string\[\]\s+(\w+)\s*=\s*\{([^}]+)\};', content, re.DOTALL)
    for m in matches:
        name = m.group(1)
        body = m.group(2)
        constants["Constants." + name] = parse_string_array(body)
    return constants

def parse_csharp_args(args_str):
    # Splits arguments handling parentheses nesting
    args = []
    current = ""
    depth = 0
    for char in args_str:
        if char == ',' and depth == 0:
            args.append(current.strip())
            current = ""
        else:
            if char == '(': depth += 1
            if char == ')': depth -= 1
            current += char
    if current:
        args.append(current.strip())
    elif current.strip() == "":
        pass 
    else:
        args.append(current.strip())
    return args

def parse_enum(val):
    if 'Trigger.' in val:
        val = val.replace('Trigger.', '')
    if '.' in val:
        val = val.split('.')[-1]
    return val.lower()

def simplify_condition(cond_str):
    # Remove Trigger. prefix specifically first
    cond_str = cond_str.replace('Trigger.', '')
    
    # Regex replacements for accuracy
    # Triggers
    cond_str = re.sub(r'GameModel\.Triggers\[(\w+)\]', r'\1', cond_str)
    
    # Inventory Items
    cond_str = re.sub(r'!GameModel\.InventoryItems\[ItemType\.(\w+)\]', r'!has_\1', cond_str)
    cond_str = re.sub(r'GameModel\.InventoryItems\[ItemType\.(\w+)\]', r'has_\1', cond_str)

    # Specific hacks
    cond_str = cond_str.replace('!GameModel.TheWorld.DestroyedFoeIdentifiers.Contains("cloud_1")', '!cloud_1_destroyed')
    cond_str = cond_str.replace('!GameModel.BossDefeated[result.WorldNumber]', '!boss_defeated')
    
    if 'GameModel.Foes.Count' in cond_str:
        cond_str = re.sub(r'GameModel\.Foes\.Count\(.+?\) <= 0', 'no_clouds', cond_str)
        cond_str = re.sub(r'GameModel\.Foes\.Count\(.+?\) > 0', 'has_clouds', cond_str)
    
    # Cleanup operators
    cond_str = cond_str.replace('&&', ' AND ').replace('||', ' OR ')
    
    # Remove extra parens/spaces
    cond_str = re.sub(r'\s+', ' ', cond_str).strip()
    while cond_str.startswith('(') and cond_str.endswith(')'):
        cond_str = cond_str[1:-1].strip()
        
    return cond_str.lower()

def extract_vector2(v_str):
    # Matches "new Vector2(x, y)" with optional logical suffixes or math inside
    # Returns (x, y) or None
    m = re.search(r'new\s+Vector2\s*\((.+?),(.+?)\)', v_str)
    if m:
        def clean_num(s):
            s = s.strip()
            # Remove * Constants... or similar trailing math if finding ' * '
            if '*' in s: s = s.split('*')[0]
            s = s.replace('f', '').strip()
            try:
                # Handle cases like (14 * ...) where parens might remain
                s = s.replace('(','').replace(')','')
                return int(float(s))
            except ValueError:
                return 0
        return clean_num(m.group(1)), clean_num(m.group(2))
    return None

def extract_rect_or_area(v_str):
    # Matches "new Rect(x, y, w, h)" or "new Area(sx, sy, ex, ey)"
    m = re.search(r'new\s+(Rect|Area)\s*\(([^)]+)\)', v_str)
    if m:
        kind = m.group(1)
        r_str = m.group(2)
        r_args = [int(x.strip()) for x in r_str.split(',')]
        if len(r_args) >= 4:
            if kind == 'Area':
                return [r_args[0], r_args[1], r_args[2], r_args[3]]
            return [r_args[0], r_args[1], r_args[0] + r_args[2], r_args[1] + r_args[3]]
    return None

# --- Logic ---

def process_base_data(content, rooms):
    # Search for blocks like: case 1: ... break;
    # Or in the older file format: RoomData.Rooms[1] = ...
    # This function needs to support the structure of RoomData.cs provided
    
    # Structure in snippet:
    # switch(number) { case 1: ... break; } inside LoadRoom
    # BUT currently we are looking for RoomData definitions which might be separate?
    # User combined file.
    
    # Let's try to find static definitions if they exist.
    # Snippet shows: RoomData.LoadRoomFromData(result, number);
    # And: RoomData.Rooms is a Dictionary.
    # And: PrepareRoomData() {/* Lines 75-891 omitted */}
    
    # We need to parse inside PrepareRoomData usually.
    # Assuming 'content' has the full file.
    
    # We look for: data = new RoomDataContainer(); ... data.Number = 1; ... 
    
    # Generic approach: Search for assignment blocks of RoomDataContainer
    # Pattern: new RoomDataContainer() ... (assignments) ... Rooms.Add(..., data) or Rooms[i] = data
    
    # Or maybe the data is just set property by property.
    
    # Let's try to parse the "PrepareRoomData" style blocks.
    # They usually look like:
    # data = new RoomDataContainer();
    # data.Number = 1;
    # data.Type = RoomType.Castle;
    # ...
    # RoomData.Rooms.Add(1, data);
    
    # We can split by "new RoomDataContainer()"
    
    sections = content.split('new RoomDataContainer()')
    count = 0
    
    for section in sections[1:]: # Skip text before first "new"
        # Parse until end of section (next new or end of file)
        # We need to extract properties.
        
        room_data = {
            'type': 'unknown', 
            'subtype': 'unknown',
            'exits': [],
            'worldnumber': 0,
            'map': []
        }
        
        # Room Number
        m_num = re.search(r'\.Number\s*=\s*(\d+);', section)
        if not m_num: continue # Should be there
        room_number = int(m_num.group(1))

        if room_number not in rooms: rooms[room_number] = {}
        
        # Type
        m_type = re.search(r'\.Type\s*=\s*RoomType\.(\w+);', section)
        if m_type: rooms[room_number]['type'] = m_type.group(1).lower()

        # SubType
        m_subtype = re.search(r'\.Subtype\s*=\s*RoomSubType\.(\w+);', section) # Note case sensitivity in regex?
        if not m_subtype:
             m_subtype = re.search(r'\.SubType\s*=\s*RoomSubType\.(\w+);', section)

        if m_subtype: rooms[room_number]['subtype'] = m_subtype.group(1).lower()

        # WorldNumber
        m_world = re.search(r'\.WorldNumber\s*=\s*(\d+);', section)
        if m_world: rooms[room_number]['worldnumber'] = int(m_world.group(1))

        # Exits
        m_exits = re.search(r'\.Exits\s*=\s*(new\s*int\[\]\s*\{[^}]+\});', section)
        if m_exits: rooms[room_number]['exits'] = parse_csharp_array(m_exits.group(1))
        
        # Map
        m_map_start = re.search(r'\.Map\s*=\s*new\s*string\[\]\s*\{', section)
        if m_map_start:
            start_idx = m_map_start.end()
            brace_count = 1
            end_idx = start_idx
            while brace_count > 0 and end_idx < len(section):
                if section[end_idx] == '{': brace_count += 1
                elif section[end_idx] == '}': brace_count -= 1
                end_idx += 1
            map_block = section[start_idx : end_idx-1]
            rooms[room_number]['map'] = parse_string_array(map_block)
            
        count += 1
        
    return count

def process_object_data(content, rooms, constants):
    lines = content.split('\n')
    current_room = None
    count = 0
    
    # Context State
    brace_depth = 0
    condition_stack = [] # List of (brace_depth, condition_string)
    next_statement_condition = None # For one-liner ifs
    
    for line in lines:
        raw_line = line.strip()
        if not raw_line: continue
        if raw_line.startswith('//'): continue

        # Update brace depth
        open_braces = raw_line.count('{')
        close_braces = raw_line.count('}')
        
        # Check for case/break context
        m_case = re.search(r'case\s+(-?\d+):', raw_line)
        if m_case:
            current_room = int(m_case.group(1))
            # Reset state for new room
            condition_stack = []
            next_statement_condition = None
            brace_depth += (open_braces - close_braces)
            continue

        if raw_line.startswith('break;') or raw_line.startswith('return;') or (raw_line.startswith('default:') and current_room):
            current_room = None
            condition_stack = []
            next_statement_condition = None
            brace_depth += (open_braces - close_braces)
            continue

        if current_room is None:
            brace_depth += (open_braces - close_braces)
            continue

        # Check for IF statement
        # Matches: if (condition) ...
        m_if = re.search(r'^\s*(?:else\s+)?if\s*\((.+)\)', raw_line)
        if m_if:
            # find start of condition inside parens
            if_idx = raw_line.find('if')
            start_idx = raw_line.find('(', if_idx) + 1
            
            if start_idx > 0:
                p_depth = 0
                cond_end = -1
                for i in range(start_idx, len(raw_line)):
                    if raw_line[i] == '(': p_depth += 1
                    elif raw_line[i] == ')':
                        if p_depth == 0:
                            cond_end = i
                            break
                        p_depth -= 1
                
                if cond_end != -1:
                    raw_cond = raw_line[start_idx:cond_end]
                    simp_cond = simplify_condition(raw_cond)
                    
                    if '{' in raw_line[cond_end:]:
                        # It is a block
                        condition_stack.append((brace_depth + 1, simp_cond)) # Depth +1 because the { is in this line
                    else:
                        # One-liner
                        next_statement_condition = simp_cond
                        # Consume it immediately if this line also has a semicolon (e.g. if (...) stmt;)
                        # BUT we need to check if stmt is on this line.
                        # If characters exist after ')' (and maybe whitespace), and it ends with ';'
                        # Check remaining content
                        remaining = raw_line[cond_end+1:].strip()
                        if remaining and remaining.endswith(';'):
                            # It's an inline if. 
                            # But wait! If we parse an object ON THIS LINE, we need next_statement_condition to be active!
                            # The object parsing comes LATER in the loop.
                            # So we keep it. The consuming logic at end of loop will handle it.
                            pass
        
        # Handle end of blocks for stack
        while condition_stack and brace_depth + open_braces - close_braces < condition_stack[-1][0]:
             condition_stack.pop()

        brace_depth += (open_braces - close_braces)

        # Custom Logic / Scripting hooks (Heuristics)
        if current_room is not None:
             if 'Trigger.World1StairsAppear' in raw_line and 'if' in raw_line:
                 rooms[current_room]['custom'] = 'world1stairsappear'
             elif 'Trigger.CloudDestroyed' in raw_line and 'false' in raw_line and '=' in raw_line:
                 rooms[current_room]['custom'] = 'clouddestroyed'
             elif 'RemoveTilesBehindSeal' in raw_line:
                 rooms[current_room]['custom'] = 'removetilesbehindseal'

        # Check for Objects
        m_new = re.search(r'new\s+(\w+)\s*\((.*)\)', raw_line)
        if m_new:
            cls_name = m_new.group(1)
            args_raw = m_new.group(2)
            
            if args_raw.endswith(');'): args_raw = args_raw[:-2]
            elif args_raw.endswith(')'): args_raw = args_raw[:-1]
            
            if current_room not in rooms: rooms[current_room] = {}
            if 'objects' not in rooms[current_room]: rooms[current_room]['objects'] = []

            args = parse_csharp_args(args_raw)
            obj = {'type': cls_name.lower()}
            
            # --- Condition Logic ---
            conditions = [c[1] for c in condition_stack]
            if next_statement_condition:
                conditions.append(next_statement_condition)
                next_statement_condition = None # Consumed
            
            if 'AddFoeIfNotDestroyed' in raw_line:
                conditions.append('not_destroyed')
                
            if conditions:
                final_conds = []
                for c in conditions:
                     # Split on ' and ' resulting from .lower()
                     # We use regex to be safer about spaces
                     parts = re.split(r'\s+and\s+', c)
                     for p in parts:
                         final_conds.append(p.strip())
                obj['condition'] = final_conds

            # --- Attribute Extraction ---
            vec = extract_vector2(args[0]) if len(args) > 0 else None
            if vec:
                obj['x'] = vec[0]
                obj['y'] = vec[1]

            # Mappings
            if cls_name == 'MijterFoe' or cls_name == 'BoekFoe' or cls_name == 'ZakFoe' or cls_name == 'MuziekFoe':
                if vec and len(args) > 1: obj['direction'] = parse_enum(args[1])
                elif len(args) >= 3:
                     if not vec: obj['x'] = int(args[0]); obj['y'] = int(args[1])
                     obj['direction'] = parse_enum(args[2] if not vec else args[1])

            elif cls_name == 'Rock':
                if vec:
                     obj['item'] = parse_enum(args[1]) if len(args) > 1 else 'none'
                else:
                    obj['x'] = int(args[0]); obj['y'] = int(args[1]); 
                    obj['item'] = parse_enum(args[2]) if len(args) > 2 else 'none'

            elif cls_name == 'Shrine' or cls_name == 'Seal' or cls_name == 'Lithograph':
                txt_idx = 1 if vec else 2
                if len(args) > txt_idx:
                    raw_text = args[txt_idx].strip('"')
                    # Check constants
                    if raw_text in constants:
                        # Join with newlines or keep as list? 
                        # Usually shrines display text line by line.
                        # YAML supports multiline strings nicely with literal block scalar |
                        # But here we probably want a single string with \n or just give the list.
                        # Agent instructions said: "Gebruik meerdere regels (dus niet de []-notatie)." 
                        # Which likely means a multiline string in YAML.
                        val = constants[raw_text]
                        if isinstance(val, list):
                            obj['text'] = PreservedScalarString("\n".join(val))
                        else:
                            obj['text'] = val
                    else:
                        obj['text'] = raw_text
                
                if not vec: obj['x'] = int(args[0]); obj['y'] = int(args[1])

            elif cls_name == 'MarspeinenAardappel':
                if vec and len(args) >= 3:
                    obj['speedx'] = int(float(args[1].replace('f','')))
                    obj['speedy'] = int(float(args[2].replace('f','')))
                elif not vec and len(args) >= 4:
                    obj['x'] = int(args[0]); obj['y'] = int(args[1]);
                    obj['speedx'] = int(args[2]); obj['speedy'] = int(args[3])
            
            elif cls_name == 'VlokSpawner': 
                pass 
            
            elif cls_name == 'CrossFoe':
                if not vec: obj['x'] = int(args[0]); obj['y'] = int(args[1])
            
            elif cls_name == 'BreakableWall':
                 rect = extract_rect_or_area(args[0])
                 if rect:
                     obj['area'] = rect
                     obj['hp'] = int(args[1])
                     obj['trigger'] = args[2].strip('"').replace('Trigger.', '').lower()
                     obj['tiletype'] = parse_enum(args[3])
            
            elif cls_name == 'DisappearingWall':
                 rect = extract_rect_or_area(args[0])
                 if rect:
                     obj['area'] = rect
                     obj['trigger'] = args[1].strip('"').replace('Trigger.', '').lower()
                     obj['tiletype'] = parse_enum(args[2])

            elif cls_name == 'WorldEntrance':
                target_arg = args[1] if vec else args[2]
                if 'GameModel.Worlds' in target_arg:
                    w_idx = re.search(r'\[(\d+)\]', target_arg)
                    if w_idx: obj['target'] = f"world_{w_idx.group(1)}"
                else:
                    obj['target'] = target_arg.strip('"')
                if not vec: obj['x'] = int(args[0]); obj['y'] = int(args[1])
            
            elif cls_name == 'Item':
                if vec: obj['itemtype'] = parse_enum(args[1])
                else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['itemtype'] = parse_enum(args[2])

            elif cls_name == 'StaffFoe':
                if vec: obj['trigger'] = args[1].strip('"').replace('Trigger.', '').lower()
                else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['trigger'] = args[2].strip('"').replace('Trigger.', '').lower()
            
            elif cls_name == 'Cloud':
                 if vec: obj['direction'] = parse_enum(args[1])
                 else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['direction'] = parse_enum(args[2])
            
            rooms[current_room]['objects'].append(obj)
            count += 1
        
        # Consume next_statement_condition if we just passed a statement ending in ;
        if next_statement_condition and raw_line.rstrip().endswith(';'):
            next_statement_condition = None

    return count

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 convert_rooms_to_yaml.py <combined_roomdata.cs> <output_rooms.yaml>")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    rooms = {}

    print(f"Reading data from {input_file}...")
    try:
        with open(input_file, 'r') as f:
            content = f.read()
            
        print("  Processing base room definitions...")
        base_count = process_base_data(content, rooms)
        print(f"    Found {base_count} room definitions (cases/blocks).")
        
        print("  Extracting constants...")
        constants = extract_constants(content)
        print(f"    Found {len(constants)} constants.")

        print("  Processing object definitions...")
        obj_count = process_object_data(content, rooms, constants)
        print(f"    Found {obj_count} objects.")
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print(f"Writing to {output_file}...")
    with open(output_file, 'w') as f:
        yaml.dump(rooms, f, default_flow_style=False, sort_keys=False)
    print("Done.")

if __name__ == "__main__":
    main()
