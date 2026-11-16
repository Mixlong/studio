/** Isolated sandboxed preload: only fixed user-initiated approval controls. */
import { ipcRenderer } from "electron";

const channel = "digistudio:mcp:approval-choice";
window.addEventListener("DOMContentLoaded", () => {
    for (const [id, choice] of [
        ["approval-deny", 0],
        ["approval-once", 1],
        ["approval-session", 2],
        ["approval-close", 0]
    ] as const) {
        document.getElementById(id)?.addEventListener("click", event => {
            if (!(event as MouseEvent).isTrusted) return;
            ipcRenderer.send(channel, choice);
        });
    }
    window.addEventListener("keydown", event => {
        if (event.key === "Escape" && event.isTrusted) {
            event.preventDefault();
            ipcRenderer.send(channel, 0);
        }
    });
});
