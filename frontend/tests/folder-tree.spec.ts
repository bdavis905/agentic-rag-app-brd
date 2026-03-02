import { test, expect } from '@playwright/test'

test.describe('Folder Tree UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app and sign in
    await page.goto('/')

    // Check if already signed in by looking for user menu or sign in form
    const signInButton = page.getByRole('button', { name: /sign in/i })
    const hasSignIn = await signInButton.isVisible().catch(() => false)

    if (hasSignIn) {
      // Fill in login form
      await page.getByPlaceholder(/email/i).fill('test@test.com')
      await page.getByPlaceholder(/password/i).fill('M+T!kV3v2d_xn/p')
      await signInButton.click()

      // Wait for navigation to complete
      await page.waitForURL('/', { timeout: 10000 })
    }

    // Navigate to Documents page
    await page.getByRole('button', { name: /documents/i }).click()
    await page.waitForTimeout(1000) // Wait for folder tree to load
  })

  test('UI-01: Folder tree displays in sidebar with Knowledgebase option', async ({ page }) => {
    // Check folder tree header exists
    await expect(page.getByText('Folders', { exact: false })).toBeVisible()

    // Check Knowledgebase option exists
    await expect(page.getByText('Knowledgebase')).toBeVisible()

    // Knowledgebase should be selected by default (has accent background)
    const knowledgebaseItem = page.locator('div').filter({ hasText: /^Knowledgebase$/ }).first()
    await expect(knowledgebaseItem).toBeVisible()
  })

  test('UI-02: Can create a new folder', async ({ page }) => {
    // Click the new folder button (+ icon in Folders header)
    const newFolderButton = page.locator('button[title="New folder"]')
    await newFolderButton.click()

    // Should show an inline input
    const input = page.locator('input').last()
    await expect(input).toBeVisible()

    // Type folder name and press Enter
    const folderName = `Test Folder ${Date.now()}`
    await input.fill(folderName)
    await input.press('Enter')

    // Wait for folder to appear
    await page.waitForTimeout(1000)

    // Folder should now be visible in the tree
    await expect(page.getByText(folderName)).toBeVisible()
  })

  test('UI-03: Right-click context menu shows CRUD options for user folder', async ({ page }) => {
    // First create a folder to test with
    const newFolderButton = page.locator('button[title="New folder"]')
    await newFolderButton.click()

    const input = page.locator('input').last()
    const folderName = `Context Menu Test ${Date.now()}`
    await input.fill(folderName)
    await input.press('Enter')
    await page.waitForTimeout(1000)

    // Right-click on the folder
    const folderElement = page.getByText(folderName)
    await folderElement.click({ button: 'right' })

    // Context menu should appear with options
    await expect(page.getByText('New Subfolder')).toBeVisible()
    await expect(page.getByText('Rename')).toBeVisible()
    await expect(page.getByText('Delete')).toBeVisible()

    // Close context menu
    await page.keyboard.press('Escape')
  })

  test('UI-03: Can rename a folder via context menu', async ({ page }) => {
    // Create a folder first
    const newFolderButton = page.locator('button[title="New folder"]')
    await newFolderButton.click()

    const input = page.locator('input').last()
    const originalName = `Rename Test ${Date.now()}`
    await input.fill(originalName)
    await input.press('Enter')
    await page.waitForTimeout(1000)

    // Right-click and select Rename
    const folderElement = page.getByText(originalName)
    await folderElement.click({ button: 'right' })
    await page.getByText('Rename').click()

    // Should show inline edit
    const renameInput = page.locator('input').last()
    await expect(renameInput).toBeVisible()

    // Type new name
    const newName = `Renamed Folder ${Date.now()}`
    await renameInput.fill(newName)
    await renameInput.press('Enter')
    await page.waitForTimeout(1000)

    // Old name should be gone, new name visible
    await expect(page.getByText(newName)).toBeVisible()
  })

  test('UI-03: Can delete a folder with confirmation', async ({ page }) => {
    // Create a folder first
    const newFolderButton = page.locator('button[title="New folder"]')
    await newFolderButton.click()

    const input = page.locator('input').last()
    const folderName = `Delete Test ${Date.now()}`
    await input.fill(folderName)
    await input.press('Enter')
    await page.waitForTimeout(1000)

    // Verify folder exists
    await expect(page.getByText(folderName)).toBeVisible()

    // Right-click and select Delete
    const folderElement = page.getByText(folderName)
    await folderElement.click({ button: 'right' })
    await page.getByText('Delete').click()

    // Confirmation dialog should appear
    await expect(page.getByText('Delete folder?')).toBeVisible()
    await expect(page.getByText(/This will delete/)).toBeVisible()

    // Confirm deletion
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.waitForTimeout(1000)

    // Folder should be gone
    await expect(page.getByText(folderName)).not.toBeVisible()
  })

  test('UI-04: Selecting folder changes upload target', async ({ page }) => {
    // Create a folder
    const newFolderButton = page.locator('button[title="New folder"]')
    await newFolderButton.click()

    const input = page.locator('input').last()
    const folderName = `Upload Target ${Date.now()}`
    await input.fill(folderName)
    await input.press('Enter')
    await page.waitForTimeout(1000)

    // Click on the folder to select it
    await page.getByText(folderName).click()
    await page.waitForTimeout(500)

    // Check that the description mentions uploading to selected folder
    await expect(page.getByText(/uploading to/i)).toBeVisible()
  })

  test('UI-03: Can create subfolder', async ({ page }) => {
    // Create a parent folder first
    const newFolderButton = page.locator('button[title="New folder"]')
    await newFolderButton.click()

    const input = page.locator('input').last()
    const parentName = `Parent Folder ${Date.now()}`
    await input.fill(parentName)
    await input.press('Enter')
    await page.waitForTimeout(1000)

    // Right-click and select New Subfolder
    const parentElement = page.getByText(parentName)
    await parentElement.click({ button: 'right' })
    await page.getByText('New Subfolder').click()

    // Should show inline input for subfolder
    await page.waitForTimeout(500)
    const subfolderInput = page.locator('input').last()
    await expect(subfolderInput).toBeVisible()

    // Create subfolder
    const childName = `Child Folder ${Date.now()}`
    await subfolderInput.fill(childName)
    await subfolderInput.press('Enter')
    await page.waitForTimeout(1000)

    // Subfolder should be visible (parent should have expanded)
    await expect(page.getByText(childName)).toBeVisible()
  })
})
