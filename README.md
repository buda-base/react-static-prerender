[🔗 GitHub Repository](https://github.com/jankojjs/react-static-prerender)

[![npm version](https://img.shields.io/npm/v/react-static-prerender.svg)](https://www.npmjs.com/package/react-static-prerender)
[![MIT license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
# react-static-prerender

(see https://github.com/jankojjs/react-static-prerender for original README)

## Installation

Using `node v20+` via [`nvm`](https://github.com/nvm-sh/nvm):

```
nvm install 20
nvm use 20
yarn
```

## Usage

### Default usage

```
$ node bin/cli.js -h

🚀 React Static Prerender CLI

USAGE:
  node cli.js [OPTIONS]

OPTIONS:
  -h, --help                Show this help message
  --debug                   Enable debug mode with verbose logging
  --tibetan                 Use Tibetan translation of page/data
  --no-clean                Skip cleaning of output directory before prerendering
  --no-assets               Skip copying of build assets to output directory
  --routes-csv <file>       Load routes from CSV file (one route per line)
                            Routes starting with "bdr:" will be prefixed with "/show/"
                            Routes not starting with "/show/bdr:" will be prefixed with "/show/bdr:"
  --serve-dir <directory>   Override serveDir from config (build directory to serve from)

EXAMPLES:
  node cli.js                                    # Basic prerender with config file routes
  node cli.js --routes-csv routes.csv            # Use routes from CSV file
  node cli.js --serve-dir dist                   # Use 'dist' instead of config serveDir
  node cli.js --routes-csv routes.csv --no-clean # Use CSV routes, don't clean output dir
  node cli.js --debug --no-assets                # Debug mode, skip asset copying
 
  node cli.js --routes-csv routes.csv                                   # first pass, in English
  node cli.js --routes-csv routes.csv --tibetan --no-clean --no-assets  # second pass, in Tibetan

CSV FILE FORMAT:
  Each line should contain one route:
  /
  /about
  /contact
  bdr:W1234          # Will become /show/bdr:W1234
  W5678              # Will become /show/bdr:W5678
  # Lines starting with # are ignored as comments
```

Example trace for `routes.csv` with only `MW22084` in it:

```
$ node bin/cli.js --routes-csv routes.csv --no-assets 
📄 Loading routes from CSV file: routes.csv
✅ Loaded 1 routes from CSV: routes.csv
🔄 Replaced config.routes with 1 routes from CSV
🧹 Cleaned existing output directory: static-pages
📋 Setting up signal handlers for port: 5050
🚀 Server started on port 5050
📄 Processing route: /show/bdr:MW22084
✅ Saved static page: show/bdr:MW22084/index.html
🧹 Cleaning up resources...
🔄 Closing browser...
🔄 Stopping server...
🛑 Stopping server process PID: 220305 on port 5050
📤 Sending SIGTERM to process group...
✓ Successfully sent SIGTERM to process group
✅ Server process exited with code: null
✅ Port 5050 cleanup completed
⚠️ Skipping copy of build assets (--no-assets specified)
🎉 Prerendering completed successfully!
🚪 Forcing process exit...
```

### Usage with `cpulimit`

Use `./bin/start-cpulimit-prerender.sh` instead of `node bin/cli.js` to limit cpu usage to 20% of one core:

```
 ./bin/start-cpulimit-prerender.sh --routes-csv routes.csv --no-assets 
Starting prerender with CPU limit...
📄 Loading routes from CSV file: routes.csv
✅ Loaded 1 routes from CSV: routes.csv
🔄 Replaced config.routes with 1 routes from CSV
🧹 Cleaned existing output directory: static-pages
📋 Setting up signal handlers for port: 5050
🚀 Server started on port 5050
📄 Processing route: /show/bdr:MW22084
Limiting Chrome process 223390 to 20% CPU
Process 223390 detected
Limiting Chrome process 223399 to 20% CPU
Process 223399 detected
Limiting Chrome process 223427 to 20% CPU
Process 223427 detected
Limiting Chrome process 223400 to 20% CPU
Process 223400 detected
Limiting Chrome process 223430 to 20% CPU
Process 223430 detected
Limiting Chrome process 223471 to 20% CPU
Process 223471 detected
Limiting Chrome process 223472 to 20% CPU
Process 223472 detected
Limiting Chrome process 223496 to 20% CPU
Process 223496 detected
Limiting Chrome process 223629 to 20% CPU
Process 223629 detected
Limiting Chrome process 223429 to 20% CPU
Process 223429 detected
✅ Saved static page: show/bdr:MW22084/index.html
🧹 Cleaning up resources...
🔄 Closing browser...
Process 223472 dead!
Process 223629 dead!
Process 223496 dead!
🔄 Stopping server...
🛑 Stopping server process PID: 223348 on port 5050
📤 Sending SIGTERM to process group...
✓ Successfully sent SIGTERM to process group
✅ Server process exited with code: null
Process 223429 dead!
Process 223400 dead!
Process 223390 dead!
✅ Port 5050 cleanup completed
⚠️ Skipping copy of build assets (--no-assets specified)
🎉 Prerendering completed successfully!
Process 223430 dead!
Process 223399 dead!
Process 223427 dead!
Process 223471 dead!
🚪 Forcing process exit...
Main process finished
```