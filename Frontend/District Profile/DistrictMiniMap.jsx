/* DISTRICT MINI MAP (under each recommendation) */
.mini-map { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.mini-map-toolbar { display: flex; flex-wrap: wrap; gap: 6px; }
.mini-map-toolbar button { padding: 5px 11px; border: 1px solid #dce6d7; border-radius: 999px; background: #fffefa; color: #4f6c57; font-size: 0.74rem; font-weight: 700; }
.mini-map-toolbar button[aria-pressed="true"] { border-color: #214b39; background: #214b39; color: #fffdf3; }
.mini-map-box { position: relative; overflow: hidden; border: 1px solid #dbe4d4; border-radius: 14px; background: #e9efe4; }
.mini-map-canvas { position: absolute; inset: 0; }
.mini-map-badge { position: absolute; left: 10px; top: 10px; z-index: 2; padding: 6px 10px; border: 1px solid #e0e8d9; border-radius: 9px; background: rgba(255, 254, 250, 0.95); color: #4f6c57; font-size: 0.72rem; box-shadow: 0 3px 10px rgba(43, 73, 48, 0.12); }
.mini-map-badge strong { color: #214b39; font-size: 0.9rem; }
.mini-map-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; color: #687968; font-size: 0.7rem; }
.mini-map-legend > span { display: inline-flex; align-items: center; gap: 6px; }
.mini-heat { display: inline-block; width: 34px; height: 8px; border-radius: 4px; }
.mini-dash { display: inline-block; width: 20px; height: 0; border-top: 3px dashed #214b39; }
.mini-map .legend-line { display: inline-block; width: 14px; height: 3px; border-radius: 3px; }
.mm-area { font-size: 10px; }
.mm-pin { display: grid; width: 30px; height: 30px; place-items: center; border: 2.5px solid #fffefa; border-radius: 50%; color: #fffefa; box-shadow: 0 3px 9px rgba(34, 62, 42, 0.3); }
.mm-pin svg { width: 16px; height: 16px; }
.mm-home { background: #d94351; }
.mm-uni { background: #214b39; }
.mm-commute-label { padding: 3px 8px; border-radius: 999px; background: #214b39; color: #fffdf3; font-size: 11px; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); }
.mini-map .red-line { background: #d43c48; }
.mini-map .green-line { background: #27895b; }
.mini-map .dm-area { color: #2c503b; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 6px #fff; pointer-events: none; }
.mini-map .dm-place { display: flex; padding: 0; border: 0; background: transparent; cursor: pointer; }
.mini-map .dm-pin { display: grid; width: 24px; height: 24px; place-items: center; border: 2px solid currentColor; border-radius: 50%; background: #fffefa; box-shadow: 0 2px 6px rgba(34, 62, 42, 0.28); }
.mini-map .dm-pin svg { width: 13px; height: 13px; }
.mini-map .stop-popup h3, .mini-map .landmark-popup h3 { margin: 6px 0 2px; color: #214b39; font-size: 15px; }
.mini-map .landmark-popup p { margin: 0; color: #718071; font-size: 12px; }
.mini-map .stop-line { display: inline-block; padding: 2px 8px; border-radius: 999px; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.mini-map .stop-line.red { background: #d71920; }
.mini-map .stop-line.green { background: #008531; }
.mini-map .stop-heading { margin: 4px 0 0; color: #91a18c; font-size: 11px; font-weight: 700; }
.mm-legend-home { display: inline-block; width: 10px; height: 10px; border: 2px solid #fffefa; border-radius: 50%; background: #d94351; box-shadow: 0 0 0 1px #d94351; }

/* District picker above the mini map */
.mini-map-explore { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.mini-map-explore label { display: inline-flex; align-items: center; gap: 8px; color: #687968; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.mini-map-explore select { padding: 6px 10px; border: 1px solid #dce6d7; border-radius: 9px; background: #fffefa; color: #214b39; font-size: 0.8rem; font-weight: 700; text-transform: none; letter-spacing: 0; }
.mini-map-back { padding: 5px 11px; border: 1px solid #214b39; border-radius: 999px; background: #fffefa; color: #214b39; font-size: 0.74rem; font-weight: 700; cursor: pointer; }
.mini-map-full { margin-left: auto; color: #214b39; font-size: 0.76rem; font-weight: 800; text-decoration: none; }
.mini-map-full:hover { text-decoration: underline; }
.mini-map-tag { display: inline-block; margin-right: 6px; padding: 1px 7px; border-radius: 999px; background: #d94351; color: #fffefa; font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
.mini-map-error { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: #687968; font-size: 0.8rem; }
