const js = require('@eslint/js');
const globals = require('globals');

// The renderer is loaded as 15 classic <script> tags sharing one global
// scope (see renderer/index.html). Top-level declarations in one file are
// used freely from the others, so each file group's exports are declared
// as globals here to keep no-undef accurate.

const utilGlobals = {
  // renderer/js/utils/dom.js
  h: 'writable',
  // renderer/js/utils/format.js
  formatBytes: 'writable',
  formatUptime: 'writable',
  formatCpu: 'writable',
  cpuClass: 'writable',
  formatPort: 'writable',
  formatCpuSeconds: 'writable',
  // renderer/js/utils/reconcile.js
  reconcileChildren: 'writable',
};

const stateGlobals = {
  // renderer/js/state.js
  HISTORY_MAX: 'writable',
  AppState: 'writable',
};

const componentGlobals = {
  // renderer/js/components/toast.js
  getToastContainer: 'writable',
  dismissToast: 'writable',
  showToast: 'writable',
  showUndoToast: 'writable',
  // renderer/js/components/group-header.js
  renderGroupHeader: 'writable',
  showGroupActionsMenu: 'writable',
  // renderer/js/components/sparkline.js
  SVG_NS: 'writable',
  svgEl: 'writable',
  renderSparkline: 'writable',
  showSparklineDetail: 'writable',
  // renderer/js/components/context-menu.js
  escapeRegex: 'writable',
  makeServiceEntry: 'writable',
  addProcessToProfile: 'writable',
  createProfileWithProcess: 'writable',
  findProcessesOnPort: 'writable',
  activeMenu: 'writable',
  showContextMenu: 'writable',
  buildMenuItems: 'writable',
  hideContextMenu: 'writable',
  onCloseContextMenu: 'writable',
  onEscapeContextMenu: 'writable',
  onScrollCloseContextMenu: 'writable',
  // renderer/js/components/process-table.js
  CLUSTER_MIN: 'writable',
  renderDetailContent: 'writable',
  renderDetailSection: 'writable',
  populateDetailRow: 'writable',
  buildDetailRow: 'writable',
  renderSortableHeader: 'writable',
  buildProcessThead: 'writable',
  renderPortCell: 'writable',
  populateRow: 'writable',
  buildRow: 'writable',
  clusterAggregate: 'writable',
  populateClusterRow: 'writable',
  buildClusterRow: 'writable',
  buildGroupRowItems: 'writable',
  // renderer/js/components/container-table.js
  containerStateClass: 'writable',
  formatContainerPorts: 'writable',
  containerThead: 'writable',
  populateContainerRow: 'writable',
  buildContainerRow: 'writable',
  buildContainerSection: 'writable',
  updateContainerSection: 'writable',
  // renderer/js/components/kill-button.js
  renderKillButton: 'writable',
  showKillConfirm: 'writable',
  showBatchKillConfirm: 'writable',
  showError: 'writable',
  // renderer/js/components/status-bar.js
  notificationsEnabled: 'writable',
  renderStatusBar: 'writable',
  // renderer/js/components/settings.js
  VALID_GROUPS: 'writable',
  GROUP_LABELS: 'writable',
  settingsConfig: 'writable',
  openSettings: 'writable',
  closeSettings: 'writable',
  updateSetting: 'writable',
  renderSettingsModal: 'writable',
  renderSettingsBody: 'writable',
  renderSection: 'writable',
  renderPollInterval: 'writable',
  renderThemeToggle: 'writable',
  renderToggle: 'writable',
  renderThresholds: 'writable',
  renderGrouping: 'writable',
  renderPinnedList: 'writable',
  renderCustomRules: 'writable',
  renderProfiles: 'writable',
  // renderer/js/components/profile-panel.js
  getProfileStatuses: 'writable',
  startProfile: 'writable',
  stopProfile: 'writable',
  renderProfileBadge: 'writable',
  renderProfilePanel: 'writable',
  // renderer/js/components/command-palette.js
  CMD_PALETTE_MAX_RESULTS: 'writable',
  cmdPaletteOverlay: 'writable',
  cmdPaletteItems: 'writable',
  cmdPaletteSelected: 'writable',
  fuzzyScore: 'writable',
  buildPaletteCommands: 'writable',
  executePaletteItem: 'writable',
  renderCommandPaletteList: 'writable',
  updatePaletteSelection: 'writable',
  onCmdPaletteKeyDown: 'writable',
  openCommandPalette: 'writable',
  closeCommandPalette: 'writable',
};

const appGlobals = {
  // renderer/js/app.js
  pollInterval: 'writable',
  pollTimer: 'writable',
  GROUP_ORDER: 'writable',
  refreshTimer: 'writable',
  poll: 'writable',
  buildGroupSection: 'writable',
  updateGroupSection: 'writable',
  render: 'writable',
  startRefreshTimer: 'writable',
  scrollToProcess: 'writable',
  applyTheme: 'writable',
  QUICK_FILTERS: 'writable',
  renderChips: 'writable',
  ICON_MAXIMIZE: 'writable',
  ICON_RESTORE: 'writable',
  setupWindowControls: 'writable',
  updateClusterBtn: 'writable',
  startPolling: 'writable',
  handleGlobalKeys: 'writable',
};

module.exports = [
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,

  // Main process, helper scripts, tests: plain CommonJS / Node
  {
    files: ['main/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Preload runs in Electron's bridge context: Node require + browser DOM
  {
    files: ['main/preload.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Renderer: classic scripts sharing one global scope across files
  {
    files: ['renderer/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...utilGlobals,
        ...stateGlobals,
        ...componentGlobals,
        ...appGlobals,
      },
    },
    rules: {
      // Top-level declarations here ARE the globals listed above
      'no-redeclare': ['error', { builtinGlobals: false }],
      // "Unused" in one file usually means "used from another script tag",
      // so per-file unused checks only produce noise in the renderer.
      'no-unused-vars': 'off',
    },
  },
];
