export interface TreeGuideInfo {
    continuationLevels: number[];
    isLastSibling: boolean;
    hasVisibleChildren: boolean;
}

/** Describe lines for a flat, visible depth-first tree without changing its data. */
export function getTreeGuideInfo(
    rows: ReadonlyArray<{ level: number }>
): TreeGuideInfo[] {
    const hasNextSibling = new Array<boolean>(rows.length);
    const nextAtLevel: boolean[] = [];

    for (let index = rows.length - 1; index >= 0; index--) {
        const { level } = rows[index];
        nextAtLevel.length = level + 1;
        hasNextSibling[index] = nextAtLevel[level] === true;
        nextAtLevel[level] = true;
    }

    const ancestorHasNextSibling: boolean[] = [];
    return rows.map((row, index) => {
        const continuationLevels: number[] = [];
        ancestorHasNextSibling.length = row.level + 1;

        for (let level = 1; level < row.level; level++) {
            if (ancestorHasNextSibling[level]) {
                continuationLevels.push(level);
            }
        }

        ancestorHasNextSibling[row.level] = hasNextSibling[index];
        return {
            continuationLevels,
            isLastSibling: !hasNextSibling[index],
            hasVisibleChildren:
                index + 1 < rows.length && rows[index + 1].level > row.level
        };
    });
}
