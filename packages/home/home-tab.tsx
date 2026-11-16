import React from "react";
import fs from "fs";
import path from "path";
import { action, observable, makeObservable, autorun } from "mobx";
import { observer } from "mobx-react";
import classNames from "classnames";
import { ipcRenderer } from "electron";

import { Icon } from "eez-studio-ui/icon";

import { Settings, settingsController } from "home/settings";
import {
    NewProjectWizard,
    wizardModelTemplates,
    wizardModelExamples
} from "project-editor/project/ui/Wizard";
import {
    ExtensionsManager
} from "./extensions-manager/extensions-manager";
import { Projects } from "home/open-projects";
import { Instruments, defaultInstrumentsStore } from "home/instruments";
import { instrumentDatabases } from "eez-studio-shared/db";
import { productConfig } from "eez-studio-shared/product-config";
import * as notification from "eez-studio-ui/notification";
import { studioVersion } from "eez-studio-shared/util";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import {
    DigiwiseChangelog,
    DigiwiseChangelogIdentity,
    DigiwiseChangelogLanguage,
    validateDigiwiseChangelog
} from "eez-studio-shared/digiwise-changelog";
import { getHomePath } from "eez-studio-shared/util-electron";
import {
    DigiwiseAccount,
    DigiwiseLoginNav
} from "home/digiwise-account";

////////////////////////////////////////////////////////////////////////////////

const SAVED_OPTIONS_VERSION = 2;

type HomeTabId =
    | "open"
    | "lvgl8"
    | "lvgl9"
    | "create"
    | "examples"
    | "run"
    | "instruments"
    | "extensions"
    | "account"
    | "settings";

function normalizeHomeTabId(value: unknown): HomeTabId {
    const homeTabIds: HomeTabId[] = [
        "open",
        "lvgl8",
        "lvgl9",
        "create",
        "examples",
        "run",
        "instruments",
        "extensions",
        "account",
        "settings"
    ];

    if (!homeTabIds.includes(value as HomeTabId) || value == "account") {
        return "open";
    }

    if (value == "examples" && !productConfig.examplesCatalog.enabled) {
        return "open";
    }

    if (
        value == "extensions" &&
        !productConfig.extensionsCatalog.enabled
    ) {
        return "open";
    }

    return value as HomeTabId;
}

class HomeTabStore {
    activeTab: HomeTabId = "open";

    constructor() {
        this.loadOptions();

        makeObservable(this, {
            activeTab: observable
        });

        autorun(() => this.saveOptions());
    }

    loadOptions() {
        const optionsJSON = window.localStorage.getItem("home-tab-options");
        if (optionsJSON) {
            try {
                const options = JSON.parse(optionsJSON);
                if (options.version == SAVED_OPTIONS_VERSION) {
                    // Migrate sessions that were last opened on the removed
                    // upstream Examples page.
                    this.activeTab = normalizeHomeTabId(options.activeTab);
                }
            } catch (err) {
                console.error(err);
            }
        }
    }

    saveOptions() {
        window.localStorage.setItem(
            "home-tab-options",
            JSON.stringify({
                version: SAVED_OPTIONS_VERSION,

                activeTab: this.activeTab
            })
        );
    }
}

export const homeTabStore = new HomeTabStore();

const DIGIRIDE_PROJECT_ASSET = path.join(
    __dirname,
    "product-projects",
    "DigiRide.eez-project"
);

export async function openDigiRideProject() {
    const projectDirectory = getHomePath(
        path.join("eez-projects", "DigiRide")
    );
    const projectFilePath = path.join(
        projectDirectory,
        "DigiRide.eez-project"
    );

    try {
        await fs.promises.mkdir(projectDirectory, { recursive: true });

        if (!fs.existsSync(projectFilePath)) {
            await fs.promises.copyFile(
                DIGIRIDE_PROJECT_ASSET,
                projectFilePath
            );
        }

        ipcRenderer.send("open-file", projectFilePath, false);
    } catch (err) {
        console.error(err);
        notification.error(`Failed to open DigiRide project: ${err}`);
    }
}

