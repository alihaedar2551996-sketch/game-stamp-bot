#!/usr/bin/env python3
"""فحص template literals في رسائل البوت قبل الـ push"""
import re, sys

# بس الملفات اللي فيها رسائل بوت
files = ["bot/src/handlers/user.ts", "bot/src/index.ts"]
errors = []

for path in files:
    with open(path) as f:
        content = f.read()
    # ابحث عن ctx.reply أو sendMessage اللي فيها newline حقيقي
    for m in re.finditer(r'(ctx\.reply|sendMessage)\([^;]*?`([^`]*)`', content, re.DOTALL):
        inner = m.group(2)
        if '\n' in inner:
            ln = content[:m.start()].count('\n') + 1
            errors.append(f"{path}:{ln} — newline حقيقي في رسالة بوت")

if errors:
    print("❌ يوجد أخطاء:")
    for e in errors: print(f"  {e}")
    sys.exit(1)
else:
    print(f"✅ كل الرسائل نظيفة")
