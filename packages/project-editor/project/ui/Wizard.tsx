import { dialog, getCurrentWindow } from "@electron/remote";
import fs from "fs";
import { marked } from "marked";
import { rmdir } from "fs/promises";
import path from "path";
import React from "react";
import ReactDOM from "react-dom";
import { SimpleGitProgressEvent } from "simple-git";
import classNames from "classnames";
import {
    action,
    reaction,
    observable,
    runInAction,
    makeObservable,
    computed,
    IReactionDisposer,
    IObservableValue,
    autorun
} from "mobx";
import { observer } from "mobx-react";

import {
    fetchUrlOrReadFromCache,
    getHomePath,
    readJsObjectFromFile
} from "eez-studio-shared/util-electron";
import { guid } from "eez-studio-shared/guid";
import { stringCompare } from "eez-studio-shared/string";

import { showDialog } from "eez-studio-ui/dialog";
import { Loader } from "eez-studio-ui/loader";
import { ITreeNode, Tree } from "eez-studio-ui/tree";
import { SearchInput } from "eez-studio-ui/search-input";
import { Icon } from "eez-studio-ui/icon";

import { openProject } from "home/tabs-store";
import { settingsController } from "home/settings";
import {
    createDigiwiseTemplate,
    listDigiwiseTemplates
} from "home/digiwise-templates";
import { productConfig } from "eez-studio-shared/product-config";
import { resolveProjectTemplateFile } from "eez-studio-shared/project-templates";
import type { DigiwiseTemplateItem } from "eez-studio-shared/digiwise-templates";

import {
    DASHBOARD_PROJECT_ICON,
    EEZ_GUI_PROJECT_ICON,
    LVGL_PROJECT_ICON,
    LVGL_WITH_FLOW_PROJECT_ICON,
    MICROPYTHON_ICON,
    APPLET_ICON,
    IEXT_PROJECT_ICON,
    EEZ_GUI_LITE_PROJECT_ICON
} from "project-editor/ui-components/icons";
import {
    EEZ_PROJECT_EXAMPLES_REPOSITORY,
    examplesCatalog
} from "project-editor/store/examples-catalog";

import {
    LVGLVersion,
    PROJECT_TYPE_NAMES,
    ProjectType
} from "project-editor/project/project";
import { ButtonAction } from "eez-studio-ui/action";
import type { CommandsProtocolType } from "eez-studio-shared/extensions/extension";
import { compareVersions } from "eez-studio-shared/util";

// from https://envox.eu/gitea
interface TemplateProject {
    clone_url: string;
    html_url: string;

    full_name: string;
    name: string;

    _image_url: string;

    _projectType: string;
    _description: string;
    _keywords?: string;
    _displayWidth?: number;
    _displayHeight?: number;
    _targetPlatform?: string;
    _targetPlatformLink?: string;
}

export interface ExampleProject {
    repository: string;
    eezProjectPath: string;
    folder: string;
    projectName: string;

    projectType: string;
    description: string;
    image: string;
    keywords: string;
    displayWidth?: number;
    displayHeight?: number;
    targetPlatform?: string;
    targetPlatformLink?: string;
    author?: string;
    authorLink?: string;
    minStudioVersion?: string;
    resourceFiles: string[];
}

interface IProjectType {
    id: string;

    repository?: string;
    eezProjectPath?: string;
    folder?: string;

    projectName: string;
    defaultProjectName?: string;

    projectType: string;
    description: string;
    image: React.ReactNode;
    keywords?: string;
    displayWidth?: number;
    displayHeight?: number;
    targetPlatform?: string;
    targetPlatformLink?: string;
    language?: string;
    resourceFiles?: string[];
    projectFileUrl?:
        | string
        | { "8.4.0": string; "9.2.2": string; "9.3.0": string; "9.4.0": string; "9.5.0": string; }
        | { SCPI: string; PROPRIETARY: string };

    templateCategory?: string;
    remoteTemplate?: DigiwiseTemplateItem;

    author?: string;
    authorLink?: string;
}

// Built-in templates ship with DigiStudio and work without Git/network.
// Users can override them explicitly in Settings > Project Templates.
function getTemplatePathOrUrl(relativePath: string): string {
    return resolveProjectTemplateFile(
        relativePath,
        settingsController.useLocalTemplates
            ? settingsController.localTemplatesPath
            : undefined
    );
}

async function loadTemplateFile(
    pathOrUrl: string,
    resultType: "json" | "buffer"
): Promise<any> {
    // Explicitly selected online Examples may still provide a URL.
    // The standard New Project templates never use this path.
    if (/^https?:\/\//.test(pathOrUrl)) {
        return fetchUrlOrReadFromCache(pathOrUrl, resultType);
    }
    if (!fs.existsSync(pathOrUrl)) {
        throw new Error(
            "Local project template not found: " + pathOrUrl +
            ". Reinstall DigiStudio or choose a valid templates folder in Settings."
        );
    }
    if (resultType === "json") {
        return readJsObjectFromFile(pathOrUrl);
    }
    return fs.promises.readFile(pathOrUrl);
}

const SAVED_OPTIONS_VERSION = 12;

enum SaveOptionsFlags {
    All,
    View
}

export function getBoardPreviewUrl(previewFile: string): string {
    const absPath = path.resolve(__dirname, "../../../home/_images", previewFile);
    if (fs.existsSync(absPath)) {
        return "file:///" + absPath.replace(/\\/g, "/");
    }
    return "";
}

export function renderPreviewImage(image: React.ReactNode | string | undefined, className?: string) {
    if (!image) {
        return <div className="preview-placeholder" />;
    }
    if (typeof image === "string") {
        let src = image;
        if (src.startsWith("boards/")) {
            src = getBoardPreviewUrl(src);
        }
        return (
            <img
                src={src}
                className={className}
                alt="preview"
                onError={event => {
                    event.currentTarget.style.display = "none";
                }}
            />
        );
    }
    if (React.isValidElement(image)) {
        return image;
    }
    return <Icon icon={image as any} size={128} />;
}

function normalizeRemoteTemplateCategory(category: string | null): string | undefined {
    const normalized = category?.trim().toLowerCase().replace(/[ _-]/g, "");
    if (
        normalized === "emptyui" ||
        normalized === "blankui" ||
        normalized === "blank" ||
        normalized === "空白界面"
    ) {
        return "EmptyUI";
    }
    if (normalized === "flow" || normalized === "流程") {
        return "Flow";
    }
    if (normalized === "widget" || normalized === "control" || normalized === "控件") {
        return "Widget";
    }
    if (normalized === "application" || normalized === "app" || normalized === "应用") {
        return "Application";
    }
    return undefined;
}

export function getTemplateCategory(p: IProjectType): string {
    if (p.templateCategory) return p.templateCategory;
    if (p.id === "LVGL" || p.projectName === "EmptyUI") return "EmptyUI";
    if (p.id === "LVGL with EEZ Flow") return "Flow";
    if (p.id === "IEXT" || p.id === "applet" || p.id === "resource") return "Widget";
    return "Application";
}

function isTemplatePermissionError(code: string) {
    return code === "ACCESS_DENIED" || code === "HTTP_403";
}

function getTemplateCategoryLabel(category: string, isChinese: boolean) {
    const labels = isChinese
        ? { All: "全部", EmptyUI: "空白界面", Application: "应用", Flow: "流程", Widget: "控件" }
        : { All: "All", EmptyUI: "Empty UI", Application: "Application", Flow: "Flow", Widget: "Widget" };
    return labels[category as keyof typeof labels] || category;
}

export class WizardModel {
    section: "templates" | "examples" = "templates";
    folder: string | undefined = "_allTemplates";
    type: string | undefined = "dashboard";

    static makeTemplatesWizardModel() {
        const wizardModel = new WizardModel();

        wizardModel.section = "templates";
        wizardModel.folder = "_allTemplates";
        wizardModel.type = "dashboard";

        wizardModel.location = getHomePath("eez-projects");

        return wizardModel;
    }

    static makeExamplesWizardModel() {
        const wizardModel = new WizardModel();

        wizardModel.section = "examples";
        wizardModel.folder = "_allExamples";
        wizardModel.type = undefined;

        wizardModel.location = getHomePath(
            "eez-projects" + path.sep + "examples"
        );

        return wizardModel;
    }

    _name: string | undefined;
    get name() {
        if (this._name != undefined) {
            return this._name;
        }

        return this.selectedProjectType
            ? this.selectedProjectType.defaultProjectName
            : undefined;
    }
    set name(value: string | undefined) {
        runInAction(() => {
            this._name = value;
        });
    }

    nameError: string | undefined;

    location: string | undefined = getHomePath("eez-projects");
    locationError: string | undefined;

    createDirectory: boolean = true;

    bb3ProjectOption: "bundled" | "local" = "bundled";
    bb3ProjectFileDownloadError: string | undefined;
    bb3ProjectFile: string | undefined;
    bb3ProjectFileError: string | undefined;

    projectVersion: string = "v3";

    createProjectInProgress: boolean = false;

    templateProjects: TemplateProject[] = [];
    digiwiseTemplates: DigiwiseTemplateItem[] = [];
    templateListLoading = false;
    templateListError: string | undefined;
    private templateListRequestId = 0;

    projectCreationError: React.ReactNode | undefined;

    gitClone: boolean = true;
    gitInit: boolean = true;

    progress: string = "";

    searchText: string = "";

    dispose1: IReactionDisposer;
    dispose2: IReactionDisposer;

    lastOptions: {
        location: string | undefined;
        createDirectory: boolean;
        bb3ProjectOption: "bundled" | "local";
        bb3ProjectFile: string | undefined;
        projectVersion: string;
        gitClone: boolean;
        gitInit: boolean;
        lvglVersion: string;
        commandsProtocol: string;
    };

    lvglVersion: LVGLVersion = "8.4.0";
    displayWidth: number = 800;
    displayHeight: number = 480;
    colorDepth: string = "16";

    commandsProtocol: CommandsProtocolType;

    constructor() {
        makeObservable(this, {
            createProjectInProgress: observable,
            section: observable,
            folder: observable,
            type: observable,
            _name: observable,
            nameError: observable,
            location: observable,
            locationError: observable,
            createDirectory: observable,
            bb3ProjectOption: observable,
            bb3ProjectFileDownloadError: observable,
            bb3ProjectFile: observable,
            bb3ProjectFileError: observable,
            projectVersion: observable,
            templateProjects: observable,
            digiwiseTemplates: observable,
            templateListLoading: observable,
            templateListError: observable,
            projectCreationError: observable,
            gitClone: observable,
            gitInit: observable,
            lvglVersion: observable,
            displayWidth: observable,
            displayHeight: observable,
            colorDepth: observable,
            commandsProtocol: observable,
            selectedTemplateProject: computed,
            validateName: action,
            validateLocation: action,
            validateBB3ProjectFile: action,
            progress: observable,
            searchText: observable,
            onSearchChange: action.bound,
            standardProjectTypes: computed,
            bb3ProjectTypes: computed,
            templateProjectTypes: computed,
            allTemplateProjectTypes: computed,
            changeFolder: action.bound,
            changeType: action.bound,
            exampleProjectTypes: computed,
            exampleFolders: computed,
            projectTypes: computed,
            selectedProjectType: computed
        });

        this.loadOptions();

        if (
            this.section == "examples" &&
            productConfig.examplesCatalog.enabled
        ) {
            examplesCatalog.onNewCatalog = () => {
                if (this.exampleProjectTypes.get("_newExamples")!.length > 0) {
                    runInAction(() => {
                        this.folder = "_newExamples";
                        this.type = this.projectTypes[0].id;
                    });
                }
            };
        }
    }

    loadOptions() {
        const optionsJSON = window.localStorage.getItem(
            "project-wizard-" + this.section
        );
        if (optionsJSON) {
            try {
                const options = JSON.parse(optionsJSON);
                if (options.version == SAVED_OPTIONS_VERSION) {
                    const examplesDisabled =
                        options.section == "examples" &&
                        !productConfig.examplesCatalog.enabled;

                    this.section = examplesDisabled
                        ? "templates"
                        : options.section;
                    this.folder = examplesDisabled
                        ? "_allTemplates"
                        : options.folder;
                    this.type = examplesDisabled ? "dashboard" : options.type;

                    this.location = examplesDisabled
                        ? getHomePath("eez-projects")
                        : options.location;
                    this.createDirectory = options.createDirectory;
                    this.bb3ProjectOption = options.bb3ProjectOption == "local" ? "local" : "bundled";
                    this.bb3ProjectFile = options.bb3ProjectFile;
                    this.projectVersion = options.projectVersion;
                    this.gitClone = options.gitClone;
                    this.gitInit = options.gitInit;
                    this.lvglVersion = options.lvglVersion ?? "8.4.0";
                    this.commandsProtocol = options.commandsProtocol ?? "SCPI";
                }
            } catch (err) {
                console.error(err);
            }
        }

        this.lastOptions = {
            location: this.location,
            createDirectory: this.createDirectory,
            bb3ProjectOption: this.bb3ProjectOption,
            bb3ProjectFile: this.bb3ProjectFile,
            projectVersion: this.projectVersion,
            gitClone: this.gitClone,
            gitInit: this.gitInit,
            lvglVersion: this.lvglVersion,
            commandsProtocol: this.commandsProtocol
        };
    }

