import { dialog, getCurrentWindow } from "@electron/remote";
import { getLocale } from "eez-studio-shared/i10n";

const isChinese = () => getLocale().toLowerCase().startsWith("zh");

export function info(message: string, detail: string | undefined) {
    return dialog.showMessageBox(getCurrentWindow(), {
        type: "info",
        title: "EEZ Studio",
        message: message,
        detail: detail,
        noLink: true,
        buttons: [isChinese() ? "确定" : "OK"]
    });
}

export function error(message: string, detail: string | undefined) {
    return dialog.showMessageBox(getCurrentWindow(), {
        type: "error",
        title: "EEZ Studio",
        message: message,
        detail: detail,
        noLink: true,
        buttons: ["OK"]
    });
}

export async function confirm(
    message: string,
    detail: string | undefined,
    callback: () => void,
    cancelCallback?: () => void
) {
    const result = await dialog.showMessageBox(getCurrentWindow(), {
        type: "question",
        title: "EEZ Studio",
        message: message,
        detail: detail,
        noLink: true,
        buttons: isChinese() ? ["是", "否"] : ["Yes", "No"],
        cancelId: 1
    });
    const buttonIndex = result.response;
    if (buttonIndex == 0) {
        callback();
    } else if (cancelCallback) {
        cancelCallback();
    }
}

export async function confirmPromise(
    message: string,
    detail: string | undefined
) {
    const result = await dialog.showMessageBox(getCurrentWindow(), {
        type: "question",
        title: "EEZ Studio",
        message: message,
        detail: detail,
        noLink: true,
        buttons: ["Yes", "No"],
        cancelId: 1
    });
    const buttonIndex = result.response;
    if (buttonIndex == 0) {
        return true;
    }
    return false;
}

export async function confirmWithButtons(
    message: string,
    detail: string | undefined,
    buttons: string[]
) {
    const result = await dialog.showMessageBox(getCurrentWindow(), {
        type: "question",
        title: "EEZ Studio",
        message: message,
        detail: detail,
        noLink: true,
        buttons: buttons && buttons.length ? buttons : (isChinese() ? ["是", "否"] : ["Yes", "No"]),
        cancelId: 1
    });
    return result.response;
}
