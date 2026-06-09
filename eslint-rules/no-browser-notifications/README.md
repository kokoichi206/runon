# no-browser-notifications

ブラウザ標準の `alert` / `confirm` / `prompt` を禁止するルール。

## なぜ

これらはメインスレッドを同期ブロックし、見た目も OS 依存でアプリのデザインと揃わない。
通知・確認はアプリ独自の UI（トースト / 確認ダイアログ）に統一する。

## ❌ NG

```ts
alert("保存しました");
const ok = confirm("削除しますか？");
window.prompt("名前を入力");
```

## ✅ OK

```ts
showToast("保存しました");
const ok = await openConfirmDialog("削除しますか？");
```

## 検出対象

- 直接呼び出し: `alert()` / `confirm()` / `prompt()`
- `window.*` / `globalThis.*` 経由（プロパティ / 文字列添字の両方）
