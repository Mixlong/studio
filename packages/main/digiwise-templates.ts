import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";

import type {
    DigiwiseTemplateCreateRequest,
    DigiwiseTemplateCreateProgress,
    DigiwiseTemplateDownload,
    DigiwiseTemplateItem
} from "eez-studio-shared/digiwise-templates";
import {
    DigiwisePublicApi,
    DigiwisePublicApiError
} from "main/digiwise-auth-api";
import { callDigiwisePublicApiWithSession } from "main/digiwise-auth";

const TEMPLATE_PAGE_SIZE = 100;
const MAX_TEMPLATE_COUNT = 1_000_000;
const MAX_TEMPLATE_FILE_SIZE = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ARCHIVE_EXPANDED_SIZE = 250 * 1024 * 1024;

let ipcRegistered = false;

function invalidResponse(message: string): DigiwisePublicApiError {
    return new DigiwisePublicApiError(
        502,
        "PUBLIC_API_INVALID_RESPONSE",
        message,
        "template-list-response"
    );
}

function templateError(code: string, message: string, status = 422) {
    return new DigiwisePublicApiError(status, code, message, "template-create");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown) {
    return value === null || typeof value === "string";
}

function isOptionalNullableString(
    value: Record<string, unknown>,
    key: string
) {
    return !(key in value) || isNullableString(value[key]);
}

function isSecureCoverUrl(value: unknown) {
    return (
        typeof value === "undefined" ||
        value === null ||
        (typeof value === "string" && value.startsWith("https://"))
    );
}

function isTemplateItem(value: unknown): value is DigiwiseTemplateItem {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        isOptionalNullableString(value, "description") &&
        isOptionalNullableString(value, "category") &&
        isSecureCoverUrl(value.coverUrl) &&
        typeof value.version === "string" &&
        typeof value.projectType === "string" &&
        isOptionalNullableString(value, "lvglVersion") &&
        isOptionalNullableString(value, "modelCode") &&
        typeof value.fileName === "string" &&
        typeof value.fileSize === "number" &&
        Number.isSafeInteger(value.fileSize) &&
        value.fileSize > 0 &&
        typeof value.sha256 === "string" &&
        /^[a-fA-F0-9]{64}$/.test(value.sha256) &&
        (value.fileFormat === "eez-project" || value.fileFormat === "zip") &&
        typeof value.publishedAt === "string"
    );
}

async function listAllTemplates(
    api: DigiwisePublicApi,
    accessToken: string
): Promise<DigiwiseTemplateItem[]> {
    const allItems: DigiwiseTemplateItem[] = [];
    let expectedTotal: number | undefined;

    for (let page = 1; page <= 10_000; page++) {
        const result = await api.listTemplates(
            accessToken,
            page,
            TEMPLATE_PAGE_SIZE
        );

        if (!isRecord(result)) {
            throw invalidResponse("The template list response is invalid");
        }

        if (
            !Array.isArray(result.items) ||
            !Number.isSafeInteger(result.page) ||
            result.page !== page ||
            !Number.isSafeInteger(result.pageSize) ||
            result.pageSize !== TEMPLATE_PAGE_SIZE ||
            !Number.isSafeInteger(result.total) ||
            result.total < 0 ||
            result.total > MAX_TEMPLATE_COUNT
        ) {
            throw invalidResponse("The template list pagination is invalid");
        }

        if (expectedTotal === undefined) {
            expectedTotal = result.total;
        } else if (result.total !== expectedTotal) {
            throw invalidResponse("The template list changed while loading pages");
        }

        if (!result.items.every(isTemplateItem)) {
            throw invalidResponse("The template list contains an invalid item");
        }

        allItems.push(...result.items);
        if (allItems.length > result.total) {
            throw invalidResponse("The template list exceeds its reported total");
        }
        if (allItems.length >= result.total) {
            return allItems;
        }

        if (result.items.length === 0) {
            throw invalidResponse("The template list ended before all items loaded");
        }
    }

    throw invalidResponse("The template list has too many pages");
}

