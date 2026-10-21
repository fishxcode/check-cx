"use client";

import Anthropic from "@lobehub/icons/es/Anthropic/components/Mono";
import Gemini from "@lobehub/icons/es/Gemini/components/Mono";
import Grok from "@lobehub/icons/es/Grok/components/Mono";
import type {IconType} from "@lobehub/icons/es/types";
import OpenAI from "@lobehub/icons/es/OpenAI/components/Mono";

import type {ProviderType} from "@/lib/types";
import {cn} from "@/lib/utils";

/**
 * 直接引用每个图标包的 `components/Mono`，绕开两级 barrel：
 * 包根会 re-export `features`（ProviderCombine 依赖可选 peer `antd`），
 * 次级入口 `es/<Provider>` 又会带入 Avatar（依赖 `antd-style`）。
 * Mono 只有 `react` 依赖，是渲染时真正用到的那个组件。
 */
const ICON_MAP: Record<ProviderType, IconType> = {
  openai: OpenAI,
  gemini: Gemini,
  anthropic: Anthropic,
  grok: Grok,
};

interface ProviderIconProps {
  type: ProviderType;
  className?: string;
  size?: number;
}

/** 按 Provider 类型渲染统一风格的图标，避免在业务组件中关心具体 icon 实现 */
export function ProviderIcon({ type, className, size = 18 }: ProviderIconProps) {
  const Icon = ICON_MAP[type];
  if (!Icon) return null;
  return <Icon className={cn("shrink-0", className)} size={size} />;
}