    saveOptions(flags: SaveOptionsFlags) {
        if (flags == SaveOptionsFlags.All) {
            window.localStorage.setItem(
                "project-wizard-" + this.section,
                JSON.stringify({
                    version: SAVED_OPTIONS_VERSION,

                    section: this.section,
                    type: this.type,
                    folder: this.folder,

                    location: this.location,
                    createDirectory: this.createDirectory,
                    bb3ProjectOption: this.bb3ProjectOption,
                    bb3ProjectFile: this.bb3ProjectFile,
                    projectVersion: this.projectVersion,
                    gitClone: this.gitClone,
                    gitInit: this.gitInit,
                    lvglVersion: this.lvglVersion,
                    commandsProtocol: this.commandsProtocol
                })
            );

            this.lastOptions = {
                location: this.location,
                createDirectory: this.createDirectory,
                bb3ProjectOption: this.bb3ProjectOption,
                bb3ProjectFile: this.bb3ProjectFile,
                projectVersion: this.projectVersion,
                gitClone: this.gitClone,
                gitInit: this.gitInit,
                lvglVersion: this.lvglVersion,
                commandsProtocol: this.commandsProtocol
            };
        } else {
            window.localStorage.setItem(
                "project-wizard",
                JSON.stringify({
                    version: SAVED_OPTIONS_VERSION,

                    section: this.section,
                    type: this.type,
                    folder: this.folder,

                    location: this.lastOptions.location,
                    createDirectory: this.lastOptions.createDirectory,
                    bb3ProjectOption: this.lastOptions.bb3ProjectOption,
                    bb3ProjectFile: this.lastOptions.bb3ProjectFile,
                    projectVersion: this.lastOptions.projectVersion,
                    gitClone: this.lastOptions.gitClone,
                    gitInit: this.lastOptions.gitInit,

                    lvglVersion: this.lastOptions.lvglVersion,

                    commandsProtocol: this.lastOptions.commandsProtocol
                })
            );
        }
    }

    async fetchTemplateProjects() {
        if (!productConfig.projectTemplates.onlineCatalog.enabled) {
            return;
        }

        const result = await fetch(
            productConfig.projectTemplates.onlineCatalog.searchUrl
        );
        const data = await result.json();
        const templateProjects = data.data.map(
            (templateProject: TemplateProject) =>
                Object.assign({}, templateProject, {
                    _image_url:
                        templateProject.html_url +
                        "/raw/branch/master/template/image.png"
                })
        );

        runInAction(() => {
            for (const templateProject of this.templateProjects) {
                templateProject._projectType = "";
            }

            this.templateProjects = templateProjects;
        });

        for (const templateProject of this.templateProjects) {
            try {
                const manifestJsonUrl =
                    templateProject.html_url +
                    "/raw/branch/master/template/manifest.json";

                const manifestJson = await (
                    await fetch(manifestJsonUrl)
                ).json();

                const eezProjectUrl =
                    templateProject.html_url +
                    "/raw/branch/master/" +
                    manifestJson["eez-project-path"].replace(
                        "{{projectName}}",
                        templateProject.name
                    );

                const eezProjectJson = await (
                    await fetch(eezProjectUrl, { cache: "no-store" })
                ).json();

                const general = eezProjectJson.settings?.general;

                if (general) {
                    runInAction(() => {
                        templateProject._projectType =
                            PROJECT_TYPE_NAMES[
                                general.projectType as ProjectType
                            ];
                        templateProject._description = general.description;
                        templateProject._keywords = general.keywords;
                        templateProject._displayWidth = general.displayWidth;
                        templateProject._displayHeight = general.displayHeight;
                        templateProject._targetPlatform =
                            general.targetPlatform;
                        templateProject._targetPlatformLink =
                            general.targetPlatformLink;
                    });
                }
            } catch (err) {
                console.error(err);
            }
        }
    }

    async loadDigiwiseTemplates() {
        const requestId = ++this.templateListRequestId;
        runInAction(() => {
            this.templateListLoading = true;
            this.templateListError = undefined;
            this.digiwiseTemplates = [];
        });

        try {
            const result = await listDigiwiseTemplates();
            if (requestId !== this.templateListRequestId) {
                return;
            }

            if (!result.ok) {
                runInAction(() => {
                    // Remote template access is optional. Keep the bundled
                    // empty LVGL project available when the account has no
                    // permission to read the remote catalog.
                    this.templateListError = isTemplatePermissionError(
                        result.error.code
                    )
                        ? undefined
                        : result.error.code;
                    this.type = this.blankTemplateProjectType?.id;
                });
                return;
            }

            runInAction(() => {
                this.digiwiseTemplates = result.data;
                if (!this.projectTypes.some(item => item.id === this.type)) {
                    this.type = this.projectTypes[0]?.id;
                }
            });
        } catch (_error) {
            if (requestId === this.templateListRequestId) {
                runInAction(() => {
                    this.templateListError = "PUBLIC_API_UNAVAILABLE";
                });
            }
        } finally {
            if (requestId === this.templateListRequestId) {
                runInAction(() => {
                    this.templateListLoading = false;
                });
            }
        }
    }

    mount() {
        runInAction(() => {
            this.name = undefined;
            this.nameError = undefined;
            this.locationError = undefined;
            this.bb3ProjectFileDownloadError = undefined;
            this.bb3ProjectFileError = undefined;

            this.createProjectInProgress = false;
            this.projectCreationError = undefined;
            this.progress = "";

            this.searchText = "";
        });

        if (this.section == "templates") {
            void this.loadDigiwiseTemplates();
        }

        if (
            this.section == "examples" &&
            productConfig.examplesCatalog.enabled
        ) {
            examplesCatalog.load();
        }

        this.dispose1 = reaction(
            () => ({
                name: this.name,
                location: this.location,
                bb3ProjectFile: this.bb3ProjectFile
            }),
            () => {
                if (this.nameError) {
                    this.validateName();
                }
                if (this.locationError) {
                    this.validateLocation();
                }
                if (this.bb3ProjectFileError) {
                    this.validateBB3ProjectFile();
                }
            }
        );

        this.dispose2 = autorun(() => this.saveOptions(SaveOptionsFlags.View));
    }

    unmount() {
        this.dispose1();
        this.dispose2();
    }

    get exampleProjectTypes() {
        const map = new Map<string, IProjectType[]>();

        const _allExamples: IProjectType[] = [];
        map.set("_allExamples", _allExamples);

        const _newExamples: IProjectType[] = [];
        map.set("_newExamples", _newExamples);

        if (!productConfig.examplesCatalog.enabled) {
            return map;
        }

        const packageJSON: {
            version: string;
        } = require("../../../../package.json");

        const examples = examplesCatalog.catalog
            .slice()
            .filter(
                example =>
                    !example.minStudioVersion ||
                    compareVersions(
                        packageJSON.version,
                        example.minStudioVersion
                    ) >= 0
            )
            .sort((a, b) => stringCompare(a.projectName, b.projectName));

        examples.forEach(example => {
            const eezProjectDownloadUrl =
                example.repository.replace(
                    "github.com",
                    "raw.githubusercontent.com"
                ) +
                "/master/" +
                example.eezProjectPath;

            const projectType: IProjectType = {
                id: eezProjectDownloadUrl,
                repository: example.repository,
                eezProjectPath: example.eezProjectPath,
                folder: example.folder,
                projectType:
                    PROJECT_TYPE_NAMES[example.projectType as ProjectType],
                defaultProjectName: example.projectName,
                projectName: example.projectName,
                description: example.description,
                image: example.image,
                keywords: example.keywords,
                displayWidth: example.displayWidth,
                displayHeight: example.displayHeight,
                targetPlatform: example.targetPlatform,
                targetPlatformLink: example.targetPlatformLink,
                resourceFiles: example.resourceFiles,
                author: example.author,
                authorLink: example.authorLink
            };

            if (!this.searchFilter(projectType)) {
                return;
            }

            const folderId = "_example_" + example.folder;

            let projectTypes = map.get(folderId);
            if (!projectTypes) {
                projectTypes = [];
                map.set(folderId, projectTypes);
            }
            projectTypes.push(projectType);

            _allExamples.push(projectType);

            if (
                !examplesCatalog.catalogAtStart.find(exampleAtStart => {
                    const eezProjectDownloadUrlAtStart =
                        exampleAtStart.repository.replace(
                            "github.com",
                            "raw.githubusercontent.com"
                        ) +
                        "/master/" +
                        exampleAtStart.eezProjectPath;

                    return (
                        eezProjectDownloadUrlAtStart == eezProjectDownloadUrl
                    );
                })
            ) {
                _newExamples.push(projectType);
            }
        });

        return map;
    }

    get exampleFolders(): ITreeNode {
        const rootNode: ITreeNode = {
            id: "_root",
            label: "Root",
            children: [],
            selected: false,
            expanded: true
        };

        if (this.exampleProjectTypes.get("_newExamples")!.length > 0) {
            rootNode.children.push({
                id: "_newExamples",
                label: "New Examples",
                children: [],
                selected: this.folder == "_newExamples",
                expanded: true
            });
        }

        rootNode.children.push({
            id: "_allExamples",
            label: "All Examples",
            children: [],
            selected: this.folder == "_allExamples",
            expanded: true
        });

        this.exampleProjectTypes.get("_allExamples")!.forEach(example => {
            const parts = example.folder!.split("/");

            let nodes = rootNode.children;
            let id = "_example_";

            for (const part of parts) {
                const childNodeId = id + part;

                let childNode = nodes.find(
                    childNode => childNode.id == childNodeId
                );

                if (!childNode) {
                    childNode = {
                        id: childNodeId,
                        label: part,
                        children: [],
                        selected: this.folder == childNodeId,
                        expanded: true
                    };

                    nodes.push(childNode);
                }

                nodes = childNode.children;
                id = childNodeId + "/";
            }
        });

        const exampleProjectTypes = this.exampleProjectTypes;

        function sortChildren(node: ITreeNode) {
            node.children.sort((a, b) => {
                if (a.id == "_newExamples") {
                    return -1;
                }
                if (b.id == "_newExamples") {
                    return 1;
                }

                if (a.id == "_allExamples") {
                    return -1;
                }
                if (b.id == "_allExamples") {
                    return 1;
                }

                return stringCompare(a.label as string, b.label as string);
            });

            const toRemove = [];

            for (const child of node.children) {
                const projectTypes = exampleProjectTypes.get(child.id);
                if (projectTypes) {
                    if (projectTypes.length == 0) {
                        toRemove.push(child);
                        continue;
                    }
                    child.label = (
                        <Count
                            label={child.label as string}
                            count={projectTypes.length}
                            attention={child.id == "_newExamples"}
                        />
                    );
                }

                sortChildren(child);
            }

            for (const child of toRemove) {
                node.children.splice(node.children.indexOf(child), 1);
            }
        }

        sortChildren(rootNode);

        return rootNode;
    }

