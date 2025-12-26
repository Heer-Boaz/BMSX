#!/bin/bash

arg1=$1
shift

npx tsx ./scripts/rominspector/rominspector.ts ./dist/$arg1 "$@"
