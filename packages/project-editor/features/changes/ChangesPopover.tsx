import React from "react";
import ReactDOM from "react-dom";
import { observer } from "mobx-react";
import { Icon } from "eez-studio-ui/icon";
import { PageTabState } from "project-editor/features/page/PageEditor";
import { ProjectContext } from "project-editor/project/context";
import { ProjectEditor } from "project-editor/project-editor-interface";
import {
    MEMORY_HASH,
    UNSTAGED_HASH,
    diffObject,
    getBeforeAndAfterProject
} from "project-editor/features/changes/state";
import {
    ChangeSummaryItem,
    summarizeCounts,
    summarizeProjectChanges
} from "project-editor/features/changes/summary";

const panel: React.CSSProperties = {
    position: "fixed",
    zIndex: 5000,
    width: 370,
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "min(75vh, 650px)",
    display: "flex",
    flexDirection: "column",
    borderRadius: 10,
    border: "1px solid var(--bs-border-color, #adb5bd)",
    background: "var(--bs-body-bg, #fff)",
    color: "var(--bs-body-color, #212529)",
    boxShadow: "0 12px 36px rgba(0,0,0,.25)",
    overflow: "hidden"
};
const secondary: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const flatButton: React.CSSProperties = {
    background: "transparent",
    color: "inherit",
    border: 0,
    padding: "5px 8px",
    cursor: "pointer"
};

