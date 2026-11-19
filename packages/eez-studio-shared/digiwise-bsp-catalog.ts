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
