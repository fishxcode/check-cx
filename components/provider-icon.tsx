"use client";

import Anthropic from "@lobehub/icons/es/Anthropic";
import Gemini from "@lobehub/icons/es/Gemini";
import Grok from "@lobehub/icons/es/Grok";
import OpenAI from "@lobehub/icons/es/OpenAI";
import type {ComponentType} from "react";

import type {ProviderType} from "@/lib/types";
import {cn} from "@/lib/utils";

/**
 * 图标按子路径单独引入，不走包根 barrel：根入口会 re-export `features`，
 * 其中 ProviderCombine 依赖可选 peer `antd`，未安装时服务端环境打包会失败。
 */
const ICON_MAP: Record<
  ProviderType,
  ComponentType<{ className?: string; size?: number }>
> = {
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
