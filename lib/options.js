export const OPTIONS_KEY = "arctictab:options";

// With unloadModelWhenIdle, the model stops after this long without a request.
export const MODEL_IDLE_UNLOAD_MINUTES = 15;

// With freezeIdleTabs, a tab unused this long is frozen (see lib/freeze.js).
export const FREEZE_IDLE_MINUTES = 60;

export const OPTIONS_DEFAULTS = {
  excludePinned: true,
  reorganizeGroups: false,
  groupIdenticalTogether: true,
  identicalOwnGroup: true,
  hideApplyGroups: false,
  hideRearrange: false,
  hideGroupCount: false,
  hideTabCount: false,
  hideStatus: true,
  autoApplyGroups: false,
  autoApplyNaming: true,
  nameStyle: "mixed",
  headSim: 0.22,
  curatedSim: 0.27,
  keywordFrac: 0.34,
  groupingRules: [],
  usePinning: true,
  useBookmark: false,
  autoPinTabOnDrag: true,
  autoPinGroupOnDrag: true,
  showSearchBar: true,
  showCopyState: false,
  hideTabTitle: false,
  hideTabHost: true,
  hideControlGroupSize: false,
  debugLogging: false,
  unloadModelWhenIdle: true,
  freezeIdleTabs: false,
  showFreezeButton: false,
};

// Calls fn with the option's current value once it is read, then again each
// time it changes. Resolves after the first call.
export async function watchOption(key, fn) {
  console.assert(key in OPTIONS_DEFAULTS, `unknown option: ${key}`);
  const valueOf = (stored) => ({ ...OPTIONS_DEFAULTS, ...(stored || {}) })[key];
  let delivered = false;
  let last;
  const deliver = (value) => {
    if (delivered && value === last) return;
    delivered = true;
    last = value;
    fn(value);
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[OPTIONS_KEY]) deliver(valueOf(changes[OPTIONS_KEY].newValue));
  });
  // A change seen before the first read is newer than what that read returns.
  const r = await browser.storage.local.get(OPTIONS_KEY);
  if (!delivered) deliver(valueOf(r[OPTIONS_KEY]));
}