    get standardProjectTypes(): IProjectType[] {
        return [
            {
                id: "dashboard",
                projectType: PROJECT_TYPE_NAMES[ProjectType.DASHBOARD],
                image: DASHBOARD_PROJECT_ICON(128),
                projectName: "Dashboard",
                description:
                    "Start your new Dashboard project development here.",
                projectFileUrl: getTemplatePathOrUrl(
                    "templates/dashboard.eez-project"
                )
            },
            {
                id: "firmware",
                projectType: PROJECT_TYPE_NAMES[ProjectType.FIRMWARE],
                image: EEZ_GUI_PROJECT_ICON(128),
                projectName: "EEZ-GUI",
                description: "Start your new EEZ-GUI project development here.",
                projectFileUrl: getTemplatePathOrUrl(
                    "templates/firmware.eez-project"
                )
            },
            {
                id: "LVGL",
                projectType: PROJECT_TYPE_NAMES[ProjectType.LVGL],
                image: fs.existsSync(path.resolve(__dirname, "../../../home/_images/boards/emptyui.png")) ? "boards/emptyui.png" : LVGL_PROJECT_ICON(128),
                projectName: "EmptyUI",
                defaultProjectName: "EmptyUI",
                displayWidth: 800,
                displayHeight: 480,
                description: "An empty LVGL user interface template.",
                projectFileUrl: {
                    "8.4.0": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL-8.3.eez-project"
                    ),
                    "9.2.2": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL-9.0.eez-project"
                    ),
                    "9.3.0": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL-9.0.eez-project"
                    ),
                    "9.4.0": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL-9.0.eez-project"
                    ),
                    "9.5.0": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL-9.0.eez-project"
                    )
                }
            },
            {
                id: "digiride",
                projectType: PROJECT_TYPE_NAMES[ProjectType.LVGL],
                image: "boards/digiride.png",
                projectName: "DigiRide",
                defaultProjectName: "DigiRide",
                displayWidth: 800,
                displayHeight: 480,
                description: "Smart Riding Console dashboard with interactive speed, battery, distance & GPS navigation.",
                projectFileUrl: path.resolve(__dirname, "../../../home/product-projects/DigiRide.eez-project")
            },
            {
                id: "LVGL with EEZ Flow",
                projectType: PROJECT_TYPE_NAMES[ProjectType.LVGL],
                image: LVGL_WITH_FLOW_PROJECT_ICON(128),
                projectName: "LVGL with EEZ Flow",
                description:
                    "Start your new LVGL with EEZ Flow project development here.",
                projectFileUrl: {
                    "8.4.0": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL with EEZ Flow-8.3.eez-project"
                    ),
                    "9.2.2": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL with EEZ Flow-9.0.eez-project"
                    ),
                    "9.3.0": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL with EEZ Flow-9.0.eez-project"
                    ),
                    "9.4.0": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL with EEZ Flow-9.0.eez-project"
                    ),
                    "9.5.0": getTemplatePathOrUrl(
                        "templates/v0.23.0/LVGL with EEZ Flow-9.0.eez-project"
                    )
                }
            },
            {
                id: "IEXT",
                projectType: PROJECT_TYPE_NAMES[ProjectType.IEXT],
                image: IEXT_PROJECT_ICON(128),
                projectName: "IEXT",
                description: "Start your new IEXT project development here.",
                projectFileUrl: {
                    SCPI: getTemplatePathOrUrl("templates/IEXT.eez-project"),
                    PROPRIETARY: getTemplatePathOrUrl(
                        "templates/IEXT - PROPRIETARY.eez-project"
                    )
                }
            },
            {
                id: "EEZ-GUI Lite",
                projectType: PROJECT_TYPE_NAMES[ProjectType.EEZ_GUI_LITE],
                image: EEZ_GUI_LITE_PROJECT_ICON(128),
                projectName: "EEZ-GUI Lite",
                description: "Start your new EEZ-GUI Lite project development here.",
                projectFileUrl: getTemplatePathOrUrl(
                    "templates/eez-gui-lite.eez-project"
                )
            }
        ].filter(projectType => this.searchFilter(projectType));
    }

    get bb3ProjectTypes(): IProjectType[] {
        return [
            {
                id: "applet",
                projectType: PROJECT_TYPE_NAMES[ProjectType.APPLET],
                image: APPLET_ICON(128),
                projectName: "BB3 Applet",
                description:
                    "Start your new BB3 Applet project development here.",
                projectFileUrl: getTemplatePathOrUrl(
                    "templates/applet.eez-project"
                )
            },
            {
                id: "resource",
                projectType: PROJECT_TYPE_NAMES[ProjectType.RESOURCE],
                image: MICROPYTHON_ICON(128),
                projectName: "BB3 MicroPython Script",
                description:
                    "Start your new BB3 MicroPython project development here.",
                projectFileUrl: getTemplatePathOrUrl(
                    "templates/resource.eez-project"
                )
            }
        ].filter(projectType => this.searchFilter(projectType));
    }

    get templateProjectTypes(): IProjectType[] {
        return this.templateProjects
            .map(templateProject => ({
                id: templateProject.clone_url,
                repository: templateProject.html_url,
                projectType: templateProject._projectType,
                image: templateProject._image_url,
                projectName: templateProject.name.startsWith(
                    "eez-flow-template-"
                )
                    ? templateProject.name.substring(
                          "eez-flow-template-".length
                      )
                    : templateProject.name,
                description: templateProject._description,
                keywords: templateProject._keywords,
                displayWidth: templateProject._displayWidth,
                displayHeight: templateProject._displayHeight,
                targetPlatform: templateProject._targetPlatform,
                targetPlatformLink: templateProject._targetPlatformLink
            }))
            .filter(projectType => this.searchFilter(projectType));
    }

    get allTemplateProjectTypes(): IProjectType[] {
        return this.digiwiseTemplates
            .map(template => ({
                id: `digiwise-template:${template.id}`,
                projectName: template.name,
                projectType: template.projectType,
                description: template.description || "",
                image: template.coverUrl || LVGL_PROJECT_ICON(128),
                templateCategory: normalizeRemoteTemplateCategory(
                    template.category ?? null
                ),
                remoteTemplate: template
            }))
            .filter(projectType => this.searchFilter(projectType));
    }

    get blankTemplateProjectType() {
        return this.standardProjectTypes.find(
            projectType => projectType.id === "LVGL"
        );
    }

    get folders(): ITreeNode {
        if (this.section == "templates") {
            const children = [];

            if (this.allTemplateProjectTypes.length > 0) {
                children.push({
                    id: "_allTemplates",
                    label: (
                        <Count
                            label="All Templates"
                            count={this.allTemplateProjectTypes.length}
                            attention={false}
                        ></Count>
                    ),
                    children: [],
                    selected: this.folder == "_allTemplates",
                    expanded: true,
                    data: undefined
                });
            }

            if (this.standardProjectTypes.length > 0) {
                children.push({
                    id: "_standard",
                    label: (
                        <Count
                            label="Builtin Templates"
                            count={this.standardProjectTypes.length}
                            attention={false}
                        ></Count>
                    ),
                    children: [],
                    selected: this.folder == "_standard",
                    expanded: true,
                    data: undefined
                });
            }

            if (this.bb3ProjectTypes.length > 0) {
                children.push({
                    id: "_bb3",
                    label: (
                        <Count
                            label="BB3 Script Templates"
                            count={this.bb3ProjectTypes.length}
                            attention={false}
                        ></Count>
                    ),
                    children: [],
                    selected: this.folder == "_bb3",
                    expanded: true,
                    data: undefined
                });
            }

            if (this.templateProjectTypes.length > 0) {
                children.push({
                    id: "_templates",
                    label: (
                        <Count
                            label={
                                productConfig.projectTemplates.onlineCatalog
                                    .displayName
                            }
                            count={this.templateProjectTypes.length}
                            attention={false}
                        ></Count>
                    ),
                    children: [],
                    selected: this.folder == "_templates",
                    expanded: true,
                    data: undefined
                });
            }

            // children.push({
            //     id: "_advanced",
            //     label: "Advanced",
            //     children: [
            //         {
            //             id: "empty",
            //             label: "Empty",
            //             children: [],
            //             selected: this.type === "empty",
            //             expanded: false,
            //             data: undefined
            //         }
            //     ],
            //     selected: false,
            //     expanded: false,
            //     data: undefined
            // });

            return {
                id: "_root",
                label: "Root",
                children,
                selected: false,
                expanded: false,
                data: undefined
            };
        } else {
            return this.exampleFolders;
        }
    }

    get projectTypes(): IProjectType[] {
        if (this.section == "templates") {
            return this.allTemplateProjectTypes.length > 0
                ? this.allTemplateProjectTypes
                : this.blankTemplateProjectType
                  ? [this.blankTemplateProjectType]
                  : [];
        } else {
            return this.folder
                ? this.exampleProjectTypes.get(this.folder) || []
                : [];
        }
    }

    get selectedProjectType(): IProjectType | undefined {
        return this.projectTypes.find(
            projectType => projectType.id == this.type
        );
    }

    get selectedTemplateProject(): TemplateProject | undefined {
        return this.templateProjects.find(
            templateProject => templateProject.clone_url == this.type
        );
    }

    hasFolder(folder: string) {
        function hasFolder(treeNode: ITreeNode) {
            if (treeNode.id == folder) {
                return true;
            }
            for (const child of treeNode.children) {
                if (child.id == folder) {
                    return true;
                }

                if (hasFolder(child)) {
                    return true;
                }
            }
            return false;
        }
        return hasFolder(this.folders);
    }

    hasType(type: string) {
        for (const projectType of this.projectTypes) {
            if (projectType.id == type) {
                return true;
            }
        }
        return false;
    }

    changeFolder(folder: string) {
        if (this.folder == folder) {
            return;
        }

        this.folder = folder;

        this.type =
            this.projectTypes.length > 0 ? this.projectTypes[0].id : undefined;

        if (this.section == "examples") {
            this.name = undefined;
        }
    }

    changeType(type: string) {
        this.type = type;

        if (this.section == "examples") {
            this.name = undefined;
        } else {
            const projectType = this.selectedProjectType;
            if (projectType) {
                if (projectType.displayWidth && projectType.displayHeight) {
                    this.displayWidth = projectType.displayWidth;
                    this.displayHeight = projectType.displayHeight;
                }
                if (projectType.defaultProjectName) {
                    this.name = projectType.defaultProjectName;
                }
            }
        }
    }

    async loadEezProject() {
        let projectFilePath;

        if (this.section == "templates") {
            const urlDef = this.selectedProjectType?.projectFileUrl;
            if (!urlDef) {
                throw "Can't load EEZ-PROJECT file: no URL specified";
            }

            if (typeof urlDef == "string") {
                projectFilePath = urlDef;
            } else {
                if ("SCPI" in urlDef) {
                    projectFilePath = urlDef[this.commandsProtocol];
                } else {
                    projectFilePath = urlDef[this.lvglVersion];
                }
            }
        } else {
            projectFilePath = this.type!;
        }

        return await loadTemplateFile(projectFilePath, "json");
    }

    async loadResourceFile(resourceFileRelativePath: string) {
        return new Promise<any>((resolve, reject) => {
            const resourceFileUrl =
                path.dirname(this.type!) + "/" + resourceFileRelativePath;

            let req = new XMLHttpRequest();
            req.responseType = "arraybuffer";
            req.open("GET", resourceFileUrl);

            req.addEventListener("load", async () => {
                if (req.readyState == 4) {
                    if (req.status != 200 || !req.response) {
                        reject("Download failed!");
                        return;
                    }
                    try {
                        resolve(Buffer.from(req.response));
                    } catch (err) {
                        reject(err);
                    }
                }
            });

            req.addEventListener("error", error => {
                reject("Network error");
            });

            req.send();
        });
    }

    get projectFolderPath() {
        if (!this.location || !this.name) {
            return undefined;
        }
        if (this.selectedTemplateProject || this.createDirectory) {
            let location = this.location.trim();
            if (location.endsWith("/") || location.endsWith("\\")) {
                location = location.substring(0, location.length - 1);
            }
            return `${location}${path.sep}${this.name}`;
        } else {
            return this.location;
        }
    }

    get projectFilePath() {
        if (!this.projectFolderPath) {
            return undefined;
        }
        return `${this.projectFolderPath}${path.sep}${this.name}.eez-project`;
    }

    getResourceFilePath(resourceFileRelativePath: string) {
        return `${this.projectFolderPath}${path.sep}${resourceFileRelativePath}`;
    }

    validateName() {
        const name = this.name?.trim();
        if (!name) {
            this.nameError = "This field is required.";
            return;
        }

        if (!name.match(/[a-zA-Z_\-][a-zA-Z_\-0-9]*/)) {
            this.nameError = "Invalid project name";
        }

        this.nameError = undefined;
        return true;
    }

    validateLocation() {
        const location = this.location?.trim();
        if (!location) {
            this.locationError = "This field is required.";
            return;
        }

        if (
            this.selectedTemplateProject ||
            (this.createDirectory && this.section == "templates")
        ) {
            if (fs.existsSync(this.projectFolderPath!)) {
                this.locationError = `Folder "${this.projectFolderPath}" already exists.`;
                return;
            }
        } else {
            if (
                fs.existsSync(this.projectFilePath!) &&
                this.section == "templates"
            ) {
                this.locationError =
                    "Project with the same name already exists at this location.";
                return;
            }
        }

        this.locationError = undefined;
        return true;
    }

    validateBB3ProjectFile() {
        this.bb3ProjectFileDownloadError = undefined;

        if (this.bb3ProjectOption == "bundled") {
            this.bb3ProjectFileError = undefined;
            return true;
        }

        const bb3ProjectFile = this.bb3ProjectFile?.trim();
        if (!bb3ProjectFile) {
            this.bb3ProjectFileError = "This field is required.";
            return;
        }

        if (!fs.existsSync(bb3ProjectFile)) {
            this.bb3ProjectFileError = "File does not exists.";
            return;
        }

        this.bb3ProjectFileError = undefined;
        return true;
    }

    async copyBundledBB3ProjectFile() {
        const version = this.projectVersion == "v3" ? "v3" : "v2";
        const source = resolveProjectTemplateFile(
            "templates/firmware-dependencies/" +
                version +
                "/modular-psu-firmware.eez-project"
        );
        if (!fs.existsSync(source)) {
            throw new Error(
                "Bundled BB3 firmware template is missing: " +
                    source +
                    ". Reinstall DigiStudio."
            );
        }
        await fs.promises.copyFile(
            source,
            path.join(this.projectFolderPath!, "modular-psu-firmware.eez-project")
        );
    }

    createProject = async (
        modalDialog: IObservableValue<any>,
        runMode: boolean,
        openProjectWhenDone: boolean = true
    ) => {
        if (this.createProjectInProgress) {
            return false;
        }

        try {
            modalDialog.get()?.setControlStatus("close", "disable");
            runInAction(() => {
                this.createProjectInProgress = true;
                this.projectCreationError = undefined;
            });

            try {
                this.validateName();
                this.validateLocation();

                if (this.nameError || this.locationError) {
                    return false;
                }

                if (
                    this.section == "templates" &&
                    (this.type == "applet" || this.type == "resource")
                ) {
                    this.validateBB3ProjectFile();

                    if (this.bb3ProjectFileError) {
                        return false;
                    }
                }

                let projectFilePath: string;

                const remoteTemplate = this.selectedProjectType?.remoteTemplate;
                if (remoteTemplate) {
                    const projectName = this.name!.trim();
                    const location = this.location!.trim();
                    const targetDirectory = this.createDirectory
                        ? path.join(location, projectName)
                        : location;
                    if (!targetDirectory) {
                        this.projectCreationError = settingsController.locale
                            .toLowerCase()
                            .startsWith("zh")
                            ? "请填写有效的项目保存位置。"
                            : "Choose a valid project location.";
                        return false;
                    }

                    const isChinese = settingsController.locale
                        .toLowerCase()
                        .startsWith("zh");
                    runInAction(() => {
                        this.progress =
                            getNewProjectWizardLabels().downloadAndCreate;
                    });
                    const result = await createDigiwiseTemplate(
                        {
                            template: {
                                id: remoteTemplate.id,
                                version: remoteTemplate.version,
                                fileSize: remoteTemplate.fileSize,
                                sha256: remoteTemplate.sha256,
                                fileFormat: remoteTemplate.fileFormat
                            },
                            projectName,
                            targetDirectory,
                            createDirectory: this.createDirectory
                        },
                        progress => {
                            runInAction(() => {
                                this.progress = getTemplateCreateProgressText(
                                    progress,
                                    isChinese
                                );
                            });
                        }
                    );

                    if (!result.ok) {
                        runInAction(() => {
                            this.projectCreationError =
                                getTemplateCreateErrorMessage(
                                    result.error.code,
                                    isChinese
                                );
                        });
                        return false;
                    }

                    this.saveOptions(SaveOptionsFlags.All);
                    if (openProjectWhenDone) {
                        openProject(result.data.projectFilePath, runMode);
                    }
                    runInAction(() => {
                        this.name = undefined;
                    });
                    return true;
                }

                if (
                    this.selectedTemplateProject ||
                    (this.isSelectedExampleWithGitRepository && this.gitClone)
                ) {
                    const commandExists = require("command-exists").sync;
                    if (!commandExists("git")) {
                        this.projectCreationError = (
                            <div>
                                Git not installed. Install Git from{" "}
                                <a
                                    href="#"
                                    onClick={event => {
                                        event.preventDefault();
                                        openLink(
                                            "https://git-scm.com/downloads"
                                        );
                                    }}
                                >
                                    git-scm.com/downloads
                                </a>
                                .
                            </div>
                        );
                        return false;
                    }

                    const projectDirPath = this.projectFolderPath!;

                    if (this.isSelectedExampleWithGitRepository) {
                        if (fs.existsSync(projectDirPath)) {
                            if (
                                !(await confirmOverwrite(
                                    `Folder already exists:\n${projectDirPath}`
                                ))
                            ) {
                                return false;
                            }
                            await rmdir(projectDirPath, { recursive: true });
                        }
                    }

                    // do git stuff
                    const { simpleGit } = await import("simple-git");

                    runInAction(
                        () => (this.progress = "Cloning repository ...")
                    );

                    const onGitProgress = ({
                        method,
                        stage,
                        progress
                    }: SimpleGitProgressEvent) => {
                        runInAction(
                            () =>
                                (this.progress = `git.${method} ${stage} stage ${progress}% complete`)
                        );
                    };

                    try {
                        await simpleGit({ progress: onGitProgress }).clone(
                            this.gitCloneUrl!,
                            projectDirPath,
                            this.gitInit &&
                                !this.isSelectedExampleWithGitRepository
                                ? {}
                                : {
                                      "--recurse-submodules": null
                                  }
                        );
                    } catch (err) {
                        await fs.promises.rm(projectDirPath, {
                            recursive: true,
                            force: true
                        });

                        throw err;
                    }

                    if (!this.isSelectedExampleWithGitRepository) {
                        await fs.promises.rm(projectDirPath + "/.git", {
                            recursive: true,
                            force: true
                        });
                    }

                    // execute template post processing
                    if (this.selectedTemplateProject) {
                        const postProcessing = require(projectDirPath +
                            "/template/post.js");
                        await postProcessing({
                            projectDirPath: projectDirPath,
                            projectName: this.name,
                            renameFile: async (
                                fileSrcRelativePath: string,
                                fileDstRelativePath: string
                            ) => {
                                await fs.promises.rename(
                                    projectDirPath + "/" + fileSrcRelativePath,
                                    projectDirPath + "/" + fileDstRelativePath
                                );
                            },
                            replaceInFile: async (
                                fileRelativePath: string,
                                searchValue: string,
                                newValue: string
                            ) => {
                                let content = await fs.promises.readFile(
                                    projectDirPath + "/" + fileRelativePath,
                                    "utf-8"
                                );

                                function escapeRegExp(str: string) {
                                    return str.replace(
                                        /[.*+?^${}()|[\]\\]/g,
                                        "\\$&"
                                    ); // $& means the whole matched string
                                }

                                content = content.replace(
                                    new RegExp(escapeRegExp(searchValue), "g"),
                                    newValue
                                );

                                await fs.promises.writeFile(
                                    projectDirPath + "/" + fileRelativePath,
                                    content,
                                    "utf-8"
                                );
                            }
                        });
                    }

                    // git init
                    const manifestJson = this.isSelectedExampleWithGitRepository
                        ? {}
                        : await readJsObjectFromFile(
                              projectDirPath + "/template/manifest.json"
                          );

                    if (
                        this.gitInit &&
                        !this.isSelectedExampleWithGitRepository
                    ) {
                        runInAction(() => (this.progress = "Git init ..."));
                        if (manifestJson["submodules"] != undefined) {
                            const submodules: {
                                name: string;
                                repository: string;
                                path: string;
                                branch?: string;
                            }[] = manifestJson["submodules"];

                            const git = simpleGit({
                                baseDir: projectDirPath,
                                progress: onGitProgress
                            });

                            await git.init();

                            for (const submodule of submodules) {
                                const NUM_RETRIES = 3;

                                for (let i = 0; i <= NUM_RETRIES; i++) {
                                    const message = `Adding submodule ${
                                        submodule.name
                                    } ${
                                        i > 0
                                            ? `retry ${i} of ${NUM_RETRIES}`
                                            : ""
                                    } ...`;

                                    runInAction(
                                        () => (this.progress = message)
                                    );

                                    await fs.promises.rm(
                                        projectDirPath + "/" + submodule.path,
                                        {
                                            recursive: true,
                                            force: true
                                        }
                                    );

                                    try {
                                        if (submodule.branch) {
                                            await git.subModule(
                                                [
                                                    "add",
                                                    "-b",
                                                    submodule.branch,
                                                    submodule.repository,
                                                    submodule.path
                                                ],
                                                (err, data) => {
                                                    console.log(err, data);
                                                }
                                            );
                                        } else {
                                            await git.submoduleAdd(
                                                submodule.repository,
                                                submodule.path,
                                                (err, data) => {
                                                    console.log(err, data);
                                                }
                                            );
                                        }
                                    } catch (err) {
                                        if (i == NUM_RETRIES) {
                                            await fs.promises.rm(
                                                projectDirPath,
                                                {
                                                    recursive: true,
                                                    force: true
                                                }
                                            );

                                            throw err;
                                        }

                                        console.error(err);
                                        continue;
                                    }

                                    break;
                                }
                            }

                            await git.add(".").commit("Inital commit");
                        } else {
                            runInAction(
                                () =>
                                    (this.progress = `Adding submodule eez-framework ...`)
                            );

                            await fs.promises.rm(
                                projectDirPath +
                                    "/" +
                                    manifestJson["eez-framework-location"],
                                {
                                    recursive: true,
                                    force: true
                                }
                            );

                            await simpleGit({
                                baseDir: projectDirPath,
                                progress: onGitProgress
                            })
                                .init()
                                .submoduleAdd(
                                    "https://github.com/eez-open/eez-framework",
                                    manifestJson["eez-framework-location"]
                                )
                                .add(".")
                                .commit("Inital commit");
                        }
                    }

                    if (this.isSelectedExampleWithGitRepository) {
                        projectFilePath =
                            projectDirPath +
                            "/" +
                            this.selectedProjectType!.eezProjectPath!;
                    } else {
                        // get projectFilePath from manifest.json
                        projectFilePath =
                            projectDirPath +
                            "/" +
                            manifestJson["eez-project-path"];

                        projectFilePath = projectFilePath.replace(
                            /(\/|\\\\)/g,
                            path.sep
                        );
                    }
                } else {
                    try {
                        await fs.promises.mkdir(this.projectFolderPath!, {
                            recursive: true
                        });
                    } catch (err: any) {
                        runInAction(() => {
                            this.locationError = err.toString();
                        });
                        return false;
                    }

                    projectFilePath = this.projectFilePath!;

                    // if (fs.existsSync(projectFilePath)) {
                    //     if (
                    //         !(await confirmOverwrite(
                    //             `File already exists:\n${projectFilePath}`
                    //         ))
                    //     ) {
                    //         return false;
                    //     }
                    // }

                    let projectTemplate;

                    try {
                        projectTemplate = await this.loadEezProject();
                    } catch (err: any) {
                        runInAction(() => {
                            this.projectCreationError = err.toString();
                        });
                        return false;
                    }

                    // set projectVersion
                    projectTemplate.settings.general.projectVersion =
                        this.type == "resource" ? this.projectVersion : "v3";

                    if (this.type == "applet" || this.type == "resource") {
                        // set masterProject
                        if (this.bb3ProjectOption == "bundled") {
                            try {
                                await this.copyBundledBB3ProjectFile();
                            } catch (err: any) {
                                runInAction(() => {
                                    this.bb3ProjectFileDownloadError =
                                        err.toString();
                                });
                                return false;
                            }
                            projectTemplate.settings.general.masterProject =
                                "." +
                                path.sep +
                                "modular-psu-firmware.eez-project";
                        } else {
                            projectTemplate.settings.general.masterProject =
                                path.relative(
                                    path.dirname(projectFilePath),
                                    this.bb3ProjectFile!
                                );
                        }

                        // set title bar text
                        if (this.type == "applet") {
                            projectTemplate.pages[0].components[1].widgets[1].data = `"${this.name}"`;
                        } else {
                            projectTemplate.pages[0].components[1].widgets[1].text =
                                this.name;

                            projectTemplate.micropython.code =
                                projectTemplate.micropython.code.replace(
                                    "Scripts/resource.res",
                                    `Scripts/${this.name}.res`
                                );
                        }
                    } else if (
                        this.type == "LVGL" ||
                        this.type == "LVGL with EEZ Flow"
                    ) {
                        projectTemplate.settings.general.lvglVersion =
                            this.lvglVersion;
                    } else if (this.type == "IEXT") {
                        projectTemplate.settings.general.commandsProtocol =
                            this.commandsProtocol;
                    }

                    let projectTemplateStr = JSON.stringify(
                        projectTemplate,
                        undefined,
                        2
                    );

                    if (this.type == "IEXT") {
                        projectTemplateStr = projectTemplateStr.replace(
                            new RegExp(/\{\{iext-name\}\}/, "g"),
                            this.name!
                        );
                        projectTemplateStr = projectTemplateStr.replace(
                            new RegExp(/\{\{iext-build-configuration\}\}/, "g"),
                            this.name!
                        );
                        projectTemplateStr = projectTemplateStr.replace(
                            new RegExp(/\{\{iext-extension-name\}\}/, "g"),
                            this.name!
                        );
                        projectTemplateStr = projectTemplateStr.replace(
                            new RegExp(/\{\{iext-guid\}\}/, "g"),
                            guid()
                        );
                        projectTemplateStr = projectTemplateStr.replace(
                            new RegExp(/\{\{iext-sdl-friendly-name\}\}/, "g"),
                            ""
                        );
                    }

                    if (this.type == "firmware") {
                        const fontFileName = "Oswald-Medium.ttf";
                        const fontFileDestPath = `${this.projectFolderPath}/${fontFileName}`;

                        const fontFilePath = getTemplatePathOrUrl(
                            "templates/Oswald-Medium.ttf"
                        );

                        const buffer = await loadTemplateFile(
                            fontFilePath,
                            "buffer"
                        );

                        await fs.promises.writeFile(fontFileDestPath, buffer);
                    }

                    try {
                        await fs.promises.writeFile(
                            projectFilePath,
                            projectTemplateStr,
                            "utf8"
                        );
                    } catch (err: any) {
                        runInAction(() => {
                            this.nameError = err.toString();
                        });
                        return false;
                    }

                    const resourceFiles =
                        this.selectedProjectType?.resourceFiles;
                    if (resourceFiles && resourceFiles.length > 0) {
                        for (const resourceFile of resourceFiles) {
                            const resourceFileContent =
                                await this.loadResourceFile(resourceFile);

                            try {
                                const resourceFilePath =
                                    this.getResourceFilePath(resourceFile);

                                try {
                                    await fs.promises.mkdir(
                                        path.dirname(resourceFilePath),
                                        {
                                            recursive: true
                                        }
                                    );
                                } catch (err: any) {
                                    runInAction(() => {
                                        this.locationError = err.toString();
                                    });
                                    return false;
                                }

                                await fs.promises.mkdir(
                                    path.dirname(resourceFilePath),
                                    {
                                        recursive: true
                                    }
                                );

                                await fs.promises.writeFile(
                                    resourceFilePath,
                                    resourceFileContent,
                                    "binary"
                                );
                            } catch (err: any) {
                                runInAction(() => {
                                    this.nameError = err.toString();
                                });
                                return false;
                            }
                        }
                    }
                }

                this.saveOptions(SaveOptionsFlags.All);

                if (openProjectWhenDone) {
                    openProject(projectFilePath, runMode);
                }

                runInAction(() => {
                    this.name = undefined;
                });

                return true;
            } catch (err) {
                console.error(err);
                this.projectCreationError = `Failed to create a new project${
                    this.progress ? ' at: "' + this.progress + '"' : ""
                }!`;
            } finally {
                runInAction(() => {
                    this.progress = "";
                });
            }

            return false;
        } finally {
            runInAction(() => {
                this.createProjectInProgress = false;
            });
            modalDialog.get()?.setControlStatus("close", "enable");
        }
    };

    onSearchChange(event: any) {
        this.searchText = $(event.target).val() as string;

        this.changeFolder(
            this.section == "templates" ? "_allTemplates" : "_allExamples"
        );

        if (
            productConfig.examplesCatalog.enabled &&
            this.section == "templates" &&
            this.templateProjectTypes.length == 0 &&
            this.exampleProjectTypes.get("_allExamples")!.length > 0
        ) {
            this.section = "examples";
        } else if (
            this.section == "examples" &&
            productConfig.examplesCatalog.enabled &&
            this.exampleProjectTypes.get("_allExamples")!.length == 0 &&
            this.templateProjectTypes.length > 0
        ) {
            this.section = "templates";
        } else if (
            this.section == "examples" &&
            !productConfig.examplesCatalog.enabled
        ) {
            this.section = "templates";
            this.folder = "_allTemplates";
        }
    }

    isGitProject(projectType: IProjectType) {
        return (
            projectType.repository &&
            projectType.repository != EEZ_PROJECT_EXAMPLES_REPOSITORY
        );
    }

    get isSelectedExampleWithGitRepository() {
        return (
            this.section == "examples" &&
            productConfig.examplesCatalog.enabled &&
            this.selectedProjectType &&
            this.isGitProject(this.selectedProjectType)
        );
    }

    get gitCloneUrl() {
        if (this.selectedTemplateProject) {
            return this.selectedTemplateProject.html_url;
        }

        return this.selectedProjectType?.repository;
    }

    searchFilter(projectType: IProjectType) {
        const parts = this.searchText.trim().toLowerCase().split("+");
        if (parts.length == 0) {
            return true;
        }

        const searchTargets = [
            projectType.projectName,
            projectType.projectType,
            projectType.description,
            projectType.keywords,
            projectType.language,
            projectType.targetPlatform,
            this.isGitProject(projectType) ? "git" : ""
        ]
            .filter(target => target && target.trim().length > 0)
            .join(", ")
            .toLowerCase();

        return !parts.find(part => searchTargets.indexOf(part) == -1);
    }
}

