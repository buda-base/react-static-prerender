import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
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

async function killProcessGroup(childProcess) {
  return new Promise((resolve) => {
    if (!childProcess || childProcess.killed) {
      console.log('🔍 Process already killed or null');
      resolve();
      return;
    }

    console.log(`🛑 Stopping server process PID: ${childProcess.pid}`);

    const timeout = setTimeout(() => {
      console.log('⏰ Timeout reached, process should be dead');
      resolve();
    }, 2000);

    childProcess.on('exit', (code) => {
      clearTimeout(timeout);
      console.log(`✅ Server process exited with code: ${code}`);
      resolve();
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      console.log('⚠️ Server process error:', error.message);
      resolve();
    });

    try {
      // Simulate what Ctrl+C does: send SIGINT to the process group
      console.log('📤 Sending SIGINT to process group (like Ctrl+C)...');
      process.kill(-childProcess.pid, 'SIGINT');
      console.log('✓ Successfully sent SIGINT to process group');
    } catch (e) {
      console.log('⚠️ Could not send SIGINT:', e.code, e.message);
      // Fallback to individual process
      try {
        childProcess.kill('SIGINT');
      } catch (e2) {
        console.log('⚠️ Could not kill individual process:', e2.message);
      }
      clearTimeout(timeout);
      resolve();
    }
  });
}

export async function prerender(config) {
  const {
    routes = [],
    outDir = "static-pages",
    serveDir = "build",
    flatOutput = false
  } = config;

  const outDirPath = path.resolve(process.cwd(), outDir);
  const port = await findAvailablePort();

  let serveProcess = null;
  let browser = null;
  let forceExitTimeout = null;

  // Handler for graceful shutdown on Ctrl+C
  const cleanup = async () => {
    console.log('\n🛑 Shutting down gracefully...');
    if (browser) {
      await browser.close();
    }
    if (serveProcess) {
      await killProcessGroup(serveProcess);
    }
    
    // Remove event listeners before exiting
    process.removeListener('SIGINT', cleanup);
    process.removeListener('SIGTERM', cleanup);
    process.exit(0);
  };

  // Listen for SIGINT (Ctrl+C)
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    serveProcess = spawn("npx", ["serve", "-s", serveDir, "-l", port.toString()], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      detached: true,  // ← Remettre ça mais...
    });

    // Et assigner le processus à son propre groupe
    serveProcess.unref(); // ← Ajout de ça pour qu'il ne bloque pas l'exit

    serveProcess.stdout.on("data", data => {
      if (process.env.DEBUG) process.stdout.write(`[serve] ${data}`);
    });
    serveProcess.stderr.on("data", data => {
      if (process.env.DEBUG) process.stderr.write(`[serve] ${data}`);
    });

    await waitForServer(port);
    console.log(`🚀 Server started on port ${port}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();

    await fs.mkdir(outDirPath, { recursive: true });

    for (const route of routes) {
      const url = `http://localhost:${port}${route}`;
      console.log(`📄 Processing route: ${route}`);

      await page.goto(url, { 
        waitUntil: "networkidle0",
        timeout: 120000  // 120 seconds instead of default 30 seconds
      });
      const html = await page.content();

      if (route === "/") {
        await fs.writeFile(path.join(outDirPath, "index.html"), html);
        console.log(`✅ Saved static page: index.html`);
      } else {
        const safeName = route.replace(/^\//, "").replace(/\//g, "-") || "root";
        if (flatOutput) {
          const fileName = `${safeName}.html`;
          await fs.writeFile(path.join(outDirPath, fileName), html);
          console.log(`✅ Saved static page: ${fileName}`);
        } else {
          // Use original path structure instead of safeName
          const routePath = route.replace(/^\//, "") || "root";
          const routeDir = path.join(outDirPath, routePath);
          await fs.mkdir(routeDir, { recursive: true });
          await fs.writeFile(path.join(routeDir, "index.html"), html);
          console.log(`✅ Saved static page: ${path.join(routePath, "index.html")}`);
        }
      }
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
      await killProcessGroup(serveProcess);
    }
    
    // Remove event listeners
    process.removeListener('SIGINT', cleanup);
    process.removeListener('SIGTERM', cleanup);
    
    // Force exit after cleanup
    setTimeout(() => {
      console.log('🚪 Forcing process exit...');
      process.exit(0);
    }, 1000);
  }
}