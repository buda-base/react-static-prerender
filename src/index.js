import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { spawn,exec } from "child_process";
import { createServer } from "http";

async function findAvailablePort(startPort = 5050) {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      await new Promise((resolve, reject) => {
        const server = createServer();
        server.listen(port, () => {
          server.close(() => resolve(port));
        });
        server.on('error', reject);
      });
      return port;
    } catch (error) {
      continue;
    }
  }
  throw new Error('No available port found');
}

async function waitForServer(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok) return true;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Server on port ${port} did not start within ${maxAttempts} seconds`);
}

async function killProcessGroup(childProcess, port) {
  return new Promise(async (resolve) => {
    if (!childProcess || childProcess.killed) {
      console.log('🔍 Process already killed or null');
      await killByPort(port); // Nettoyage supplémentaire par port
      resolve();
      return;
    }

    console.log(`🛑 Stopping server process PID: ${childProcess.pid} on port ${port}`);

    const timeout = setTimeout(async () => {
      console.log('⏰ Timeout reached, killing by port...');
      await killByPort(port);
      resolve();
    }, 3000);

    childProcess.on('exit', async (code) => {
      clearTimeout(timeout);
      console.log(`✅ Server process exited with code: ${code}`);
      // Double check: kill remaining processes on port
      await killByPort(port);
      resolve();
    });

    childProcess.on('error', async (error) => {
      clearTimeout(timeout);
      console.log('⚠️ Server process error:', error.message);
      await killByPort(port);
      resolve();
    });

    try {
      // With detached: true, the process group should exist
      console.log('📤 Sending SIGTERM to process group...');
      process.kill(-childProcess.pid, 'SIGTERM');
      console.log('✓ Successfully sent SIGTERM to process group');
    } catch (e) {
      if (e.code === 'ESRCH') {
        console.log('⚠️ Process group already terminated, killing by port...');
        await killByPort(port);
      } else {
        console.log('⚠️ Could not send SIGTERM:', e.code, e.message);
      }
      clearTimeout(timeout);
      resolve();
    }
  });
}

// Helper function to kill processes by port - version silencieuse  
async function killByPort(port) {  
  return new Promise((resolve) => {
    // Silencieux : juste nettoyer sans logs verbeux
    exec(`pkill -f "serve.*${port}" 2>/dev/null; lsof -ti:${port} | xargs -r kill -9 2>/dev/null`, (error) => {
      console.log(`✅ Port ${port} cleanup completed`);
      resolve();
    });
  });
}

// Helper function to start the server
async function startServer(serveDir, port) {
  console.log(`🔧 Starting server: npx serve -s ${serveDir} -l ${port}`);
  
  const newServeProcess = spawn("npx", ["serve", "-s", serveDir, "-l", port.toString()], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    detached: true,  // Keep detached for process group management
  });
  
  // Don't use unref() as it makes cleanup harder
  // newServeProcess.unref();
  
  newServeProcess.stdout.on("data", data => {
    if (process.env.DEBUG) process.stdout.write(`[serve] ${data}`);
  });
  newServeProcess.stderr.on("data", data => {
    if (process.env.DEBUG) {
      process.stderr.write(`[serve-error] ${data}`);
    }
  });

  // Check if process started correctly
  newServeProcess.on('error', (error) => {
    console.error(`❌ Failed to start server: ${error.message}`);
    throw error;
  });

  try {
    await waitForServer(port);
    console.log(`✅ Server is responding on port ${port}`);
    return newServeProcess;
  } catch (error) {
    console.error(`❌ Server failed to start properly: ${error.message}`);
    newServeProcess.kill();
    throw error;
  }
}

// Helper function to determine output path for a route
function getOutputPath(route, outDirPath, flatOutput) {
  if (route === "/") {
    return path.join(outDirPath, "index.html");
  }
  
  const safeName = route.replace(/^\//, "").replace(/\//g, "-") || "root";
  if (flatOutput) {
    const fileName = `${safeName}.html`;
    return path.join(outDirPath, fileName);
  } else {
    // Separate path from query parameters
    const [routePath, queryString] = route.split('?');
    const cleanPath = routePath.replace(/^\//, "") || "root";
    const routeDir = path.join(outDirPath, cleanPath);
    const fileName = queryString ? `index.html?${queryString}` : "index.html";
    return path.join(routeDir, fileName);
  }
}

export async function prerender(config) {
  const {
    routes = [],
    outDir = "static-pages",
    serveDir = "build",
    flatOutput = false,
    skipExisting = false
  } = config;

  const outDirPath = path.resolve(process.cwd(), outDir);
  const port = await findAvailablePort();

  let serveProcess = null;
  let browser = null;
  let forceExitTimeout = null;

  // Handler pour Ctrl+C qui nettoie le port
  const handleCtrlC = async () => {
    console.log('\n🛑 Ctrl+C detected, shutting down gracefully...');
    console.log('🔍 Handler called with port:', port);
    
    // Ne pas essayer de fermer le browser proprement - juste tuer tout
    console.log('🔄 Force killing all processes...');
    
    if (browser) {
      try {
        // Direct kill du processus browser sans attendre close()
        const browserProcess = browser.process();
        if (browserProcess) {
          browserProcess.kill('SIGKILL');
          console.log('✅ Browser process killed');
        }
      } catch (e) {
        console.log('⚠️ Browser kill error:', e.message);
      }
    }
    
    if (serveProcess) {
      console.log('🔄 Stopping server...');
      console.log('🔍 serveProcess PID:', serveProcess.pid);
      
      // More aggressive cleanup
      try {
        // Kill the process group
        process.kill(-serveProcess.pid, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.kill(-serveProcess.pid, 'SIGKILL');
      } catch (e) {
        console.log('⚠️ Process group kill error:', e.message);
      }
      
      // Backup: kill by port
      await killByPort(port);
    } else {
      // Even if no serveProcess reference, try to clean by port
      await killByPort(port);
    }
    
    console.log('🧹 Cleanup completed, exiting...');
    process.removeListener('SIGINT', handleCtrlC);
    process.removeListener('SIGTERM', handleCtrlC);
    process.exit(0);
  };

  // Activer les handlers dès le début
  console.log('📋 Setting up signal handlers for port:', port);
  process.on('SIGINT', handleCtrlC);
  process.on('SIGTERM', handleCtrlC);

  try {
    serveProcess = await startServer(serveDir, port);
    console.log(`🚀 Server started on port ${port}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();

    await fs.mkdir(outDirPath, { recursive: true });

    let startTime = null; // Will be set when processing the first non-skipped route
    let processedCount = 0; // Only count actually processed routes, not skipped ones

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
      const route = routes[routeIndex];
      
      // Restart server every 1000 processed routes
      if (processedCount > 0 && processedCount % 1000 === 0) {
        console.log(`🔄 Restarting server after ${processedCount} processed routes...`);
        
        // Kill current server
        if (serveProcess) {
          await killProcessGroup(serveProcess, port);
        }
        
        // Start new server
        serveProcess = await startServer(serveDir, port);
        console.log(`✅ Server restarted on port ${port}`);
      }
      
      const url = `http://localhost:${port}${route}`;
      
      // Calculate output path once
      const outputPath = getOutputPath(route, outDirPath, flatOutput);
      
      const displayIndex = routeIndex + 1; // For display (1-based instead of 0-based)
      
      // Check if output file already exists when skipExisting is enabled
      if (skipExisting) {
        try {
          await fs.access(outputPath);
          console.log(`⏭️ Skipping route ${displayIndex}/${routes.length}: ${route} (file already exists)`);
          continue; // Skip this route, don't increment processedCount
        } catch (error) {
          // File doesn't exist, continue with processing
        }
      }
      
      // Start timing from the first route that actually gets processed
      if (startTime === null) {
        startTime = Date.now();
      }
      
      // Calculate time estimation (only for routes that will be processed)
      let timeEstimation = "";
      if (processedCount > 0) {
        const elapsedTime = Date.now() - startTime;
        const avgTimePerRoute = elapsedTime / processedCount;
        
        // Count remaining routes that need to be processed (excluding already existing files)
        let remainingRoutesToProcess = 0;
        for (let i = routeIndex + 1; i < routes.length; i++) {
          const futureRoute = routes[i];
          const futureOutputPath = getOutputPath(futureRoute, outDirPath, flatOutput);
          try {
            if (skipExisting) {
              await fs.access(futureOutputPath);
              // File exists, will be skipped
            } else {
              remainingRoutesToProcess++;
            }
          } catch {
            // File doesn't exist, will need to be processed
            remainingRoutesToProcess++;
          }
        }
        
        const estimatedRemainingTime = avgTimePerRoute * remainingRoutesToProcess;
        
        // Format time estimation
        const minutes = Math.floor(estimatedRemainingTime / 60000);
        const seconds = Math.floor((estimatedRemainingTime % 60000) / 1000);
        
        if (minutes > 0) {
          timeEstimation = ` (ETA: ${minutes}m ${seconds}s)`;
        } else {
          timeEstimation = ` (ETA: ${seconds}s)`;
        }
      }
      
      console.log(`📄 Processing route ${displayIndex}/${routes.length}: ${route}${timeEstimation}`);

      const routeStartTime = Date.now();
      
      await page.goto(url, { 
        waitUntil: "networkidle0",
        timeout: 120000  // 120 seconds instead of default 30 seconds
      });
      const html = await page.content();

      // Create directory structure if needed (for non-flat output)
      if (route !== "/" && !flatOutput) {
        const [routePath] = route.split('?');
        const cleanPath = routePath.replace(/^\//, "") || "root";
        const routeDir = path.join(outDirPath, cleanPath);
        await fs.mkdir(routeDir, { recursive: true });
      }
      
      // Write the file
      await fs.writeFile(outputPath, html);
      
      const routeEndTime = Date.now();
      const routeDuration = routeEndTime - routeStartTime;
      const routeSeconds = (routeDuration / 1000).toFixed(1);
      
      // Calculate file size
      const fileSizeBytes = Buffer.byteLength(html, 'utf8');
      const fileSizeKB = (fileSizeBytes / 1024).toFixed(1);
      
      console.log(`✅ Saved static page: ${path.relative(outDirPath, outputPath)} (${routeSeconds}s, ${fileSizeKB}KB)`);
      
      processedCount++; // Only increment for actually processed routes
    }

  } catch (error) {
    console.error("❌ Prerendering failed:", error);
    throw error;
  } finally {
    console.log('🧹 Cleaning up resources...');
    
    if (browser) {
      console.log('🔄 Closing browser...');
      await browser.close();
    }
    if (serveProcess) {
      console.log('🔄 Stopping server...');
      await killProcessGroup(serveProcess, port);
    }
    
    // Remove event listeners to allow normal process termination
    process.removeListener('SIGINT', handleCtrlC);
    process.removeListener('SIGTERM', handleCtrlC);
    
    // Reduced timeout since we're more aggressive now
    setTimeout(() => {
      console.log('🚪 Forcing process exit...');
      process.exit(0);
    }, 500);
  }
}