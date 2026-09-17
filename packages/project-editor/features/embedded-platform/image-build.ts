import fs from "fs";

import type { IEezObject } from "project-editor/core/object";
import type { ProjectStore } from "project-editor/store";
import type { Bitmap, BitmapData } from "project-editor/features/bitmap/bitmap";
import type {
    EmbeddedStorageMode,
    EmbeddedStorageSettings
} from "project-editor/features/embedded-platform/embedded-platform";

////////////////////////////////////////////////////////////////////////////////

const MAX_FLASH_ADDRESS = 0xffffffff;

export interface EmbeddedImageInput {
    name: string;
    sourceFile: string;
    data: BitmapData;
    object?: IEezObject;
}

export interface EmbeddedImageBuildIssue {
    message: string;
    object?: IEezObject;
}

export interface EmbeddedImageManifestResource {
    id: number;
    name: string;
    sourceFile: string;
    width: number;
    height: number;
    bpp: number;
    dataSize: number;
    flashOffset: number;
    flashAddress: string;
}

export interface EmbeddedImageBuildManifest {
    schema: "eez-studio.images";
    version: 1;
    storage: EmbeddedStorageMode;
    accessMode: "rom" | "xip" | "non-xip";
    baseAddress: string;
    partitionSize: number;
    alignment: number;
    usedSize: number;
    imageSize: number;
    freeSize: number;
    xipSectionAttribute: string;
    resources: EmbeddedImageManifestResource[];
}

export interface EmbeddedImageBuildResult {
    binary: Buffer;
    manifest: EmbeddedImageBuildManifest;
}

export interface EmbeddedImageBuildPreparation {
    result?: EmbeddedImageBuildResult;
    issues: EmbeddedImageBuildIssue[];
}

interface ImageLayoutSettings {
    storage: EmbeddedStorageMode;
    baseAddress: string;
    partitionSize: number;
    alignment: number;
    xipSectionAttribute: string;
}

////////////////////////////////////////////////////////////////////////////////

function imageError(message: string, object?: IEezObject) {
    return { message, object };
}

function isPowerOfTwo(value: number) {
    return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function parseAddress(value: string) {
    const trimmed = value.trim();
    if (!/^(0x[0-9a-f]+|\d+)$/i.test(trimmed)) {
        throw new Error("Image base address must be decimal or hexadecimal.");
    }

    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_FLASH_ADDRESS) {
        throw new Error("Image base address must fit in an unsigned 32-bit value.");
    }
    return parsed;
}

function formatAddress(value: number) {
    return `0x${value.toString(16).toUpperCase()}`;
}

function align(value: number, alignment: number) {
    if (!isPowerOfTwo(alignment)) {
        throw new Error("Image alignment must be a positive power of two.");
    }
    const result = Math.ceil(value / alignment) * alignment;
    if (!Number.isSafeInteger(result)) {
        throw new Error("Image layout exceeds the supported address range.");
    }
    return result;
}

function normalizeSourceFile(value: string) {
    return value.startsWith("data:image/") ? "<embedded>" : value.replace(/\\/g, "/");
}

function getLayoutSettings(storage: EmbeddedStorageSettings): ImageLayoutSettings {
    return {
        storage: storage.image,
        baseAddress: storage.imageBaseAddress || "",
        partitionSize: storage.imagePartitionSize || 0,
        alignment: storage.imageAlignment || 4096,
        xipSectionAttribute: storage.xipSectionAttribute || ""
    };
}