////////////////////////////////////////////////////////////////////////////////

// The reference home page uses Font Awesome's solid 15px navigation glyphs.
// These code points use the icon font already bundled with DigiStudio.
const homeIcon = (glyph: string) => (
    <i className="font-awesome-icons" aria-hidden="true">
        {glyph}
    </i>
);

const HomeNavigationItem = (props: {
    icon: string | React.ReactNode;
    label: string;
    title: string;
    selected?: boolean;
    attention?: boolean;
    onClick: () => void;
}) => {
    return (
        <button
            type="button"
            className={classNames("EezStudio_HomeTab_NavigationItem", {
                selected: props.selected
            })}
            title={props.title}
            aria-current={props.selected ? "page" : undefined}
            onClick={props.onClick}
        >
            <span className="EezStudio_HomeTab_NavigationIcon" aria-hidden="true">
                <Icon
                    icon={props.icon}
                    size={15}
                    attention={props.attention}
                />
            </span>
            <span>{props.label}</span>
        </button>
    );
};

////////////////////////////////////////////////////////////////////////////////

const HomeLatestChangesPanel = observer(() => {
    const isChinese = settingsController.locale.toLowerCase().startsWith("zh");
    const language: DigiwiseChangelogLanguage = isChinese ? "zh-CN" : "en-US";
    const [activeTab, setActiveTab] = React.useState("");
    const [content, setContent] = React.useState<DigiwiseChangelog | null>(null);
    const [installedVersion, setInstalledVersion] = React.useState(studioVersion);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        setContent(null);
        setActiveTab("");

        const load = async () => {
            try {
                const identity = (await ipcRenderer.invoke(
                    "digistudio:release:identity"
                )) as DigiwiseChangelogIdentity;
                if (!active) return;
                if (typeof identity?.version !== "string" ||
                    (identity.channel !== "stable" && identity.channel !== "dev")) {
                    return;
                }
                setInstalledVersion(identity.version);
                const cacheKey = [
                    "digiwise-ide-changelog-v1",
                    identity.channel,
                    identity.version,
                    language
                ].join(":");
                // Cache is never allowed to supply content for another version/channel/language.
                try {
                    const cached = window.localStorage.getItem(cacheKey);
                    if (cached && active) {
                        setContent(validateDigiwiseChangelog(
                            JSON.parse(cached), identity, language
                        ));
                    }
                } catch (_error) {
                    // Bad/old cache cannot replace the current release's content.
                }

                const response = await ipcRenderer.invoke(
                    "digistudio:release:changelog", language
                ) as DigiwiseIpcResult<DigiwiseChangelog>;
                if (!active || !response.ok) return;
                const latest = validateDigiwiseChangelog(
                    response.data, identity, language
                );
                setContent(latest);
                try {
                    window.localStorage.setItem(cacheKey, JSON.stringify(latest));
                } catch (_error) {
                    // Private mode / disabled storage: remote content is still usable.
                }
            } catch (_error) {
                // No cross-version or hardcoded fallback; same-version cache, if any,
                // remains visible when the service cannot be reached.
            } finally {
                if (active) setLoading(false);
            }
        };
        void load();
        return () => { active = false; };
    }, [language]);

    const updateTabs = content?.groups || [];
    const selectedTab = updateTabs.find(tab => tab.code === activeTab) || updateTabs[0];

    return (
        <aside className="EezStudio_HomeTab_Updates"
            aria-label={isChinese ? "最新变动" : "Latest changes"}>
            <h2 className="EezStudio_HomeTab_UpdatesHeading">
                {isChinese ? "最新变动" : "Latest Changes"}
            </h2>
            <div className="EezStudio_HomeTab_UpdatesBanner">
                <strong>DigiwiseStudio</strong>
                <span>
                    {isChinese
                        ? "当前版本 " + installedVersion + " · 更新内容"
                        : "Current version " + installedVersion + " · Release notes"}
                </span>
            </div>
            <section className="EezStudio_HomeTab_UpdatesFeature">
                <h3>{isChinese ? "新功能介绍" : "What's New"}</h3>
                {selectedTab ? (
                    <>
                        <div className="EezStudio_HomeTab_UpdatesTabs"
                            role="tablist"
                            aria-label={isChinese ? "更新分类" : "Update categories"}>
                            {updateTabs.map(tab => (
                                <button
                                    key={tab.code}
                                    id={`home-update-tab-${tab.code}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={tab.code === selectedTab.code}
                                    aria-controls="home-update-panel"
                                    className={classNames({
                                        selected: tab.code === selectedTab.code
                                    })}
                                    onClick={() => setActiveTab(tab.code)}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        <div id="home-update-panel"
                            className="EezStudio_HomeTab_UpdatesDetails"
                            role="tabpanel"
                            aria-labelledby={`home-update-tab-${selectedTab.code}`}>
                            <h4>{selectedTab.title}</h4>
                            <ul>
                                {selectedTab.items.map((item, index) => (
                                    <li key={index}>{item}</li>
                                ))}
                            </ul>
                        </div>
                    </>
                ) : (
                    <div className="EezStudio_HomeTab_UpdatesDetails">
                        <p>{loading
                            ? (isChinese ? "正在加载更新内容…" : "Loading release notes…")
                            : (isChinese
                                ? "当前版本暂无已发布的更新内容"
                                : "No published release notes for this version")}</p>
                    </div>
                )}
            </section>
        </aside>
    );
});

export const Home = observer(
    class Home extends React.Component {
        render() {
            const isChinese = settingsController.locale.toLowerCase().startsWith("zh");
            const pageTitle =
                homeTabStore.activeTab == "settings"
                    ? isChinese ? "IDE 设置" : "IDE Settings"
                    : homeTabStore.activeTab == "account"
                      ? isChinese ? "账号与授权" : "Account and license"
                    : homeTabStore.activeTab == "create"
                      ? isChinese ? "新建" : "New"
                      : isChinese ? "首页" : "Home";

            return (
                <div className={classNames("EezStudio_HomeTab", {
                    "EezStudio_HomeTab--settings": homeTabStore.activeTab == "settings"
                })}>
                    <header className="EezStudio_HomeTab_Header" aria-label="DigiStudio Home">
                        <div className="EezStudio_HomeTab_HeaderBrand">
                            <img
                                className="EezStudio_HomeTab_HeaderLogo"
                                src="_images/digiwise-logo-dark-bg.svg"
                                alt="DIGIWISE"
                                draggable={false}
                            />
                        </div>
                        <h1 className="EezStudio_HomeTab_HeaderPageTitle">{pageTitle}</h1>
                    </header>
                    <div className="EezStudio_HomeTab_Workspace">
                    <aside className="EezStudio_HomeTab_Navigation" aria-label={isChinese ? "首页导航" : "Home Navigation"}>
                        <div className="EezStudio_HomeTab_NavigationPrimary">
                            <HomeNavigationItem
                                icon={homeIcon("\uf015")}
                                label={isChinese ? "首页" : "Home"}
                                title={isChinese ? "最近项目" : "Recent projects"}
                                selected={homeTabStore.activeTab == "open" || homeTabStore.activeTab == "lvgl8" || homeTabStore.activeTab == "lvgl9"}
                                onClick={action(() => { homeTabStore.activeTab = "open"; })}
                            />
                            <HomeNavigationItem
                                icon={homeIcon("\uf15b")}
                                label={isChinese ? "新建" : "New"}
                                title={isChinese ? "新建项目" : "Create a new project"}
                                selected={homeTabStore.activeTab == "create"}
                                onClick={action(() => { homeTabStore.activeTab = "create"; })}
                            />
                            <HomeNavigationItem
                                icon={homeIcon("\uf07c")}
                                label={isChinese ? "导入" : "Import"}
                                title={isChinese ? "打开本地项目" : "Open a local project"}
                                onClick={() => { ipcRenderer.send("open-project"); }}
                            />
                        </div>
                        <div className="EezStudio_HomeTab_NavigationGroup">
                            <div className="EezStudio_HomeTab_NavigationGroupTitle">{isChinese ? "系统设置" : "System"}</div>
                            <HomeNavigationItem
                                icon={homeIcon("\uf013")}
                                label={isChinese ? "IDE" : "Settings"}
                                title={isChinese ? "全局设置" : "Global settings"}
                                selected={homeTabStore.activeTab == "settings"}
                                attention={instrumentDatabases.activeDatabase?.isCompactDatabaseAdvisable}
                                onClick={action(() => { homeTabStore.activeTab = "settings"; })}
                            />
                        </div>
                        <DigiwiseLoginNav />
                    </aside>

                    <div className="EezStudio_HomeTab_Body">
                        {(homeTabStore.activeTab == "open" ||
                            homeTabStore.activeTab == "lvgl8" ||
                            homeTabStore.activeTab == "lvgl9") && (
                            <div className="EezStudio_HomeTab_Dashboard">
                                <div className="EezStudio_HomeTab_ProjectWorkspace">
                                    <div className="EezStudio_HomeTab_ProjectTabs" role="tablist" aria-label={isChinese ? "按 LVGL 版本分类的项目" : "Projects by LVGL version"}>
                                        <button type="button" role="tab" aria-selected={homeTabStore.activeTab == "open"}
                                            className={classNames({ selected: homeTabStore.activeTab == "open" })}
                                            onClick={action(() => { homeTabStore.activeTab = "open"; })}
                                        >{isChinese ? "最近" : "Recent"}</button>
                                        <button type="button" role="tab" aria-selected={homeTabStore.activeTab == "lvgl9"}
                                            className={classNames({ selected: homeTabStore.activeTab == "lvgl9" })}
                                            onClick={action(() => { homeTabStore.activeTab = "lvgl9"; })}
                                        >LVGL9</button>
                                        <button type="button" role="tab" aria-selected={homeTabStore.activeTab == "lvgl8"}
                                            className={classNames({ selected: homeTabStore.activeTab == "lvgl8" })}
                                            onClick={action(() => { homeTabStore.activeTab = "lvgl8"; })}
                                        >LVGL8</button>
                                    </div>
                                <Projects
                                    lvglVersionFilter={
                                        homeTabStore.activeTab == "lvgl8"
                                            ? "8"
                                            : homeTabStore.activeTab == "lvgl9"
                                              ? "9"
                                              : undefined
                                    }
                                />
                                </div>
                                <HomeLatestChangesPanel />
                            </div>
                        )}
                        {homeTabStore.activeTab == "create" && (
                            <NewProjectWizard
                                wizardModel={wizardModelTemplates}
                                modalDialog={observable.box<any>()}
                            />
                        )}
                        {productConfig.examplesCatalog.enabled &&
                            homeTabStore.activeTab == "examples" && (
                                <NewProjectWizard
                                    wizardModel={wizardModelExamples}
                                    modalDialog={observable.box<any>()}
                                />
                            )}
                        {/*
                        homeTabStore.activeTab == "run" && (
                            <div style={{ margin: "auto" }}></div>
                        )
                        */}
                        {homeTabStore.activeTab == "instruments" && (
                            <Instruments
                                instrumentsStore={defaultInstrumentsStore}
                                size="M"
                            />
                        )}
                        {productConfig.extensionsCatalog.enabled &&
                            homeTabStore.activeTab == "extensions" && (
                                <ExtensionsManager />
                            )}
                        {homeTabStore.activeTab == "account" && <DigiwiseAccount />}
                        {homeTabStore.activeTab == "settings" && <Settings />}
                    </div>
                    </div>
                </div>
            );
        }
    }
);
