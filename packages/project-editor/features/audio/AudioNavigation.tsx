import React from "react";
import * as FlexLayout from "flexlayout-react";
import { observer } from "mobx-react";

import { FlexLayoutContainer } from "eez-studio-ui/FlexLayout";
import { ListNavigation } from "project-editor/ui-components/ListNavigation";
import { Panel } from "project-editor/ui-components/Panel";
import { PropertyGrid } from "project-editor/ui-components/PropertyGrid";
import { ProjectContext } from "project-editor/project/context";
import { AudioPreview } from "project-editor/features/audio/AudioPreview";

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
                        body={
                            <div className="EezStudio_AudioFlashLayout">
                                <PropertyGrid objects={[audio]} />
                                <PropertyGrid objects={[audio.flashLayout]} />
                            </div>
                        }
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
