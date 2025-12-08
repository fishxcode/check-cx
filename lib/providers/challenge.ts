/**
 * 随机挑战生成器
 *
 * 生成随机数学题用于验证 AI 回复的真实性，
 * 防止假站点用固定回复绕过检测
 */

export interface Challenge {
  /** 发送给模型的问题 */
  prompt: string;
  /** 期望的正确答案 */
  expectedAnswer: string;
}

/**
 * 生成一个随机数学挑战
 *
 * 使用简单的加减法，确保所有 LLM 都能正确计算
 */
export function generateChallenge(): Challenge {
  // 生成 1-50 范围内的随机数，避免数字太大或太小
  const a = Math.floor(Math.random() * 50) + 1;
  const b = Math.floor(Math.random() * 50) + 1;

  // 随机选择加法或减法
  const isAddition = Math.random() > 0.5;

  if (isAddition) {
    const answer = a + b;
    return {
      prompt: `${a} + ${b} = ?`,
      expectedAnswer: String(answer),
    };
  } else {
    // 确保结果为正数（大数减小数）
    const larger = Math.max(a, b);
    const smaller = Math.min(a, b);
    const answer = larger - smaller;
    return {
      prompt: `${larger} - ${smaller} = ?`,
      expectedAnswer: String(answer),
    };
  }
}

/**
 * 验证模型回复是否包含正确答案
 *
 * @param response 模型的回复内容
 * @param expectedAnswer 期望的答案
 * @returns 是否验证通过
 */
export function validateResponse(
  response: string,
  expectedAnswer: string
): boolean {
  if (!response || !expectedAnswer) {
    return false;
  }

  // 从回复中提取所有数字
  const numbers = response.match(/-?\d+/g);
  if (!numbers) {
    return false;
  }

  // 检查是否包含正确答案
  return numbers.includes(expectedAnswer);
}
