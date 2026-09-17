import React from "react";
import { dialog, getCurrentWindow } from "@electron/remote";

import { Icon } from "eez-studio-ui/icon";
import { FieldComponent } from "eez-studio-ui/generic-dialog";
import { ProjectContext } from "project-editor/project/context";

////////////////////////////////////////////////////////////////////////////////

export class RelativeFileInput extends FieldComponent {
    static contextType = ProjectContext;
    declare context: React.ContextType<typeof ProjectContext>;

    onClear = () => {
        this.props.onChange(undefined);
    };

    onSelect = async () => {
        const result = await dialog.showOpenDialog(getCurrentWindow(), {
            properties: ["openFile"],
            filters: this.props.fieldProperties.options.filters,
            defaultPath: this.context.uiStateStore.openDialogDefaultPath || this.context.filePath
        });

        if (result.filePaths && result.filePaths[0]) {
            this.context.uiStateStore.openDialogDefaultPath = result.filePaths[0];
            this.props.onChange(
                this.context.getFilePathRelativeToProjectPath(
                    result.filePaths[0]
                )
            );
        }
    };

    render() {
        let clearButton: JSX.Element | undefined;

        if (this.props.values[this.props.fieldProperties.name]) {
            clearButton = (
                <button
                    className="btn btn-default EezStudio_PathInput_Action EezStudio_PathInput_Action_Clear"
                    type="button"
                    title="Clear file path"
                    aria-label="Clear file path"
                    onClick={this.onClear}
                >
                    <Icon icon="material:remove_circle_outline" size={16} />
                </button>
            );
        }

        return (
            <div className="input-group">
                <input
                    type="text"
                    className="form-control"
                    value={
                        this.props.values[this.props.fieldProperties.name] || ""
                    }
                    readOnly
                />
                <>
                    {clearButton}
                    <button
                        className="btn btn-secondary EezStudio_PathInput_Action EezStudio_PathInput_Action_Browse"
                        type="button"
                        title="Browse for file"
                        aria-label="Browse for file"
                        onClick={this.onSelect}
                    >
                        <Icon icon="material:insert_drive_file" size={16} />
                    </button>
                </>
            </div>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export class AbsoluteFileInput extends FieldComponent {
    static contextType = ProjectContext;
    declare context: React.ContextType<typeof ProjectContext>;

    onClear = () => {
        this.props.onChange(undefined);
    };

    onSelect = async () => {
        const result = await dialog.showOpenDialog(getCurrentWindow(), {
            properties: ["openFile"],
            filters: this.props.fieldProperties.options.filters,
            defaultPath: this.context.uiStateStore.openDialogDefaultPath || this.context.filePath
        });

        if (result.filePaths && result.filePaths[0]) {
            this.context.uiStateStore.openDialogDefaultPath = result.filePaths[0];
            this.props.onChange(result.filePaths[0]);
        }
    };

    render() {
        let clearButton: JSX.Element | undefined;

        if (this.props.values[this.props.fieldProperties.name]) {
            clearButton = (
                <button
                    className="btn btn-default EezStudio_PathInput_Action EezStudio_PathInput_Action_Clear"
                    type="button"
                    title="Clear file path"
                    aria-label="Clear file path"
                    onClick={this.onClear}
                >
                    <Icon icon="material:remove_circle_outline" size={16} />
                </button>
            );
        }

        return (
            <div className="input-group">
                <input
                    type="text"
                    className="form-control"
                    value={
                        this.props.values[this.props.fieldProperties.name] || ""
                    }
                    readOnly
                />
                <>
                    {clearButton}
                    <button
                        className="btn btn-secondary EezStudio_PathInput_Action EezStudio_PathInput_Action_Browse"
                        type="button"
                        title="Browse for file"
                        aria-label="Browse for file"
                        onClick={this.onSelect}
                    >
                        <Icon icon="material:insert_drive_file" size={16} />
                    </button>
                </>
            </div>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export class MultipleAbsoluteFileInput extends FieldComponent {
    static contextType = ProjectContext;
    declare context: React.ContextType<typeof ProjectContext>;

    onClear = () => {
        this.props.onChange(undefined);
    };

    onSelect = async () => {
        const result = await dialog.showOpenDialog(getCurrentWindow(), {
            properties: ["openFile", "multiSelections"],
            filters: this.props.fieldProperties.options.filters,
            defaultPath: this.context.uiStateStore.openDialogDefaultPath || this.context.filePath
        });

        if (result.filePaths && result.filePaths.length > 0) {
            this.context.uiStateStore.openDialogDefaultPath = result.filePaths[0];
            this.props.onChange(result.filePaths);
        }
    };

    get value() {
        const value = this.props.values[this.props.fieldProperties.name];
        if (!value) {
            return "";
        }

        if (value.length > 1) {
            return `${value.length} images selected`;
        }

        return value;
    }

    render() {
        let clearButton: JSX.Element | undefined;

        if (this.props.values[this.props.fieldProperties.name]) {
            clearButton = (
                <button
                    className="btn btn-default EezStudio_PathInput_Action EezStudio_PathInput_Action_Clear"
                    type="button"
                    title="Clear selected images"
                    aria-label="Clear selected images"
                    onClick={this.onClear}
                >
                    <Icon icon="material:remove_circle_outline" size={16} />
                </button>
            );
        }

        return (
            <div className="input-group">
                <input
                    type="text"
                    className="form-control"
                    value={this.value}
                    readOnly
                />
                <>
                    {clearButton}
                    <button
                        className="btn btn-secondary EezStudio_PathInput_Action EezStudio_PathInput_Action_Browse"
                        type="button"
                        title="Browse for image files"
                        aria-label="Browse for image files"
                        onClick={this.onSelect}
                    >
                        <Icon icon="material:collections" size={16} />
                    </button>
                </>
            </div>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export class AbsoluteFileSaveInput extends FieldComponent {
    static contextType = ProjectContext;
    declare context: React.ContextType<typeof ProjectContext>;

    onClear = () => {
        this.props.onChange(undefined);
    };

    onSelect = async () => {
        const result = await dialog.showSaveDialog(getCurrentWindow(), {
            properties: ["showOverwriteConfirmation"],
            filters: this.props.fieldProperties.options.filters,
            defaultPath: this.context.uiStateStore.openDialogDefaultPath || this.context.filePath
        });

        if (result.filePath) {
            this.context.uiStateStore.openDialogDefaultPath = result.filePath;
            this.props.onChange(result.filePath);
        }
    };

    render() {
        let clearButton: JSX.Element | undefined;

        if (this.props.values[this.props.fieldProperties.name]) {
            clearButton = (
                <button
                    className="btn btn-default EezStudio_PathInput_Action EezStudio_PathInput_Action_Clear"
                    type="button"
                    title="Clear output path"
                    aria-label="Clear output path"
                    onClick={this.onClear}
                >
                    <Icon icon="material:remove_circle_outline" size={16} />
                </button>
            );
        }

        return (
            <div className="input-group">
                <input
                    type="text"
                    className="form-control"
                    value={
                        this.props.values[this.props.fieldProperties.name] || ""
                    }
                    readOnly
                />
                <>
                    {clearButton}
                    <button
                        className="btn btn-secondary EezStudio_PathInput_Action EezStudio_PathInput_Action_Save"
                        type="button"
                        title="Choose save location"
                        aria-label="Choose save location"
                        onClick={this.onSelect}
                    >
                        <Icon icon="material:save" size={16} />
                    </button>
                </>
            </div>
        );
    }
}
