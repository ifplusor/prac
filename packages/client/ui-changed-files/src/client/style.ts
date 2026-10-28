/** Card styling plus the DSH card marker. The tokens are DSH's; no second theme. */
export const CHANGED_FILES_CSS = `
[data-changed-files]{display:none!important}
.prac-changed-files{margin-top:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}
.prac-cf-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--dsw-static-neutral-50);border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;}
body[data-ds-dark-theme] .prac-cf-head{background:var(--dsw-static-neutral-850);}
.prac-cf-icon{display:grid;place-items:center;width:18px;height:18px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);font-weight:700;font-size:10px;color:var(--dsw-alias-label-secondary);}
.prac-cf-title{font-weight:600;}
.prac-cf-total{margin-left:auto;display:inline-flex;gap:6px;font-family:var(--ds-font-family-code);font-size:10px;color:var(--dsw-alias-label-tertiary);}
.prac-cf-add{color:var(--dsw-alias-state-success-primary);}
.prac-cf-del{color:var(--dsw-alias-state-error-primary);}
.prac-cf-list{display:flex;flex-direction:column;}
.prac-cf-row{display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:7px 10px;border:0;border-top:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font-family:var(--ds-font-family-code);font-size:11px;text-align:left;cursor:pointer;}
.prac-cf-row:first-child{border-top:0;}
.prac-cf-row:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}
.prac-cf-row:disabled{cursor:default;opacity:.6;}
.prac-cf-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);}
.prac-cf-stat{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;}
.prac-cf-foot{display:flex;gap:8px;padding:5px 10px;background:var(--dsw-static-neutral-50);color:var(--dsw-alias-label-tertiary);font-size:10px;}
body[data-ds-dark-theme] .prac-cf-foot{background:var(--dsw-static-neutral-850);}
.prac-cf-turn{font-family:var(--ds-font-family-code);}
.prac-cf-note{margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
`;
