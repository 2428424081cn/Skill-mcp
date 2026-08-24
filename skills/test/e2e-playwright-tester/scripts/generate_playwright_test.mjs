const testName = process.argv[2] || "User Login Flow";
const url = process.argv[3] || "https://example.com/login";

console.log(`import { test, expect } from '@playwright/test';

test('${testName}', async ({ page }) => {
  await page.goto('${url}');
  
  // 校验标题
  await expect(page).toHaveTitle(/Login|Sign In/i);
  
  // 填写表单
  await page.getByLabel('Username').fill('testuser');
  await page.getByLabel('Password').fill('SecurePassword123');
  await page.getByRole('button', { name: /Submit|Sign in/i }).click();
  
  // 断言跳转
  await expect(page).toHaveURL(/dashboard/);
});
`);
