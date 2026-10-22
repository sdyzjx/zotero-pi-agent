/* global Zotero, Services, Cc, Ci, APP_SHUTDOWN */
var chromeHandle;
var coreScope;

function install() {}

async function startup({ id, version, rootURI }, reason) {
  await Zotero.initializationPromise;

  const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
    Ci.amIAddonManagerStartup,
  );
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "zoteropi", rootURI + "content/"],
  ]);

  coreScope = { rootURI, __PLUGIN_ID__: id, __PLUGIN_VERSION__: version };
  Services.scriptloader.loadSubScriptWithOptions(rootURI + "content/core.js", {
    target: coreScope,
    ignoreCache: true,
  });
  await Zotero.ZoteroPi.startup();
}

function onMainWindowLoad({ window }) {
  Zotero.ZoteroPi?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  Zotero.ZoteroPi?.onMainWindowUnload(window);
}

async function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  // Zotero may call startup() (e.g. on re-enable/update) before this async
  // shutdown finishes, and both share this scope: tear down synchronously first.
  const instance = Zotero.ZoteroPi;
  delete Zotero.ZoteroPi;
  const done = instance?.shutdown(); // synchronous UI/session teardown runs here
  coreScope = null;
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
  try {
    await done;
  } catch (e) {
    Zotero.logError(e);
  }
}

function uninstall() {}
