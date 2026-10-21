"use client";

import Anthropic from "@lobehub/icons/es/Anthropic/components/Mono";
import DeepSeek from "@lobehub/icons/es/DeepSeek/components/Mono";
import Gemini from "@lobehub/icons/es/Gemini/components/Mono";
import Grok from "@lobehub/icons/es/Grok/components/Mono";
import Minimax from "@lobehub/icons/es/Minimax/components/Mono";
import Moonshot from "@lobehub/icons/es/Moonshot/components/Mono";
import OpenAI from "@lobehub/icons/es/OpenAI/components/Mono";
import Qwen from "@lobehub/icons/es/Qwen/components/Mono";
import Zhipu from "@lobehub/icons/es/Zhipu/components/Mono";
import {Boxes} from "lucide-react";

/**
 * 只使用已知组件，远端图标字符串不参与动态模块加载。
 * 图标直接引用 `es/<Provider>/components/Mono`，避开根 barrel 的 features（antd）
 * 与次级入口的 Avatar（antd-style）两条依赖链，只保留纯 SVG 组件。
 */
const VENDOR_ICONS = {
  OpenAI, Google: Gemini, Anthropic, xAI: Grok,
  阿里巴巴: Qwen, Moonshot, DeepSeek, MiniMax: Minimax, 智谱: Zhipu,
};

export function VendorIcon({name}: {name: string}) {
  const Icon = VENDOR_ICONS[name as keyof typeof VENDOR_ICONS];
  return Icon ? <Icon size={28} /> : <Boxes className="h-7 w-7 text-muted-foreground" />;
}
