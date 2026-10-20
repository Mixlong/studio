/**
 * Product-facing switches and content providers.
 *
 * Keep product customizations in this file so the upstream UI and project
 * editor code remain easy to merge. A future first-party catalog can replace
 * the source URLs here without reintroducing an Examples entry point.
 */
export interface ProductConfig {
    examplesCatalog: {
        enabled: boolean;
        repositoryUrl: string;
        catalogVersionUrl: string;
        catalogUrl: string;
    };
    projectTemplates: {
        baseUrl: string;
        repositoryUrl?: string;
        onlineCatalog: {
            enabled: boolean;
            searchUrl: string;
            displayName: string;
        };
    };
    extensionsCatalog: {
        enabled: boolean;
        catalogVersionUrl: string;
        catalogUrl: string;
    };
}

export const productConfig: ProductConfig = {
    // Product builds must not expose or download the upstream Examples catalog.
    examplesCatalog: {
        enabled: false,
        repositoryUrl: "https://github.com/eez-open/eez-project-examples",
        catalogVersionUrl:
            "https://github.com/eez-open/eez-project-examples/raw/master/build/catalog-version.json",
        catalogUrl:
            "https://github.com/eez-open/eez-project-examples/raw/master/build/catalog.zip"
    },

    projectTemplates: {
        // Documentation URL only. The New Project wizard uses bundled
        // resources/project-templates and never downloads standard templates.
        baseUrl:
            "https://raw.githubusercontent.com/eez-open/eez-project-templates/master/",
        // Do not expose the upstream repository from the product UI.
        repositoryUrl: undefined,
        // Keep this provider pluggable, but do not load the upstream community
        // catalog in the product build.
        onlineCatalog: {
            enabled: false,
            searchUrl:
                "https://envox.eu/gitea/api/v1/repos/search?q=eez-flow-template&topic=true",
            displayName: "Online Templates"
        }
    },

    extensionsCatalog: {
        // Keep extension loading and APIs available, but do not expose the
        // upstream catalog until a first-party catalog is configured.
        enabled: false,
        catalogVersionUrl:
            "https://github.com/eez-open/studio-extensions/raw/master/build/catalog-version.json",
        catalogUrl:
            "https://github.com/eez-open/studio-extensions/raw/master/build/catalog.zip"
    }
};