/** Build a deterministic image mirror from already decoded bitmap pixels. */
export function prepareEmbeddedImageBuild(
    images: EmbeddedImageInput[],
    settings: ImageLayoutSettings
): EmbeddedImageBuildPreparation {
    if (images.length === 0) {
        return { issues: [] };
    }

    const issues: EmbeddedImageBuildIssue[] = [];
    let baseAddress = 0;
    const alignment = settings.alignment;

    if (settings.storage !== "rom" && settings.storage !== "xip" && settings.storage !== "non-xip") {
        issues.push(imageError("Image storage mode is invalid."));
    }

    try {
        baseAddress = parseAddress(settings.baseAddress || "0");
    } catch (error) {
        if (settings.storage !== "rom") {
            issues.push(
                imageError(error instanceof Error ? error.message : "Image base address is invalid.")
            );
        }
    }

    if (!isPowerOfTwo(alignment)) {
        issues.push(imageError("Image alignment must be a positive power of two."));
    }

    if (settings.storage !== "rom" && (!Number.isSafeInteger(settings.partitionSize) || settings.partitionSize <= 0)) {
        issues.push(imageError("Image partition size must be a positive whole number."));
    }

    const prepared = images.map(image => ({
        ...image,
        sourceFile: normalizeSourceFile(image.sourceFile),
        bytes: Buffer.from(image.data.pixels)
    }));

    for (const image of prepared) {
        if (!image.name.trim()) {
            issues.push(imageError("Image resource name is required.", image.object));
        }
        if (!Number.isSafeInteger(image.data.width) || image.data.width <= 0 || !Number.isSafeInteger(image.data.height) || image.data.height <= 0) {
            issues.push(imageError(`Image '${image.name}' has invalid dimensions.`, image.object));
        }
        if (image.bytes.length === 0) {
            issues.push(imageError(`Image '${image.name}' has no pixel data.`, image.object));
        }
    }

    if (issues.length > 0) {
        return { issues };
    }

    const names = new Set<string>();
    for (const image of prepared) {
        if (names.has(image.name)) {
            issues.push(imageError(`Image resource name '${image.name}' is duplicated.`, image.object));
        }
        names.add(image.name);
    }
    if (issues.length > 0) {
        return { issues };
    }

    let offset = 0;
    const manifestResources: EmbeddedImageManifestResource[] = [];
    let usedSize = 0;
    for (let index = 0; index < prepared.length; index++) {
        const image = prepared[index];
        offset = align(offset, alignment);
        const end = offset + image.bytes.length;
        if (!Number.isSafeInteger(end)) {
            issues.push(imageError(`Image '${image.name}' exceeds the supported address range.`, image.object));
            continue;
        }
        if (settings.storage !== "rom" && end > settings.partitionSize) {
            issues.push(imageError(`Image '${image.name}' does not fit in the configured image partition.`, image.object));
            continue;
        }

        manifestResources.push({
            id: index + 1,
            name: image.name,
            sourceFile: image.sourceFile,
            width: image.data.width,
            height: image.data.height,
            bpp: image.data.bpp,
            dataSize: image.bytes.length,
            flashOffset: offset,
            flashAddress: formatAddress(baseAddress + offset)
        });
        usedSize = end;
        offset = end;
    }

    if (issues.length > 0) {
        return { issues };
    }

    let imageSize: number;
    try {
        imageSize = align(usedSize, alignment);
    } catch (error) {
        return {
            issues: [imageError(error instanceof Error ? error.message : "Image size is invalid.")]
        };
    }

    const partitionSize = settings.storage === "rom" ? imageSize : settings.partitionSize;
    if (imageSize > partitionSize) {
        return { issues: [imageError("The aligned image mirror exceeds the configured partition.")] };
    }
    if (baseAddress + imageSize > MAX_FLASH_ADDRESS + 1) {
        return { issues: [imageError("Image Flash addresses exceed the 32-bit address space.")] };
    }
    if (imageSize > 0x7fffffff) {
        return { issues: [imageError("The image mirror is too large to generate as a single binary file.")] };
    }

    const binary = Buffer.alloc(imageSize, 0xff);
    for (let index = 0; index < prepared.length; index++) {
        binary.subarray(manifestResources[index].flashOffset).set(prepared[index].bytes);
    }

    return {
        issues,
        result: {
            binary,
            manifest: {
                schema: "eez-studio.images",
                version: 1,
                storage: settings.storage,
                accessMode: settings.storage,
                baseAddress: formatAddress(baseAddress),
                partitionSize,
                alignment,
                usedSize,
                imageSize,
                freeSize: partitionSize - imageSize,
                xipSectionAttribute: settings.xipSectionAttribute,
                resources: manifestResources
            }
        }
    };
}

export async function prepareEmbeddedImageBuildForProject(
    projectStore: ProjectStore
): Promise<EmbeddedImageBuildPreparation> {
    const project = projectStore.project;
    const storage = project.embeddedPlatform?.storage;
    if (!storage || project.bitmaps.length === 0) {
        return { issues: [] };
    }

    const images: EmbeddedImageInput[] = [];
    const issues: EmbeddedImageBuildIssue[] = [];
    const { getBitmapDataAsync } = await import("project-editor/features/bitmap/bitmap");
    for (const bitmap of project.bitmaps as Bitmap[]) {
        try {
            const data = await getBitmapDataAsync(bitmap);
            images.push({
                name: bitmap.name,
                sourceFile: bitmap.image,
                data,
                object: bitmap
            });
        } catch (error) {
            issues.push(
                imageError(
                    `Image '${bitmap.name}' could not be packaged: ${
                        error instanceof Error ? error.message : error
                    }`,
                    bitmap
                )
            );
        }
    }

    if (issues.length > 0) {
        return { issues };
    }
    return prepareEmbeddedImageBuild(images, getLayoutSettings(storage));
}

export async function writeEmbeddedImageBinary(filePath: string, binary: Buffer) {
    await fs.promises.writeFile(filePath, binary);
}
