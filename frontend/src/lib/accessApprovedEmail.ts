/** Closed-beta approval email copy (support@albireus.com). */

export const ACCESS_APPROVED_FROM = "Albireus <support@albireus.com>";
export const ACCESS_APPROVED_REPLY_TO = "support@albireus.com";

export function accessApprovedSubject(): string {
  return "【Albireus】你的內測申請已通過";
}

export function accessApprovedText(displayName?: string): string {
  const name = (displayName || "").trim() || "你好";
  return `${name}，你好：

感謝你申請 Albireus 內測！

目前 Albireus 還是一位大學生獨立開發中的產品，真的很開心有你願意一起來試用。若使用上有任何想法或體驗回饋，都非常歡迎告訴我——你的意見會直接幫助產品變好。

幾件重要提醒：

1. 隱私：我不會去查看你在 Albireus 上的任何個人內容或筆記資料。
2. 測試階段：功能仍在快速迭代，還有不少待處理的 bug。若遇到問題，歡迎寫信到 support@albireus.com 向開發者回報。
3. 希望你能幫忙測試：任何想要的功能、改進建議、使用情境，都非常歡迎提出。
4. 穩定性：目前功能尚未完全穩定。若要當作日常主力筆記軟體，仍建議自行備份重要資料，也不要把重要檔案「只」保存在這裡。

再次感謝你的支持。祝使用愉快！

Albireus
support@albireus.com
`;
}

export function accessApprovedHtml(displayName?: string): string {
  const name = (displayName || "").trim() || "你好";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;line-height:1.65;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;">
  <p>${esc(name)}，你好：</p>
  <p>感謝你申請 <strong>Albireus</strong> 內測！</p>
  <p>目前 Albireus 還是一位大學生獨立開發中的產品，真的很開心有你願意一起來試用。若使用上有任何想法或體驗回饋，都非常歡迎告訴我——你的意見會直接幫助產品變好。</p>
  <p><strong>幾件重要提醒：</strong></p>
  <ol>
    <li><strong>隱私</strong>：我不會去查看你在 Albireus 上的任何個人內容或筆記資料。</li>
    <li><strong>測試階段</strong>：功能仍在快速迭代，還有不少待處理的 bug。若遇到問題，歡迎寫信到 <a href="mailto:support@albireus.com">support@albireus.com</a> 向開發者回報。</li>
    <li><strong>希望你能幫忙測試</strong>：任何想要的功能、改進建議、使用情境，都非常歡迎提出。</li>
    <li><strong>穩定性</strong>：目前功能尚未完全穩定。若要當作日常主力筆記軟體，仍建議自行備份重要資料，也不要把重要檔案「只」保存在這裡。</li>
  </ol>
  <p>再次感謝你的支持。祝使用愉快！</p>
  <p style="color:#666;font-size:14px;">Albireus<br/><a href="mailto:support@albireus.com">support@albireus.com</a></p>
</body>
</html>`;
}
