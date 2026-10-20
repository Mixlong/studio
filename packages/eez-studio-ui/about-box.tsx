import React from "react";
import { observer } from "mobx-react";

import { formatDateTimeLong } from "eez-studio-shared/util";
import { showDialog, Dialog } from "eez-studio-ui/dialog";

import { settingsController } from "home/settings";

const STUDIO_HOME_PAGE_URL =
    "https://www.envox.hr/eez/studio/studio-introduction.html";

function openLink(url: string) {
    const { shell } = require("electron");
    shell.openExternal(url);
}

const AboutBox = observer(
    class AboutBox extends React.Component {
        packageJSON: {
            version: string;
        };

        constructor(props: any) {
            super(props);

            this.packageJSON = require("../../package.json");
        }

        render() {
            var fs = require("fs");
            var stats = fs.statSync(process.execPath);
            var mtime = new Date(stats.mtime);
            var buildDate = mtime.toString();

            return (
                <Dialog cancelButtonText="Close">
                    <div className="EezStudio_AboutBox">
                        <div className="EezStudio_Logo">
                            <img
                                src={
                                    settingsController.isDarkTheme
                                        ? "../eez-studio-ui/_images/eez_studio_logo_with_title_dark.png"
                                        : "../eez-studio-ui/_images/eez_studio_logo_with_title.png"
                                }
                            ></img>
                        </div>

                        <div className="EezStudio_Version">
                            Version {this.packageJSON.version}
                        </div>

                        <div className="EezStudio_BuildDate">
                            Build date {formatDateTimeLong(new Date(buildDate))}
                        </div>

                        <div className="EezStudio_VersionInfo">
                            Updates are checked automatically when the app starts.
                        </div>

                        <div className="EezStudio_Links">
                            <a
                                href="#"
                                onClick={event => {
                                    event.preventDefault();
                                    openLink(STUDIO_HOME_PAGE_URL);
                                }}
                            >
                                Home
                            </a>
                        </div>
                    </div>
                </Dialog>
            );
        }
    }
);

export function showAboutBox() {
    showDialog(<AboutBox />);
}
