/** Bounded and identity-safe Flow Action graph access for MCP. */
import type { ProjectStore } from "project-editor/store";
import type { Action } from "project-editor/features/action/action";
import { mcpReadError } from "../protocol";

export function resolveFlowAction(store: ProjectStore, name: string, id: string): Action {
    const action = store.project.actions.find(item => item.name === name);
    if (!action || action.objID !== id) {
        throw mcpReadError("INVALID_STATE", "Action name/id is stale; call list_actions again");
    }
    if (action.implementationType !== "flow" || !store.projectTypeTraits.hasFlowSupport) {
        throw mcpReadError("INVALID_ARGUMENT", "Only Flow-enabled Actions support graph editing");
    }
    return action;
}

export function getActionGraph(store: ProjectStore, name: string, id: string) {
    const action = resolveFlowAction(store, name, id);
    if (action.components.length > 250 || action.connectionLines.length > 500) {
        throw mcpReadError("LIMIT_EXCEEDED", "Flow graph exceeds MCP read limits");
    }
    const safeVariableAssignment = (node: any) => {
        if (node.type !== "SetVariableActionComponent" || node.entries?.length !== 1) return {};
        const entry = node.entries[0];
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(entry?.variable || "")) return {};
        try {
            const value = JSON.parse(entry.value);
            if (typeof value === "string" && value.length <= 128 ||
                typeof value === "boolean" ||
                typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1000000) {
                return { variableName: entry.variable, value };
            }
        } catch (_error) { /* Expressions are deliberately never exposed. */ }
        return {};
    };
    const ports = (items: { name: string }[] | undefined) =>
        (items || []).slice(0, 32).map(item => item.name).filter(value =>
            typeof value === "string" && value.length <= 64);
    return {
        actionName: action.name,
        actionId: action.objID,
        implementationType: action.implementationType,
        nodes: action.components.map(node => ({
            nodeId: node.objID,
            type: node.type,
            left: node.left,
            top: node.top,
            ...(node.type === "NoopActionComponent" && typeof (node as any).name === "string" ?
                { name: (node as any).name.slice(0, 64) } : {}),
            ...(node.type === "DelayActionComponent" && /^\d{1,5}$/.test(String((node as any).milliseconds)) ?
                { milliseconds: Number((node as any).milliseconds) } : {}),
            ...safeVariableAssignment(node),
            ...(node.type === "IsTrueActionComponent" &&
                /^(true|false|[A-Za-z_][A-Za-z0-9_]{0,63})$/.test(String((node as any).value || "")) ?
                { condition: String((node as any).value) } : {}),
            ...(node.type === "CallActionActionComponent" &&
                /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String((node as any).action || "")) ?
                { targetActionName: String((node as any).action) } : {}),
            ...(node.type === "LVGLActionComponent" && (node as any).actions?.length === 1 &&
                (node as any).actions[0]?.action === "changeScreen" &&
                /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String((node as any).actions[0].screen || "")) ?
                { screenName: String((node as any).actions[0].screen) } : {}),
            inputs: ports(node.getInputs()),
            outputs: ports(node.getOutputs())
        })),
        lines: action.connectionLines.map(line => ({
            lineId: line.objID,
            sourceId: line.source,
            output: line.output,
            targetId: line.target,
            input: line.input
        }))
    };
}
