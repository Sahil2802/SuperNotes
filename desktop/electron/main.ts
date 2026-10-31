import { ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

let sidecar: ChildProcess | null = null;
const token = randomBytes(24).toString("hex");
let port = 0;
let quitting = false;

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

function failSidecar(why: string) {
  if (quitting) return;
  dialog.showErrorBox("Supernotes engine stopped", `${why}

Restart the app. Anything already recorded is saved.`);
}

function startSidecar() {
  const dataDir = path.join(app.getPath("appData"), "live-notes-desktop"); // pre-rename folder (old package name), keeps existing lectures
  const args = ["--port", String(port), "--token", token, "--data-dir", dataDir];
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, "engine", "engine.exe");
    sidecar = spawn(exe, args, { stdio: "inherit" });
  } else {
    const engineDir = path.join(app.getAppPath(), "..", "engine");
    sidecar = spawn("uv", ["run", "python", "app.py", ...args], { cwd: engineDir, stdio: "inherit" });
  }
  sidecar.on("error", (e) => failSidecar(`Could not start the engine: ${e.message}`));
  sidecar.on("exit", (code) => failSidecar(`The engine exited unexpectedly (code ${code}).`));
}

function stopSidecar() {
  quitting = true;
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
  // only our own page may ask for the token
  ipcMain.handle("engine-config", (e) => {
    const u = e.senderFrame?.url ?? "";
    const ok = process.env.VITE_DEV_URL ? u.startsWith(process.env.VITE_DEV_URL) : u.startsWith("file://");
    if (!ok) throw new Error("forbidden");
    return { port, token };
  });
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
  // the app never navigates away; links (e.g. in LLM summaries) open in the default browser instead
  win.webContents.on("will-navigate", (e, u) => {
    if (u !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
});

app.on("before-quit", stopSidecar);
app.on("window-all-closed", () => {
  stopSidecar();
  app.quit();
});
