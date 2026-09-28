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

/**
 * 单个频道（主会场 / 分会场 / 采访间）的完整值守状态。
 * 队列、正在编辑的片段、术语规则、直播输出和连接状态都只属于一个频道。
 */
export interface DeskModel {
  channelId: string;
  channelName: string;
  eventName: string;
  eventDate: string;
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

/** 多频道工作台：各频道状态互相隔离，字号等界面偏好为全局设置。 */
export interface DeskWorkspace {
  version: 2;
  channels: DeskModel[];
  activeChannelId: string;
  fontSize: number;
  updatedAt: number;
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  subtitle: string;
}

const now = Date.now();
/** 旧版单频道数据，同时承担主题偏好的存储键后缀。 */
export const STORAGE_KEY = 'sologsb-1011-live-caption-desk-v1';
export const WORKSPACE_STORAGE_KEY = 'sologsb-1011-live-caption-desk-v2';

function segment(
  id: string,
  sequence: number,
  startTime: number,
  speaker: string,
  original: string,
  corrected = original,
  state: SegmentState = 'pending',
): CaptionSegment {
  return {
    id,
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

function duplicateSegment(base: CaptionSegment, duplicateOf: string, reason: string): CaptionSegment {
  return { ...base, state: 'duplicate', duplicateOf, staleReason: reason };
}

const mainHallSegments: CaptionSegment[] = [
  segment('seg-1', 1, 0, '主持人', '欢迎大家来到二零二六年产品发布会。', '欢迎大家来到2026年产品发布会。', 'confirmed'),
  segment('seg-2', 2, 7, '主讲人', '今天我们会介绍三个模块,首先是实时协作。', '今天我们会介绍三个模块，首先是实时协作。', 'confirmed'),
  segment('seg-3', 3, 15, '主讲人', '延迟和质量监测会帮助我们保持字幕稳定。', '延迟和质量监测会帮助我们保持字幕稳定。', 'confirmed'),
  segment('seg-4', 4, 24, '嘉宾 / 周然', '我们使用 studio cloud 作为演示环境。', '我们使用 Studio Cloud 作为演示环境。', 'pending'),
  segment('seg-5', 5, 34, '嘉宾 / 周然', '每分钟大约会收到一百二十个片段。', '每分钟大约会收到120个片段。', 'pending'),
  segment('seg-6', 6, 43, '主持人', '如果主持人提到 co pilot,需要统一大小写。', '如果主持人提到 Co-Pilot，需要统一大小写。', 'pending'),
  segment('seg-7', 7, 52, '主持人', '这个例子会演示五G网络下的字幕恢复。', '这个例子会演示5G网络下的字幕恢复。', 'pending'),
  duplicateSegment(
    segment('seg-8', 8, 61, '主讲人', '今天我们重点讨论字幕队列。', '今天我们重点讨论字幕队列。', 'pending'),
    'seg-2',
    '与第 2 段高度相似',
  ),
];

const subForumSegments: CaptionSegment[] = [
  segment('sub-1', 1, 0, '分论坛主持', '各位线上线下的来宾,欢迎来到实时协作分论坛。', '各位线上线下的来宾，欢迎来到实时协作分论坛。', 'confirmed'),
  segment('sub-2', 2, 8, '架构师 / 沈拓', '我们先看分布式编辑里的冲突解决模型。', '我们先看分布式编辑里的冲突解决模型。', 'confirmed'),
  segment('sub-3', 3, 17, '产品经理', '侧边栏已经嵌入 co pilot 的建议能力。', '侧边栏已经嵌入 co pilot 的建议能力。', 'pending'),
  segment('sub-4', 4, 26, '架构师 / 沈拓', '单集群可以支撑八十万条并发操作。', '单集群可以支撑80万条并发操作。', 'pending'),
  segment('sub-5', 5, 35, '现场提问', 'open api 的限流策略接下来会调整吗?', 'open api 的限流策略接下来会调整吗？', 'pending'),
  duplicateSegment(
    segment('sub-6', 6, 43, '架构师 / 沈拓', '我们先看分布式编辑里的冲突解决模型。', '我们先看分布式编辑里的冲突解决模型。', 'pending'),
    'sub-2',
    '与第 2 段高度相似',
  ),
];

const interviewSegments: CaptionSegment[] = [
  segment('iv-1', 1, 0, '记者', '林越你好,感谢你接受本场赛后采访。', '林越你好，感谢你接受本场赛后采访。', 'confirmed'),
  segment('iv-2', 2, 8, '受访嘉宾 / 林越', '今天团队的执行力比上一场好很多。', '今天团队的执行力比上一场好很多。', 'confirmed'),
  segment('iv-3', 3, 17, '记者', '能聊聊第四代引擎的改进吗?', '能聊聊第四代引擎的改进吗？', 'pending'),
  segment('iv-4', 4, 26, '受访嘉宾 / 林越', '我们和 studio london 团队联调了三周。', '我们和 studio london 团队联调了三周。', 'pending'),
  segment('iv-5', 5, 35, '导播', '采访间信号正常,五G背包码率稳定。', '采访间信号正常，5G背包码率稳定。', 'pending'),
  duplicateSegment(
    segment('iv-6', 6, 44, '受访嘉宾 / 林越', '今天团队的执行力确实比上一场好很多。', '今天团队的执行力确实比上一场好很多。', 'pending'),
    'iv-2',
    '与第 2 段高度相似',
  ),
];

type ChannelSeed = {
  id: string;
  name: string;
  eventName: string;
  segments: CaptionSegment[];
  rules: TermRule[];
  selectedId: string;
  nextSequence: number;
};

function createChannel(seed: ChannelSeed): DeskModel {
  return {
    channelId: seed.id,
    channelName: seed.name,
    eventName: seed.eventName,
    eventDate: new Date(now).toISOString().slice(0, 10),
    segments: seed.segments,
    rules: seed.rules,
    selectedId: seed.selectedId,
    connection: 'connected',
    simulatedDelay: 1.8,
    nextSequence: seed.nextSequence,
    autoStream: true,
    updatedAt: now,
  };
}

export function createInitialWorkspace(): DeskWorkspace {
  const channels: DeskModel[] = [
    createChannel({
      id: 'main',
      name: '主会场',
      eventName: '新品发布会现场字幕',
      segments: mainHallSegments,
      selectedId: 'seg-4',
      nextSequence: 9,
      rules: [
        { id: 'term-1', source: 'co pilot', replacement: 'Co-Pilot', speaker: '', enabled: true, caseSensitive: false, usageCount: 4, createdAt: now - 86_400_000 },
        { id: 'term-2', source: 'studio cloud', replacement: 'Studio Cloud', speaker: '', enabled: true, caseSensitive: false, usageCount: 7, createdAt: now - 43_200_000 },
        { id: 'term-3', source: '五G', replacement: '5G', speaker: '', enabled: true, caseSensitive: true, usageCount: 2, createdAt: now - 3_600_000 },
      ],
    }),
    createChannel({
      id: 'sub',
      name: '分会场',
      eventName: '实时协作技术分论坛',
      segments: subForumSegments,
      selectedId: 'sub-3',
      nextSequence: 7,
      rules: [
        { id: 'term-sub-1', source: 'co pilot', replacement: 'Co-Pilot', speaker: '', enabled: true, caseSensitive: false, usageCount: 3, createdAt: now - 72_000_000 },
        { id: 'term-sub-2', source: 'open api', replacement: 'OpenAPI', speaker: '', enabled: true, caseSensitive: false, usageCount: 5, createdAt: now - 28_800_000 },
        { id: 'term-sub-3', source: '八十万', replacement: '80万', speaker: '', enabled: true, caseSensitive: false, usageCount: 1, createdAt: now - 1_800_000 },
      ],
    }),
    createChannel({
      id: 'interview',
      name: '采访间',
      eventName: '赛后媒体采访间',
      segments: interviewSegments,
      selectedId: 'iv-3',
      nextSequence: 7,
      rules: [
        { id: 'term-iv-1', source: 'studio london', replacement: 'Studio London', speaker: '', enabled: true, caseSensitive: false, usageCount: 2, createdAt: now - 36_000_000 },
        { id: 'term-iv-2', source: '五G', replacement: '5G', speaker: '', enabled: true, caseSensitive: true, usageCount: 1, createdAt: now - 2_400_000 },
      ],
    }),
  ];
  return { version: 2, channels, activeChannelId: 'main', fontSize: 18, updatedAt: now };
}

/** 旧版单频道草稿迁移为只有一个主会场频道的工作台。 */
export function migrateLegacyWorkspace(raw: string): DeskWorkspace | undefined {
  try {
    const legacy = JSON.parse(raw) as Partial<DeskModel> & { fontSize?: number };
    if (!legacy || !Array.isArray(legacy.segments) || !legacy.segments.length) return undefined;
    const channel = {
      ...legacy,
      channelId: 'main',
      channelName: '主会场',
    } as DeskModel;
    delete (channel as unknown as { fontSize?: number }).fontSize;
    return {
      version: 2,
      channels: [channel],
      activeChannelId: 'main',
      fontSize: typeof legacy.fontSize === 'number' ? legacy.fontSize : 18,
      updatedAt: Date.now(),
    };
  } catch {
    return undefined;
  }
}

export function cloneModel(model: DeskModel): DeskModel {
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

export function applyRules(text: string, model: DeskModel): { text: string; used: string[] } {
  let next = text;
  const used: string[] = [];
  for (const rule of model.rules.filter((item) => item.enabled)) {
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

/** 重复只在调用方传入的同一频道片段集合内判断，不会跨频道比较。 */
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

/** 断线恢复：仅合并当前频道，按本频道序号和开始时间排序，重复仅在本频道内复查。 */
export function mergeConfirmedSegments(model: DeskModel): DeskModel {
  const seen: string[] = [];
  const segments = model.segments
    .map((item) => ({ ...item }))
    .sort((a, b) => a.sequence - b.sequence || a.startTime - b.startTime)
    .map((item): CaptionSegment => {
      if (item.source === 'offline' && item.state === 'confirmed') {
        item.source = item.confirmedAt && Date.now() - item.confirmedAt > 90_000 ? 'offline' : 'live';
        item.staleReason = Date.now() - item.receivedAt > 90_000 ? `离线恢复后合并，原始片段已延迟 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` : undefined;
        if (item.staleReason) item.state = 'stale';
      }
      const duplicate = isDuplicate(item, seen.map((id) => model.segments.find((segmentItem) => segmentItem.id === id)).filter(Boolean) as CaptionSegment[]);
      if (duplicate && item.state !== 'confirmed') {
        item.state = 'duplicate';
        item.duplicateOf = duplicate.id;
      }
      if (item.state !== 'ignored') seen.push(item.id);
      return item;
    });

  return {
    ...model,
    segments,
    connection: 'connected',
    simulatedDelay: Math.max(0.8, model.simulatedDelay - 0.7),
    lastMergedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function queueStats(model: DeskModel) {
  const pending = model.segments.filter((item) => item.state === 'pending');
  const stale = model.segments.filter((item) => item.state === 'stale');
  const duplicate = model.segments.filter((item) => item.state === 'duplicate');
  const offline = model.segments.filter((item) => item.source === 'offline' && item.state === 'confirmed');
  return {
    pending: pending.length,
    stale: stale.length,
    duplicate: duplicate.length,
    offline: offline.length,
    backlog: pending.length + stale.length + duplicate.length + offline.length,
    oldestWaitSeconds: pending.length ? Math.max(...pending.map((item) => Math.round((Date.now() - item.receivedAt) / 1000))) : 0,
  };
}

const channelFeeds: Record<string, { speakers: string[]; samples: string[] }> = {
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
  sub: {
    speakers: ['分论坛主持', '架构师 / 沈拓', '产品经理', '现场提问'],
    samples: [
      '分论坛稍后会开放五分钟的自由提问。',
      '冲突合并会保留每个频道的本地草稿。',
      '这段路线图分享包含二零二六年的排期。',
      '接口层会按频道隔离术语规则。',
      '弱网恢复后请按序号核对本论坛时间线。',
      'open api 文档已经同步到开发者门户。',
    ],
  },
  interview: {
    speakers: ['记者', '受访嘉宾 / 林越', '导播'],
    samples: [
      '现在把镜头交回主会场。',
      '这个问题我想从训练安排开始说起。',
      '采访间的字幕会单独导出归档。',
      '恢复连线后我们继续后面的提问。',
      '现场观众的声音也能通过五G背包收进来。',
      '相关数据会在发布会结束后统一公开。',
    ],
  },
};

export function createLiveSegment(sequence: number, channelId = 'main'): CaptionSegment {
  const feed = channelFeeds[channelId] ?? channelFeeds.main;
  const start = Math.max(0, sequence * 9 - 10);
  return {
    id: `seg-live-${channelId}-${sequence}-${Date.now().toString(36)}`,
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

/** 模拟某一个频道的流延迟与新片段到达，不影响其他频道。 */
export function simulateLatency(model: DeskModel): DeskModel {
  if (model.connection === 'offline') return model;
  const step = model.connection === 'degraded' ? 0.7 : model.simulatedDelay > 2.8 ? -0.3 : 0.15;
  const delay = Math.max(0.7, Math.min(8.9, Number((model.simulatedDelay + step).toFixed(1))));
  const applyStream = model.autoStream && Math.random() > 0.68;
  let nextSequence = model.nextSequence;
  let segments = model.segments;
  if (applyStream) {
    const candidate = createLiveSegment(model.nextSequence, model.channelId);
    const duplicate = isDuplicate(candidate, segments);
    segments = [...segments, duplicate ? { ...candidate, state: 'duplicate', duplicateOf: duplicate.id, staleReason: `与第 ${duplicate.sequence} 段重复` } : candidate];
    nextSequence += 1;
  }
  const pendingCutoff = Date.now() - 90_000;
  segments = segments.map((item) => item.state === 'pending' && item.receivedAt < pendingCutoff
    ? { ...item, state: 'stale', staleReason: `片段已等待 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` }
    : item);
  return {
    ...model,
    segments,
    nextSequence,
    simulatedDelay: delay,
    connection: delay > 4.2 ? 'degraded' : model.connection,
    updatedAt: Date.now(),
  };
}

export function toSrt(model: DeskModel): string {
  const stamp = (seconds: number, separator = ',') => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
  };
  return model.segments
    .filter((item) => item.state === 'confirmed')
    .sort((a, b) => a.startTime - b.startTime)
    .map((item, index) => `${index + 1}\n${stamp(item.startTime)} --> ${stamp(item.startTime + 7)}\n[${item.speaker}] ${item.corrected}\n`)
    .join('\n');
}
