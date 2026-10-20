import fs from "fs";

export interface EmbeddedFontSource {
    embeddedFontFile?: string;
}

/**
 * Embed the original font bytes when serializing an eez-project.
 * Keeping source paths as labels preserves backwards compatibility while
 * the embedded bytes allow re-import after those paths no longer exist.
 */
export function embedFontSource(
    source: EmbeddedFontSource,
    filePath: string | undefined,
    name: string,
    resolvePath: (filePath: string) => string
): void {
    if (source.embeddedFontFile || !filePath) {
        return;
    }

    try {
        source.embeddedFontFile = fs.readFileSync(resolvePath(filePath)).toString(
            "base64"
        );
    } catch (error) {
        throw new Error(
            'Cannot embed font "' + name + '" from "' + filePath + '": ' +
                error
        );
    }
}
