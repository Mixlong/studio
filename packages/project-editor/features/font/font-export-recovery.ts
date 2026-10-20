export type FontExportFailureAction = "retry" | "skip" | "cancel";

/**
 * A failed font must never be silently treated as successfully exported.
 * Callers decide how to present the failure; "skip" records a partial
 * export, and "cancel" aborts the remaining build.
 */
export async function exportFontWithRecovery(
    exportFont: () => Promise<void>,
    onFailure: (error: Error) => Promise<FontExportFailureAction>
): Promise<boolean> {
    while (true) {
        try {
            await exportFont();
            return true;
        } catch (cause) {
            const error =
                cause instanceof Error ? cause : new Error(String(cause));
            const action = await onFailure(error);
            if (action === "retry") {
                continue;
            }
            if (action === "skip") {
                return false;
            }
            throw new Error("Font export cancelled: " + error.message);
        }
    }
}
