import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  applyRules,
  CHANNELS,
  cloneModel,
  createInitialModel,
  mergeConfirmedSegments,
  migrateModel,
  normalizeNumbers,
  queueStats,
  STORAGE_KEY,
  simulateLatency,
  toSrt,
  type CaptionSegment,
  type ChannelId,
  type ChannelModel,
  type ConnectionState,
  type DeskModel,
  type SegmentState,
  type ToastMessage,
} from './model';

const HISTORY_LIMIT = 80;

type QueueFilter = 'active' | 'all' | 'attention';

interface DraftView {
  ruleSource: string;
  ruleReplacement: string;
  ruleSpeaker: string;
  showRuleForm: boolean;
  filter: QueueFilter;
}

function emptyDraft(): DraftView {
  return { ruleSource: '', ruleReplacement: '', ruleSpeaker: '', showRuleForm: false, filter: 'active' };
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒前`;
}

function stateLabel(state: SegmentState): string {
  return {
    pending: '待确认',
    confirmed: '已确认',
    duplicate: '重复片段',
    stale: '过期修改',
    ignored: '已忽略',
  }[state];
}

function connectionLabel(state: ConnectionState): string {
  return { connected: '连接稳定', degraded: '延迟波动', offline: '离线校正' }[state];
}

@customElement('caption-desk')
export class CaptionDesk extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      --caption-font-size: 18px;
      color: var(--cds-text-primary, #161616);
      background: var(--cds-background, #f4f4f4);
      font-family: "IBM Plex Sans", "PingFang SC", sans-serif;
    }

    * { box-sizing: border-box; }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto auto auto 1fr;
      background:
        linear-gradient(90deg, rgba(15,98,254,.025) 1px, transparent 1px),
        linear-gradient(rgba(15,98,254,.025) 1px, transparent 1px),
        var(--cds-background, #f4f4f4);
      background-size: 24px 24px;
    }

    .shell.dark {
      --cds-background: #161616;
      --cds-layer: #262626;
      --cds-layer-01: #262626;
      --cds-layer-02: #393939;
      --cds-field: #262626;
      --cds-text-primary: #f4f4f4;
      --cds-text-secondary: #c6c6c6;
      --cds-border-subtle: #393939;
      --cds-border-strong: #6f6f6f;
      color: #f4f4f4;
    }

    .topbar {
      min-height: 64px;
      padding: 8px 18px 8px 20px;
      display: grid;
      grid-template-columns: minmax(330px, 1fr) auto minmax(420px, 1fr);
      align-items: center;
      gap: 20px;
      background: #161616;
      color: #f4f4f4;
      border-bottom: 1px solid #393939;
      position: relative;
      z-index: 5;
    }

    .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .brand-mark {
      width: 38px; height: 38px; display: grid; place-items: center;
      border: 1px solid #78a9ff; color: #78a9ff; font: 600 11px/1 "IBM Plex Mono", monospace;
      clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    }
    .brand-copy { min-width: 0; }
    .brand-copy strong { display: block; font-size: 15px; letter-spacing: .015em; white-space: nowrap; }
    .brand-copy span { display: block; color: #a8a8a8; font-size: 11px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .connection-pill {
      justify-self: center; display: flex; align-items: center; gap: 10px; padding: 8px 13px;
      min-width: 260px; background: #262626; border: 1px solid #525252;
    }
    .connection-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: #42be65; box-shadow: 0 0 0 4px rgba(66,190,101,.13); }
    .connection-pill.degraded .connection-dot { background: #f1c21b; box-shadow: 0 0 0 4px rgba(241,194,27,.14); }
    .connection-pill.offline .connection-dot { background: #fa4d56; box-shadow: 0 0 0 4px rgba(250,77,86,.14); }
    .connection-copy { min-width: 0; }
    .connection-copy strong { display: block; font-size: 12px; }
    .connection-copy small { display: block; color: #c6c6c6; margin-top: 2px; font-size: 10px; }

    .header-actions { justify-self: end; display: flex; align-items: center; gap: 8px; }
    .header-actions cds-button { --cds-button-primary: #0f62fe; }

    .channel-bar { display: flex; align-items: stretch; gap: 2px; padding: 0 16px; background: #262626; border-bottom: 1px solid #393939; overflow-x: auto; }
    .channel-tab {
      flex: 0 1 268px; min-width: 196px; display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto;
      align-items: center; gap: 2px 10px; padding: 8px 14px 9px; background: transparent; border: 0; border-bottom: 2px solid transparent;
      color: #a8a8a8; cursor: pointer; text-align: left; font-family: inherit;
    }
    .channel-tab:hover { background: #333333; color: #f4f4f4; }
    .channel-tab.active { background: #303030; border-bottom-color: #78a9ff; color: #ffffff; }
    .channel-dot { grid-row: 1 / 3; width: 8px; height: 8px; border-radius: 50%; background: #42be65; }
    .channel-dot.degraded { background: #f1c21b; }
    .channel-dot.offline { background: #fa4d56; }
    .channel-name { font-size: 12px; font-weight: 600; white-space: nowrap; }
    .channel-delay { font: 10px/1 "IBM Plex Mono", monospace; color: #8d8d8d; }
    .channel-meta { grid-column: 2 / 4; display: flex; gap: 5px; flex-wrap: wrap; }
    .channel-badge { font-size: 9px; line-height: 1.5; padding: 0 6px; background: #393939; color: #c6c6c6; white-space: nowrap; }
    .channel-badge.busy { background: #0f4abe; color: #ffffff; }
    .channel-badge.alert { background: #6929c4; color: #ffffff; }
    .channel-badge.offbox { background: #da1e28; color: #ffffff; }
    .channel-badge.clear { background: transparent; border: 1px solid #525252; color: #8d8d8d; }
    .channel-hint { margin-left: auto; align-self: center; color: #6f6f6f; font-size: 10px; white-space: nowrap; padding-left: 12px; }

    .status-strip {
      min-height: 60px; padding: 8px 20px; display: grid; grid-template-columns: 1.5fr repeat(4, minmax(118px, .6fr)) auto;
      gap: 0; align-items: stretch; background: var(--cds-layer, #fff); border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0);
    }
    .status-cell { padding: 7px 16px; border-right: 1px solid var(--cds-border-subtle, #e0e0e0); display: flex; flex-direction: column; justify-content: center; }
    .status-cell:first-child { padding-left: 4px; }
    .status-cell:last-child { border-right: 0; }
    .status-cell strong { font-size: 20px; font-weight: 400; line-height: 1.05; font-variant-numeric: tabular-nums; }
    .status-cell span { margin-top: 3px; color: var(--cds-text-secondary, #525252); font-size: 10px; letter-spacing: .03em; }
    .status-cell.warning strong, .status-cell.warning span { color: #b28600; }
    .status-cell.danger strong, .status-cell.danger span { color: #da1e28; }
    .status-cell.hero strong { font-size: 14px; }
    .queue-track { width: 100%; height: 3px; margin-top: 6px; background: #e0e0e0; }
    .queue-track > span { display: block; height: 100%; background: #0f62fe; transition: width .3s ease; }
    .font-controls { min-width: 190px; padding: 7px 4px 7px 18px; display: flex; align-items: center; gap: 8px; }
    .font-controls label { color: var(--cds-text-secondary, #525252); font-size: 10px; }

    .workspace {
      min-height: 0; display: grid; grid-template-columns: minmax(390px, .95fr) minmax(430px, 1.05fr) minmax(370px, .9fr);
      gap: 1px; background: var(--cds-border-subtle, #e0e0e0); overflow: hidden;
    }

    .column { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--cds-background, #f4f4f4); }
    .column-head {
      min-height: 62px; padding: 11px 14px 9px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: var(--cds-layer, #fff); border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0);
    }
    .column-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
    .column-head p { margin: 4px 0 0; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .column-body { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-color: #8d8d8d transparent; }

    .segment-list { padding: 8px; display: flex; flex-direction: column; gap: 1px; }
    .segment-card {
      width: 100%; border: 0; border-left: 3px solid transparent; background: var(--cds-layer, #fff);
      color: inherit; text-align: left; padding: 11px 12px 10px 14px; cursor: pointer; position: relative;
    }
    .segment-card:hover { background: var(--cds-layer-hover, #e8e8e8); }
    .segment-card.selected { border-left-color: #0f62fe; background: var(--cds-layer-selected, #edf5ff); outline: 1px solid #78a9ff; }
    .segment-card.duplicate { border-left-color: #a56eff; }
    .segment-card.stale { border-left-color: #f1c21b; background: color-mix(in srgb, #fff 92%, #f1c21b 8%); }
    .segment-card.confirmed { border-left-color: #42be65; }
    .segment-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
    .segment-meta > span:first-child { color: var(--cds-text-secondary, #525252); font: 500 10px/1 "IBM Plex Mono", monospace; }
    .segment-state { font-size: 10px; color: #525252; }
    .segment-state.stale { color: #8d6e00; }
    .segment-state.duplicate { color: #6929c4; }
    .segment-state.confirmed { color: #198038; }
    .segment-text { margin: 0; font-size: var(--caption-font-size); line-height: 1.5; }
    .segment-corrected { margin: 6px 0 0; padding-left: 8px; border-left: 2px solid #42be65; color: #198038; font-size: calc(var(--caption-font-size) * .88); line-height: 1.45; }
    .segment-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .segment-foot b { color: #0f62fe; font-weight: 500; }
    .issue-note { margin-top: 8px; padding: 7px 8px; background: #fff8e1; border-left: 2px solid #f1c21b; color: #684e00; font-size: 10px; line-height: 1.45; }
    .duplicate-note { background: #f6f2ff; border-color: #a56eff; color: #491d8b; }

    .empty { padding: 48px 24px; text-align: center; color: var(--cds-text-secondary, #525252); }
    .empty strong { display: block; color: var(--cds-text-primary, #161616); margin-bottom: 6px; }
    .empty p { margin: 0; font-size: 11px; line-height: 1.5; }

    .editor-scroll { padding: 14px; overflow: auto; }
    .editor-card { background: var(--cds-layer, #fff); border: 1px solid var(--cds-border-subtle, #e0e0e0); }
    .editor-top { padding: 12px 14px; border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0); display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; }
    .editor-time { color: #0f62fe; font: 500 12px/1.4 "IBM Plex Mono", monospace; }
    .editor-title { margin: 4px 0 0; font-size: 12px; color: var(--cds-text-secondary, #525252); }
    .editor-status { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .editor-form { padding: 14px; display: flex; flex-direction: column; gap: 13px; }
    .form-grid { display: grid; grid-template-columns: minmax(130px, .6fr) 1fr; gap: 12px; align-items: end; }
    .caption-input { min-height: 158px; --cds-body-compact-01-font-size: var(--caption-font-size); --cds-body-compact-02-font-size: var(--caption-font-size); }
    .edit-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .edit-toolbar > span { margin-right: 5px; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .number-input { width: 110px; }
    .rule-suggestions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .rule-suggestions small { color: var(--cds-text-secondary, #525252); }
    .confirm-bar { padding: 12px 14px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--cds-border-subtle, #e0e0e0); background: var(--cds-layer-02, #f4f4f4); }
    .confirm-hint { color: var(--cds-text-secondary, #525252); font-size: 10px; line-height: 1.4; }
    .confirm-hint kbd { padding: 3px 5px; border: 1px solid var(--cds-border-strong, #8d8d8d); background: var(--cds-layer, #fff); color: var(--cds-text-primary, #161616); font: 10px/1 "IBM Plex Mono", monospace; }

    .inspector { padding: 12px 14px 20px; display: flex; flex-direction: column; gap: 14px; }
    .inspector-section { background: var(--cds-layer, #fff); border: 1px solid var(--cds-border-subtle, #e0e0e0); }
    .inspector-section-head { padding: 10px 12px; border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .inspector-section-head h3 { margin: 0; font-size: 12px; }
    .inspector-section-head span { color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .rule-list { padding: 5px 0; }
    .rule-item { padding: 8px 10px; display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0); }
    .rule-item:last-child { border-bottom: 0; }
    .rule-item strong { display: block; font-size: 11px; }
    .rule-item p { margin: 3px 0 0; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .rule-item-actions { display: flex; gap: 3px; }
    .rule-form { padding: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .rule-form cds-text-input, .rule-form cds-button { width: 100%; }
    .rule-form .full { grid-column: 1 / -1; }
    .live-timeline { padding: 6px 0; }
    .live-item { padding: 8px 11px; border-left: 3px solid #42be65; margin: 0 10px 7px; background: var(--cds-layer-02, #f4f4f4); }
    .live-item time { color: #198038; font: 500 9px/1 "IBM Plex Mono", monospace; }
    .live-item p { margin: 5px 0 0; font-size: var(--caption-font-size); line-height: 1.45; }
    .live-item small { display: block; margin-top: 4px; color: var(--cds-text-secondary, #525252); font-size: 9px; }
    .delivery-status { margin: 0 10px 10px; padding: 9px 10px; background: #edf5ff; border-left: 3px solid #0f62fe; color: #0043ce; font-size: 10px; line-height: 1.45; }

    .toast-stack { position: fixed; right: 18px; bottom: 18px; z-index: 20; width: 380px; display: flex; flex-direction: column; gap: 8px; }
    cds-toast-notification { box-shadow: 0 8px 22px rgba(0,0,0,.18); }

    @media (max-width: 1280px) {
      .workspace { grid-template-columns: minmax(340px, .85fr) minmax(410px, 1fr) minmax(330px, .85fr); }
      .status-strip { grid-template-columns: 1.4fr repeat(4, minmax(100px, .55fr)); }
      .font-controls { display: none; }
    }

    @media (max-width: 980px) {
      .topbar { grid-template-columns: 1fr auto; }
      .connection-pill { grid-row: 2; grid-column: 1 / -1; justify-self: stretch; min-width: 0; }
      .workspace { grid-template-columns: 1fr; overflow: visible; }
      .column { min-height: 520px; }
      .shell { display: block; }
      .status-strip { grid-template-columns: repeat(4, 1fr); }
      .status-cell.hero { grid-column: 1 / -1; }
      .channel-hint { display: none; }
    }
  `;

  @state() private workbench: DeskModel = this.loadWorkbench();
  @state() private dark = localStorage.getItem(`${STORAGE_KEY}-theme`) === 'dark';
  @state() private toasts: ToastMessage[] = [];
  @state() private drafts: Record<ChannelId, DraftView> = {
    main: emptyDraft(),
    breakout: emptyDraft(),
    interview: emptyDraft(),
  };
  private histories: Record<ChannelId, { past: ChannelModel[]; future: ChannelModel[] }> = {
    main: { past: [], future: [] },
    breakout: { past: [], future: [] },
    interview: { past: [], future: [] },
  };
  private ticker?: number;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleShortcut);
    this.ticker = window.setInterval(() => {
      // 三路信号各自推流，未值守的频道也会积压，但数据互不串用。
      const channels = { ...this.workbench.channels };
      let changed = false;
      for (const id of CHANNELS.map((item) => item.id)) {
        const before = channels[id];
        const after = simulateLatency(before, id);
        if (after === before) continue;
        const segmentChanged = JSON.stringify(after.segments) !== JSON.stringify(before.segments) || after.connection !== before.connection;
        if (segmentChanged) {
          channels[id] = after;
          changed = true;
        }
      }
      if (changed) this.replaceWorkbench({ ...this.workbench, channels });
    }, 5_000);
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleShortcut);
    if (this.ticker) window.clearInterval(this.ticker);
    super.disconnectedCallback();
  }

  private loadWorkbench(): DeskModel {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return migrateModel(JSON.parse(raw));
    } catch {
      // 损坏草稿会回退到演示数据。
    }
    return createInitialModel();
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.workbench, updatedAt: Date.now() }));
  }

  private get activeId(): ChannelId {
    return this.workbench.activeChannelId;
  }

  private get channel(): ChannelModel {
    return this.workbench.channels[this.activeId];
  }

  private get draft(): DraftView {
    return this.drafts[this.activeId];
  }

  private channelName(id: ChannelId): string {
    return CHANNELS.find((item) => item.id === id)?.name ?? id;
  }

  private replaceWorkbench(next: DeskModel): void {
    this.workbench = { ...next, updatedAt: Date.now() };
    this.persist();
  }

  /** 只修改当前频道，并把修改前快照压入当前频道自己的撤销栈。 */
  private commit(label: string, update: (current: ChannelModel) => ChannelModel): void {
    const id = this.activeId;
    const previous = cloneModel(this.channel);
    const next = update(cloneModel(this.channel));
    next.updatedAt = Date.now();
    const history = this.histories[id];
    history.past = [...history.past, previous].slice(-HISTORY_LIMIT);
    history.future = [];
    this.workbench = {
      ...this.workbench,
      channels: { ...this.workbench.channels, [id]: next },
      updatedAt: Date.now(),
    };
    this.persist();
    if (label) this.pushToast('info', label, `${this.channelName(id)} · 已写入浏览器本地草稿`);
  }

  /** 选中、字号调整等不进撤销栈的自动保存。 */
  private automatic(next: ChannelModel): void {
    const id = this.activeId;
    this.workbench = {
      ...this.workbench,
      channels: { ...this.workbench.channels, [id]: { ...next, updatedAt: Date.now() } },
      updatedAt: Date.now(),
    };
    this.persist();
  }

  private patchDraft(patch: Partial<DraftView>): void {
    const id = this.activeId;
    this.drafts = { ...this.drafts, [id]: { ...this.drafts[id], ...patch } };
  }

  private undo(): void {
    const history = this.histories[this.activeId];
    const previous = history.past.pop();
    if (!previous) return this.pushToast('info', '没有可撤销的修改', `${this.channelName(this.activeId)} 的历史记录为空`);
    history.future = [cloneModel(this.channel), ...history.future].slice(0, HISTORY_LIMIT);
    this.automatic(previous);
  }

  private redo(): void {
    const history = this.histories[this.activeId];
    const next = history.future.shift();
    if (!next) return;
    history.past = [...history.past, cloneModel(this.channel)].slice(-HISTORY_LIMIT);
    this.automatic(next);
  }

  private pushToast(kind: ToastMessage['kind'], title: string, subtitle: string): void {
    const toast = { id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, title, subtitle };
    this.toasts = [toast, ...this.toasts].slice(0, 3);
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((item) => item.id !== toast.id);
    }, 4_500);
  }

  private get selected(): CaptionSegment | undefined {
    return this.channel.segments.find((item) => item.id === this.channel.selectedId);
  }

  private get stats() {
    return queueStats(this.channel);
  }

  private get pendingSegments(): CaptionSegment[] {
    const filter = this.draft.filter;
    const items = this.channel.segments.filter((item) => {
      if (filter === 'active') return item.state === 'pending' || item.state === 'stale' || item.state === 'duplicate';
      if (filter === 'attention') return item.state === 'stale' || item.state === 'duplicate';
      return true;
    });
    return [...items].sort((a, b) => a.sequence - b.sequence);
  }

  private updateSelected(patch: Partial<CaptionSegment>, label = ''): void {
    const selected = this.selected;
    if (!selected) return;
    this.commit(label, (current) => ({
      ...current,
      segments: current.segments.map((item) => item.id === selected.id ? { ...item, ...patch, revision: item.revision + 1 } : item),
    }));
  }

  private selectSegment(id: string): void {
    this.automatic({ ...this.channel, selectedId: id });
  }

  private switchChannel(id: ChannelId): void {
    if (id === this.activeId) return;
    // 草稿、过滤器和选中片段都按频道存放，切换只换指针，不搬运任何编辑内容。
    this.replaceWorkbench({ ...this.workbench, activeChannelId: id });
    const stats = queueStats(this.workbench.channels[id]);
    this.pushToast('info', `已切换到${this.channelName(id)}`, `队列、草稿、术语与直播输出均为该频道独立保留 · 待处理 ${stats.backlog} 段`);
  }

  private navigate(direction: number): void {
    const candidates = this.pendingSegments.length ? this.pendingSegments : [...this.channel.segments].sort((a, b) => a.sequence - b.sequence);
    const index = candidates.findIndex((item) => item.id === this.channel.selectedId);
    const next = candidates[Math.max(0, Math.min(candidates.length - 1, index + direction))];
    if (next) this.selectSegment(next.id);
  }

  private applyTerm(ruleId: string): void {
    const selected = this.selected;
    const rule = this.channel.rules.find((item) => item.id === ruleId);
    if (!selected || !rule) return;
    const flags = rule.caseSensitive ? 'g' : 'gi';
    const expression = new RegExp(rule.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    if (!expression.test(selected.corrected)) {
      this.pushToast('warning', '当前字幕没有该术语', `${rule.source} → ${rule.replacement}`);
      return;
    }
    this.commit('应用术语替换', (current) => ({
      ...current,
      rules: current.rules.map((item) => item.id === rule.id ? { ...item, usageCount: item.usageCount + 1 } : item),
      segments: current.segments.map((item) => item.id === selected.id ? { ...item, corrected: item.corrected.replace(expression, rule.replacement), revision: item.revision + 1 } : item),
    }));
  }

  private applyInlineEdit(transform: (value: string) => string, label: string, cursorShift = 0): void {
    const selected = this.selected;
    if (!selected) return;
    const host = this.renderRoot.querySelector('cds-textarea');
    const textarea = host?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | undefined;
    let value = selected.corrected;
    let cursor = value.length;

    if (textarea) {
      value = `${value.slice(0, textarea.selectionStart)}${transform('')}${value.slice(textarea.selectionEnd)}`;
      cursor = textarea.selectionStart + transform('').length + cursorShift;
    } else {
      value = transform(value);
    }

    this.updateSelected({ corrected: value }, label);
    this.updateComplete.then(() => {
      const nextTextarea = this.renderRoot.querySelector('cds-textarea')?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | undefined;
      if (nextTextarea && textarea) {
        nextTextarea.focus();
        nextTextarea.setSelectionRange(cursor, cursor);
      }
    });
  }

  private insertPunctuation(mark: string): void {
    this.applyInlineEdit(() => mark, `插入${mark}`);
  }

  private wrapSelection(open: string, close: string): void {
    const host = this.renderRoot.querySelector('cds-textarea');
    const textarea = host?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | undefined;
    const selected = this.selected;
    if (!textarea || !selected) return;
    const selectedText = selected.corrected.slice(textarea.selectionStart, textarea.selectionEnd) || '重点';
    const value = `${selected.corrected.slice(0, textarea.selectionStart)}${open}${selectedText}${close}${selected.corrected.slice(textarea.selectionEnd)}`;
    this.updateSelected({ corrected: value }, '添加强调标点');
  }

  private normalizeCurrentNumbers(): void {
    const selected = this.selected;
    if (!selected) return;
    const normalized = normalizeNumbers(selected.corrected);
    if (normalized === selected.corrected) {
      this.pushToast('info', '没有需要规范化的数字', '已检查全角数字和中文数字');
      return;
    }
    this.updateSelected({ corrected: normalized, numberHints: normalized }, '规范化数字');
  }

  private confirmSelected(): void {
    const selected = this.selected;
    if (!selected) {
      this.pushToast('warning', '没有可确认的片段', '请先从待确认区选择字幕');
      return;
    }
    const channelId = this.activeId;
    const { text, used } = applyRules(selected.corrected, this.channel);
    const offline = this.channel.connection === 'offline';
    const nextOrder = this.pendingSegments.filter((item) => item.id !== selected.id);
    this.commit('确认并送入直播区', (current) => ({
      ...current,
      segments: current.segments.map((item) => item.id === selected.id ? {
        ...item,
        corrected: text,
        state: 'confirmed',
        source: offline ? 'offline' : item.source,
        confirmedAt: Date.now(),
        staleReason: item.state === 'stale' ? item.staleReason : undefined,
        tags: used.length ? [...new Set([...item.tags, '术语已应用'])] : item.tags,
        revision: item.revision + 1,
      } : item),
      rules: current.rules.map((rule) => used.includes(rule.id) ? { ...rule, usageCount: rule.usageCount + 1 } : rule),
      selectedId: nextOrder[0]?.id ?? selected.id,
    }));
    this.pushToast(
      offline ? 'warning' : 'success',
      offline ? `已加入${this.channelName(channelId)}离线发件箱` : `${this.channelName(channelId)}直播区已更新`,
      offline ? '恢复连接后将按本频道时间顺序合并' : `第 ${selected.sequence} 段已确认`,
    );
  }

  private ignoreSelected(): void {
    const selected = this.selected;
    if (!selected) return;
    const next = this.pendingSegments.find((item) => item.id !== selected.id);
    this.commit('忽略问题片段', (current) => ({
      ...current,
      segments: current.segments.map((item) => item.id === selected.id ? { ...item, state: 'ignored', staleReason: '已人工忽略' } : item),
      selectedId: next?.id ?? selected.id,
    }));
  }

  private recoverDuplicate(): void {
    const selected = this.selected;
    if (!selected) return;
    this.commit('保留重复片段', (current) => ({
      ...current,
      segments: current.segments.map((item) => item.id === selected.id ? { ...item, state: 'pending', duplicateOf: undefined, staleReason: '重复提示已由校对员确认保留' } : item),
    }));
  }

  private setConnection(connection: ConnectionState): void {
    const id = this.activeId;
    this.commit(connection === 'offline' ? `切换${this.channelName(id)}到离线校正` : connection === 'degraded' ? '模拟延迟波动' : `${this.channelName(id)}连接已恢复`, (current) => ({
      ...current,
      connection,
      simulatedDelay: connection === 'connected' ? 0.8 : connection === 'degraded' ? 4.6 : current.simulatedDelay,
    }));
  }

  private mergeOffline(): void {
    const id = this.activeId;
    const merged = mergeConfirmedSegments(this.channel);
    const history = this.histories[id];
    history.past = [...history.past, cloneModel(this.channel)].slice(-HISTORY_LIMIT);
    history.future = [];
    this.automatic(merged);
    const outboxCount = merged.segments.filter((item) => item.source === 'offline' && item.state === 'confirmed').length;
    this.pushToast('success', `${this.channelName(id)}离线队列已合并`, `${outboxCount} 个片段仍标记为离线来源，重复与过期仅按本频道顺序重新检查`);
  }

  private addRuleFromSelection(): void {
    const selected = this.selected;
    if (!selected) return;
    this.patchDraft({
      ruleSource: selected.corrected.length > 24 ? selected.corrected.slice(0, 24) : selected.corrected,
      ruleReplacement: selected.corrected,
      ruleSpeaker: selected.speaker,
      showRuleForm: true,
    });
  }

  private addRule(): void {
    const source = this.draft.ruleSource.trim();
    const replacement = this.draft.ruleReplacement.trim();
    if (!source || !replacement) {
      this.pushToast('warning', '规则不完整', '原文和替换文本均不能为空');
      return;
    }
    const speaker = this.draft.ruleSpeaker;
    this.commit('新增术语快捷规则', (current) => ({
      ...current,
      rules: [{
        id: `term-${this.activeId}-${Date.now().toString(36)}`,
        source,
        replacement,
        speaker,
        enabled: true,
        caseSensitive: false,
        usageCount: 0,
        createdAt: Date.now(),
      }, ...current.rules],
    }));
    this.patchDraft({ ruleSource: '', ruleReplacement: '', ruleSpeaker: '', showRuleForm: false });
  }

  private deleteRule(id: string): void {
    this.commit('删除术语规则', (current) => ({ ...current, rules: current.rules.filter((item) => item.id !== id) }));
  }

  private exportSrt(): void {
    const channel = this.channel;
    const content = toSrt(channel);
    if (!content) {
      this.pushToast('warning', `${this.channelName(this.activeId)}暂无已确认字幕`, 'SRT 只包含当前频道，先确认至少一个片段再导出');
      return;
    }
    const blob = new Blob([content], { type: 'application/x-subrip;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${channel.eventName.replace(/[^\p{L}\p{N}-]+/gu, '-')}-${this.activeId}.srt`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.pushToast('success', `${this.channelName(this.activeId)} SRT 已导出`, `${toSrt(channel).split('\n\n').length} 段字幕，其他频道未包含`);
  }

  private adjustFont(delta: number): void {
    const fontSize = Math.max(14, Math.min(28, this.workbench.fontSize + delta));
    this.replaceWorkbench({ ...this.workbench, fontSize });
  }

  private toggleTheme(): void {
    this.dark = !this.dark;
    localStorage.setItem(`${STORAGE_KEY}-theme`, this.dark ? 'dark' : 'light');
  }

  private handleShortcut = (event: KeyboardEvent): void => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLocaleLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (modifier && event.key.toLocaleLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      this.confirmSelected();
      return;
    }
    if (event.altKey && !modifier) {
      const channelIndex = ['1', '2', '3'].indexOf(event.key);
      if (channelIndex >= 0) {
        event.preventDefault();
        this.switchChannel(CHANNELS[channelIndex].id);
        return;
      }
      if (event.key.toLocaleLowerCase() === 'j') {
        event.preventDefault();
        this.navigate(1);
        return;
      }
      if (event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        this.navigate(-1);
        return;
      }
    }
    const punctuation: Record<string, string> = { '1': '，', '2': '。', '3': '？', '4': '！' };
    if (modifier && punctuation[event.key]) {
      event.preventDefault();
      this.insertPunctuation(punctuation[event.key]);
    }
  };

  private renderChannelBar() {
    return html`
      <nav class="channel-bar" aria-label="频道切换">
        ${CHANNELS.map((channelInfo) => {
          const data = this.workbench.channels[channelInfo.id];
          const stats = queueStats(data);
          const active = channelInfo.id === this.activeId;
          const attention = stats.stale + stats.duplicate;
          return html`
            <button class="channel-tab ${active ? 'active' : ''}" aria-pressed=${active} @click=${() => this.switchChannel(channelInfo.id)}>
              <span class="channel-dot ${data.connection}"></span>
              <span class="channel-name">${channelInfo.name}</span>
              <span class="channel-delay">${data.simulatedDelay.toFixed(1)}s</span>
              <span class="channel-meta">
                ${stats.offline > 0 ? html`<span class="channel-badge offbox">发件箱 ${stats.offline}</span>` : nothing}
                ${stats.backlog - stats.offline > 0
                  ? html`<span class="channel-badge ${attention > 0 ? 'alert' : 'busy'}">待处理 ${stats.pending + stats.stale + stats.duplicate}</span>`
                  : html`<span class="channel-badge clear">队列清空</span>`}
              </span>
            </button>
          `;
        })}
        <span class="channel-hint"><kbd>Alt</kbd> + <kbd>1/2/3</kbd> 切换频道 · 队列、草稿、术语与直播输出各频道独立</span>
      </nav>
    `;
  }

  private renderPendingList() {
    const segments = this.pendingSegments;
    if (!segments.length) {
      return html`<div class="empty"><strong>${this.channelName(this.activeId)}待确认区已清空</strong><p>新的实时片段到达时会自动进入这里，不影响其他频道。</p></div>`;
    }
    return html`
      <div class="segment-list">
        ${segments.map((item) => html`
          <button class="segment-card ${item.id === this.channel.selectedId ? 'selected' : ''} ${item.state}" @click=${() => this.selectSegment(item.id)}>
            <div class="segment-meta">
              <span>${formatClock(item.startTime)} · #${String(item.sequence).padStart(3, '0')}</span>
              <span class="segment-state ${item.state}">${stateLabel(item.state)}</span>
            </div>
            <p class="segment-text">${item.original}</p>
            ${item.corrected !== item.original ? html`<p class="segment-corrected">${item.corrected}</p>` : nothing}
            <div class="segment-foot">
              <span>${item.speaker}</span>
              <span>·</span>
              <span>${formatAge(item.receivedAt)}</span>
              ${item.revision > 0 ? html`<span>· <b>修改 ${item.revision} 次</b></span>` : nothing}
            </div>
            ${item.state === 'stale' && item.staleReason ? html`<div class="issue-note">${item.staleReason}。确认前请核对${this.channelName(this.activeId)}直播上下文。</div>` : nothing}
            ${item.state === 'duplicate' ? html`<div class="issue-note duplicate-note">${item.staleReason || '检测到重复片段'}（仅与本频道片段比对），请保留或忽略。</div>` : nothing}
          </button>
        `)}
      </div>
    `;
  }

  private renderEditor() {
    const item = this.selected;
    if (!item) {
      return html`<div class="empty"><strong>${this.channelName(this.activeId)}没有选中的字幕</strong><p>可以使用 Alt+J / Alt+K 在本频道片段之间移动。</p></div>`;
    }
    const applicableRules = this.channel.rules.filter((rule) => rule.enabled && (!rule.speaker || rule.speaker === item.speaker));
    return html`
      <div class="editor-scroll">
        <div class="editor-card">
          <div class="editor-top">
            <div>
              <div class="editor-time">${formatClock(item.startTime)} — ${formatClock(item.startTime + 7)}</div>
              <p class="editor-title">${this.channelName(this.activeId)} · 实时片段 #${String(item.sequence).padStart(3, '0')} · 到达于 ${formatAge(item.receivedAt)}</p>
            </div>
            <div class="editor-status">
              <cds-tag type=${item.state === 'stale' ? 'warm-gray' : item.state === 'duplicate' ? 'purple' : 'blue'} size="sm">${stateLabel(item.state)}</cds-tag>
              <cds-tag type="outline" size="sm">修改 ${item.revision} 次</cds-tag>
            </div>
          </div>
          <div class="editor-form">
            ${item.state === 'duplicate' ? html`
              <cds-inline-notification kind="warning" low-contrast title="重复片段提示" subtitle=${`${item.staleReason || '与本频道已确认片段高度相似'}（不会跨频道判定）`}>
                <cds-button slot="action" size="sm" @click=${this.recoverDuplicate}>保留并继续校对</cds-button>
              </cds-inline-notification>
            ` : nothing}
            ${item.state === 'stale' ? html`
              <cds-inline-notification kind="warning" low-contrast title="过期修改" subtitle=${`${item.staleReason || '该片段已超过 90 秒未确认'}。请结合${this.channelName(this.activeId)}上下文确认，或忽略以避免污染直播区。`}></cds-inline-notification>
            ` : nothing}
            <div class="form-grid">
              <cds-select label-text="发言人" value=${item.speaker} @cds-select-selected=${(event: CustomEvent<{ value: string }>) => this.updateSelected({ speaker: event.detail.value }, '修改发言人')}>
                ${['主持人', '主讲人', '嘉宾 / 周然', '现场提问', '工作坊主持', '讲师 / 林岚', '助教', '记者', '摄像导播', '未知发言人'].map((speaker) => html`<cds-select-item value=${speaker}>${speaker}</cds-select-item>`)}
              </cds-select>
              <cds-number-input class="number-input" label="本频道延迟（秒）" .value=${this.channel.simulatedDelay} step="0.1" min="0" max="9" @input=${(event: Event) => this.automatic({ ...this.channel, simulatedDelay: Number((event.currentTarget as any).value) })}></cds-number-input>
            </div>
            <cds-textarea
              class="caption-input"
              label-text=${`校对后的字幕文本 · ${this.channelName(this.activeId)}草稿`}
              helper-text="Ctrl/⌘ + 1–4 快速插入标点；术语规则将从左到右自动应用；切频道不会带走此草稿"
              .value=${item.corrected}
              @input=${(event: Event) => this.updateSelected({ corrected: (event.currentTarget as any).value }, '')}
            ></cds-textarea>
            <div class="edit-toolbar">
              <span>快速标点</span>
              <cds-button kind="ghost" size="sm" @click=${() => this.insertPunctuation('，')}>，逗号</cds-button>
              <cds-button kind="ghost" size="sm" @click=${() => this.insertPunctuation('。')}>。句号</cds-button>
              <cds-button kind="ghost" size="sm" @click=${() => this.insertPunctuation('？')}>？问号</cds-button>
              <cds-button kind="ghost" size="sm" @click=${() => this.insertPunctuation('…')}>…省略</cds-button>
              <cds-button kind="ghost" size="sm" @click=${() => this.wrapSelection('（', '）')}>（）括注</cds-button>
              <cds-button kind="secondary" size="sm" @click=${this.normalizeCurrentNumbers}>规范化数字</cds-button>
            </div>
            <div class="rule-suggestions">
              <small>${this.channelName(this.activeId)}术语快捷替换</small>
              ${applicableRules.length ? applicableRules.map((rule) => html`
                <cds-button kind="tertiary" size="sm" @click=${() => this.applyTerm(rule.id)}>${rule.source} → ${rule.replacement}</cds-button>
              `) : html`<small>当前发言人在本频道的规则为空</small>`}
              <cds-button kind="ghost" size="sm" @click=${this.addRuleFromSelection}>＋ 从当前文本新建</cds-button>
            </div>
          </div>
          <div class="confirm-bar">
            <div class="confirm-hint"><kbd>⌘/Ctrl Enter</kbd> 确认并进入${this.channelName(this.activeId)}直播区 · <kbd>Alt J/K</kbd> 切换片段 · <kbd>Alt 1/2/3</kbd> 切频道</div>
            <div>
              <cds-button kind="danger--tertiary" size="sm" @click=${this.ignoreSelected}>忽略片段</cds-button>
              <cds-button kind="primary" @click=${this.confirmSelected}>确认并送入直播区</cds-button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderInspector() {
    const item = this.selected;
    const channel = this.channel;
    const confirmed = channel.segments.filter((segment) => segment.state === 'confirmed').sort((a, b) => a.startTime - b.startTime);
    const stats = queueStats(channel);
    return html`
      <div class="inspector">
        <section class="inspector-section">
          <div class="inspector-section-head">
            <h3>${this.channelName(this.activeId)}术语规则</h3>
            <span>${channel.rules.filter((rule) => rule.enabled).length} 条启用 · 仅本频道生效</span>
          </div>
          <div class="rule-list">
            ${channel.rules.map((rule) => html`
              <div class="rule-item">
                <div>
                  <strong>${rule.source} → ${rule.replacement}</strong>
                  <p>${rule.speaker || '全部发言人'} · 已使用 ${rule.usageCount} 次</p>
                </div>
                <div class="rule-item-actions">
                  <cds-button kind="ghost" size="sm" @click=${() => this.applyTerm(rule.id)}>应用</cds-button>
                  <cds-button kind="danger--ghost" size="xs" @click=${() => this.deleteRule(rule.id)}>删除</cds-button>
                </div>
              </div>
            `)}
          </div>
          ${this.draft.showRuleForm ? html`
            <div class="rule-form">
              <cds-text-input label-text="原文" .value=${this.draft.ruleSource} @input=${(event: Event) => this.patchDraft({ ruleSource: (event.currentTarget as any).value })}></cds-text-input>
              <cds-text-input label-text="替换为" .value=${this.draft.ruleReplacement} @input=${(event: Event) => this.patchDraft({ ruleReplacement: (event.currentTarget as any).value })}></cds-text-input>
              <cds-text-input class="full" label-text="仅对某发言人应用（可空）" .value=${this.draft.ruleSpeaker} @input=${(event: Event) => this.patchDraft({ ruleSpeaker: (event.currentTarget as any).value })}></cds-text-input>
              <cds-button class="full" size="sm" kind="primary" @click=${this.addRule}>保存到${this.channelName(this.activeId)}</cds-button>
            </div>
          ` : html`
            <div style="padding: 10px;"><cds-button kind="tertiary" size="sm" @click=${() => this.patchDraft({ showRuleForm: true })}>＋ 新增术语规则</cds-button></div>
          `}
        </section>

        <section class="inspector-section">
          <div class="inspector-section-head">
            <h3>${this.channelName(this.activeId)}直播输出</h3>
            <span>${confirmed.length} 段已确认</span>
          </div>
          <div class="live-timeline">
            ${confirmed.length ? confirmed.slice(-12).reverse().map((segment) => html`
              <article class="live-item">
                <time>${formatClock(segment.startTime)} · ${segment.speaker}</time>
                <p>${segment.corrected}</p>
                ${segment.source === 'offline' ? html`<small>离线来源 · 恢复后按本频道顺序合并</small>` : nothing}
              </article>
            `) : html`<div class="empty"><strong>${this.channelName(this.activeId)}直播区等待内容</strong><p>确认一块字幕后，它只会进入当前频道的实时输出。</p></div>`}
          </div>
          ${stats.offline > 0 ? html`<div class="delivery-status">本频道离线发件箱有 ${stats.offline} 段待合并。恢复连接后按本频道序号与时间顺序提交，不与其他频道比对，也不会覆盖已确认内容。</div>` : nothing}
        </section>

        <section class="inspector-section">
          <div class="inspector-section-head">
            <h3>当前片段上下文</h3>
            <span>${item ? `#${item.sequence}` : '未选择'}</span>
          </div>
          <div style="padding: 12px; line-height: 1.5; font-size: 11px;">
            ${item ? html`
              <div><strong>原始字幕：</strong>${item.original}</div>
              <div style="margin-top: 8px;"><strong>修改前校正：</strong>${item.corrected}</div>
              <div style="margin-top: 8px; color: var(--cds-text-secondary);">${item.tags.length ? `标签：${item.tags.join('、')}` : '尚未应用术语标签'}</div>
            ` : html`<span>请在${this.channelName(this.activeId)}选择片段以查看上下文。</span>`}
          </div>
        </section>
      </div>
    `;
  }

  render() {
    const stats = this.stats;
    const channel = this.channel;
    const backlogRatio = Math.min(100, stats.backlog * 8);
    return html`
      <div class="shell ${this.dark ? 'dark' : ''}" style=${`--caption-font-size: ${this.workbench.fontSize}px`}>
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark">CC</div>
            <div class="brand-copy">
              <strong>LiveCaption Desk</strong>
              <span>${this.channelName(this.activeId)} · ${channel.eventName} · 多频道值守</span>
            </div>
          </div>
          <div class="connection-pill ${channel.connection}">
            <span class="connection-dot"></span>
            <div class="connection-copy">
              <strong>${this.channelName(this.activeId)} · ${connectionLabel(channel.connection)} · ${channel.simulatedDelay.toFixed(1)} 秒延迟</strong>
              <small>${channel.connection === 'offline' ? '仍可编辑，确认内容进入本频道离线发件箱' : `本频道待确认队列 ${stats.pending} 段 · 最近自动保存 ${new Date(channel.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}</small>
            </div>
          </div>
          <div class="header-actions">
            <cds-button kind="ghost" size="sm" @click=${this.toggleTheme}>${this.dark ? '浅色界面' : '深色值守'}</cds-button>
            <cds-button kind="ghost" size="sm" @click=${this.undo}>撤销</cds-button>
            <cds-button kind="ghost" size="sm" @click=${this.redo}>重做</cds-button>
            <cds-button kind="primary" size="sm" @click=${this.exportSrt}>导出本频道 SRT</cds-button>
          </div>
        </header>

        ${this.renderChannelBar()}

        <section class="status-strip">
          <div class="status-cell hero">
            <strong>${channel.connection === 'offline' ? `${this.channelName(this.activeId)}离线校正中，确认后暂存本频道发件箱` : stats.backlog > 8 ? `${this.channelName(this.activeId)}队列积压，建议优先处理过期片段` : `${this.channelName(this.activeId)}队列节奏正常，可以继续逐段确认`}</strong>
            <span>待确认 ${stats.pending} · 过期 ${stats.stale} · 重复 ${stats.duplicate} · 离线待合并 ${stats.offline}</span>
            <div class="queue-track"><span style=${`width:${backlogRatio}%`}></span></div>
          </div>
          <div class="status-cell"><strong>${stats.pending}</strong><span>待确认片段</span></div>
          <div class="status-cell warning"><strong>${stats.oldestWaitSeconds}s</strong><span>最长等待时间</span></div>
          <div class="status-cell danger"><strong>${stats.stale + stats.duplicate}</strong><span>需要明确处理</span></div>
          <div class="status-cell"><strong>${channel.simulatedDelay.toFixed(1)}s</strong><span>当前流延迟</span></div>
          <div class="font-controls">
            <label>字幕字号（全局）</label>
            <cds-button kind="ghost" size="sm" @click=${() => this.adjustFont(-1)}>A−</cds-button>
            <strong>${this.workbench.fontSize}</strong>
            <cds-button kind="ghost" size="sm" @click=${() => this.adjustFont(1)}>A＋</cds-button>
          </div>
        </section>

        <main class="workspace">
          <section class="column">
            <div class="column-head">
              <div>
                <h2>${this.channelName(this.activeId)} · 待确认区</h2>
                <p>按本频道收到顺序排列，重复和过期内容不会被静默覆盖</p>
              </div>
              <cds-dropdown .value=${this.draft.filter} @cds-dropdown-selected=${(event: CustomEvent<{ item: { value: string } }>) => this.patchDraft({ filter: event.detail.item.value as QueueFilter })}>
                <cds-dropdown-item value="active">仅需处理</cds-dropdown-item>
                <cds-dropdown-item value="attention">异常优先</cds-dropdown-item>
                <cds-dropdown-item value="all">全部片段</cds-dropdown-item>
              </cds-dropdown>
            </div>
            <div class="column-body">${this.renderPendingList()}</div>
          </section>

          <section class="column">
            <div class="column-head">
              <div>
                <h2>${this.channelName(this.activeId)} · 校对编辑台</h2>
                <p>标点、专有名词、发言人和数字均可在确认前修改，草稿不跨频道</p>
              </div>
              <cds-tag type="green" size="sm">${this.channelName(this.activeId)}本地草稿</cds-tag>
            </div>
            <div class="column-body" style=${`font-size:${this.workbench.fontSize}px`}>${this.renderEditor()}</div>
          </section>

          <section class="column">
            <div class="column-head">
              <div>
                <h2>${this.channelName(this.activeId)} · 规则与直播区</h2>
                <p>确认后只进入本频道直播输出；离线内容恢复后在本频道内合并</p>
              </div>
              ${channel.connection === 'offline'
                ? html`<cds-button kind="primary" size="sm" @click=${this.mergeOffline}>恢复并合并</cds-button>`
                : html`<cds-button kind="danger--tertiary" size="sm" @click=${() => this.setConnection('offline')}>模拟本频道断线</cds-button>`}
            </div>
            <div class="column-body">${this.renderInspector()}</div>
          </section>
        </main>

        <div class="toast-stack">
          ${this.toasts.map((toast) => html`
            <cds-toast-notification
              kind=${toast.kind}
              title=${toast.title}
              subtitle=${toast.subtitle}
              @cds-notification-closed=${() => { this.toasts = this.toasts.filter((item) => item.id !== toast.id); }}
            ></cds-toast-notification>
          `)}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caption-desk': CaptionDesk;
  }
}
