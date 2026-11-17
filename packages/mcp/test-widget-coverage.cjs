/* Conservative static ClassInfo coverage audit + actual MCP property-schema safety tests.
 * This is NOT a claim that all widgets render/build. Palette + disabled callbacks
 * depend on LVGL version and project runtime; record candidates separately.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
// TypeScript 7 in this repository ships its Go compiler without the legacy
// createSourceFile API. Babel parses the same TSX ClassInfo metadata offline.
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const Module = require("node:module");

const projectRoot = path.resolve(__dirname, "../..");
const widgetDir = path.join(projectRoot, "packages/project-editor/lvgl/widgets");
const outputDir = path.join(projectRoot, "artifacts/mcp-acceptance");
const permitted = new Set(["Number", "Boolean", "String", "MultilineText", "Enum", "Color", "ThemedColor"]);
const withheld = /(?:script|source|code|path|file|directory|url|action|event|handler|expression|^_)|^(?:type|children|localStyles|flow|data|identifier)$/i;
const candidateName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
function files(dir) {
    return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
        const filename = path.join(dir, entry.name);
        return entry.isDirectory() ? files(filename) :
            /\.(tsx|ts)$/.test(entry.name) ? [filename] : [];
    });
}
function keyOf(prop) {
    const key = prop?.key;
    return key?.type === "Identifier" ? key.name :
        key?.type === "StringLiteral" ? key.value : "";
}
function stringValue(expr) {
    return expr?.type === "StringLiteral" ? expr.value : null;
}
function info(expr) {
    if (expr?.type !== "ObjectExpression") return null;
    return Object.fromEntries(expr.properties
        .filter(prop=>prop.type==="ObjectProperty")
        .map(prop=>[keyOf(prop), prop.value]));
}
function expressionCall(node) {
    if (node?.type !== "SpreadElement" || node.argument?.type !== "CallExpression") return null;
    const call = node.argument;
    const name = call.callee?.type==="Identifier" ? call.callee.name : "unknown";
    if (name === "makeLvglExpressionProperty") {
        return { name: stringValue(call.arguments[0]), kind:"expression-literal",
            expressionType: stringValue(call.arguments[1]) || "unknown" };
    }
    return { name: null, kind:"unresolved-spread", source:name };
}
const inventory = [];
let opaqueSpreads = 0;
for (const filename of files(widgetDir)) {
    const source = parse(fs.readFileSync(filename,"utf8"),{
        sourceType:"module", sourceFilename:filename,
        plugins:["typescript","jsx","decorators-legacy"]
    });
    traverse(source, { ClassDeclaration({node}) {
        if (!node.id || !/^LVGL[A-Za-z0-9]+Widget$/.test(node.id.name) ||
            node.superClass?.type!=="Identifier" || node.superClass.name!=="LVGLWidget") return;
        const type = node.id.name;
        if (["LVGLScreenWidget","LVGLUserWidgetWidget"].includes(type)) return;
        const classInfo = node.body.body.find(member =>
            ["ClassProperty","PropertyDefinition"].includes(member.type) &&
            keyOf(member)==="classInfo" && member.static);
        const init = classInfo?.value;
        const config = init?.type==="CallExpression" ? info(init.arguments[1]) : null;
        const fields = [];
        const metadata = config?.properties;
        if (metadata?.type==="ArrayExpression") {
            for (const entry of metadata.elements) {
                if (entry?.type==="ObjectExpression") {
                    const props = info(entry);
                    const name = stringValue(props?.name);
                    const propType = props?.type;
                    const kind = propType?.type==="MemberExpression" &&
                        propType.object?.name==="PropertyType" ?
                        propType.property?.name : "unknown";
                    if (name) fields.push({name,kind,availability:"source-candidate"});
                } else {
                    const generated = expressionCall(entry);
                    if (generated?.name) fields.push(generated);
                    else opaqueSpreads++;
                }
            }
        }
        const unique = [...new Map(fields.map(f=>[f.name,f])).values()];
        const eligible = unique.filter(f => candidateName.test(f.name) &&
            !withheld.test(f.name) && (permitted.has(f.kind) ||
            f.kind==="expression-literal" && ["integer","float","double","string","boolean"].includes(f.expressionType)));
        const restricted = unique.filter(f=>!eligible.includes(f));
        inventory.push({
            type, source:path.relative(projectRoot,filename).replace(/\\/g,"/"),
            palettePolicy:config?.enabledInComponentPalette ? "conditional-runtime" : "not-statically-resolved",
            sourceFields:unique.length,
            candidateScalarFields:eligible.map(f=>f.name),
            restrictedOrDynamicFields:restricted.map(f=>({name:f.name,kind:f.kind})),
            eligibleMetadata:eligible
        });
    }});
}
inventory.sort((a,b)=>a.type.localeCompare(b.type));
const types = inventory.map(x=>x.type);
assert.equal(new Set(types).size, types.length, "Duplicate widget classes");
assert.ok(inventory.length >= 30, "Unexpectedly small source widget inventory");
const sourceByType = new Map(inventory.map(entry => [entry.type, entry]));
assert.ok(sourceByType.get("LVGLArcWidget")?.candidateScalarFields.includes("value"));
assert.ok(sourceByType.get("LVGLSliderWidget")?.candidateScalarFields.includes("mode"));
assert.ok(sourceByType.get("LVGLButtonMatrixWidget")?.restrictedOrDynamicFields
    .some(field => field.name === "buttons"), "Button matrix array must remain restricted");
assert.ok(sourceByType.get("LVGLChartWidget")?.restrictedOrDynamicFields
    .some(field => field.name === "series"), "Chart series array must remain restricted");

// Actual compiled MCP schema and write validation — run against ClassInfo-shaped
// fixtures derived from the parsed class source, not a fake claim of GUI runtime.
const PropertyType = { Number:3, Boolean:2, String:5, MultilineText:6,
    Enum:4, Color:8, ThemedColor:9, ObjectReference:12, Array:13 };
const typeNames = Object.fromEntries(Object.entries(PropertyType).map(([k,v])=>[v,k]));
const load = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "project-editor/core/object") return {
        getClassInfo: widget => widget.__info,
        PropertyType, TYPE_NAMES:typeNames,
        findClass: ()=>null, getDefaultValue:()=>null
    };
    if (request === "project-editor/lvgl/style-catalog") return {lvglPropertiesMap:new Map()};
    return load.apply(this, arguments);
};
let property;
try {
    property = require(path.join(projectRoot,"build/mcp/adapter/property-schema.js"));
} finally { Module._load = load; }

let testedTypes = 0, testedScalarFields = 0, testedNegativeCases = 0;
for (const entry of inventory) {
    const props = entry.eligibleMetadata.map(field => {
        if (field.kind==="expression-literal") return {
            name:field.name, type:PropertyType.ObjectReference,
            expressionType:field.expressionType,
            referencedObjectCollectionPath:"variables/globalVariables"
        };
        return {name:field.name, type:PropertyType[field.kind],
            ...(field.kind==="Enum" ? {enumItems:[{id:"NORMAL"},{id:"RANGE"}]}:{})};
    });
    // Include a guaranteed unsafe complex property to test each widget type.
    props.push({name:"untrustedScript",type:PropertyType.String});
    props.push({name:"matrixItems",type:PropertyType.Array});
    props.push({name:"brokenEnum",type:PropertyType.Enum,
        enumItems:()=>{throw new Error("Unavailable enum options");}});
    const widget = {type:entry.type, __info:{properties:props}};
    for (const field of entry.eligibleMetadata.filter(x=>x.kind==="expression-literal")) {
        widget[field.name+"Type"]="literal";
        widget[field.name]=field.expressionType==="boolean" ? false :
            field.expressionType==="string" ? "ok" : 1;
    }
    const store = {project:{allLvglStyles:[],bitmaps:[]}};
    const visible = property.supportedWidgetProperties(widget);
    assert.ok(!visible.some(p=>p.name==="untrustedScript" || p.name==="matrixItems"));
    assert.equal(visible.length, Math.min(entry.eligibleMetadata.length+1, 220));
    const schema = property.widgetPropertySchema(store, widget);
    assert.equal(schema.type, entry.type);
    assert.ok(!schema.properties.some(p=>p.name==="untrustedScript" || p.name==="matrixItems"));
    const broken = schema.properties.find(p=>p.name==="brokenEnum");
    assert.equal(broken.editable, false);
    assert.deepEqual(broken.enumItems, []);
    for(const p of visible.filter(p=>p.name!=="brokenEnum")) {
        let value;
        if (p.type===PropertyType.ObjectReference) {
            value = p.expressionType==="boolean" ? true : p.expressionType==="string" ? "checked" : 42;
        } else if (p.type===PropertyType.Boolean) value = true;
        else if (p.type===PropertyType.Number) value=42;
        else if (p.type===PropertyType.Color||p.type===PropertyType.ThemedColor) value="#123456";
        else if (p.type===PropertyType.Enum) value="NORMAL";
        else value="checked";
        assert.ok(property.validateRuntimeWidgetProperty(store,widget,p.name,value));
        testedScalarFields++;
    }
    assert.throws(()=>property.validateRuntimeWidgetProperty(store,widget,"untrustedScript","malicious"));
    assert.throws(()=>property.validateRuntimeWidgetProperty(store,widget,"matrixItems",[]));
    assert.throws(()=>property.validateRuntimeWidgetProperty(store,widget,"brokenEnum","bad"));
    testedNegativeCases+=3;
    testedTypes++;
}
const payload = {
    auditVersion:1, sourceRevision:"local-working-tree",
    clarification:"Direct LVGLWidget source subclasses and subclass-specific ClassInfo fields only. Shared inherited properties and the runtime LVGL palette are not counted. Fixture validator tests do not prove GUI rendering, saving or Build.",
    summary:{
        sourceWidgetTypes:inventory.length,
        staticScalarCandidates:inventory.reduce((sum,item)=>sum+item.candidateScalarFields.length,0),
        restrictedOrDynamicCandidates:inventory.reduce((sum,item)=>sum+item.restrictedOrDynamicFields.length,0),
        opaqueMetadataSpreads:opaqueSpreads,
        fixtureWidgetTypesTested:testedTypes,
        safePropertyFixtureWritesTested:testedScalarFields,
        unsafePropertyFixtureRejectionsTested:testedNegativeCases
    },
    sourceClasses:inventory.map(({eligibleMetadata,...x})=>x)
};
fs.mkdirSync(outputDir,{recursive:true});
fs.writeFileSync(path.join(outputDir,"mcp-widget-property-coverage.json"),JSON.stringify(payload,null,2));
console.log("PASS: static LVGL ClassInfo inventory + schema safety fixtures",JSON.stringify(payload.summary));
console.log(inventory.map(x=>x.type+": "+x.candidateScalarFields.length+" safe candidate fields, "+x.restrictedOrDynamicFields.length+" restricted/dynamic").join("\n"));
