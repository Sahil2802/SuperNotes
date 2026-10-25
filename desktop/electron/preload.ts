import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("engine", {
  config: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke("engine-config"),
});
