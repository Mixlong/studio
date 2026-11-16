/** Keep save/quit handshake reachable when no other visible editor window exists. */
export function shouldHideWindowOnClose(
    hideOnClose: boolean,
    forceQuit: boolean,
    otherVisibleWindows: number
): boolean {
    return hideOnClose && !forceQuit && otherVisibleWindows > 0;
}
