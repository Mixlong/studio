import React from "react";
import * as FlexLayout from "flexlayout-react";
import { observer } from "mobx-react";

import { FlexLayoutContainer } from "eez-studio-ui/FlexLayout";
import { ListNavigation } from "project-editor/ui-components/ListNavigation";
import { Panel } from "project-editor/ui-components/Panel";
import { PropertyGrid } from "project-editor/ui-components/PropertyGrid";
import { ProjectContext } from "project-editor/project/context";
import { AudioPreview } from "project-editor/features/audio/AudioPreview";

const AudioSettings = observer(() => {
    const store = React.useContext(ProjectContext);
    const audio = store.project.audio;
    const [advancedOpen, setAdvancedOpen] = React.useState(false);
    if (!audio) return null;

    const updatePositiveInteger = (
        property: "targetSampleRate" | "targetChannels",
        value: string
    ) => {
        const number = Number(value);
        if (Number.isSafeInteger(number) && number > 0) {
            store.updateObject(audio, { [property]: number });
        }
    };

    return (
        <div className="EezStudio_AudioFlashLayout EezStudio_AudioSettings">
            <div className="EezStudio_AudioSettings_Basic">
                <div className="EezStudio_AudioSettings_Description">
                    Add WAV or MP3 files from Audio Resources. Common output
                    settings are shown below.
                </div>
                <label className="EezStudio_AudioSettings_Field">
                    <span>Storage Target</span>
                    <select
                        className="form-select form-select-sm"
                        value={audio.flashLayout.storage}
                        onChange={event =>
                            store.updateObject(audio.flashLayout, {
                                storage: event.target.value
                            })
                        }
                    >
                        <option value="internal-flash">Internal Flash</option>
                        <option value="qspi-flash">QSPI Flash</option>
                        <option value="spi-flash">SPI Flash</option>
                    </select>
                </label>
                <div className="EezStudio_AudioSettings_SectionTitle">
                    MP3 Output
                </div>
                <label className="EezStudio_AudioSettings_Field">
                    <span>Sample Rate (Hz)</span>
                    <input
                        className="form-control form-control-sm"
                        type="number"
                        min="1"
                        step="1"
                        value={audio.targetSampleRate}
                        onChange={event =>
                            updatePositiveInteger(
                                "targetSampleRate",
                                event.target.value
                            )
                        }
                    />
                </label>
                <label className="EezStudio_AudioSettings_Field">
                    <span>Channels</span>
                    <input
                        className="form-control form-control-sm"
                        type="number"
                        min="1"
                        step="1"
                        value={audio.targetChannels}
                        onChange={event =>
                            updatePositiveInteger(
                                "targetChannels",
                                event.target.value
                            )
                        }
                    />
                </label>
            </div>
            <button
                type="button"
                className="EezStudio_AudioSettings_AdvancedToggle"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen(open => !open)}
            >
                <span aria-hidden="true">{advancedOpen ? "▾" : "▸"}</span>
                Advanced Settings
            </button>
            {advancedOpen && (
                <div className="EezStudio_AudioSettings_Advanced">
                    <div className="EezStudio_AudioSettings_SectionTitle">
                        Converter Tools
                    </div>
                    <PropertyGrid objects={[audio]} />
                    <div className="EezStudio_AudioSettings_SectionTitle">
                        Flash Partition
                    </div>
                    <PropertyGrid objects={[audio.flashLayout]} />
                </div>
            )}
        </div>
    );
});

////////////////////////////////////////////////////////////////////////////////

export const AudioTab = observer(
    class AudioTab extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        factory = (node: FlexLayout.TabNode) => {
            const component = node.getComponent();
            const audio = this.context.project.audio;

            if (!audio) {
                return null;
            }

            if (component === "resources") {
                return (
                    <ListNavigation
                        id="audio-resources"
                        navigationObject={audio.resources}
                        selectedObject={
                            this.context.navigationStore
                                .selectedAudioResourceObject
                        }
                    />
                );
            }

            if (component === "flash-layout") {
                return (
                    <Panel
                        id="audio-flash-layout"
                        title="Audio Settings"
                        body={<AudioSettings />}
                        style={{ overflow: "hidden" }}
                    />
                );
            }

            if (component === "preview") {
                return <AudioPreview />;
            }

            return null;
        };

        render() {
            return (
                <FlexLayoutContainer
                    model={this.context.layoutModels.audio}
                    factory={this.factory}
                />
            );
        }
    }
);
