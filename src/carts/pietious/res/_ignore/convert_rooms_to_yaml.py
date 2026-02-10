import sys
import re

# Try to import ruamel.yaml for better formatting, fall back to pyyaml
try:
    from ruamel.yaml import YAML
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.indent(mapping=2, sequence=4, offset=2)
except ImportError:
    import yaml

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
    if '.' in val:
        val = val.split('.')[-1]
    return val.lower()

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
                return int(float(s))
            except ValueError:
                return 0
        return clean_num(m.group(1)), clean_num(m.group(2))
    return None

def extract_rect_or_area(v_str):
    # Matches "new Rect(x, y, w, h)" or "new Area(x, y, w, h)"
    m = re.search(r'new\s+(?:Rect|Area)\s*\(([^)]+)\)', v_str)
    if m:
        r_str = m.group(1)
        r_args = [int(x.strip()) for x in r_str.split(',')]
        if len(r_args) >= 4:
            return [r_args[0], r_args[1], r_args[0]+r_args[2], r_args[1]+r_args[3]]
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
        room_id = int(m_num.group(1))
        
        if room_id not in rooms: rooms[room_id] = {}
        
        # Type
        m_type = re.search(r'\.Type\s*=\s*RoomType\.(\w+);', section)
        if m_type: rooms[room_id]['type'] = m_type.group(1).lower()

        # SubType
        m_subtype = re.search(r'\.Subtype\s*=\s*RoomSubType\.(\w+);', section) # Note case sensitivity in regex?
        if not m_subtype:
             m_subtype = re.search(r'\.SubType\s*=\s*RoomSubType\.(\w+);', section)

        if m_subtype: rooms[room_id]['subtype'] = m_subtype.group(1).lower()

        # WorldNumber
        m_world = re.search(r'\.WorldNumber\s*=\s*(\d+);', section)
        if m_world: rooms[room_id]['worldnumber'] = int(m_world.group(1))

        # Exits
        m_exits = re.search(r'\.Exits\s*=\s*(new\s*int\[\]\s*\{[^}]+\});', section)
        if m_exits: rooms[room_id]['exits'] = parse_csharp_array(m_exits.group(1))
        
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
            rooms[room_id]['map'] = parse_string_array(map_block)
            
        count += 1
        
    return count

