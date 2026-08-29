/**
 * 配置模板相关类型定义
 */

/**
 * 配置模板类别
 */
export type TemplateCategory = "header" | "metadata" | "both";

/**
 * 配置模板接口
 */
export interface ConfigTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  request_header?: Record<string, string> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * 批量应用模板请求参数
 */
export interface BatchApplyTemplateRequest {
  ids: string[];                          // 配置 ID 列表
  mode: "replace" | "merge";              // 应用模式
  apply_header: boolean;                  // 是否应用 request_header
  request_header: Record<string, string> | null;  // request_header 模板
  apply_metadata: boolean;                // 是否应用 metadata
  metadata: Record<string, unknown> | null;       // metadata 模板
}

/**
 * 批量应用模板响应
 */
export interface BatchApplyTemplateResponse {
  count: number;  // 成功应用的配置数量
}

/**
 * 获取模板列表响应
 */
export interface GetTemplatesResponse {
  templates: ConfigTemplate[];
  count: number;
  categories: TemplateCategory[];
}
