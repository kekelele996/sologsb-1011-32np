export type ConnectionState = 'connected' | 'degraded' | 'offline';
export type SegmentState = 'pending' | 'confirmed' | 'duplicate' | 'stale' | 'ignored';
export type SegmentSource = 'live' | 'offline' | 'manual';

export interface CaptionSegment {
  id: string;
  sequence: number;
  startTime: number;
  receivedAt: number;
  confirmedAt?: number;
  speaker: string;
  original: string;
  corrected: string;
  numberHints: string;
  source: SegmentSource;
  state: SegmentState;
  duplicateOf?: string;
  staleReason?: string;
  revision: number;
  tags: string[];
}

export interface TermRule {
  id: string;
  source: string;
  replacement: string;
  speaker: string;
  enabled: boolean;
  caseSensitive: boolean;
  usageCount: number;
  createdAt: number;
}

/** 一个频道（主会场 / 分会场 / 采访间）的全部值守状态，彼此完全隔离。 */
export interface ChannelModel {
  eventName: string;
  segments: CaptionSegment[];
  rules: TermRule[];
  selectedId: string;
  connection: ConnectionState;
  simulatedDelay: number;
  nextSequence: number;
  autoStream: boolean;
  lastMergedAt?: number;
  updatedAt: number;
}

export const CHANNELS = [
  { id: 'main', name: '主会场' },
  { id: 'breakout', name: '分会场 A' },
  { id: 'interview', name: '采访间' },
] as const;

export type ChannelId = (typeof CHANNELS)[number]['id'];

/** 跨频道的工作台状态：字号等界面偏好全局共享，字幕数据全部落在各频道内。 */
export interface DeskModel {
  version: 2;
  activeChannelId: ChannelId;
  fontSize: number;
  channels: Record<ChannelId, ChannelModel>;
  updatedAt: number;
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  subtitle: string;
}

export const STORAGE_KEY = 'sologsb-1011-live-caption-desk-v1';

function makeSegment(
  now: number,
  prefix: string,
  sequence: number,
  startTime: number,
  speaker: string,
  original: string,
  corrected = original,
  state: SegmentState = 'pending',
): CaptionSegment {
  return {
    id: `${prefix}-seg-${sequence}`,
    sequence,
    startTime,
    receivedAt: now - (100 - sequence) * 8_000,
    confirmedAt: state === 'confirmed' ? now - (100 - sequence) * 7_000 : undefined,
    speaker,
    original,
    corrected,
    numberHints: '',
    source: 'live',
    state,
    revision: 0,
    tags: [],
  };
}

function createMainChannel(now: number): ChannelModel {
  const seg = (sequence: number, startTime: number, speaker: string, original: string, corrected = original, state: SegmentState = 'pending') =>
    makeSegment(now, 'main', sequence, startTime, speaker, original, corrected, state);

  const segments: CaptionSegment[] = [
    seg(1, 0, '主持人', '欢迎大家来到二零二六年产品发布会。', '欢迎大家来到2026年产品发布会。', 'confirmed'),
    seg(2, 7, '主讲人', '今天我们会介绍三个模块,首先是实时协作。', '今天我们会介绍三个模块，首先是实时协作。', 'confirmed'),
    seg(3, 15, '主讲人', '延迟和质量监测会帮助我们保持字幕稳定。', '延迟和质量监测会帮助我们保持字幕稳定。', 'confirmed'),
    seg(4, 24, '嘉宾 / 周然', '我们使用 studio cloud 作为演示环境。', '我们使用 Studio Cloud 作为演示环境。'),
    seg(5, 34, '嘉宾 / 周然', '每分钟大约会收到一百二十个片段。', '每分钟大约会收到120个片段。'),
    seg(6, 43, '主持人', '如果主持人提到 co pilot,需要统一大小写。', '如果主持人提到 Co-Pilot，需要统一大小写。'),
    seg(7, 52, '主持人', '这个例子会演示五G网络下的字幕恢复。', '这个例子会演示5G网络下的字幕恢复。'),
    {
      ...seg(8, 61, '主讲人', '今天我们重点讨论字幕队列。', '今天我们重点讨论字幕队列。', 'duplicate'),
      duplicateOf: 'main-seg-2',
      staleReason: '与第 2 段高度相似',
    },
  ];

  return {
    eventName: '新品发布会现场字幕',
    segments,
    rules: [
      { id: 'main-term-1', source: 'co pilot', replacement: 'Co-Pilot', speaker: '', enabled: true, caseSensitive: false, usageCount: 4, createdAt: now - 86_400_000 },
      { id: 'main-term-2', source: 'studio cloud', replacement: 'Studio Cloud', speaker: '', enabled: true, caseSensitive: false, usageCount: 7, createdAt: now - 43_200_000 },
      { id: 'main-term-3', source: '五G', replacement: '5G', speaker: '', enabled: true, caseSensitive: true, usageCount: 2, createdAt: now - 3_600_000 },
    ],
    selectedId: 'main-seg-4',
    connection: 'connected',
    simulatedDelay: 1.8,
    nextSequence: 9,
    autoStream: true,
    updatedAt: now,
  };
}

