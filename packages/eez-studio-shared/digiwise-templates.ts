export type DigiwiseTemplateFileFormat = "eez-project" | "zip";

export interface DigiwiseTemplateItem {
    id: string;
    name: string;
    description?: string | null;
    category?: string | null;
    coverUrl?: string | null;
    version: string;
    projectType: string;
    lvglVersion?: string | null;
    modelCode?: string | null;
    fileName: string;
    fileSize: number;
    sha256: string;
    fileFormat: DigiwiseTemplateFileFormat;
    publishedAt: string;
}

export interface DigiwiseTemplatePage {
    items: DigiwiseTemplateItem[];
    page: number;
    pageSize: number;
    total: number;
}

export interface DigiwiseTemplateDownload {
    templateId: string;
    version: string;
    downloadUrl: string;
    expiresAt: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    fileFormat: DigiwiseTemplateFileFormat;
}

export interface DigiwiseTemplateCreateRequest {
    template: Pick<
        DigiwiseTemplateItem,
        "id" | "version" | "fileSize" | "sha256" | "fileFormat"
    >;
    projectName: string;
    targetDirectory: string;
    createDirectory: boolean;
}

export interface DigiwiseTemplateCreateResult {
    projectFilePath: string;
    projectDirectoryPath: string;
}

export interface DigiwiseTemplateCreateProgress {
    stage: "authorizing" | "downloading" | "verifying" | "creating";
    receivedBytes?: number;
    totalBytes?: number;
}
