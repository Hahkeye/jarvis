# Development Notes

## 🚨 NEVER PUSH TO GITHUB WITHOUT EXPLICIT PERMISSION

**Rule:** Only commit and push when the user says "yes", "push it", "commit and push", or equivalent explicit approval. Never push on your own initiative, even if the code compiles and looks good.

## ❌ CRITICAL: Don't Use TypeScript Syntax in JS Files

**Problem:** Accidentally used TypeScript type annotations in `.js` files.

**Examples of WRONG code in `.js` files:**
```javascript
// WRONG - TypeScript syntax in JS file
function sendMessage(msg: Record<string, unknown>) { }
const data: string = "hello";
type MyType = { name: string }
```

**Correct JS syntax:**
```javascript
// CORRECT - Plain JavaScript
function sendMessage(msg) { }
const data = "hello"
```

**Why this matters:**
- `.js` files are treated as plain JavaScript by browsers
- TypeScript syntax (`: type`, `as any`, etc.) will cause `SyntaxError`
- Only `.ts` files should have TypeScript type annotations

**Files that need to be checked:**
- `ui/dev.js` - Fixed in commit b4543ef
- `ui/dashboard.js` - Check for similar issues
- `ui/app.js` - Check for similar issues
