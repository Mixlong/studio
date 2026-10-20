import type { EezObject } from "project-editor/core/object";
import { getLabel } from "project-editor/store";
import { ProjectEditor } from "project-editor/project-editor-interface";
import {
    ArrayElementAdded,
    ArrayElementRemoved,
    ArrayElementUpdated,
    ArrayPropertyValueUpdated,
    ObjectChanges,
    ObjectPropertyValueUpdated,
    PropertyValueAdded,
    PropertyValueRemoved,
    PropertyValueUpdated
} from "project-editor/features/changes/state";

export type SummaryKind = "added" | "removed" | "updated";

export interface ChangeSummaryItem {
    key: string;
    kind: SummaryKind;
    page: string;
    objectLabel: string;
    property: string;
    before?: string;
    after?: string;
    target?: EezObject;
}

function preview(value: unknown) {
    if (value === undefined) return "—";
    if (value === null) return "null";
    let text: string;
    try {
        text = typeof value === "string" ? value : JSON.stringify(value);
    } catch {
        text = String(value);
    }
    if (!text) return "—";
    return text.length > 120 ? text.substring(0, 117) + "…" : text;
}

function label(object: EezObject) {
    try {
        return getLabel(object) || object.constructor.name || "Object";
    } catch {
        return object.constructor.name || "Object";
    }
}

export function summarizeProjectChanges(root: ObjectChanges): ChangeSummaryItem[] {
    const items: ChangeSummaryItem[] = [];

    function push(
        kind: SummaryKind,
        object: EezObject,
        property: string,
        before?: unknown,
        after?: unknown,
        target?: EezObject
    ) {
        const focus = target || object;
        let page = "Project settings / resources";
        try {
            const ownerPage = ProjectEditor.getPage(focus);
            if (ownerPage) {
                page = label(ownerPage);
            }
        } catch {
            // Properties and resources outside a Page belong to the project group.
        }

        items.push({
            key: String(items.length),
            kind,
            page,
            objectLabel: label(focus),
            property,
            before: kind === "added" ? undefined : preview(before),
            after: kind === "removed" ? undefined : preview(after),
            target: kind === "removed" ? object : focus
        });
    }

    function visit(diff: ObjectChanges) {
        for (const change of diff.changes) {
            const name =
                typeof change.propertyInfo.displayName === "string"
                    ? change.propertyInfo.displayName
                    : change.propertyInfo.name;
            if (change instanceof ObjectPropertyValueUpdated) {
                visit(change.objectChanges);
            } else if (change instanceof ArrayPropertyValueUpdated) {
                const collection = change.arrayChanges;
                for (const element of collection.changes) {
                    if (element instanceof ArrayElementUpdated) {
                        visit(element.objectChanges);
                    } else if (element instanceof ArrayElementAdded) {
                        const target =
                            element.arrayAfter[element.elementIndexAfter];
                        if (target) push("added", diff.objectAfter, name, undefined, label(target), target);
                    } else if (element instanceof ArrayElementRemoved) {
                        const removed =
                            element.arrayBefore[element.elementIndexBefore];
                        if (removed) push("removed", diff.objectAfter, name, label(removed), undefined);
                    }
                }
                if (collection.shuffled) {
                    push("updated", diff.objectAfter, name + " order", "Previous order", "Reordered");
                }
            } else if (change instanceof PropertyValueUpdated) {
                push(
                    "updated", diff.objectAfter, name,
                    (change.objectBefore as any)[change.propertyInfo.name],
                    (change.objectAfter as any)[change.propertyInfo.name]
                );
            } else if (change instanceof PropertyValueAdded) {
                push("added", diff.objectAfter, name, undefined,
                    (change.objectAfter as any)[change.propertyInfo.name]);
            } else if (change instanceof PropertyValueRemoved) {
                push("removed", diff.objectAfter, name,
                    (change.objectBefore as any)[change.propertyInfo.name]);
            }
        }
    }

    visit(root);
    return items;
}

export function summarizeCounts(items: ChangeSummaryItem[]) {
    return {
        added: items.filter(item => item.kind === "added").length,
        removed: items.filter(item => item.kind === "removed").length,
        updated: items.filter(item => item.kind === "updated").length
    };
}
