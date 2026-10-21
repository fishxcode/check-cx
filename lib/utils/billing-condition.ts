type Operand = {kind: "number"; value: number} | {kind: "variable"; name: "p" | "len"} | {kind: "clock"; name: "hour" | "weekday"; zone: string};
export type BillingCondition = {kind: "and" | "or"; left: BillingCondition; right: BillingCondition} | {kind: "compare"; left: Operand; right: Operand; operator: string};
export interface BillingPredicate {condition: BillingCondition; expected: boolean; source: string}

/** 只识别计费条件语法，不执行任何来自上游的代码。 */
export function parseBillingCondition(source: string): BillingCondition {
  const tokens = source.match(/\s*(?:"[^"\\]*"|>=|<=|==|!=|&&|\|\||[><(),]|\d+(?:\.\d+)?|[A-Za-z_]\w*)/g)?.map((token) => token.trim()) ?? [];
  if (tokens.join("") !== source.replace(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "")) throw new Error("条件包含未知语法");
  let index = 0;
  const take = (token: string) => {if (tokens[index] !== token) throw new Error("条件语法无效"); index += 1;};
  const operand = (): Operand => {
    const value = tokens[index++];
    if (/^\d+(?:\.\d+)?$/.test(value ?? "")) return {kind: "number", value: Number(value)};
    if (value === "p" || value === "len") return {kind: "variable", name: value};
    if (value === "hour" || value === "weekday") {
      take("(");
      const zone = tokens[index++];
      if (!zone?.startsWith('"')) throw new Error("缺少时区");
      const name = zone.slice(1, -1);
      try {new Intl.DateTimeFormat("en", {timeZone: name});} catch {throw new Error("未知时区");}
      take(")"); return {kind: "clock", name: value, zone: name};
    }
    throw new Error("未知条件变量");
  };
  const primary = (): BillingCondition => {
    if (tokens[index] === "(") {index += 1; const node = or(); take(")"); return node;}
    const left = operand();
    const operator = tokens[index++];
    if (![">", "<", ">=", "<=", "==", "!="].includes(operator)) throw new Error("未知比较符");
    const right = operand();
    if (left.kind !== "number" && right.kind !== "number") throw new Error("仅支持与数值比较");
    return {kind: "compare", left, right, operator};
  };
  const and = (): BillingCondition => {let node = primary(); while (tokens[index] === "&&") {index += 1; node = {kind: "and", left: node, right: primary()};} return node;};
  const or = (): BillingCondition => {let node = and(); while (tokens[index] === "||") {index += 1; node = {kind: "or", left: node, right: and()};} return node;};
  const result = or();
  if (index !== tokens.length) throw new Error("条件包含多余内容");
  return result;
}

type Values = {hour: number; weekday: number; p: number; len: number};
function evaluate(node: BillingCondition, values: Values): boolean {
  if (node.kind === "and") return evaluate(node.left, values) && evaluate(node.right, values);
  if (node.kind === "or") return evaluate(node.left, values) || evaluate(node.right, values);
  if (node.kind !== "compare") return false;
  const read = (operand: Operand) => operand.kind === "number" ? operand.value : values[operand.name];
  const left = read(node.left), right = read(node.right);
  switch (node.operator) {case ">": return left > right; case "<": return left < right; case ">=": return left >= right; case "<=": return left <= right; case "==": return left === right; case "!=": return left !== right; default: return false;}
}

function collect(node: BillingCondition, visit: (operand: Operand) => void) {
  if (node.kind === "compare") {visit(node.left); visit(node.right);}
  else {collect(node.left, visit); collect(node.right, visit);}
}

/** 枚举整数时间与 Token 阈值边界，保留条件可同时满足的分支。 */
export function billingPredicatesPossible(predicates: BillingPredicate[]): boolean {
  if (!predicates.length) return true;
  const zones = new Set<string>();
  const samples = new Set<number>([0]);
  const variables = new Set<string>();
  for (const {condition} of predicates) collect(condition, (operand) => {
    if (operand.kind === "number") for (const offset of [-1, 0, 1]) samples.add(Math.max(0, Math.floor(operand.value) + offset));
    if (operand.kind === "variable") variables.add(operand.name);
    if (operand.kind === "clock") {variables.add(operand.name); zones.add(operand.zone);}
  });
  // 不把不同时区的时钟误当成同一时刻，也不因验证规模过大删掉合法分支。
  if (zones.size > 1) return true;
  const hours = variables.has("hour") ? Array.from({length: 24}, (_, i) => i) : [0];
  const weekdays = variables.has("weekday") ? Array.from({length: 7}, (_, i) => i) : [0];
  const inputs = variables.has("p") ? [...samples] : [0];
  const lengths = variables.has("len") ? [...samples] : [0];
  if (hours.length * weekdays.length * inputs.length * lengths.length > 100000) return true;
  for (const hour of hours) for (const weekday of weekdays) for (const p of inputs) for (const len of lengths) {
    if (predicates.every(({condition, expected}) => evaluate(condition, {hour, weekday, p, len}) === expected)) return true;
  }
  return false;
}

export function billingConditionLabel(predicate: BillingPredicate): string {
  const operands: Operand[] = [];
  collect(predicate.condition, (operand) => operands.push(operand));
  const clocks = operands.filter((operand) => operand.kind === "clock");
  if (clocks.length && clocks.every((clock) => clock.kind === "clock" && clock.name === "hour" && clock.zone === (clocks[0].kind === "clock" ? clocks[0].zone : "")) && !operands.some((operand) => operand.kind === "variable")) {
    const intervals: string[] = [];
    let start: number | null = null;
    for (let hour = 0; hour <= 24; hour += 1) {
      const active = hour < 24 && evaluate(predicate.condition, {hour, weekday: 0, p: 0, len: 0});
      if (active && start === null) start = hour;
      if (!active && start !== null) {intervals.push(`${String(start).padStart(2, "0")}:00至${String(hour).padStart(2, "0")}:00`); start = null;}
    }
    if (intervals.length) return `${intervals.join("或")}${predicate.expected ? "" : "以外的时段"}（${clocks[0].kind === "clock" ? clocks[0].zone : ""}）`;
  }
  const label = predicate.source.replace(/hour\("([^"]+)"\)/g, "$1 时区的小时").replace(/weekday\("([^"]+)"\)/g, "$1 时区的星期数").replace(/\blen\b/g, "上下文长度").replace(/\bp\b/g, "输入 Token 数").replace(/&&/g, " 且 ").replace(/\|\|/g, " 或 ").replace(/>=/g, "≥").replace(/<=/g, "≤");
  return predicate.expected ? label : `不满足（${label}）`;
}
