"use client";

import Anthropic from "@lobehub/icons/es/Anthropic";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Gemini from "@lobehub/icons/es/Gemini";
import Grok from "@lobehub/icons/es/Grok";
import Minimax from "@lobehub/icons/es/Minimax";
import Moonshot from "@lobehub/icons/es/Moonshot";
import OpenAI from "@lobehub/icons/es/OpenAI";
import Qwen from "@lobehub/icons/es/Qwen";
import Zhipu from "@lobehub/icons/es/Zhipu";
import {Boxes} from "lucide-react";

/**
 * 只使用已知组件，远端图标字符串不参与动态模块加载。
 * 图标走 `@lobehub/icons/es/<Provider>` 子路径，避免根 barrel 引入依赖 antd 的 features。
 */
const VENDOR_ICONS = {
  OpenAI, Google: Gemini, Anthropic, xAI: Grok,
  阿里巴巴: Qwen, Moonshot, DeepSeek, MiniMax: Minimax, 智谱: Zhipu,
};

export function VendorIcon({name}: {name: string}) {
  const Icon = VENDOR_ICONS[name as keyof typeof VENDOR_ICONS];
  return Icon ? <Icon size={28} /> : <Boxes className="h-7 w-7 text-muted-foreground" />;
}