function createBreakoutChannel(now: number): ChannelModel {
  const seg = (sequence: number, startTime: number, speaker: string, original: string, corrected = original, state: SegmentState = 'pending') =>
    makeSegment(now, 'breakout', sequence, startTime, speaker, original, corrected, state);

  const segments: CaptionSegment[] = [
    seg(1, 0, '工作坊主持', '大家好，分会场的工作坊马上开始。', '大家好，分会场的工作坊马上开始。', 'confirmed'),
    seg(2, 8, '讲师 / 林岚', '我们先看实时协作的演示数据。', '我们先看实时协作的演示数据。', 'confirmed'),
    // 与主会场第 3 段文本相同，但重复只在本频道判断，因此这里仍是正常待确认片段。
    seg(3, 17, '工作坊主持', '延迟和质量监测会帮助我们保持字幕稳定。'),
    seg(4, 26, '讲师 / 林岚', '请大家打开练习手册的第十二页。', '请大家打开练习手册的第12页。'),
    seg(5, 36, '助教', '这组接口的平均响应时间是二百三十毫秒。'),
    seg(6, 46, '讲师 / 林岚', '调用 api 之前记得先拿到 sdk 令牌。'),
    {
      ...seg(7, 55, '工作坊主持', '我们先看实时协作的演示数据。', '我们先看实时协作的演示数据。', 'duplicate'),
      duplicateOf: 'breakout-seg-2',
      staleReason: '与第 2 段高度相似',
    },
  ];

  return {
    eventName: '产品工作坊现场字幕',
    segments,
    rules: [
      { id: 'breakout-term-1', source: 'api', replacement: 'API', speaker: '', enabled: true, caseSensitive: false, usageCount: 3, createdAt: now - 72_000_000 },
      { id: 'breakout-term-2', source: 'sdk', replacement: 'SDK', speaker: '', enabled: true, caseSensitive: false, usageCount: 2, createdAt: now - 18_000_000 },
    ],
    selectedId: 'breakout-seg-4',
    connection: 'connected',
    simulatedDelay: 1.2,
    nextSequence: 8,
    autoStream: true,
    updatedAt: now,
  };
}

