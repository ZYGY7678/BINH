# AI App Builder

מערכת שממירה פקודה טבעית לפרויקט Android ב-Kotlin + Jetpack Compose, מעלה אותו ל-GitHub, מפעילה GitHub Actions ומחזירה APK.

## חשוב
- מאגר BINH כרגע ציבורי; ענפי builder כוללים את קוד האפליקציות שנוצרו.
- המפתחות מוזנים בממשק ונשמרים מקומית בדפדפן; השרת מחזיק את ה-GitHub token בזיכרון של ה-job בלבד לצורך הורדת artifact.
- יש להשתמש ב-Fine-grained GitHub token עם גישה למאגר BINH והרשאות מתאימות ל-Contents ול-Actions.
- Render Free עשוי להירדם לאחר חוסר פעילות.

## Build
AGP 8.7.3 + Gradle 8.9 + Java 17 + compileSdk 35.
