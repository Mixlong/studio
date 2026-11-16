export type DigiwiseChangelogLanguage = "zh-CN" | "en-US";

export interface DigiwiseChangelogGroup {
    code: string;
    label: string;
    title: string;
    items: string[];
}

export interface DigiwiseChangelog {
    version: string;
    channel: "stable" | "dev";
    language: DigiwiseChangelogLanguage;
    groups: DigiwiseChangelogGroup[];
}

export interface DigiwiseChangelogIdentity {
    version: string;
    channel: "stable" | "dev";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, max: number) {
    return typeof value === "string" &&
        value.trim().length > 0 && value.length <= max;
}

/** Validate remote responses AND cached data against the exact installed release. */
export function validateDigiwiseChangelog(
    value: unknown,
    identity: DigiwiseChangelogIdentity,
    language: DigiwiseChangelogLanguage
): DigiwiseChangelog {
    if (!isObject(value) ||
        value.version !== identity.version ||
        value.channel !== identity.channel ||
        value.language !== language ||
        !Array.isArray(value.groups) ||
        value.groups.length > 8) {
        throw new Error("IDE changelog version, language or format mismatch");
    }
    const categories = new Set<string>();
    for (const entry of value.groups) {
        if (!isObject(entry) ||
            !text(entry.code, 64) ||
            !/^[a-z][a-z0-9_-]{0,63}$/.test(entry.code as string) ||
            categories.has(entry.code as string) ||
            !text(entry.label, 80) ||
            !text(entry.title, 150) ||
            !Array.isArray(entry.items) ||
            entry.items.length < 1 ||
            entry.items.length > 20 ||
            entry.items.some((item: unknown) => !text(item, 500))) {
            throw new Error("Invalid IDE changelog group");
        }
        categories.add(entry.code as string);
    }
    return value as unknown as DigiwiseChangelog;
}
