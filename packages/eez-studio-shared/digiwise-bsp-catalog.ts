// These are authorization categories, not the unrelated template categories.
export interface DigiwiseCategory {
    id: number;
    modelCode: string;
    categoryCode: string;
    modelName: string;
    categoryName: string;
    chipFamily: string | null;
    externalId: string | null;
    productType: number | null;
}

export interface DigiwiseBspVersion {
    id: number;
    modelId: number;
    modelCode: string;
    categoryCode: string;
    modelName: string;
    categoryName: string;
    version: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    publishedAt: string | null;
}

export interface DigiwiseBspDownloadMeta {
    bspId?: number;
    modelId?: number;
    downloadUrl: string;
    expiresAt: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    version: string;
    modelCode: string;
    categoryCode: string;
}

export interface DigiwiseInstalledBspRecord {
    bspId: number;
    modelId: number;
    modelCode: string;
    categoryCode: string;
    version: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    installPath: string;
    installedAt: string;
}

export interface DigiwiseBspDownloadProgress {
    bspId: number;
    stage: "requesting" | "downloading" | "verifying" | "extracting" | "completed";
    receivedBytes: number;
    totalBytes: number;
}
