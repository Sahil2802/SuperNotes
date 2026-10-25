import { ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

let sidecar: ChildProcess | null = null;
const token = randomBytes(24).toString("hex");
let port = 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

function startSidecar() {
  const dataDir = app.getPath("userData");
  const args = ["--port", String(port), "--token", token, "--data-dir", dataDir];
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, "engine", "engine.exe");
    sidecar = spawn(exe, args, { stdio: "inherit" });
  } else {
    const engineDir = path.join(app.getAppPath(), "..", "engine");
    sidecar = spawn("uv", ["run", "python", "app.py", ...args], { cwd: engineDir, stdio: "inherit" });
  }
}

function stopSidecar() {
  if (!sidecar || sidecar.killed) return;
  // taskkill /T so uv's child python dies too, not just the launcher
  if (process.platform === "win32" && sidecar.pid) {
    spawn("taskkill", ["/pid", String(sidecar.pid), "/T", "/F"]);
  } else {
    sidecar.kill();
  }
  sidecar = null;
}

app.whenReady().then(async () => {
  port = await freePort();
  ipcMain.handle("engine-config", () => ({ port, token }));
  startSidecar();
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
});

app.on("before-quit", stopSidecar);
app.on("window-all-closed", () => {
  stopSidecar();
  app.quit();
});