def process_object_data(content, rooms):
    lines = content.split('\n')
    current_room = None
    count = 0
    
    for line in lines:
        line = line.strip()
        
        # Identify room context (Case N used in LoadRoom)
        m_case = re.search(r'case\s+(-?\d+):', line)
        if m_case:
            current_room = int(m_case.group(1))
            continue

        if line.startswith('break;') or line.startswith('return;') or (line.startswith('default:') and current_room):
            current_room = None
            continue

        if current_room is not None:
            m_new = re.search(r'new\s+(\w+)\s*\((.*)\)', line)
            
            if m_new:
                cls_name = m_new.group(1)
                args_raw = m_new.group(2)
                
                if args_raw.endswith(');'): args_raw = args_raw[:-2]
                elif args_raw.endswith(')'): args_raw = args_raw[:-1]
                
                if current_room not in rooms: rooms[current_room] = {}
                if 'objects' not in rooms[current_room]: rooms[current_room]['objects'] = []

                args = parse_csharp_args(args_raw)
                obj = {'type': cls_name.lower()}
                
                vec = extract_vector2(args[0]) if len(args) > 0 else None
                if vec:
                    obj['x'] = vec[0]
                    obj['y'] = vec[1]

                if cls_name == 'MijterFoe':
                    if vec: obj['direction'] = parse_enum(args[1])
                    elif len(args) >= 3:
                        obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['direction'] = parse_enum(args[2])

                elif cls_name == 'BoekFoe':
                    if vec: obj['direction'] = parse_enum(args[1])
                    elif len(args) >= 3:
                        obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['direction'] = parse_enum(args[2])

                elif cls_name == 'Rock':
                    if vec:
                         obj['item'] = parse_enum(args[1]) if len(args) > 1 else 'none'
                    else:
                        obj['x'] = int(args[0]); obj['y'] = int(args[1]); 
                        obj['item'] = parse_enum(args[2]) if len(args) > 2 else 'none'

                elif cls_name == 'Shrine':
                    if vec: obj['text'] = args[1].strip('"')
                    elif len(args) >= 3:
                        obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['text'] = args[2].strip('"')

                elif cls_name == 'MarspeinenAardappel':
                    if vec:
                        obj['speedx'] = int(float(args[1].replace('f','')))
                        obj['speedy'] = int(float(args[2].replace('f','')))
                    else:
                        obj['x'] = int(args[0]); obj['y'] = int(args[1]);
                        obj['speedx'] = int(args[2]); obj['speedy'] = int(args[3])
                
                elif cls_name == 'VlokSpawner': pass
                
                elif cls_name == 'CrossFoe':
                    if vec: pass
                    else: obj['x'] = int(args[0]); obj['y'] = int(args[1])
                
                elif cls_name == 'BreakableWall':
                     rect = extract_rect_or_area(args[0])
                     if rect:
                         obj['area'] = rect
                         obj['hp'] = int(args[1])
                         obj['trigger'] = args[2].strip('"')
                         obj['tiletype'] = parse_enum(args[3])

                elif cls_name == 'WorldEntrance':
                    target_arg = args[1] if vec else args[2]
                    
                    if 'GameModel.Worlds' in target_arg:
                        w_idx = re.search(r'\[(\d+)\]', target_arg)
                        if w_idx: obj['target'] = f"world_{w_idx.group(1)}"
                    else:
                        obj['target'] = target_arg.strip('"')

                    if not vec:
                        obj['x'] = int(args[0]); obj['y'] = int(args[1])

                elif cls_name == 'Seal':
                    if vec: obj['text'] = args[1].strip('"')
                    else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['text'] = args[2].strip('"')
                
                elif cls_name == 'Item':
                    if vec: obj['itemtype'] = parse_enum(args[1])
                    else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['itemtype'] = parse_enum(args[2])

                elif cls_name == 'Lithograph':
                    if vec: obj['text'] = args[1].strip('"') if len(args) > 1 else ""
                    else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['text'] = args[2].strip('"') if len(args) > 2 else ""

                elif cls_name == 'ZakFoe':
                    if vec: obj['direction'] = parse_enum(args[1])
                    else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['direction'] = parse_enum(args[2])

                elif cls_name == 'MuziekFoe':
                    if vec: obj['direction'] = parse_enum(args[1])
                    else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['direction'] = parse_enum(args[2])

                elif cls_name == 'StaffFoe':
                    if vec: obj['trigger'] = args[1].strip('"')
                    else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['trigger'] = args[2].strip('"')
                
                elif cls_name == 'Cloud':
                     if vec: obj['direction'] = parse_enum(args[1])
                     else: obj['x'] = int(args[0]); obj['y'] = int(args[1]); obj['direction'] = parse_enum(args[2])
                
                elif cls_name == 'DisappearingWall':
                     rect = extract_rect_or_area(args[0])
                     if rect:
                         obj['area'] = rect
                         obj['trigger'] = args[1].strip('"')
                         obj['tiletype'] = parse_enum(args[2])
                
                if 'x' in obj or cls_name == 'VlokSpawner' or 'area' in obj:
                     rooms[current_room]['objects'].append(obj)
                     count += 1
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
        
        print("  Processing object definitions...")
        obj_count = process_object_data(content, rooms)
        print(f"    Found {obj_count} objects.")
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print(f"Writing to {output_file}...")
    with open(output_file, 'w') as f:
        yaml.dump(rooms, f)
    print("Done.")

if __name__ == "__main__":
    main()