export const ProjectChangesPopover = observer(() => {
    const store = React.useContext(ProjectContext);
    const [opened, setOpened] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [items, setItems] = React.useState<ChangeSummaryItem[]>([]);
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
    const [position, setPosition] = React.useState({ top: 45, right: 12 });
    const button = React.useRef<HTMLButtonElement>(null);
    const popover = React.useRef<HTMLDivElement>(null);
    const revision = store.lastRevision;
    const savedRevision = store.savedRevision;
    const filePath = store.filePath;

    const locate = React.useCallback(() => {
        if (button.current) {
            const bounds = button.current.getBoundingClientRect();
            setPosition({
                top: Math.min(window.innerHeight - 80, bounds.bottom + 8),
                right: Math.max(12, window.innerWidth - bounds.right)
            });
        }
    }, []);

    React.useEffect(() => {
        if (!opened) return;
        locate();
        const onPointer = (event: MouseEvent) => {
            const node = event.target as Node;
            if (!button.current?.contains(node) &&
                !popover.current?.contains(node)) {
                setOpened(false);
            }
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpened(false);
        };
        window.addEventListener("resize", locate);
        document.addEventListener("mousedown", onPointer);
        document.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("resize", locate);
            document.removeEventListener("mousedown", onPointer);
            document.removeEventListener("keydown", onKey);
        };
    }, [opened, locate]);

    React.useEffect(() => {
        if (!opened) return;
        let cancelled = false;
        const timeout = window.setTimeout(async () => {
            setError("");
            setBusy(true);
            try {
                if (!filePath) {
                    setItems([]);
                    setError("Save the project before comparing it with the last saved version.");
                    return;
                }
                if (revision === savedRevision) {
                    setItems([]);
                    return;
                }
                const versions = await getBeforeAndAfterProject(
                    store,
                    { hash: UNSTAGED_HASH, message: "Saved file" },
                    { hash: MEMORY_HASH, message: "Current editor" },
                    () => {}
                );
                if (!versions) {
                    throw new Error("Unable to read or parse the saved project file.");
                }
                const changes = diffObject(
                    versions.projectBefore,
                    versions.projectAfter
                );
                if (!cancelled) {
                    setItems(summarizeProjectChanges(changes));
                }
            } catch (cause) {
                if (!cancelled) {
                    setItems([]);
                    setError(cause instanceof Error
                        ? cause.message
                        : String(cause));
                }
            } finally {
                if (!cancelled) setBusy(false);
            }
        }, 200);
        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [opened, revision, savedRevision, filePath, store]);

    const openFullComparison = () => {
        store.editorsStore.openEditor(store.project.changes, undefined, {
            hashBefore: UNSTAGED_HASH,
            hashAfter: MEMORY_HASH
        });
        setOpened(false);
    };

    const selectItem = (item: ChangeSummaryItem) => {
        if (!item.target) return;
        const target = item.target;
        const page = ProjectEditor.getPage(target);
        if (page) {
            store.editorsStore.openEditor(page);
            const editor = store.editorsStore.getEditorByObject(page);
            (editor?.state as PageTabState | undefined)?.selectObject(target);
            setOpened(false);
        } else {
            // Settings, resource collections and other non-page objects retain
            // their normal feature editors.
            try {
                store.editorsStore.openEditor(target);
                setOpened(false);
            } catch {
                // An unsupported feature remains accessible via full diff.
            }
        }
    };

    const counts = summarizeCounts(items);
    const groups = new Map<string, ChangeSummaryItem[]>();
    for (const item of items) {
        if (!groups.has(item.page)) groups.set(item.page, []);
        groups.get(item.page)!.push(item);
    }

    return (
        <>
            <button
                ref={button}
                type="button"
                className="EezStudio_Action EezStudio_ButtonAction btn DigiStudio_ChangesAction"
                title="Project changes (current vs. saved)"
                aria-label="Open project changes"
                aria-haspopup="dialog"
                aria-expanded={opened}
                onClick={() => {
                    locate();
                    setOpened(value => !value);
                }}
            >
                <Icon icon="material:difference" size={18}
                    style={{ marginRight: 5 }} />
                Changes
                {store.isModified && (
                    <span className="DigiStudio_ChangesCount" aria-label="Unsaved changes">
                        {items.length > 0 ? items.length : "•"}
                    </span>
                )}
            </button>
            {opened && ReactDOM.createPortal(
                <div
                    ref={popover}
                    role="dialog"
                    aria-label="Project changes"
                    className="EezStudio_ProjectChangesPopover"
                    style={{ ...panel, ...position }}
                >
                    <div style={{
                        display: "flex", alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 13px",
                        borderBottom: "1px solid var(--bs-border-color, #ddd)"
                    }}>
                        <strong>Project changes</strong>
                        <div style={{ display: "flex", alignItems: "center" }}>
                            <span style={secondary}>
                                {busy ? "Comparing..." : error ? "Comparison failed" : items.length + " changes"}
                            </span>
                            <button type="button" style={flatButton}
                                title="Refresh comparison" aria-label="Refresh comparison"
                                onClick={() => {
                                    // Reload while retaining any unsaved changes.
                                    setOpened(false);
                                    window.setTimeout(() => setOpened(true), 0);
                                }}>↻</button>
                            <button type="button" style={flatButton}
                                title="Close" aria-label="Close"
                                onClick={() => setOpened(false)}>×</button>
                        </div>
                    </div>
                    <div style={{
                        padding: "9px 13px",
                        borderBottom: "1px solid var(--bs-border-color, #ddd)"
                    }}>
                        <div style={secondary}>Current version vs. saved version</div>
                        {!busy && !error && (
                            <div style={{ display: "flex", gap: 15, marginTop: 7, fontSize: 12 }}>
                                <span style={{ color: "#238b5b" }}>+{counts.added} Added</span>
                                <span>{counts.updated} Modified</span>
                                <span style={{ color: "#c65353" }}>−{counts.removed} Removed</span>
                            </div>
                        )}
                    </div>
                    <div style={{ overflowY: "auto", padding: "7px 10px", minHeight: 70 }}>
                        {error && <div role="alert" style={{ fontSize: 13, padding: 9 }}>{error}</div>}
                        {!busy && !error && items.length === 0 && (
                            <div style={{
                                padding: "24px 12px", textAlign: "center",
                                fontSize: 13, opacity: 0.65
                            }}>No unsaved project changes</div>
                        )}
                        {Array.from(groups.entries()).map(([name, entries]) => (
                            <div key={name} style={{ marginBottom: 6 }}>
                                <button
                                    type="button"
                                    onClick={() => setExpanded(current => ({
                                        ...current, [name]: current[name] === false
                                    }))}
                                    style={{
                                        ...flatButton, width: "100%",
                                        display: "flex", justifyContent: "space-between",
                                        textAlign: "left", fontWeight: 600, fontSize: 13
                                    }}
                                >
                                    <span>{expanded[name] === false ? "▸" : "▾"} {name}</span>
                                    <span style={secondary}>{entries.length} changes</span>
                                </button>
                                {expanded[name] !== false && entries.slice(0, 100).map(item => (
                                    <button type="button" key={item.key}
                                        onClick={() => selectItem(item)}
                                        title="Go to the related component or feature"
                                        style={{
                                            ...flatButton, textAlign: "left",
                                            display: "block", width: "100%",
                                            padding: "8px 12px", borderRadius: 5,
                                            borderBottom: "1px solid var(--bs-border-color, #ddd)"
                                        }}>
                                        <div style={{ fontSize: 12 }}>
                                            <span style={{
                                                color: item.kind === "added" ? "#238b5b" :
                                                    item.kind === "removed" ? "#c65353" : "inherit",
                                                marginRight: 6
                                            }}>
                                                {item.kind === "added" ? "+" :
                                                    item.kind === "removed" ? "−" : "●"}
                                            </span>
                                            <strong>{item.objectLabel}</strong> · {item.property}
                                        </div>
                                        {(item.before !== undefined || item.after !== undefined) && (
                                            <div style={{
                                                ...secondary, marginTop: 4,
                                                overflowWrap: "anywhere"
                                            }}>
                                                {item.before !== undefined && (
                                                    <span style={{
                                                        textDecoration: "line-through",
                                                        color: "#bd5656"
                                                    }}>{item.before}</span>
                                                )}
                                                {item.before !== undefined && item.after !== undefined && " → "}
                                                {item.after !== undefined && (
                                                    <span style={{ color: "#238b5b" }}>{item.after}</span>
                                                )}
                                            </div>
                                        )}
                                    </button>
                                ))}
                                {entries.length > 100 && (
                                    <div style={secondary}>
                                        {entries.length - 100} more changes. See the full diff.
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={openFullComparison}
                        disabled={!filePath}
                        style={{
                            ...flatButton, textAlign: "left", padding: "12px 15px",
                            borderTop: "1px solid var(--bs-border-color, #ddd)",
                            fontWeight: 600
                        }}
                    >View full diff ↗</button>
                </div>,
                document.body
            )}
        </>
    );
});
