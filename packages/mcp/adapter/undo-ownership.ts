import type { ProjectStore } from "project-editor/store";
import { mcpReadError } from "../protocol";

type Manager = ProjectStore["undoManager"];
type HistoryState = {
    owned: Set<unknown>;
    undo: unknown[];
    redo: unknown[];
};

/**
 * Do not let an MCP undo/redo silently consume a human edit.
 * Track exact UndoManager stack entry identities from MCP transactions and
 * refuse when either stack changed outside an MCP transaction.
 */
const history = new WeakMap<Manager, HistoryState>();

function capture(manager: Manager, state: HistoryState) {
    state.undo = manager.undoStack.slice();
    state.redo = manager.redoStack.slice();
}

export function markMcpTransaction(manager: Manager) {
    const entry = manager.undoStack[manager.undoStack.length - 1];
    if (!entry) {
        throw mcpReadError("INVALID_STATE", "No undo entry was recorded for MCP operation");
    }
    const state = history.get(manager) || {
        owned: new Set<unknown>(),
        undo: [],
        redo: []
    };
    state.owned.add(entry);
    capture(manager, state);
    history.set(manager, state);
}

export function executeMcpHistory(manager: Manager, operation: "undo" | "redo") {
    if (manager.combineCommands || manager.postponeSetCombineCommandsFalse ||
        manager.commands.length) {
        throw mcpReadError("INVALID_STATE", "An editor transaction is in progress");
    }
    const state = history.get(manager);
    const equal = (current: unknown[], previous: unknown[]) =>
        current.length === previous.length &&
        current.every((item, index) => item === previous[index]);
    if (!state || !equal(manager.undoStack, state.undo) ||
        !equal(manager.redoStack, state.redo)) {
        throw mcpReadError("INVALID_STATE",
            "Undo/redo history changed outside MCP; refusing to alter manual edits");
    }
    const stack = operation === "undo" ? manager.undoStack : manager.redoStack;
    const next = stack[stack.length - 1];
    if (!next || !state.owned.has(next)) {
        throw mcpReadError("INVALID_STATE",
            "Only changes created by MCP can be undone/redone through MCP");
    }
    if (operation === "undo") manager.undo();
    else manager.redo();
    capture(manager, state);
}
