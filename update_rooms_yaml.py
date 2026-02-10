import sys
import re

# Try to import ruamel.yaml for better formatting preservation, generic yaml otherwise
try:
    from ruamel.yaml import YAML
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.indent(mapping=2, sequence=4, offset=2)
except ImportError:
    import yaml

def parse_csharp_args(args_str):
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
        pass # empty last arg
    else:
        args.append(current.strip())
    return args

def parse_enum(val):
    if '.' in val:
        return val.split('.')[-1].lower()
    return val.lower()

def update_rooms(yaml_file, csharp_file):
    # Load YAML
    with open(yaml_file, 'r') as f:
        data = yaml.load(f)

    # Read C#
    with open(csharp_file, 'r') as f:
        csharp_content = f.read()

    current_room = None
    objects_map = {} 

    lines = csharp_content.split('\n')
    for line in lines:
        line = line.strip()
        
        # Room detection: case N:
        m_case = re.search(r'case\s+(-?\d+):', line)
        if m_case:
            current_room = int(m_case.group(1))
            if current_room not in objects_map:
                objects_map[current_room] = []
            continue

        if line.startswith('break;') or line.startswith('return;'):
            current_room = None
            continue

        if current_room is not None:
            # Match: new ClassName(...)
            # Note: This regex is simple and assumes one 'new' per line or picks the first one.
            m_new = re.search(r'new\s+(\w+)\s*\((.*)\)', line)
            
            # Simple check to avoid 'new List<...>' or similar if appearing
            if m_new:
                cls_name = m_new.group(1)
                args_raw = m_new.group(2)
                
                # Handling the closing parenthesis of the constructor function
                # The greedy .* above grabs until the last ')', which might be the end of the line ); 
                # or inside another call.
                # Heuristic: split by the LAST ')' on the line if it looks like a statement end.
                if args_raw.endswith(');'):
                    args_raw = args_raw[:-2]
                elif args_raw.endswith(')'):
                     args_raw = args_raw[:-1]
                
                args = parse_csharp_args(args_raw)
                obj = {'type': cls_name.lower()}
                
                # Logic per type
                if cls_name == 'MijterFoe':
                    # (x, y, Direction.Down)
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['direction'] = parse_enum(args[2])
                    # Removed pixel_coords logic

                elif cls_name == 'BoekFoe':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['direction'] = parse_enum(args[2])

                elif cls_name == 'Rock':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    if len(args) > 2:
                        obj['item'] = parse_enum(args[2])
                    else:
                        obj['item'] = 'none'

                elif cls_name == 'Shrine':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['text'] = args[2].strip('"')

                elif cls_name == 'MarspeinenAardappel':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['speedx'] = int(args[2])
                    obj['speedy'] = int(args[3])
                
                elif cls_name == 'VlokSpawner':
                    pass
                
                elif cls_name == 'CrossFoe':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                
                elif cls_name == 'BreakableWall':
                     # new Rect(x, y, w, h), hp, trigger, tile
                     rect_match = re.search(r'new\s+Rect\s*\(([^)]+)\)', args[0])
                     if rect_match:
                         r_str = rect_match.group(1)
                         r_args = [int(x.strip()) for x in r_str.split(',')]
                         # Convert x, y, w, h -> x1, y1, x2, y2
                         obj['area'] = [r_args[0], r_args[1], r_args[0]+r_args[2], r_args[1]+r_args[3]]
                     
                     obj['hp'] = int(args[1])
                     obj['trigger'] = args[2].strip('"')
                     obj['tiletype'] = parse_enum(args[3])

                elif cls_name == 'WorldEntrance':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['target'] = args[2].strip('"')

                elif cls_name == 'Seal':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['text'] = args[2].strip('"')
                
                elif cls_name == 'Item':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['itemtype'] = parse_enum(args[2])

                elif cls_name == 'Lithograph':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['text'] = args[2].strip('"') if len(args) > 2 else ""

                elif cls_name == 'ZakFoe':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['direction'] = parse_enum(args[2])
                    # Removed pixel_coords logic

                elif cls_name == 'MuziekFoe':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['direction'] = parse_enum(args[2])
                    # Removed pixel_coords logic

                elif cls_name == 'StaffFoe':
                    obj['x'] = int(args[0])
                    obj['y'] = int(args[1])
                    obj['trigger'] = args[2].strip('"')
                
                elif cls_name == 'Cloud':
                     obj['x'] = int(args[0])
                     obj['y'] = int(args[1])
                     obj['direction'] = parse_enum(args[2])
                
                elif cls_name == 'DisappearingWall':
                     rect_match = re.search(r'new\s+Rect\s*\(([^)]+)\)', args[0])
                     if rect_match:
                         r_str = rect_match.group(1)
                         r_args = [int(x.strip()) for x in r_str.split(',')]
                         obj['area'] = [r_args[0], r_args[1], r_args[0]+r_args[2], r_args[1]+r_args[3]]
                     obj['trigger'] = args[1].strip('"')
                     obj['tiletype'] = parse_enum(args[2])
                
                # Only add if it's one of our known types
                if 'x' in obj or cls_name == 'VlokSpawner' or 'area' in obj:
                     objects_map[current_room].append(obj)

    # Merge into YAML
    for room_id, objects in objects_map.items():
        if room_id in data:
            data[room_id]['objects'] = objects
        else:
            print(f"Room {room_id} not found in YAML structure")

    with open(yaml_file, 'w') as f:
        yaml.dump(data, f)
    
    print(f"Updated {yaml_file}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 update_rooms_yaml.py <rooms.yaml> <room_loader.cs>")
    else:
        update_rooms(sys.argv[1], sys.argv[2])