function isTemplateCreateRequest(
    value: unknown
): value is DigiwiseTemplateCreateRequest {
    if (!isRecord(value) || !isRecord(value.template)) {
        return false;
    }
    const { template } = value;
    return (
        typeof template.id === "string" &&
        template.id.length > 0 &&
        template.id.length <= 64 &&
        typeof template.version === "string" &&
        template.version.length > 0 &&
        template.version.length <= 64 &&
        Number.isSafeInteger(template.fileSize) &&
        (template.fileSize as number) > 0 &&
        typeof template.sha256 === "string" &&
        /^[a-fA-F0-9]{64}$/.test(template.sha256) &&
        (template.fileFormat === "eez-project" ||
            template.fileFormat === "zip") &&
        typeof value.projectName === "string" &&
        typeof value.targetDirectory === "string" &&
        value.targetDirectory.length > 0 &&
        typeof value.createDirectory === "boolean"
    );
}

function validateProjectName(name: string) {
    const trimmed = name.trim();
    const reservedWindowsName =
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(trimmed);
    if (
        !trimmed ||
        trimmed !== name ||
        trimmed === "." ||
        trimmed === ".." ||
        /[<>:"/\\|?*\x00-\x1f]/.test(trimmed) ||
        /[. ]$/.test(trimmed) ||
        reservedWindowsName ||
        path.basename(trimmed) !== trimmed
    ) {
        throw templateError("INVALID_REQUEST", "Invalid project name");
    }
    return trimmed;
}

function isAllowedDownloadProtocol(url: URL) {
    if (url.protocol === "https:") return true;
    return (
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" ||
            url.hostname === "localhost" ||
            url.hostname === "::1")
    );
}

function validateTemplateDownload(
    value: unknown,
    input: DigiwiseTemplateCreateRequest
) {
    if (!isRecord(value)) {
        throw invalidResponse("The template download response is invalid");
    }
    const download = value as unknown as DigiwiseTemplateDownload;
    let downloadUrl: URL | undefined;
    try {
        downloadUrl = new URL(download.downloadUrl);
    } catch (_error) {
        // Report the same contract error as other malformed download metadata.
    }

    if (
        typeof download.templateId !== "string" ||
        download.templateId !== input.template.id ||
        typeof download.version !== "string" ||
        download.version !== input.template.version ||
        !Number.isSafeInteger(download.fileSize) ||
        download.fileSize !== input.template.fileSize ||
        download.fileSize > MAX_TEMPLATE_FILE_SIZE ||
        typeof download.sha256 !== "string" ||
        download.sha256.toLowerCase() !== input.template.sha256.toLowerCase() ||
        download.fileFormat !== input.template.fileFormat ||
        typeof download.fileName !== "string" ||
        !download.fileName ||
        typeof download.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(download.expiresAt)) ||
        Date.parse(download.expiresAt) <= Date.now() ||
        !downloadUrl ||
        !isAllowedDownloadProtocol(downloadUrl) ||
        downloadUrl.username ||
        downloadUrl.password
    ) {
        throw invalidResponse("The template download response is invalid");
    }
    return { downloadUrl, download };
}