export const wizardModelTemplates = WizardModel.makeTemplatesWizardModel();
export const wizardModelExamples = WizardModel.makeExamplesWizardModel();

const FoldersTree = observer(
    class FoldersTree extends React.Component<{ wizardModel: WizardModel }> {
        render() {
            return (
                <Tree
                    rootNode={this.props.wizardModel.folders}
                    selectNode={node => {
                        this.props.wizardModel.changeFolder(node.id);
                    }}
                    showOnlyChildren={true}
                    style={{ height: "100%", overflow: "auto" }}
                />
            );
        }
    }
);

const ProjectTypesList = observer(
    class ProjectTypesList extends React.Component<{
        wizardModel: WizardModel;
    }> {
        myRef = React.createRef<HTMLDivElement>();

        componentDidMount(): void {
            this.myRef.current
                ?.querySelector(
                    ".EezStudio_NewProjectWizard_ProjectType.selected"
                )
                ?.scrollIntoView({ block: "center" });
        }

        componentDidUpdate(): void {
            this.myRef.current
                ?.querySelector(
                    ".EezStudio_NewProjectWizard_ProjectType.selected"
                )
                ?.scrollIntoView({ block: "nearest" });
        }

        onKeyDown = (event: any) => {
            let focusedItemId = $(event.target)
                .find(".EezStudio_NewProjectWizard_ProjectType.selected")
                .attr("data-object-id");

            if (!focusedItemId) {
                return;
            }

            let $focusedItem = $(event.target).find(
                `.EezStudio_NewProjectWizard_ProjectType[data-object-id="${focusedItemId}"]`
            );

            if (
                event.keyCode == 38 ||
                event.keyCode == 40 ||
                event.keyCode == 33 ||
                event.keyCode == 34 ||
                event.keyCode == 36 ||
                event.keyCode == 35
            ) {
                let $rows = $(event.target).find(
                    ".EezStudio_NewProjectWizard_ProjectType"
                );
                let index = $rows.index($focusedItem);

                let pageSize = Math.floor(
                    $(event.target).parent().height()! /
                        $($rows[0]).outerHeight()!
                );

                if (event.keyCode == 38) {
                    // up
                    index--;
                } else if (event.keyCode == 40) {
                    // down
                    index++;
                } else if (event.keyCode == 33) {
                    // page up
                    index -= pageSize;
                } else if (event.keyCode == 34) {
                    // page down
                    index += pageSize;
                } else if (event.keyCode == 36) {
                    // home
                    index = 0;
                } else if (event.keyCode == 35) {
                    // end
                    index = $rows.length - 1;
                }

                if (index < 0) {
                    index = 0;
                } else if (index >= $rows.length) {
                    index = $rows.length - 1;
                }

                let newFocusedItemId = $($rows[index]).attr("data-object-id");
                if (newFocusedItemId) {
                    this.props.wizardModel.changeType(newFocusedItemId);
                    ($rows[index] as Element).scrollIntoView({
                        block: "nearest",
                        behavior: "auto"
                    });
                }

                event.preventDefault();
            }
        };

        render() {
            return (
                <div
                    className="EezStudio_NewProjectWizard_ProjectTypes"
                    ref={this.myRef}
                    tabIndex={0}
                    onKeyDown={this.onKeyDown}
                >
                    {this.props.wizardModel.projectTypes.map(projectType => (
                        <ProjectTypeComponent
                            key={projectType.id}
                            wizardModel={this.props.wizardModel}
                            projectType={projectType}
                        />
                    ))}
                </div>
            );
        }
    }
);

