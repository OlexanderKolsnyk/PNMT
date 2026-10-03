const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "styles.css"), "utf8");

const checks = {
  telegramLink: html.includes("https://t.me/Kolisnyk_academy_bot"),
  oldStudentResultCopyRemoved: !html.includes("Результат обчислено лише"),
  retryFlowPresent:
    html.includes('id="retryResultBtn"') &&
    app.includes('retryResultBtn.addEventListener("click"'),
  resultsRestrictedToTester:
    app.includes("if(isTestUser())") &&
    app.includes('resultGrid.classList.add("hide")'),
  successAfterServerConfirmation:
    /const response=await api\(item\);[\s\S]{0,300}if\(showResult\)renderResultResponse\(response\)/.test(app),
  responsiveResultLayout:
    css.includes(".result-secondary-actions{grid-template-columns:1fr}") &&
    css.includes(".telegram-result-info{grid-template-columns:1fr"),
};

for (const [name, passed] of Object.entries(checks)) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

if (Object.values(checks).some((passed) => !passed)) process.exit(1);
