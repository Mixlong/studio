import fs from "fs";
import path from "path";

////////////////////////////////////////////////////////////////////////////////

export function listFiles(folder: string, extensions: string[]) {
    if (!fs.existsSync(folder)) {
        return [];
    }

    return fs
        .readdirSync(folder, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => path.join(folder, entry.name))
        .filter(filePath => extensions.includes(path.extname(filePath).toLowerCase()))
        .sort();
}

export function listFilesWithPrefix(
    folder: string,
    prefixes: string[],
    extensions: string[]
) {
    return listFiles(folder, extensions).filter(filePath => {
        const fileName = path.basename(filePath);
        return prefixes.some(prefix => fileName.startsWith(prefix));
    });
}

export function listNamedFiles(folder: string, names: string[]) {
    return names
        .map(name => path.join(folder, name))
        .filter(filePath => fs.existsSync(filePath));
}

export function uniqueFiles(filePaths: string[]) {
    return Array.from(
        new Set(filePaths.map(filePath => path.resolve(filePath)))
    ).sort();
}
