# no-to-locale-string

`toLocaleString()` の使用を禁止し、`Intl.*` の利用を促すルール。

## なぜ

`toLocaleString()` は Node.js の small-ICU ビルドで桁区切りを返さない等、環境依存の
動作をする。SSR（Next.js サーバー）とブラウザで結果がズレると表示が崩れる。
`Intl.NumberFormat` / `Intl.DateTimeFormat` は ICU データに依存せず安定する。

## ❌ NG

```ts
amount.toLocaleString("ja-JP"); // small-ICU では "40000"
date.toLocaleString("ja-JP");
```

## ✅ OK

```ts
new Intl.NumberFormat("ja-JP").format(amount); // 常に "40,000"
new Intl.DateTimeFormat("ja-JP").format(date);
```

## 検出対象

メソッド名 `toLocaleString` の呼び出し全般（`toLocaleDateString` 等の派生は対象外。
必要なら拡張する）。