const ProjectTypeComponent = observer(
    class ProjectTypeComponent extends React.Component<{
        wizardModel: WizardModel;
        projectType: IProjectType;
    }> {
        zoomed: boolean = false;

        constructor(props: any) {
            super(props);

            makeObservable(this, { zoomed: observable });
        }

        render() {
            const { projectType } = this.props;

            const selected = this.props.wizardModel.type == projectType.id;

            let zoomedImage;
            if (this.zoomed) {
                zoomedImage = ReactDOM.createPortal(
                    <div
                        className="EezStudio_NewProjectWizard_ProjectType_Image_Zoomed_Container"
                        onClick={action(() => (this.zoomed = false))}
                    >
                        <div className="EezStudio_NewProjectWizard_ProjectType_Image_Zoomed_Backface"></div>
                        <div className="EezStudio_NewProjectWizard_ProjectType_Image_Zoomed_Image">
                            <Icon icon={projectType.image} size={128} />
                        </div>
                    </div>,
                    document.body
                );
            }

            const imageZoomEnabled =
                selected && this.props.wizardModel.section == "examples";

            return (
                <div
                    key={projectType.id}
                    className={classNames(
                        "EezStudio_NewProjectWizard_ProjectType",
                        {
                            selected
                        }
                    )}
                    data-object-id={projectType.id}
                    onClick={() => {
                        this.props.wizardModel.changeType(projectType.id);
                    }}
                >
                    <div
                        className={classNames(
                            "EezStudio_NewProjectWizard_ProjectType_Image",
                            { imageZoomEnabled }
                        )}
                    >
                        <Icon
                            icon={projectType.image}
                            size={128}
                            onClick={
                                imageZoomEnabled
                                    ? action(() => (this.zoomed = true))
                                    : undefined
                            }
                        />
                    </div>
                    {zoomedImage}
                    <div className="EezStudio_NewProjectWizard_ProjectType_Details">
                        <div className="EezStudio_NewProjectWizard_ProjectType_Details_Title">
                            <h6>{projectType.projectName}</h6>
                            {projectType.repository &&
                                projectType.repository !=
                                    EEZ_PROJECT_EXAMPLES_REPOSITORY && (
                                    <a
                                        href="#"
                                        onClick={event => {
                                            event.preventDefault();
                                            openLink(projectType.repository!);
                                        }}
                                        title="Project Git Repository"
                                    >
                                        INFO
                                    </a>
                                )}
                        </div>
                        {projectType.keywords && (
                            <div className="EezStudio_NewProjectWizard_ProjectType_Details_Keywords">
                                {projectType.keywords
                                    .split(" ")
                                    .map(keyword => (
                                        <span
                                            key={keyword}
                                            className="badge bg-info"
                                        >
                                            {keyword}
                                        </span>
                                    ))}
                            </div>
                        )}
                        <div className="EezStudio_NewProjectWizard_ProjectType_Details_Description">
                            {projectType.author && (
                                <div>
                                    Created :{" "}
                                    {projectType.authorLink ? (
                                        <a
                                            href="#"
                                            onClick={event => {
                                                event.preventDefault();
                                                openLink(
                                                    projectType.authorLink!
                                                );
                                            }}
                                        >
                                            {projectType.author}
                                        </a>
                                    ) : (
                                        projectType.author
                                    )}
                                </div>
                            )}
                            {projectType.description}
                        </div>

                        <ProjectTypeInfo
                            infoList={{
                                Type: projectType.projectType,
                                Language: projectType.language,
                                Resolution:
                                    projectType.displayWidth != undefined &&
                                    projectType.displayHeight != undefined
                                        ? `${projectType.displayWidth} x ${projectType.displayHeight}`
                                        : undefined,
                                "LVGL version":
                                    projectType.projectType ==
                                    PROJECT_TYPE_NAMES[ProjectType.LVGL]
                                        ? this.props.wizardModel.section ==
                                              "templates" &&
                                          (projectType.id == "LVGL" ||
                                              projectType.id ==
                                                  "LVGL with EEZ Flow")
                                            ? "8.x | 9.x"
                                            : undefined
                                        : undefined
                            }}
                        />
                    </div>
                </div>
            );
        }
    }
);

function ProjectTypeInfo(props: {
    infoList: {
        [key: string]: string | undefined;
    };
}) {
    const infoList: string[] = Object.keys(props.infoList).filter(
        infoName => props.infoList[infoName] != undefined
    );

    return (
        <div className="EezStudio_NewProjectWizard_ProjectType_Details_InfoList">
            {infoList.map((infoName: string, i: number) => (
                <span key={infoName}>
                    <span className="lighter">{infoName}: </span>
                    <span className="bolder">{props.infoList[infoName]}</span>
                    {i < infoList.length - 1 && (
                        <span className="lighter"> | </span>
                    )}
                </span>
            ))}
        </div>
    );
}

