# PushPlus 告警渠道集成

## 目标
在 admin/alerts/channels 中新增 PushPlus 渠道类型，仅需配置 token 即可使用。

## 涉及文件
1. `lib/alerts/pushplus.ts` - 新建发送逻辑
2. `lib/types/database.ts` - 更新 AlertChannelRow.type 联合类型
3. `lib/core/alert-engine.ts` - 增加 pushplus dispatch 分支
4. `app/api/admin/alerts/channels/route.ts` - POST 验证支持 token
5. `app/admin/(protected)/alerts/channels/page.tsx` - UI 增加 pushplus 选项

## PushPlus API
- URL: https://www.pushplus.plus/send
- Method: POST
- Body: { token, title, content, template: "html" }
- 成功响应: { code: 200 }