async function downloadTemplateFile(
    url: URL,
    expectedSize: number,
    onProgress: (progress: DigiwiseTemplateCreateProgress) => void
) {
    let currentUrl = url;
    let response: Response | undefined;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
        if (!isAllowedDownloadProtocol(currentUrl)) {
            throw templateError(
                "TEMPLATE_DOWNLOAD_FAILED",
                "The template download URL must use HTTPS",
                502
            );
        }
        try {
            response = await fetch(currentUrl, {
                method: "GET",
                headers: { Accept: "application/octet-stream" },
                redirect: "manual"
            });
        } catch (_error) {
            throw templateError(
                "TEMPLATE_DOWNLOAD_FAILED",
                "The template file could not be downloaded",
                502
            );
        }

        if (response.status < 300 || response.status >= 400) {
            break;
        }
        const location = response.headers.get("location");
        if (!location || redirectCount === 3) {
            throw templateError(
                "TEMPLATE_DOWNLOAD_FAILED",
                "The template download redirect is invalid",
                502
            );
        }
        try {
            currentUrl = new URL(location, currentUrl);
        } catch (_error) {
            throw templateError(
                "TEMPLATE_DOWNLOAD_FAILED",
                "The template download redirect is invalid",
                502
            );
        }
    }

    if (!response || !response.ok || !response.body) {
        throw templateError(
            "TEMPLATE_DOWNLOAD_FAILED",
            "The template file could not be downloaded",
            502
        );
    }
    if (response.url) {
        try {
            if (!isAllowedDownloadProtocol(new URL(response.url))) {
                throw new Error("Insecure final URL");
            }
        } catch (_error) {
            throw templateError(
                "TEMPLATE_DOWNLOAD_FAILED",
                "The template download did not remain on HTTPS",
                502
            );
        }
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_TEMPLATE_FILE_SIZE
    ) {
        throw templateError(
            "TEMPLATE_FILE_TOO_LARGE",
            "The template file exceeds the allowed size",
            413
        );
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    onProgress({
        stage: "downloading",
        receivedBytes: 0,
        totalBytes: expectedSize
    });
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (!value) {
                continue;
            }
            received += value.byteLength;
            if (received > MAX_TEMPLATE_FILE_SIZE) {
                await reader.cancel();
                throw templateError(
                    "TEMPLATE_FILE_TOO_LARGE",
                    "The template file exceeds the allowed size",
                    413
                );
            }
            chunks.push(Buffer.from(value));
            onProgress({
                stage: "downloading",
                receivedBytes: received,
                totalBytes: expectedSize
            });
        }
    } catch (error) {
        if (error instanceof DigiwisePublicApiError) {
            throw error;
        }
        throw templateError(
            "TEMPLATE_DOWNLOAD_FAILED",
            "The template file download was interrupted",
            502
        );
    }

    if (received !== expectedSize) {
        throw templateError(
            "TEMPLATE_FILE_INTEGRITY_FAILED",
            "The downloaded template size does not match its metadata",
            502
        );
    }
    return Buffer.concat(chunks, received);
}

function verifyTemplateBytes(
    fileData: Buffer,
    expectedSha256: string,
    fileFormat: "eez-project" | "zip"
) {
    const actualSha256 = createHash("sha256")
        .update(fileData)
        .digest("hex");
    if (actualSha256 !== expectedSha256.toLowerCase()) {
        throw templateError(
            "TEMPLATE_FILE_INTEGRITY_FAILED",
            "The downloaded template checksum does not match",
            502
        );
    }

    if (fileFormat === "eez-project") {
        try {
            const project = JSON.parse(fileData.toString("utf8"));
            if (!isRecord(project)) {
                throw new Error("Invalid project document");
            }
        } catch (_error) {
            throw templateError(
                "TEMPLATE_FILE_INVALID",
                "The downloaded project template is invalid",
                422
            );
        }
    }
}