const ProjectProperties = observer(
    class ProjectProperties extends React.Component<{
        wizardModel: WizardModel;
        modalDialog: IObservableValue<any>;
    }> {
        onCreateProject = async () => {
            const success = await this.props.wizardModel.createProject(
                this.props.modalDialog,
                false
            );
            if (success) {
                this.props.modalDialog.get()?.close();
            }
        };

        onRunProject = async () => {
            const success = await this.props.wizardModel.createProject(
                this.props.modalDialog,
                true
            );
            if (success) {
                this.props.modalDialog.get()?.close();
            }
        };

        onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key == "Enter") {
                this.onCreateProject();
            }
        };

        render() {
            const { wizardModel } = this.props;

            if (wizardModel.type == undefined) {
                return (
                    <div className="EezStudio_NewProjectWizard_ProjectProperties"></div>
                );
            }

            if (wizardModel.createProjectInProgress) {
                return (
                    <div className="EezStudio_NewProjectWizard_CreateProjectProgress">
                        <h6>Creating project ...</h6>
                        <Loader />
                        <div>{wizardModel.progress || <span>&nbsp;</span>}</div>
                    </div>
                );
            }

            return (
                <div className="EezStudio_NewProjectWizard_ProjectProperties">
                    <PlatformDescription wizardModel={wizardModel} />

                    <div className="EezStudio_NewProjectWizard_ProjectProperties_Section">
                        <h6>Project Settings</h6>
                        <div>
                            <div className="mb-3">
                                <label
                                    htmlFor="new-project-wizard-name-input"
                                    className="form-label"
                                >
                                    Name
                                </label>
                                <NameInput
                                    id="new-project-wizard-name-input"
                                    value={wizardModel.name || ""}
                                    onChange={action(
                                        (value: string | undefined) =>
                                            (wizardModel.name = value)
                                    )}
                                    onKeyDown={this.onKeyDown}
                                />
                                {wizardModel.nameError && (
                                    <div className="form-text text-danger">
                                        {wizardModel.nameError}
                                    </div>
                                )}
                            </div>

                            {wizardModel.section == "templates" &&
                                (wizardModel.type == "LVGL" ||
                                    wizardModel.type ==
                                        "LVGL with EEZ Flow") && (
                                    <div className="mb-3">
                                        <label
                                            className="form-label"
                                            htmlFor="new-project-wizard-lvgl-version"
                                        >
                                            LVGL version
                                        </label>
                                        <select
                                            id="new-project-wizard-lvgl-version"
                                            className="form-select"
                                            onChange={action(
                                                event =>
                                                    (wizardModel.lvglVersion =
                                                        event.target.value == "9.2.2" ||
                                                        event.target.value == "9.3.0" || 
                                                        event.target.value == "9.4.0" || 
                                                        event.target.value == "9.5.0"
                                                            ? event.target.value
                                                            : "8.4.0")
                                            )}
                                            value={wizardModel.lvglVersion}
                                        >
                                            <option value="8.4.0">8.4.0</option>
                                            <option value="9.2.2">9.2.2</option>
                                            <option value="9.3.0">9.3.0</option>
                                            <option value="9.4.0">9.4.0</option>
                                            <option value="9.5.0">9.5.0</option>
                                        </select>
                                    </div>
                                )}

                            {wizardModel.section == "templates" &&
                                wizardModel.type == "IEXT" && (
                                    <div className="mb-3">
                                        <label
                                            className="form-label"
                                            htmlFor="new-project-wizard-commands-protocol"
                                        >
                                            Commands protocol
                                        </label>
                                        <select
                                            id="new-project-wizard-commands-protocol"
                                            className="form-select"
                                            onChange={action(
                                                event =>
                                                    (wizardModel.commandsProtocol =
                                                        event.target.value ==
                                                        "PROPRIETARY"
                                                            ? "PROPRIETARY"
                                                            : "SCPI")
                                            )}
                                            value={wizardModel.commandsProtocol}
                                        >
                                            <option value="SCPI">SCPI</option>
                                            <option value="PROPRIETARY">
                                                Proprietary
                                            </option>
                                        </select>
                                    </div>
                                )}

                            <div className="mb-3">
                                <label
                                    htmlFor="new-project-wizard-location-input"
                                    className="col-form-label"
                                >
                                    Location
                                </label>
                                <DirectoryBrowserInput
                                    value={wizardModel.location || ""}
                                    onChange={action(
                                        (value: string | undefined) =>
                                            (wizardModel.location = value)
                                    )}
                                />
                                {wizardModel.locationError && (
                                    <div className="form-text text-danger">
                                        {wizardModel.locationError}
                                    </div>
                                )}
                            </div>

                            {!(
                                wizardModel.selectedTemplateProject ||
                                (wizardModel.isSelectedExampleWithGitRepository &&
                                    wizardModel.gitClone)
                            ) && (
                                <div className="mb-3 form-check">
                                    <input
                                        id="new-project-wizard-create-directory-checkbox"
                                        className="form-check-input"
                                        type="checkbox"
                                        checked={wizardModel.createDirectory}
                                        onChange={action(
                                            event =>
                                                (wizardModel.createDirectory =
                                                    event.target.checked)
                                        )}
                                    />
                                    <label
                                        className="form-check-label"
                                        htmlFor="new-project-wizard-create-directory-checkbox"
                                    >
                                        Create directory
                                    </label>
                                </div>
                            )}

                            <div className="mb-3">
                                <label
                                    htmlFor="new-project-wizard-project-path-static"
                                    className="form-label"
                                >
                                    {wizardModel.selectedTemplateProject ||
                                    (wizardModel.isSelectedExampleWithGitRepository &&
                                        wizardModel.gitClone)
                                        ? "Project folder path"
                                        : "Project file path"}
                                </label>
                                <div
                                    id="new-project-wizard-project-path-static"
                                    className="form-control EezStudio_NewProjectWizard_StaticField"
                                >
                                    {(wizardModel.selectedTemplateProject ||
                                    (wizardModel.isSelectedExampleWithGitRepository &&
                                        wizardModel.gitClone)
                                        ? wizardModel.projectFolderPath
                                        : wizardModel.projectFilePath) || (
                                        <span>&nbsp;</span>
                                    )}
                                </div>
                            </div>

                            {wizardModel.isSelectedExampleWithGitRepository && (
                                <div className="mb-3 form-check">
                                    <input
                                        id="new-project-wizard-git-clone-checkbox"
                                        className="form-check-input"
                                        type="checkbox"
                                        checked={wizardModel.gitClone}
                                        onChange={action(
                                            event =>
                                                (wizardModel.gitClone =
                                                    event.target.checked)
                                        )}
                                    />
                                    <label
                                        className="form-check-label"
                                        htmlFor="new-project-wizard-git-clone-checkbox"
                                    >
                                        Clone Git repository
                                    </label>
                                    <div className="form-text">
                                        Check this if you want to download the
                                        entire repository not only eez-project
                                        file and its dependencies.
                                    </div>
                                </div>
                            )}

                            {wizardModel.selectedTemplateProject && (
                                <div className="mb-3 form-check">
                                    <input
                                        id="new-project-wizard-git-init-checkbox"
                                        className="form-check-input"
                                        type="checkbox"
                                        checked={wizardModel.gitInit}
                                        onChange={action(
                                            event =>
                                                (wizardModel.gitInit =
                                                    event.target.checked)
                                        )}
                                    />
                                    <label
                                        className="form-check-label"
                                        htmlFor="new-project-wizard-git-init-checkbox"
                                    >
                                        Initialize as Git repository
                                    </label>
                                </div>
                            )}

                            {wizardModel.section == "templates" &&
                                (wizardModel.type == "applet" ||
                                    wizardModel.type == "resource") && (
                                    <>
                                        <div className="mb-3">
                                            <label className="form-label">
                                                BB3 project file option
                                            </label>

                                            <div className="form-check ms-4">
                                                <input
                                                    id="new-project-wizard-bb3-project-bundled"
                                                    className="form-check-input"
                                                    type="radio"
                                                    name="new-project-wizard-bb3-project"
                                                    value={"bundled"}
                                                    checked={
                                                        wizardModel.bb3ProjectOption ==
                                                        "bundled"
                                                    }
                                                    onChange={action(
                                                        event =>
                                                            (wizardModel.bb3ProjectOption =
                                                                event.target
                                                                    .checked
                                                                    ? "bundled"
                                                                    : "local")
                                                    )}
                                                />

                                                <label
                                                    className="form-check-label"
                                                    htmlFor="new-project-wizard-bb3-project-bundled"
                                                >
                                                    Use included BB3 firmware project
                                                </label>

                                                {wizardModel.bb3ProjectOption ==
                                                    "bundled" &&
                                                    wizardModel.bb3ProjectFileDownloadError && (
                                                        <div className="form-text text-danger">
                                                            {
                                                                wizardModel.bb3ProjectFileDownloadError
                                                            }
                                                        </div>
                                                    )}
                                            </div>

                                            <div className="form-check ms-4">
                                                <input
                                                    id="new-project-wizard-bb3-project-local"
                                                    className="form-check-input"
                                                    type="radio"
                                                    name="new-project-wizard-bb3-project"
                                                    value={1}
                                                    checked={
                                                        wizardModel.bb3ProjectOption ==
                                                        "local"
                                                    }
                                                    onChange={action(
                                                        event =>
                                                            (wizardModel.bb3ProjectOption =
                                                                event.target
                                                                    .checked
                                                                    ? "local"
                                                                    : "bundled")
                                                    )}
                                                />

                                                <label
                                                    className="form-check-label"
                                                    htmlFor="new-project-wizard-bb3-project-local"
                                                >
                                                    I already have a local copy
                                                </label>
                                            </div>
                                        </div>

                                        {wizardModel.bb3ProjectOption ==
                                            "local" && (
                                            <div className="mb-3">
                                                <label
                                                    htmlFor="new-project-wizard-bb3-project-file-path-input"
                                                    className="form-label"
                                                >
                                                    BB3 project file path
                                                </label>
                                                <FileBrowserInput
                                                    id="new-project-wizard-bb3-project-file-path-input"
                                                    value={
                                                        wizardModel.bb3ProjectFile
                                                    }
                                                    onChange={action(
                                                        (
                                                            value:
                                                                | string
                                                                | undefined
                                                        ) =>
                                                            (wizardModel.bb3ProjectFile =
                                                                value)
                                                    )}
                                                />
                                                {wizardModel.bb3ProjectFileError && (
                                                    <div className="form-text text-danger">
                                                        {
                                                            wizardModel.bb3ProjectFileError
                                                        }
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}

                            {wizardModel.section == "templates" &&
                                wizardModel.type == "resource" && (
                                    <div className="mb-3">
                                        <label className="form-label">
                                            Target BB3 firmware
                                        </label>

                                        <div className="form-check ms-4">
                                            <input
                                                id="new-project-wizard-bb3-target-version-v3"
                                                className="form-check-input"
                                                type="radio"
                                                name="new-project-wizard-bb3-target"
                                                value={"v3"}
                                                checked={
                                                    wizardModel.projectVersion ==
                                                    "v3"
                                                }
                                                onChange={action(
                                                    event =>
                                                        (wizardModel.projectVersion =
                                                            event.target.checked
                                                                ? "v3"
                                                                : "v2")
                                                )}
                                            />
                                            <label
                                                className="form-check-label"
                                                htmlFor="new-project-wizard-bb3-target-version-v3"
                                            >
                                                1.8 or newer
                                            </label>
                                        </div>

                                        <div className="form-check ms-4">
                                            <input
                                                id="new-project-wizard-bb3-target-version-v2"
                                                className="form-check-input"
                                                type="radio"
                                                name="new-project-wizard-bb3-target"
                                                value={"v2"}
                                                checked={
                                                    wizardModel.projectVersion ==
                                                    "v2"
                                                }
                                                onChange={action(
                                                    event =>
                                                        (wizardModel.projectVersion =
                                                            event.target.checked
                                                                ? "v2"
                                                                : "v3")
                                                )}
                                            />
                                            <label
                                                className="form-check-label"
                                                htmlFor="new-project-wizard-bb3-target-version-v2"
                                            >
                                                1.7.X or older
                                            </label>
                                        </div>
                                    </div>
                                )}

                            <div className="d-flex justify-content-end">
                                {wizardModel.section == "templates" ? (
                                    <button
                                        className="btn btn-lg btn-success"
                                        onClick={this.onCreateProject}
                                        disabled={
                                            wizardModel.createProjectInProgress
                                        }
                                    >
                                        Create Project
                                    </button>
                                ) : (
                                    <>
                                        <ButtonAction
                                            className="btn-primary"
                                            text="Edit Project"
                                            title="Edit Project"
                                            icon="material:edit"
                                            onClick={this.onCreateProject}
                                            enabled={
                                                !wizardModel.createProjectInProgress
                                            }
                                        />
                                        {wizardModel.selectedProjectType
                                            ?.projectType != "IEXT" && (
                                            <ButtonAction
                                                className="btn-secondary"
                                                text="Run Project"
                                                title="Run Project"
                                                icon="material:play_arrow"
                                                onClick={this.onRunProject}
                                                enabled={
                                                    !wizardModel.createProjectInProgress
                                                }
                                                style={{
                                                    marginLeft: 10
                                                }}
                                            />
                                        )}
                                    </>
                                )}
                            </div>

                            {wizardModel.projectCreationError && (
                                <div className="EezStudio_NewProjectWizard_CreationStatus">
                                    <div
                                        className="alert alert-danger"
                                        style={{ flex: 1 }}
                                    >
                                        {wizardModel.projectCreationError}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
    }
);

function PlatformDescription({ wizardModel }: { wizardModel: WizardModel }) {
    if (!wizardModel.selectedProjectType) {
        return null;
    }

    if (!wizardModel.selectedProjectType.targetPlatform) {
        return null;
    }

    const html = {
        __html: marked.parse(
            wizardModel.selectedProjectType.targetPlatform || "",
            { mangle: false, headerIds: false }
        ) as string
    };

    const targetPlatformLink =
        wizardModel.selectedProjectType.targetPlatformLink;

    return (
        <div className="EezStudio_NewProjectWizard_ProjectProperties_Section">
            <h6>
                <span>
                    {wizardModel.selectedProjectType.projectType == "IEXT"
                        ? "Instrument"
                        : "Platform"}{" "}
                    Description
                </span>
            </h6>
            <div>
                <div className="markdown" dangerouslySetInnerHTML={html} />
                {targetPlatformLink && (
                    <div className="mt-2">
                        <a
                            href="#"
                            onClick={event => {
                                event.preventDefault();
                                openLink(targetPlatformLink);
                            }}
                        >
                            Find more on the platform web site ...
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}


const NEW_PROJECT_WIZARD_LABELS = {
    en: {
        title: "New Project",
        noExamplesFound: "No examples found",
        noTemplates: "No published templates are available",
        noTemplateMatches: "No templates match the current filters",
        loadingTemplates: "Loading templates...",
        downloadAndCreate: "Downloading and verifying template...",
        authorizingTemplate: "Preparing secure download...",
        downloadingTemplate: "Downloading template",
        verifyingTemplate: "Verifying file integrity...",
        creatingTemplate: "Creating project files...",
        templateLoadFailed: "Could not load templates. Check the connection and retry.",
        retry: "Retry",
        remoteCreatePending: "Download and create this template",
        template: "Template",
        templateVersion: "Template",
        resolution: "Resolution",
        resolutionFromTemplate: "Defined by template",
        createProject: "Create Project",
        selectTemplate: "Select Project Template",
        filterByName: "Filter by name...",
        categories: {
            All: "All",
            EmptyUI: "Empty UI",
            Application: "Application",
            Flow: "Flow",
            Widget: "Widget"
        },
        projectName: "Project Name",
        projectNamePlaceholder: "Project name",
        projectLocation: "Project Location",
        projectLocationPlaceholder: "Directory path",
        browse: "Browse...",
        width: "Width",
        height: "Height",
        resolutionPresets: "Common Resolution Presets",
        colorDepth: "Color Depth",
        lvglVersion: "LVGL Version",
        compatible83: "Compatible with 8.3.x",
        createDirectory: "Create directory",
        back: "Back",
        create: "Create"
    },
    zh: {
        title: "新建项目",
        noExamplesFound: "未找到示例",
        noTemplates: "暂无已发布模板",
        noTemplateMatches: "没有符合当前筛选条件的模板",
        loadingTemplates: "正在加载模板…",
        downloadAndCreate: "正在下载并校验模板…",
        authorizingTemplate: "正在获取安全下载地址…",
        downloadingTemplate: "正在下载模板",
        verifyingTemplate: "正在校验文件完整性…",
        creatingTemplate: "正在创建项目文件…",
        templateLoadFailed: "模板读取失败，请检查连接后重试。",
        retry: "重试",
        remoteCreatePending: "下载并创建此模板",
        template: "模板",
        templateVersion: "后台模板",
        resolution: "分辨率",
        resolutionFromTemplate: "由模板文件确定",
        createProject: "创建项目",
        selectTemplate: "选择项目模板",
        filterByName: "按名称筛选...",
        categories: {
            All: "全部",
            EmptyUI: "空白界面",
            Application: "应用",
            Flow: "流程",
            Widget: "控件"
        },
        projectName: "项目名称",
        projectNamePlaceholder: "项目名称",
        projectLocation: "保存位置",
        projectLocationPlaceholder: "目录路径",
        browse: "浏览...",
        width: "宽度",
        height: "高度",
        resolutionPresets: "常用分辨率快捷预设",
        colorDepth: "颜色深度",
        lvglVersion: "LVGL 版本",
        compatible83: "兼容 8.3.x",
        createDirectory: "创建子文件夹",
        back: "返回",
        create: "创建"
    }
};

function getNewProjectWizardLabels() {
    return settingsController.locale.toLowerCase().startsWith("zh")
        ? NEW_PROJECT_WIZARD_LABELS.zh
        : NEW_PROJECT_WIZARD_LABELS.en;
}

function getTemplateListErrorMessage(code: string, isChinese: boolean) {
    if (code === "AUTH_REQUIRED" || code === "HTTP_401") {
        return isChinese ? "登录状态已失效，请重新登录。" : "Your session expired. Sign in again.";
    }
    if (code === "ACCESS_DENIED" || code === "HTTP_403") {
        return isChinese ? "当前账号没有查看模板的权限。" : "This account cannot view templates.";
    }
    if (code === "PUBLIC_API_NOT_CONFIGURED") {
        return isChinese ? "后台接口地址尚未配置。" : "The Public API URL is not configured.";
    }
    if (code === "PUBLIC_API_INVALID_RESPONSE") {
        return isChinese ? "后台返回的模板数据格式无效。" : "The backend returned an invalid template response.";
    }
    return isChinese
        ? NEW_PROJECT_WIZARD_LABELS.zh.templateLoadFailed
        : NEW_PROJECT_WIZARD_LABELS.en.templateLoadFailed;
}

function getTemplateCreateErrorMessage(code: string, isChinese: boolean) {
    if (code === "AUTH_REQUIRED" || code === "HTTP_401") {
        return isChinese
            ? "登录状态已失效，请重新登录。"
            : "Your session expired. Sign in again.";
    }
    if (code === "ACCESS_DENIED" || code === "HTTP_403") {
        return isChinese
            ? "当前账号没有下载此模板的权限。"
            : "This account cannot download this template.";
    }
    if (code === "TEMPLATE_TARGET_EXISTS") {
        return isChinese
            ? "目标文件夹或项目文件已存在，请更换名称或位置。"
            : "The destination already exists. Choose another name or location.";
    }
    if (code === "TEMPLATE_TARGET_NOT_EMPTY") {
        return isChinese
            ? "压缩包模板需要空目录，请勾选“创建子文件夹”或选择空目录。"
            : "ZIP templates need an empty folder. Create a subfolder or choose an empty folder.";
    }
    if (code === "TEMPLATE_FILE_TOO_LARGE") {
        return isChinese
            ? "模板文件超过允许的大小上限。"
            : "The template file exceeds the allowed size.";
    }
    if (code === "TEMPLATE_FILE_INTEGRITY_FAILED") {
        return isChinese
            ? "模板文件校验失败，请重试或联系管理员。"
            : "Template integrity verification failed. Retry or contact an administrator.";
    }
    if (code === "TEMPLATE_ARCHIVE_INVALID" || code === "TEMPLATE_FILE_INVALID") {
        return isChinese
            ? "模板文件无效或包含不安全内容。"
            : "The template is invalid or contains unsafe content.";
    }
    if (
        code === "TEMPLATE_DOWNLOAD_FAILED" ||
        code === "PUBLIC_API_UNAVAILABLE"
    ) {
        return isChinese
            ? "模板下载失败，请检查网络连接后重试。"
            : "Template download failed. Check the connection and retry.";
    }
    return isChinese ? "模板创建失败，请重试。" : "Could not create the template project. Retry.";
}

function formatTemplateFileSize(bytes: number) {
    if (bytes < 1024 * 1024) {
        return `${Math.ceil(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getTemplateCreateProgressText(
    progress: {
        stage: "authorizing" | "downloading" | "verifying" | "creating";
        receivedBytes?: number;
        totalBytes?: number;
    },
    isChinese: boolean
) {
    const labels = isChinese
        ? NEW_PROJECT_WIZARD_LABELS.zh
        : NEW_PROJECT_WIZARD_LABELS.en;
    if (
        progress.stage === "downloading" &&
        typeof progress.receivedBytes === "number" &&
        typeof progress.totalBytes === "number" &&
        progress.totalBytes > 0
    ) {
        const percent = Math.min(
            100,
            Math.floor((progress.receivedBytes / progress.totalBytes) * 100)
        );
        return `${labels.downloadingTemplate} ${percent}% (${formatTemplateFileSize(
            progress.receivedBytes
        )} / ${formatTemplateFileSize(progress.totalBytes)})`;
    }
    switch (progress.stage) {
        case "authorizing":
            return labels.authorizingTemplate;
        case "downloading":
            return labels.downloadingTemplate;
        case "verifying":
            return labels.verifyingTemplate;
        case "creating":
            return labels.creatingTemplate;
    }
}

export const NewProjectWizard = observer(
    class NewProjectWizard extends React.Component<
        {
            wizardModel: WizardModel;
            modalDialog: IObservableValue<any>;
        },
        {
            tempType: "" | "create";
            templateFilterType: string;
            templateFilterName: string;
        }
    > {
        constructor(props: any) {
            super(props);
            this.state = {
                tempType: "",
                templateFilterType: "",
                templateFilterName: ""
            };
        }

        componentDidMount() {
            this.props.wizardModel.mount();
        }

        componentWillUnmount() {
            this.props.wizardModel.unmount();
        }

        onCreateProject = async () => {
            const success = await this.props.wizardModel.createProject(
                this.props.modalDialog,
                false
            );
            if (success) {
                this.props.modalDialog.get()?.close();
            }
        };

        onBrowseDirectory = async () => {
            const result = await dialog.showOpenDialog(getCurrentWindow(), {
                properties: ["openDirectory"]
            });
            if (result.filePaths && result.filePaths[0]) {
                runInAction(() => {
                    this.props.wizardModel.location = result.filePaths[0];
                });
            }
        };

        render() {
            const { wizardModel } = this.props;
            const labels = getNewProjectWizardLabels();

            // If in examples catalog mode, preserve the tree & list view
            if (wizardModel.section === "examples") {
                return (
                    <div
                        className={classNames("EezStudio_NewProjectWizard", {
                            disabled: wizardModel.createProjectInProgress
                        })}
                    >
                        <SearchInput
                            searchText={wizardModel.searchText}
                            onClear={action(() => {
                                wizardModel.searchText = "";
                            })}
                            onChange={wizardModel.onSearchChange}
                        />

                        <div className="EezStudio_NewProjectWizard_Body">
                            {wizardModel.folders.children.length > 0 ? (
                                <>
                                    <div className="EezStudio_NewProjectWizard_Space"></div>
                                    <FoldersTree wizardModel={wizardModel} />
                                    <ProjectTypesList wizardModel={wizardModel} />
                                    <ProjectProperties
                                        wizardModel={wizardModel}
                                        modalDialog={this.props.modalDialog}
                                    />
                                </>
                            ) : (
                                <div className="EezStudio_NewProjectWizard_NoProjects">
                                    {labels.noExamplesFound}
                                </div>
                            )}
                        </div>
                    </div>
                );
            }

            const { tempType, templateFilterType, templateFilterName } = this.state;
            const isChinese = settingsController.locale.toLowerCase().startsWith("zh");

            // Filter applications by category and search name
            const allApps = wizardModel.projectTypes;
            const templateCategories = Array.from(
                new Set(allApps.map(getTemplateCategory))
            );
            const filteredApps = allApps.filter(p => {
                if (templateFilterType && templateFilterType !== "All") {
                    const cat = getTemplateCategory(p);
                    if (cat !== templateFilterType) return false;
                }
                if (templateFilterName && !p.projectName.toLowerCase().includes(templateFilterName.toLowerCase())) {
                    return false;
                }
                return true;
            });

            const selectedApp = wizardModel.selectedProjectType || allApps[0];
            const remoteLvglVersion = selectedApp?.remoteTemplate?.lvglVersion;
            const isV9 = (remoteLvglVersion || wizardModel.lvglVersion).startsWith("9");
            const selectedResolution = selectedApp?.remoteTemplate
                ? labels.resolutionFromTemplate
                : `${wizardModel.displayWidth} × ${wizardModel.displayHeight}`;


            return (
                <div
                    className={classNames("EezStudio_NewProjectWizard", "create-project", {
                        disabled: wizardModel.createProjectInProgress
                    })}
                >
                    {/* Top tab list: LVGL version switcher (Step 1) or current LVGL version display (Step 2) */}
                    <div className="tab-list">
                        <div className="version-tabs">
                            {selectedApp?.remoteTemplate ? (
                                <span className="active static-title">
                                    {remoteLvglVersion
                                        ? `LVGL ${remoteLvglVersion}`
                                        : labels.templateVersion}
                                </span>
                            ) : tempType === "create" ? (
                                <span className="active static-title">
                                    {isV9 ? "LVGL9" : "LVGL8"}
                                </span>
                            ) : (
                                <>
                                    <span
                                        className={isV9 ? "active" : ""}
                                        onClick={action(() => {
                                            wizardModel.lvglVersion = "9.3.0";
                                        })}
                                    >
                                        LVGL9
                                    </span>
                                    <span
                                        className={!isV9 ? "active" : ""}
                                        onClick={action(() => {
                                            wizardModel.lvglVersion = "8.4.0";
                                        })}
                                    >
                                        LVGL8
                                    </span>
                                </>
                            )}
                        </div>

                        {tempType !== "create" && (
                            <div className="select-info">
                                <span>
                                    {labels.template} : <strong>{selectedApp?.projectName || "None"}</strong>
                                </span>
                                <span>
                                    {labels.resolution} : <strong>{selectedResolution}</strong>
                                </span>
                            </div>
                        )}

                        <div className="create-btn-box">
                            {tempType !== "create" && (
                                <span
                                    className={classNames("create-btn", {
                                        disabled:
                                            !selectedApp ||
                                            wizardModel.templateListLoading
                                    })}
                                    title={
                                        selectedApp?.remoteTemplate
                                            ? labels.remoteCreatePending
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (selectedApp) {
                                            this.setState({ tempType: "create" });
                                        }
                                    }}
                                >
                                    {labels.createProject}
                                    <Icon
                                        icon="material:chevron_right"
                                        size={18}
                                        className="create-btn-arrow"
                                    />
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Step 1: Template selection box (single responsive gallery) */}
                    <div className={classNames("template-box", { hide: tempType === "create" })}>
                        <div className="board-template template-gallery">
                            <div className="search-bar">
                                <div className="search-item">
                                    <strong>{labels.selectTemplate}</strong>
                                    <div className="search-input-wrapper">
                                        <svg className="search-svg-icon" viewBox="64 64 896 896" width="14" height="14" fill="currentColor">
                                            <path d="M909.6 854.5L649.9 594.8C690.2 542.7 712 479 712 412c0-80.2-31.3-155.4-87.9-212.1-56.6-56.7-132-87.9-212.1-87.9s-155.5 31.3-212.1 87.9C143.2 256.5 112 331.8 112 412c0 80.1 31.3 155.5 87.9 212.1C256.5 680.8 331.8 712 412 712c67 0 130.6-21.8 182.7-62l259.7 259.6a8.2 8.2 0 0011.6 0l43.6-43.5a8.2 8.2 0 000-11.6zM570.4 570.4C528 612.7 471.8 636 412 636s-116-23.3-158.4-65.6C211.3 528 188 471.8 188 412s23.3-116.1 65.6-158.4C296 211.3 352.2 188 412 188s116.1 23.2 158.4 65.6S636 352.2 636 412s-23.3 116.1-65.6 158.4z" />
                                        </svg>
                                        <input
                                            type="text"
                                            placeholder={labels.filterByName}
                                            value={templateFilterName}
                                            onChange={e => this.setState({ templateFilterName: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="search-item category-filters">
                                    {["All", ...templateCategories].map(cat => (
                                        <label key={cat}>
                                            <input
                                                type="radio"
                                                hidden
                                                name="app_category"
                                                checked={(cat === "All" && !templateFilterType) || templateFilterType === cat}
                                                onChange={() => this.setState({ templateFilterType: cat === "All" ? "" : cat })}
                                            />
                                            <span>
                                                {cat === "All"
                                                    ? labels.categories.All
                                                    : getTemplateCategoryLabel(
                                                          cat,
                                                          isChinese
                                                      )}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="temp-box scroll-bar">
                                {wizardModel.templateListLoading ? (
                                    <div className="template-gallery-state">
                                        {labels.loadingTemplates}
                                    </div>
                                ) : wizardModel.templateListError &&
                                  filteredApps.length === 0 ? (
                                    <div className="template-gallery-state template-gallery-state--error">
                                        <span>
                                            {getTemplateListErrorMessage(
                                                wizardModel.templateListError,
                                                isChinese
                                            )}
                                        </span>
                                        <button
                                            type="button"
                                            className="template-retry-button"
                                            onClick={() =>
                                                void wizardModel.loadDigiwiseTemplates()
                                            }
                                        >
                                            {labels.retry}
                                        </button>
                                    </div>
                                ) : filteredApps.length === 0 ? (
                                    <div className="template-gallery-state">
                                        {wizardModel.digiwiseTemplates.length === 0
                                            ? labels.noTemplates
                                            : labels.noTemplateMatches}
                                    </div>
                                ) : filteredApps.map(projectType => {
                                    const isSelected = wizardModel.type === projectType.id;
                                    return (
                                        <div
                                            key={projectType.id}
                                            className={classNames("temp-item", { selected: isSelected })}
                                            onClick={() => wizardModel.changeType(projectType.id)}
                                            onDoubleClick={() => this.setState({ tempType: "create" })}
                                        >
                                            <label>
                                                <input
                                                    type="radio"
                                                    name="app_select"
                                                    hidden
                                                    checked={isSelected}
                                                    onChange={() => wizardModel.changeType(projectType.id)}
                                                />
                                                <div className="temp-item-card">
                                                    <div className="temp-item-img-box">
                                                        {renderPreviewImage(projectType.image)}
                                                    </div>
                                                    <h4>{projectType.projectName}</h4>
                                                    {projectType.remoteTemplate && (
                                                        <div className="template-card-meta">
                                                            <span>{projectType.remoteTemplate.projectType}</span>
                                                            <span>v{projectType.remoteTemplate.version}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </label>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Step 2: Parameter configuration form */}
                    <div className={classNames("create-form", { hide: tempType !== "create" })}>

                        <div className="form-content-split">
                            {/* Left side: Selected Template preview & summary */}
                            <div className="template-form-part">
                                <div className="view-item template-hero-card">
                                    <div className="view-item-preview">
                                        {renderPreviewImage(selectedApp?.image)}
                                    </div>
                                    <div className="view-item-info">
                                        <h1>{selectedApp?.projectName}</h1>
                                        <div className="template-meta-badge">
                                            <span className="badge-type">{selectedApp?.projectType}</span>
                                            <span className="badge-res">
                                                {selectedApp?.remoteTemplate
                                                    ? labels.resolutionFromTemplate
                                                    : `${wizardModel.displayWidth} × ${wizardModel.displayHeight}`}
                                            </span>
                                        </div>
                                        <p className="template-desc">{selectedApp?.description}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Right side: Info form */}
                            <div className="info-form-part">
                                <div className="input-box">
                                    <h5>{labels.projectName}</h5>
                                    <input
                                        type="text"
                                        placeholder={labels.projectNamePlaceholder}
                                        value={wizardModel.name || ""}
                                        onChange={action(e => {
                                            wizardModel.name = e.target.value;
                                        })}
                                    />
                                    {wizardModel.nameError && (
                                        <span className="form-error">{wizardModel.nameError}</span>
                                    )}
                                </div>

                                <div className="input-box">
                                    <h5>{labels.projectLocation}</h5>
                                    <div className="input-with-button">
                                        <input
                                            type="text"
                                            placeholder={labels.projectLocationPlaceholder}
                                            value={wizardModel.location || ""}
                                            onChange={action(e => {
                                                wizardModel.location = e.target.value;
                                            })}
                                        />
                                        <button type="button" onClick={this.onBrowseDirectory}>
                                            {labels.browse}
                                        </button>
                                    </div>
                                    {wizardModel.locationError && (
                                        <span className="form-error">{wizardModel.locationError}</span>
                                    )}
                                </div>

                                {!selectedApp?.remoteTemplate && (
                                <div className="board-size">
                                    <div className="input-box">
                                        <h5>{labels.width}</h5>
                                        <input
                                            type="number"
                                            value={wizardModel.displayWidth}
                                            onChange={action(e => {
                                                wizardModel.displayWidth = parseInt(e.target.value) || 800;
                                            })}
                                        />
                                    </div>
                                    <div className="input-box">
                                        <h5>{labels.height}</h5>
                                        <input
                                            type="number"
                                            value={wizardModel.displayHeight}
                                            onChange={action(e => {
                                                wizardModel.displayHeight = parseInt(e.target.value) || 480;
                                            })}
                                        />
                                    </div>
                                </div>
                                )}

                                {!selectedApp?.remoteTemplate && (
                                <div className="input-box">
                                    <h5>{labels.resolutionPresets}</h5>
                                    <div className="resolution-presets">
                                        {[
                                            { w: 800, h: 480, label: "800×480" },
                                            { w: 480, h: 320, label: "480×320" },
                                            { w: 1024, h: 600, label: "1024×600" },
                                            { w: 480, h: 272, label: "480×272" },
                                            { w: 320, h: 240, label: "320×240" },
                                            { w: 240, h: 240, label: "240×240" }
                                        ].map(preset => (
                                            <button
                                                type="button"
                                                key={preset.label}
                                                className={classNames("preset-btn", {
                                                    active: wizardModel.displayWidth === preset.w && wizardModel.displayHeight === preset.h
                                                })}
                                                onClick={action(() => {
                                                    wizardModel.displayWidth = preset.w;
                                                    wizardModel.displayHeight = preset.h;
                                                })}
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                )}

                                {!selectedApp?.remoteTemplate && (
                                <div className="input-box">
                                    <h5>{labels.colorDepth}</h5>
                                    <select
                                        value={wizardModel.colorDepth}
                                        onChange={action(e => {
                                            wizardModel.colorDepth = e.target.value;
                                        })}
                                    >
                                        <option value="16">16-bit (RGB565)</option>
                                        <option value="24">24-bit (RGB888)</option>
                                        <option value="32">32-bit (ARGB8888)</option>
                                    </select>
                                </div>
                                )}

                                {!selectedApp?.remoteTemplate && selectedApp?.projectType === PROJECT_TYPE_NAMES[ProjectType.LVGL] && (
                                    <div className="input-box">
                                        <h5>{labels.lvglVersion}</h5>
                                        <select
                                            value={wizardModel.lvglVersion}
                                            onChange={action(e => {
                                                wizardModel.lvglVersion = e.target.value as any;
                                            })}
                                        >
                                            {isV9 ? (
                                                <>
                                                    <option value="9.3.0">9.3.0</option>
                                                    <option value="9.2.2">9.2.2</option>
                                                    <option value="9.4.0">9.4.0</option>
                                                    <option value="9.5.0">9.5.0</option>
                                                </>
                                            ) : (
                                                <option value="8.4.0">8.4.0 ({labels.compatible83})</option>
                                            )}
                                        </select>
                                    </div>
                                )}

                                <div className="input-box">
                                    <div className="form-check">
                                        <input
                                            type="checkbox"
                                            id="create-directory-cb"
                                            checked={wizardModel.createDirectory}
                                            onChange={action(e => {
                                                wizardModel.createDirectory = e.target.checked;
                                            })}
                                        />
                                        <label htmlFor="create-directory-cb">
                                            {labels.createDirectory}
                                        </label>
                                    </div>
                                </div>

                                {wizardModel.projectCreationError && (
                                    <div className="alert alert-danger" style={{ marginTop: 10 }}>
                                        {wizardModel.projectCreationError}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Bottom buttons */}
                        <div className="create-bottom">
                            <div id="_cancel" onClick={() => this.setState({ tempType: "" })}>
                                {labels.back}
                            </div>
                            <div id="_finish" onClick={this.onCreateProject}>
                                {labels.create}
                            </div>
                        </div>
                    </div>

                    {/* Progress overlay */}
                    {wizardModel.createProjectInProgress && (
                        <div className="progress-box">
                            <Loader />
                            <p>{wizardModel.progress || "Creating project..."}</p>
                        </div>
                    )}
                </div>
            );
        }
    }
);

export function showNewProjectWizard() {
    const modalDialogObservable = observable.box<any>();

    const [modalDialog] = showDialog(
        <NewProjectWizard
            wizardModel={wizardModelTemplates}
            modalDialog={modalDialogObservable}
        />,
        {
            jsPanel: {
                id: "new-project-wizard",
                title: getNewProjectWizardLabels().title,
                width: 1280,
                height: 800
            }
        }
    );

    modalDialogObservable.set(modalDialog);
}

class NameInput extends React.Component<{
    id?: string;
    value: string | undefined;
    onChange: (value: string | undefined) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}> {
    render() {
        return (
            <input
                type="text"
                id={this.props.id}
                className="form-control"
                value={this.props.value || ""}
                onChange={event => this.props.onChange(event.target.value)}
                onKeyDown={this.props.onKeyDown}
            />
        );
    }
}

class DirectoryBrowserInput extends React.Component<{
    id?: string;
    value: string | undefined;
    onChange: (value: string | undefined) => void;
}> {
    onSelect = async () => {
        const result = await dialog.showOpenDialog(getCurrentWindow(), {
            properties: ["openDirectory"]
        });

        if (result.filePaths && result.filePaths[0]) {
            this.props.onChange(result.filePaths[0]);
        }
    };

    render() {
        return (
            <div className="input-group">
                <input
                    type="text"
                    id={this.props.id}
                    className="form-control"
                    value={this.props.value || ""}
                    onChange={event => this.props.onChange(event.target.value)}
                />
                <>
                    <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={this.onSelect}
                    >
                        &hellip;
                    </button>
                </>
            </div>
        );
    }
}

class FileBrowserInput extends React.Component<{
    id?: string;
    value: string | undefined;
    onChange: (value: string | undefined) => void;
}> {
    onSelect = async () => {
        const result = await dialog.showOpenDialog(getCurrentWindow(), {
            properties: ["openFile"],
            filters: [
                { name: "EEZ Project", extensions: ["eez-project"] },
                { name: "All Files", extensions: ["*"] }
            ]
        });

        if (result.filePaths && result.filePaths[0]) {
            this.props.onChange(result.filePaths[0]);
        }
    };

    render() {
        return (
            <div className="input-group">
                <input
                    type="text"
                    id={this.props.id}
                    className="form-control"
                    value={this.props.value || ""}
                    onChange={event => this.props.onChange(event.target.value)}
                />
                <>
                    <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={this.onSelect}
                    >
                        &hellip;
                    </button>
                </>
            </div>
        );
    }
}

function openLink(url: string) {
    const { shell } = require("electron");
    shell.openExternal(url);
}

export async function confirmOverwrite(description: string) {
    const yesButton = {
        label: "Yes",
        result: true
    };
    const noButton = { label: "No", result: false };

    const os = require("os");

    const buttons: any[] = [];
    if (os.platform() == "win32") {
        buttons.push(yesButton, noButton);
    } else if (os.platform() == "linux") {
        buttons.push(noButton, yesButton);
    } else {
        buttons.push(yesButton, noButton);
    }

    let opts: Electron.MessageBoxOptions = {
        type: "warning",
        title: "DigiStudio",
        message: "Overwite?",
        detail: description,
        noLink: true,
        buttons: buttons.map(b => b.label),
        defaultId: os.platform() == "linux" ? 0 : 1,
        cancelId: buttons.indexOf(noButton)
    };

    const result = await dialog.showMessageBox(getCurrentWindow(), opts);
    const buttonIndex = result.response;
    return buttons[buttonIndex].result;
}

const Count = observer(
    ({
        label,
        count,
        attention
    }: {
        label: string;
        count: number | undefined;
        attention: boolean;
    }) => {
        return (
            <>
                <span>
                    {label}{" "}
                    {attention && (
                        <div className="EezStudio_AttentionContainer">
                            <div className="EezStudio_AttentionDiv" />
                        </div>
                    )}
                </span>
                {count != undefined && (
                    <span
                        className={classNames(
                            "badge rounded-pill bg-secondary"
                        )}
                    >
                        {count}
                    </span>
                )}
            </>
        );
    }
);
