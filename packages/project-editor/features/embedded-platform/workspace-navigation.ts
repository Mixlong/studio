export type EmbeddedWorkspaceId =
    | "target"
    | "protocols"
    | "resources"
    | "connection"
    | "components";

export interface EmbeddedWorkspaceItem {
    id: EmbeddedWorkspaceId;
    icon: string;
    label: string;
    advanced: boolean;
}

const WORKSPACES: Record<EmbeddedWorkspaceId, EmbeddedWorkspaceItem> = {
    target: {
        id: "target",
        icon: "material:memory",
        label: "Target",
        advanced: true
    },
    protocols: {
        id: "protocols",
        icon: "material:cable",
        label: "Protocols",
        advanced: true
    },
    resources: {
        id: "resources",
        icon: "material:storage",
        label: "Resources",
        advanced: true
    },
    connection: {
        id: "connection",
        icon: "material:settings_ethernet",
        label: "Connection",
        advanced: false
    },
    components: {
        id: "components",
        icon: "material:visibility",
        label: "Components",
        advanced: false
    }
};

const LOCAL_ORDER: EmbeddedWorkspaceId[] = [
    "target",
    "protocols",
    "resources",
    "connection",
    "components"
];

const REMOTE_ORDER: EmbeddedWorkspaceId[] = [
    "connection",
    "components",
    "target",
    "protocols",
    "resources"
];

/**
 * Hide local-only configuration from the main navigation when building
 * through remote WebSocket middleware. All workspaces remain accessible.
 */
export function getEmbeddedWorkspaceItems(
    remoteMode: boolean,
    showAdvanced: boolean
): EmbeddedWorkspaceItem[] {
    const order = remoteMode ? REMOTE_ORDER : LOCAL_ORDER;
    return order
        .filter(id => !remoteMode || showAdvanced || !WORKSPACES[id].advanced)
        .map(id => WORKSPACES[id]);
}

export function getActiveEmbeddedWorkspace(
    requested: string,
    remoteMode: boolean,
    showAdvanced: boolean
): EmbeddedWorkspaceId {
    const visible = getEmbeddedWorkspaceItems(remoteMode, showAdvanced);
    const match = visible.find(item => item.id === requested);
    return match?.id || (remoteMode ? "connection" : "target");
}
