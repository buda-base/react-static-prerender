#!/usr/bin/env node

import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import { prerender } from "../src/index.js";

// Function to display help
function displayHelp() {
  console.log(`
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

CONFIGURATION:
  Create a prerender.config.js file in your project root.
  See documentation for configuration options.
`);
}

// Function to load routes from CSV file
async function loadRoutesFromCSV(csvPath) {
  try {
    const fullPath = path.resolve(process.cwd(), csvPath);
    const csvContent = await fs.readFile(fullPath, 'utf-8');
    
    // Parse CSV - each line is a route, trim whitespace and filter empty lines
    const routes = csvContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')); // Allow comments with #
    
    console.log(`✅ Loaded ${routes.length} routes from CSV: ${csvPath}`);
    return routes;
  } catch (error) {
    console.error(`❌ Error loading routes from CSV file ${csvPath}: ${error.message}`);
    process.exit(1);
  }
}

async function loadConfig() {
  const configPath = path.resolve(process.cwd(), "prerender.config.js");

  try {
    await fs.access(configPath);
  } catch (error) {
    console.error(`❌ Configuration file not found: ${configPath}`);
    console.log(`
      Please create a prerender.config.js file with your configuration:
      
      Static routes:
      module.exports = {
        routes: ["/", "/about", "/contact"],
        outDir: "static-pages", 
        serveDir: "build",
        flatOutput: false, // true for about.html, false for about/index.html
      };
      
      Dynamic routes:
      export default async function() {
        const blogPosts = await getBlogPosts(); // Your data fetching logic
        const blogRoutes = blogPosts.map(post => \`/blog/\${post.slug}\`);
        
        return {
          routes: ["/", "/blog", ...blogRoutes],
          outDir: "static-pages",
          serveDir: "build",
        };
      }
    `);
    process.exit(1);
  }

  try {

    const configUrl = `file://${configPath}`;
    const configModule = await import(configUrl);
    
    const config = typeof configModule.default === "function"
        ? await configModule.default()
        : configModule.default;
        
    if (!config) {
      throw new Error('Config file must export a configuration object or function');
    }
    
    return config;
  } catch (error) {
    if (error.code === 'ERR_REQUIRE_ESM' || error.message.includes('Unexpected token')) {
      console.error(`
        ❌ Configuration file error: ${error.message}
        
        Your prerender.config.js uses ES module syntax but your project setup doesn't support it.
        
        Solutions:
        1. Add "type": "module" to your package.json, OR
        2. Use CommonJS syntax:
        
        module.exports = {
          routes: ["/", "/about", "/contact"],
          outDir: "static-pages",
          serveDir: "build",
        };
        
        OR for dynamic routes:
        
        module.exports = async function() {
          const fs = require('fs/promises');
          // Your dynamic route logic here
          return { routes: [...], outDir: "static-pages", serveDir: "build" };
        };
      `);
      process.exit(1);
    }
    
    if (error.message.includes('Cannot resolve module')) {
      console.error(`
        ❌ Module resolution error in config file: ${error.message}
        
        Make sure all imported modules in your config file are installed:
        - If using 'fs/promises', 'path', etc. - these are built-in Node.js modules
        - If using external packages, run: npm install <package-name>
      `);
      process.exit(1);
    }
    
    console.error(`❌ Error loading configuration: ${error.message}`);
    process.exit(1);
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyBuildAssets(serveDir, outDir) {
  const buildDir = path.resolve(process.cwd(), serveDir);
  const outDirFull = path.resolve(process.cwd(), outDir);

  async function copyRecursive(src, dest) {
    const stat = await fs.stat(src);

    if (stat.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src);

      for (const entry of entries) {
        const srcPath = path.join(src, entry);
        const destPath = path.join(dest, entry);
        await copyRecursive(srcPath, destPath);
      }
    } else if (!src.endsWith(".html")) {
      await fs.copyFile(src, dest);
    }
  }

  try {
    await copyRecursive(buildDir, outDirFull);
    console.log(`✅ Copied assets from ${serveDir} to ${outDir}`);
  } catch (err) {
    console.error("❌ Error copying build assets:", err);
  }
}

async function main() {
  try {
    // Check for help parameter first, before loading config
    if (process.argv.includes('-h') || process.argv.includes('--help')) {
      displayHelp();
      process.exit(0);
    }

    const config = await loadConfig();
    const shouldBuild = process.argv.includes("--with-build");
    const isDebug = process.argv.includes("--debug");
    const noClean = process.argv.includes("--no-clean");
    const noAssets = process.argv.includes("--no-assets");
    const tibetan = process.argv.includes("--tibetan");
    
    // Check for serve-dir parameter
    const serveDirIndex = process.argv.findIndex(arg => arg === "--serve-dir");
    if (serveDirIndex !== -1 && serveDirIndex + 1 < process.argv.length) {
      const customServeDir = process.argv[serveDirIndex + 1];
      console.log(`📁 Overriding serveDir: ${config.serveDir || "build"} → ${customServeDir}`);
      config.serveDir = customServeDir;
    }
    
    const buildDir = path.resolve(process.cwd(), config.serveDir || "build");
    
    // Check for CSV routes parameter
    const csvRouteIndex = process.argv.findIndex(arg => arg === "--routes-csv");
    if (csvRouteIndex !== -1 && csvRouteIndex + 1 < process.argv.length) {
      const csvPath = process.argv[csvRouteIndex + 1];
      console.log(`📄 Loading routes from CSV file: ${csvPath}`);
      const csvRoutes = await loadRoutesFromCSV(csvPath);
      config.routes = csvRoutes.map(r => { 
        if(r.startsWith("/")) return r
        else if(r.startsWith("bdr:")) return "/show/" + r
        else if(!r.startsWith("/show/bdr:")) return "/show/bdr:"+r
        return r
      });
      console.log(`🔄 Replaced config.routes with ${csvRoutes.length} routes from CSV`);
    }

    if(tibetan) {
      config.routes = config.routes.map(r => r+"?uilang=bo")
    }

    if (isDebug) {
      process.env.DEBUG = "1";
    }

    if (shouldBuild) {
      const buildCommand = config.buildCommand || "npm run build";
      console.log(`🏗️ Running ${buildCommand}...`);

      const [command, ...args] = buildCommand.split(' ');

      await new Promise((resolve, reject) => {
        const build = spawn(command, args, {
          stdio: "inherit",
          shell: true
        });
        build.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`❌ Build failed with exit code ${code}`));
        });
      });
    } else {
      const hasIndex = await pathExists(path.join(buildDir, "index.html"));
      if (!hasIndex) {
        console.error(
            "❌ Build folder not found. Either specify with --server-dir or check why there is no ./" + config.serveDir + "/index.html"
        );
        process.exit(1);
      }
    }

    const outDirPath = path.resolve(process.cwd(), config.outDir || "static-pages");
    
    // Clean output directory unless --no-clean is specified
    if (!noClean) {
      try {
        await fs.rm(outDirPath, { recursive: true, force: true });
        console.log(`🧹 Cleaned existing output directory: ${config.outDir || "static-pages"}`);
      } catch (err) {
      }
    } else {
      console.log(`⚠️ Skipping clean of output directory: ${config.outDir || "static-pages"} (--no-clean specified)`);
    }
  
    await prerender(config);
  
    // Copy assets unless --no-assets is specified
    if (!noAssets) {
      await copyBuildAssets(config.serveDir || "build", config.outDir || "static-pages");
    } else {
      console.log(`⚠️ Skipping copy of build assets (--no-assets specified)`);
    }

    console.log("🎉 Prerendering completed successfully!");

  } catch (error) {
    console.error("❌ Process failed:", error.message);
    process.exit(1);
  }
}

main();