function validateArchivePath(entryName: string, stageDirectory: string) {
    const normalized = entryName.replace(/\\/g, "/");
    if (
        !normalized ||
        normalized.startsWith("/") ||
        /^[a-zA-Z]:/.test(normalized) ||
        normalized.includes("\0")
    ) {
        throw templateError(
            "TEMPLATE_ARCHIVE_INVALID",
            "The template archive contains an unsafe path",
            422
        );
    }

    const rawSegments = normalized.split("/");
    if (
        rawSegments.some(
            (segment, index) =>
                !segment && index < rawSegments.length - 1
        )
    ) {
        throw templateError(
            "TEMPLATE_ARCHIVE_INVALID",
            "The template archive contains an unsafe path",
            422
        );
    }
    const segments = rawSegments.filter(Boolean);
    if (
        segments.some(
            segment =>
                segment === "." ||
                segment === ".." ||
                /[<>:"|?*\x00-\x1f]/.test(segment) ||
                /[. ]$/.test(segment) ||
                /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(
                    segment
                )
        )
    ) {
        throw templateError(
            "TEMPLATE_ARCHIVE_INVALID",
            "The template archive contains an unsafe path",
            422
        );
    }

    const relativePath = segments.join(path.sep);
    const destination = path.resolve(stageDirectory, relativePath);
    if (
        destination !== stageDirectory &&
        !destination.startsWith(stageDirectory + path.sep)
    ) {
        throw templateError(
            "TEMPLATE_ARCHIVE_INVALID",
            "The template archive contains an unsafe path",
            422
        );
    }
    return { relativePath, destination };
}

async function extractTemplateArchive(
    archiveBuffer: Buffer,
    stageDirectory: string
) {
    const { default: AdmZip } = await import("adm-zip");
    let zip: InstanceType<typeof AdmZip>;
    try {
        zip = new AdmZip(archiveBuffer);
    } catch (_error) {
        throw templateError(
            "TEMPLATE_ARCHIVE_INVALID",
            "The template archive is invalid",
            422
        );
    }

    const entries = zip.getEntries();
    if (!entries.length || entries.length > MAX_ARCHIVE_ENTRIES) {
        throw templateError(
            "TEMPLATE_ARCHIVE_INVALID",
            "The template archive contains an invalid number of files",
            422
        );
    }

    const seenPaths = new Set<string>();
    const projectFiles: string[] = [];
    let expandedSize = 0;

    for (const entry of entries) {
        const { relativePath, destination } = validateArchivePath(
            entry.entryName,
            stageDirectory
        );
        const normalizedKey = relativePath.toLowerCase();
        if (seenPaths.has(normalizedKey)) {
            throw templateError(
                "TEMPLATE_ARCHIVE_INVALID",
                "The template archive contains duplicate paths",
                422
            );
        }
        seenPaths.add(normalizedKey);

        const unixMode = (entry.attr >>> 16) & 0xffff;
        const unixType = unixMode & 0o170000;
        if (unixType === 0o120000 || (unixMode & 0o111) !== 0) {
            throw templateError(
                "TEMPLATE_ARCHIVE_INVALID",
                "The template archive contains a link or executable file",
                422
            );
        }
        if (entry.header.encrypted) {
            throw templateError(
                "TEMPLATE_ARCHIVE_INVALID",
                "Encrypted template archives are not supported",
                422
            );
        }

        const lowerPath = relativePath.toLowerCase();
        if (
            !entry.isDirectory &&
            /\.(?:js|mjs|cjs|bat|cmd|com|exe|scr|ps1|psm1|sh|bash|zsh|vbs|vbe|jse|wsf|wsh|dll|so|dylib|sys)$/i.test(
                lowerPath
            )
        ) {
            throw templateError(
                "TEMPLATE_ARCHIVE_INVALID",
                "The template archive contains an executable script or binary",
                422
            );
        }

        if (entry.isDirectory) {
            await fs.promises.mkdir(destination, { recursive: true });
            continue;
        }

        const declaredSize = entry.header.size;
        if (
            !Number.isSafeInteger(declaredSize) ||
            declaredSize < 0 ||
            expandedSize + declaredSize > MAX_ARCHIVE_EXPANDED_SIZE
        ) {
            throw templateError(
                "TEMPLATE_ARCHIVE_INVALID",
                "The template archive expands beyond the allowed size",
                422
            );
        }
        expandedSize += declaredSize;

        const data = entry.getData();
        if (data.length !== declaredSize) {
            throw templateError(
                "TEMPLATE_ARCHIVE_INVALID",
                "The template archive contains a corrupt file",
                422
            );
        }
        await fs.promises.mkdir(path.dirname(destination), {
            recursive: true
        });
        await fs.promises.writeFile(destination, data, { flag: "wx" });
        if (lowerPath.endsWith(".eez-project")) {
            projectFiles.push(relativePath);
        }
    }

    if (projectFiles.length !== 1) {
        throw templateError(
            "TEMPLATE_ARCHIVE_INVALID",
            "The template archive must contain exactly one EEZ project",
            422
        );
    }

    const projectFilePath = path.join(stageDirectory, projectFiles[0]);
    try {
        const project = JSON.parse(
            (await fs.promises.readFile(projectFilePath)).toString("utf8")
        );
        if (!isRecord(project)) {
            throw new Error("Invalid project document");
        }
    } catch (_error) {
        throw templateError(
            "TEMPLATE_FILE_INVALID",
            "The archive project file is invalid",
            422
        );
    }
    return projectFiles[0];
}

async function directoryExists(directoryPath: string) {
    try {
        const stat = await fs.promises.lstat(directoryPath);
        return stat.isDirectory() && !stat.isSymbolicLink();
    } catch (error: any) {
        if (error?.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function pathExists(filePath: string) {
    try {
        await fs.promises.lstat(filePath);
        return true;
    } catch (error: any) {
        if (error?.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function createProjectFromTemplate(
    input: DigiwiseTemplateCreateRequest,
    fileData: Buffer,
    projectName: string
) {
    const targetDirectory = path.resolve(input.targetDirectory);
    const parentDirectory = path.dirname(targetDirectory);
    await fs.promises.mkdir(parentDirectory, { recursive: true });

    if (input.template.fileFormat === "eez-project") {
        const projectFileName = `${projectName}.eez-project`;
        if (input.createDirectory) {
            if (await pathExists(targetDirectory)) {
                throw templateError(
                    "TEMPLATE_TARGET_EXISTS",
                    "The selected project folder already exists",
                    409
                );
            }
            const stageDirectory = path.join(
                parentDirectory,
                `.digistudio-template-${randomUUID()}`
            );
            try {
                await fs.promises.mkdir(stageDirectory);
                const stagedProjectPath = path.join(
                    stageDirectory,
                    projectFileName
                );
                await fs.promises.writeFile(stagedProjectPath, fileData, {
                    flag: "wx"
                });
                await fs.promises.rename(stageDirectory, targetDirectory);
            } catch (error) {
                await fs.promises.rm(stageDirectory, {
                    recursive: true,
                    force: true
                });
                throw error;
            }
            return {
                projectFilePath: path.join(targetDirectory, projectFileName),
                projectDirectoryPath: targetDirectory
            };
        }

        await fs.promises.mkdir(targetDirectory, { recursive: true });
        const projectFilePath = path.join(targetDirectory, projectFileName);
        const temporaryPath = `${projectFilePath}.${randomUUID()}.tmp`;
        try {
            await fs.promises.writeFile(temporaryPath, fileData, {
                flag: "wx"
            });
            try {
                await fs.promises.link(temporaryPath, projectFilePath);
            } catch (linkError: any) {
                if (linkError?.code === "EEXIST") {
                    throw linkError;
                }
                if (
                    linkError?.code !== "EPERM" &&
                    linkError?.code !== "ENOTSUP" &&
                    linkError?.code !== "EOPNOTSUPP"
                ) {
                    throw linkError;
                }
                await fs.promises.copyFile(
                    temporaryPath,
                    projectFilePath,
                    fs.constants.COPYFILE_EXCL
                );
            }
            await fs.promises
                .rm(temporaryPath, { force: true })
                .catch(() => undefined);
        } catch (error: any) {
            await fs.promises.rm(temporaryPath, { force: true });
            if (error?.code === "EEXIST") {
                throw templateError(
                    "TEMPLATE_TARGET_EXISTS",
                    "A project file with this name already exists",
                    409
                );
            }
            throw error;
        }
        return { projectFilePath, projectDirectoryPath: targetDirectory };
    }

    const stageDirectory = path.join(
        parentDirectory,
        `.digistudio-template-${randomUUID()}`
    );
    let relativeProjectPath: string;
    try {
        await fs.promises.mkdir(stageDirectory);
        relativeProjectPath = await extractTemplateArchive(
            fileData,
            stageDirectory
        );

        if (input.createDirectory) {
            if (await pathExists(targetDirectory)) {
                throw templateError(
                    "TEMPLATE_TARGET_EXISTS",
                    "The selected project folder already exists",
                    409
                );
            }
            await fs.promises.rename(stageDirectory, targetDirectory);
        } else {
            if (await pathExists(targetDirectory) && !(await directoryExists(targetDirectory))) {
                throw templateError(
                    "TEMPLATE_TARGET_EXISTS",
                    "The selected target path is not a folder",
                    409
                );
            }
            const exists = await directoryExists(targetDirectory);
            if (exists) {
                if ((await fs.promises.readdir(targetDirectory)).length > 0) {
                    throw templateError(
                        "TEMPLATE_TARGET_NOT_EMPTY",
                        "Choose an empty folder for this ZIP template",
                        409
                    );
                }
                const backupDirectory = path.join(
                    parentDirectory,
                    `.digistudio-template-empty-${randomUUID()}`
                );
                await fs.promises.rename(targetDirectory, backupDirectory);
                try {
                    await fs.promises.rename(stageDirectory, targetDirectory);
                } catch (error) {
                    await fs.promises.rename(backupDirectory, targetDirectory);
                    throw error;
                }
                await fs.promises
                    .rm(backupDirectory, { recursive: true, force: true })
                    .catch(() => undefined);
            } else {
                await fs.promises.rename(stageDirectory, targetDirectory);
            }
        }
    } catch (error) {
        await fs.promises.rm(stageDirectory, { recursive: true, force: true });
        throw error;
    }

    return {
        projectFilePath: path.join(targetDirectory, relativeProjectPath),
        projectDirectoryPath: targetDirectory
    };
}

async function createDigiwiseTemplate(
    api: DigiwisePublicApi,
    accessToken: string,
    input: unknown,
    onProgress: (progress: DigiwiseTemplateCreateProgress) => void
) {
    if (!isTemplateCreateRequest(input)) {
        throw templateError("INVALID_REQUEST", "Invalid template create request");
    }
    const projectName = validateProjectName(input.projectName);
    if (
        !path.isAbsolute(input.targetDirectory) ||
        input.targetDirectory.includes("\0")
    ) {
        throw templateError("INVALID_REQUEST", "Invalid target directory");
    }
    if (
        input.template.fileSize > MAX_TEMPLATE_FILE_SIZE ||
        !isTemplateItem({
            id: input.template.id,
            name: "template",
            version: input.template.version,
            projectType: "template",
            fileName:
                input.template.fileFormat === "zip"
                    ? "template.zip"
                    : "template.eez-project",
            fileSize: input.template.fileSize,
            sha256: input.template.sha256,
            fileFormat: input.template.fileFormat,
            publishedAt: new Date(0).toISOString()
        })
    ) {
        throw templateError(
            "INVALID_REQUEST",
            "Invalid template version metadata"
        );
    }

    onProgress({ stage: "authorizing" });
    const download = await api.prepareTemplateDownload(
        accessToken,
        input.template.id,
        input.template.version
    );
    const validatedDownload = validateTemplateDownload(download, input);
    const fileData = await downloadTemplateFile(
        validatedDownload.downloadUrl,
        download.fileSize,
        onProgress
    );
    onProgress({ stage: "verifying" });
    verifyTemplateBytes(
        fileData,
        download.sha256,
        download.fileFormat
    );
    onProgress({ stage: "creating" });
    return createProjectFromTemplate(input, fileData, projectName);
}

export function registerDigiwiseTemplateIpc() {
    if (ipcRegistered) {
        return;
    }
    ipcRegistered = true;

    ipcMain.handle("digistudio:templates:list", () =>
        callDigiwisePublicApiWithSession(listAllTemplates)
    );
    ipcMain.handle(
        "digistudio:templates:create",
        (event, input: unknown) =>
            callDigiwisePublicApiWithSession((api, accessToken) =>
                createDigiwiseTemplate(api, accessToken, input, progress => {
                    if (!event.sender.isDestroyed()) {
                        event.sender.send(
                            "digistudio:templates:create-progress",
                            progress
                        );
                    }
                })
            )
    );
}
