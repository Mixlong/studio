require("dotenv").config();
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== "darwin") {
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    const appleId = process.env.APPLEID;
    const appleIdPassword = process.env.APPLEIDPASS;
    const teamId = process.env.APPLETEAMID;

    if (!appleId || !appleIdPassword || !teamId) {
        console.log(
            "Skipping macOS notarization: APPLEID, APPLEIDPASS or APPLETEAMID is not configured"
        );
        return;
    }

    return await notarize({
        appBundleId: context.packager.appInfo.appId,
        appPath: `${appOutDir}/${appName}.app`,
        appleId,
        appleIdPassword,
        teamId
    });
};
