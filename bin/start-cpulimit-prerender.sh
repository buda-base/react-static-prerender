#!/bin/bash

echo "Starting prerender with CPU limit..."

# Start script in background
node bin/cli.js $@ &
MAIN_PID=$!

# Wait for Chrome to start
sleep 10

# Function to limit all Chrome processes in the subprocess tree
limit_all_chrome() {
    # Get all PIDs in the process tree
    local tree_pids=$(pstree -p $MAIN_PID | grep -oE '\([0-9]+\)' | tr -d '()')
    
    for pid in $tree_pids; do
        # Check if it's a Chrome process
        if ps -p $pid -o comm= 2>/dev/null | grep -E "(chrome|chromium)" > /dev/null; then
            echo "Limiting Chrome process $pid to 20% CPU"
            cpulimit -l 20 -p $pid &
        fi
    done
}

limit_all_chrome

# Monitor every 10 seconds
while kill -0 $MAIN_PID 2>/dev/null; do
    sleep 10
done

echo "Main process finished"
