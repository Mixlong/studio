/* Read-only extended MCP adapter tests; no Electron process required. */
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
class LVGLWidget {
    constructor(type, identifier, children = []) {
        Object.assign(this, { type, identifier, children, left: 4, top: 8,
            width: 100, height: 24, useStyle: "Primary", eventHandlers: [],
            localStyles: { definition: { MAIN: { DEFAULT: { bg_color: "#f0b500" } } } }
        });
    }
}
const original = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "project-editor/project-editor-interface") return { ProjectEditor: { build: { buildProject: async () => undefined } } };
    if (request === "project-editor/store/output-sections") return { Section: { OUTPUT: 1 } };
    if (request === "project-editor/lvgl/widgets/Base") return { LVGLWidget };
    if (request === "project-editor/core/object") return { getClassesDerivedFrom: () => [], getClassInfo: widget => widget.classInfo || { properties: [], lvgl: { parts: ["MAIN"] } }, PropertyType: { Number:3,Boolean:2,String:5,Enum:4,Color:8,ThemedColor:9,ObjectReference:12 }, TYPE_NAMES: {} };
    if (request === "project-editor/lvgl/style-catalog") return { lvglPropertiesMap: new Map() };
    return original.apply(this, arguments);
};
let runReadTool, getMcpCapabilitiesWithoutProject;
try {
    ({ runReadTool, getMcpCapabilitiesWithoutProject } = require(path.resolve(__dirname, "../../build/mcp/adapter/read-tools.js")));
} finally { Module._load = original; }

const beforeProject = getMcpCapabilitiesWithoutProject();
assert.equal(beforeProject.projectAvailable, false);
assert.ok(beforeProject.writeTools.includes("create_project"));
assert.equal(beforeProject.canvasSnapshot.tool, "get_canvas_snapshot");
assert.deepEqual(beforeProject.creatableWidgetTypes, []);
const child = new LVGLWidget("LVGLLabelWidget", "caption");
child.eventHandlers = [
    { eventName:"CLICKED", handlerType:"action", action:"NavigateHome" }
];
const root = new LVGLWidget("LVGLButtonWidget", "button1", [child]);
const store = {
    filePath:"C:/projects/test.eez-project",
    isModified:false,
    project:{
        settings:{general:{projectType:"lvgl",lvglVersion:"8.4.0",displayWidth:800,displayHeight:480}},
        pages:[{name:"Home",width:800,height:480,components:[root]}],
        lvglStyles:{
            styles:[{
                name:"Primary",forWidgetType:"LVGLButtonWidget",
                definition:{definition:{MAIN:{DEFAULT:{bg_color:"#ffb500", radius:12,
                    long_value:"x".repeat(1000),
                    dynamic:{type:"expression", value:"dangerousInternalCode()"} }}}},
                childStyles:[{name:"Caption",forWidgetType:"LVGLLabelWidget",
                    childStyles:[], definition:{definition:{MAIN:{PRESSED:{text_color:"#fff"}}}}}]
            }],
            defaultStyles:{LVGLButtonWidget:"Primary"}
        },
        fonts:[{name:"Roboto",renderingEngine:"freetype",height:18,bpp:4,glyphs:[{},{}],alwaysBuild:true}],
        bitmaps:[{name:"Icon",image:"data:image/png;base64,SENSITIVE_BINARY_DATA",bpp:32,lvglBinaryOutputFormat:1,alwaysBuild:false}]
    }
};
const read=(name,args={})=>runReadTool(store,name,args,false);
const capabilities=read("get_mcp_capabilities");
assert.equal(capabilities.apiVersion,1);
assert.ok(capabilities.writeTools.includes("save_project"));
assert.ok(capabilities.constraints.unsupported.includes("device download"));
assert.equal(capabilities.preview.start, "start_preview");
assert.equal(capabilities.preview.status, "get_preview_status");
assert.equal(capabilities.preview.frameCapture, "get_preview_snapshot");
assert.equal(capabilities.preview.tap, "preview_tap");
assert.equal(capabilities.preview.inputRequiresLocalApproval, true);
assert.equal(capabilities.widgetAuthoring.createTool, "add_widget");
assert.equal(capabilities.widgetAuthoring.extendedPropertyTool, "set_widget_property");
assert.ok(capabilities.widgetAuthoring.createProperties.includes("identifier"));
assert.ok(capabilities.widgetAuthoring.createProperties.includes("text"));
assert.ok(!capabilities.widgetAuthoring.createProperties.includes("font"));
assert.ok(capabilities.writeTools.includes("start_project_build"));
assert.equal(capabilities.canvasSnapshot.includesEditorChrome, false);
assert.equal(capabilities.canvasSnapshot.simulatorVerified, false);
assert.ok(capabilities.flowNodes.types.includes("IsTrueActionComponent"));
assert.ok(capabilities.flowNodes.types.includes("CallActionActionComponent"));
assert.ok(capabilities.flowNodes.types.includes("LVGLActionComponent"));
assert.ok(capabilities.flowNodes.sequenceOutputs.includes("True"));
assert.ok(capabilities.readTools.includes("get_project_build_status"));
const styleList=read("list_styles");
assert.equal(styleList.styleCount,2);
assert.deepEqual(styleList.styles[0].children[0].stylePath,[0,0]);
assert.equal(styleList.defaultStyles.LVGLButtonWidget,"Primary");
const style=read("get_style",{stylePath:[0]});
assert.equal(style.definition.MAIN.DEFAULT.bg_color,"#ffb500");
assert.equal(style.definition.MAIN.DEFAULT.long_value.omitted,"complex");
assert.equal(style.definition.MAIN.DEFAULT.dynamic.omitted,"non-literal");
const styleChild=read("get_style",{stylePath:[0,0]});
assert.equal(styleChild.definition.MAIN.PRESSED.text_color,"#fff");
const assets=read("list_assets");
assert.equal(assets.fontCount,1);
assert.equal(assets.bitmapCount,1);
assert.equal(assets.fonts[0].glyphCount,2);
assert.equal(assets.bitmaps[0].hasImage,true);
assert.ok(!JSON.stringify(assets).includes("SENSITIVE_BINARY_DATA"));
const widgetTree=read("list_widgets",{pageName:"Home"});
assert.deepEqual(widgetTree.widgets[0].children[0].widgetPath,[0,0]);
const detail=read("get_widget_details",{pageName:"Home",widgetPath:[0,0]});
assert.equal(detail.eventHandlers[0].eventName,"CLICKED");
const events=read("list_widget_events",{pageName:"Home"});
assert.equal(events.bindings.length,1);
assert.deepEqual(events.bindings[0].widgetPath,[0,0]);
assert.ok(!JSON.stringify(events).includes("dangerousInternalCode"));
let fail=false;
try {read("get_style",{stylePath:[99]})} catch(e) {fail=e.code==="STYLE_NOT_FOUND"}
assert.ok(fail);
fail=false;
try {read("get_widget_details",{pageName:"Home",widgetPath:[0,88]})} catch(e) {fail=e.code==="WIDGET_NOT_FOUND"}
assert.ok(fail);
fail=false;
try {read("get_widget_details",{pageName:"Home",widgetPath:[]})} catch(e) {fail=true}
assert.ok(fail);
console.log("PASS: styles, child paths, literals only, assets, widget details, event bindings, missing paths");
