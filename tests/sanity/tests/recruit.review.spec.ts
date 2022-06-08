import { test } from '@playwright/test'
import { generateId, PlatformSetting, PlatformURI } from './utils'

test.use({
  storageState: PlatformSetting
})

test.describe('recruit review tests', () => {
  test.beforeEach(async ({ page }) => {
    // Create user and workspace
    await page.goto(`${PlatformURI}/workbench%3Acomponent%3AWorkbenchApp`)
  })
  test('create-review', async ({ page, context }) => {
    await page.click('[id="app-recruit\\:string\\:RecruitApplication"]')
    await page.click('text=Reviews')
    await page.click('button:has-text("Review")')
    await page.click('[placeholder="Title"]')
    const reviewId = 'review-' + generateId()
    await page.fill('[placeholder="Title"]', reviewId)

    await page.click('button:has-text("1 member")')

    await page.click('button:has-text("Rosamund Chen")')

    await page.press('[placeholder="Search\\.\\.\\."]', 'Escape')

    await page.click('form button :has-text("Talent")')
    // Click button:has-text("Rosamund Chen")
    await page.click('button:has-text("Rosamund Chen")')

    await page.click('button:has-text("Create")')

    await page.click(`tr:has-text('${reviewId}') td a`)
    await page.click('button:has-text("2 members")')
    await page.click('.popup button:has-text("Rosamund Chen")')
    await page.press('[placeholder="Search\\.\\.\\."]', 'Escape')
    await page.click('button:has-text("1 member")')
  })
})