function createInterviewChannel(now: number): ChannelModel {
  const seg = (sequence: number, startTime: number, speaker: string, original: string, corrected = original, state: SegmentState = 'pending') =>
    makeSegment(now, 'interview', sequence, startTime, speaker, original, corrected, state);

  const segments: CaptionSegment[] = [
    seg(1, 0, '记者', '欢迎来到赛后采访间。', '欢迎来到赛后采访间。', 'confirmed'),
    seg(2, 9, '记者', '首先请回顾一下今天的五g发布环节。'),
    seg(3, 18, '嘉宾 / 周然', '我们计划在三十个城市落地体验店。', '我们计划在30个城市落地体验店。'),
    seg(4, 28, '嘉宾 / 周然', 'mvp 版本会在十一月开放预约。'),
    seg(5, 38, '记者', '最后一个问题来自线上观众。'),
    seg(6, 48, '摄像导播', '采访间信号正常，可以继续录制。', '采访间信号正常，可以继续录制。', 'confirmed'),
  ];

  return {
    eventName: '嘉宾专访现场字幕',
    segments,
    rules: [
      { id: 'interview-term-1', source: '五g', replacement: '5G', speaker: '', enabled: true, caseSensitive: false, usageCount: 1, createdAt: now - 1_200_000 },
      { id: 'interview-term-2', source: 'mvp', replacement: 'MVP', speaker: '', enabled: true, caseSensitive: false, usageCount: 2, createdAt: now - 600_000 },
    ],
    selectedId: 'interview-seg-2',
    connection: 'connected',
    simulatedDelay: 0.9,
    nextSequence: 7,
    autoStream: true,
    updatedAt: now,
  };
}

export function createInitialModel(): DeskModel {
  const now = Date.now();
  return {
    version: 2,
    activeChannelId: 'main',
    fontSize: 18,
    channels: {
      main: createMainChannel(now),
      breakout: createBreakoutChannel(now),
      interview: createInterviewChannel(now),
    },
    updatedAt: now,
  };
}

/** 把 v1 单频道存档迁移为主会场频道，其余两个频道用演示数据补齐。 */
export function migrateModel(raw: unknown): DeskModel {
  const parsed = raw as Partial<DeskModel> & Partial<ChannelModel> | null | undefined;
  if (parsed && parsed.version === 2 && parsed.channels && parsed.activeChannelId) {
    return parsed as DeskModel;
  }
  const initial = createInitialModel();
  if (parsed && Array.isArray(parsed.segments)) {
    const legacy = parsed as Partial<ChannelModel> & Pick<ChannelModel, 'segments'>;
    initial.channels.main = {
      eventName: legacy.eventName ?? initial.channels.main.eventName,
      segments: legacy.segments,
      rules: legacy.rules ?? initial.channels.main.rules,
      selectedId: legacy.selectedId || initial.channels.main.selectedId,
      connection: legacy.connection ?? 'connected',
      simulatedDelay: legacy.simulatedDelay ?? 1.8,
      nextSequence: legacy.nextSequence ?? 1,
      autoStream: legacy.autoStream ?? true,
      lastMergedAt: legacy.lastMergedAt,
      updatedAt: legacy.updatedAt ?? Date.now(),
    };
    initial.fontSize = (parsed as { fontSize?: number }).fontSize ?? 18;
  }
  return initial;
}

export function cloneModel<T>(model: T): T {
  return structuredClone(model);
}

export function normalizeNumbers(text: string): string {
  const digitMap: Record<string, string> = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9' };
  const chineseNumber = (raw: string): number => {
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!/[十百千万]/u.test(raw)) return Number([...raw].map((char) => digits[char] ?? 0).join(''));
    let total = 0;
    let section = 0;
    let number = 0;
    for (const char of raw) {
      if (digits[char] !== undefined) {
        number = digits[char];
      } else if (char === '十') {
        section += (number || 1) * 10;
        number = 0;
      } else if (char === '百') {
        section += (number || 1) * 100;
        number = 0;
      } else if (char === '千') {
        section += (number || 1) * 1000;
        number = 0;
      } else if (char === '万') {
        total += (section + number) * 10_000;
        section = 0;
        number = 0;
      }
    }
    return total + section + number;
  };

  return text
    .replace(/[０-９]/g, (char) => digitMap[char] ?? char)
    .replace(/([零〇一二两三四五六七八九十百千万]+)/gu, (match) => String(chineseNumber(match)))
    .replace(/(?<=\d)[，,](?=\d{3}\b)/g, ',');
}

