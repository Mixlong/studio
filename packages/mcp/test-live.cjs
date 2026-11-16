/* Read-only live MCP bridge integration check (requires DigiStudio MCP enabled).
 * Does not edit the current project or Codex configuration.
 */
(async () => {
    const { callBridge } = await import("./bridge-client.mjs");
    const capabilities = await callBridge("get_mcp_capabilities", {});
    if (!Array.isArray(capabilities.readTools) ||
        !Array.isArray(capabilities.writeTools) ||
        !Array.isArray(capabilities.creatableWidgetTypes) ||
        !capabilities.writeTools.includes("bind_widget_variable") ||
        !capabilities.writeTools.includes("import_bitmap")) {
        throw new Error("Running IDE has stale MCP capabilities; save work and restart DigiwiseStudio");
    }
    console.log("PASS live capabilities: " + capabilities.readTools.length +
        " read / " + capabilities.writeTools.length + " write tools / " +
        capabilities.creatableWidgetTypes.length + " palette widgets");
    const project = await callBridge("get_current_project", {});
    const pages = (await callBridge("list_pages", {})).pages;
    const styles = await callBridge("list_styles", {});
    const assets = await callBridge("list_assets", {});
    if (!Array.isArray(pages) || !Array.isArray(styles.styles) ||
        !Array.isArray(assets.fonts) || !Array.isArray(assets.bitmaps)) {
        throw new Error("Unexpected MCP resource response");
    }
    console.log("PASS project: " + project.pageCount + " pages, LVGL " + project.lvglVersion);
    console.log("PASS styles: " + styles.styleCount);
    console.log("PASS assets: " + assets.fontCount + " fonts; " + assets.bitmapCount + " bitmaps");
    if (styles.styles.length) {
        const style = await callBridge("get_style", {
            stylePath: styles.styles[0].stylePath
        });
        if (!style || !style.definition) throw new Error("Style detail unavailable");
        console.log("PASS style detail");
    }
    if (pages.length) {
        const page = pages.find(item => item.componentCount <= 30) || pages[0];
        const widgets = await callBridge("list_widgets", { pageName: page.name });
        const events = await callBridge("list_widget_events", { pageName: page.name });
        if (!Array.isArray(widgets.widgets) || !Array.isArray(events.bindings)) {
            throw new Error("Unexpected widget/event structure");
        }
        console.log("PASS widget tree + event list: " + widgets.widgetCount + " widgets");
        if (widgets.widgets.length) {
            const details = await callBridge("get_widget_details", {
                pageName: page.name,
                widgetPath: widgets.widgets[0].widgetPath
            });
            if (!details || !Array.isArray(details.eventHandlers)) {
                throw new Error("Widget details unavailable");
            }
            console.log("PASS widget details");
            const schema = await callBridge("get_widget_schema", {
                pageName: page.name,
                widgetPath: widgets.widgets[0].widgetPath
            });
            if (!Array.isArray(schema.properties) ||
                !Array.isArray(schema.supportedParts)) {
                throw new Error("Widget property schema unavailable");
            }
            console.log("PASS widget property schema: " + schema.properties.length + " properties");
        }
    }
    console.log("PASS all available expanded read-only tools");
})().catch(error => {
    console.error("FAIL live MCP: " + (error.code || "UNAVAILABLE") + " " + error.message);
    console.error("If DigiStudio is already running, save your work and restart it to load the new MCP handlers.");
    process.exitCode = 1;
});
