#!/bin/bash

arg1=$1

npx tsx ./scripts/rominspector/rominspector.ts ./dist/$arg1
