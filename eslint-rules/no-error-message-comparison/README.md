# no-error-message-comparison

`.message` と文字列リテラルの比較によるエラー種別判定を禁止するルール。

## なぜ

メッセージは表示文言であり、変更・翻訳されうる。これを分岐条件にすると、文言を直した
瞬間に分岐が壊れ、TypeScript も誤りを検出できない。種別判定は `AppError.type` で行う。

## ❌ NG

```ts
if (result.error.message === "Strava が未設定です") {
  // 文言変更で壊れる
}
```

## ✅ OK

```ts
// src/shared/errors.ts の ErrorType を使う
if (result.error.type === "config") {
  // 文言から独立
}
```

## 検出対象

`===` / `!==` / `==` / `!=` のいずれかで、片側が `.message` アクセス、もう片側が
文字列リテラルの比較。

## 関連

- [no-throw-statement](../no-throw-statement/) — エラーは Result + AppError で表現する
