"use client";

import {Anthropic, DeepSeek, Gemini, Grok, Minimax, Moonshot, OpenAI, Qwen, Zhipu} from "@lobehub/icons";
import {Boxes} from "lucide-react";

/** 只使用已知组件，远端图标字符串不参与动态模块加载。 */
const VENDOR_ICONS = {
  OpenAI, Google: Gemini, Anthropic, xAI: Grok,
  阿里巴巴: Qwen, Moonshot, DeepSeek, MiniMax: Minimax, 智谱: Zhipu,
};

export function VendorIcon({name}: {name: string}) {
  const Icon = VENDOR_ICONS[name as keyof typeof VENDOR_ICONS];
  return Icon ? <Icon size={28} /> : <Boxes className="h-7 w-7 text-muted-foreground" />;
}
