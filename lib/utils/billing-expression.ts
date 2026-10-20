import type {ModelBillingTier} from "@/lib/types/model";
import {billingConditionLabel, billingPredicatesPossible, parseBillingCondition, type BillingPredicate} from "./billing-condition";

type Rates = ModelBillingTier["rates"];
type Branch = {scalar: number | null; rates: Rates; label: string; conditions: BillingPredicate[]};
const VARIABLES = ["p", "c", "cr", "cc", "cc1h"] as const;
const MAX_BRANCHES = 64;

/** 扫描完整表达式的顶层运算符，忽略括号和字符串中的符号。 */
function positions(source: string, symbol: string): number[] {
  const result: number[] = [];
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && char === symbol) result.push(index);
    if (depth < 0) throw new Error("括号不匹配");
  }
  if (depth !== 0 || quote) throw new Error("表达式未闭合");
  return result;
}

function unwrap(source: string): string {
  let value = source.trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    try { positions(value.slice(1, -1), "?"); }
    catch { break; }
    value = value.slice(1, -1).trim();
  }
  return value;
}

function combine(left: Branch[], right: Branch[], operator: "+" | "*"): Branch[] {
  if (left.length * right.length > MAX_BRANCHES) throw new Error("分支过多");
  return left.flatMap((a) => right.map((b): Branch => {
    const conditions = [...a.conditions, ...b.conditions];
    const label = [a.label, b.label].filter(Boolean).join(" · ");
    if (a.scalar !== null && b.scalar !== null) return {scalar: operator === "+" ? a.scalar + b.scalar : a.scalar * b.scalar, rates: {}, label, conditions};
    if (operator === "+") {
      if (a.scalar !== null || b.scalar !== null) throw new Error("包含固定费用");
      const rates: Rates = {...a.rates};
      for (const key of VARIABLES) if (b.rates[key] !== undefined) rates[key] = (rates[key] ?? 0) + b.rates[key]!;
      return {scalar: null, rates, label, conditions};
    }
    if (a.scalar === null && b.scalar === null) throw new Error("非线性计费");
    const factor = a.scalar ?? b.scalar!;
    const rates = a.scalar === null ? a.rates : b.rates;
    return {scalar: null, rates: Object.fromEntries(Object.entries(rates).map(([key, rate]) => [key, rate * factor])), label, conditions};
  }));
}

function parse(source: string, depth = 0): Branch[] {
  if (depth > 32) throw new Error("嵌套过深");
  const value = unwrap(source);
  const question = positions(value, "?")[0];
  if (question !== undefined) {
    const colon = positions(value, ":")[0];
    if (colon === undefined || colon < question) throw new Error("条件分支无效");
    const rawCondition = value.slice(0, question).trim();
    const condition = parseBillingCondition(rawCondition);
    return [
      ...parse(value.slice(question + 1, colon), depth + 1).map((branch) => ({...branch, conditions: [{condition, expected: true, source: rawCondition}, ...branch.conditions]})),
      ...parse(value.slice(colon + 1), depth + 1).map((branch) => ({...branch, conditions: [{condition, expected: false, source: rawCondition}, ...branch.conditions]})),
    ];
  }
  for (const operator of ["+", "*"] as const) {
    const index = positions(value, operator).at(-1);
    if (index !== undefined) return combine(parse(value.slice(0, index), depth + 1), parse(value.slice(index + 1), depth + 1), operator);
  }
  if (value.startsWith("tier(")) {
    const match = /^tier\(\s*"([^"\\]*)"\s*,([\s\S]*)\)$/.exec(value);
    if (!match) throw new Error("计费层无效");
    return parse(match[2], depth + 1).map((branch) => ({...branch, label: match[1]}));
  }
  if (VARIABLES.includes(value as typeof VARIABLES[number])) return [{scalar: null, rates: {[value]: 1}, label: "", conditions: []}];
  if (/^\d+(?:\.\d+)?$/.test(value)) return [{scalar: Number(value), rates: {}, label: "", conditions: []}];
  throw new Error("不支持的计费语法");
}

/** 只做符号展开，绝不执行上游 JavaScript，也不截取局部规则猜价。 */
export function parseBillingExpression(source: string): ModelBillingTier[] {
  try {
    if (source.length > 16000) return [];
    const branches = parse(source);
    if (branches.length > MAX_BRANCHES || branches.some((branch) => branch.scalar !== null || Object.values(branch.rates).some((rate) => !Number.isFinite(rate) || rate < 0))) return [];
    return branches.filter((branch) => billingPredicatesPossible(branch.conditions)).map((branch) => ({label: branch.label || "标准", condition: branch.conditions.map(billingConditionLabel).join("；") || null, rates: branch.rates}));
  } catch { return []; }
}
