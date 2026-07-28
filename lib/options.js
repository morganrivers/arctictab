export const OPTIONS_KEY = "arctictab:options";

export const DEFAULT_AUTO_ANCHORS = [
  { tabs: 10, groups: 3 },
  { tabs: 15, groups: 4 },
  { tabs: 25, groups: 5 },
];

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
  autoGroupAnchors: DEFAULT_AUTO_ANCHORS,
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
};
