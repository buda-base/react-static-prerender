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
      
      // Timeout pour killByPort
      const killPromise = killByPort(port);
      const timeoutPromise = new Promise(resolve => {
        setTimeout(() => {
          console.log('⏰ killByPort timeout reached');
          resolve();
        }, 2000);
      });
      
      await Promise.race([killPromise, timeoutPromise]);
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
    serveProcess = spawn("npx", ["serve", "-s", serveDir, "-l", port.toString()], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      detached: true,  // ← Garder ça pour la fin normale
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
          // Separate path from query parameters
          const [routePath, queryString] = route.split('?');
          const cleanPath = routePath.replace(/^\//, "") || "root";
          
          // Create directory structure based on path only
          const routeDir = path.join(outDirPath, cleanPath);
          await fs.mkdir(routeDir, { recursive: true });
          
          // Include query parameters in filename if they exist
          const fileName = queryString ? `index.html?${queryString}` : "index.html";
          
          await fs.writeFile(path.join(routeDir, fileName), html);
          console.log(`✅ Saved static page: ${path.join(cleanPath, fileName)}`);
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