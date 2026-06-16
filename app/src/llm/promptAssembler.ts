/** 组装最终 prompt——七层拼接 + 预算裁剪。纯函数，所有数据通过参数注入。 */

import { buildIdentityAnchor, type Persona } from "./identityAnchor";
import { EMOTIONS } from "./emotionTypes";
import type { MemoryFact } from "../memory/store";
import type { ChatTurn } from "../conversation/manager";
import { estimateTokens, emergencyCompress, type PromptSection, type TokenBudget } from "./tokenBudget";
import { intimacyLevel } from "../memory/relationship";

export interface AssemblerInput {
  displayName: string;
  persona: Persona;
  motionKeys: string[];

  nickname: string;
  selfIntro: string;
  systemPromptExtra: string;
  selectedFacts: MemoryFact[];

  intimacy: number;
  moodBaseline: string;
  minutesSinceLastInteraction: number;
  additionalContext: string;
  time: string;
  weekday: string;

  historySummaries: string;
  recentHistory: ChatTurn[];

  driftCorrection?: string;

  budget: TokenBudget;
}

export function assemblePrompt(input: AssemblerInput): { system: string; messages: ChatTurn[] } {
  const { persona, displayName } = input;

  // [1] 身份锚（优先级 100，永不压缩）
  const identity = buildIdentityAnchor(displayName, persona);

  // [2] 格式约束
  const actions = input.motionKeys.length > 0 ? input.motionKeys.join("/") : "idle/greet/cheer";
  const format = `【回复格式】
必须返回 JSON（不要 markdown 包裹）：
{"text":"你的回复","emotion":"情绪","intensity":0.0~1.0,"action":"动作名"}
emotion 枚举：${EMOTIONS.join("/")}
action 从以下选择：${actions}
intensity：闲聊 0.2~0.4，好消息 0.6~0.8，紧急 0.7~0.9
text ≤80字，像真人朋友说话。保持你的性格一致。`;

  // [3] 用户画像
  const factsText = input.selectedFacts.map((f) => `- ${f.text}`).join("\n");
  const userSection = [
    `【用户信息】`,
    `你称呼用户为「${input.nickname}」`,
    input.selfIntro ? `用户自述：${input.selfIntro}` : "",
    factsText,
  ].filter(Boolean).join("\n");

  // [4] 关系状态
  const level = intimacyLevel(input.intimacy);
  const intimacyHint = persona.intimacy_expressions?.[level];
  const relSection = `【你与用户的关系】亲密度：${level}${intimacyHint ? `（${intimacyHint}）` : ""}。当前底色心情：${input.moodBaseline}`;

  // [5] 情境
  const ctx = `【情境】时间：${input.time} ${input.weekday}，距上次互动：${input.minutesSinceLastInteraction}分钟${input.additionalContext ? `\n${input.additionalContext}` : ""}`;

  // [7] 用户自定义
  const custom = input.systemPromptExtra
    ? `\n【用户自定义补充】\n${input.systemPromptExtra}`
    : "";

  // 漂移修正
  const drift = input.driftCorrection
    ? `\n${input.driftCorrection}`
    : "";

  // 组装 sections
  const sections: PromptSection[] = [
    { key: "identity",  text: identity,    tokens: estimateTokens(identity),    priority: 100 },
    { key: "format",    text: format,      tokens: estimateTokens(format),      priority: 95 },
    { key: "user",      text: userSection, tokens: estimateTokens(userSection), priority: 60 },
    { key: "relation",  text: relSection,  tokens: estimateTokens(relSection),  priority: 50 },
    { key: "context",   text: ctx,         tokens: estimateTokens(ctx),         priority: 40 },
    { key: "custom",    text: custom,      tokens: estimateTokens(custom),      priority: 70 },
    { key: "drift",     text: drift,       tokens: estimateTokens(drift),       priority: 80 },
  ];

  // 历史（优先级最低）
  const summarySection = input.historySummaries
    ? `【之前的对话摘要】\n${input.historySummaries}`
    : "";

  if (summarySection) {
    sections.push({
      key: "summaries",
      text: summarySection,
      tokens: estimateTokens(summarySection),
      priority: 10,
    });
  }

  // 紧急压缩
  const systemBudget = input.budget.identity + input.budget.format + input.budget.userProfile +
    input.budget.relationship + input.budget.context + input.budget.userCustom + input.budget.history;
  emergencyCompress(sections, systemBudget);

  const system = sections
    .sort((a, b) => b.priority - a.priority)
    .map((s) => s.text)
    .filter(Boolean)
    .join("\n\n");

  return { system, messages: input.recentHistory };
}
