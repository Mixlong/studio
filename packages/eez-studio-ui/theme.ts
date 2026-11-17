import { settingsController } from "home/settings";

export interface ThemeInterface {
    backgroundColor: string;
    borderColor: string;
    panelHeaderColor: string;
    selectionBackgroundColor: string;
    connectionLineColor: string;
    selectedConnectionLineColor: string;
    seqConnectionLineColor: string;
    activeConnectionLineColor: string;
    disabledLineColor: string;
}

export const lightTheme: ThemeInterface = {
    backgroundColor: "white",
    borderColor: "#e0e0e0",
    panelHeaderColor: "#f0f0f0",
    selectionBackgroundColor: "#ffb500",
    connectionLineColor: "#999",
    selectedConnectionLineColor: "red",
    seqConnectionLineColor: "#ffb500",
    activeConnectionLineColor: "#d49b05",
    disabledLineColor: "#aaa"
};

export const darkTheme: ThemeInterface = {
    backgroundColor: "#222222",
    borderColor: "#444444",
    panelHeaderColor: "#333333",
    selectionBackgroundColor: "#ffb500",
    connectionLineColor: "#999",
    selectedConnectionLineColor: "red",
    seqConnectionLineColor: "#ffb500",
    activeConnectionLineColor: "#d49b05",
    disabledLineColor: "#999"
};

export const theme = () =>
    settingsController.isDarkTheme ? darkTheme : lightTheme;