export function normalizePunctuation(text: string): string {
  return text
    .replace(/([，。！？；：])(?=[^\s，。！？；：])/gu, '$1')
    .replace(/\s+([，。！？；：])/gu, '$1')
    .replace(/([,;:!?])(?=[^\s,;:!?])/g, (match) => ({ ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' }[match] ?? match));
}

export function applyRules(text: string, channel: ChannelModel): { text: string; used: string[] } {
  let next = text;
  const used: string[] = [];
  for (const rule of channel.rules.filter((item) => item.enabled)) {
    if (!rule.source || !next) continue;
    const flags = rule.caseSensitive ? 'g' : 'gi';
    const expression = new RegExp(rule.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    if (expression.test(next)) {
      next = next.replace(expression, rule.replacement);
      used.push(rule.id);
    }
  }
  return { text: normalizePunctuation(next), used };
}

export function isDuplicate(candidate: CaptionSegment, existing: CaptionSegment[]): CaptionSegment | undefined {
  const normalize = (value: string) => value.replace(/[\s，。！？；：,.;:!?]/g, '').toLocaleLowerCase();
  const candidateText = normalize(candidate.corrected || candidate.original);
  return existing.find((segmentItem) => {
    if (segmentItem.id === candidate.id || segmentItem.state === 'ignored') return false;
    const text = normalize(segmentItem.corrected || segmentItem.original);
    if (!candidateText || !text) return false;
    return text === candidateText || (Math.abs(segmentItem.startTime - candidate.startTime) < 12 && (text.includes(candidateText) || candidateText.includes(text)));
  });
}

/** 恢复连接后只在本频道内按序号、开始时间合并，重复判断也只看本频道片段。 */
export function mergeConfirmedSegments(channel: ChannelModel): ChannelModel {
  const seen: string[] = [];
  const segments = channel.segments
    .map((item) => ({ ...item }))
    .sort((a, b) => a.sequence - b.sequence || a.startTime - b.startTime)
    .map((item): CaptionSegment => {
      if (item.source === 'offline' && item.state === 'confirmed') {
        item.source = item.confirmedAt && Date.now() - item.confirmedAt > 90_000 ? 'offline' : 'live';
        item.staleReason = Date.now() - item.receivedAt > 90_000 ? `离线恢复后合并，原始片段已延迟 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` : undefined;
        if (item.staleReason) item.state = 'stale';
      }
      const duplicate = isDuplicate(item, seen.map((id) => channel.segments.find((segmentItem) => segmentItem.id === id)).filter(Boolean) as CaptionSegment[]);
      if (duplicate && item.state !== 'confirmed') {
        item.state = 'duplicate';
        item.duplicateOf = duplicate.id;
      }
      if (item.state !== 'ignored') seen.push(item.id);
      return item;
    });

  return {
    ...channel,
    segments,
    connection: 'connected',
    simulatedDelay: Math.max(0.8, channel.simulatedDelay - 0.7),
    lastMergedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function queueStats(channel: ChannelModel) {
  const pending = channel.segments.filter((item) => item.state === 'pending');
  const stale = channel.segments.filter((item) => item.state === 'stale');
  const duplicate = channel.segments.filter((item) => item.state === 'duplicate');
  const offline = channel.segments.filter((item) => item.source === 'offline' && item.state === 'confirmed');
  return {
    pending: pending.length,
    stale: stale.length,
    duplicate: duplicate.length,
    offline: offline.length,
    backlog: pending.length + stale.length + duplicate.length + offline.length,
    oldestWaitSeconds: pending.length ? Math.max(...pending.map((item) => Math.round((Date.now() - item.receivedAt) / 1000))) : 0,
  };
}

const CHANNEL_FEED: Record<ChannelId, { speakers: string[]; samples: string[] }> = {
  main: {
    speakers: ['主持人', '主讲人', '嘉宾 / 周然', '现场提问'],
    samples: [
      '接下来请产品团队介绍新的工作流。',
      '请注意屏幕右侧的实时队列状态。',
      '在弱网环境下我们会保留未确认片段。',
      '如果网络恢复,系统会按照时间顺序自动合并。',
      '这段字幕包含二零二五年的项目数据。',
      '大家可以在会后查看完整回放和术语表。',
    ],
  },
  breakout: {
    speakers: ['工作坊主持', '讲师 / 林岚', '助教'],
    samples: [
      '请大家在练习环境里跟着操作一遍。',
      '分会场的问题会统一收集到主持台。',
      '这一步可以用术语规则批量替换。',
      '小组讨论限时五分钟,之后回到主流程。',
      '遇到卡顿可以先标记为待确认。',
      '工作坊的录屏会在会后单独提供。',
    ],
  },
  interview: {
    speakers: ['记者', '嘉宾 / 周然', '摄像导播'],
    samples: [
      '请用一句话总结今天的发布。',
      '采访间的字幕需要和主会场分开导出。',
      '这个问题来自分会场的线上观众。',
      '稍后还有一段快问快答环节。',
      '导播提示还有三十秒采访时间。',
      '感谢嘉宾接受我们的专访。',
    ],
  },
};

export function createLiveSegment(sequence: number, channelId: ChannelId): CaptionSegment {
  const feed = CHANNEL_FEED[channelId] ?? CHANNEL_FEED.main;
  const start = Math.max(0, sequence * 9 - 10);
  return {
    id: `${channelId}-live-${sequence}-${Date.now().toString(36)}`,
    sequence,
    startTime: start,
    receivedAt: Date.now(),
    speaker: feed.speakers[(sequence - 1) % feed.speakers.length],
    original: feed.samples[(sequence - 1) % feed.samples.length],
    corrected: feed.samples[(sequence - 1) % feed.samples.length],
    numberHints: '',
    source: 'live',
    state: 'pending',
    revision: 0,
    tags: [],
  };
}

/** 推流模拟只作用于单个频道：序号、积压和重复判断都在频道内部闭环。 */
export function simulateLatency(channel: ChannelModel, channelId: ChannelId): ChannelModel {
  if (channel.connection === 'offline') return channel;
  const step = channel.connection === 'degraded' ? 0.7 : channel.simulatedDelay > 2.8 ? -0.3 : 0.15;
  const delay = Math.max(0.7, Math.min(8.9, Number((channel.simulatedDelay + step).toFixed(1))));
  const applyStream = channel.autoStream && Math.random() > 0.68;
  let nextSequence = channel.nextSequence;
  let segments = channel.segments;
  if (applyStream) {
    const candidate = createLiveSegment(channel.nextSequence, channelId);
    const duplicate = isDuplicate(candidate, segments);
    segments = [...segments, duplicate ? { ...candidate, state: 'duplicate', duplicateOf: duplicate.id, staleReason: `与第 ${duplicate.sequence} 段重复` } : candidate];
    nextSequence += 1;
  }
  const pendingCutoff = Date.now() - 90_000;
  segments = segments.map((item) => item.state === 'pending' && item.receivedAt < pendingCutoff
    ? { ...item, state: 'stale', staleReason: `片段已等待 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` }
    : item);
  return {
    ...channel,
    segments,
    nextSequence,
    simulatedDelay: delay,
    connection: delay > 4.2 ? 'degraded' : channel.connection,
    updatedAt: Date.now(),
  };
}

export function toSrt(channel: ChannelModel): string {
  const stamp = (seconds: number, separator = ',') => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
  };
  return channel.segments
    .filter((item) => item.state === 'confirmed')
    .sort((a, b) => a.startTime - b.startTime)
    .map((item, index) => `${index + 1}\n${stamp(item.startTime)} --> ${stamp(item.startTime + 7)}\n[${item.speaker}] ${item.corrected}\n`)
    .join('\n');
}
